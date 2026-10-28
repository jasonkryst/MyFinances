export const shorthands = undefined;

// Originally shipped as 1755600000026 (#272), but it merged after
// 1755600000027 (#255) had already been applied on a live deployment.
// node-pg-migrate's order check then refused to start the server
// ("Not run migration ...026 is preceding already run migration ...027").
// Renumbered to sort after every merged migration. IF NOT EXISTS / IF EXISTS
// keep it harmless anywhere the original 026 did run.
export async function up(pgm) {
    // #272: nullable { "<personId>": fraction } map. NULL = equal share among
    // person_ids (what every pre-existing debt keeps).
    pgm.sql(`ALTER TABLE debts ADD COLUMN IF NOT EXISTS ownership_split jsonb;`);
}

// MIGRATION SAFETY NOTE: down() drops the column, which permanently discards
// every saved custom ownership split (debts fall back to equal shares).
// Accepted trade-off: the split is small, easily re-entered data and the
// frontend works fine without it.
export async function down(pgm) {
    pgm.sql(`ALTER TABLE debts DROP COLUMN IF EXISTS ownership_split;`);
}
