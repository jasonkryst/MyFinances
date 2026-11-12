export const shorthands = undefined;

// Server-side enforcement of the transfer rules (issue #568): a transfer moves
// a positive amount between two DIFFERENT accounts. The route also rejects
// these (isValidTransfer); the constraint is the backstop for any other writer.
//
// NULL semantics: from/to are ON DELETE SET NULL, so after an account is
// deleted one or both sides can be NULL. The rule applies only while BOTH
// accounts are set: deleting an account rewrites the row through SET NULL,
// and that rewrite must pass even for a legacy row whose amount was invalid,
// or the account could never be deleted. The routes refuse a null account
// anyway (requiredFields), so nothing is lost. numeric accepts 'NaN', which
// Postgres sorts above every number, so `amount > 0` alone would let it through.
//
// NOT VALID: existing rows are not scanned or touched, only new inserts and
// updates are checked. The pg_constraint guard keeps a re-run safe. A legacy
// invalid row is checked when it is next UPDATED, so the transfers route
// validates every PATCH (a clean 400, never a 500 from this constraint).
//
// MIGRATION SAFETY NOTE: no data is rewritten or deleted. down() only drops
// the constraint, so nothing is discarded on rollback.
export async function up(pgm) {
    pgm.sql(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'transfers_amount_positive_distinct_accounts'
                  AND conrelid = 'transfers'::regclass
            ) THEN
                ALTER TABLE transfers
                    ADD CONSTRAINT transfers_amount_positive_distinct_accounts
                    CHECK (from_account_id IS NULL OR to_account_id IS NULL
                           OR (amount > 0 AND amount <> 'NaN'::numeric AND from_account_id <> to_account_id))
                    NOT VALID;
            END IF;
        END $$;
    `);
}

export async function down(pgm) {
    pgm.sql(`ALTER TABLE transfers DROP CONSTRAINT IF EXISTS transfers_amount_positive_distinct_accounts;`);
}
