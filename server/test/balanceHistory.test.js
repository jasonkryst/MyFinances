import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';

let server, baseUrl, cookies, accountId, debtId;

before(() => {
    server = createApp().listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    server.close();
    await pool.end();
});

function headers() {
    const csrfToken = cookies.match(/csrf=([^;]+)/)[1];
    return { 'Content-Type': 'application/json', Cookie: cookies, 'X-CSRF-Token': csrfToken };
}

async function post(path, body) {
    return fetch(`${baseUrl}${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
}

async function list(path) {
    return (await fetch(`${baseUrl}${path}`, { headers: { Cookie: cookies } })).json();
}

beforeEach(async () => {
    await resetDb();
    const user = await createTestUser();
    const loginRes = await loginTestUser(baseUrl, user.email, user.password);
    cookies = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    accountId = (await (await post('/api/accounts', { name: 'Visa', type: 'Credit Card', startingBalance: -100, minimumPayment: 35 })).json()).id;
    debtId = (await (await post('/api/debts', { name: 'Visa Debt', debtType: 'creditCard', accountBalance: 100, minimumPayment: 10, interestRate: 20, dueDate: 1 })).json()).id;
});

test('account minimumPayment round-trips', async () => {
    const accounts = await list('/api/accounts');
    assert.equal(accounts[0].minimumPayment, 35);
});

test('debt-owned entry with null balance (fixed amount) is stored', async () => {
    const res = await post('/api/balance-history', { debtId, date: '2026-01-01', balance: null, minimumPayment: 800 });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.debtId, debtId);
    assert.equal(body.accountId, null);
    assert.equal(body.balance, null);
    assert.equal(body.minimumPayment, 800);
    assert.equal(body.date, '2026-01-01');
});

test('rejects both owners and neither owner with 400 (not 500)', async () => {
    const both = await post('/api/balance-history', { debtId, accountId, date: '2026-01-01' });
    assert.equal(both.status, 400);
    const neither = await post('/api/balance-history', { date: '2026-01-01' });
    assert.equal(neither.status, 400);
});

test('PATCH that would clear the date is rejected with 400', async () => {
    const created = await (await post('/api/balance-history', { accountId, date: '2026-01-01', balance: -1 })).json();
    const res = await fetch(`${baseUrl}/api/balance-history/${created.id}`, {
        method: 'PATCH', headers: headers(), body: JSON.stringify({ date: 'garbage' })
    });
    assert.equal(res.status, 400);
});

test('deleting a debt cascades its history; deleting an account cascades its history', async () => {
    await post('/api/balance-history', { debtId, date: '2026-01-01', balance: 1 });
    await post('/api/balance-history', { accountId, date: '2026-01-01', balance: -1 });
    assert.equal((await list('/api/balance-history')).length, 2);

    await fetch(`${baseUrl}/api/debts/${debtId}`, { method: 'DELETE', headers: headers() });
    const afterDebt = await list('/api/balance-history');
    assert.equal(afterDebt.length, 1);
    assert.equal(afterDebt[0].accountId, accountId);

    await fetch(`${baseUrl}/api/accounts/${accountId}`, { method: 'DELETE', headers: headers() });
    assert.equal((await list('/api/balance-history')).length, 0);
});

test('rejects a debtId belonging to another user (IDOR)', async () => {
    const other = await createTestUser('other@example.com', 'another correct horse battery');
    const otherLogin = await loginTestUser(baseUrl, other.email, other.password);
    const otherCookies = otherLogin.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const otherCsrf = otherCookies.match(/csrf=([^;]+)/)[1];
    const res = await fetch(`${baseUrl}/api/balance-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: otherCookies, 'X-CSRF-Token': otherCsrf },
        body: JSON.stringify({ debtId, date: '2026-01-01', balance: 1 })
    });
    assert.equal(res.status, 400);
});
