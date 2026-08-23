export const shorthands = undefined;

export async function up(pgm) {
    pgm.sql(`
        CREATE TABLE net_worth_snapshots (
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            date date NOT NULL,
            total_assets numeric NOT NULL DEFAULT 0,
            total_liabilities numeric NOT NULL DEFAULT 0,
            net_worth numeric NOT NULL DEFAULT 0,
            debt_payment_made numeric NOT NULL DEFAULT 0,
            income_received numeric NOT NULL DEFAULT 0,
            source text NOT NULL DEFAULT 'auto',
            PRIMARY KEY (user_id, date)
        );

        CREATE TABLE settings (
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            key text NOT NULL,
            value jsonb NOT NULL,
            PRIMARY KEY (user_id, key)
        );

        CREATE TABLE ledger_amount_overrides (
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            override_key text NOT NULL,
            amount numeric NOT NULL,
            original_amount numeric,
            transaction_name text,
            account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            date date,
            updated_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (user_id, override_key)
        );
    `);
}

export async function down(pgm) {
    pgm.sql(`DROP TABLE ledger_amount_overrides; DROP TABLE settings; DROP TABLE net_worth_snapshots;`);
}
