// Wiping every collection without deadlocking (#608). The browser deletes in the
// child-first layers of src/resourceDeletion.js; these tests keep that map honest
// against the real schema and routes, and wipe seeded data the way pgDeleteAll does.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';
import { RESOURCE_TABLES, RESOURCE_PARENTS, ALL_RESOURCE_PATHS, deletionLayers } from '../../src/resourceDeletion.js';

let server, baseUrl, cookies;

before(() => {
    server = createApp().listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await pool.end(); });

beforeEach(async () => {
    await resetDb();
    const user = await createTestUser('wipe@example.com');
    const res = await loginTestUser(baseUrl, user.email, user.password);
    cookies = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
});

async function call(method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: cookies, 'X-CSRF-Token': cookies.match(/csrf=([^;]+)/)[1] },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function created(path, body) {
    const res = await call('POST', path, body);
    assert.equal(res.status, 201, `${path}: ${JSON.stringify(res.body)}`);
    return res.body;
}

const pathOfTable = Object.fromEntries(Object.entries(RESOURCE_TABLES).map(([path, table]) => [table, path]));

// ─── The map matches the schema and the routes ───────────────────────────────

test('every foreign key between app tables is declared in RESOURCE_PARENTS', async () => {
    const { rows } = await pool.query(`
        SELECT DISTINCT tc.table_name AS child, ccu.table_name AS parent
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public' AND ccu.table_name <> 'users'`);
    assert.ok(rows.length >= 15, `expected the known foreign keys, found ${rows.length}`);
    const missing = [];
    for (const { child, parent } of rows) {
        const childPath = pathOfTable[child];
        const parentPath = pathOfTable[parent];
        if (!childPath || !parentPath) {
            missing.push(`${child} -> ${parent} (table not in RESOURCE_TABLES)`);
        } else if (!(RESOURCE_PARENTS[childPath] || []).includes(parentPath)) {
            missing.push(`${childPath} -> ${parentPath}`);
        }
    }
    assert.deepEqual(missing, [], 'add these to RESOURCE_PARENTS in src/resourceDeletion.js, or Clear All Data can deadlock');
});

test('RESOURCE_PARENTS declares no reference the schema lacks', async () => {
    const { rows } = await pool.query(`
        SELECT DISTINCT tc.table_name AS child, ccu.table_name AS parent
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`);
    const actual = new Set(rows.map(r => `${r.child}->${r.parent}`));
    for (const [child, parents] of Object.entries(RESOURCE_PARENTS)) {
        for (const parent of parents) {
            assert.ok(actual.has(`${RESOURCE_TABLES[child]}->${RESOURCE_TABLES[parent]}`), `${child} -> ${parent} has no foreign key`);
        }
    }
});

test('every collection path is mounted on a route for its declared table', () => {
    const appSrc = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
    const routerFile = Object.fromEntries([...appSrc.matchAll(/^import (\w+) from '\.\/routes\/(\w+)\.js';/gm)].map(m => [m[1], m[2]]));
    const mounted = Object.fromEntries([...appSrc.matchAll(/api\.use\('(\/[\w-]+)', (\w+)\)/g)].map(m => [`/api${m[1]}`, routerFile[m[2]]]));
    for (const path of ALL_RESOURCE_PATHS) {
        assert.ok(mounted[path], `${path} is not mounted in server/src/app.js`);
        const routeSrc = readFileSync(new URL(`../src/routes/${mounted[path]}.js`, import.meta.url), 'utf8');
        assert.match(routeSrc, new RegExp(`table: '${RESOURCE_TABLES[path]}'`), `${path} is not backed by ${RESOURCE_TABLES[path]}`);
    }
});

test('every table-backed route is a declared collection', () => {
    // A new CRUD route left out of RESOURCE_TABLES would never be wiped.
    const appSrc = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
    const routerFile = Object.fromEntries([...appSrc.matchAll(/^import (\w+) from '\.\/routes\/(\w+)\.js';/gm)].map(m => [m[1], m[2]]));
    const undeclared = [];
    for (const [, sub, router] of appSrc.matchAll(/api\.use\('(\/[\w-]+)', (\w+)\)/g)) {
        if (!routerFile[router]) continue;
        const routeSrc = readFileSync(new URL(`../src/routes/${routerFile[router]}.js`, import.meta.url), 'utf8');
        if (/table: '/.test(routeSrc) && !RESOURCE_TABLES[`/api${sub}`]) undeclared.push(`/api${sub}`);
    }
    assert.deepEqual(undeclared, []);
});

// ─── Wiping in layers ────────────────────────────────────────────────────────

async function seed() {
    const person = await created('/api/persons', { name: 'Pat' });
    for (let i = 0; i < 4; i++) {
        const account = await created('/api/accounts', { name: `Account ${i}`, type: 'Checking', startingBalance: 100 });
        const other = await created('/api/accounts', { name: `Savings ${i}`, type: 'Savings', startingBalance: 50 });
        const debt = await created('/api/debts', { name: `Card ${i}`, accountBalance: 500, interestRate: 20, minimumPayment: 25, accountId: account.id });
        await created('/api/balance-history', { debtId: debt.id, date: '2026-11-01', balance: 500, minimumPayment: 25 });
        await created('/api/balance-history', { accountId: account.id, date: '2026-11-01', balance: 100, minimumPayment: 0 });
        await created('/api/incomes', { name: `Pay ${i}`, amount: 1000, firstPayDate: '2026-11-01', frequency: 'monthly', accountId: account.id, personId: person.id });
        await created('/api/recurring-templates', { name: `Sub ${i}`, type: 'transfer', amount: 10, accountId: account.id, targetAccountId: other.id });
        await created('/api/emergency-funds', { accountId: account.id, targetAmount: 1000 });
        await created('/api/sinking-funds', { name: `Goal ${i}`, accountId: other.id, targetAmount: 300 });
        await created('/api/transfers', { fromAccountId: account.id, toAccountId: other.id, amount: 5, date: '2026-11-02' });
        await created('/api/reconciliations', { accountId: account.id, statementBalance: 90, date: '2026-11-03' });
    }
}

async function wipeInLayers() {
    for (const layer of deletionLayers()) {
        const results = await Promise.all(layer.map(path => call('DELETE', path)));
        results.forEach((res, i) => assert.ok(res.status < 300, `DELETE ${layer[i]} -> ${res.status} ${JSON.stringify(res.body)}`));
    }
}

test('wiping seeded data in layers succeeds every time and leaves nothing', async () => {
    for (let round = 0; round < 5; round++) {
        await seed();
        await wipeInLayers();
        for (const path of ALL_RESOURCE_PATHS) {
            const res = await call('GET', path);
            assert.equal(res.status, 200);
            const count = Array.isArray(res.body) ? res.body.length : Object.keys(res.body || {}).length;
            assert.equal(count, 0, `round ${round}: ${path} still has ${count} rows`);
        }
    }
});

test('parents are wiped only after their children', () => {
    const layers = deletionLayers();
    const layerOf = path => layers.findIndex(layer => layer.includes(path));
    assert.ok(layerOf('/api/balance-history') < layerOf('/api/debts'));
    assert.ok(layerOf('/api/debts') < layerOf('/api/accounts'));
    assert.ok(layerOf('/api/incomes') < layerOf('/api/persons'));
    assert.equal(layerOf('/api/accounts'), layers.length - 1);
});
