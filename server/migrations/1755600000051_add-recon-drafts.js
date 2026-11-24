export const shorthands = undefined;

// #587: in-progress reconciliations ({ [accountId]: draft }), moved from the
// browser's localStorage so a review started on one device resumes on another.
// Sanitized by sanitizeReconDrafts on every PATCH. Idempotent.
export async function up(pgm) {
    pgm.sql(`ALTER TABLE plan_settings ADD COLUMN IF NOT EXISTS recon_drafts jsonb NOT NULL DEFAULT '{}'::jsonb;`);
}

// MIGRATION SAFETY NOTE: rolling back drops the column, so every saved
// in-progress reconciliation is lost (the user re-ticks the statement's
// transactions); completed reconciliations are untouched.
export async function down(pgm) {
    pgm.sql('ALTER TABLE plan_settings DROP COLUMN IF EXISTS recon_drafts;');
}
