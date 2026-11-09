export const shorthands = undefined;

// Optimistic concurrency (issue #578): every createCrudResource table gets a
// row version. crudRouter increments it on each PATCH and, when the client
// sends the version it last saw, refuses a stale write with 409. IF NOT EXISTS
// keeps this safe to re-run or renumber.
const ROW_VERSION_TABLES = [
    'accounts', 'balance_history', 'bills', 'bonuses', 'debts', 'emergency_funds',
    'expenses', 'incomes', 'persons', 'plan_history', 'reconciliations',
    'recurring_templates', 'retirement_snapshots', 'sinking_funds', 'transfers',
];

export async function up(pgm) {
    for (const table of ROW_VERSION_TABLES) {
        pgm.sql(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;`);
    }
}

// MIGRATION SAFETY NOTE: down() drops only the row_version counters. No user
// data is lost; a later up() starts every row at 1 again, and an open tab's
// next versioned PATCH may 409 once and then succeed after its merge/retry.
export async function down(pgm) {
    for (const table of ROW_VERSION_TABLES) {
        pgm.sql(`ALTER TABLE ${table} DROP COLUMN IF EXISTS row_version;`);
    }
}
