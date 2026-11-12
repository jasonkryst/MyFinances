import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db.js';
import { resetDb, createTestUser } from './helpers/testDb.js';

after(() => pool.end());

// src/index.js imports { runner as migrate } from 'node-pg-migrate' and calls
// it at startup before the server binds its port, so an export-shape change
// on a dep bump crash-loops the container and 502s every request behind nginx.
// Guard the shape here since no other test exercises src/index.js directly.
test('node-pg-migrate exports a callable `runner` (the shape src/index.js imports)', async () => {
    const mod = await import('node-pg-migrate');
    assert.equal(typeof mod.runner, 'function');
});

test('users table accepts a hashed-password row', async () => {
    await resetDb();
    const user = await createTestUser();
    const { rows } = await pool.query('SELECT email FROM users WHERE id = $1', [user.id]);
    assert.equal(rows[0].email, 'test@example.com');
});

test('sessions cascade-delete when their user is deleted', async () => {
    await resetDb();
    const user = await createTestUser();
    await pool.query(
        "INSERT INTO sessions (id, user_id, expires_at) VALUES ('tok', $1, now() + interval '1 day')",
        [user.id]
    );
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    const { rows } = await pool.query('SELECT * FROM sessions');
    assert.equal(rows.length, 0);
});

// Every user_id/account_id FK column got an index in migration 1755600000006
// (H1, docs/audit/database/DATABASE_AUDIT_2026-09-02.md). Tables whose primary
// key already leads with user_id (net_worth_snapshots, settings,
// ledger_amount_overrides, ledger_cleared_transactions,
// net_worth_milestones_awarded, plan_settings) don't need a separate index.
test('every user_id/account_id FK column has an index', async () => {
    await resetDb();
    const expectedIndexedColumns = {
        sessions: ['user_id'],
        accounts: ['user_id'],
        bills: ['user_id', 'account_id'],
        expenses: ['user_id', 'account_id'],
        incomes: ['user_id', 'account_id'],
        bonuses: ['user_id', 'account_id'],
        debts: ['user_id', 'account_id'],
        recurring_templates: ['user_id', 'account_id', 'target_account_id'],
        emergency_funds: ['user_id', 'account_id'],
        sinking_funds: ['user_id', 'account_id'],
        reconciliations: ['user_id', 'account_id'],
        plan_history: ['user_id'],
        ledger_amount_overrides: ['account_id'],
        retirement_snapshots: ['user_id', 'account_id']
    };

    for (const [table, columns] of Object.entries(expectedIndexedColumns)) {
        for (const column of columns) {
            const { rows } = await pool.query(
                `SELECT 1 FROM pg_indexes WHERE tablename = $1 AND indexdef LIKE '%(' || $2 || ')%'`,
                [table, column]
            );
            assert.ok(rows.length > 0, `expected an index on ${table}.${column}`);
        }
    }
});

test('enum-shaped columns reject values outside their sanitizer allow-list', async () => {
    await resetDb();
    const user = await createTestUser();

    await assert.rejects(
        pool.query("INSERT INTO recurring_templates (user_id, name, frequency) VALUES ($1, 'x', 'daily')", [user.id]),
        /violates check constraint "recurring_templates_frequency_check"/
    );
    await pool.query("INSERT INTO recurring_templates (user_id, name, type) VALUES ($1, 'x', 'income')", [user.id]);
    await assert.rejects(
        pool.query("INSERT INTO recurring_templates (user_id, name, type) VALUES ($1, 'x', 'refund')", [user.id]),
        /violates check constraint "recurring_templates_type_check"/
    );
    await assert.rejects(
        pool.query("INSERT INTO sinking_funds (user_id, name, allocation_method) VALUES ($1, 'x', 'percent')", [user.id]),
        /violates check constraint "sinking_funds_allocation_method_check"/
    );
    await assert.rejects(
        pool.query("INSERT INTO incomes (user_id, name, frequency) VALUES ($1, 'x', 'daily')", [user.id]),
        /violates check constraint "incomes_frequency_check"/
    );
});

test('accounts.retirement_subtype rejects a value outside the allow-list', async () => {
    await resetDb();
    const user = await createTestUser();
    await assert.rejects(
        pool.query(
            "INSERT INTO accounts (user_id, name, retirement_subtype) VALUES ($1, 'x', 'bogus')",
            [user.id]
        ),
        /violates check constraint "accounts_retirement_subtype_check"/
    );
});

