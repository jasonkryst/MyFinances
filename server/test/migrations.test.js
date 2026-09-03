import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db.js';
import { resetDb, createTestUser } from './helpers/testDb.js';

after(() => pool.end());

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
        ledger_amount_overrides: ['account_id']
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
