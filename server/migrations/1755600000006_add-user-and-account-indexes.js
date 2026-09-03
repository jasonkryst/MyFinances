export const shorthands = undefined;

// Every SELECT/UPDATE/DELETE issued by crudRouter.js and keyedRouter.js filters
// on `user_id`, and every account-linked table is scanned on ON DELETE SET NULL
// when an account is removed. None of that was indexed (see H1,
// docs/audit/database/DATABASE_AUDIT_2026-09-02.md) -- tables whose primary key
// already leads with `user_id` (net_worth_snapshots, settings,
// ledger_amount_overrides, ledger_cleared_transactions,
// net_worth_milestones_awarded, plan_settings) are skipped here since a
// multi-column btree PK index already serves single-column `user_id` lookups.
export async function up(pgm) {
    pgm.sql(`
        CREATE INDEX idx_sessions_user_id ON sessions (user_id);

        CREATE INDEX idx_accounts_user_id ON accounts (user_id);

        CREATE INDEX idx_bills_user_id ON bills (user_id);
        CREATE INDEX idx_bills_account_id ON bills (account_id);

        CREATE INDEX idx_expenses_user_id ON expenses (user_id);
        CREATE INDEX idx_expenses_account_id ON expenses (account_id);

        CREATE INDEX idx_incomes_user_id ON incomes (user_id);
        CREATE INDEX idx_incomes_account_id ON incomes (account_id);

        CREATE INDEX idx_bonuses_user_id ON bonuses (user_id);
        CREATE INDEX idx_bonuses_account_id ON bonuses (account_id);

        CREATE INDEX idx_debts_user_id ON debts (user_id);
        CREATE INDEX idx_debts_account_id ON debts (account_id);

        CREATE INDEX idx_recurring_templates_user_id ON recurring_templates (user_id);
        CREATE INDEX idx_recurring_templates_account_id ON recurring_templates (account_id);
        CREATE INDEX idx_recurring_templates_target_account_id ON recurring_templates (target_account_id);

        CREATE INDEX idx_emergency_funds_user_id ON emergency_funds (user_id);
        CREATE INDEX idx_emergency_funds_account_id ON emergency_funds (account_id);

        CREATE INDEX idx_sinking_funds_user_id ON sinking_funds (user_id);
        CREATE INDEX idx_sinking_funds_account_id ON sinking_funds (account_id);

        CREATE INDEX idx_reconciliations_user_id ON reconciliations (user_id);
        CREATE INDEX idx_reconciliations_account_id ON reconciliations (account_id);

        CREATE INDEX idx_ledger_amount_overrides_account_id ON ledger_amount_overrides (account_id);
    `);
}

export async function down(pgm) {
    pgm.sql(`
        DROP INDEX idx_ledger_amount_overrides_account_id;
        DROP INDEX idx_reconciliations_account_id;
        DROP INDEX idx_reconciliations_user_id;
        DROP INDEX idx_sinking_funds_account_id;
        DROP INDEX idx_sinking_funds_user_id;
        DROP INDEX idx_emergency_funds_account_id;
        DROP INDEX idx_emergency_funds_user_id;
        DROP INDEX idx_recurring_templates_target_account_id;
        DROP INDEX idx_recurring_templates_account_id;
        DROP INDEX idx_recurring_templates_user_id;
        DROP INDEX idx_debts_account_id;
        DROP INDEX idx_debts_user_id;
        DROP INDEX idx_bonuses_account_id;
        DROP INDEX idx_bonuses_user_id;
        DROP INDEX idx_incomes_account_id;
        DROP INDEX idx_incomes_user_id;
        DROP INDEX idx_expenses_account_id;
        DROP INDEX idx_expenses_user_id;
        DROP INDEX idx_bills_account_id;
        DROP INDEX idx_bills_user_id;
        DROP INDEX idx_accounts_user_id;
        DROP INDEX idx_sessions_user_id;
    `);
}
