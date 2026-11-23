import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser } from './helpers/testDb.js';
import { hashToken } from '../src/auth/middleware.js';
import { parseBearer, isDeniedPath, generateApiToken, MAX_TOKENS_PER_USER, LAST_USED_THROTTLE_MS } from '../src/auth/apiTokens.js';
import { up as tokensUp, down as tokensDown } from '../migrations/1755600000049_create-api-tokens.js';

// #581: read-only personal API tokens.

const PASSWORD = 'correct horse battery staple';
let server, base;

before(() => {
    server = createApp().listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    server.close();
    await pool.end();
});

beforeEach(async () => {
    await resetDb();
    await pool.query('TRUNCATE api_tokens');
});

async function signIn(email) {
    const res = await fetch(`${base}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD })
    });
    assert.equal(res.status, 200);
    const cookies = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    return { Cookie: cookies, 'X-CSRF-Token': cookies.match(/csrf=([^;]+)/)[1], 'Content-Type': 'application/json' };
}

async function createToken(session, name = 'Dashboard') {
    const res = await fetch(`${base}/api/api-tokens`, { method: 'POST', headers: session, body: JSON.stringify({ name }) });
    assert.equal(res.status, 201);
    return res.json();
}

const bearer = token => ({ Authorization: `Bearer ${token}` });

// ─── Pure helpers ────────────────────────────────────────────────────────────

test('parseBearer accepts only a well-formed mft_ token', () => {
    const t = generateApiToken();
    assert.match(t, /^mft_[A-Za-z0-9_-]{43}$/);
    assert.equal(parseBearer(`Bearer ${t}`), t);
    assert.equal(parseBearer(`bearer ${t}`), null, 'scheme is case-sensitive here');
    for (const bad of [undefined, '', t, `Basic ${t}`, `Bearer ${t}x`, `Bearer ${t.slice(0, -1)}`, 'Bearer mft_', `Bearer abc_${t.slice(4)}`]) {
        assert.equal(parseBearer(bad), null, String(bad));
    }
});

test('isDeniedPath covers credential routes however the path is written', () => {
    for (const p of ['/api/sessions', '/api/sessions/', '/api/sessions/abc', '/api/api-tokens', '/api/API-Tokens',
        '/api//sessions', '/api/calendar', '/api/calendar/token', '/api/sessions?others=1']) {
        assert.equal(isDeniedPath(p), true, p);
    }
    for (const p of ['/api/accounts', '/api/sessionsx', '/api/plan-settings', '/api/notifications']) {
        assert.equal(isDeniedPath(p), false, p);
    }
});

// ─── Managing tokens ─────────────────────────────────────────────────────────

test('create returns the raw token once; the list shows only name, prefix and dates', async () => {
    await createTestUser('me@example.com', PASSWORD);
    const me = await signIn('me@example.com');
    const created = await createToken(me, '  Grafana  ');
    assert.equal(created.name, 'Grafana');
    assert.equal(created.scope, 'read');
    assert.equal(created.lastUsedAt, null);
    assert.equal(created.prefix, created.token.slice(0, 12));

    const list = await (await fetch(`${base}/api/api-tokens`, { headers: me })).json();
    assert.equal(list.length, 1);
    assert.deepEqual(Object.keys(list[0]).sort(), ['createdAt', 'id', 'lastUsedAt', 'name', 'prefix', 'scope']);
    assert.ok(!JSON.stringify(list).includes(created.token));

    const row = (await pool.query('SELECT token_hash FROM api_tokens')).rows[0];
    assert.equal(row.token_hash, hashToken(created.token), 'only the hash is stored');
});

test('a blank or missing name is a 400; a long name is capped', async () => {
    await createTestUser('me@example.com', PASSWORD);
    const me = await signIn('me@example.com');
    for (const body of [{}, { name: '' }, { name: '   ' }, { name: 42 }]) {
        const res = await fetch(`${base}/api/api-tokens`, { method: 'POST', headers: me, body: JSON.stringify(body) });
        assert.equal(res.status, 400, JSON.stringify(body));
    }
    const long = await createToken(me, 'x'.repeat(200));
    assert.equal(long.name.length, 60);
});

test(`at most ${MAX_TOKENS_PER_USER} tokens per user`, async () => {
    await createTestUser('me@example.com', PASSWORD);
    const me = await signIn('me@example.com');
    for (let i = 0; i < MAX_TOKENS_PER_USER; i++) await createToken(me, `t${i}`);
    const res = await fetch(`${base}/api/api-tokens`, { method: 'POST', headers: me, body: JSON.stringify({ name: 'one more' }) });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'TOKEN_LIMIT');
});

test('creating or deleting a token needs the CSRF header', async () => {
    await createTestUser('me@example.com', PASSWORD);
    const me = await signIn('me@example.com');
    const res = await fetch(`${base}/api/api-tokens`, {
        method: 'POST', headers: { Cookie: me.Cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' })
    });
    assert.equal(res.status, 403);
});

// ─── Using tokens ────────────────────────────────────────────────────────────

test('a token reads the owner\'s data with GET and HEAD, and records its last use', async () => {
    await createTestUser('me@example.com', PASSWORD);
    const me = await signIn('me@example.com');
    await fetch(`${base}/api/accounts`, { method: 'POST', headers: me, body: JSON.stringify({ name: 'Checking', type: 'Checking', startingBalance: 10 }) });
    const { token, id } = await createToken(me);

    const res = await fetch(`${base}/api/accounts`, { headers: bearer(token) });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).map(a => a.name), ['Checking']);
    assert.equal((await fetch(`${base}/api/accounts`, { method: 'HEAD', headers: bearer(token) })).status, 200);

    const [row] = await (await fetch(`${base}/api/api-tokens`, { headers: me })).json();
    assert.equal(row.id, id);
    assert.ok(row.lastUsedAt, 'last use recorded');
});

test('a token never writes: POST, PATCH, PUT and DELETE are 403 and change nothing', async () => {
    await createTestUser('me@example.com', PASSWORD);
    const me = await signIn('me@example.com');
    const acct = await (await fetch(`${base}/api/accounts`, { method: 'POST', headers: me, body: JSON.stringify({ name: 'Checking', type: 'Checking', startingBalance: 10 }) })).json();
    const { token } = await createToken(me);
    const h = { ...bearer(token), 'Content-Type': 'application/json' };
    const attempts = [
        ['POST', '/api/accounts', { name: 'Evil', type: 'Checking' }],
        ['PATCH', `/api/accounts/${acct.id}`, { name: 'Evil' }],
        ['PUT', '/api/settings/notifyBillDue', { value: false }],
        ['DELETE', `/api/accounts/${acct.id}`, null],
        ['DELETE', '/api/accounts', null],
        ['POST', '/api/notifications/check', {}]
    ];
    for (const [method, path, body] of attempts) {
        const res = await fetch(`${base}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
        assert.equal(res.status, 403, `${method} ${path}`);
        assert.equal((await res.json()).error.code, 'TOKEN_READ_ONLY');
    }
    const accounts = await (await fetch(`${base}/api/accounts`, { headers: me })).json();
    assert.deepEqual(accounts.map(a => a.name), ['Checking']);
});

