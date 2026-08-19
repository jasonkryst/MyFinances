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

let accountId;

beforeEach(async () => {
    await resetDb();
    const user = await createTestUser();
    const loginRes = await loginTestUser(baseUrl, user.email, user.password);
    cookies = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const acctRes = await fetch(`${baseUrl}/api/accounts`, {
        method: 'POST',
        headers: csrfHeaders(),
        body: JSON.stringify({ name: 'Checking', type: 'checking', startingBalance: 100, interestRate: 0 })
    });
    accountId = (await acctRes.json()).id;
});

function csrfHeaders() {
    const csrfToken = cookies.match(/csrf=([^;]+)/)[1];
    return { 'Content-Type': 'application/json', Cookie: cookies, 'X-CSRF-Token': csrfToken };
}

export const cases = [
    {
        path: '/api/bills',
        validPayload: () => ({ name: 'Rent', amount: 1200, dueDay: 1, category: 'Housing', accountId }),
        updatePayload: { amount: 1300 },
        updatedField: 'amount',
        updatedValue: 1300,
        invalidPayload: () => ({ amount: 1200 })
    },
    {
        path: '/api/expenses',
        validPayload: () => ({ name: 'Groceries', budgetAmount: 400, date: '2026-08-01', category: 'Food', accountId }),
        updatePayload: { budgetAmount: 450 },
        updatedField: 'budgetAmount',
        updatedValue: 450,
        invalidPayload: () => ({ budgetAmount: 400 })
    },
    {
        path: '/api/incomes',
        validPayload: () => ({ name: 'Paycheck', amount: 2000, firstPayDate: '2026-08-01', frequency: 'biweekly', accountId }),
        updatePayload: { amount: 2100 },
        updatedField: 'amount',
        updatedValue: 2100,
        invalidPayload: () => ({ amount: 2000 })
    },
    {
        path: '/api/bonuses',
        validPayload: () => ({ name: 'Tax refund', amount: 500, date: '2026-08-01', category: 'Other', accountId, purpose: 'savings' }),
        updatePayload: { amount: 600 },
        updatedField: 'amount',
        updatedValue: 600,
        invalidPayload: () => ({ amount: 500 })
    }
];

for (const c of cases) {
    test(`${c.path}: create, list, update, delete round trip`, async () => {
        const createRes = await fetch(`${baseUrl}${c.path}`, {
            method: 'POST', headers: csrfHeaders(), body: JSON.stringify(c.validPayload())
        });
        assert.equal(createRes.status, 201);
        const created = await createRes.json();
        assert.ok(created.id);

        const list = await (await fetch(`${baseUrl}${c.path}`, { headers: { Cookie: cookies } })).json();
        assert.equal(list.length, 1);

        const updateRes = await fetch(`${baseUrl}${c.path}/${created.id}`, {
            method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify(c.updatePayload)
        });
        assert.equal(updateRes.status, 200);
        assert.equal((await updateRes.json())[c.updatedField], c.updatedValue);

        const deleteRes = await fetch(`${baseUrl}${c.path}/${created.id}`, { method: 'DELETE', headers: csrfHeaders() });
        assert.equal(deleteRes.status, 204);

        const listAfter = await (await fetch(`${baseUrl}${c.path}`, { headers: { Cookie: cookies } })).json();
        assert.equal(listAfter.length, 0);
    });

    test(`${c.path}: rejects payload missing a required field`, async () => {
        const res = await fetch(`${baseUrl}${c.path}`, {
            method: 'POST', headers: csrfHeaders(), body: JSON.stringify(c.invalidPayload())
        });
        assert.equal(res.status, 400);
    });

    test(`${c.path}: cannot see or delete another user's rows`, async () => {
        const created = await (await fetch(`${baseUrl}${c.path}`, {
            method: 'POST', headers: csrfHeaders(), body: JSON.stringify(c.validPayload())
        })).json();

        const otherUser = await createTestUser('other@example.com', 'another correct horse battery');
        const otherLoginRes = await loginTestUser(baseUrl, otherUser.email, otherUser.password);
        const otherCookies = otherLoginRes.headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
        const otherCsrf = otherCookies.match(/csrf=([^;]+)/)[1];

        const list = await (await fetch(`${baseUrl}${c.path}`, { headers: { Cookie: otherCookies } })).json();
        assert.equal(list.length, 0);

        const deleteRes = await fetch(`${baseUrl}${c.path}/${created.id}`, {
            method: 'DELETE',
            headers: { Cookie: otherCookies, 'X-CSRF-Token': otherCsrf }
        });
        assert.equal(deleteRes.status, 404);
    });

    test(`${c.path}: rejects an accountId belonging to another user (IDOR)`, async () => {
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

        const payload = { ...c.validPayload(), accountId: otherAccountId };
        const res = await fetch(`${baseUrl}${c.path}`, {
            method: 'POST', headers: csrfHeaders(), body: JSON.stringify(payload)
        });
        assert.equal(res.status, 400);

        const list = await (await fetch(`${baseUrl}${c.path}`, { headers: { Cookie: cookies } })).json();
        assert.equal(list.length, 0);
    });
}
