import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';
import { _setTransportOverride, _clearTransportOverride } from '../src/email/transport.js';

let server, baseUrl;

before(() => {
    const app = createApp();
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    server.close();
    await pool.end();
});

beforeEach(() => resetDb());

test('login with correct credentials sets session and csrf cookies', async () => {
    const user = await createTestUser();
    const res = await loginTestUser(baseUrl, user.email, user.password);
    assert.equal(res.status, 200);
    const cookies = res.headers.getSetCookie();
    assert.ok(cookies.some(c => c.startsWith('session=')));
    assert.ok(cookies.some(c => c.startsWith('csrf=')));
});

test('login over plain HTTP (no X-Forwarded-Proto) does not mark cookies Secure', async () => {
    const user = await createTestUser();
    const res = await loginTestUser(baseUrl, user.email, user.password);
    const cookies = res.headers.getSetCookie();
    assert.ok(cookies.length > 0);
    for (const c of cookies) assert.ok(!/;\s*Secure/i.test(c), `expected no Secure flag on: ${c}`);
});

test('login behind a proxy that terminated HTTPS (X-Forwarded-Proto: https) marks cookies Secure', async () => {
    // `trust proxy` (server/src/app.js) is what makes Express honor this
    // header for req.secure instead of ignoring it -- this is the fix for
    // docs/audit/security/SECURITY_AUDIT_2026-09-02.md's NODE_ENV addendum:
    // Secure is now derived per-request, not from a static NODE_ENV flag
    // that had to be flipped manually and in the right order relative to
    // when HTTPS actually went live.
    const user = await createTestUser();
    const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
        body: JSON.stringify({ email: user.email, password: user.password })
    });
    assert.equal(res.status, 200);
    const cookies = res.headers.getSetCookie();
    assert.ok(cookies.some(c => c.startsWith('session=') && /;\s*Secure/i.test(c)));
    assert.ok(cookies.some(c => c.startsWith('csrf=') && /;\s*Secure/i.test(c)));
});

test('login with wrong password returns generic 401', async () => {
    const user = await createTestUser();
    const res = await loginTestUser(baseUrl, user.email, 'totally wrong password');
    assert.equal(res.status, 401);
});

test('login with unknown email returns the same generic 401', async () => {
    const res = await loginTestUser(baseUrl, 'nobody@example.com', 'whatever password here');
    assert.equal(res.status, 401);
});

test('6th login attempt within 15 minutes is rate limited', async () => {
    // Uses its own app/server instance: express-rate-limit's in-memory store
    // is per-app, and sharing the file-level `baseUrl` app would leak this
    // test's request count into every other test's login calls (all from
    // the same 127.0.0.1 IP).
    const isolatedApp = createApp();
    const isolatedServer = isolatedApp.listen(0);
    const isolatedBaseUrl = `http://127.0.0.1:${isolatedServer.address().port}`;
    try {
        const user = await createTestUser();
        for (let i = 0; i < 5; i++) {
            await loginTestUser(isolatedBaseUrl, user.email, 'wrong password each time');
        }
        const res = await loginTestUser(isolatedBaseUrl, user.email, 'wrong password each time');
        assert.equal(res.status, 429);
    } finally {
        isolatedServer.close();
    }
});

test('logout invalidates the session immediately', async () => {
    const user = await createTestUser();
    const loginRes = await loginTestUser(baseUrl, user.email, user.password);
    assert.equal(loginRes.status, 200);
    const cookies = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const csrfToken = cookies.match(/csrf=([^;]+)/)[1];

    const logoutRes = await fetch(`${baseUrl}/auth/logout`, {
        method: 'POST',
        headers: { Cookie: cookies, 'X-CSRF-Token': csrfToken }
    });
    assert.equal(logoutRes.status, 200);

    const probeRes = await fetch(`${baseUrl}/health/session-check`, { headers: { Cookie: cookies } });
    assert.equal(probeRes.status, 401);
});

test('logout without a matching CSRF header is rejected', async () => {
    const user = await createTestUser();
    const loginRes = await loginTestUser(baseUrl, user.email, user.password);
    const cookies = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');

    const logoutRes = await fetch(`${baseUrl}/auth/logout`, { method: 'POST', headers: { Cookie: cookies } });
    assert.equal(logoutRes.status, 403);

    const probeRes = await fetch(`${baseUrl}/health/session-check`, { headers: { Cookie: cookies } });
    assert.equal(probeRes.status, 200);
});

test('register sends a welcome email when SMTP is configured', async () => {
    const originalHost = process.env.SMTP_HOST;
    const originalFrom = process.env.SMTP_FROM;
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_FROM = 'noreply@myfinances.test';
    const sent = [];
    _setTransportOverride({ sendMail: async (mail) => { sent.push(mail); return { messageId: 'test' }; } });

    const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'newuser@example.com', password: 'correct horse battery staple' })
    });
    assert.equal(res.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'newuser@example.com');
    assert.equal(sent[0].subject, 'Welcome to MyFinances');

    if (originalHost === undefined) delete process.env.SMTP_HOST; else process.env.SMTP_HOST = originalHost;
    if (originalFrom === undefined) delete process.env.SMTP_FROM; else process.env.SMTP_FROM = originalFrom;
    _clearTransportOverride();
});

test('register still succeeds when SMTP is not configured', async () => {
    delete process.env.SMTP_HOST;
    _clearTransportOverride();
    const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'anotheruser@example.com', password: 'correct horse battery staple' })
    });
    assert.equal(res.status, 200);
    const cookies = res.headers.getSetCookie();
    assert.ok(cookies.some(c => c.startsWith('session=')));
});
