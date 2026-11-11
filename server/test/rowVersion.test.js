// Optimistic concurrency with a row version (#578) and partial PATCH bodies (#563).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';

let server, baseUrl, cookies, accountId;

before(() => {
    server = createApp().listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await pool.end(); });

async function login(email) {
    const user = await createTestUser(email);
    const res = await loginTestUser(baseUrl, user.email, user.password);
    return res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
}

beforeEach(async () => {
    await resetDb();
    cookies = await login('rv@example.com');
    accountId = (await post('/api/accounts', { name: 'Checking', type: 'checking' })).body.id;
});

function hdrs(c = cookies) {
    return { 'Content-Type': 'application/json', Cookie: c, 'X-CSRF-Token': c.match(/csrf=([^;]+)/)[1] };
}

async function call(method, path, body, c = cookies) {
    const res = await fetch(`${baseUrl}${path}`, { method, headers: hdrs(c), body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
}
const post = (p, b, c) => call('POST', p, b, c);
const patch = (p, b, c) => call('PATCH', p, b, c);
const get = (p, c) => call('GET', p, undefined, c);

async function newDebt(extra = {}) {
    const res = await post('/api/debts', { name: 'Car Loan', accountBalance: 5000, interestRate: 6, minimumPayment: 200, accountId, ...extra });
    assert.equal(res.status, 201);
    return res.body;
}

// ─── Positive ────────────────────────────────────────────────────────────────

test('POST and GET return rowVersion 1 for a new record', async () => {
    const debt = await newDebt();
    assert.equal(debt.rowVersion, 1);
    const list = (await get('/api/debts')).body;
    assert.equal(list.find(d => d.id === debt.id).rowVersion, 1);
});

test('PATCH with the current version updates and increments it', async () => {
    const debt = await newDebt();
    const res = await patch(`/api/debts/${debt.id}`, { name: 'Auto Loan', rowVersion: 1 });
    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'Auto Loan');
    assert.equal(res.body.rowVersion, 2);
    const again = await patch(`/api/debts/${debt.id}`, { accountBalance: 4800, rowVersion: 2 });
    assert.equal(again.status, 200);
    assert.equal(again.body.rowVersion, 3);
});

test('PATCH without a version is accepted unchecked and still increments', async () => {
    const debt = await newDebt();
    await patch(`/api/debts/${debt.id}`, { name: 'A', rowVersion: 1 });
    const res = await patch(`/api/debts/${debt.id}`, { name: 'B' });
    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'B');
    assert.equal(res.body.rowVersion, 3);
    const nullVersion = await patch(`/api/debts/${debt.id}`, { name: 'C', rowVersion: null });
    assert.equal(nullVersion.status, 200);
    assert.equal(nullVersion.body.rowVersion, 4);
});

test('#563: a partial PATCH body leaves every other column untouched', async () => {
    const debt = await newDebt({ notes: 'keep me', dueDate: 12 });
    const res = await patch(`/api/debts/${debt.id}`, { accountBalance: 4500, rowVersion: 1 });
    assert.equal(res.status, 200);
    const { rowVersion: _a, accountBalance: _b, ...before } = debt;
    const { rowVersion: _c, accountBalance: balance, ...after } = res.body;
    assert.equal(balance, 4500);
    assert.deepEqual(after, before);
});

test('#563: two writers editing different fields both survive', async () => {
    const debt = await newDebt();
    // Tab A renames with the version it saw; stale tab B then sends only its
    // changed field without a version (the unchecked path).
    assert.equal((await patch(`/api/debts/${debt.id}`, { name: 'Renamed', rowVersion: 1 })).status, 200);
    assert.equal((await patch(`/api/debts/${debt.id}`, { accountBalance: 4000 })).status, 200);
    const row = (await get('/api/debts')).body[0];
    assert.equal(row.name, 'Renamed');
    assert.equal(row.accountBalance, 4000);
});

