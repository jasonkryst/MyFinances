export const shorthands = undefined;

// #286: free-text account notes (max 500 chars, enforced by sanitizeAccount).
// #451: catchUpEligible / hsaCoverageType were added to sanitizeAccount for the
// Retirement page but never given columns, so the Postgres backend silently
// dropped them. IF NOT EXISTS keeps this safe to re-run.
export async function up(pgm) {
    pgm.sql(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';`);
    pgm.sql(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS catch_up_eligible boolean NOT NULL DEFAULT false;`);
    pgm.sql(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS hsa_coverage_type text NOT NULL DEFAULT 'selfOnly';`);
}

// MIGRATION SAFETY NOTE: down() drops the three columns, which permanently
// discards every saved account note, catch-up flag and HSA coverage choice on
// the Postgres backend. Accepted trade-off: all three are small, easily
// re-entered values and the frontend works without them.
export async function down(pgm) {
    pgm.sql(`ALTER TABLE accounts DROP COLUMN IF EXISTS hsa_coverage_type;`);
    pgm.sql(`ALTER TABLE accounts DROP COLUMN IF EXISTS catch_up_eligible;`);
    pgm.sql(`ALTER TABLE accounts DROP COLUMN IF EXISTS notes;`);
}
