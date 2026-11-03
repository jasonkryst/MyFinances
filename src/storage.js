// Server persistence: boot probe, load from and save to the PostgreSQL API.

import { pgDeleteAll } from './postgresSync.js';

export function getCsrfCookie() {
    const match = document.cookie.split('; ').find(row => row.startsWith('csrf='));
    return match ? match.split('=')[1] : '';
}

// Boot probe (spec §5 step 1). `/auth/setup-status` is rate-limited to 20
// requests per 15 minutes (server/src/routes/auth.js setupStatusLimiter), so
// it must not be hit on every page load: a signed-in boot answers from
// `/api/plan-settings` alone, and setup-status is asked only without a session.
//
// Never throws. Any network error, non-JSON body or unexpected status on either
// request means the server can't be reached ({ reachable: false }).
export async function probeServer() {
    const UNREACHABLE = { reachable: false };
    try {
        const res = await fetch('/api/plan-settings', { cache: 'no-store' });
        if (res.status === 401) {
            return await _probeSetupStatus();
        }
        if (!res.ok) return UNREACHABLE;
        // A static host's HTML fallback can answer 200 for /api/*; only a JSON
        // object proves this is the API.
        const body = await res.json();
        if (!body || typeof body !== 'object') return UNREACHABLE;
        return { reachable: true, hasSession: true };
    } catch {
        return UNREACHABLE;
    }
}

async function _probeSetupStatus() {
    const res = await fetch('/auth/setup-status', { cache: 'no-store' });
    // 429: the setup-status limiter is exhausted. The server answered, so it is
    // reachable; treat it as sign-in mode rather than the "Can't reach your
    // server" gate. This also keeps a Retry on that gate from looping on 429.
    if (res.status === 429) return { reachable: true, hasSession: false, needsSetup: false };
    if (!res.ok) return { reachable: false };
    const body = await res.json();
    if (!body || typeof body.needsSetup !== 'boolean') return { reachable: false };
    return { reachable: true, hasSession: false, needsSetup: body.needsSetup };
}

const POSTGRES_RESOURCE_ENDPOINTS = {
    persons: '/api/persons',
    debts: '/api/debts',
    accounts: '/api/accounts',
    incomes: '/api/incomes',
    bonuses: '/api/bonuses',
    bills: '/api/bills',
    expenses: '/api/expenses',
    recurringTemplates: '/api/recurring-templates',
    emergencyFunds: '/api/emergency-funds',
    sinkingFunds: '/api/sinking-funds',
    reconciliations: '/api/reconciliations',
    planHistory: '/api/plan-history',
    retirementSnapshots: '/api/retirement-snapshots',
    transfers: '/api/transfers',
    balanceHistory: '/api/balance-history'
};

// Fetch one API resource as JSON, throwing on any non-2xx so a failed load
// reaches init()'s unreachable gate instead of assigning an error body as data.
async function _getJson(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return res.json();
}

