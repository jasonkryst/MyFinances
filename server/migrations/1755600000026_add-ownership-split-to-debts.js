export const shorthands = undefined;

export async function up(pgm) {
    // #272: nullable { "<personId>": fraction } map. NULL = equal share among
    // person_ids (what every pre-existing debt keeps).
    pgm.sql(`ALTER TABLE debts ADD COLUMN ownership_split jsonb;`);
}

// MIGRATION SAFETY NOTE: down() drops the column, which permanently discards
// every saved custom ownership split (debts fall back to equal shares).
// Accepted trade-off: the split is small, easily re-entered data and the
// frontend works fine without it.
export async function down(pgm) {
    pgm.sql(`ALTER TABLE debts DROP COLUMN ownership_split;`);
}
