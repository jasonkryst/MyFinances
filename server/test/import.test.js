import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';
import { RESOURCE_TABLES } from '../../src/resourceDeletion.js';

// #529: POST /api/import, a whole backup (replace or merge) in one request and
// one database transaction.

let server, base;
let session;      // { Cookie, 'X-CSRF-Token', 'Content-Type' }
let userId;

before(() => {
    server = createApp().listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    server.close();
    await pool.end();
});

async function signIn(email, password) {
    const res = await loginTestUser(base, email, password);
    assert.equal(res.status, 200);
    const cookies = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    return { Cookie: cookies, 'X-CSRF-Token': cookies.match(/csrf=([^;]+)/)[1], 'Content-Type': 'application/json' };
}

beforeEach(async () => {
    await resetDb();
    await pool.query('TRUNCATE audit_log, notifications');
    const user = await createTestUser();
    userId = user.id;
    session = await signIn(user.email, user.password);
});

const get = async (path, headers = session) => (await fetch(`${base}${path}`, { headers })).json();

function postImport(body, headers = session, raw = false) {
    return fetch(`${base}/api/import`, { method: 'POST', headers, body: raw ? body : JSON.stringify(body) });
}

// A backup in the export shape: ids are the file's own and get remapped.
function sampleBackup() {
    return {
        accounts: [
            { id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 },
            { id: 2, name: 'Savings', type: 'Savings', startingBalance: 5000 },
        ],
        persons: [{ id: 1, name: 'Sam' }],
        debts: [
            { id: 1, name: 'Visa', category: 'Credit Card', debtType: 'creditCard', accountBalance: 3000, minimumPayment: 75, interestRate: 19.99, accountId: 1, personIds: [1] },
            { id: 2, name: 'Car Loan', category: 'Auto', debtType: 'creditCard', accountBalance: 9000, minimumPayment: 250, interestRate: 6, accountId: 1 },
        ],
        incomes: [{ id: 1, name: 'Paycheck', amount: 2000, firstPayDate: '2026-08-01', frequency: 'biweekly', accountId: 1, personId: 1 }],
        bills: [{ id: 1, name: 'Rent', amount: 1200, dueDay: 1, category: 'Housing', accountId: 1 }],
        transfers: [{ id: 1, fromAccountId: 1, toAccountId: 2, amount: 50, date: '2026-08-02' }],
        manualTransactions: [{ id: 1, name: 'Coffee', amount: -4.5, date: '2026-08-03', category: 'Dining', accountId: 1 }],
        balanceHistory: [{ id: 1, debtId: 1, accountId: null, date: '2026-08-01', balance: 3000, minimumPayment: 75 }],
        ledgerAmountOverrides: { 'bill|1|1|2026-08-01': { amount: 1250, originalAmount: 1200, date: '2026-08-01' } },
        ledgerClearedTransactions: { 'debt|1|1|2026-08-10': { clearedAt: '2026-08-10T00:00:00.000Z' } },
        monthlySnapshots: [{ date: '2026-08-01', totalAssets: 6000, totalLiabilities: 12000, netWorth: -6000 }],
        settings: [{ key: 'surplusAccountId', value: 2 }],
        netWorthMilestonesAwarded: [5000, 10000],
        perMonthStimulus: [10, 20],
        strategy: 'avalanche',
        monthlyPayment: 600,
        budgetCategories: { Food: { mode: 'fixed', amount: 400 } },
        retirementTargetDate: '2050-01-01',
    };
}

// ─── What a whole-database comparison covers ─────────────────────────────────

const SNAPSHOT_TABLES = [...Object.values(RESOURCE_TABLES), 'plan_settings', 'net_worth_milestones_awarded', 'audit_log', 'notifications'];

// Every row the user owns, as text: any change to a table, plan settings, the
// milestones or the change log shows up as a difference.
async function dumpUser() {
    const out = {};
    for (const table of SNAPSHOT_TABLES) {
        const { rows } = await pool.query(`SELECT to_jsonb(t)::text AS j FROM ${table} t WHERE user_id = $1 ORDER BY 1`, [userId]);
        out[table] = rows.map(r => r.j);
    }
    return out;
}

