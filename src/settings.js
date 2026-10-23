// Generic app-wide configuration options, stored as a flat array of
// { key, value } entries so new options can be added without a schema change.

import { pgPut } from './postgresSync.js';

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
export const HOUSING_COST_OVERRIDE = 'healthHousingCostOverride';

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
    if (app._storageBackendKind === 'postgres') {
        pgPut(app, `/api/settings/${key}`, { value });
    }
}