test('plan_settings accepts a retirement_target_date', async () => {
    await resetDb();
    const user = await createTestUser();
    await pool.query('INSERT INTO plan_settings (user_id) VALUES ($1)', [user.id]);
    await pool.query('UPDATE plan_settings SET retirement_target_date = $1 WHERE user_id = $2', ['2050-01-01', user.id]);
    const { rows } = await pool.query('SELECT retirement_target_date FROM plan_settings WHERE user_id = $1', [user.id]);
    // db.js overrides the `date` OID type parser to return the raw wire text
    // (already "YYYY-MM-DD") rather than a JS Date, matching every other
    // date column in this codebase -- see the comment in src/db.js.
    assert.equal(rows[0].retirement_target_date, '2050-01-01');
});

test('plan_settings accepts a nullable home_purchase_plan jsonb', async () => {
    await resetDb();
    const user = await createTestUser();
    await pool.query('INSERT INTO plan_settings (user_id) VALUES ($1)', [user.id]);
    let { rows } = await pool.query('SELECT home_purchase_plan FROM plan_settings WHERE user_id = $1', [user.id]);
    assert.equal(rows[0].home_purchase_plan, null);
    await pool.query('UPDATE plan_settings SET home_purchase_plan = $1 WHERE user_id = $2', [JSON.stringify({ targetHomePrice: 300000 }), user.id]);
    ({ rows } = await pool.query('SELECT home_purchase_plan FROM plan_settings WHERE user_id = $1', [user.id]));
    assert.equal(rows[0].home_purchase_plan.targetHomePrice, 300000);
});

test('debts accepts a nullable ownership_split jsonb (#272)', async () => {
    await resetDb();
    const user = await createTestUser();
    await pool.query(`INSERT INTO debts (user_id, name) VALUES ($1, 'Mortgage')`, [user.id]);
    let { rows } = await pool.query('SELECT ownership_split FROM debts WHERE user_id = $1', [user.id]);
    assert.equal(rows[0].ownership_split, null);
    await pool.query('UPDATE debts SET ownership_split = $1 WHERE user_id = $2', [JSON.stringify({ 1: 0.6, 2: 0.4 }), user.id]);
    ({ rows } = await pool.query('SELECT ownership_split FROM debts WHERE user_id = $1', [user.id]));
    assert.equal(rows[0].ownership_split['1'], 0.6);
});

test('plan_settings accepts a nullable budget_categories jsonb', async () => {
    await resetDb();
    const user = await createTestUser();
    await pool.query('INSERT INTO plan_settings (user_id) VALUES ($1)', [user.id]);
    let { rows } = await pool.query('SELECT budget_categories FROM plan_settings WHERE user_id = $1', [user.id]);
    assert.equal(rows[0].budget_categories, null);
    await pool.query('UPDATE plan_settings SET budget_categories = $1 WHERE user_id = $2', [JSON.stringify({ Housing: { mode: 'fixed', amount: 2000 } }), user.id]);
    ({ rows } = await pool.query('SELECT budget_categories FROM plan_settings WHERE user_id = $1', [user.id]));
    assert.equal(rows[0].budget_categories.Housing.amount, 2000);
});

// #568: transfers CHECK constraint (migration 1755600000034).
async function transferFixture() {
    await resetDb();
    const user = await createTestUser();
    const a = (await pool.query("INSERT INTO accounts (user_id, name, type) VALUES ($1, 'A', 'checking') RETURNING id", [user.id])).rows[0].id;
    const b = (await pool.query("INSERT INTO accounts (user_id, name, type) VALUES ($1, 'B', 'savings') RETURNING id", [user.id])).rows[0].id;
    return { user, a, b };
}
const insertTransfer = (userId, from, to, amount) => pool.query(
    "INSERT INTO transfers (user_id, from_account_id, to_account_id, amount, date) VALUES ($1, $2, $3, $4, '2026-08-01') RETURNING id",
    [userId, from, to, amount]);

test('transfers CHECK: invalid inserts fail with a check violation, valid ones pass', async () => {
    const { user, a, b } = await transferFixture();
    await assert.rejects(insertTransfer(user.id, a, a, 5), { code: '23514' });
    await assert.rejects(insertTransfer(user.id, a, b, 0), { code: '23514' });
    await assert.rejects(insertTransfer(user.id, a, b, -5), { code: '23514' });
    await assert.rejects(insertTransfer(user.id, a, b, 'NaN'), { code: '23514' });
    await insertTransfer(user.id, a, b, 5);
});

