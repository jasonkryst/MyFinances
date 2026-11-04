// Generic app-wide configuration options, stored as a flat array of
// { key, value } entries so new options can be added without a schema change.

import { pgPut } from './postgresSync.js';
import { t, LOCALES, CURRENCIES } from './i18n.js';

// Order matters for cycleTheme() (commandPalette.js). Lives here, re-exported by
// ui.js, so the settings export schema can validate themes without importing
// the DOM-heavy ui.js.
export const THEMES = ['light', 'dark', 'high-contrast'];
export const THEME_PREF_KEY = 'debtTrackerTheme';

export const RECONCILIATION_ADJUSTS_BALANCE = 'reconciliationAdjustsBalance';
export const SHOW_ARCHIVED_DEBTS = 'showArchivedDebts';
export const SHOW_ARCHIVED_RECURRING = 'showArchivedRecurring';
export const SHOW_ARCHIVED_ACCOUNTS = 'showArchivedAccounts';
export const SHOW_ARCHIVED_SINKING_FUNDS = 'showArchivedSinkingFunds';
export const SURPLUS_ACCOUNT_ID = 'surplusAccountId';
export const SURPLUS_WINDOW_DAYS = 'surplusWindowDays';
export const SURPLUS_CUSHION_PCT = 'surplusCushionPct';
export const AUTO_NW_SNAPSHOT = 'autoNwSnapshot';
export const RETIREMENT_WITHDRAWAL_RATE = 'retirementWithdrawalRate';
export const RETIREMENT_SCENARIO_CONSERVATIVE_DELTA = 'retirementScenarioConservativeDelta';
export const RETIREMENT_SCENARIO_AGGRESSIVE_DELTA = 'retirementScenarioAggressiveDelta';
// #346: Coast FIRE target nest egg. 0 / unset means "use the FIRE number"
// (stored as 0 rather than null, since sanitizeSetting() drops null values).
export const RETIREMENT_COAST_TARGET = 'retirementCoastTarget';
export const COAST_FIRE_TARGET_MAX = 1e12;
// #361: FIRE target as a multiple of annual expenses (25 == the 4% rule).
// The withdrawal rate shown in the UI is derived (100 / multiplier).
export const FIRE_MULTIPLIER = 'fireMultiplier';
export const FIRE_MULTIPLIER_DEFAULT = 25;
export const FIRE_MULTIPLIER_MAX = 1000;
export const HOUSING_COST_OVERRIDE = 'healthHousingCostOverride';
// #412: how $0 ledger/recurring amounts are treated: 'allow' | 'warn' | 'block'.
export const ZERO_AMOUNT_POLICY = 'zeroAmountPolicy';
export const ZERO_AMOUNT_POLICIES = ['allow', 'warn', 'block'];

// #250: per-category budget health thresholds, stored as two flat settings
// entries per category rather than one JSON-blob setting — sanitizeSetting()
// only accepts boolean/number/string values, so an object value would be
// silently dropped on every load/import. budgetThresholdKey() builds the
// flat key; `which` is 'healthy' or 'warn'.
export function budgetThresholdKey(category, which) {
    return `bct:${String(category).toLowerCase()}:${which}`;
}

export function getSetting(app, key, defaultValue) {
    const entry = (app.settings || []).find(s => s.key === key);
    return entry ? entry.value : defaultValue;
}

export function setSetting(app, key, value) {
    if (!app.settings) app.settings = [];
    const entry = app.settings.find(s => s.key === key);
    if (entry) {
        entry.value = value;
    } else {
        app.settings.push({ key, value });
    }
    app.saveToStorage();
    // Encoded: bct:<category> keys carry free-text category names, and a
    // settings import (#326) can supply them, so a raw '/' or '?' must not
    // be able to retarget the request. Matches postgresImport.js.
    pgPut(app, `/api/settings/${encodeURIComponent(key)}`, { value });
}
// Unknown/invalid stored values (non-number, <= 0, > max) fall back to 25.
export function getFireMultiplier(app) {
    const v = getSetting(app, FIRE_MULTIPLIER, FIRE_MULTIPLIER_DEFAULT);
    return (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= FIRE_MULTIPLIER_MAX)
        ? v : FIRE_MULTIPLIER_DEFAULT;
}
// The FIRE number: annual bills + budgeted expenses x getFireMultiplier().
// Shared by Health's FIRE card and the Retirement page's Coast FIRE default.
export function computeFireNumber(app) {
    const monthlyBills = (app.bills || []).reduce((s, b) => s + (Number(b?.amount) || 0), 0);
    const monthlyExpenses = (app.expenses || []).reduce((s, e) => s + (Number(e?.budgetAmount) || 0), 0);
    return (monthlyBills + monthlyExpenses) * 12 * getFireMultiplier(app);
}
// Stored Coast FIRE target, or null when unset/0/invalid (caller falls back
// to computeFireNumber()).
export function getCoastFireTarget(app) {
    const v = getSetting(app, RETIREMENT_COAST_TARGET, null);
    return (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= COAST_FIRE_TARGET_MAX) ? v : null;
}
// Returns 'allow' for a missing/unknown stored value so a bad import can
// never silently turn into a stricter policy.
export function getZeroAmountPolicy(app) {
    const value = getSetting(app, ZERO_AMOUNT_POLICY, 'allow');
    return ZERO_AMOUNT_POLICIES.includes(value) ? value : 'allow';
}

