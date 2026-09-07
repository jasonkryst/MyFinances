import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';

// plan_history has no accountId foreign key, unlike every resource covered by
// crudResources.test.js's shared table-driven loop (which always exercises an
// accountId-IDOR check) -- so it gets its own focused suite instead of being
// forced into that loop.

let server, baseUrl, cookies;

before(() => {
    const app = createApp();
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    server.close();
    await pool.end();
});

beforeEach(async () => {
    await resetDb();
    const user = await createTestUser();
    const loginRes = await loginTestUser(baseUrl, user.email, user.password);
    cookies = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
});

function csrfHeaders() {
    const csrfToken = cookies.match(/csrf=([^;]+)/)[1];
    return { 'Content-Type': 'application/json', Cookie: cookies, 'X-CSRF-Token': csrfToken };
}

function validPayload() {
    return {
        monthlyPayment: 500,
        strategy: 'avalanche',
        totalInterest: 1200,
        monthsToPayOff: 24,
        payoffDate: '2028-08-01',
        totalDebt: 10000
    };
}

test('/api/plan-history: create, list, update, delete round trip', async () => {
    const createRes = await fetch(`${baseUrl}/api/plan-history`, {
        method: 'POST', headers: csrfHeaders(), body: JSON.stringify(validPayload())
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.ok(created.id);
    assert.equal(created.strategy, 'avalanche');

    const list = await (await fetch(`${baseUrl}/api/plan-history`, { headers: { Cookie: cookies } })).json();
    assert.equal(list.length, 1);

    const updateRes = await fetch(`${baseUrl}/api/plan-history/${created.id}`, {
        method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify({ totalInterest: 1000 })
    });
    assert.equal(updateRes.status, 200);
    assert.equal((await updateRes.json()).totalInterest, 1000);

    const deleteRes = await fetch(`${baseUrl}/api/plan-history/${created.id}`, { method: 'DELETE', headers: csrfHeaders() });
    assert.equal(deleteRes.status, 204);

    const listAfter = await (await fetch(`${baseUrl}/api/plan-history`, { headers: { Cookie: cookies } })).json();
    assert.equal(listAfter.length, 0);
});

test('/api/plan-history: rejects payload missing strategy', async () => {
    const res = await fetch(`${baseUrl}/api/plan-history`, {
        method: 'POST', headers: csrfHeaders(), body: JSON.stringify({ monthlyPayment: 500 })
    });
    assert.equal(res.status, 400);
});

test('/api/plan-history: cannot see or delete another user\'s rows', async () => {
    const created = await (await fetch(`${baseUrl}/api/plan-history`, {
        method: 'POST', headers: csrfHeaders(), body: JSON.stringify(validPayload())
    })).json();

    const otherUser = await createTestUser('other@example.com', 'another correct horse battery');
    const otherLoginRes = await loginTestUser(baseUrl, otherUser.email, otherUser.password);
    const otherCookies = otherLoginRes.headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
    const otherCsrf = otherCookies.match(/csrf=([^;]+)/)[1];

    const list = await (await fetch(`${baseUrl}/api/plan-history`, { headers: { Cookie: otherCookies } })).json();
    assert.equal(list.length, 0);

    const deleteRes = await fetch(`${baseUrl}/api/plan-history/${created.id}`, {
        method: 'DELETE',
        headers: { Cookie: otherCookies, 'X-CSRF-Token': otherCsrf }
    });
    assert.equal(deleteRes.status, 404);
});

test('/api/plan-history: delete all removes all user rows and returns 204', async () => {
    await fetch(`${baseUrl}/api/plan-history`, { method: 'POST', headers: csrfHeaders(), body: JSON.stringify(validPayload()) });
    await fetch(`${baseUrl}/api/plan-history`, { method: 'POST', headers: csrfHeaders(), body: JSON.stringify(validPayload()) });

    const res = await fetch(`${baseUrl}/api/plan-history`, { method: 'DELETE', headers: csrfHeaders() });
    assert.equal(res.status, 204);

    const list = await (await fetch(`${baseUrl}/api/plan-history`, { headers: { Cookie: cookies } })).json();
    assert.equal(list.length, 0);
});

test('/api/plan-history: requires auth', async () => {
    const res = await fetch(`${baseUrl}/api/plan-history`);
    assert.equal(res.status, 401);
});
