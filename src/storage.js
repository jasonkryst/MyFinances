// LocalStorage import/export

import { createStorageAdapter, setStorageBackendPreference } from './storageAdapters.js';
import { sanitizeParsedState } from './sanitizers.js';

export function getCsrfCookie() {
    const match = document.cookie.split('; ').find(row => row.startsWith('csrf='));
    return match ? match.split('=')[1] : '';
}

export async function checkPostgresSession() {
    try {
        const res = await fetch('/api/plan-settings');
        return res.ok;
    } catch {
        return false;
    }
}

const POSTGRES_RESOURCE_ENDPOINTS = {
    debts: '/api/debts',
    accounts: '/api/accounts',
    incomes: '/api/incomes',
    bonuses: '/api/bonuses',
    bills: '/api/bills',
    expenses: '/api/expenses',
    recurringTemplates: '/api/recurring-templates',
    emergencyFunds: '/api/emergency-funds',
    sinkingFunds: '/api/sinking-funds',
    reconciliations: '/api/reconciliations'
};

export async function loadFromPostgres(app) {
    const entries = Object.entries(POSTGRES_RESOURCE_ENDPOINTS);
    const [lists, snapshots, settingsRows, overrides, planSettings] = await Promise.all([
        Promise.all(entries.map(([, path]) => fetch(path).then(r => r.json()))),
        fetch('/api/net-worth-snapshots').then(r => r.json()),
        fetch('/api/settings').then(r => r.json()),
        fetch('/api/ledger-overrides').then(r => r.json()),
        fetch('/api/plan-settings').then(r => r.json())
    ]);

    entries.forEach(([field], i) => { app[field] = lists[i]; });
    app.monthlySnapshots = snapshots;
    app.settings = settingsRows;
    app.ledgerAmountOverrides = Object.fromEntries(
        overrides.map(o => [o.overrideKey, o])
    );
    app._savedMonthlyPayment = planSettings.monthlyPayment;
    app._savedStrategy = planSettings.strategy;
    app.perMonthStimulus = planSettings.perMonthStimulus;
    app.netWorthMilestonesAwarded = planSettings.netWorthMilestonesAwarded;
    app._ledgerAccountFilter = planSettings.ledgerSettings?.accountFilter ?? 'all';
    app._ledgerDateRange = planSettings.ledgerSettings?.dateRange ?? 'all';
    app._ledgerSortKey = planSettings.ledgerSettings?.sortKey ?? 'date';
    app._ledgerSortDir = planSettings.ledgerSettings?.sortDir ?? 'desc';
    app._forecastRangeMonths = planSettings.forecastSettings?.rangeMonths ?? 1;
    app._forecastAccountId = planSettings.forecastSettings?.accountId ?? 'total';
    app._forecastNotableThresholdPct = planSettings.forecastSettings?.notableThresholdPct ?? 130;
}

// Browsers commonly cap localStorage somewhere in the 5-10MB range. We can't
// query the real per-browser limit, so we warn against a conservative 5MB
// estimate rather than risk silent write failures once a user is near
// whatever their actual ceiling turns out to be.
export const STORAGE_ESTIMATED_QUOTA_BYTES = 5 * 1024 * 1024;
export const STORAGE_QUOTA_WARNING_RATIO = 0.8;

export function getStorageUsageInfo(serializedJson) {
    const bytes = new Blob([serializedJson]).size;
    const pct = bytes / STORAGE_ESTIMATED_QUOTA_BYTES;
    return {
        bytes,
        limitBytes: STORAGE_ESTIMATED_QUOTA_BYTES,
        pct,
        nearLimit: pct >= STORAGE_QUOTA_WARNING_RATIO
    };
}

