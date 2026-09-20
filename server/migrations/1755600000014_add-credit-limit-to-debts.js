export const shorthands = undefined;

export async function up(pgm) {
    pgm.sql(`
        ALTER TABLE debts ADD COLUMN credit_limit numeric(12,2) DEFAULT NULL;
    `);
}

export async function down(pgm) {
    pgm.sql(`
        ALTER TABLE debts DROP COLUMN credit_limit;
    `);
}