async function seedExisting() {
    const res = await postImport({ mode: 'replace', data: sampleBackup(), strategy: { paymentStrategy: 'snowball', monthlyPayment: 100 } });
    assert.equal(res.status, 200);
    await pool.query(`INSERT INTO notifications (user_id, type, params, dedupe_key) VALUES ($1, 'low_balance', '{}'::jsonb, 'import-test')`, [userId]);
}

// ─── Replace ─────────────────────────────────────────────────────────────────

test('replace: one request imports a backup and every route then returns the remapped data', async () => {
    const res = await postImport({ mode: 'replace', data: sampleBackup(), strategy: { paymentStrategy: 'avalanche', monthlyPayment: 600 } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.skipped, {});
    assert.deepEqual(body.warnings, []);

    const accounts = await get('/api/accounts');
    assert.deepEqual(accounts.map(a => a.name), ['Checking', 'Savings']);
    const [checking, savings] = accounts;
    const [sam] = await get('/api/persons');
    const debts = await get('/api/debts');
    assert.equal(debts.length, 2);
    assert.equal(debts[0].accountId, checking.id);
    assert.deepEqual(debts[0].personIds, [sam.id]);
    const [income] = await get('/api/incomes');
    assert.equal(income.accountId, checking.id);
    assert.equal(income.personId, sam.id);
    const [transfer] = await get('/api/transfers');
    assert.equal(transfer.fromAccountId, checking.id);
    assert.equal(transfer.toAccountId, savings.id);
    const [bill] = await get('/api/bills');
    const [history] = await get('/api/balance-history');
    assert.equal(history.debtId, debts[0].id);

    // Ledger keys follow the new ids, and so does the account-id setting.
    const overrides = await get('/api/ledger-overrides');
    assert.deepEqual(overrides.map(o => o.overrideKey), [`bill|${bill.id}|${checking.id}|2026-08-01`]);
    const cleared = await get('/api/ledger-cleared');
    assert.deepEqual(cleared.map(c => c.clearedKey), [`debt|${debts[0].id}|${checking.id}|2026-08-10`]);
    const settings = await get('/api/settings');
    assert.deepEqual(settings.map(s => [s.key, s.value]).filter(([k]) => k === 'surplusAccountId'), [['surplusAccountId', savings.id]]);
    assert.equal((await get('/api/net-worth-snapshots')).length, 1);

    const plan = await get('/api/plan-settings');
    assert.equal(plan.strategy, 'avalanche');
    assert.equal(plan.monthlyPayment, 600);
    assert.deepEqual(plan.perMonthStimulus, [10, 20]);
    assert.deepEqual(plan.netWorthMilestonesAwarded, [5000, 10000]);
    assert.deepEqual(plan.budgetCategories, { Food: { mode: 'fixed', amount: 400 } });
    assert.equal(plan.retirementTargetDate, '2050-01-01');
});

test('replace: existing data, milestones, notifications and plan settings are replaced, the change log is kept', async () => {
    await seedExisting();
    await pool.query(`UPDATE plan_settings SET budget_categories = '{"Old": 1}', home_purchase_plan = '{"targetHomePrice": 5}' WHERE user_id = $1`, [userId]);
    const auditBefore = (await pool.query('SELECT count(*)::int AS n FROM audit_log WHERE user_id = $1', [userId])).rows[0].n;

    const res = await postImport({ mode: 'replace', data: { accounts: [{ id: 9, name: 'Only' }], strategy: 'snowball' } });
    assert.equal(res.status, 200);

    assert.deepEqual((await get('/api/accounts')).map(a => a.name), ['Only']);
    for (const path of ['/api/debts', '/api/incomes', '/api/bills', '/api/transfers', '/api/manual-transactions', '/api/balance-history',
        '/api/persons', '/api/ledger-overrides', '/api/ledger-cleared', '/api/net-worth-snapshots']) {
        assert.equal((await get(path)).length, 0, path);
    }
    const plan = await get('/api/plan-settings');
    assert.deepEqual(plan.netWorthMilestonesAwarded, []);
    assert.deepEqual(plan.budgetCategories, {});
    assert.equal(plan.homePurchasePlan, null);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1', [userId])).rows[0].n, 0);
    const auditAfter = (await pool.query('SELECT count(*)::int AS n FROM audit_log WHERE user_id = $1', [userId])).rows[0].n;
    assert.ok(auditAfter > auditBefore, 'the import adds to the change log; nothing is removed');
});

test('replace: one audit row per created record', async () => {
    const res = await postImport({ mode: 'replace', data: sampleBackup() });
    assert.equal(res.status, 200);
    const { rows } = await pool.query(
        `SELECT table_name, op, count(*)::int AS n FROM audit_log WHERE user_id = $1 GROUP BY 1, 2 ORDER BY 1, 2`, [userId]);
    const created = Object.fromEntries(rows.filter(r => r.op === 'create').map(r => [r.table_name, r.n]));
    assert.equal(created.accounts, 2);
    assert.equal(created.persons, 1);
    assert.equal(created.debts, 2);
    assert.equal(created.incomes, 1);
    assert.equal(created.bills, 1);
    assert.equal(created.transfers, 1);
    assert.equal(created.manual_transactions, 1);
    assert.equal(created.balance_history, 1);
    assert.equal(created.ledger_amount_overrides, 1);
    assert.equal(created.ledger_cleared_transactions, 1);
    assert.equal(created.net_worth_snapshots, 1);
});

test('replace: an empty backup wipes the account', async () => {
    await seedExisting();
    const res = await postImport({ mode: 'replace', data: {} });
    assert.equal(res.status, 200);
    assert.deepEqual(await get('/api/accounts'), []);
    assert.deepEqual(await get('/api/debts'), []);
});

// ─── Merge ───────────────────────────────────────────────────────────────────

test('merge: dedupes by natural key, reports skipped, and creates only the new records', async () => {
    await seedExisting();
    const before = await get('/api/accounts');
    const data = sampleBackup();
    data.accounts.push({ id: 3, name: 'Brokerage', type: 'Investment', startingBalance: 1 });
    data.debts.push({ id: 3, name: 'Student Loan', category: 'Education', debtType: 'creditCard', accountBalance: 20000, minimumPayment: 200, interestRate: 5, accountId: 3 });
    const res = await postImport({ mode: 'merge', data, strategy: { paymentStrategy: 'snowball', monthlyPayment: 100 } });
    assert.equal(res.status, 200);
    const { skipped, warnings } = await res.json();
    assert.deepEqual(warnings, []);
    assert.equal(skipped.accounts, 2);
    assert.equal(skipped.persons, 1);
    assert.equal(skipped.debts, 2);

    const accounts = await get('/api/accounts');
    assert.deepEqual(accounts.map(a => a.name), ['Checking', 'Savings', 'Brokerage']);
    assert.deepEqual(accounts.slice(0, 2).map(a => a.id), before.map(a => a.id), 'matched accounts keep their ids');
    const debts = await get('/api/debts');
    assert.deepEqual(debts.map(d => d.name), ['Visa', 'Car Loan', 'Student Loan']);
    assert.equal(debts[2].accountId, accounts[2].id);
    assert.equal((await get('/api/incomes')).length, 1);
    assert.equal((await get('/api/transfers')).length, 1);
    assert.equal((await get('/api/balance-history')).length, 1, 'existing history is not repeated');
});

test('merge: in-file repeats are created once', async () => {
    const data = { accounts: [{ id: 1, name: 'Main', type: 'Checking' }, { id: 2, name: 'MAIN', type: 'Checking' }],
        bills: [{ id: 1, name: 'Phone', amount: 50, dueDay: 3, accountId: 2 }] };
    const res = await postImport({ mode: 'merge', data });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).skipped.accounts, 1);
    const accounts = await get('/api/accounts');
    assert.equal(accounts.length, 1);
    assert.equal((await get('/api/bills'))[0].accountId, accounts[0].id);
});