// Persist current state. For local/session backends this is synchronous and
// returns true/false directly (switchStorageBackend relies on this). For
// the postgres backend it returns a Promise — callers that don't await it
// get a truthy Promise, which is fine since Postgres has no rollback path.
export function saveToStorage(app) {
    if (app._storageBackendKind === 'postgres') {
        return fetch('/api/plan-settings', {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': getCsrfCookie()
            },
            body: JSON.stringify({
                monthlyPayment: parseFloat(document.getElementById('monthlyPayment')?.value) || null,
                strategy: document.getElementById('paymentStrategy')?.value || null,
                ledgerSettings: {
                    accountFilter: app._ledgerAccountFilter || 'all',
                    dateRange: app._ledgerDateRange || 'all',
                    sortKey: app._ledgerSortKey || 'date',
                    sortDir: app._ledgerSortDir || 'desc'
                },
                forecastSettings: {
                    rangeMonths: app._forecastRangeMonths || 1,
                    accountId: app._forecastAccountId || 'total',
                    notableThresholdPct: app._forecastNotableThresholdPct || 130
                }
            })
        }).then(() => true).catch(err => {
            console.error('Error saving plan settings to Postgres:', err);
            return false;
        });
    }
    try {
        const data = {
            debts: app.debts,
            accounts: app.accounts || [],
            incomes: app.incomes || [],
            bonuses: app.bonuses || [],
            bills: app.bills || [],
            expenses: app.expenses || [],
            ledgerAmountOverrides: app.ledgerAmountOverrides || {},
            recurringTemplates: app.recurringTemplates || [],
            emergencyFunds: app.emergencyFunds || [],
            sinkingFunds: app.sinkingFunds || [],
            reconciliations: app.reconciliations || [],
            settings: app.settings || [],
            monthlySnapshots: app.monthlySnapshots || [],
            netWorthMilestonesAwarded: app.netWorthMilestonesAwarded || [],
            perMonthStimulus: app.perMonthStimulus || [],
            monthlyPayment: parseFloat(document.getElementById('monthlyPayment')?.value) || null,
            strategy: document.getElementById('paymentStrategy')?.value || null,
            ledgerSettings: {
                accountFilter: app._ledgerAccountFilter || 'all',
                dateRange: app._ledgerDateRange || 'all',
                sortKey: app._ledgerSortKey || 'date',
                sortDir: app._ledgerSortDir || 'desc'
            },
            forecastSettings: {
                rangeMonths: app._forecastRangeMonths || 1,
                accountId: app._forecastAccountId || 'total',
                notableThresholdPct: app._forecastNotableThresholdPct || 130
            },
            timestamp: new Date().toISOString()
        };
        const json = JSON.stringify(data);
        app.storageAdapter.set(app.storageKey, json);

        const usage = getStorageUsageInfo(json);
        if (usage.nearLimit) {
            if (!app._storageQuotaWarned && typeof app.showStorageQuotaWarning === 'function') {
                app.showStorageQuotaWarning(usage);
            }
            app._storageQuotaWarned = true;
        } else {
            app._storageQuotaWarned = false;
        }
        return true;
    } catch (error) {
        console.error('Error saving to localStorage:', error);
        if (typeof app.showStorageQuotaWarning === 'function') {
            app.showStorageQuotaWarning({ bytes: null, limitBytes: STORAGE_ESTIMATED_QUOTA_BYTES, pct: 1, nearLimit: true, writeFailed: true });
        }
        return false;
    }
}

// Restore state from localStorage
export function loadFromStorage(app) {
    try {
        const data = app.storageAdapter.get(app.storageKey);
        if (data) {
            const parsed = JSON.parse(data);
            const clean = sanitizeParsedState(parsed);
            app.debts = clean.debts;
            app.accounts = clean.accounts;
            app.incomes = clean.incomes;
            app.bonuses = clean.bonuses;
            app.bills = clean.bills;
            app.expenses = clean.expenses;
            app.ledgerAmountOverrides = clean.ledgerAmountOverrides;
            app.recurringTemplates = clean.recurringTemplates;
            app.emergencyFunds = clean.emergencyFunds;
            app.sinkingFunds = clean.sinkingFunds;
            app.reconciliations = clean.reconciliations;
            app.settings = clean.settings;
            app.monthlySnapshots = clean.monthlySnapshots;
            app.netWorthMilestonesAwarded = clean.netWorthMilestonesAwarded;
            app.perMonthStimulus = clean.perMonthStimulus;
            app._savedMonthlyPayment = clean.monthlyPayment;
            app._savedStrategy = clean.strategy;
            // Restore ledger settings if present
            app._ledgerAccountFilter = clean.ledgerSettings.accountFilter;
            app._ledgerDateRange = clean.ledgerSettings.dateRange;
            app._ledgerSortKey = clean.ledgerSettings.sortKey;
            app._ledgerSortDir = clean.ledgerSettings.sortDir;
            // Restore forecast settings if present
            app._forecastRangeMonths = clean.forecastSettings.rangeMonths;
            app._forecastAccountId = clean.forecastSettings.accountId;
            app._forecastNotableThresholdPct = clean.forecastSettings.notableThresholdPct;
        }
    } catch (error) {
        console.error('Error loading from localStorage:', error);
    }
}

