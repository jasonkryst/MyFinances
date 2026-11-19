export const shorthands = undefined;

// Account emails are now stored trimmed and lowercase (server/src/auth/email.js):
// sign-in is case-insensitive, and an address saved with a capital letter or a
// stray space used to make every login fail with "invalid email or password".
// Rewrites existing rows the same way, skipping any row whose normalized form
// would collide with another account (it still matches at sign-in, since
// lookups compare lower(btrim(email))). Idempotent: a second run changes
// nothing.
export async function up(pgm) {
    pgm.sql(`
        UPDATE users u
           SET email = lower(btrim(u.email))
         WHERE u.email <> lower(btrim(u.email))
           AND NOT EXISTS (
                SELECT 1 FROM users o
                 WHERE o.id <> u.id AND lower(btrim(o.email)) = lower(btrim(u.email))
           );
    `);
}

// MIGRATION SAFETY NOTE: down() does nothing. The original capitalization and
// spacing are not kept, and none is needed: sign-in compares case-insensitively
// either way.
export async function down() {}
