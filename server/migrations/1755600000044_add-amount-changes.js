export const shorthands = undefined;

// #678: effective-dated amounts. Each income and recurring template keeps its
// base `amount` plus a list of `{ from, amount }` changes. Idempotent.
export async function up(pgm) {
    pgm.sql(`
        ALTER TABLE incomes ADD COLUMN IF NOT EXISTS amount_changes jsonb NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE recurring_templates ADD COLUMN IF NOT EXISTS amount_changes jsonb NOT NULL DEFAULT '[]'::jsonb;
    `);
}

// MIGRATION SAFETY NOTE: rolling back drops both columns, so every scheduled
// or past amount change is lost; incomes and recurring templates then project
// every month, past ones included, at their base amount.
export async function down(pgm) {
    pgm.sql(`
        ALTER TABLE incomes DROP COLUMN IF EXISTS amount_changes;
        ALTER TABLE recurring_templates DROP COLUMN IF EXISTS amount_changes;
    `);
}
