// Cached Intl formatters in utils.js (#525): the cache must never change what
// is printed, and a locale or currency switch must still take effect.
const { formatCurrency, formatShortDate, formatLongDate, formatMonthLong, formatReportRangeLabel } = require('../../src/utils.js');
const { setLocale } = require('../../src/i18n.js');

const realDocument = global.document;
const realStorage = global.localStorage;

beforeAll(() => {
    // setLocale touches <html lang> and [data-i18n] nodes; the node test env has no DOM.
    global.document = { documentElement: {}, querySelectorAll: () => [] };
});

afterEach(() => {
    setLocale(null, 'en');
    global.localStorage = realStorage;
});

afterAll(() => {
    global.document = realDocument;
});

describe('cached formatters print the same as a fresh formatter', () => {
    test('formatCurrency matches Intl.NumberFormat on repeat calls', () => {
        const fresh = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
        for (const v of [0, 1234.5, -99.999, 1e9]) {
            expect(formatCurrency(v)).toBe(fresh.format(v));
            expect(formatCurrency(v)).toBe(fresh.format(v));
        }
    });

    test('formatShortDate and formatLongDate match toLocaleDateString', () => {
        const d = new Date(2026, 10, 15, 12);
        expect(formatShortDate(d)).toBe(d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }));
        expect(formatShortDate('2026-11-15')).toBe('Nov 15, 2026');
        expect(formatLongDate(d)).toBe('November 15, 2026');
        expect(formatMonthLong(d)).toBe('November 2026');
    });

    test('distinct option sets do not share a cache entry', () => {
        expect(formatReportRangeLabel(2026, 8, 3)).toBe('Jul – Sep 2026');
        expect(formatReportRangeLabel(2026, 1, 3)).toBe('Dec 2025 – Feb 2026');
        expect(formatShortDate('2026-02-01')).toBe('Feb 1, 2026');
    });
});

describe('switching locale or currency is not stuck on a cached formatter', () => {
    test('locale switch changes date and number output', () => {
        const enDate = formatShortDate('2026-11-15');
        const enMoney = formatCurrency(1234.5);
        setLocale(null, 'pl');
        expect(formatShortDate('2026-11-15')).not.toBe(enDate);
        expect(formatShortDate('2026-11-15')).toBe(new Date(2026, 10, 15, 12).toLocaleDateString('pl-PL', { year: 'numeric', month: 'short', day: 'numeric' }));
        expect(formatCurrency(1234.5)).not.toBe(enMoney);
        setLocale(null, 'en');
        expect(formatShortDate('2026-11-15')).toBe(enDate);
    });

    test('currency switch changes the symbol', () => {
        expect(formatCurrency(5)).toBe('$5.00');
        global.localStorage = { getItem: () => 'EUR', setItem: () => {} };
        expect(formatCurrency(5)).toBe('€5.00');
        global.localStorage = realStorage;
        expect(formatCurrency(5)).toBe('$5.00');
    });
});

describe('invalid input', () => {
    test('an invalid date still prints "Invalid Date" instead of throwing', () => {
        expect(formatShortDate('not-a-date')).toBe('Invalid Date');
        expect(formatLongDate(new Date(NaN))).toBe('Invalid Date');
        expect(formatMonthLong(new Date('garbage'))).toBe('Invalid Date');
    });

    test('a non-finite amount formats like Intl does', () => {
        expect(formatCurrency(NaN)).toBe('$NaN');
    });
});
