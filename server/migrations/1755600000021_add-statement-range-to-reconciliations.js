// Issue #275: bank statement start/end dates. Nullable so pre-existing rows
// (which only ever recorded a single date) stay valid; down() only drops the
// two new columns and leaves every pre-existing reconciliation row intact.
export async function up(pgm) {
    pgm.sql(`
        ALTER TABLE reconciliations ADD COLUMN IF NOT EXISTS statement_start_date date;
        ALTER TABLE reconciliations ADD COLUMN IF NOT EXISTS statement_end_date date;
    `);
}

export async function down(pgm) {
    pgm.sql(`
        ALTER TABLE reconciliations DROP COLUMN IF EXISTS statement_end_date;
        ALTER TABLE reconciliations DROP COLUMN IF EXISTS statement_start_date;
    `);
}
