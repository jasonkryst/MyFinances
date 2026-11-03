// Issue #456: pure new-password rules shared by the browser and the server.
const {
    PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, passwordLength, isRepetitivePassword,
    containsContextWord, isCommonPassword, validatePasswordPolicy, estimatePasswordStrength
} = require('../../src/passwordPolicy.js');

const COMMON = new Set(['password', 'iloveyou', 'dragon', 'letmein', 'trustno1', 'correcthorsebatterystaple']);

describe('constants', () => {
    test('follow NIST SP 800-63B rev 4 for a single-factor password', () => {
        expect(PASSWORD_MIN_LENGTH).toBe(15);
        expect(PASSWORD_MAX_LENGTH).toBeGreaterThanOrEqual(64);
        expect(PASSWORD_MAX_LENGTH).toBe(128);
    });
});

describe('passwordLength', () => {
    test('counts code points, so an astral emoji counts once', () => {
        expect(passwordLength('a🐢b')).toBe(3);
        expect('a🐢b'.length).toBe(4);
    });
    test('treats null/undefined as empty', () => {
        expect(passwordLength(null)).toBe(0);
        expect(passwordLength(undefined)).toBe(0);
    });
});

describe('isRepetitivePassword', () => {
    test.each([
        ['aaaaaaaaaaaaaaaa', 'one character'],
        ['ababababababababab', 'fewer than 4 distinct characters'],
        ['abcdabcdabcdabcd', 'a repeated block'],
        ['iloveyouiloveyou', 'a word typed twice'],
        ['123456789012345', 'a digit run'],
        ['zyxwvutsrqponmlk', 'a descending run'],
        ['qwertyuiopasdfgh', 'a keyboard walk'],
    ])('rejects %s (%s)', (pw) => {
        expect(isRepetitivePassword(pw)).toBe(true);
    });

    test.each([
        'correct horse battery staple',
        'violet harbor 9',
        'Zażółć gęślą jaźń 2026',
    ])('accepts %s', (pw) => {
        expect(isRepetitivePassword(pw)).toBe(false);
    });

    test('empty is not "repetitive" (the length rule handles it)', () => {
        expect(isRepetitivePassword('')).toBe(false);
    });
    test('a block repeated less than twice is not periodic', () => {
        expect(isRepetitivePassword('harbor7 harbor')).toBe(false);
    });
});

describe('containsContextWord', () => {
    test('matches the app name in any case', () => {
        expect(containsContextWord('my MyFinances key', '')).toBe(true);
        expect(containsContextWord('old DebtTracker pass', '')).toBe(true);
    });
    test('matches the email local part and the full email', () => {
        expect(containsContextWord('budgetfan rules all', 'BudgetFan@example.com')).toBe(true);
        expect(containsContextWord('x budgetfan@example.com y', 'budgetfan@example.com')).toBe(true);
    });
    test('ignores an email name shorter than 3 characters', () => {
        expect(containsContextWord('jk is not context here', 'jk@example.com')).toBe(false);
    });
    test('an email name of exactly 3 characters counts', () => {
        expect(containsContextWord('the ann arbor river', 'ann@example.com')).toBe(true);
    });
    test('no email and no app name means no match', () => {
        expect(containsContextWord('violet harbor lantern', undefined)).toBe(false);
    });
});

describe('isCommonPassword', () => {
    test('needs a list; without one nothing is common', () => {
        expect(isCommonPassword('password', null)).toBe(false);
        expect(isCommonPassword('password', {})).toBe(false);
    });
    test('matches case-insensitively', () => {
        expect(isCommonPassword('PassWord', COMMON)).toBe(true);
    });
    test('matches with spaces removed', () => {
        expect(isCommonPassword('Correct Horse Battery Staple', COMMON)).toBe(true);
    });
    test('matches the letters-only core when padded with digits/symbols', () => {
        expect(isCommonPassword('Password123456789!', COMMON)).toBe(true);
        expect(isCommonPassword('!!2024iloveyou2024!!', COMMON)).toBe(true);
    });
    test('does not match a phrase merely containing a common word', () => {
        expect(isCommonPassword('dragon fruit smoothie bowl', COMMON)).toBe(false);
    });
    test('an all-digit password has an empty core and is not "common" by core', () => {
        expect(isCommonPassword('8675309112233445', COMMON)).toBe(false);
    });
});

