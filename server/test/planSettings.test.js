import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';

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

test('GET returns defaults on first access', async () => {
    const res = await fetch(`${baseUrl}/api/plan-settings`, { headers: { Cookie: cookies } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.strategy, null);
    assert.deepEqual(body.ledgerSettings, { accountFilter: 'all', dateRange: 'all', sortKey: 'date', sortDir: 'desc' });
    assert.deepEqual(body.netWorthMilestonesAwarded, []);
});

test('PATCH updates only the fields provided', async () => {
    await fetch(`${baseUrl}/api/plan-settings`, {
        method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify({ strategy: 'avalanche', monthlyPayment: 500 })
    });
    const res = await fetch(`${baseUrl}/api/plan-settings`, {
        method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify({ monthlyPayment: 600 })
    });
    const body = await res.json();
    assert.equal(body.strategy, 'avalanche');
    assert.equal(body.monthlyPayment, 600);
});

test('POST /milestones appends a milestone and ignores duplicates', async () => {
    const first = await fetch(`${baseUrl}/api/plan-settings/milestones`, {
        method: 'POST', headers: csrfHeaders(), body: JSON.stringify({ milestone: 10000 })
    });
    assert.equal(first.status, 201);

    await fetch(`${baseUrl}/api/plan-settings/milestones`, {
        method: 'POST', headers: csrfHeaders(), body: JSON.stringify({ milestone: 10000 })
    });

    const res = await fetch(`${baseUrl}/api/plan-settings`, { headers: { Cookie: cookies } });
    const body = await res.json();
    assert.deepEqual(body.netWorthMilestonesAwarded, [10000]);
});

test('POST /milestones rejects a milestone below 5000', async () => {
    const res = await fetch(`${baseUrl}/api/plan-settings/milestones`, {
        method: 'POST', headers: csrfHeaders(), body: JSON.stringify({ milestone: 100 })
    });
    assert.equal(res.status, 400);
});