// ---------------------------------------------------------------------------
// #326: settings-only export/import. Pure (DOM-free, side-effect-free) so it
// can be unit-tested; applying a parsed import lives in settingsBackup.js.
// Only "safe prefs" are covered. Deliberately NOT in the schema: the storage
// backend preference (importing it would reload into Postgres/the login gate),
// SURPLUS_ACCOUNT_ID (an account id that would dangle in another dataset) and
// Ledger filters (can hold account ids). No financial data is ever exported.
// ---------------------------------------------------------------------------

// Duplicate of dataExport.js's LEDGER_EXPORT_COLUMN_KEYS (importing it would
// pull dataExport -> ledgerTransactions -> ... into this module's import
// graph, a cycle risk). tests/unit/settingsExport.test.js asserts they match.
export const LEDGER_EXPORT_COLUMN_KEYS_COPY = ['date', 'account', 'name', 'amount', 'category', 'balance', 'type', 'cleared', 'clearedAt'];
export const LEDGER_EXPORT_COLUMNS = 'ledgerExportColumns';

export const SETTINGS_EXPORT_TYPE = 'settings';
export const SETTINGS_EXPORT_VERSION = '1.0';
export const SETTINGS_EXPORT_MAX_BYTES = 100 * 1024;
const BCT_CATEGORY_MAX = 60;

const isBool = v => typeof v === 'boolean';
const numberIn = (min, max, { integer = false, minExclusive = false } = {}) => v =>
    typeof v === 'number' && Number.isFinite(v)
    && (minExclusive ? v > min : v >= min) && v <= max
    && (!integer || Number.isInteger(v));
const oneOf = list => v => typeof v === 'string' && list.includes(v);

// Ranges mirror each setting's real consumer (health.js / retirement.js).
export const SETTINGS_EXPORT_SCHEMA = {
    [RECONCILIATION_ADJUSTS_BALANCE]: isBool,
    [SHOW_ARCHIVED_DEBTS]: isBool,
    [SHOW_ARCHIVED_RECURRING]: isBool,
    [SHOW_ARCHIVED_ACCOUNTS]: isBool,
    [SHOW_ARCHIVED_SINKING_FUNDS]: isBool,
    [AUTO_NW_SNAPSHOT]: isBool,
    [SURPLUS_WINDOW_DAYS]: numberIn(7, 365, { integer: true }),
    [SURPLUS_CUSHION_PCT]: numberIn(0, 100, { integer: true }),
    [RETIREMENT_WITHDRAWAL_RATE]: numberIn(2, 8),
    [RETIREMENT_SCENARIO_CONSERVATIVE_DELTA]: numberIn(-20, 0),
    [RETIREMENT_SCENARIO_AGGRESSIVE_DELTA]: numberIn(0, 20),
    [RETIREMENT_COAST_TARGET]: numberIn(0, COAST_FIRE_TARGET_MAX),
    [FIRE_MULTIPLIER]: numberIn(0, FIRE_MULTIPLIER_MAX, { minExclusive: true }),
    [HOUSING_COST_OVERRIDE]: numberIn(0, 1e12),
    [ZERO_AMOUNT_POLICY]: oneOf(ZERO_AMOUNT_POLICIES),
    // Comma-separated list of known ledger export column keys (non-empty).
    [LEDGER_EXPORT_COLUMNS]: v => typeof v === 'string' && v.length > 0
        && v.split(',').every(c => LEDGER_EXPORT_COLUMN_KEYS_COPY.includes(c)),
};