test('merge: plan settings merge, keeping what the file does not carry', async () => {
    await seedExisting();
    await pool.query(`UPDATE plan_settings SET budget_categories = '{"Rent": {"mode": "fixed", "amount": 1000}, "Food": {"mode": "fixed", "amount": 1}}' WHERE user_id = $1`, [userId]);
    const res = await postImport({ mode: 'merge', data: { budgetCategories: { Food: { mode: 'fixed', amount: 400 } } }, strategy: { paymentStrategy: 'avalanche', monthlyPayment: 700 } });
    assert.equal(res.status, 200);
    const plan = await get('/api/plan-settings');
    assert.deepEqual(plan.budgetCategories, { Rent: { mode: 'fixed', amount: 1000 }, Food: { mode: 'fixed', amount: 400 } });
    assert.equal(plan.retirementTargetDate, '2050-01-01', 'a date the file lacks is kept');
    assert.equal(plan.strategy, 'avalanche');
    assert.equal(plan.monthlyPayment, 700);
    assert.deepEqual(plan.netWorthMilestonesAwarded, [5000, 10000]);
});

// ─── Atomicity ───────────────────────────────────────────────────────────────

// Records that survive sanitizing but that the matching route would answer 400
// for: they point at an account owned by someone else (the file's own account
// ids are remapped, an id that is not in the file is passed through as is).
// Both come after most other records have been written.
async function otherUsersAccountId() {
    const other = await createTestUser('other@example.com', 'another correct horse battery');
    const { rows } = await pool.query(`INSERT INTO accounts (user_id, name, type) VALUES ($1, 'Theirs', 'Checking') RETURNING id`, [other.id]);
    assert.ok(rows[0].id > 2, 'must not collide with the ids of the accounts in the file');
    return rows[0].id;
}

