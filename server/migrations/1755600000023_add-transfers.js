export const shorthands = undefined;

export async function up(pgm) {
    pgm.sql(`
        CREATE TABLE transfers (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            from_account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            to_account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            amount numeric NOT NULL DEFAULT 0,
            date date NOT NULL,
            memo text NOT NULL DEFAULT '',
            created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE INDEX idx_transfers_user_id ON transfers (user_id);
        CREATE INDEX idx_transfers_from_account_id ON transfers (from_account_id);
        CREATE INDEX idx_transfers_to_account_id ON transfers (to_account_id);
    `);
}

export async function down(pgm) {
    pgm.sql(`DROP TABLE transfers;`);
}
