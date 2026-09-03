import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';
import { _setTransportOverride, _clearTransportOverride } from '../src/email/transport.js';

let server, baseUrl, cookies, originalHost, originalFrom;

function createRecordingTransport() {
    const sent = [];
    return { sendMail: async (mailOptions) => { sent.push(mailOptions); return { messageId: 'test' }; }, sent };
}

function csrfHeaders() {
    const csrfToken = cookies.match(/csrf=([^;]+)/)[1];
    return { Cookie: cookies, 'X-CSRF-Token': csrfToken };
}

before(() => {
    const app = createApp();
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    originalHost = process.env.SMTP_HOST;
    originalFrom = process.env.SMTP_FROM;
});

after(async () => {
    server.close();
    await pool.end();
    if (originalHost === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = originalHost;
    if (originalFrom === undefined) delete process.env.SMTP_FROM;
    else process.env.SMTP_FROM = originalFrom;
});

beforeEach(async () => {
    await resetDb();
    delete process.env.SMTP_HOST;
    _clearTransportOverride();
    const user = await createTestUser('notify@example.com');
    const loginRes = await loginTestUser(baseUrl, user.email, user.password);
    cookies = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
});

test('requires a session', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/test-email`, { method: 'POST' });
    assert.equal(res.status, 401);
});

test('returns 503 EMAIL_NOT_CONFIGURED when SMTP is unset', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/test-email`, {
        method: 'POST',
        headers: csrfHeaders()
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error.code, 'EMAIL_NOT_CONFIGURED');
});

test('sends the test email to the logged-in user\'s own address when configured', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_FROM = 'noreply@myfinances.test';
    const transport = createRecordingTransport();
    _setTransportOverride(transport);

    const res = await fetch(`${baseUrl}/api/notifications/test-email`, {
        method: 'POST',
        headers: csrfHeaders()
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { ok: true });
    assert.equal(transport.sent.length, 1);
    assert.equal(transport.sent[0].to, 'notify@example.com');
});

test('returns 502 EMAIL_SEND_FAILED when the transport throws', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_FROM = 'noreply@myfinances.test';
    _setTransportOverride({ sendMail: async () => { throw new Error('boom'); } });

    const res = await fetch(`${baseUrl}/api/notifications/test-email`, {
        method: 'POST',
        headers: csrfHeaders()
    });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.error.code, 'EMAIL_SEND_FAILED');
});

test('rate-limits repeated requests from the same client', async () => {
    const isolatedApp = createApp();
    const isolatedServer = isolatedApp.listen(0);
    const isolatedBaseUrl = `http://127.0.0.1:${isolatedServer.address().port}`;
    try {
        const user = await createTestUser('ratelimit@example.com');
        const loginRes = await loginTestUser(isolatedBaseUrl, user.email, user.password);
        const isolatedCookies = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
        const csrfToken = isolatedCookies.match(/csrf=([^;]+)/)[1];
        const headers = { Cookie: isolatedCookies, 'X-CSRF-Token': csrfToken };

        for (let i = 0; i < 5; i++) {
            await fetch(`${isolatedBaseUrl}/api/notifications/test-email`, { method: 'POST', headers });
        }
        const res = await fetch(`${isolatedBaseUrl}/api/notifications/test-email`, { method: 'POST', headers });
        assert.equal(res.status, 429);
    } finally {
        isolatedServer.close();
    }
});