const POISONS = {
    // A CRUD record.
    bill: { collection: 'bills', index: true, apply: (d, foreign) => ({ ...d,
        bills: [...(d.bills || []), { id: 99, name: 'Sneaky', amount: 1, dueDay: 1, category: 'Other', accountId: foreign }] }) },
    // A keyed Ledger override, written after every CRUD record.
    override: { collection: 'ledgerAmountOverrides', index: false, apply: (d, foreign) => ({ ...d,
        ledgerAmountOverrides: { ...d.ledgerAmountOverrides, 'bill|1|1|2026-09-09': { amount: 1, accountId: foreign, date: '2026-09-09' } } }) },
};

for (const mode of ['replace', 'merge']) {
    for (const [name, poison] of Object.entries(POISONS)) {
        test(`${mode}: a rejected ${name} rolls everything back (every table, plan settings, milestones and the change log)`, async () => {
            await seedExisting();
            const foreign = await otherUsersAccountId();
            const before = await dumpUser();

            const data = poison.apply(sampleBackup(), foreign);
            // New names, so a merge would have created records before reaching the bad one.
            data.accounts = data.accounts.map(a => ({ ...a, name: `New ${a.name}` }));
            data.debts = data.debts.map(d => ({ ...d, name: `New ${d.name}` }));
            data.budgetCategories = { Changed: { mode: 'fixed', amount: 1 } };
            data.netWorthMilestonesAwarded = [5000, 25000];
            const res = await postImport({ mode, data, strategy: { paymentStrategy: 'avalanche', monthlyPayment: 1 } });
            const body = await res.json();
            assert.equal(res.status, 400, JSON.stringify(body));
            assert.equal(body.error.code, 'VALIDATION_FAILED');
            assert.equal(body.error.collection, poison.collection);
            assert.equal(typeof body.error.index, poison.index ? 'number' : 'object');
            assert.match(body.error.message, /accountId does not reference a resource you own/);

            assert.deepEqual(await dumpUser(), before, 'nothing changed');
            // The other user's account was not touched either.
            assert.equal((await pool.query('SELECT count(*)::int AS n FROM bills WHERE account_id = $1', [foreign])).rows[0].n, 0);
        });
    }
}

