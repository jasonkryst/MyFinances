export const shorthands = undefined;

// #312: per-debt results on each Plan History entry, for the per-debt
// comparison. Older entries keep an empty list. Idempotent.
export async function up(pgm) {
    pgm.sql(`ALTER TABLE plan_history ADD COLUMN IF NOT EXISTS debts jsonb NOT NULL DEFAULT '[]'::jsonb;`);
}

// MIGRATION SAFETY NOTE: rolling back drops the column, so the per-debt
// results of every saved plan are lost; the history keeps its totals and the
// comparison shows "no per-debt data" for every entry.
export async function down(pgm) {
    pgm.sql('ALTER TABLE plan_history DROP COLUMN IF EXISTS debts;');
}
