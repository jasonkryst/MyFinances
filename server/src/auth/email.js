// Account emails are compared trimmed and case-insensitively: phone keyboards
// capitalize the first letter, autofill can add a stray space, and an address
// typed into create-user.js may differ in case from what the user types at
// sign-in. Every place that stores or looks up an account email goes through
// normalizeEmail(); lookups also compare lower(btrim(email)) so a row stored
// before this normalization (see migration 1755600000041) still matches.

export function normalizeEmail(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// SQL predicate for looking a user up by a normalizeEmail()'d value ($1).
export const EMAIL_MATCH_SQL = 'lower(btrim(email)) = $1';
