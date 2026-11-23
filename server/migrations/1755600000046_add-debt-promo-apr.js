export const shorthands = undefined;

// #681: a promotional APR on debts (rate + inclusive end date), optionally
// with deferred interest charged back when a balance remains at its end.
// Idempotent.
export async function up(pgm) {
    pgm.sql(`
        ALTER TABLE debts ADD COLUMN IF NOT EXISTS promo_rate numeric;
        ALTER TABLE debts ADD COLUMN IF NOT EXISTS promo_end_date date;
        ALTER TABLE debts ADD COLUMN IF NOT EXISTS deferred_interest boolean NOT NULL DEFAULT false;
        ALTER TABLE debts ADD COLUMN IF NOT EXISTS deferred_interest_accrued numeric NOT NULL DEFAULT 0;
    `);
}

// MIGRATION SAFETY NOTE: rolling back drops all four columns, so every promo
// and deferred-interest setting is lost; those debts then accrue at their
// regular interestRate in every plan.
export async function down(pgm) {
    pgm.sql(`
        ALTER TABLE debts DROP COLUMN IF EXISTS promo_rate;
        ALTER TABLE debts DROP COLUMN IF EXISTS promo_end_date;
        ALTER TABLE debts DROP COLUMN IF EXISTS deferred_interest;
        ALTER TABLE debts DROP COLUMN IF EXISTS deferred_interest_accrued;
    `);
}
