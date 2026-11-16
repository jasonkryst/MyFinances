import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser } from './helpers/testDb.js';
import { normalizeEmail } from '../src/auth/email.js';
import { trustProxyHops, TRUST_PROXY_HOPS_DEFAULT } from '../src/trustProxy.js';
import { _setTransportOverride, _clearTransportOverride } from '../src/email/transport.js';
import { up as normalizeUp } from '../migrations/1755600000041_normalize-user-emails.js';

// Sign-in recovery: case-insensitive emails, the login rate limit's Retry-After
// and log line, TRUST_PROXY_HOPS, and scripts/reset-password.js.

const SERVER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a-brand-new passphrase 2026';

let servers = [];
const savedEnv = {};

function startApp(env = {}) {
    for (const [k, v] of Object.entries(env)) {
        if (!(k in savedEnv)) savedEnv[k] = process.env[k];
        process.env[k] = v;
    }
    const server = createApp().listen(0);
    for (const k of Object.keys(env)) {
        if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
    }
    servers.push(server);
    return `http://127.0.0.1:${server.address().port}`;
}

after(async () => {
    for (const s of servers) s.close();
    _clearTransportOverride();
    await pool.end();
});

beforeEach(async () => {
    await resetDb();
});

const login = (base, email, password, headers = {}) => fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ email, password }),
});

// ─── Email normalization ─────────────────────────────────────────────────────

test('normalizeEmail trims and lowercases; non-strings become empty', () => {
    assert.equal(normalizeEmail('  Jason@Example.COM \t'), 'jason@example.com');
    assert.equal(normalizeEmail('a@b.c'), 'a@b.c');
    for (const v of [undefined, null, 42, {}, []]) assert.equal(normalizeEmail(v), '');
});

test('sign-in ignores case and surrounding spaces', async () => {
    const base = startApp();
    await createTestUser('jason@example.com', PASSWORD);
    for (const typed of ['Jason@example.com', 'JASON@EXAMPLE.COM', '  jason@example.com ']) {
        const res = await login(base, typed, PASSWORD);
        assert.equal(res.status, 200, typed);
    }
    assert.equal((await login(base, 'Jason@example.com', 'wrong password here')).status, 401);
    assert.equal((await login(base, 'other@example.com', PASSWORD)).status, 401);
    assert.equal((await login(base, '   ', PASSWORD)).status, 401);
});

test('an account stored before normalization (mixed case, spaces) still signs in', async () => {
    const base = startApp();
    await createTestUser(' Jason@Example.com', PASSWORD);
    assert.equal((await login(base, 'jason@example.com', PASSWORD)).status, 200);
});

test('setup stores the email trimmed and lowercase', async () => {
    const base = startApp();
    // ALLOW_SETUP is read per request.
    const saved = process.env.ALLOW_SETUP;
    process.env.ALLOW_SETUP = 'true';
    let res;
    try {
        res = await fetch(`${base}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: '  New.User@Example.COM ', password: PASSWORD }),
        });
    } finally {
        if (saved === undefined) delete process.env.ALLOW_SETUP; else process.env.ALLOW_SETUP = saved;
    }
    assert.equal(res.status, 200);
    const { rows } = await pool.query('SELECT email FROM users');
    assert.deepEqual(rows.map(r => r.email), ['new.user@example.com']);
    assert.equal((await login(base, 'NEW.USER@example.com', PASSWORD)).status, 200);
});

test('forgot-password finds the account whatever the case, and mails the stored address', async () => {
    const sent = [];
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_FROM = 'noreply@example.com';
    _setTransportOverride({ sendMail: async (m) => { sent.push(m); return {}; } });
    try {
        const base = startApp();
        await createTestUser('jason@example.com', PASSWORD);
        const res = await fetch(`${base}/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: ' JASON@Example.com ' }),
        });
        assert.equal(res.status, 200);
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM password_reset_tokens')).rows[0].n, 1);
        assert.equal(sent.length, 1);
        assert.equal(sent[0].to, 'jason@example.com');
    } finally {
        delete process.env.SMTP_HOST;
        delete process.env.SMTP_FROM;
        _clearTransportOverride();
    }
});

test('migration 041 normalizes stored emails, skips a colliding row, and is idempotent', async () => {
    const stmts = [];
    await normalizeUp({ sql: s => stmts.push(s) });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`INSERT INTO users (email, password_hash) VALUES (' Mixed@Example.com ', 'x'), ('Other@Example.com', 'x'), ('other@example.com', 'x')`);
        for (const s of stmts) await client.query(s);
        for (const s of stmts) await client.query(s); // second run changes nothing
        const { rows } = await client.query('SELECT email FROM users ORDER BY id');
        assert.deepEqual(rows.map(r => r.email), ['mixed@example.com', 'Other@Example.com', 'other@example.com']);
    } finally {
        await client.query('ROLLBACK');
        client.release();
    }
});

// ─── Login rate limit ────────────────────────────────────────────────────────

