import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, errorHandler } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';

let server, baseUrl, cookies, user;

function csrfHeaders() {
    const csrfToken = cookies.match(/csrf=([^;]+)/)[1];
    return { Cookie: cookies, 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' };
}

async function captureErrors(fn) {
    const logged = [];
    const original = console.error;
    console.error = (...args) => { logged.push(args); };
    try { await fn(); } finally { console.error = original; }
    return logged;
}

before(() => {
    server = createApp().listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    server.close();
    await pool.end();
});

beforeEach(async () => {
    await resetDb();
    user = await createTestUser('clienterr@example.com');
    const loginRes = await loginTestUser(baseUrl, user.email, user.password);
    cookies = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
});

test('malformed JSON to /auth/login is 400 BAD_REQUEST and logs no stack', async () => {
    const logged = await captureErrors(async () => {
        const res = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{"email": '
        });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.deepEqual(body, { error: { code: 'BAD_REQUEST', message: 'Bad request' } });
    });
    assert.equal(logged.length, 0);
});

test('malformed JSON to an authenticated /api route is 400', async () => {
    const logged = await captureErrors(async () => {
        const res = await fetch(`${baseUrl}/api/plan-settings`, {
            method: 'PATCH',
            headers: csrfHeaders(),
            body: '{not json'
        });
        assert.equal(res.status, 400);
        assert.equal((await res.json()).error.code, 'BAD_REQUEST');
    });
    assert.equal(logged.length, 0);
});

test('body over 1mb is 413 PAYLOAD_TOO_LARGE', async () => {
    const logged = await captureErrors(async () => {
        const res = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'a@b.c', password: 'x'.repeat(1.2 * 1024 * 1024) })
        });
        assert.equal(res.status, 413);
        const body = await res.json();
        assert.equal(body.error.code, 'PAYLOAD_TOO_LARGE');
    });
    assert.equal(logged.length, 0);
});

test('a valid request still works', async () => {
    const res = await fetch(`${baseUrl}/api/plan-settings`, { headers: { Cookie: cookies } });
    assert.equal(res.status, 200);
    const bad = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, password: 'wrong password entirely' })
    });
    assert.equal(bad.status, 401);
});

function fakeRes() {
    return {
        statusCode: null,
        body: null,
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; }
    };
}

test('errorHandler: 5xx and plain errors stay 500 INTERNAL_ERROR and are logged', async () => {
    const errors = [
        new Error('boom'),
        Object.assign(new Error('x'), { status: 503 }),
        Object.assign(new Error('y'), { status: 'abc' })
    ];
    for (const err of errors) {
        const res = fakeRes();
        const logged = await captureErrors(async () => { errorHandler(err, {}, res, () => {}); });
        assert.equal(res.statusCode, 500);
        assert.equal(res.body.error.code, 'INTERNAL_ERROR');
        assert.equal(logged.length, 1);
    }
});

test('errorHandler: 4xx via status or statusCode is not logged and never echoes the message', async () => {
    const cases = [
        [{ status: 400 }, 400, 'BAD_REQUEST'],
        [{ statusCode: 413 }, 413, 'PAYLOAD_TOO_LARGE'],
        [{ status: 415 }, 415, 'BAD_REQUEST']
    ];
    for (const [props, status, code] of cases) {
        const res = fakeRes();
        const err = Object.assign(new Error('secret body text'), props);
        const logged = await captureErrors(async () => { errorHandler(err, {}, res, () => {}); });
        assert.equal(res.statusCode, status);
        assert.equal(res.body.error.code, code);
        assert.ok(!JSON.stringify(res.body).includes('secret'));
        assert.equal(logged.length, 0);
    }
});