test('a token cannot read or manage sessions, tokens or the calendar feed token', async () => {
    await createTestUser('me@example.com', PASSWORD);
    const me = await signIn('me@example.com');
    const { token } = await createToken(me);
    for (const path of ['/api/sessions', '/api/api-tokens', '/api/calendar/token', '/api//sessions', '/api/API-TOKENS']) {
        const res = await fetch(`${base}${path}`, { headers: bearer(token) });
        assert.equal(res.status, 403, path);
        assert.equal((await res.json()).error.code, 'TOKEN_FORBIDDEN');
    }
});

test('a token never authenticates /auth or /health routes', async () => {
    await createTestUser('me@example.com', PASSWORD);
    const me = await signIn('me@example.com');
    const { token } = await createToken(me);
    assert.equal((await fetch(`${base}/health/session-check`, { headers: bearer(token) })).status, 401);
    const change = await fetch(`${base}/auth/change-password`, {
        method: 'POST', headers: { ...bearer(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: PASSWORD, newPassword: 'a-brand-new passphrase 2026' })
    });
    assert.equal(change.status, 401);
});

test('unknown, malformed and revoked tokens are 401', async () => {
    await createTestUser('me@example.com', PASSWORD);
    const me = await signIn('me@example.com');
    const { token, id } = await createToken(me);
    for (const auth of [`Bearer ${generateApiToken()}`, 'Bearer nope', `Basic ${token}`, `Bearer ${token.slice(0, -2)}`]) {
        const res = await fetch(`${base}/api/accounts`, { headers: { Authorization: auth } });
        assert.equal(res.status, 401, auth);
    }
    assert.equal((await fetch(`${base}/api/api-tokens/${id}`, { method: 'DELETE', headers: me })).status, 204);
    assert.equal((await fetch(`${base}/api/accounts`, { headers: bearer(token) })).status, 401, 'revoked');
    assert.equal((await fetch(`${base}/api/api-tokens/${id}`, { method: 'DELETE', headers: me })).status, 404);
});

