const {
    formatCurrency,
    normalizeText,
    sanitizeFiniteNumber,
    sanitizeInteger,
    parseFiniteOrNull,
    sanitizeDateISO,
    dateToISO,
    formatShortDate,
    formatMonthYear,
    dailyCompoundInterest,
} = require('../../src/utils.js');

describe('formatCurrency', () => {
    test('formats a positive amount as USD', () => {
        expect(formatCurrency(1234.5)).toBe('$1,234.50');
    });

    test('formats zero', () => {
        expect(formatCurrency(0)).toBe('$0.00');
    });
});

describe('normalizeText', () => {
    test('trims surrounding whitespace', () => {
        expect(normalizeText('  Hello World  ')).toBe('Hello World');
    });

    test('truncates to maxLen', () => {
        expect(normalizeText('a'.repeat(200), 120)).toHaveLength(120);
    });

    test('strips <, >, ", ` but does not remove tag contents', () => {
        expect(normalizeText('<script>alert(1)</script>')).toBe('scriptalert(1)/script');
    });

    test('returns empty string for null/undefined', () => {
        expect(normalizeText(null)).toBe('');
        expect(normalizeText(undefined)).toBe('');
    });

    test('coerces non-string values via String()', () => {
        expect(normalizeText(123)).toBe('123');
    });
});

describe('sanitizeFiniteNumber', () => {
    test('parses a numeric string', () => {
        expect(sanitizeFiniteNumber('42.5')).toBe(42.5);
    });

    test('falls back on non-numeric input', () => {
        expect(sanitizeFiniteNumber('abc', 99)).toBe(99);
    });

    test('falls back on NaN and Infinity', () => {
        expect(sanitizeFiniteNumber(NaN, -1)).toBe(-1);
        expect(sanitizeFiniteNumber(Infinity, 7)).toBe(7);
    });

    test('clamps to min/max', () => {
        expect(sanitizeFiniteNumber(-5, 0, { min: 0 })).toBe(0);
        expect(sanitizeFiniteNumber(500, 0, { max: 100 })).toBe(100);
    });
});

describe('sanitizeInteger', () => {
    test('parses an integer string', () => {
        expect(sanitizeInteger('42')).toBe(42);
    });

    test('truncates a float', () => {
        expect(sanitizeInteger(3.9)).toBe(3);
    });

    test('falls back on non-numeric input', () => {
        expect(sanitizeInteger('abc', null)).toBeNull();
        expect(sanitizeInteger(NaN, -1)).toBe(-1);
    });

    test('clamps to min/max', () => {
        expect(sanitizeInteger(500, null, { max: 100 })).toBe(100);
        expect(sanitizeInteger(-5, null, { min: 0 })).toBe(0);
    });
});

describe('parseFiniteOrNull', () => {
    test('parses a numeric string', () => {
        expect(parseFiniteOrNull('42')).toBe(42);
    });

    test('returns null for non-numeric or infinite input', () => {
        expect(parseFiniteOrNull('abc')).toBeNull();
        expect(parseFiniteOrNull(Infinity)).toBeNull();
        expect(parseFiniteOrNull(undefined)).toBeNull();
    });
});

describe('sanitizeDateISO', () => {
    test('accepts a well-formed YYYY-MM-DD string', () => {
        expect(sanitizeDateISO('2026-08-02')).toBe('2026-08-02');
    });

    test('returns null for empty/falsy input', () => {
        expect(sanitizeDateISO('')).toBeNull();
        expect(sanitizeDateISO(null)).toBeNull();
    });

    test('returns null for a non-ISO format', () => {
        expect(sanitizeDateISO('08/02/2026')).toBeNull();
        expect(sanitizeDateISO('not-a-date')).toBeNull();
    });
});

describe('dateToISO', () => {
    test('zero-pads single-digit month and day', () => {
        expect(dateToISO(new Date(2026, 0, 5))).toBe('2026-01-05');
    });

    test('formats a double-digit month and day', () => {
        expect(dateToISO(new Date(2026, 7, 2))).toBe('2026-08-02');
    });
});

describe('formatShortDate / formatMonthYear', () => {
    test('formatShortDate formats a bare ISO date', () => {
        expect(formatShortDate('2026-08-02')).toBe('Aug 2, 2026');
    });

    test('formatMonthYear formats a bare ISO date', () => {
        expect(formatMonthYear('2026-08-02')).toBe('Aug 2026');
    });
});

describe('dailyCompoundInterest', () => {
    test('returns 0 for 0% APR', () => {
        expect(dailyCompoundInterest(1000, 0, 30)).toBe(0);
    });

    test('returns 0 for 0 balance regardless of rate', () => {
        expect(dailyCompoundInterest(0, 12, 30)).toBe(0);
    });

    test('matches the documented daily-compounding formula for a known input', () => {
        const balance = 1000, apr = 12, days = 30;
        const expected = balance * (Math.pow(1 + apr / 100 / 365, days) - 1);
        expect(dailyCompoundInterest(balance, apr, days)).toBeCloseTo(expected, 10);
    });

    test('treats an undefined APR as 0', () => {
        expect(dailyCompoundInterest(1000, undefined, 30)).toBe(0);
    });
});
