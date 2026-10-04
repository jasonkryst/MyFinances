export const shorthands = undefined;

// First migration that alters a populated table (accounts). ADD COLUMN with a
// constant NOT NULL DEFAULT is safe forward: existing rows are backfilled with
// 0. down() drops the column, discarding any user-entered account minimum
// payments -- accepted because the field is informational and new in this
// migration (see docs/superpowers/specs/2026-09-28-balance-history-design.md).
export async function up(pgm) {
    pgm.sql(`
        ALTER TABLE accounts ADD COLUMN minimum_payment numeric NOT NULL DEFAULT 0;

        CREATE TABLE balance_history (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            debt_id bigint REFERENCES debts(id) ON DELETE CASCADE,
            account_id bigint REFERENCES accounts(id) ON DELETE CASCADE,
            date date NOT NULL,
            balance numeric,
            minimum_payment numeric NOT NULL DEFAULT 0,
            CONSTRAINT balance_history_one_owner CHECK ((debt_id IS NULL) <> (account_id IS NULL))
        );

        CREATE INDEX idx_balance_history_user_id ON balance_history (user_id);
        CREATE INDEX idx_balance_history_debt_id ON balance_history (debt_id);
        CREATE INDEX idx_balance_history_account_id ON balance_history (account_id);
    `);
}

export async function down(pgm) {
    pgm.sql(`
        DROP TABLE balance_history;
        ALTER TABLE accounts DROP COLUMN minimum_payment;
    `);
}
