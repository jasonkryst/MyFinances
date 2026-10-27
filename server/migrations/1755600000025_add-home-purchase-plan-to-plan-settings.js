export const shorthands = undefined;

export async function up(pgm) {
    pgm.sql(`ALTER TABLE plan_settings ADD COLUMN home_purchase_plan jsonb;`);
}

// MIGRATION SAFETY NOTE: this is the first migration that alters a populated
// table. down() drops the column outright, which permanently discards every
// saved Home Purchase plan. Accepted trade-off: the plan is a single small,
// easily re-entered object, and the frontend works fine without it.
export async function down(pgm) {
    pgm.sql(`ALTER TABLE plan_settings DROP COLUMN home_purchase_plan;`);
}
