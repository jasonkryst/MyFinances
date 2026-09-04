import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

let server, baseUrl;

before(() => {
    const app = createApp();
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('GET /health returns 200 ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
});

test('unknown route returns 404 JSON', async () => {
    const res = await fetch(`${baseUrl}/nope`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.code, 'NOT_FOUND');
});

test('trust proxy is set to trust exactly one hop', async () => {
    // docs/audit/database/DATABASE_AUDIT_2026-09-02.md M1: without this,
    // express-rate-limit keys off nginx's container IP for every client, and
    // req.secure ignores nginx's X-Forwarded-Proto header (see auth.test.js's
    // Secure-cookie tests, which depend on this being set).
    const app = createApp();
    assert.equal(app.get('trust proxy'), 1);
});