// Throws when any request fails; init() then shows the unreachable gate.
export async function loadFromPostgres(app) {
    const entries = Object.entries(POSTGRES_RESOURCE_ENDPOINTS);
    const [lists, snapshots, settingsRows, overrides, clearedTransactions, planSettings] = await Promise.all([
        Promise.all(entries.map(([, path]) => _getJson(path))),
        _getJson('/api/net-worth-snapshots'),
        _getJson('/api/settings'),
        _getJson('/api/ledger-overrides'),
        _getJson('/api/ledger-cleared'),
        _getJson('/api/plan-settings')
    ]);

    entries.forEach(([field], i) => { app[field] = lists[i]; });
    app.monthlySnapshots = snapshots;
    app.settings = settingsRows;
    app.ledgerAmountOverrides = Object.fromEntries(
        overrides.map(o => [o.overrideKey, o])
    );
    app.ledgerClearedTransactions = Object.fromEntries(
        clearedTransactions.map(c => [c.clearedKey, c])
    );
    app._savedMonthlyPayment = planSettings.monthlyPayment;
    app._savedStrategy = planSettings.strategy;
    app.perMonthStimulus = planSettings.perMonthStimulus;
    app.netWorthMilestonesAwarded = planSettings.netWorthMilestonesAwarded;
    app._ledgerAccountFilter = planSettings.ledgerSettings?.accountFilter ?? 'all';
    app._ledgerDateRange = planSettings.ledgerSettings?.dateRange ?? 'around7';
    app._ledgerSortKey = planSettings.ledgerSettings?.sortKey ?? 'date';
    app._ledgerSortDir = planSettings.ledgerSettings?.sortDir ?? 'desc';
    app._ledgerClearedFilter = planSettings.ledgerSettings?.clearedFilter ?? 'all';
    app._forecastRangeMonths = planSettings.forecastSettings?.rangeMonths ?? 1;
    app._forecastAccountId = planSettings.forecastSettings?.accountId ?? 'total';
    app._forecastNotableThresholdPct = planSettings.forecastSettings?.notableThresholdPct ?? 130;
    app.retirementTargetDate = planSettings.retirementTargetDate ?? null;
    app.homePurchasePlan = planSettings.homePurchasePlan ?? null;
    app.budgetCategories = planSettings.budgetCategories ?? {};
}

// Persist the plan-settings scalars (payment, strategy, ledger/forecast view
// settings, retirement target, home purchase plan, category budgets). Every
// record collection is synced by its own feature module through
// postgresSync.js; this only PATCHes the single plan-settings row. The name is
// historical and kept for its many call sites.
export function saveToStorage(app) {
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
                dateRange: app._ledgerDateRange || 'around7',
                sortKey: app._ledgerSortKey || 'date',
                sortDir: app._ledgerSortDir || 'desc',
                clearedFilter: app._ledgerClearedFilter || 'all'
            },
            forecastSettings: {
                rangeMonths: app._forecastRangeMonths || 1,
                accountId: app._forecastAccountId || 'total',
                notableThresholdPct: app._forecastNotableThresholdPct || 130
            },
            retirementTargetDate: app.retirementTargetDate || null,
            homePurchasePlan: app.homePurchasePlan || null,
            budgetCategories: app.budgetCategories || {}
        })
    }).then(() => true).catch(err => {
        console.error('Error saving plan settings to Postgres:', err);
        return false;
    });
}

// Legacy incomes predating the income/account linking feature may have no
// accountId. Assign them the first account so every income resolves to an
// account for balance projections. Must run after both app.accounts and
// app.incomes are populated for the session (fresh installs leave both
// arrays empty, so this is a no-op for them).
//
// NOT called from loadFromPostgres(): it's invoked explicitly from
// DebtTrackerApp.init() in app.js, deliberately placed AFTER
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

// Wipe all user data and reset the visible UI state.
export async function clearAllData(app, options = {}) {
    const { onCleared } = options;

    app.persons = [];
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
    app.ledgerClearedTransactions = {};
    app.reconciliations = [];
    app.planHistory = [];
    app.retirementSnapshots = [];
    app.transfers = [];
    app.retirementTargetDate = null;
    app.homePurchasePlan = null;
    app.budgetCategories = {};
    app.balanceHistory = [];
    app.settings = [];

    app.editingDebtId = null;
    app.editingIncomeId = null;
    app.editingAccountId = null;
    app._savedMonthlyPayment = null;
    app._savedStrategy = null;
    app._reportMonthOffset = 0;

    app._ledgerAccountFilter = 'all';
    app._ledgerDateRange = 'around7';
    app._ledgerClearedFilter = 'all';
    app._ledgerSortKey = 'date';
    app._ledgerSortDir = 'desc';
    app._ledgerPage = 1;
    app._ledgerPageSize = 25;

    app._forecastRangeMonths = 1;
    app._forecastAccountId = 'total';
    app._forecastNotableThresholdPct = 130;
    app._reconciliationAccountFilter = 'all';

    localStorage.removeItem('debtTrackerTheme');
    localStorage.removeItem('debtTrackerReconInProgress');

    // Awaited so a reload or import right after the clear sees the empty server.
    await pgDeleteAll(app);

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
