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
let accountId2;

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
    // A second account, for resources with two account FKs (/api/transfers).
    const acctRes2 = await fetch(`${baseUrl}/api/accounts`, {
        method: 'POST',
        headers: csrfHeaders(),
        body: JSON.stringify({ name: 'Savings', type: 'savings', startingBalance: 500, interestRate: 0 })
    });
    accountId2 = (await acctRes2.json()).id;
});

function csrfHeaders() {
    const csrfToken = cookies.match(/csrf=([^;]+)/)[1];
    return { 'Content-Type': 'application/json', Cookie: cookies, 'X-CSRF-Token': csrfToken };
}

export const cases = [
    {
        path: '/api/manual-transactions',
        validPayload: () => ({ name: 'Coffee', amount: -4.5, date: '2026-08-03', category: 'Dining', memo: 'with Sam', accountId }),
        updatePayload: { amount: -6 },
        updatedField: 'amount',
        updatedValue: -6,
        invalidPayload: () => ({ name: 'Coffee', amount: -4.5 })
    },
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
    },
    {
        path: '/api/debts',
        validPayload: () => ({ name: 'Visa', category: 'Credit Card', debtType: 'creditCard', accountBalance: 3000, minimumPayment: 75, interestRate: 19.99, accountId }),
        updatePayload: { accountBalance: 2800 },
        updatedField: 'accountBalance',
        updatedValue: 2800,
        invalidPayload: () => ({ accountBalance: 3000 })
    },
    {
        path: '/api/recurring-templates',
        validPayload: () => ({ name: 'Netflix', type: 'subscription', amount: 15.99, frequency: 'monthly', dayOfMonth: 5, category: 'Entertainment', accountId }),
        updatePayload: { amount: 17.99 },
        updatedField: 'amount',
        updatedValue: 17.99,
        invalidPayload: () => ({ amount: 15.99 })
    },
    {
        path: '/api/emergency-funds',
        validPayload: () => ({ accountId, targetAmount: 10000, currentAmount: 2000, monthlyContribution: 200, autoContribute: true }),
        updatePayload: { currentAmount: 2200 },
        updatedField: 'currentAmount',
        updatedValue: 2200,
        invalidPayload: () => ({ targetAmount: 10000 })
    },
    {
        path: '/api/sinking-funds',
        validPayload: () => ({ name: 'Car Repair', allocationMethod: 'fixed', monthlyAllocation: 100, targetAmount: 1200, currentAmount: 0, accountId }),
        updatePayload: { currentAmount: 100 },
        updatedField: 'currentAmount',
        updatedValue: 100,
        invalidPayload: () => ({ monthlyAllocation: 100 })
    },
    {
        path: '/api/reconciliations',
        validPayload: () => ({ accountId, date: '2026-08-01', previousBalance: 100, statementBalance: 95, difference: -5, note: 'ATM fee' }),
        updatePayload: { note: 'ATM fee corrected' },
        updatedField: 'note',
        updatedValue: 'ATM fee corrected',
        invalidPayload: () => ({ date: '2026-08-01' })
    },
    {
        path: '/api/retirement-snapshots',
        validPayload: () => ({ accountId, date: '2026-01-01', balance: 10000, contribution: 300 }),
        updatePayload: { balance: 10500 },
        updatedField: 'balance',
        updatedValue: 10500,
        invalidPayload: () => ({ date: '2026-01-01' })
    },
    {
        path: '/api/balance-history',
        validPayload: () => ({ accountId, date: '2026-01-01', balance: -500, minimumPayment: 25 }),
        updatePayload: { balance: -450 },
        updatedField: 'balance',
        updatedValue: -450,
        invalidPayload: () => ({ date: '2026-01-01' })
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

test('/api/incomes: withholdingPercent persists on create, update, and defaults to 0 when omitted (#251)', async () => {
    const createRes = await fetch(`${baseUrl}/api/incomes`, {
        method: 'POST', headers: csrfHeaders(),
        body: JSON.stringify({ name: 'Paycheck', amount: 2000, firstPayDate: '2026-08-01', frequency: 'biweekly', accountId, withholdingPercent: 22.5 })
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.withholdingPercent, 22.5);

    const updateRes = await fetch(`${baseUrl}/api/incomes/${created.id}`, {
        method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify({ withholdingPercent: 30 })
    });
    assert.equal(updateRes.status, 200);
    assert.equal((await updateRes.json()).withholdingPercent, 30);

    const defaultRes = await fetch(`${baseUrl}/api/incomes`, {
        method: 'POST', headers: csrfHeaders(),
        body: JSON.stringify({ name: 'Paycheck 2', amount: 1500, firstPayDate: '2026-08-01', frequency: 'monthly', accountId })
    });
    assert.equal(defaultRes.status, 201);
    assert.equal((await defaultRes.json()).withholdingPercent, 0);
});

test('/api/debts: delete all removes all user rows and returns 204', async () => {
    await fetch(`${baseUrl}/api/debts`, {
        method: 'POST', headers: csrfHeaders(),
        body: JSON.stringify({ name: 'A', category: 'Credit Card', debtType: 'creditCard', accountBalance: 100, minimumPayment: 10, interestRate: 5, accountId })
    });
    await fetch(`${baseUrl}/api/debts`, {
        method: 'POST', headers: csrfHeaders(),
        body: JSON.stringify({ name: 'B', category: 'Credit Card', debtType: 'creditCard', accountBalance: 200, minimumPayment: 10, interestRate: 5, accountId })
    });

    const res = await fetch(`${baseUrl}/api/debts`, { method: 'DELETE', headers: csrfHeaders() });
    assert.equal(res.status, 204);

    const list = await (await fetch(`${baseUrl}/api/debts`, { headers: { Cookie: cookies } })).json();
    assert.equal(list.length, 0);
});

test('/api/debts: delete all returns 401 without auth', async () => {
    const res = await fetch(`${baseUrl}/api/debts`, { method: 'DELETE' });
    assert.equal(res.status, 401);
});

// /api/transfers (#248) isn't in the shared `cases` harness above because
// its IDOR test hardcodes a single `accountId` field -- transfers has two
// (fromAccountId/toAccountId), so that generic check wouldn't exercise
// either real FK. Dedicated tests cover the same ground explicitly instead.
test('/api/transfers: create, list, update, delete round trip', async () => {
    const createRes = await fetch(`${baseUrl}/api/transfers`, {
        method: 'POST', headers: csrfHeaders(),
        body: JSON.stringify({ fromAccountId: accountId, toAccountId: accountId2, amount: 500, date: '2026-08-01', memo: 'Move to savings' })
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.ok(created.id);
    assert.equal(created.amount, 500);

    const list = await (await fetch(`${baseUrl}/api/transfers`, { headers: { Cookie: cookies } })).json();
    assert.equal(list.length, 1);

    const updateRes = await fetch(`${baseUrl}/api/transfers/${created.id}`, {
        method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify({ amount: 600 })
    });
    assert.equal(updateRes.status, 200);
    assert.equal((await updateRes.json()).amount, 600);

    const deleteRes = await fetch(`${baseUrl}/api/transfers/${created.id}`, { method: 'DELETE', headers: csrfHeaders() });
    assert.equal(deleteRes.status, 204);

    const listAfter = await (await fetch(`${baseUrl}/api/transfers`, { headers: { Cookie: cookies } })).json();
    assert.equal(listAfter.length, 0);
});

test('/api/transfers: rejects payload missing fromAccountId/toAccountId', async () => {
    const res = await fetch(`${baseUrl}/api/transfers`, {
        method: 'POST', headers: csrfHeaders(),
        body: JSON.stringify({ amount: 500, date: '2026-08-01' })
    });
    assert.equal(res.status, 400);
});

test('/api/transfers: cannot see or delete another user\'s rows', async () => {
    const created = await (await fetch(`${baseUrl}/api/transfers`, {
        method: 'POST', headers: csrfHeaders(),
        body: JSON.stringify({ fromAccountId: accountId, toAccountId: accountId2, amount: 500, date: '2026-08-01' })
    })).json();

    const otherUser = await createTestUser('transfer-other@example.com', 'another correct horse battery');
    const otherLoginRes = await loginTestUser(baseUrl, otherUser.email, otherUser.password);
    const otherCookies = otherLoginRes.headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
    const otherCsrf = otherCookies.match(/csrf=([^;]+)/)[1];

    const list = await (await fetch(`${baseUrl}/api/transfers`, { headers: { Cookie: otherCookies } })).json();
    assert.equal(list.length, 0);

    const deleteRes = await fetch(`${baseUrl}/api/transfers/${created.id}`, {
        method: 'DELETE',
        headers: { Cookie: otherCookies, 'X-CSRF-Token': otherCsrf }
    });
    assert.equal(deleteRes.status, 404);
});

test('/api/transfers: rejects a fromAccountId/toAccountId belonging to another user (IDOR)', async () => {
    const otherUser = await createTestUser('transfer-idor@example.com', 'another correct horse battery');
    const otherLoginRes = await loginTestUser(baseUrl, otherUser.email, otherUser.password);
    const otherCookies = otherLoginRes.headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
    const otherCsrf = otherCookies.match(/csrf=([^;]+)/)[1];
    const otherAccountRes = await fetch(`${baseUrl}/api/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: otherCookies, 'X-CSRF-Token': otherCsrf },
        body: JSON.stringify({ name: 'Their Account', type: 'checking', startingBalance: 0, interestRate: 0 })
    });
    const otherAccountId = (await otherAccountRes.json()).id;

    const fromRes = await fetch(`${baseUrl}/api/transfers`, {
        method: 'POST', headers: csrfHeaders(),
        body: JSON.stringify({ fromAccountId: otherAccountId, toAccountId: accountId2, amount: 500, date: '2026-08-01' })
    });
    assert.equal(fromRes.status, 400);

    const toRes = await fetch(`${baseUrl}/api/transfers`, {
        method: 'POST', headers: csrfHeaders(),
        body: JSON.stringify({ fromAccountId: accountId, toAccountId: otherAccountId, amount: 500, date: '2026-08-01' })
    });
    assert.equal(toRes.status, 400);

    const list = await (await fetch(`${baseUrl}/api/transfers`, { headers: { Cookie: cookies } })).json();
    assert.equal(list.length, 0);
});

test("/api/recurring-templates: an 'income' type template round-trips (#252)", async () => {
    const createRes = await fetch(`${baseUrl}/api/recurring-templates`, {
        method: 'POST', headers: csrfHeaders(),
        body: JSON.stringify({ name: 'Retainer', type: 'income', amount: 1500, frequency: 'monthly', dayOfMonth: 1, category: 'Income', accountId })
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.type, 'income');

    const listRes = await fetch(`${baseUrl}/api/recurring-templates`, { headers: csrfHeaders() });
    const rows = await listRes.json();
    const found = rows.find(r => r.id === created.id);
    assert.ok(found, 'income template should be listed');
    assert.equal(found.type, 'income');
    assert.equal(Number(found.amount), 1500);
});

test('/api/debts: ownershipSplit persists as jsonb, defaults to null, and is re-sanitized (#272)', async () => {
    const mk = body => fetch(`${baseUrl}/api/debts`, {
        method: 'POST', headers: csrfHeaders(),
        body: JSON.stringify({ name: 'Mortgage', category: 'Mortgage', debtType: 'creditCard', accountBalance: 1000, minimumPayment: 10, interestRate: 5, accountId, ...body })
    });

    const plain = await (await mk({})).json();
    assert.equal(plain.ownershipSplit, null);

    const created = await (await mk({ personIds: [11, 22], ownershipSplit: { 11: 0.6, 22: 0.4 } })).json();
    assert.deepEqual(created.ownershipSplit, { 11: 0.6, 22: 0.4 });

    // Shares that do not sum to 1 are normalized server-side.
    const normalized = await (await mk({ personIds: [11, 22], ownershipSplit: { 11: 0.25, 22: 0.25 } })).json();
    assert.equal(normalized.ownershipSplit['11'], 0.5);

    // A single owner has no split.
    const single = await (await mk({ personIds: [11], ownershipSplit: { 11: 1 } })).json();
    assert.equal(single.ownershipSplit, null);

    // PATCHing personIds down to one person clears the stored split.
    const patchRes = await fetch(`${baseUrl}/api/debts/${created.id}`, {
        method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify({ personIds: [11] })
    });
    assert.equal((await patchRes.json()).ownershipSplit, null);
});

test('/api/accounts: notes, catchUpEligible and hsaCoverageType round-trip; bad values are re-sanitized (#286, #451)', async () => {
    const mk = body => fetch(`${baseUrl}/api/accounts`, {
        method: 'POST', headers: csrfHeaders(),
        body: JSON.stringify({ name: 'Notes Acct', type: 'Retirement', startingBalance: 100, ...body })
    });

    const plain = await (await mk({})).json();
    assert.equal(plain.notes, '');
    assert.equal(plain.catchUpEligible, false);
    assert.equal(plain.hsaCoverageType, 'selfOnly');

    const created = await (await mk({ notes: 'Call 555-0100\nAsk about fees', catchUpEligible: true, hsaCoverageType: 'family' })).json();
    assert.equal(created.notes, 'Call 555-0100\nAsk about fees');
    assert.equal(created.catchUpEligible, true);
    assert.equal(created.hsaCoverageType, 'family');

    const listed = (await (await fetch(`${baseUrl}/api/accounts`, { headers: csrfHeaders() })).json()).find(a => a.id === created.id);
    assert.equal(listed.notes, 'Call 555-0100\nAsk about fees');
    assert.equal(listed.catchUpEligible, true);
    assert.equal(listed.hsaCoverageType, 'family');

    // Negative: an over-long note is truncated to 500, an unknown coverage type falls back.
    const bad = await (await mk({ notes: 'x'.repeat(900), hsaCoverageType: 'bogus' })).json();
    assert.equal(bad.notes.length, 500);
    assert.equal(bad.hsaCoverageType, 'selfOnly');

    const patchRes = await fetch(`${baseUrl}/api/accounts/${created.id}`, {
        method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify({ notes: '' })
    });
    assert.equal((await patchRes.json()).notes, '');
});

// Manual transactions (#584): the route applies the same validity rule as import.
async function postManual(body) {
    return fetch(`${baseUrl}/api/manual-transactions`, { method: 'POST', headers: csrfHeaders(), body: JSON.stringify(body) });
}

test('/api/manual-transactions: keeps the sign, category and memo', async () => {
    const res = await postManual({ accountId, name: 'Refund', amount: 25.5, date: '2026-08-04', category: 'Shopping', memo: 'returned shoes' });
    assert.equal(res.status, 201);
    const row = await res.json();
    assert.equal(row.amount, 25.5);
    assert.equal(row.date, '2026-08-04');
    assert.equal(row.category, 'Shopping');
    assert.equal(row.memo, 'returned shoes');
    assert.equal(row.rowVersion, 1);
});

for (const [label, body] of [
    ['a zero amount', { name: 'Zero', amount: 0 }],
    ['a non-numeric amount', { name: 'NaN', amount: 'abc' }],
    ['a missing amount', { name: 'None' }],
    ['an amount over 1e9', { name: 'Huge', amount: 2e9 }],
    ['a blank name', { name: '   ', amount: -5 }],
]) {
    test(`/api/manual-transactions: rejects ${label}`, async () => {
        const res = await postManual({ accountId, date: '2026-08-04', ...body });
        assert.equal(res.status, 400);
        const list = await (await fetch(`${baseUrl}/api/manual-transactions`, { headers: { Cookie: cookies } })).json();
        assert.equal(list.length, 0);
    });
}

test('/api/manual-transactions: a PATCH to a zero amount is rejected and nothing changes', async () => {
    const created = await (await postManual({ accountId, name: 'Lunch', amount: -12, date: '2026-08-05' })).json();
    const res = await fetch(`${baseUrl}/api/manual-transactions/${created.id}`, {
        method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify({ amount: 0 })
    });
    assert.equal(res.status, 400);
    const list = await (await fetch(`${baseUrl}/api/manual-transactions`, { headers: { Cookie: cookies } })).json();
    assert.equal(list[0].amount, -12);
});

test('/api/manual-transactions: deleting the account keeps the row with a null account', async () => {
    const created = await (await postManual({ accountId: accountId2, name: 'Gas', amount: -40, date: '2026-08-06' })).json();
    const del = await fetch(`${baseUrl}/api/accounts/${accountId2}`, { method: 'DELETE', headers: csrfHeaders() });
    assert.equal(del.status, 204);
    const list = await (await fetch(`${baseUrl}/api/manual-transactions`, { headers: { Cookie: cookies } })).json();
    assert.equal(list.find(r => r.id === created.id).accountId, null);
});

// #568: transfers, reconciliations and #569 recurring transfers share one
// validity rule with import (isValidTransfer etc.).
async function postJson(path, body) {
    return fetch(`${baseUrl}${path}`, { method: 'POST', headers: csrfHeaders(), body: JSON.stringify(body) });
}
async function patchJson(path, id, body) {
    return fetch(`${baseUrl}${path}/${id}`, { method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify(body) });
}
async function listOf(path) {
    return (await fetch(`${baseUrl}${path}`, { headers: { Cookie: cookies } })).json();
}

for (const [label, body] of [
    ['the same from and to account', () => ({ fromAccountId: accountId, toAccountId: accountId, amount: 50 })],
    ['a zero amount', () => ({ fromAccountId: accountId, toAccountId: accountId2, amount: 0 })],
    ['a negative amount', () => ({ fromAccountId: accountId, toAccountId: accountId2, amount: -50 })],
    ['a missing amount', () => ({ fromAccountId: accountId, toAccountId: accountId2 })],
    ['a non-numeric amount', () => ({ fromAccountId: accountId, toAccountId: accountId2, amount: 'abc' })],
    ['an amount over 1e9', () => ({ fromAccountId: accountId, toAccountId: accountId2, amount: 2e9 })],
]) {
    test(`/api/transfers: rejects ${label}`, async () => {
        const res = await postJson('/api/transfers', { date: '2026-08-01', ...body() });
        assert.equal(res.status, 400);
        assert.equal((await listOf('/api/transfers')).length, 0);
    });
}

test('/api/transfers: a valid transfer is created', async () => {
    const res = await postJson('/api/transfers', { fromAccountId: accountId, toAccountId: accountId2, amount: 25, date: '2026-08-01' });
    assert.equal(res.status, 201);
});

test('/api/transfers: a PATCH into an invalid state is a 400 and the row is unchanged; a memo PATCH is a 200', async () => {
    const created = await (await postJson('/api/transfers', { fromAccountId: accountId, toAccountId: accountId2, amount: 25, date: '2026-08-01' })).json();
    assert.equal((await patchJson('/api/transfers', created.id, { toAccountId: accountId })).status, 400);
    assert.equal((await patchJson('/api/transfers', created.id, { amount: -1 })).status, 400);
    assert.equal((await patchJson('/api/transfers', created.id, { amount: 0 })).status, 400);
    let row = (await listOf('/api/transfers'))[0];
    assert.equal(row.toAccountId, accountId2);
    assert.equal(Number(row.amount), 25);
    const ok = await patchJson('/api/transfers', created.id, { memo: 'rent' });
    assert.equal(ok.status, 200);
    row = (await listOf('/api/transfers'))[0];
    assert.equal(row.memo, 'rent');
});

test('/api/transfers: a legacy invalid row (stored before the rule) can still be PATCHed on its memo', async () => {
    await pool.query('ALTER TABLE transfers DROP CONSTRAINT IF EXISTS transfers_amount_positive_distinct_accounts');
    try {
        const { rows } = await pool.query(
            `INSERT INTO transfers (user_id, from_account_id, to_account_id, amount, date)
             SELECT user_id, id, id, -5, '2026-08-01' FROM accounts WHERE id = $1 RETURNING id`, [accountId]);
        assert.equal((await patchJson('/api/transfers', rows[0].id, { memo: 'still editable' })).status, 200);
        assert.equal((await patchJson('/api/transfers', rows[0].id, { amount: -6 })).status, 400);
    } finally {
        await resetDb();
        await pool.query(`ALTER TABLE transfers ADD CONSTRAINT transfers_amount_positive_distinct_accounts
            CHECK (amount > 0 AND amount <> 'NaN'::numeric AND from_account_id <> to_account_id) NOT VALID`);
    }
});

test('/api/reconciliations: a missing or non-numeric statementBalance is a 400', async () => {
    for (const extra of [{}, { statementBalance: 'abc' }, { statementBalance: null }, { statementBalance: '' }]) {
        const res = await postJson('/api/reconciliations', { accountId, date: '2026-08-01', ...extra });
        assert.equal(res.status, 400, JSON.stringify(extra));
    }
    assert.equal((await listOf('/api/reconciliations')).length, 0);
});

test('/api/reconciliations: valid (including a negative or zero balance) is created; a PATCH to a null balance is a 400', async () => {
    const zero = await postJson('/api/reconciliations', { accountId, date: '2026-08-01', statementBalance: 0 });
    assert.equal(zero.status, 201);
    const neg = await (await postJson('/api/reconciliations', { accountId, date: '2026-08-02', statementBalance: -250.5 })).json();
    assert.equal(Number(neg.statementBalance), -250.5);
    assert.equal((await patchJson('/api/reconciliations', neg.id, { statementBalance: null })).status, 400);
    assert.equal((await patchJson('/api/reconciliations', neg.id, { statementBalance: 'abc' })).status, 400);
    assert.equal(Number((await listOf('/api/reconciliations')).find(r => r.id === neg.id).statementBalance), -250.5);
    assert.equal((await patchJson('/api/reconciliations', neg.id, { note: 'ok' })).status, 200);
});

function transferTemplate(extra) {
    return { name: 'Move', type: 'transfer', amount: 100, frequency: 'monthly', dayOfMonth: 1, accountId, targetAccountId: accountId2, ...extra };
}

for (const [label, extra] of [
    ['no targetAccountId', { targetAccountId: undefined }],
    ['a null targetAccountId', { targetAccountId: null }],
    ['target equal to the account', { targetAccountId: accountId }],
    ['a zero amount', { amount: 0 }],
    ['a missing amount', { amount: undefined }],
]) {
    test(`/api/recurring-templates: a transfer with ${label} is a 400`, async () => {
        const res = await postJson('/api/recurring-templates', transferTemplate(extra));
        assert.equal(res.status, 400);
        assert.equal((await listOf('/api/recurring-templates')).length, 0);
    });
}

test('/api/recurring-templates: a valid transfer is a 201; a $0 subscription and a $0 income stay 201 (zeroAmountPolicy is client-side)', async () => {
    assert.equal((await postJson('/api/recurring-templates', transferTemplate({}))).status, 201);
    assert.equal((await postJson('/api/recurring-templates', { name: 'Free trial', type: 'subscription', amount: 0, frequency: 'monthly', accountId })).status, 201);
    assert.equal((await postJson('/api/recurring-templates', { name: 'Gift', type: 'income', amount: 0, frequency: 'monthly', accountId })).status, 201);
    assert.equal((await postJson('/api/recurring-templates', { name: 'Sub without target', type: 'subscription', amount: 5, accountId })).status, 201);
    assert.equal((await postJson('/api/recurring-templates', { type: 'subscription', amount: 5, accountId })).status, 400);
});

test('/api/recurring-templates: a PATCH that removes a transfer\'s target is a 400; changing it to a subscription is a 200', async () => {
    const created = await (await postJson('/api/recurring-templates', transferTemplate({}))).json();
    assert.equal((await patchJson('/api/recurring-templates', created.id, { targetAccountId: null })).status, 400);
    assert.equal((await patchJson('/api/recurring-templates', created.id, { targetAccountId: accountId })).status, 400);
    assert.equal((await patchJson('/api/recurring-templates', created.id, { amount: 0 })).status, 400);
    assert.equal((await patchJson('/api/recurring-templates', created.id, { type: 'subscription' })).status, 200);
    const row = (await listOf('/api/recurring-templates'))[0];
    assert.equal(row.type, 'subscription');
    assert.equal(row.targetAccountId, accountId2);
});

test('/api/recurring-templates: a legacy targetless transfer template can still be paused', async () => {
    const { rows } = await pool.query(
        `INSERT INTO recurring_templates (user_id, name, type, amount, frequency, account_id)
         SELECT user_id, 'Legacy', 'transfer', 10, 'monthly', id FROM accounts WHERE id = $1 RETURNING id`, [accountId]);
    assert.equal((await patchJson('/api/recurring-templates', rows[0].id, { paused: true })).status, 200);
    assert.equal((await patchJson('/api/recurring-templates', rows[0].id, { amount: 0 })).status, 400);
});