test('a token only ever sees its owner\'s data; another user cannot list or revoke it', async () => {
    await createTestUser('me@example.com', PASSWORD);
    await createTestUser('other@example.com', PASSWORD);
    const me = await signIn('me@example.com');
    const other = await signIn('other@example.com');
    await fetch(`${base}/api/accounts`, { method: 'POST', headers: other, body: JSON.stringify({ name: 'Theirs', type: 'Checking' }) });
    const mine = await createToken(me);

    assert.deepEqual(await (await fetch(`${base}/api/accounts`, { headers: bearer(mine.token) })).json(), []);
    assert.deepEqual(await (await fetch(`${base}/api/api-tokens`, { headers: other })).json(), []);
    assert.equal((await fetch(`${base}/api/api-tokens/${mine.id}`, { method: 'DELETE', headers: other })).status, 404);
    assert.equal((await fetch(`${base}/api/accounts`, { headers: bearer(mine.token) })).status, 200, 'still works');
});

test('a browser session wins over a token in the same request', async () => {
    await createTestUser('me@example.com', PASSWORD);
    await createTestUser('other@example.com', PASSWORD);
    const me = await signIn('me@example.com');
    const other = await signIn('other@example.com');
    await fetch(`${base}/api/accounts`, { method: 'POST', headers: me, body: JSON.stringify({ name: 'Mine', type: 'Checking' }) });
    const theirs = await createToken(other);
    const res = await fetch(`${base}/api/accounts`, { headers: { ...me, ...bearer(theirs.token) } });
    assert.deepEqual((await res.json()).map(a => a.name), ['Mine']);
});

test('last_used_at is written at most once per throttle window', async () => {
    await createTestUser('me@example.com', PASSWORD);
    const me = await signIn('me@example.com');
    const { token } = await createToken(me);
    const recent = new Date(Date.now() - LAST_USED_THROTTLE_MS / 2);
    await pool.query('UPDATE api_tokens SET last_used_at = $1', [recent]);
    await fetch(`${base}/api/accounts`, { headers: bearer(token) });
    const after1 = (await pool.query('SELECT last_used_at FROM api_tokens')).rows[0].last_used_at;
    assert.equal(new Date(after1).getTime(), recent.getTime(), 'recent use left alone');

    const old = new Date(Date.now() - LAST_USED_THROTTLE_MS * 2);
    await pool.query('UPDATE api_tokens SET last_used_at = $1', [old]);
    await fetch(`${base}/api/accounts`, { headers: bearer(token) });
    const after2 = (await pool.query('SELECT last_used_at FROM api_tokens')).rows[0].last_used_at;
    assert.ok(new Date(after2).getTime() > old.getTime());
});

test('changing the password revokes every token', async () => {
    await createTestUser('me@example.com', PASSWORD);
    const me = await signIn('me@example.com');
    const { token } = await createToken(me);
    const res = await fetch(`${base}/auth/change-password`, {
        method: 'POST', headers: me,
        body: JSON.stringify({ currentPassword: PASSWORD, newPassword: 'a-brand-new passphrase 2026' })
    });
    assert.equal(res.status, 200);
    assert.equal((await fetch(`${base}/api/accounts`, { headers: bearer(token) })).status, 401);
});

test('migration 049 is idempotent and down() drops the table', async () => {
    await createTestUser('me@example.com', PASSWORD);
    const run = async (fn) => { const stmts = []; await fn({ sql: s => stmts.push(s) }); for (const s of stmts) await pool.query(s); };
    await run(tokensUp);
    await run(tokensDown);
    try {
        const { rows } = await pool.query(`SELECT to_regclass('public.api_tokens') AS t`);
        assert.equal(rows[0].t, null);
    } finally {
        await run(tokensUp);
    }
    // Only the 'read' scope exists.
    await assert.rejects(pool.query(`INSERT INTO api_tokens (user_id, name, token_hash, token_prefix, scope)
        SELECT id, 'x', 'h', 'p', 'write' FROM users LIMIT 1`), /api_tokens_scope_check/);
});
