export const shorthands = undefined;

export async function up(pgm) {
    pgm.sql(`
        ALTER TABLE accounts
            ADD COLUMN retirement_subtype text NOT NULL DEFAULT 'Other',
            ADD COLUMN rate_of_return numeric NOT NULL DEFAULT 0,
            ADD COLUMN employer_match_percent numeric NOT NULL DEFAULT 0;

        ALTER TABLE accounts
            ADD CONSTRAINT accounts_retirement_subtype_check
                CHECK (retirement_subtype IN ('401k', 'Traditional IRA', 'Roth IRA', 'HSA', 'Other'));

        CREATE TABLE retirement_snapshots (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            date date NOT NULL,
            balance numeric NOT NULL DEFAULT 0,
            contribution numeric NOT NULL DEFAULT 0
        );

        CREATE INDEX idx_retirement_snapshots_user_id ON retirement_snapshots (user_id);
        CREATE INDEX idx_retirement_snapshots_account_id ON retirement_snapshots (account_id);

        ALTER TABLE plan_settings ADD COLUMN retirement_target_date date;
    `);
}

export async function down(pgm) {
    pgm.sql(`
        ALTER TABLE plan_settings DROP COLUMN retirement_target_date;
        DROP TABLE retirement_snapshots;
        ALTER TABLE accounts DROP CONSTRAINT accounts_retirement_subtype_check;
        ALTER TABLE accounts
            DROP COLUMN retirement_subtype,
            DROP COLUMN rate_of_return,
            DROP COLUMN employer_match_percent;
    `);
}