test('replace: a rejected record leaves the existing data readable through the API', async () => {
    await seedExisting();
    const foreign = await otherUsersAccountId();
    const res = await postImport({ mode: 'replace', data: POISONS.bill.apply({ accounts: [{ id: 1, name: 'Fresh' }] }, foreign) });
    assert.equal(res.status, 400);
    assert.deepEqual((await get('/api/accounts')).map(a => a.name), ['Checking', 'Savings']);
    assert.equal((await get('/api/debts')).length, 2);
});

test('a server failure in the middle also rolls back', async () => {
    await seedExisting();
    const before = await dumpUser();
    // A database error on the Net Worth snapshots, written late in the import.
    await pool.query(`CREATE FUNCTION import_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'import test failure'; END $$`);
    await pool.query('CREATE TRIGGER import_test_fail BEFORE INSERT ON net_worth_snapshots FOR EACH ROW EXECUTE FUNCTION import_test_fail()');
    try {
        const res = await postImport({ mode: 'replace', data: sampleBackup() });
        assert.equal(res.status, 500);
    } finally {
        await pool.query('DROP TRIGGER import_test_fail ON net_worth_snapshots');
        await pool.query('DROP FUNCTION import_test_fail()');
    }
    assert.deepEqual(await dumpUser(), before);
});

// ─── Validation and access ───────────────────────────────────────────────────

test('a bad mode, data or strategy is a 400 and changes nothing', async () => {
    await seedExisting();
    const before = await dumpUser();
    const bad = [
        {}, { data: {} }, { mode: 'append', data: {} }, { mode: 'replace' }, { mode: 'replace', data: null },
        { mode: 'replace', data: [] }, { mode: 'replace', data: 'x' }, { mode: 'merge', data: {}, strategy: 'avalanche' },
        { mode: 'merge', data: {}, strategy: [] },
    ];
    for (const body of bad) {
        const res = await postImport(body);
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.equal((await res.json()).error.code, 'VALIDATION_FAILED');
    }
    assert.equal((await postImport('not json{', session, true)).status, 400);
    assert.equal((await postImport('[1,2]', session, true)).status, 400);
    assert.deepEqual(await dumpUser(), before);
});

test('the server sanitizes the data itself: out-of-range and wrong-typed values never reach the tables', async () => {
    const res = await postImport({ mode: 'replace', data: {
        accounts: [{ id: 1, name: 'A'.repeat(500), type: 'Checking', startingBalance: 'not a number' }],
        debts: [{ id: 1, name: '<b>Evil</b>', accountBalance: -5, accountId: 1 }],
    } });
    assert.equal(res.status, 200);
    const [account] = await get('/api/accounts');
    assert.ok(account.name.length <= 120);
    assert.equal(account.startingBalance, 0);
    const debts = await get('/api/debts');
    assert.ok(debts.every(d => !/[<>]/.test(d.name)));
});

test('no session is 401', async () => {
    const res = await postImport({ mode: 'replace', data: {} }, { 'Content-Type': 'application/json' });
    assert.equal(res.status, 401);
});

test('a session without the CSRF header is 403 and changes nothing', async () => {
    await seedExisting();
    const before = await dumpUser();
    const res = await postImport({ mode: 'replace', data: {} }, { Cookie: session.Cookie, 'Content-Type': 'application/json' });
    assert.equal(res.status, 403);
    assert.deepEqual(await dumpUser(), before);
});