test('the 6th failed sign-in is refused with Retry-After and an operator log line', async () => {
    const base = startApp();
    await createTestUser('jason@example.com', PASSWORD);
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
        for (let i = 0; i < 5; i++) assert.equal((await login(base, 'jason@example.com', 'wrong password!!')).status, 401);
        const res = await login(base, 'jason@example.com', PASSWORD);
        assert.equal(res.status, 429);
        const retryAfter = Number(res.headers.get('retry-after'));
        assert.ok(retryAfter > 0 && retryAfter <= 15 * 60, `Retry-After ${res.headers.get('retry-after')}`);
        assert.equal((await res.json()).error.code, 'RATE_LIMITED');
    } finally {
        console.warn = original;
    }
    assert.ok(warnings.some(w => w.includes('login rate limit reached') && w.includes('TRUST_PROXY_HOPS')), warnings.join('\n'));
});

// ─── TRUST_PROXY_HOPS ────────────────────────────────────────────────────────

test('trustProxyHops: default 1, whole numbers 0-10, anything else warns and uses 1', () => {
    const log = { warns: [], warn(m) { this.warns.push(m); } };
    assert.equal(trustProxyHops({}, log), TRUST_PROXY_HOPS_DEFAULT);
    assert.equal(trustProxyHops({ TRUST_PROXY_HOPS: '' }, log), 1);
    assert.equal(trustProxyHops({ TRUST_PROXY_HOPS: '0' }, log), 0);
    assert.equal(trustProxyHops({ TRUST_PROXY_HOPS: ' 2 ' }, log), 2);
    assert.equal(trustProxyHops({ TRUST_PROXY_HOPS: '10' }, log), 10);
    assert.equal(log.warns.length, 0);
    for (const bad of ['11', '-1', '1.5', 'true', 'two']) assert.equal(trustProxyHops({ TRUST_PROXY_HOPS: bad }, log), 1, bad);
    assert.equal(log.warns.length, 5);
});

async function failFiveFrom(base, xff) {
    for (let i = 0; i < 5; i++) {
        assert.equal((await login(base, 'jason@example.com', 'wrong password!!', { 'X-Forwarded-For': xff })).status, 401);
    }
}

test('with the default single hop, visitors behind an outer proxy share one limit', async () => {
    const base = startApp();
    await createTestUser('jason@example.com', PASSWORD);
    await failFiveFrom(base, '10.0.0.84, 10.0.2.4');
    const res = await login(base, 'jason@example.com', PASSWORD, { 'X-Forwarded-For': '10.0.0.99, 10.0.2.4' });
    assert.equal(res.status, 429, 'another device behind the same proxy is locked out too');
});

test('TRUST_PROXY_HOPS=2 gives each visitor behind an outer proxy its own limit', async () => {
    const base = startApp({ TRUST_PROXY_HOPS: '2' });
    await createTestUser('jason@example.com', PASSWORD);
    await failFiveFrom(base, '10.0.0.84, 10.0.2.4');
    assert.equal((await login(base, 'jason@example.com', PASSWORD, { 'X-Forwarded-For': '10.0.0.84, 10.0.2.4' })).status, 429);
    assert.equal((await login(base, 'jason@example.com', PASSWORD, { 'X-Forwarded-For': '10.0.0.99, 10.0.2.4' })).status, 200);
});

// ─── scripts/reset-password.js ───────────────────────────────────────────────

function runResetScript(input) {
    return new Promise((resolve) => {
        const child = execFile(process.execPath, ['scripts/reset-password.js'], { cwd: SERVER_DIR, env: process.env },
            (err, stdout, stderr) => resolve({ code: err ? err.code ?? 1 : 0, stdout, stderr }));
        child.stdin.end(input);
    });
}

test('reset-password.js sets a new password and signs every session out', async () => {
    const base = startApp();
    const user = await createTestUser('jason@example.com', PASSWORD);
    const res = await login(base, 'jason@example.com', PASSWORD);
    const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    await pool.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, 'h', now() + interval '1 hour')`, [user.id]);

    const out = await runResetScript(`  JASON@Example.com \n${NEW_PASSWORD}\n`);
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /Password updated for jason@example\.com\. 1 signed-in session/);

    assert.equal((await fetch(`${base}/api/plan-settings`, { headers: { Cookie: cookie } })).status, 401, 'old session revoked');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM password_reset_tokens')).rows[0].n, 0);
    assert.equal((await login(base, 'jason@example.com', PASSWORD)).status, 401, 'old password no longer works');
    assert.equal((await login(base, 'jason@example.com', NEW_PASSWORD)).status, 200);
});

test('reset-password.js refuses an unknown email, a missing account and a weak password', async () => {
    let out = await runResetScript(`jason@example.com\n${NEW_PASSWORD}\n`);
    assert.equal(out.code, 1);
    assert.match(out.stderr, /No account exists yet/);

    await createTestUser('jason@example.com', PASSWORD);
    out = await runResetScript(`someone@example.com\n${NEW_PASSWORD}\n`);
    assert.equal(out.code, 1);
    assert.match(out.stderr, /No account with the email "someone@example.com"/);

    const before = (await pool.query('SELECT password_hash FROM users')).rows[0].password_hash;
    out = await runResetScript('jason@example.com\nshort\n');
    assert.equal(out.code, 1);
    assert.equal((await pool.query('SELECT password_hash FROM users')).rows[0].password_hash, before, 'unchanged');
});
