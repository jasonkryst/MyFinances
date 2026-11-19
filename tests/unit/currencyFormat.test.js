// Currency helpers for chart axes and input units (#509, PR #655): they must
// follow the selected currency and locale, never print a hard-coded '$'.
const { formatCurrency, formatCurrencyAxis, formatCurrencyCompact, getCurrencyAffix } = require('../../src/utils.js');
const { setLocale } = require('../../src/i18n.js');

const realDocument = global.document;
const realStorage = global.localStorage;
let store;

function useCurrency(code) { store.debtTrackerCurrency = code; }
const fresh = (locale, currency, options = {}) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency, ...options });

beforeAll(() => {
    global.document = { documentElement: {}, querySelectorAll: () => [] };
});

beforeEach(() => {
    store = {};
    global.localStorage = {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; },
    };
    setLocale(null, 'en');
});

afterEach(() => {
    setLocale(null, 'en');
    global.localStorage = realStorage;
});

afterAll(() => {
    global.document = realDocument;
});

describe('formatCurrencyAxis', () => {
    test('whole amounts drop the cents (USD/en)', () => {
        expect(formatCurrencyAxis(20000)).toBe('$20,000');
        expect(formatCurrencyAxis(0)).toBe('$0');
        expect(formatCurrencyAxis(-1500)).toBe(fresh('en-US', 'USD', { maximumFractionDigits: 0 }).format(-1500));
    });

    test('fractional ticks keep two decimals so small ranges stay distinct', () => {
        expect(formatCurrencyAxis(0.25)).toBe('$0.25');
        expect(formatCurrencyAxis(0.5)).toBe('$0.50');
        expect(formatCurrencyAxis(1.5)).not.toBe(formatCurrencyAxis(2));
        expect(formatCurrencyAxis(1.5)).toBe(formatCurrency(1.5));
    });

    test('follows the selected currency and locale (PLN/pl)', () => {
        useCurrency('PLN');
        setLocale(null, 'pl');
        const tick = formatCurrencyAxis(1234);
        expect(tick).toBe(fresh('pl-PL', 'PLN', { maximumFractionDigits: 0 }).format(1234));
        expect(tick).toContain('zł');
        expect(tick).not.toContain('$');
        expect(tick).not.toMatch(/,00/);
    });

    test('a currency switch is not stuck on the cached formatter', () => {
        expect(formatCurrencyAxis(10)).toBe('$10');
        useCurrency('EUR');
        expect(formatCurrencyAxis(10)).toBe(fresh('en-US', 'EUR', { maximumFractionDigits: 0 }).format(10));
        expect(formatCurrencyAxis(10)).not.toContain('$');
    });

    test('an unknown stored currency falls back to USD', () => {
        useCurrency('XYZ');
        expect(formatCurrencyAxis(5)).toBe('$5');
    });
});

describe('formatCurrencyCompact', () => {
    test('shortens large amounts (USD/en)', () => {
        expect(formatCurrencyCompact(12000)).toBe('$12K');
        expect(formatCurrencyCompact(1500)).toBe('$1.5K');
        expect(formatCurrencyCompact(500)).toBe('$500');
        expect(formatCurrencyCompact(0)).toBe('$0');
    });

    test('uses the locale\'s compact words and symbol (PLN/pl)', () => {
        useCurrency('PLN');
        setLocale(null, 'pl');
        expect(formatCurrencyCompact(12000)).toBe(fresh('pl-PL', 'PLN', { notation: 'compact' }).format(12000));
        expect(formatCurrencyCompact(12000)).toContain('zł');
        expect(formatCurrencyCompact(12000)).not.toContain('$');
    });

    test('does not share a cache entry with the axis or full formatter', () => {
        expect(formatCurrencyCompact(12000)).toBe('$12K');
        expect(formatCurrencyAxis(12000)).toBe('$12,000');
        expect(formatCurrency(12000)).toBe('$12,000.00');
    });
});

describe('getCurrencyAffix', () => {
    test('USD in English is a leading $', () => {
        expect(getCurrencyAffix()).toEqual({ symbol: '$', after: false });
    });

    test('PLN in Polish is a trailing zł', () => {
        useCurrency('PLN');
        setLocale(null, 'pl');
        expect(getCurrencyAffix()).toEqual({ symbol: 'zł', after: true });
    });

    test('EUR in Spanish is a trailing €, in English a leading €', () => {
        useCurrency('EUR');
        setLocale(null, 'es');
        expect(getCurrencyAffix()).toEqual({ symbol: '€', after: true });
        setLocale(null, 'en');
        expect(getCurrencyAffix()).toEqual({ symbol: '€', after: false });
    });

    test('never returns a $ for a non-dollar currency', () => {
        for (const code of ['PLN', 'EUR', 'GBP']) {
            useCurrency(code);
            expect(getCurrencyAffix().symbol).not.toContain('$');
        }
    });
});