test('a read-only API token cannot import', async () => {
    await seedExisting();
    const tokenRes = await fetch(`${base}/api/api-tokens`, { method: 'POST', headers: session, body: JSON.stringify({ name: 'dash' }) });
    assert.equal(tokenRes.status, 201);
    const { token } = await tokenRes.json();
    const before = await dumpUser();
    const res = await postImport({ mode: 'replace', data: {} }, { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
    assert.equal(res.status, 403);
    assert.deepEqual(await dumpUser(), before);
});

test("one user's import never touches another user's data", async () => {
    await seedExisting();
    const other = await createTestUser('someone@example.com', 'another correct horse battery');
    const otherSession = await signIn(other.email, other.password);
    await pool.query(`INSERT INTO accounts (user_id, name, type) VALUES ($1, 'Mine', 'Checking')`, [other.id]);
    const res = await postImport({ mode: 'replace', data: {} }, otherSession);
    assert.equal(res.status, 200);
    assert.deepEqual((await get('/api/accounts', otherSession)), []);
    assert.equal((await get('/api/accounts')).length, 2, 'the first user keeps their accounts');
});

// ─── Size limits ─────────────────────────────────────────────────────────────

test('a body over 1 MB is accepted here (the rest of the API stays at 1 MB)', async () => {
    const padded = { mode: 'replace', data: { accounts: [{ id: 1, name: 'Big' }], padding: 'x'.repeat(3 * 1024 * 1024) } };
    const res = await postImport(padded);
    assert.equal(res.status, 200);
    assert.deepEqual((await get('/api/accounts')).map(a => a.name), ['Big']);

    const other = await fetch(`${base}/api/accounts`, { method: 'POST', headers: session,
        body: JSON.stringify({ name: 'x', notes: 'y'.repeat(2 * 1024 * 1024) }) });
    assert.equal(other.status, 413, 'a normal route still refuses 2 MB');
});

test('a body over 25 MB is 413 and changes nothing', async () => {
    await seedExisting();
    const before = await dumpUser();
    const res = await postImport({ mode: 'replace', data: { padding: 'x'.repeat(26 * 1024 * 1024) } });
    assert.equal(res.status, 413);
    assert.equal((await res.json()).error.code, 'PAYLOAD_TOO_LARGE');
    assert.deepEqual(await dumpUser(), before);
});

test('an unauthenticated oversized body is refused before it is parsed', async () => {
    const res = await postImport({ mode: 'replace', data: { padding: 'x'.repeat(5 * 1024 * 1024) } }, { 'Content-Type': 'application/json' });
    assert.equal(res.status, 401);
});

// ─── Concurrency ─────────────────────────────────────────────────────────────

test('two imports for one user run one after the other: the result is one of them, never a mix', async () => {
    const make = tag => ({
        accounts: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `${tag} account ${i}`, type: 'Checking' })),
        bills: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `${tag} bill ${i}`, amount: 10, dueDay: 1, accountId: i + 1 })),
    });
    const [a, b] = await Promise.all([
        postImport({ mode: 'replace', data: make('A') }),
        postImport({ mode: 'replace', data: make('B') }),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const accounts = await get('/api/accounts');
    const bills = await get('/api/bills');
    assert.equal(accounts.length, 30);
    assert.equal(bills.length, 30);
    const tags = new Set([...accounts.map(x => x.name[0]), ...bills.map(x => x.name[0])]);
    assert.equal(tags.size, 1, 'all records come from the same import');
    const accountIds = new Set(accounts.map(x => x.id));
    assert.ok(bills.every(x => accountIds.has(x.accountId)), 'every bill points at an account of the same import');
});

// ─── A backup the size of the audit's (#529) ─────────────────────────────────

function dayISO(i) {
    return new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10);
}

