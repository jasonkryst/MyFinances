import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';
import { IMPORT_RATE_LIMIT } from '../src/routes/import.js';

// #529: POST /api/import is rate-limited per user. Its own file, so the
// limiter's in-memory counts never throttle import.test.js.

let server, base;

before(async () => {
    server = createApp().listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
    await resetDb();
});

after(async () => {
    server.close();
    await pool.end();
});

async function signIn(email) {
    const user = await createTestUser(email);
    const res = await loginTestUser(base, user.email, user.password);
    assert.equal(res.status, 200);
    const cookies = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    return { Cookie: cookies, 'X-CSRF-Token': cookies.match(/csrf=([^;]+)/)[1], 'Content-Type': 'application/json' };
}

const postImport = (headers, body) => fetch(`${base}/api/import`, { method: 'POST', headers, body: JSON.stringify(body) });

test('the limit counts per user: past it a user gets 429, another user is unaffected', async () => {
    const first = await signIn('first@example.com');
    // Cheap requests (a bad mode answers 400) still count against the limit.
    for (let i = 0; i < IMPORT_RATE_LIMIT.max; i++) {
        const res = await postImport(first, { mode: 'bogus', data: {} });
        assert.equal(res.status, 400, `request ${i + 1} is within the limit`);
        await res.body?.cancel();
    }
    const limited = await postImport(first, { mode: 'replace', data: {} });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error.code, 'RATE_LIMITED');

    const second = await signIn('second@example.com');
    const ok = await postImport(second, { mode: 'replace', data: {} });
    assert.equal(ok.status, 200);
    await ok.json();
});

test('the limit leaves room for one import per test in the Playwright harness', () => {
    assert.ok(IMPORT_RATE_LIMIT.max >= 100);
    assert.equal(IMPORT_RATE_LIMIT.windowMs, 60 * 1000);
});