// `bct:<category>:healthy|warn` budget thresholds, percent 0..100. Category
// names are user-defined, so this is pattern-based with a length cap.
const BCT_KEY_RE = /^bct:([^:]{1,60}):(healthy|warn)$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isKnownSettingKey(key) {
    return Object.prototype.hasOwnProperty.call(SETTINGS_EXPORT_SCHEMA, key) || BCT_KEY_RE.test(key);
}

// True when `value` is acceptable for `key`; false for unknown keys.
export function validateExportedSetting(key, value) {
    if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key)) return false;
    if (Object.prototype.hasOwnProperty.call(SETTINGS_EXPORT_SCHEMA, key)) {
        return SETTINGS_EXPORT_SCHEMA[key](value);
    }
    const m = BCT_KEY_RE.exec(key);
    if (m && m[1].length <= BCT_CATEGORY_MAX && !FORBIDDEN_KEYS.has(m[1].trim())) {
        return numberIn(0, 100)(value);
    }
    return false;
}

const PREF_VALIDATORS = {
    theme: v => THEMES.includes(v),
    locale: v => LOCALES.some(l => l.code === v),
    currency: v => CURRENCIES.some(c => c.code === v),
};

export function buildSettingsExport(app, prefs = {}) {
    const settings = {};
    for (const entry of (app && app.settings) || []) {
        if (entry && validateExportedSetting(entry.key, entry.value)) settings[entry.key] = entry.value;
    }
    const preferences = {};
    for (const key of Object.keys(PREF_VALIDATORS)) {
        if (PREF_VALIDATORS[key](prefs[key])) preferences[key] = prefs[key];
    }
    return {
        type: SETTINGS_EXPORT_TYPE,
        app: 'MyFinances',
        version: SETTINGS_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        preferences,
        settings,
    };
}

const DATA_EXPORT_ARRAYS = ['debts', 'accounts', 'incomes', 'bills', 'expenses', 'recurringTemplates', 'emergencyFunds', 'sinkingFunds', 'monthlySnapshots', 'reconciliations'];

function importFailure(error) {
    return { ok: false, error, preferences: {}, settings: {}, skipped: [] };
}

// `json` is the raw file text (size-checked before parsing) or an already
// parsed value. Never throws.
export function parseSettingsImport(json) {
    let data = json;
    if (typeof json === 'string') {
        if (json.length > SETTINGS_EXPORT_MAX_BYTES) return importFailure(t('settings.backup.errTooLarge'));
        try { data = JSON.parse(json); } catch (e) {
            return importFailure(t('settings.backup.errMalformed', { detail: e && e.message ? e.message : '' }));
        }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return importFailure(t('settings.backup.errNotSettings'));
    if (data.type !== SETTINGS_EXPORT_TYPE) {
        const looksLikeData = DATA_EXPORT_ARRAYS.some(k => Array.isArray(data[k]));
        return importFailure(looksLikeData ? t('settings.backup.errFullExport') : t('settings.backup.errNotSettings'));
    }
    const major = parseInt(String(data.version ?? '').split('.')[0], 10);
    if (!Number.isFinite(major) || major !== 1) {
        return importFailure(t('settings.backup.errVersion', { version: String(data.version).slice(0, 20) }));
    }

    const preferences = {};
    const settings = {};
    const skipped = [];
    const skip = (key, reason) => skipped.push({ key: String(key).slice(0, 80), reason });
    const asObject = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

    const prefsIn = asObject(data.preferences);
    for (const key of Object.keys(prefsIn)) {
        if (FORBIDDEN_KEYS.has(key)) { skip(key, t('settings.backup.reasonForbidden')); continue; }
        if (!Object.prototype.hasOwnProperty.call(PREF_VALIDATORS, key)) { skip(key, t('settings.backup.reasonUnknown')); continue; }
        if (!PREF_VALIDATORS[key](prefsIn[key])) { skip(key, t('settings.backup.reasonInvalid')); continue; }
        preferences[key] = prefsIn[key];
    }

    const settingsIn = asObject(data.settings);
    for (const key of Object.keys(settingsIn)) {
        if (FORBIDDEN_KEYS.has(key)) { skip(key, t('settings.backup.reasonForbidden')); continue; }
        if (key === SURPLUS_ACCOUNT_ID) { skip(key, t('settings.backup.reasonAccountSpecific')); continue; }
        if (!isKnownSettingKey(key)) { skip(key, t('settings.backup.reasonUnknown')); continue; }
        if (!validateExportedSetting(key, settingsIn[key])) { skip(key, t('settings.backup.reasonInvalid')); continue; }
        settings[key] = settingsIn[key];
    }
    return { ok: true, preferences, settings, skipped };
}
