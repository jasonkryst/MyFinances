import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser } from './helpers/testDb.js';
import { hashToken, LAST_SEEN_THROTTLE_MS } from '../src/auth/middleware.js';
import { summarizeUserAgent, truncateIp, deviceKey, sessionMetaFromRequest } from '../src/auth/sessionInfo.js';
import { _setTransportOverride, _clearTransportOverride } from '../src/email/transport.js';
import { up as metaUp, down as metaDown } from '../migrations/1755600000048_add-session-metadata.js';

// #683: active sessions (GET/DELETE /api/sessions), the last-seen throttle,
// device details and the new-device sign-in email.

const PASSWORD = 'correct horse battery staple';
const UA = {
    chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
    safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    edgeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
    chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
};

let server, base;

before(() => {
    server = createApp().listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    server.close();
    _clearTransportOverride();
    await pool.end();
});

beforeEach(async () => {
    await resetDb();
    await pool.query('TRUNCATE known_devices');
    _clearTransportOverride();
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_FROM;
});

// Signs in with a given User-Agent; returns { cookies, headers, token }.
async function signIn(email, ua = UA.chromeWin) {
    const res = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': ua },
        body: JSON.stringify({ email, password: PASSWORD })
    });
    assert.equal(res.status, 200);
    const cookies = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const csrf = cookies.match(/csrf=([^;]+)/)[1];
    const token = cookies.match(/session=([^;]+)/)[1];
    return { cookies, token, headers: { Cookie: cookies, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' } };
}

const list = async (s) => {
    const res = await fetch(`${base}/api/sessions`, { headers: s.headers });
    assert.equal(res.status, 200);
    return res.json();
};
const probe = async (s) => (await fetch(`${base}/api/plan-settings`, { headers: s.headers })).status;

// ─── Pure helpers ────────────────────────────────────────────────────────────

test('summarizeUserAgent names common browsers and systems, and null for the unknown', () => {
    assert.deepEqual(summarizeUserAgent(UA.chromeWin), { browser: 'Chrome', os: 'Windows' });
    assert.deepEqual(summarizeUserAgent(UA.firefoxLinux), { browser: 'Firefox', os: 'Linux' });
    assert.deepEqual(summarizeUserAgent(UA.safariIphone), { browser: 'Safari', os: 'iOS' });
    assert.deepEqual(summarizeUserAgent(UA.edgeMac), { browser: 'Edge', os: 'macOS' });
    assert.deepEqual(summarizeUserAgent(UA.chromeAndroid), { browser: 'Chrome', os: 'Android' });
    assert.deepEqual(summarizeUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36'),
        { browser: 'Chrome', os: 'Linux' });
    assert.deepEqual(summarizeUserAgent('curl/8.5.0'), { browser: null, os: null });
    assert.deepEqual(summarizeUserAgent(undefined), { browser: null, os: null });
    assert.equal(deviceKey(UA.chromeWin), 'Chrome|Windows');
    assert.equal(deviceKey(null), 'unknown|unknown');
});

test('truncateIp keeps only the /24 or /48 network', () => {
    assert.equal(truncateIp('203.0.113.77'), '203.0.113.0/24');
    assert.equal(truncateIp('::ffff:198.51.100.9'), '198.51.100.0/24');
    assert.equal(truncateIp('2001:db8:85a3:8d3:1319:8a2e:370:7348'), '2001:db8:85a3::/48');
    assert.equal(truncateIp('2001:db8::1'), '2001:db8:0::/48');
    assert.equal(truncateIp('::1'), '0:0:0::/48');
    for (const bad of ['', 'not-an-ip', '999.1.1.1', null, 42]) assert.equal(truncateIp(bad), null, String(bad));
});

test('sessionMetaFromRequest caps the User-Agent and never keeps the full address', () => {
    const req = { ip: '203.0.113.77', get: h => (h === 'User-Agent' ? 'x'.repeat(2000) : undefined) };
    const meta = sessionMetaFromRequest(req);
    assert.equal(meta.userAgent.length, 512);
    assert.equal(meta.ipPrefix, '203.0.113.0/24');
    assert.deepEqual(sessionMetaFromRequest({ ip: undefined, get: () => undefined }), { userAgent: null, ipPrefix: null });
});

// ─── Listing ─────────────────────────────────────────────────────────────────

test('GET /api/sessions lists this user\'s sessions, marks the current one, and never exposes the token or its hash', async () => {
    await createTestUser('me@example.com', PASSWORD);
    const phone = await signIn('me@example.com', UA.safariIphone);
    const laptop = await signIn('me@example.com', UA.firefoxLinux);

    const rows = await list(laptop);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].current, true, 'the current session is listed first');
    assert.deepEqual([rows[0].browser, rows[0].os], ['Firefox', 'Linux']);
    assert.deepEqual([rows[1].browser, rows[1].os, rows[1].current], ['Safari', 'iOS', false]);
    for (const r of rows) {
        assert.match(r.id, /^[0-9a-f-]{36}$/);
        assert.deepEqual(Object.keys(r).sort(), ['browser', 'createdAt', 'current', 'id', 'ip', 'lastSeenAt', 'os']);
        assert.ok(r.lastSeenAt && r.createdAt);
        assert.match(r.ip, /\/24$|\/48$/, 'only a truncated network');
    }
    const body = JSON.stringify(rows);
    for (const s of [phone, laptop]) {
        assert.ok(!body.includes(s.token), 'raw token not exposed');
        assert.ok(!body.includes(hashToken(s.token)), 'token hash not exposed');
    }
    // The phone sees the same two, with itself current.
    const fromPhone = await list(phone);
    assert.deepEqual(fromPhone.filter(r => r.current).map(r => r.os), ['iOS']);
});

