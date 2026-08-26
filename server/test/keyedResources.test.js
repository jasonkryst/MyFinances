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

test('net-worth-snapshots: PUT upserts by date, GET lists, DELETE removes', async () => {
    const putRes = await fetch(`${baseUrl}/api/net-worth-snapshots/2026-08-01`, {
        method: 'PUT', headers: csrfHeaders(),
        body: JSON.stringify({ totalAssets: 5000, totalLiabilities: 2000, netWorth: 3000, source: 'manual' })
    });
    assert.equal(putRes.status, 200);
    assert.equal((await putRes.json()).netWorth, 3000);

    const putAgain = await fetch(`${baseUrl}/api/net-worth-snapshots/2026-08-01`, {
        method: 'PUT', headers: csrfHeaders(),
        body: JSON.stringify({ totalAssets: 6000, totalLiabilities: 2000, netWorth: 4000, source: 'manual' })
    });
    assert.equal((await putAgain.json()).netWorth, 4000);

    const list = await (await fetch(`${baseUrl}/api/net-worth-snapshots`, { headers: { Cookie: cookies } })).json();
    assert.equal(list.length, 1);

    const del = await fetch(`${baseUrl}/api/net-worth-snapshots/2026-08-01`, { method: 'DELETE', headers: csrfHeaders() });
    assert.equal(del.status, 204);
});

test('settings: PUT upserts by key with a JSON value', async () => {
    const res = await fetch(`${baseUrl}/api/settings/theme`, {
        method: 'PUT', headers: csrfHeaders(), body: JSON.stringify({ value: 'dark' })
    });
    assert.equal(res.status, 200);
    const list = await (await fetch(`${baseUrl}/api/settings`, { headers: { Cookie: cookies } })).json();
    assert.equal(list[0].value, 'dark');
});

test('settings: rejects an unsupported value type', async () => {
    const res = await fetch(`${baseUrl}/api/settings/theme`, {
        method: 'PUT', headers: csrfHeaders(), body: JSON.stringify({ value: { nested: true } })
    });
    assert.equal(res.status, 400);
});

test('ledger-overrides: PUT upserts a compound-key entry', async () => {
    const key = encodeURIComponent('debt|123|4|2026-08-01');
    const res = await fetch(`${baseUrl}/api/ledger-overrides/${key}`, {
        method: 'PUT', headers: csrfHeaders(), body: JSON.stringify({ amount: 250.5, transactionName: 'Extra payment' })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.amount, 250.5);
    assert.equal(body.transactionName, 'Extra payment');
});

test('ledger-overrides: rejects a non-finite amount', async () => {
    const key = encodeURIComponent('debt|123|4|2026-08-01');
    const res = await fetch(`${baseUrl}/api/ledger-overrides/${key}`, {
        method: 'PUT', headers: csrfHeaders(), body: JSON.stringify({ transactionName: 'no amount' })
    });
    assert.equal(res.status, 400);
});

test('ledger-overrides: rejects an accountId belonging to another user (IDOR)', async () => {
    const otherUser = await createTestUser('idor-owner@example.com', 'another correct horse battery');
    const otherLoginRes = await loginTestUser(baseUrl, otherUser.email, otherUser.password);
    const otherCookies = otherLoginRes.headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
    const otherCsrf = otherCookies.match(/csrf=([^;]+)/)[1];
    const otherAccountRes = await fetch(`${baseUrl}/api/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: otherCookies, 'X-CSRF-Token': otherCsrf },
        body: JSON.stringify({ name: 'Their Account', type: 'checking', startingBalance: 0, interestRate: 0 })
    });
    const otherAccountId = (await otherAccountRes.json()).id;

    const key = encodeURIComponent('debt|123|4|2026-08-01');
    const res = await fetch(`${baseUrl}/api/ledger-overrides/${key}`, {
        method: 'PUT', headers: csrfHeaders(),
        body: JSON.stringify({ amount: 50, accountId: otherAccountId })
    });
    assert.equal(res.status, 400);
});

test('net-worth-snapshots: delete all removes all user rows and returns 204', async () => {
    await fetch(`${baseUrl}/api/net-worth-snapshots/2026-01-01`, {
        method: 'PUT', headers: csrfHeaders(),
        body: JSON.stringify({ totalAssets: 1000, totalLiabilities: 500, netWorth: 500, source: 'auto' })
    });

    const res = await fetch(`${baseUrl}/api/net-worth-snapshots`, { method: 'DELETE', headers: csrfHeaders() });
    assert.equal(res.status, 204);

    const list = await (await fetch(`${baseUrl}/api/net-worth-snapshots`, { headers: { Cookie: cookies } })).json();
    assert.equal(list.length, 0);
});

test('net-worth-snapshots: delete all returns 401 without auth', async () => {
    const res = await fetch(`${baseUrl}/api/net-worth-snapshots`, { method: 'DELETE' });
    assert.equal(res.status, 401);
});
