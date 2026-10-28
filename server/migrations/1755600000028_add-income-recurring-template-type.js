export const shorthands = undefined;

// Issue #252: 'income' joins subscription/reimbursement/transfer as a
// recurring-template type. Must stay in sync with sanitizeRecurringTemplate()
// in src/sanitizers.js.
export async function up(pgm) {
    pgm.sql(`
        ALTER TABLE recurring_templates DROP CONSTRAINT recurring_templates_type_check;
        ALTER TABLE recurring_templates
            ADD CONSTRAINT recurring_templates_type_check
                CHECK (type IN ('subscription', 'reimbursement', 'transfer', 'income'));
    `);
}

// This alters a populated table: rows with type='income' would violate the
// restored constraint, so map them to 'reimbursement' (identical inflow
// semantics in the ledger) first. Rollback never fails and never deletes rows.
export async function down(pgm) {
    pgm.sql(`
        UPDATE recurring_templates SET type = 'reimbursement' WHERE type = 'income';
        ALTER TABLE recurring_templates DROP CONSTRAINT recurring_templates_type_check;
        ALTER TABLE recurring_templates
            ADD CONSTRAINT recurring_templates_type_check
                CHECK (type IN ('subscription', 'reimbursement', 'transfer'));
    `);
}
