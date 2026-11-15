export const shorthands = undefined;

// Index the incomes.person_id foreign key (issue #535). Migration 015 added
// the column with ON DELETE SET NULL but no index, so deleting a person
// scanned incomes. Idempotent so a renumber or re-run is safe.
//
// MIGRATION SAFETY NOTE: no data is touched; down() only drops the index.

export async function up(pgm) {
    pgm.sql('CREATE INDEX IF NOT EXISTS idx_incomes_person_id ON incomes (person_id);');
}

export async function down(pgm) {
    pgm.sql('DROP INDEX IF EXISTS idx_incomes_person_id;');
}
