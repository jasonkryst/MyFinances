export const shorthands = undefined;

// Server-side enforcement of the transfer rules (issue #568): a transfer moves
// a positive amount between two DIFFERENT accounts. The route also rejects
// these (isValidTransfer); the constraint is the backstop for any other writer.
//
// NULL semantics: from/to are ON DELETE SET NULL, so after an account is
// deleted one or both sides can be NULL. `<>` yields NULL (unknown) when
// either side is NULL, and a CHECK passes on unknown, so account deletion
// still works. `IS DISTINCT FROM` would NOT do: two NULLs are "not distinct",
// so it would fail the check when both accounts are gone. numeric accepts
// 'NaN', which Postgres sorts above every number, so `amount > 0` alone
// would let it through.
//
// NOT VALID: existing rows are not scanned or touched, only new inserts and
// updates are checked. The pg_constraint guard keeps a re-run safe.
// Caveat: a pre-existing invalid row is checked when it is next UPDATED
// (including the SET NULL rewrite when one of its accounts is deleted).
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
                    CHECK (amount > 0 AND amount <> 'NaN'::numeric AND from_account_id <> to_account_id)
                    NOT VALID;
            END IF;
        END $$;
    `);
}

export async function down(pgm) {
    pgm.sql(`ALTER TABLE transfers DROP CONSTRAINT IF EXISTS transfers_amount_positive_distinct_accounts;`);
}
