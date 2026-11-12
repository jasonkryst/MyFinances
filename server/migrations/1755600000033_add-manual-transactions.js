export const shorthands = undefined;

// Manual one-off transactions (issue #584): actuals the user enters in the
// Ledger. amount is signed (negative = money out). account_id follows every
// other account FK in this schema (ON DELETE SET NULL); the client drops
// orphans on import. IF NOT EXISTS keeps a renumber safe.
export async function up(pgm) {
    pgm.sql(`
        CREATE TABLE IF NOT EXISTS manual_transactions (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            date date NOT NULL,
            amount numeric NOT NULL,
            name text NOT NULL DEFAULT '',
            category text NOT NULL DEFAULT 'Other',
            memo text NOT NULL DEFAULT '',
            created_at timestamptz NOT NULL DEFAULT now(),
            row_version integer NOT NULL DEFAULT 1
        );

        CREATE INDEX IF NOT EXISTS idx_manual_transactions_user_id ON manual_transactions (user_id);
        CREATE INDEX IF NOT EXISTS idx_manual_transactions_account_id ON manual_transactions (account_id);
    `);
}

// MIGRATION SAFETY NOTE: down() drops the table and every manual transaction
// in it. Export a JSON backup first if you need to roll back with data.
export async function down(pgm) {
    pgm.sql(`DROP TABLE IF EXISTS manual_transactions;`);
}
