import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';
import { sanitizeLedgerOverrides } from '../src/sanitizers/index.js';

// Parity guard: every key a frontend sanitize*() emits must have a column in
// the matching route's `columns` map, otherwise Postgres mode silently drops it
// (the browser-storage mode keeps it). A field may only be skipped via
// NOT_PERSISTED, with a reason.
export const NOT_PERSISTED = {
    recurringTemplates: {
        paidAmounts: 'legacy (#434): migrated into ledger overrides by reconcileRecurringPaidState and emptied; never persisted to Postgres'
    }
};

const SAMPLE = {
    accounts: { name: 'A', type: 'Retirement' },
    bills: { name: 'B', amount: 1, dueDay: 1 },
    bonuses: { name: 'B', amount: 1, date: '2026-01-01' },
    debts: { name: 'D', accountBalance: 1 },
    emergencyFunds: { accountId: 1 },
    expenses: { name: 'E', date: '2026-01-01' },
    incomes: { name: 'I', firstPayDate: '2026-01-01' },
    persons: { name: 'P' },
    planHistory: { monthlyPayment: 1, strategy: 'avalanche' },
    reconciliations: { accountId: 1, statementBalance: 1 },
    recurringTemplates: { name: 'R' },
    retirementSnapshots: { accountId: 1 },
    sinkingFunds: { name: 'S' },
    transfers: { fromAccountId: 1, toAccountId: 2, amount: 1 },
    manualTransactions: { accountId: 1, name: 'Coffee', amount: -4.5, category: 'Dining' },
    balanceHistory: { accountId: 1, date: '2026-01-01', balance: 1 },
    ledgerCleared: { clearedAt: '2026-01-01T00:00:00.000Z' },
    netWorthSnapshots: { date: '2026-01-01', totalAssets: 1 }
};

let server, baseUrl, cookies, accountId;

before(() => {
    server = createApp().listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await pool.end(); });

beforeEach(async () => {
    await resetDb();
    const user = await createTestUser();
    const loginRes = await loginTestUser(baseUrl, user.email, user.password);
    cookies = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    accountId = (await (await fetch(`${baseUrl}/api/accounts`, {
        method: 'POST', headers: hdrs(), body: JSON.stringify({ name: 'Checking', type: 'checking' })
    })).json()).id;
});

function hdrs() {
    return { 'Content-Type': 'application/json', Cookie: cookies, 'X-CSRF-Token': cookies.match(/csrf=([^;]+)/)[1] };
}

function checkParity(name, outputKeys, columns) {
    const skip = NOT_PERSISTED[name] || {};
    const missing = outputKeys.filter(k => !(k in columns) && !(k in skip));
    assert.deepEqual(missing, [], `${name}: sanitizer emits fields with no column in the route's columns map: ${missing.join(', ')}`);
    const stale = Object.keys(skip).filter(k => k in columns || !outputKeys.includes(k));
    assert.deepEqual(stale, [], `${name}: NOT_PERSISTED entries that are persisted or no longer emitted: ${stale.join(', ')}`);
}

for (const [name, sample] of Object.entries(SAMPLE)) {
    test(`field parity: ${name} columns cover every sanitizer field`, async () => {
        const file = name.replace(/[A-Z]/g, c => c); // route files are named after the key
        const mod = await import(`../src/routes/${file}.js`);
        const { columns, sanitize } = mod.default.crudConfig;
        // keyed resources pass the key (a date for net-worth snapshots) as the second argument
        const out = sanitize(sample, sample.date || 1);
        assert.ok(out, `${name}: sample was rejected by its sanitizer`);
        checkParity(name, Object.keys(out), columns);
    });
}

test('field parity: ledgerOverrides columns cover every field of sanitizeLedgerOverrides entries', async () => {
    const mod = await import('../src/routes/ledgerOverrides.js');
    const entry = sanitizeLedgerOverrides({ k: { amount: 1 } }).k;
    checkParity('ledgerOverrides', Object.keys(entry), { overrideKey: 'override_key', ...mod.default.crudConfig.columns });
});

async function roundTrip(path, body, expected) {
    const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: hdrs(), body: JSON.stringify(body) });
    assert.equal(res.status, 201);
    const created = await res.json();
    const list = await (await fetch(`${baseUrl}${path}`, { headers: { Cookie: cookies } })).json();
    const row = list.find(r => r.id === created.id);
    for (const [k, v] of Object.entries(expected)) assert.deepEqual(row[k], v, `${path} ${k}`);
}

test('round trip: recurring template archived', () =>
    roundTrip('/api/recurring-templates', { name: 'Old', type: 'subscription', amount: 5, frequency: 'monthly', dayOfMonth: 3, accountId, archived: true }, { archived: true }));

test('round trip: sinking fund order, archived, completedDate', () =>
    roundTrip('/api/sinking-funds', { name: 'Car', accountId, order: 4, archived: true, completedDate: '2026-02-03' }, { order: 4, archived: true, completedDate: '2026-02-03' }));

test('round trip: emergency fund autoSyncBalance', () =>
    roundTrip('/api/emergency-funds', { accountId, targetAmount: 100, autoSyncBalance: true }, { autoSyncBalance: true }));

test('round trip: debt notes and nextPaymentDue', () =>
    roundTrip('/api/debts', { name: 'Visa', accountId, notes: 'call them', nextPaymentDue: '2026-03-04' }, { notes: 'call them', nextPaymentDue: '2026-03-04' }));

test('round trip: income updatedAt', () =>
    roundTrip('/api/incomes', { name: 'Pay', firstPayDate: '2026-01-01', accountId, updatedAt: '2026-03-04' }, { updatedAt: '2026-03-04' }));

test('round trip: debt updatedAt', () =>
    roundTrip('/api/debts', { name: 'Visa2', accountId, updatedAt: '2026-03-04' }, { updatedAt: '2026-03-04' }));

test('round trip: ledger override memo', async () => {
    const put = await fetch(`${baseUrl}/api/ledger-overrides/${encodeURIComponent('income|1|1|2026-01-01')}`, {
        method: 'PUT', headers: hdrs(), body: JSON.stringify({ amount: 5, accountId, memo: 'paid late' })
    });
    assert.equal(put.status, 200);
    const list = await (await fetch(`${baseUrl}/api/ledger-overrides`, { headers: { Cookie: cookies } })).json();
    assert.equal(list[0].memo, 'paid late');
});
