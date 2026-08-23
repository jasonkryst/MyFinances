export const shorthands = undefined;

export async function up(pgm) {
    pgm.sql(`
        CREATE TABLE debts (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            name text NOT NULL,
            category text,
            debt_type text NOT NULL DEFAULT 'creditCard',
            priority integer,
            account_balance numeric NOT NULL DEFAULT 0,
            original_balance numeric NOT NULL DEFAULT 0,
            interest_rate numeric NOT NULL DEFAULT 0,
            minimum_payment numeric NOT NULL DEFAULT 0,
            original_minimum_payment numeric NOT NULL DEFAULT 0,
            due_date integer,
            debt_start_date date,
            fixed_amount numeric,
            fixed_start_date date,
            fixed_end_date date,
            updated_at timestamptz
        );

        CREATE TABLE recurring_templates (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            target_account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            name text NOT NULL,
            type text NOT NULL DEFAULT 'subscription',
            amount numeric NOT NULL DEFAULT 0,
            frequency text NOT NULL DEFAULT 'monthly',
            day_of_month integer,
            category text NOT NULL DEFAULT 'Other',
            start_date date,
            end_date date,
            paused boolean NOT NULL DEFAULT false,
            skipped_months text[] NOT NULL DEFAULT '{}',
            paid_months text[] NOT NULL DEFAULT '{}'
        );

        CREATE TABLE emergency_funds (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            target_amount numeric NOT NULL DEFAULT 0,
            current_amount numeric NOT NULL DEFAULT 0,
            monthly_contribution numeric NOT NULL DEFAULT 0,
            auto_contribute boolean NOT NULL DEFAULT false,
            notes text
        );

        CREATE TABLE sinking_funds (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            name text NOT NULL,
            allocation_method text NOT NULL DEFAULT 'fixed',
            monthly_allocation numeric NOT NULL DEFAULT 0,
            target_amount numeric NOT NULL DEFAULT 0,
            current_amount numeric NOT NULL DEFAULT 0,
            auto_contribute boolean NOT NULL DEFAULT false,
            notes text
        );

        CREATE TABLE reconciliations (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            date date NOT NULL,
            previous_balance numeric NOT NULL DEFAULT 0,
            statement_balance numeric NOT NULL,
            difference numeric NOT NULL DEFAULT 0,
            note text,
            created_at timestamptz NOT NULL DEFAULT now()
        );
    `);
}

export async function down(pgm) {
    pgm.sql(`DROP TABLE reconciliations; DROP TABLE sinking_funds; DROP TABLE emergency_funds; DROP TABLE recurring_templates; DROP TABLE debts;`);
}