test('expired sessions are not listed', async () => {
    await createTestUser('me@example.com', PASSWORD);
    const a = await signIn('me@example.com');
    const b = await signIn('me@example.com', UA.firefoxLinux);
    await pool.query('UPDATE sessions SET expires_at = now() - interval \'1 minute\' WHERE id = $1', [hashToken(b.token)]);
    assert.equal((await list(a)).length, 1);
});

test('a user can never list or revoke another user\'s sessions', async () => {
    await createTestUser('me@example.com', PASSWORD);
    await createTestUser('other@example.com', PASSWORD);
    const me = await signIn('me@example.com');
    const other = await signIn('other@example.com', UA.firefoxLinux);

    const mine = await list(me);
    const theirs = await list(other);
    assert.equal(mine.length, 1);
    assert.equal(theirs.length, 1);
    assert.notEqual(mine[0].id, theirs[0].id);

    const res = await fetch(`${base}/api/sessions/${mine[0].id}`, { method: 'DELETE', headers: other.headers });
    assert.equal(res.status, 404, 'my session id is unknown to them');
    assert.equal(await probe(me), 200, 'my session survived');

    // "Sign out other sessions" never touches another user.
    const others = await fetch(`${base}/api/sessions?others=1`, { method: 'DELETE', headers: other.headers });
    assert.deepEqual(await others.json(), { revoked: 0 });
    assert.equal(await probe(me), 200);
});

// ─── Revoking ────────────────────────────────────────────────────────────────

test('revoking a session sends that browser to sign-in on its next request', async () => {
    await createTestUser('me@example.com', PASSWORD);
    const phone = await signIn('me@example.com', UA.safariIphone);
    const laptop = await signIn('me@example.com', UA.firefoxLinux);
    const phoneRow = (await list(laptop)).find(r => !r.current);

    const res = await fetch(`${base}/api/sessions/${phoneRow.id}`, { method: 'DELETE', headers: laptop.headers });
    assert.equal(res.status, 204);
    assert.equal(await probe(phone), 401);
    assert.equal(await probe(laptop), 200);
    assert.equal((await list(laptop)).length, 1);

    const again = await fetch(`${base}/api/sessions/${phoneRow.id}`, { method: 'DELETE', headers: laptop.headers });
    assert.equal(again.status, 404);
});

