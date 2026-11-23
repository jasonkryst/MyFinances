export const shorthands = undefined;

// #679: an optional, inclusive end date on incomes, so a stopped income
// keeps its past paydays instead of being deleted. Idempotent.
export async function up(pgm) {
    pgm.sql('ALTER TABLE incomes ADD COLUMN IF NOT EXISTS end_date date;');
}

// MIGRATION SAFETY NOTE: rolling back drops the column, so every end date is
// lost and those incomes project paydays again from then on.
export async function down(pgm) {
    pgm.sql('ALTER TABLE incomes DROP COLUMN IF EXISTS end_date;');
}
