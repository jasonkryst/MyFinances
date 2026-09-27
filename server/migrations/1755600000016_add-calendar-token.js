export const shorthands = undefined;

export async function up(pgm) {
    pgm.sql(`ALTER TABLE plan_settings ADD COLUMN calendar_token text;`);
}

export async function down(pgm) {
    pgm.sql(`ALTER TABLE plan_settings DROP COLUMN calendar_token;`);
}
