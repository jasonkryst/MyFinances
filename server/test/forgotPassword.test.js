import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser } from './helpers/testDb.js';
import { _setTransportOverride, _clearTransportOverride } from '../src/email/transport.js';

// #557: POST /auth/forgot-password. It always answers 200 { ok: true } so it
// never confirms whether an address is registered; only a known address gets
// a token row (hashed, one hour) and an email, and a failed send is tolerated.

const PASSWORD = 'correct horse battery staple';
const servers = [];

function startApp() {
    const server = createApp().listen(0);
    servers.push(server);
    return `http://127.0.0.1:${server.address().port}`;
}

function forgot(base, body) {
    return fetch(`${base}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

async function tokenRows() {
    return (await pool.query('SELECT user_id, token_hash, expires_at, used_at FROM password_reset_tokens')).rows;
}

function withSmtp(sendMail) {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_FROM = 'noreply@example.com';
    _setTransportOverride({ sendMail });
}

beforeEach(async () => {
    await resetDb();
    _clearTransportOverride();
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_FROM;
});

after(async () => {
    for (const s of servers) s.close();
    _clearTransportOverride();
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_FROM;
    await pool.end();
});

test('an unknown email answers exactly like a known one and writes nothing', async () => {
    const sent = [];
    withSmtp(async (m) => { sent.push(m); return {}; });
    await createTestUser('known@example.com', PASSWORD);
    const base = startApp();

    const unknown = await forgot(base, { email: 'nobody@example.com' });
    const known = await forgot(base, { email: 'known@example.com' });
    assert.equal(unknown.status, 200);
    assert.equal(known.status, 200);
    assert.deepEqual(await unknown.json(), await known.json(), 'same body, no enumeration');
    assert.equal((await tokenRows()).length, 1, 'only the known address got a token');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'known@example.com');
});

test('a missing, blank or non-string email is a plain 200 with no token', async () => {
    await createTestUser('known@example.com', PASSWORD);
    const base = startApp();
    for (const body of [{}, { email: '' }, { email: '   ' }, { email: 42 }]) {
        const res = await forgot(base, body);
        assert.equal(res.status, 200, JSON.stringify(body));
        assert.deepEqual(await res.json(), { ok: true });
    }
    assert.equal((await tokenRows()).length, 0);
});

test('a known email stores only the hash of a one-hour token, and the mailed link carries the raw token', async () => {
    const sent = [];
    withSmtp(async (m) => { sent.push(m); return {}; });
    const user = await createTestUser('known@example.com', PASSWORD);
    const base = startApp();
    const before = Date.now();

    assert.equal((await forgot(base, { email: 'known@example.com' })).status, 200);
    const rows = await tokenRows();
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].user_id), Number(user.id));
    assert.equal(rows[0].used_at, null);
    const ttl = new Date(rows[0].expires_at).getTime() - before;
    assert.ok(ttl > 59 * 60 * 1000 && ttl <= 61 * 60 * 1000, `expires in about an hour (${ttl} ms)`);

    const text = `${sent[0].text || ''} ${sent[0].html || ''}`;
    const raw = text.match(/reset_token=([0-9a-f]{64})/)?.[1];
    assert.ok(raw, 'the email contains a reset link');
    assert.notEqual(rows[0].token_hash, raw, 'the raw token is never stored');
    assert.equal(rows[0].token_hash, createHash('sha256').update(raw).digest('hex'));
});

test('a failed email send is logged and tolerated: still 200, and the token row stays', async () => {
    withSmtp(async () => { throw new Error('SMTP down'); });
    await createTestUser('known@example.com', PASSWORD);
    const base = startApp();
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.map(String).join(' '));
    try {
        const res = await forgot(base, { email: 'known@example.com' });
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { ok: true });
    } finally {
        console.error = original;
    }
    assert.equal((await tokenRows()).length, 1);
    assert.ok(errors.some(e => e.includes('password reset email failed')), 'the failure is logged');
});

test('with SMTP unconfigured the request still succeeds and writes the token', async () => {
    await createTestUser('known@example.com', PASSWORD);
    const base = startApp();
    const res = await forgot(base, { email: 'known@example.com' });
    assert.equal(res.status, 200);
    assert.equal((await tokenRows()).length, 1);
});
