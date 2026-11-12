export const shorthands = undefined;

// #290: annual bonuses. recurring_annually = false keeps every existing bonus
// one-time; recur_until is an optional inclusive end date for the series.
// IF NOT EXISTS keeps a renumber or a re-run harmless.
export async function up(pgm) {
    pgm.sql(`ALTER TABLE bonuses ADD COLUMN IF NOT EXISTS recurring_annually boolean NOT NULL DEFAULT false;`);
    pgm.sql(`ALTER TABLE bonuses ADD COLUMN IF NOT EXISTS recur_until date;`);
}

// MIGRATION SAFETY NOTE: down() drops both columns, which permanently
// discards every bonus's recurrence settings: annual bonuses become one-time
// again (only their first occurrence remains). Nothing else is rewritten.
export async function down(pgm) {
    pgm.sql(`ALTER TABLE bonuses DROP COLUMN IF EXISTS recur_until;`);
    pgm.sql(`ALTER TABLE bonuses DROP COLUMN IF EXISTS recurring_annually;`);
}