test('DELETE ?others=1 signs out every other session and keeps this one', async () => {
    await createTestUser('me@example.com', PASSWORD);
    const a = await signIn('me@example.com', UA.safariIphone);
    const b = await signIn('me@example.com', UA.chromeAndroid);
    const c = await signIn('me@example.com', UA.firefoxLinux);

    const res = await fetch(`${base}/api/sessions?others=1`, { method: 'DELETE', headers: c.headers });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { revoked: 2 });
    assert.equal(await probe(a), 401);
    assert.equal(await probe(b), 401);
    assert.equal(await probe(c), 200);
});

test('revoking the current session signs this browser out and clears its cookies', async () => {
    await createTestUser('me@example.com', PASSWORD);
    const me = await signIn('me@example.com');
    const [row] = await list(me);
    const res = await fetch(`${base}/api/sessions/${row.id}`, { method: 'DELETE', headers: me.headers });
    assert.equal(res.status, 204);
    assert.ok(res.headers.getSetCookie().some(c => /^session=;/.test(c)));
    assert.equal(await probe(me), 401);
});

test('bad requests: no ?others, a malformed id, no CSRF token, no session', async () => {
    await createTestUser('me@example.com', PASSWORD);
    const me = await signIn('me@example.com');
    assert.equal((await fetch(`${base}/api/sessions`, { method: 'DELETE', headers: me.headers })).status, 400);
    assert.equal((await fetch(`${base}/api/sessions?others=true`, { method: 'DELETE', headers: me.headers })).status, 400);
    assert.equal((await fetch(`${base}/api/sessions/123`, { method: 'DELETE', headers: me.headers })).status, 404);
    assert.equal((await fetch(`${base}/api/sessions/${hashToken(me.token)}`, { method: 'DELETE', headers: me.headers })).status, 404,
        'the token hash is not an accepted id');
    const [row] = await list(me);
    const noCsrf = await fetch(`${base}/api/sessions/${row.id}`, { method: 'DELETE', headers: { Cookie: me.cookies } });
    assert.equal(noCsrf.status, 403);
    assert.equal((await fetch(`${base}/api/sessions`)).status, 401);
    assert.equal(await probe(me), 200, 'none of these signed me out');
});

// ─── Last seen ───────────────────────────────────────────────────────────────

test('last_seen_at is refreshed on use, at most once per throttle window', async () => {
    await createTestUser('me@example.com', PASSWORD);
    const me = await signIn('me@example.com');
    const id = hashToken(me.token);
    const lastSeen = async () => new Date((await pool.query('SELECT last_seen_at FROM sessions WHERE id = $1', [id])).rows[0].last_seen_at).getTime();

    const old = new Date(Date.now() - LAST_SEEN_THROTTLE_MS - 60_000);
    await pool.query('UPDATE sessions SET last_seen_at = $2 WHERE id = $1', [id, old]);
    await probe(me);
    const refreshed = await lastSeen();
    assert.ok(refreshed > old.getTime() + 60_000, 'a stale last_seen_at is refreshed');

    const recent = new Date(Date.now() - 60_000);
    await pool.query('UPDATE sessions SET last_seen_at = $2 WHERE id = $1', [id, recent]);
    await probe(me);
    assert.equal(await lastSeen(), recent.getTime(), 'a recent last_seen_at is left alone');
});

// ─── New-device email ────────────────────────────────────────────────────────

function captureMail({ fail = false } = {}) {
    const sent = [];
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_FROM = 'noreply@example.com';
    _setTransportOverride({ sendMail: async (m) => { if (fail) throw new Error('SMTP down'); sent.push(m); return {}; } });
    return sent;
}

// The email goes out in the background after the response.
async function settle() {
    for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 25));
}

async function putSetting(s, key, value) {
    const res = await fetch(`${base}/api/settings/${key}`, { method: 'PUT', headers: s.headers, body: JSON.stringify({ value }) });
    assert.ok(res.ok, `PUT ${key}`);
}

