// Pure (no imports, DOM-free) setting-key constants and the settings schema.
// Shared by the browser (settings.js re-exports it) and the server
// (server/src/sanitizers/index.js), which rejects any setting that
// isAllowedSetting() refuses (#569). A new setting constant must be added to
// SETTINGS_EXPORT_SCHEMA, or to isAllowedSetting()'s server-only keys, or the
// server answers 400 to every write of it.

export const RECONCILIATION_ADJUSTS_BALANCE = 'reconciliationAdjustsBalance';
export const SHOW_ARCHIVED_DEBTS = 'showArchivedDebts';
export const SHOW_ARCHIVED_RECURRING = 'showArchivedRecurring';
export const SHOW_ARCHIVED_ACCOUNTS = 'showArchivedAccounts';
export const SHOW_ARCHIVED_SINKING_FUNDS = 'showArchivedSinkingFunds';
// #679: show incomes whose end date has passed on the Income page.
export const SHOW_ENDED_INCOMES = 'showEndedIncomes';
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

// Duplicate of dataExport.js's LEDGER_EXPORT_COLUMN_KEYS (importing it would
// pull dataExport -> ledgerTransactions -> ... into this module's import
// graph, a cycle risk). tests/unit/settingsExport.test.js asserts they match.
export const LEDGER_EXPORT_COLUMN_KEYS_COPY = ['date', 'account', 'name', 'amount', 'category', 'balance', 'type', 'cleared', 'clearedAt'];
export const LEDGER_EXPORT_COLUMNS = 'ledgerExportColumns';

// #211: notification preferences. Every type is on unless set to false;
// notificationsCore.js (getNotificationPrefs) applies the defaults.
export const NOTIFY_BILL_DUE = 'notifyBillDue';
export const NOTIFY_LOW_BALANCE = 'notifyLowBalance';
export const NOTIFY_ZERO_BALANCE = 'notifyZeroBalance';
export const NOTIFY_PROJECTED_LOW = 'notifyProjectedLow';
// #681: a debt's promotional APR ends within PROMO_ALERT_DAYS.
export const NOTIFY_PROMO_ENDING = 'notifyPromoEnding';
export const PROMO_ALERT_DAYS = 60;
// #701: a target-date sinking fund is behind its planned pace or past due.
export const NOTIFY_SINKING_BEHIND = 'notifySinkingBehind';
// #683: email when the account is signed in to from a new browser/OS pair.
export const NOTIFY_NEW_SIGN_IN = 'notifyNewSignIn';
export const NOTIFY_DAYS_AHEAD = 'notifyDaysAhead';
export const NOTIFY_DAYS_AHEAD_DEFAULT = 3;
export const NOTIFY_DAYS_AHEAD_MAX = 30;
export const NOTIFY_CHANNEL = 'notifyChannel';
export const NOTIFY_CHANNELS = ['both', 'email', 'inApp'];
export const NOTIFY_DELIVERY = 'notifyDelivery';
export const NOTIFY_DELIVERIES = ['perEvent', 'digest'];

// #649: the bell follows the Notifications page's saved filters. Value lists
// duplicate src/notificationsFilter.js (this module stays import-free);
// tests/unit/notificationsFilterBell.test.js keeps them equal. Deliberately not
// in SETTINGS_EXPORT_SCHEMA (account ids would dangle in another dataset).
export const NOTIFY_FILTER_TYPE = 'notifyFilterType';
export const NOTIFY_FILTER_TYPES = ['all', 'bill', 'lowBalance', 'overdrawn', 'projected', 'promo', 'sinking'];
export const NOTIFY_FILTER_STATUS = 'notifyFilterStatus';
export const NOTIFY_FILTER_STATUSES = ['unread', 'read', 'active', 'resolved', 'all'];
export const NOTIFY_FILTER_ACCOUNT = 'notifyFilterAccount';

export const BCT_CATEGORY_MAX = 60;
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
    [SHOW_ENDED_INCOMES]: isBool,
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
    [NOTIFY_BILL_DUE]: isBool,
    [NOTIFY_LOW_BALANCE]: isBool,
    [NOTIFY_ZERO_BALANCE]: isBool,
    [NOTIFY_PROJECTED_LOW]: isBool,
    [NOTIFY_PROMO_ENDING]: isBool,
    [NOTIFY_SINKING_BEHIND]: isBool,
    [NOTIFY_NEW_SIGN_IN]: isBool,
    [NOTIFY_DAYS_AHEAD]: numberIn(0, NOTIFY_DAYS_AHEAD_MAX, { integer: true }),
    [NOTIFY_CHANNEL]: oneOf(NOTIFY_CHANNELS),
    [NOTIFY_DELIVERY]: oneOf(NOTIFY_DELIVERIES),
    // Comma-separated list of known ledger export column keys (non-empty).
    [LEDGER_EXPORT_COLUMNS]: v => typeof v === 'string' && v.length > 0
        && v.split(',').every(c => LEDGER_EXPORT_COLUMN_KEYS_COPY.includes(c)),
};

// `bct:<category>:healthy|warn` budget thresholds, percent 0..100. Category
// names are user-defined, so this is pattern-based with a length cap.
export const BCT_KEY_RE = /^bct:([^:]{1,60}):(healthy|warn)$/;
export const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isKnownSettingKey(key) {
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


// Keys the app writes but that are deliberately NOT in the settings export
// (SURPLUS_ACCOUNT_ID holds an account id that would dangle in another
// dataset). The server still has to accept them.
export function isAllowedSetting(key, value) {
    if (validateExportedSetting(key, value)) return true;
    if (key === SURPLUS_ACCOUNT_ID) return Number.isInteger(value) && value > 0;
    if (key === NOTIFY_FILTER_TYPE) return oneOf(NOTIFY_FILTER_TYPES)(value);
    if (key === NOTIFY_FILTER_STATUS) return oneOf(NOTIFY_FILTER_STATUSES)(value);
    if (key === NOTIFY_FILTER_ACCOUNT) return Number.isSafeInteger(value) && value >= 0;
    return false;
}
