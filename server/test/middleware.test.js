import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser } from './helpers/testDb.js';
import { createSession } from '../src/auth/sessions.js';
import { generateToken, hashToken } from '../src/auth/middleware.js';

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

test('rejects requests with no session cookie', async () => {
    const res = await fetch(`${baseUrl}/health/session-check`);
    assert.equal(res.status, 401);
});

test('accepts a valid session cookie and attaches userId', async () => {
    const user = await createTestUser();
    const session = await createSession(user.id);
    const res = await fetch(`${baseUrl}/health/session-check`, {
        headers: { Cookie: `session=${session.id}` }
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).userId, user.id);
});

test('rejects an expired session', async () => {
    const user = await createTestUser();
    const expiredToken = generateToken();
    await pool.query(
        "INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, now() - interval '1 minute')",
        [hashToken(expiredToken), user.id]
    );
    const res = await fetch(`${baseUrl}/health/session-check`, {
        headers: { Cookie: `session=${expiredToken}` }
    });
    assert.equal(res.status, 401);
});

test('rejects a mutating request missing the CSRF header', async () => {
    const user = await createTestUser();
    const session = await createSession(user.id);
    const res = await fetch(`${baseUrl}/health/session-check`, {
        method: 'POST',
        headers: { Cookie: `session=${session.id}; csrf=abc` }
    });
    assert.equal(res.status, 403);
});

test('accepts a mutating request with matching CSRF cookie and header', async () => {
    const user = await createTestUser();
    const session = await createSession(user.id);
    const res = await fetch(`${baseUrl}/health/session-check`, {
        method: 'POST',
        headers: { Cookie: `session=${session.id}; csrf=abc`, 'X-CSRF-Token': 'abc' }
    });
    assert.equal(res.status, 200);
});
