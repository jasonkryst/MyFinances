export const shorthands = undefined;

// #680: a sinking fund's goal date, so the monthly amount it needs can be
// recomputed as time passes and money is added. Nullable: only the
// target_date method has one. Idempotent.
export async function up(pgm) {
    pgm.sql('ALTER TABLE sinking_funds ADD COLUMN IF NOT EXISTS target_date date;');
}

// MIGRATION SAFETY NOTE: rolling back drops the column, so every saved goal
// date is lost; the funds keep their stored monthly allocation.
export async function down(pgm) {
    pgm.sql('ALTER TABLE sinking_funds DROP COLUMN IF EXISTS target_date;');
}