test('transfers CHECK: deleting accounts (SET NULL, even both sides) still works', async () => {
    const { user, a, b } = await transferFixture();
    const { rows } = await insertTransfer(user.id, a, b, 5);
    await pool.query('DELETE FROM accounts WHERE id = $1', [a]);
    await pool.query('DELETE FROM accounts WHERE id = $1', [b]);
    const t = (await pool.query('SELECT from_account_id, to_account_id FROM transfers WHERE id = $1', [rows[0].id])).rows[0];
    assert.equal(t.from_account_id, null);
    assert.equal(t.to_account_id, null);
});

test('transfers CHECK: deleting an account still works when a legacy invalid transfer references it', async () => {
    const { user, a, b } = await transferFixture();
    const mig = await import('../migrations/1755600000034_add-transfer-checks.js');
    const run = async (fn) => { const stmts = []; await fn({ sql: s => stmts.push(s) }); for (const s of stmts) await pool.query(s); };
    await run(mig.down);
    try {
        const neg = (await insertTransfer(user.id, a, b, -5)).rows[0].id; // legacy: negative amount
        const same = (await insertTransfer(user.id, b, b, 7)).rows[0].id; // legacy: same account
        await run(mig.up);
        await pool.query('DELETE FROM accounts WHERE id = $1', [a]); // SET NULL rewrite of `neg`
        await pool.query('DELETE FROM accounts WHERE id = $1', [b]); // SET NULL rewrite of both
        const left = (await pool.query('SELECT id, from_account_id, to_account_id FROM transfers WHERE id = ANY($1) ORDER BY id', [[neg, same]])).rows;
        assert.deepEqual(left.map(r => [r.from_account_id, r.to_account_id]), [[null, null], [null, null]]);
    } finally {
        await run(mig.up);
        await resetDb();
    }
});

test('transfers CHECK migration: down then up is clean, up is idempotent, and an existing invalid row does not block it (NOT VALID)', async () => {
    const { user, a } = await transferFixture();
    const mig = await import('../migrations/1755600000034_add-transfer-checks.js');
    const run = async (fn) => {
        const stmts = [];
        await fn({ sql: s => stmts.push(s) });
        for (const s of stmts) await pool.query(s);
    };
    const exists = async () => (await pool.query(
        "SELECT 1 FROM pg_constraint WHERE conname = 'transfers_amount_positive_distinct_accounts'")).rowCount === 1;
    assert.equal(await exists(), true);
    await run(mig.up); // idempotent
    await run(mig.down);
    assert.equal(await exists(), false);
    await run(mig.down); // down is idempotent too
    await insertTransfer(user.id, a, a, -9); // legacy invalid row
    await run(mig.up); // must not scan it
    assert.equal(await exists(), true);
    await assert.rejects(insertTransfer(user.id, a, a, 5), { code: '23514' });
    const { rows } = await pool.query('SELECT convalidated FROM pg_constraint WHERE conname = $1', ['transfers_amount_positive_distinct_accounts']);
    assert.equal(rows[0].convalidated, false);
    await resetDb();
});

// #290: bonus annual recurrence (migration 1755600000035).
test('bonus recurrence migration: columns exist with defaults, up is idempotent, down is clean', async () => {
    await resetDb();
    const user = await createTestUser();
    const mig = await import('../migrations/1755600000035_add-bonus-annual-recurrence.js');
    const run = async (fn) => {
        const stmts = [];
        await fn({ sql: s => stmts.push(s) });
        for (const s of stmts) await pool.query(s);
    };
    const cols = async () => (await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'bonuses' AND column_name IN ('recurring_annually','recur_until')")).rowCount;
    try {
        assert.equal(await cols(), 2);
        await run(mig.up); // idempotent
        const { rows } = await pool.query(
            "INSERT INTO bonuses (user_id, name, amount, date) VALUES ($1, 'B', 1, '2026-12-01') RETURNING recurring_annually, recur_until", [user.id]);
        assert.equal(rows[0].recurring_annually, false);
        assert.equal(rows[0].recur_until, null);
        await run(mig.down);
        assert.equal(await cols(), 0);
        await run(mig.down); // down is idempotent too
        await pool.query("INSERT INTO bonuses (user_id, name, amount, date) VALUES ($1, 'C', 1, '2026-12-01')", [user.id]);
    } finally {
        await run(mig.up);
        await resetDb();
    }
    assert.equal(await cols(), 2);
});
