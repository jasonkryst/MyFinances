export const shorthands = undefined;

// bonuses.purpose already has a CHECK constraint matching its sanitizer's
// allow-list (server/migrations/1755600000001_create-first-crud-tables.js:52);
// these enum-shaped columns didn't, so DB-level integrity depended entirely on
// every write path remembering to sanitize (M3,
// docs/audit/database/DATABASE_AUDIT_2026-09-02.md). Allow-lists here must
// stay in sync with their sanitizers in src/sanitizers.js.
export async function up(pgm) {
    pgm.sql(`
        ALTER TABLE recurring_templates
            ADD CONSTRAINT recurring_templates_frequency_check
                CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
            ADD CONSTRAINT recurring_templates_type_check
                CHECK (type IN ('subscription', 'reimbursement', 'transfer'));

        ALTER TABLE sinking_funds
            ADD CONSTRAINT sinking_funds_allocation_method_check
                CHECK (allocation_method IN ('fixed', 'annual', 'target_date'));

        ALTER TABLE incomes
            ADD CONSTRAINT incomes_frequency_check
                CHECK (frequency IN ('weekly', 'biweekly', 'bi-weekly', 'twice_monthly', 'monthly'));
    `);
}

export async function down(pgm) {
    pgm.sql(`
        ALTER TABLE incomes DROP CONSTRAINT incomes_frequency_check;
        ALTER TABLE sinking_funds DROP CONSTRAINT sinking_funds_allocation_method_check;
        ALTER TABLE recurring_templates DROP CONSTRAINT recurring_templates_type_check;
        ALTER TABLE recurring_templates DROP CONSTRAINT recurring_templates_frequency_check;
    `);
}
