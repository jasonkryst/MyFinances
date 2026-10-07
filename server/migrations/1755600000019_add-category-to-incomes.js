export async function up(pgm) {
    pgm.sql(`ALTER TABLE incomes ADD COLUMN IF NOT EXISTS category VARCHAR(30) NOT NULL DEFAULT 'Salary'`);
}

export async function down(pgm) {
    pgm.sql(`ALTER TABLE incomes DROP COLUMN IF EXISTS category`);
}
