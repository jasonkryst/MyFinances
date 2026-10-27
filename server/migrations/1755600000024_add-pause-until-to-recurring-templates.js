export async function up(pgm) {
    pgm.sql(`ALTER TABLE recurring_templates ADD COLUMN IF NOT EXISTS pause_until date`);
}

export async function down(pgm) {
    pgm.sql(`ALTER TABLE recurring_templates DROP COLUMN IF EXISTS pause_until`);
}
