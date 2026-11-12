export const shorthands = undefined;

// Weekend due-date shift (issue #165): recurring templates and debts carry an
// optional weekend_rule ('none' keeps the date, 'before' = Friday before,
// 'after' = Monday after). The default 'none' leaves every existing row and
// every computed date unchanged. Idempotent (IF NOT EXISTS plus a pg_constraint
// guard) so a renumber or re-run is safe.
//
// MIGRATION SAFETY NOTE: down() drops the columns, which discards each item's
// saved rule; after a rollback every due date reverts to the unshifted day.
// No other data is touched.
const TABLES = [
    { table: 'recurring_templates', constraint: 'recurring_templates_weekend_rule_check' },
    { table: 'debts', constraint: 'debts_weekend_rule_check' }
];

export async function up(pgm) {
    for (const { table, constraint } of TABLES) {
        pgm.sql(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS weekend_rule text NOT NULL DEFAULT 'none';`);
        pgm.sql(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = '${constraint}' AND conrelid = '${table}'::regclass
                ) THEN
                    ALTER TABLE ${table}
                        ADD CONSTRAINT ${constraint}
                        CHECK (weekend_rule IN ('none', 'before', 'after'));
                END IF;
            END $$;
        `);
    }
}

export async function down(pgm) {
    for (const { table, constraint } of TABLES) {
        pgm.sql(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${constraint};`);
        pgm.sql(`ALTER TABLE ${table} DROP COLUMN IF EXISTS weekend_rule;`);
    }
}
