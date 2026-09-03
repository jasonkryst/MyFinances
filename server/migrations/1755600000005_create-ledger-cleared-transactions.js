export const shorthands = undefined;

export async function up(pgm) {
    pgm.sql(`
        CREATE TABLE ledger_cleared_transactions (
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            cleared_key text NOT NULL,
            cleared_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (user_id, cleared_key)
        );
    `);
}

export async function down(pgm) {
    pgm.sql(`DROP TABLE ledger_cleared_transactions;`);
}
