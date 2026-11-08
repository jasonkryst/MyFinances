export const shorthands = undefined;

// Postgres-mode field parity (v7.0.0, server-only storage). These fields were
// emitted by the frontend sanitizers and kept by browser storage, but had no
// column here, so the server silently dropped them. IF NOT EXISTS keeps this
// safe to re-run. `sinking_funds.sort_order` avoids the reserved word ORDER.
export async function up(pgm) {
    pgm.sql(`ALTER TABLE recurring_templates ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;`);
    pgm.sql(`ALTER TABLE sinking_funds ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;`);
    pgm.sql(`ALTER TABLE sinking_funds ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;`);
    pgm.sql(`ALTER TABLE sinking_funds ADD COLUMN IF NOT EXISTS completed_date date;`);
    pgm.sql(`ALTER TABLE emergency_funds ADD COLUMN IF NOT EXISTS auto_sync_balance boolean NOT NULL DEFAULT false;`);
    pgm.sql(`ALTER TABLE ledger_amount_overrides ADD COLUMN IF NOT EXISTS memo text NOT NULL DEFAULT '';`);
    // debts.updated_at was timestamptz, which pg returns as '2026-03-04 00:00:00+00';
    // sanitizeDateISO rejects that, so the value was lost on the first PATCH/reload.
    // The app only ever stores a calendar date here, so make it a date.
    pgm.sql(`ALTER TABLE debts ALTER COLUMN updated_at TYPE date USING updated_at::date;`);
    pgm.sql(`ALTER TABLE incomes ADD COLUMN IF NOT EXISTS updated_at date;`);
    pgm.sql(`ALTER TABLE debts ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';`);
    pgm.sql(`ALTER TABLE debts ADD COLUMN IF NOT EXISTS next_payment_due date;`);
}

// MIGRATION SAFETY NOTE: down() drops only the columns added above, which
// discards the archived flags, sinking-fund order/completion dates, the
// emergency-fund auto-sync flag, income updated dates, override memos and debt
// notes/next-payment dates saved on the Postgres backend. Accepted: all are
// small, re-enterable values. debts.updated_at keeps its date type on down():
// the cast to date already dropped the time of day, which the app never used.
export async function down(pgm) {
    pgm.sql(`ALTER TABLE debts DROP COLUMN IF EXISTS next_payment_due;`);
    pgm.sql(`ALTER TABLE incomes DROP COLUMN IF EXISTS updated_at;`);
    pgm.sql(`ALTER TABLE debts DROP COLUMN IF EXISTS notes;`);
    pgm.sql(`ALTER TABLE ledger_amount_overrides DROP COLUMN IF EXISTS memo;`);
    pgm.sql(`ALTER TABLE emergency_funds DROP COLUMN IF EXISTS auto_sync_balance;`);
    pgm.sql(`ALTER TABLE sinking_funds DROP COLUMN IF EXISTS completed_date;`);
    pgm.sql(`ALTER TABLE sinking_funds DROP COLUMN IF EXISTS archived;`);
    pgm.sql(`ALTER TABLE sinking_funds DROP COLUMN IF EXISTS sort_order;`);
    pgm.sql(`ALTER TABLE recurring_templates DROP COLUMN IF EXISTS archived;`);
}
