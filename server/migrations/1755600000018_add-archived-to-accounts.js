export async function up(pgm) {
    pgm.sql(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE`);
}

export async function down(pgm) {
    pgm.sql(`ALTER TABLE accounts DROP COLUMN IF EXISTS archived`);
}
