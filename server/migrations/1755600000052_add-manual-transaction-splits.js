export const shorthands = undefined;

// #688: a manual transaction can be split across several categories. The
// splits are `[{ category, amount, memo? }]` summing exactly to the amount;
// NULL means an ordinary single-category record. Idempotent.
export async function up(pgm) {
    pgm.sql('ALTER TABLE manual_transactions ADD COLUMN IF NOT EXISTS splits jsonb;');
}

// MIGRATION SAFETY NOTE: rolling back drops the column, so every saved split
// is lost; each transaction keeps its total amount and its single category.
export async function down(pgm) {
    pgm.sql('ALTER TABLE manual_transactions DROP COLUMN IF EXISTS splits;');
}
