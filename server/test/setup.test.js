import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser } from './helpers/testDb.js';

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

// ---------------------------------------------------------------------------
// GET /auth/setup-status
// ---------------------------------------------------------------------------

test('setup-status returns needsSetup:true when no users exist', async () => {
    const res = await fetch(`${baseUrl}/auth/setup-status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { needsSetup: true });
});

test('setup-status returns needsSetup:false when a user exists', async () => {
    await createTestUser();
    const res = await fetch(`${baseUrl}/auth/setup-status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { needsSetup: false });
});

// ---------------------------------------------------------------------------
// POST /auth/register — happy path
// ---------------------------------------------------------------------------

test('register creates a user and sets session + csrf cookies', async () => {
    const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new@example.com', password: 'correct horse battery staple' })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    const cookies = res.headers.getSetCookie();
    assert.ok(cookies.some(c => c.startsWith('session=')), 'session cookie missing');
    assert.ok(cookies.some(c => c.startsWith('csrf=')), 'csrf cookie missing');
});

test('register auto-logs in: session is immediately usable', async () => {
    const regRes = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new@example.com', password: 'correct horse battery staple' })
    });
    assert.equal(regRes.status, 200);
    const cookies = regRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');

    const probeRes = await fetch(`${baseUrl}/health/session-check`, { headers: { Cookie: cookies } });
    assert.equal(probeRes.status, 200);
});

test('setup-status becomes needsSetup:false after successful register', async () => {
    await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new@example.com', password: 'correct horse battery staple' })
    });
    const res = await fetch(`${baseUrl}/auth/setup-status`);
    const body = await res.json();
    assert.deepEqual(body, { needsSetup: false });
});

// Boundary success — must run before the validation-failure block to avoid
// exhausting the 5-failure rate-limit window on the shared server instance.
test('register succeeds with exactly 12-character password (boundary)', async () => {
    const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new@example.com', password: '12characters' })
    });
    assert.equal(res.status, 200);
});

// ---------------------------------------------------------------------------
// POST /auth/register — validation failures (5 max before limit, no conflict)
// ---------------------------------------------------------------------------

test('register returns 400 when email is missing', async () => {
    const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'correct horse battery staple' })
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'VALIDATION_FAILED');
});

test('register returns 400 when password is missing', async () => {
    const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new@example.com' })
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'VALIDATION_FAILED');
});

test('register returns 400 for email without @', async () => {
    const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'notanemail', password: 'correct horse battery staple' })
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'VALIDATION_FAILED');
});

test('register returns 400 when password is shorter than 12 characters', async () => {
    const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new@example.com', password: 'tooshort' })
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'VALIDATION_FAILED');
});

test('register returns 400 for exactly 11-character password (boundary)', async () => {
    const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new@example.com', password: '11charszzzz' })
    });
    assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// POST /auth/register — conflict guard (isolated apps to avoid rate-limit bleed)
// ---------------------------------------------------------------------------

test('register returns 409 when a user already exists', async () => {
    const isolatedApp = createApp();
    const isolatedServer = isolatedApp.listen(0);
    const isolatedBaseUrl = `http://127.0.0.1:${isolatedServer.address().port}`;
    try {
        await createTestUser();
        const res = await fetch(`${isolatedBaseUrl}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'second@example.com', password: 'correct horse battery staple' })
        });
        assert.equal(res.status, 409);
        const body = await res.json();
        assert.equal(body.error.code, 'SETUP_COMPLETE');
    } finally {
        isolatedServer.close();
    }
});

test('second register call after first succeeds returns 409', async () => {
    const isolatedApp = createApp();
    const isolatedServer = isolatedApp.listen(0);
    const isolatedBaseUrl = `http://127.0.0.1:${isolatedServer.address().port}`;
    try {
        const first = await fetch(`${isolatedBaseUrl}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'new@example.com', password: 'correct horse battery staple' })
        });
        assert.equal(first.status, 200);

        const second = await fetch(`${isolatedBaseUrl}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'another@example.com', password: 'correct horse battery staple' })
        });
        assert.equal(second.status, 409);
    } finally {
        isolatedServer.close();
    }
});

// ---------------------------------------------------------------------------
// Rate limiting (isolated apps so counters never bleed into other tests)
// ---------------------------------------------------------------------------

test('6th register attempt within 15 minutes is rate limited', async () => {
    const isolatedApp = createApp();
    const isolatedServer = isolatedApp.listen(0);
    const isolatedBaseUrl = `http://127.0.0.1:${isolatedServer.address().port}`;
    try {
        for (let i = 0; i < 5; i++) {
            await fetch(`${isolatedBaseUrl}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: `a${i}@example.com`, password: 'tooshortzzz' })
            });
        }
        const res = await fetch(`${isolatedBaseUrl}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'new@example.com', password: 'tooshortzzz' })
        });
        assert.equal(res.status, 429);
    } finally {
        isolatedServer.close();
    }
});

test('21st setup-status call within 15 minutes is rate limited', async () => {
    const isolatedApp = createApp();
    const isolatedServer = isolatedApp.listen(0);
    const isolatedBaseUrl = `http://127.0.0.1:${isolatedServer.address().port}`;
    try {
        for (let i = 0; i < 20; i++) {
            await fetch(`${isolatedBaseUrl}/auth/setup-status`);
        }
        const res = await fetch(`${isolatedBaseUrl}/auth/setup-status`);
        assert.equal(res.status, 429);
    } finally {
        isolatedServer.close();
    }
});
