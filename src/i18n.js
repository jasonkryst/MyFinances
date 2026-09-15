// Locale storage, string lookup with fallback, and static-markup translation.
// The locale *preference* is stored directly in localStorage under its own
// key (like debtTrackerTheme/debtTrackerStorageBackend) — a device display
// preference, not financial data, independent of app.storageAdapter.
import en from './locales/en.js';
import es from './locales/es.js';
import pl from './locales/pl.js';

export const LOCALES = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Español' },
    { code: 'pl', name: 'Polski' },
];
export const LOCALE_PREF_KEY = 'debtTrackerLocale';

export const CURRENCY_PREF_KEY = 'debtTrackerCurrency';
export const CURRENCIES = [
    { code: 'USD', name: 'USD — US Dollar' },
    { code: 'EUR', name: 'EUR — Euro' },
    { code: 'GBP', name: 'GBP — British Pound' },
    { code: 'JPY', name: 'JPY — Japanese Yen' },
    { code: 'CAD', name: 'CAD — Canadian Dollar' },
    { code: 'AUD', name: 'AUD — Australian Dollar' },
    { code: 'CHF', name: 'CHF — Swiss Franc' },
    { code: 'CNY', name: 'CNY — Chinese Yuan' },
    { code: 'INR', name: 'INR — Indian Rupee' },
    { code: 'MXN', name: 'MXN — Mexican Peso' },
    { code: 'BRL', name: 'BRL — Brazilian Real' },
    { code: 'KRW', name: 'KRW — South Korean Won' },
    { code: 'SEK', name: 'SEK — Swedish Krona' },
    { code: 'NOK', name: 'NOK — Norwegian Krone' },
    { code: 'DKK', name: 'DKK — Danish Krone' },
    { code: 'SGD', name: 'SGD — Singapore Dollar' },
    { code: 'HKD', name: 'HKD — Hong Kong Dollar' },
    { code: 'NZD', name: 'NZD — New Zealand Dollar' },
    { code: 'ZAR', name: 'ZAR — South African Rand' },
    { code: 'PLN', name: 'PLN — Polish Zloty' },
];
const CURRENCY_CODES = CURRENCIES.map(c => c.code);
const DEFAULT_CURRENCY = 'USD';

export function getCurrencyCode() {
    try {
        const stored = localStorage.getItem(CURRENCY_PREF_KEY);
        return CURRENCY_CODES.includes(stored) ? stored : DEFAULT_CURRENCY;
    } catch (_) {
        return DEFAULT_CURRENCY;
    }
}

export function setCurrencyCode(code) {
    const normalized = CURRENCY_CODES.includes(code) ? code : DEFAULT_CURRENCY;
    try {
        localStorage.setItem(CURRENCY_PREF_KEY, normalized);
    } catch (_) { /* storage unavailable — preference still applies in-memory */ }
    return normalized;
}

const LOCALE_CODES = LOCALES.map(l => l.code);
const DEFAULT_LOCALE = 'en';
const DICTIONARIES = { en, es, pl };
// Intl locale tags used for Intl.NumberFormat/toLocaleDateString — kept
// separate from the app-facing short codes so the default ('en') resolves
// to exactly 'en-US', matching this app's pre-i18n hardcoded formatting.
const INTL_LOCALES = { en: 'en-US', es: 'es-ES', pl: 'pl-PL' };

function readStoredLocale() {
    try {
        const stored = localStorage.getItem(LOCALE_PREF_KEY);
        return LOCALE_CODES.includes(stored) ? stored : DEFAULT_LOCALE;
    } catch (_) {
        // localStorage unavailable (blocked, or a non-browser test runner) —
        // fall back to the default rather than throwing.
        return DEFAULT_LOCALE;
    }
}

let currentLocale = readStoredLocale();

export function setLocalePreference(code) {
    const normalized = LOCALE_CODES.includes(code) ? code : DEFAULT_LOCALE;
    try {
        localStorage.setItem(LOCALE_PREF_KEY, normalized);
    } catch (_) { /* storage unavailable/blocked — locale still applies in-memory */ }
    return normalized;
}

export function getCurrentLocale() {
    return currentLocale;
}

export function getIntlLocale() {
    return INTL_LOCALES[currentLocale] || INTL_LOCALES[DEFAULT_LOCALE];
}

// Looks up `key` in the current locale's dictionary, falling back to the
// English dictionary, then to the raw key itself — a missing/mistyped key
// never throws or renders blank/undefined. `{token}` placeholders in the
// resolved string are replaced from `vars`; an unmatched placeholder is
// left as-is rather than silently dropped.
export function t(key, vars = {}) {
    const dict = DICTIONARIES[currentLocale] || DICTIONARIES[DEFAULT_LOCALE];
    const template = dict[key] ?? DICTIONARIES[DEFAULT_LOCALE][key] ?? key;
    return template.replace(/\{(\w+)\}/g, (match, name) =>
        (vars[name] !== undefined ? String(vars[name]) : match));
}

// Walks `[data-i18n]` (textContent) and `[data-i18n-attr]` (one or more
// "attr:key" pairs, comma-separated, e.g. "title:toolbar.settingsTitle,aria-label:toolbar.settingsAriaLabel")
// elements under `root` and applies the current locale's translations.
// Uses textContent/setAttribute only — never innerHTML — so no escaping is
// needed and the strict CSP is unaffected.
export function applyStaticTranslations(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-attr]').forEach(el => {
        el.getAttribute('data-i18n-attr').split(',').forEach(pair => {
            const [attr, key] = pair.split(':').map(s => s.trim());
            if (attr && key) el.setAttribute(attr, t(key));
        });
    });
}

// Persists the new locale, re-applies static translations, and re-renders
// the Health page (the only dynamic pilot content) if it's currently the
// active section.
export function setLocale(app, code) {
    currentLocale = LOCALE_CODES.includes(code) ? code : DEFAULT_LOCALE;
    setLocalePreference(currentLocale);
    applyStaticTranslations();
    const healthSection = document.getElementById('healthSection');
    if (app && healthSection && healthSection.classList.contains('active')
        && typeof app.renderHealthDashboard === 'function') {
        app.renderHealthDashboard();
    }
    return currentLocale;
}
