import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { up, down } from '../migrations/1755600000052_add-manual-transaction-splits.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';

// Issue #688: `splits` on manual transactions.

let server, baseUrl, cookies, accountId;

before(() => {
    server = createApp().listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    server.close();
    await pool.end();
});

function headers() {
    const csrf = cookies.match(/csrf=([^;]+)/)[1];
    return { 'Content-Type': 'application/json', Cookie: cookies, 'X-CSRF-Token': csrf };
}

async function api(method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
}

beforeEach(async () => {
    await resetDb();
    const user = await createTestUser();
    const login = await loginTestUser(baseUrl, user.email, user.password);
    cookies = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    accountId = (await api('POST', '/api/accounts', { name: 'Checking', type: 'checking', startingBalance: 0, interestRate: 0 })).body.id;
});

const SPLITS = [
    { category: 'Groceries', amount: -60 },
    { category: 'Household', amount: -30, memo: 'sponges' },
    { category: 'Gifts', amount: -10 }
];

function payload(extra = {}) {
    return { accountId, name: 'Receipt', amount: -100, date: '2026-08-04', category: 'Groceries', ...extra };
}

async function list() {
    return (await api('GET', '/api/manual-transactions')).body;
}

test('POST with valid splits answers 201 and returns them intact; GET returns them', async () => {
    const res = await api('POST', '/api/manual-transactions', payload({ splits: SPLITS }));
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.splits, SPLITS);
    const rows = await list();
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].splits, SPLITS);
});

test('an unsplit record has splits null', async () => {
    const res = await api('POST', '/api/manual-transactions', payload());
    assert.equal(res.status, 201);
    assert.equal(res.body.splits, null);
});

test('an inflow can be split with positive amounts', async () => {
    const parts = [{ category: 'Salary', amount: 200 }, { category: 'Bonus', amount: 50 }];
    const res = await api('POST', '/api/manual-transactions', payload({ amount: 250, category: 'Income', splits: parts }));
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.splits, parts);
});

test('floating point sums are compared in cents (0.1 + 0.2 = 0.3)', async () => {
    const res = await api('POST', '/api/manual-transactions', payload({ amount: -0.3, splits: [{ category: 'A', amount: -0.1 }, { category: 'B', amount: -0.2 }] }));
    assert.equal(res.status, 201);
});

const BAD = [
    ['a sum that does not match the amount', { splits: [{ category: 'A', amount: -60 }, { category: 'B', amount: -39.99 }] }],
    ['a sum one cent too high', { splits: [{ category: 'A', amount: -60 }, { category: 'B', amount: -40.01 }] }],
    ['a sign that differs from the amount', { splits: [{ category: 'A', amount: -150 }, { category: 'B', amount: 50 }] }],
    ['positive splits on an outflow', { splits: [{ category: 'A', amount: 60 }, { category: 'B', amount: 40 }] }],
    ['a single split', { splits: [{ category: 'A', amount: -100 }] }],
    ['an empty category', { splits: [{ category: '', amount: -60 }, { category: 'B', amount: -40 }] }],
    ['a zero split', { splits: [{ category: 'A', amount: 0 }, { category: 'B', amount: -100 }] }],
    ['more than 20 splits', { amount: -21, splits: Array.from({ length: 21 }, (_, i) => ({ category: `C${i}`, amount: -1 })) }],
    ['splits that are not an array', { splits: 'lots' }]
];

for (const [label, extra] of BAD) {
    test(`POST rejects ${label} with 400 and stores nothing`, async () => {
        const res = await api('POST', '/api/manual-transactions', payload(extra));
        assert.equal(res.status, 400);
        assert.equal((await list()).length, 0);
    });
}

test('PATCH to new valid splits updates them and bumps the row version', async () => {
    const created = (await api('POST', '/api/manual-transactions', payload({ splits: SPLITS }))).body;
    const next = [{ category: 'Food', amount: -70 }, { category: 'Fun', amount: -30 }];
    const res = await api('PATCH', `/api/manual-transactions/${created.id}`, { splits: next, rowVersion: created.rowVersion });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.splits, next);
    assert.equal(res.body.rowVersion, created.rowVersion + 1);
});

test('PATCH with splits null clears them', async () => {
    const created = (await api('POST', '/api/manual-transactions', payload({ splits: SPLITS }))).body;
    const res = await api('PATCH', `/api/manual-transactions/${created.id}`, { splits: null, rowVersion: created.rowVersion });
    assert.equal(res.status, 200);
    assert.equal(res.body.splits, null);
    assert.equal((await list())[0].splits, null);
});

test('PATCH to an unbalanced split is 400 and the stored splits are unchanged', async () => {
    const created = (await api('POST', '/api/manual-transactions', payload({ splits: SPLITS }))).body;
    const res = await api('PATCH', `/api/manual-transactions/${created.id}`, { splits: [{ category: 'A', amount: -50 }, { category: 'B', amount: -49 }] });
    assert.equal(res.status, 400);
    assert.deepEqual((await list())[0].splits, SPLITS);
});

test('PATCH changing only the amount of a split record is 400 (the splits would no longer balance)', async () => {
    const created = (await api('POST', '/api/manual-transactions', payload({ splits: SPLITS }))).body;
    const res = await api('PATCH', `/api/manual-transactions/${created.id}`, { amount: -120 });
    assert.equal(res.status, 400);
    assert.equal((await list())[0].amount, -100);
});

test('PATCH changing amount and splits together works', async () => {
    const created = (await api('POST', '/api/manual-transactions', payload({ splits: SPLITS }))).body;
    const next = [{ category: 'A', amount: -80 }, { category: 'B', amount: -40 }];
    const res = await api('PATCH', `/api/manual-transactions/${created.id}`, { amount: -120, splits: next });
    assert.equal(res.status, 200);
    assert.equal(res.body.amount, -120);
    assert.deepEqual(res.body.splits, next);
});

test('migration 052 is idempotent and its down() cannot fail', async () => {
    const calls = [];
    const pgm = { sql: (s) => calls.push(s) };
    await up(pgm);
    await down(pgm);
    assert.ok(calls[0].includes('IF NOT EXISTS'));
    assert.ok(calls[1].includes('IF EXISTS'));
    await pool.query('ALTER TABLE manual_transactions ADD COLUMN IF NOT EXISTS splits jsonb');
    const { rows } = await pool.query("SELECT data_type FROM information_schema.columns WHERE table_name = 'manual_transactions' AND column_name = 'splits'");
    assert.equal(rows[0].data_type, 'jsonb');
});
