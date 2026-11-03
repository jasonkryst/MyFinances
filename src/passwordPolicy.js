// New-password rules (issue #456), after NIST SP 800-63B rev 4 §3.1.1.2.
//
// Pure and DOM-free, with no imports: the browser uses it for the strength
// meter and pre-submit checks, and the server imports it by relative path
// (server/src/auth/passwordCheck.js, like server/src/sanitizers/index.js) so
// both enforce one rule set. The server is authoritative: it alone holds the
// bundled common-password list and the optional breached-password check.
//
// NIST, in short: a 15-character minimum when the password is the only factor
// (there is no MFA here), at least 64 allowed, every printable/Unicode
// character and space allowed, no composition rules, and a blocklist of
// common, repetitive/sequential and context-specific passwords. These rules
// apply only when a password is *set* (setup, reset, change). Login never
// checks them, so an existing shorter password keeps working.

export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 128;

// Context words a password must not contain (NIST: "the name of the service,
// the username, and derivatives thereof").
const SERVICE_WORDS = ['myfinances', 'debttracker'];
// Shorter email names would match too many unrelated passwords.
const CONTEXT_MIN_LENGTH = 3;

// Length counts Unicode code points, not UTF-16 units, so an emoji or an
// astral-plane character counts as one character (NIST §3.1.1.2).
export function passwordLength(password) {
    return [...String(password ?? '')].length;
}

function contextWords(email) {
    const words = [...SERVICE_WORDS];
    const normalized = String(email ?? '').trim().toLowerCase();
    if (normalized) {
        words.push(normalized);
        const local = normalized.split('@')[0];
        if (local.length >= CONTEXT_MIN_LENGTH) words.push(local);
    }
    return words;
}

// The shortest period p such that the string is a repetition of its first p
// characters ("abcabcabc" -> 3). Returns the full length when it never repeats.
function smallestPeriod(chars) {
    for (let p = 1; p <= chars.length / 2; p++) {
        let repeats = true;
        for (let i = p; i < chars.length; i++) {
            if (chars[i] !== chars[i - p]) { repeats = false; break; }
        }
        if (repeats) return p;
    }
    return chars.length;
}

// QWERTY rows, so a keyboard walk ("qwertyuiop", "poiuy") counts like a
// one-step sequence.
const KEYBOARD_ROWS = ['`1234567890-=', 'qwertyuiop[]\\', "asdfghjkl;'", 'zxcvbnm,./'];

function isKeyboardNeighbour(a, b) {
    const pair = (a + b).toLowerCase();
    const reversed = (b + a).toLowerCase();
    return KEYBOARD_ROWS.some(row => row.includes(pair) || row.includes(reversed));
}

// Characters that don't merely repeat, step by one, or walk the keyboard from
// the previous character: "aaaa", "abcd", "4321" and "qwer" each count as 1.
function effectiveCharCount(chars) {
    let count = chars.length ? 1 : 0;
    for (let i = 1; i < chars.length; i++) {
        const diff = chars[i].codePointAt(0) - chars[i - 1].codePointAt(0);
        if ((diff < -1 || diff > 1) && !isKeyboardNeighbour(chars[i - 1], chars[i])) count++;
    }
    return count;
}

export function isRepetitivePassword(password) {
    const chars = [...String(password ?? '')];
    if (chars.length === 0) return false;
    if (new Set(chars).size < 4) return true;
    if (smallestPeriod(chars) <= chars.length / 2) return true;
    return effectiveCharCount(chars) < 6;
}

export function containsContextWord(password, email) {
    const lower = String(password ?? '').toLowerCase();
    return contextWords(email).some(word => lower.includes(word));
}

// commonPasswords: a Set of lowercase entries (the server passes the bundled
// SecLists list). The whole password and its letters-only core are checked,
// so "Password123456789!" is caught through "password".
export function isCommonPassword(password, commonPasswords) {
    if (!commonPasswords || typeof commonPasswords.has !== 'function') return false;
    const lower = String(password ?? '').toLowerCase();
    if (commonPasswords.has(lower) || commonPasswords.has(lower.replace(/\s+/g, ''))) return true;
    const core = lower.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
    return core.length > 0 && commonPasswords.has(core);
}

// Returns the first failing rule's reason code, or null when the password is
// acceptable. Order: length, repetition, common list, context words. The
// breached-password check (server only) runs after all of these.
export function validatePasswordPolicy(password, { email = '', commonPasswords = null } = {}) {
    if (typeof password !== 'string') return 'PASSWORD_TOO_SHORT';
    const length = passwordLength(password);
    if (length < PASSWORD_MIN_LENGTH) return 'PASSWORD_TOO_SHORT';
    if (length > PASSWORD_MAX_LENGTH) return 'PASSWORD_TOO_LONG';
    if (isRepetitivePassword(password)) return 'PASSWORD_REPETITIVE';
    if (isCommonPassword(password, commonPasswords)) return 'PASSWORD_COMMON';
    if (containsContextWord(password, email)) return 'PASSWORD_CONTEXT';
    return null;
}

// Advisory strength estimate for the meter; it never blocks a submit (the
// policy above does). Score 0 means a policy rule fails; 1-4 are
// weak/fair/good/strong from a rough entropy estimate over the characters that
// aren't repeats or one-step sequences.
export function estimatePasswordStrength(password, { email = '', commonPasswords = null } = {}) {
    const pw = String(password ?? '');
    const reason = validatePasswordPolicy(pw, { email, commonPasswords });
    if (reason) return { score: 0, reason, bits: 0 };

    const chars = [...pw];
    let pool = 0;
    if (/\p{Ll}/u.test(pw)) pool += 26;
    if (/\p{Lu}/u.test(pw)) pool += 26;
    if (/\p{Nd}/u.test(pw)) pool += 10;
    if (/\s/u.test(pw)) pool += 1;
    if (/[^\p{L}\p{Nd}\s]/u.test(pw)) pool += 33;
    if (chars.some(c => c.codePointAt(0) > 0x24f)) pool += 100;

    const bits = effectiveCharCount(chars) * Math.log2(Math.max(pool, 2));
    let score;
    if (bits < 60) score = 1;
    else if (bits < 75) score = 2;
    else if (bits < 100) score = 3;
    else score = 4;
    return { score, reason: null, bits: Math.round(bits) };
}
