const { t, getCurrentLocale, LOCALES, LOCALE_PREF_KEY } = require('../../src/i18n.js');

describe('t()', () => {
    test('returns the English string for a known key with no localStorage/browser locale set', () => {
        expect(getCurrentLocale()).toBe('en');
        expect(t('nav.health')).toBe('Health');
    });

    test('interpolates a {token} placeholder from vars', () => {
        expect(t('health.perMonthSuffix')).toBe('/mo');
        expect(t('health.subtitle', { month: 'August 2026' }))
            .toBe('A one-glance assessment of your financial well-being for August 2026.');
    });

    test('leaves an unmatched {token} placeholder untouched rather than dropping it', () => {
        expect(t('health.subtitle', {})).toBe(
            'A one-glance assessment of your financial well-being for {month}.'
        );
    });

    test('falls back to the raw key for a key that exists in no dictionary, rather than throwing or returning blank/undefined', () => {
        expect(t('this.key.does.not.exist')).toBe('this.key.does.not.exist');
    });
});

describe('LOCALES', () => {
    test('exposes exactly the three pilot locales', () => {
        expect(LOCALES.map(l => l.code)).toEqual(['en', 'es', 'pl']);
    });
});

describe('LOCALE_PREF_KEY', () => {
    test('is the dedicated localStorage key, matching the debtTrackerTheme/debtTrackerStorageBackend pattern', () => {
        expect(LOCALE_PREF_KEY).toBe('debtTrackerLocale');
    });
});
