export async function up(pgm) {
    pgm.sql(`ALTER TABLE incomes ADD COLUMN IF NOT EXISTS is_variable BOOLEAN NOT NULL DEFAULT FALSE`);
}

export async function down(pgm) {
    pgm.sql(`ALTER TABLE incomes DROP COLUMN IF EXISTS is_variable`);
}