// Legacy incomes predating the income/account linking feature may have no
// accountId. Assign them the first account so every income resolves to an
// account for balance projections. Must run after both app.accounts and
// app.incomes are populated for the session (fresh installs leave both
// arrays empty, so this is a no-op for them).
//
// NOT called from loadFromStorage(): it's invoked explicitly from the
// DebtTrackerApp constructor in app.js, deliberately placed AFTER
// captureNetWorthSnapshot() (same spot as the original inline loop this
// function replaced). captureNetWorthSnapshot() -> computeAccountBalance()
// excludes transactions from incomes with no accountId from any specific
// account's balance. If this backfill ran before that snapshot, a legacy
// income's transactions would newly count toward account totals for "this
// load" only, silently changing the computed/persisted netWorth and
// possibly triggering a milestone notification. Keep the call in the
// constructor, in this position, unless that ordering dependency no longer
// applies.
export function backfillIncomeAccountIds(app) {
    if (app.accounts.length > 0 && app.incomes.length > 0) {
        const firstAccountId = app.accounts[0].id;
        let changed = false;
        for (let index = 0; index < app.incomes.length; index++) {
            if (!app.incomes[index].accountId || isNaN(app.incomes[index].accountId)) {
                app.incomes[index].accountId = firstAccountId;
                changed = true;
            }
        }
        if (changed) saveToStorage(app);
    }
}

// Switch the active persistence backend, migrating current in-memory state
// into the new backend and removing the old backend's copy so nothing is
// left behind (e.g. financial data lingering in localStorage after a user
// picks Session Storage for privacy).
export function switchStorageBackend(app, kind) {
    const normalized = kind === 'session' ? 'session' : 'local';
    if (normalized === app._storageBackendKind) return;

    const oldAdapter = app.storageAdapter;
    const oldKind = app._storageBackendKind;
    app.storageAdapter = createStorageAdapter(normalized);
    app._storageBackendKind = normalized;
    const saved = app.saveToStorage();
    if (!saved) {
        // Migration write failed (e.g. quota exceeded, storage blocked) —
        // revert to the old backend so nothing is lost or flipped. The old
        // backend's copy is untouched (never removed), and the persisted
        // preference is re-synced to the old kind so it can't drift out of
        // step with the actual active adapter.
        app.storageAdapter = oldAdapter;
        app._storageBackendKind = oldKind;
        setStorageBackendPreference(oldKind);
        return;
    }
    oldAdapter.remove(app.storageKey);
    setStorageBackendPreference(normalized);
}

// Wipe all user data and reset the visible UI state.
export function clearAllData(app, options = {}) {
    const { onCleared } = options;

    app.debts = [];
    app.accounts = [];
    app.incomes = [];
    app.bills = [];
    app.expenses = [];
    app.lastPaymentPlan = null;
    app.lastSummary = null;
    app.perMonthStimulus = [];
    app.bonuses = [];
    app.ledgerAmountOverrides = {};
    app.reconciliations = [];
    app.settings = [];

    app.editingDebtId = null;
    app.editingIncomeId = null;
    app.editingAccountId = null;
    app._savedMonthlyPayment = null;
    app._savedStrategy = null;
    app._reportMonthOffset = 0;

    app._ledgerAccountFilter = 'all';
    app._ledgerDateRange = 'all';
    app._ledgerSortKey = 'date';
    app._ledgerSortDir = 'desc';
    app._ledgerPage = 1;
    app._ledgerPageSize = 25;

    app._forecastRangeMonths = 1;
    app._forecastAccountId = 'total';
    app._forecastNotableThresholdPct = 130;
    app._reconciliationAccountFilter = 'all';

    app.storageAdapter.remove(app.storageKey);
    app.storageAdapter = createStorageAdapter('local');
    app._storageBackendKind = 'local';
    setStorageBackendPreference('local');
    localStorage.removeItem('debtTrackerTheme');

    app.updateUI();

    const resultsSection = document.getElementById('resultsSection');
    if (resultsSection) {
        resultsSection.classList.add('hidden');
        resultsSection.classList.remove('visible');
    }

    const monthlyPaymentInput = document.getElementById('monthlyPayment');
    if (monthlyPaymentInput) monthlyPaymentInput.value = '';

    const strategySelect = document.getElementById('paymentStrategy');
    if (strategySelect) strategySelect.selectedIndex = 0;

    if (typeof onCleared === 'function') {
        onCleared();
    }
}
