export const shorthands = undefined;

export async function up(pgm) {
    pgm.sql(`
        CREATE TABLE accounts (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name text NOT NULL,
            type text NOT NULL DEFAULT 'Other',
            starting_balance numeric NOT NULL DEFAULT 0,
            interest_rate numeric NOT NULL DEFAULT 0
        );

        CREATE TABLE bills (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            name text NOT NULL,
            amount numeric NOT NULL DEFAULT 0,
            due_day integer,
            category text NOT NULL DEFAULT 'Other'
        );

        CREATE TABLE expenses (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            name text NOT NULL,
            budget_amount numeric NOT NULL DEFAULT 0,
            date date,
            category text NOT NULL DEFAULT 'Other'
        );

        CREATE TABLE incomes (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            name text NOT NULL,
            amount numeric NOT NULL DEFAULT 0,
            first_pay_date date,
            frequency text NOT NULL DEFAULT 'biweekly'
        );

        CREATE TABLE bonuses (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            name text NOT NULL,
            amount numeric NOT NULL DEFAULT 0,
            date date,
            category text NOT NULL DEFAULT 'Other',
            purpose text CHECK (purpose IN ('cashFlow', 'savings'))
        );
    `);
}

export async function down(pgm) {
    pgm.sql(`DROP TABLE bonuses; DROP TABLE incomes; DROP TABLE expenses; DROP TABLE bills; DROP TABLE accounts;`);
}
