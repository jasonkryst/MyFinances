export const shorthands = undefined;

// "Don't notify" per account: when true, the account never raises a balance
// alert (low, overdrawn or projected). Idempotent.
export async function up(pgm) {
    pgm.sql(`
        ALTER TABLE accounts ADD COLUMN IF NOT EXISTS mute_balance_alerts boolean NOT NULL DEFAULT false;
    `);
}

// MIGRATION SAFETY NOTE: rolling back drops the column, so every account's
// "Don't notify" choice is lost (alerts resume for those accounts).
export async function down(pgm) {
    pgm.sql(`
        ALTER TABLE accounts DROP COLUMN IF EXISTS mute_balance_alerts;
    `);
}
