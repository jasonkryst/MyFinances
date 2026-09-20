export const shorthands = undefined;

export async function up(pgm) {
    pgm.sql(`
        ALTER TABLE debts ADD COLUMN archived boolean NOT NULL DEFAULT false;
    `);
}

export async function down(pgm) {
    pgm.sql(`
        ALTER TABLE debts DROP COLUMN archived;
    `);
}