test('every CRUD resource carries and bumps rowVersion', async () => {
    const debt = await newDebt();
    const tmpl = (await post('/api/recurring-templates', { name: 'Rent', amount: 1, frequency: 'monthly', dayOfMonth: 1, accountId })).body;
    for (const [path, id, change] of [
        ['/api/accounts', accountId, { name: 'Main' }],
        ['/api/debts', debt.id, { name: 'X' }],
        ['/api/recurring-templates', tmpl.id, { amount: 2 }],
    ]) {
        const res = await patch(`${path}/${id}`, { ...change, rowVersion: 1 });
        assert.equal(res.status, 200, path);
        assert.equal(res.body.rowVersion, 2, path);
    }
});

// ─── Negative ────────────────────────────────────────────────────────────────

test('PATCH with a stale version returns 409 with the current row and changes nothing', async () => {
    const debt = await newDebt();
    await patch(`/api/debts/${debt.id}`, { name: 'Renamed', rowVersion: 1 });
    const res = await patch(`/api/debts/${debt.id}`, { accountBalance: 1, rowVersion: 1 });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'CONFLICT');
    assert.equal(res.body.current.id, debt.id);
    assert.equal(res.body.current.name, 'Renamed');
    assert.equal(res.body.current.rowVersion, 2);
    const row = (await get('/api/debts')).body[0];
    assert.equal(row.accountBalance, 5000, 'stale write must not land');
    assert.equal(row.rowVersion, 2, 'a refused write must not bump the version');
});

test('a version ahead of the server is also a conflict', async () => {
    const debt = await newDebt();
    const res = await patch(`/api/debts/${debt.id}`, { name: 'Z', rowVersion: 7 });
    assert.equal(res.status, 409);
});

test('a non-integer or negative rowVersion is rejected with 400', async () => {
    const debt = await newDebt();
    for (const bad of ['1', 1.5, -1, true, {}, []]) {
        const res = await patch(`/api/debts/${debt.id}`, { name: 'Q', rowVersion: bad });
        assert.equal(res.status, 400, JSON.stringify(bad));
        assert.equal(res.body.error.code, 'VALIDATION_FAILED');
    }
    assert.equal((await get('/api/debts')).body[0].name, 'Car Loan');
});

test('a versioned PATCH of a missing record is 404, not 409', async () => {
    const res = await patch('/api/debts/999999', { name: 'Q', rowVersion: 1 });
    assert.equal(res.status, 404);
});

test("a versioned PATCH of another user's record is 404 and leaks no row", async () => {
    const debt = await newDebt();
    const other = await login('other@example.com');
    const res = await patch(`/api/debts/${debt.id}`, { name: 'Hijack', rowVersion: 1 }, other);
    assert.equal(res.status, 404);
    assert.equal(res.body.current, undefined);
    const stale = await patch(`/api/debts/${debt.id}`, { name: 'Hijack', rowVersion: 9 }, other);
    assert.equal(stale.status, 404);
    assert.equal((await get('/api/debts')).body[0].name, 'Car Loan');
});

test('a client cannot set rowVersion through POST', async () => {
    const debt = await newDebt({ rowVersion: 42 });
    assert.equal(debt.rowVersion, 1);
});

test('every createCrudResource table has a row_version column', async () => {
    const routesDir = new URL('../src/routes/', import.meta.url);
    const tables = [];
    for (const file of readdirSync(routesDir).filter(f => f.endsWith('.js'))) {
        const mod = await import(new URL(file, routesDir));
        const cfg = mod.default?.crudConfig;
        // keyed resources expose crudConfig too, but without a numeric id/PATCH
        if (cfg?.table && 'id' in cfg.columns) tables.push(cfg.table);
    }
    assert.ok(tables.length >= 15, `expected the CRUD tables, got ${tables}`);
    const { rows } = await pool.query(
        `SELECT table_name FROM information_schema.columns WHERE column_name = 'row_version' AND table_name = ANY($1)`,
        [tables]);
    const have = new Set(rows.map(r => r.table_name));
    assert.deepEqual(tables.filter(t => !have.has(t)), [], 'tables missing row_version');
});
