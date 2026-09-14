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

// Express 5 compatibility guards (issue #141).
// Three behavioral shifts between Express 4→5 that are present in this app
// but expected to be safe: req.query getter-only, path-to-regexp v8 strictness,
// and the 4-argument error-handler convention.

test('Express 5 compat: GET with query string is routed correctly (req.query readable)', async () => {
    // path-to-regexp v8 still passes query strings to handlers.
    // Express 5 made req.query a getter-only property — reading it is unchanged,
    // and this app never writes it, so no silent mutation becomes a thrown error.
    const res = await fetch(`${baseUrl}/health?_v=1&foo=bar`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
});

test('Express 5 compat: static route does not match deeper paths (path-to-regexp v8 strictness)', async () => {
    // In path-to-regexp v8 (Express 5), GET /health only matches exactly /health.
    // /health/extra should fall through to the catchall 404 handler.
    // In Express 4 this was already the behavior; guard that v5 keeps it.
    const res = await fetch(`${baseUrl}/health/extra`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.code, 'NOT_FOUND');
});

test('Express 5 compat: unmatched /auth/* sub-path returns 404 (param route strictness)', async () => {
    // None of the auth routes match /auth/nonexistent-path — confirms path-to-regexp
    // v8 does not over-match prefixed routers mounted with app.use('/auth', ...).
    const res = await fetch(`${baseUrl}/auth/nonexistent-path-xyz`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.code, 'NOT_FOUND');
});