describe('validatePasswordPolicy', () => {
    const opts = { email: 'owner@example.com', commonPasswords: COMMON };

    test('15 characters is the minimum (boundary)', () => {
        expect(validatePasswordPolicy('fourteen chars', opts)).toBe('PASSWORD_TOO_SHORT');
        expect(validatePasswordPolicy('violet harbor 9', opts)).toBeNull();
    });
    test('128 characters is the maximum (boundary)', () => {
        const base = 'amber birch cobalt delta ember fjord granite harbor indigo juniper kestrel lagoon meadow nectar oasis prairie quartz ';
        const p128 = (base + base).slice(0, 128);
        expect(validatePasswordPolicy(p128, opts)).toBeNull();
        expect(validatePasswordPolicy(p128 + 'x', opts)).toBe('PASSWORD_TOO_LONG');
    });
    test('spaces and any Unicode are allowed, with no composition rules', () => {
        expect(validatePasswordPolicy('all lowercase words here', opts)).toBeNull();
        expect(validatePasswordPolicy('Zażółć gęślą jaźń 2026', opts)).toBeNull();
    });
    test('non-strings are rejected as too short', () => {
        expect(validatePasswordPolicy(undefined, opts)).toBe('PASSWORD_TOO_SHORT');
        expect(validatePasswordPolicy(123456789012345678, opts)).toBe('PASSWORD_TOO_SHORT');
    });
    test('rules run in order: repetition, then common, then context', () => {
        expect(validatePasswordPolicy('123456789012345', opts)).toBe('PASSWORD_REPETITIVE');
        expect(validatePasswordPolicy('Password123456789!', opts)).toBe('PASSWORD_COMMON');
        expect(validatePasswordPolicy('owner of this vault', opts)).toBe('PASSWORD_CONTEXT');
    });
    test('defaults to no email and no list', () => {
        expect(validatePasswordPolicy('Password123456789!')).toBeNull();
    });
});

describe('estimatePasswordStrength', () => {
    test('a policy failure scores 0 and carries the reason', () => {
        expect(estimatePasswordStrength('short')).toEqual({ score: 0, reason: 'PASSWORD_TOO_SHORT', bits: 0 });
        expect(estimatePasswordStrength('owner of this vault', { email: 'owner@x.com' }).reason).toBe('PASSWORD_CONTEXT');
    });
    test('scores rise with variety and length', () => {
        const fair = estimatePasswordStrength('thisismysecretpass');
        const strong = estimatePasswordStrength('Correct horse, battery staple 42!');
        expect(fair.score).toBeGreaterThanOrEqual(1);
        expect(fair.score).toBeLessThan(strong.score);
        expect(strong.score).toBe(4);
        expect(strong.reason).toBeNull();
    });
    test('the four bands map to bit thresholds 60/75/100', () => {
        // 15 lowercase letters with no runs: 15 * log2(26) ~ 70.5 bits -> fair (2)
        expect(estimatePasswordStrength('qmzpxlvnkrjtwhb').score).toBe(2);
        // 21 lowercase + spaces: ~ 21 * log2(27) ~ 99.9 -> good (3)
        const good = estimatePasswordStrength('mzq vpl xkr jtw hbn fd');
        expect(good.score).toBe(3);
        expect(good.bits).toBeLessThan(100);
        // Mixed classes push well past 100 -> strong (4)
        expect(estimatePasswordStrength('Mzq vPl xKr 7tw Hbn!').score).toBe(4);
    });
    test('runs do not count toward entropy', () => {
        const withRun = estimatePasswordStrength('violet abcdefghij harbor');
        const without = estimatePasswordStrength('violet amzqpbxtrk harbor');
        expect(withRun.bits).toBeLessThan(without.bits);
    });
    test('non-Latin scripts get credit', () => {
        expect(estimatePasswordStrength('東京の夜空に光る星たちが見える').score).toBeGreaterThanOrEqual(3);
    });
    test('weak band (< 60 bits) for low-variety but policy-valid input', () => {
        // 16 digits with no runs or repeats: ~ 14 effective * log2(10) ~ 47 bits
        const r = estimatePasswordStrength('4829173650192837');
        expect(r.reason).toBeNull();
        expect(r.score).toBe(1);
    });
});
