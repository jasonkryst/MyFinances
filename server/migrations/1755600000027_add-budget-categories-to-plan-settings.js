export const shorthands = undefined;

export async function up(pgm) {
    pgm.sql(`ALTER TABLE plan_settings ADD COLUMN budget_categories jsonb;`);
}

// MIGRATION SAFETY NOTE: down() drops the column, which permanently discards
// every configured category budget. Accepted trade-off (issue #255): it is one
// small, easily re-entered object and the frontend defaults to {} (all
// categories derived) without it.
export async function down(pgm) {
    pgm.sql(`ALTER TABLE plan_settings DROP COLUMN budget_categories;`);
}
