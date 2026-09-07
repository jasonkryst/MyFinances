export const shorthands = undefined;

export async function up(pgm) {
    pgm.sql(`
        CREATE TABLE plan_history (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            monthly_payment numeric NOT NULL DEFAULT 0,
            strategy text,
            total_interest numeric NOT NULL DEFAULT 0,
            months_to_pay_off integer NOT NULL DEFAULT 0,
            payoff_date date,
            total_debt numeric NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE INDEX idx_plan_history_user_id ON plan_history (user_id);
    `);
}

export async function down(pgm) {
    pgm.sql(`DROP TABLE plan_history;`);
}