test('a sign-in from a new browser/OS pair emails the user; the first device and a known device do not', async () => {
    const sent = captureMail();
    await createTestUser('me@example.com', PASSWORD);
    await signIn('me@example.com', UA.chromeWin);
    await settle();
    assert.equal(sent.length, 0, 'the first device ever is remembered silently');

    await signIn('me@example.com', UA.chromeWin);
    await settle();
    assert.equal(sent.length, 0, 'a known device');

    await signIn('me@example.com', UA.firefoxLinux);
    await settle();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'me@example.com');
    assert.equal(sent[0].subject, 'New sign-in to MyFinances');
    assert.match(sent[0].text, /Firefox on Linux/);
    assert.match(sent[0].text, /Settings > Notifications/);

    await signIn('me@example.com', UA.firefoxLinux);
    await settle();
    assert.equal(sent.length, 1, 'now known');
    const devices = (await pool.query('SELECT device_key FROM known_devices ORDER BY device_key')).rows.map(r => r.device_key);
    assert.deepEqual(devices, ['Chrome|Windows', 'Firefox|Linux']);
});

test('notifyNewSignIn false, or the in-app-only channel, sends no email', async () => {
    const sent = captureMail();
    await createTestUser('me@example.com', PASSWORD);
    const me = await signIn('me@example.com', UA.chromeWin);

    await putSetting(me, 'notifyNewSignIn', false);
    await signIn('me@example.com', UA.firefoxLinux);
    await settle();
    assert.equal(sent.length, 0, 'turned off');

    await putSetting(me, 'notifyNewSignIn', true);
    await putSetting(me, 'notifyChannel', 'inApp');
    await signIn('me@example.com', UA.safariIphone);
    await settle();
    assert.equal(sent.length, 0, 'in-app only');

    await putSetting(me, 'notifyChannel', 'email');
    await signIn('me@example.com', UA.chromeAndroid);
    await settle();
    assert.equal(sent.length, 1, 'back on');
});

test('a failing or unconfigured mail server never fails the sign-in', async () => {
    await createTestUser('me@example.com', PASSWORD);
    await signIn('me@example.com', UA.chromeWin);
    // Unconfigured: signIn asserts 200.
    await signIn('me@example.com', UA.firefoxLinux);

    captureMail({ fail: true });
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.map(String).join(' '));
    try {
        await signIn('me@example.com', UA.safariIphone);
        await settle();
    } finally {
        console.error = original;
    }
    assert.ok(errors.some(e => e.includes('new sign-in email failed')));
});

test('one user\'s devices never count as another user\'s', async () => {
    const sent = captureMail();
    await createTestUser('me@example.com', PASSWORD);
    await createTestUser('other@example.com', PASSWORD);
    await signIn('me@example.com', UA.chromeWin);
    await signIn('other@example.com', UA.firefoxLinux);
    await signIn('other@example.com', UA.chromeWin);
    await settle();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'other@example.com', 'Chrome on Windows is new for them');
});

// ─── Migration ───────────────────────────────────────────────────────────────

test('migration 048 is idempotent and its down() keeps sessions', async () => {
    await createTestUser('me@example.com', PASSWORD);
    const me = await signIn('me@example.com');
    const run = async (fn) => { const stmts = []; await fn({ sql: s => stmts.push(s) }); for (const s of stmts) await pool.query(s); };
    await run(metaUp); // already applied: a no-op
    await run(metaDown);
    try {
        const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'sessions'`)).rows.map(r => r.column_name);
        assert.ok(!cols.includes('public_id') && !cols.includes('ip_prefix'));
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM sessions')).rows[0].n, 1, 'nobody is signed out');
    } finally {
        await run(metaUp);
    }
    // Re-applied: the existing session gets a public id and still works.
    assert.equal(await probe(me), 200);
    assert.match((await list(me))[0].id, /^[0-9a-f-]{36}$/);
});
