export async function up(pgm) {
    pgm.sql(`ALTER TABLE incomes ADD COLUMN IF NOT EXISTS withholding_percent numeric NOT NULL DEFAULT 0`);
}

export async function down(pgm) {
    pgm.sql(`ALTER TABLE incomes DROP COLUMN IF EXISTS withholding_percent`);
}