function auditSizeBackup() {
    const accounts = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: `Account ${i}`, type: 'Checking', startingBalance: 100 * i }));
    const debts = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, name: `Debt ${i}`, category: 'Credit Card', debtType: 'creditCard', accountBalance: 1000 + i, minimumPayment: 25, interestRate: 15, accountId: (i % 6) + 1 }));
    const balanceHistory = debts.flatMap(d => Array.from({ length: 14 }, (_, k) => ({ debtId: d.id, accountId: null, date: dayISO(k * 30), balance: 1000 - k, minimumPayment: 25 })));
    return {
        accounts, debts, balanceHistory,
        persons: [{ id: 1, name: 'Sam' }, { id: 2, name: 'Alex' }],
        incomes: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Income ${i}`, amount: 2000, firstPayDate: '2026-01-02', frequency: 'biweekly', accountId: (i % 6) + 1, personId: 1 })),
        bonuses: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `Bonus ${i}`, amount: 100, date: dayISO(i * 7), category: 'Other', accountId: 1, purpose: 'savings' })),
        bills: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: `Bill ${i}`, amount: 40 + i, dueDay: (i % 28) + 1, category: 'Housing', accountId: (i % 6) + 1 })),
        expenses: Array.from({ length: 150 }, (_, i) => ({ id: i + 1, name: `Expense ${i}`, budgetAmount: 20, date: dayISO(i), category: 'Food', accountId: (i % 6) + 1 })),
        recurringTemplates: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `Template ${i}`, type: 'subscription', amount: 9.99, frequency: 'monthly', dayOfMonth: (i % 28) + 1, category: 'Entertainment', accountId: (i % 6) + 1 })),
        sinkingFunds: Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `Fund ${i}`, allocationMethod: 'fixed', monthlyAllocation: 50, targetAmount: 1200, currentAmount: 0, accountId: 2 })),
        transfers: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, fromAccountId: 1, toAccountId: 2, amount: 10 + i, date: dayISO(i) })),
        manualTransactions: Array.from({ length: 600 }, (_, i) => ({ id: i + 1, name: `Purchase ${i}`, amount: -(i + 1) / 10, date: dayISO(i % 400), category: 'Dining', accountId: (i % 6) + 1 })),
        ledgerAmountOverrides: Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`interest|1|1|${dayISO(i)}`, { amount: i, originalAmount: i + 1, date: dayISO(i) }])),
        ledgerClearedTransactions: Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`interest|1|1|${dayISO(i)}`, { clearedAt: '2026-06-02T00:00:00.000Z' }])),
        monthlySnapshots: Array.from({ length: 60 }, (_, i) => ({ date: dayISO(i * 30), totalAssets: 1000 + i, totalLiabilities: 500, netWorth: 500 + i })),
        settings: [{ key: 'reconciliationAdjustsBalance', value: false }],
        netWorthMilestonesAwarded: [5000, 10000],
        strategy: 'avalanche', monthlyPayment: 500,
    };
}

test('an audit-sized backup (about 1,900 records) imports in one request, quickly', async () => {
    const data = auditSizeBackup();
    const count = Object.values(data).reduce((n, v) => n + (Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : 0)), 0);
    assert.ok(count >= 1800, `generated ${count} records`);

    const started = performance.now();
    const res = await postImport({ mode: 'replace', data, strategy: { paymentStrategy: 'avalanche', monthlyPayment: 500 } });
    const ms = Math.round(performance.now() - started);
    const out = await res.json();
    assert.equal(res.status, 200, JSON.stringify(out));
    assert.deepEqual(out.warnings, []);
    console.log(`audit-size import: ${count} records in ${ms} ms (one request)`);
    assert.ok(ms < 10000, `import took ${ms} ms`);

    assert.equal((await get('/api/manual-transactions')).length, 600);
    assert.equal((await get('/api/balance-history')).length, 350);
    assert.equal((await get('/api/ledger-overrides')).length, 250);
    assert.equal((await get('/api/ledger-cleared')).length, 150);
    assert.equal((await get('/api/debts')).length, 25);
    assert.equal((await get('/api/expenses')).length, 150);

    // Importing the same file again as a merge creates nothing new.
    const again = await postImport({ mode: 'merge', data, strategy: { paymentStrategy: 'avalanche', monthlyPayment: 500 } });
    assert.equal(again.status, 200);
    assert.equal((await get('/api/accounts')).length, 6);
    assert.equal((await get('/api/manual-transactions')).length, 600);
});
