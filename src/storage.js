// Server persistence: boot probe, load from and save to the PostgreSQL API.

import { pgDeleteAll } from './postgresSync.js';
import { buildPlanSettingsPatch } from './planSettingsPatch.js';
import { requestLogin } from './loginGate.js';
import { showSyncErrorBanner } from './ui.js';

export function getCsrfCookie() {
    const match = document.cookie.split('; ').find(row => row.startsWith('csrf='));
    return match ? match.split('=')[1] : '';
}

// Boot probe (spec §5 step 1). `/auth/setup-status` is rate-limited to 20
// requests per 15 minutes (server/src/routes/auth.js setupStatusLimiter), so
// it must not be hit on every page load: a signed-in boot answers from
// `/api/plan-settings` alone, and setup-status is asked only without a session.
//
// Never throws. Any network error, timeout, non-JSON body or unexpected status
// on either request means the server can't be reached ({ reachable: false }).
export const PROBE_TIMEOUT_MS = 8000;
export const LOAD_TIMEOUT_MS = 20000;

// An AbortSignal that fires after `ms`. Built on setTimeout (not
// AbortSignal.timeout) so the timer is the page's own, and a server that
// accepts the connection but never answers can't hang boot. Covers the body
// read too: res.json() rejects once the signal aborts.
function _timeoutSignal(ms) {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), ms);
    return controller.signal;
}

// A fetch whose body is never read keeps the response stream open. With a
// no-store response (the server sends it for every /api and /auth reply) the
// browser cannot drain it into the HTTP cache, so the request stays in flight
// and the page never reaches network idle. Call this on any response whose
// body is not otherwise consumed.
export async function discardBody(res) {
    try { await res.arrayBuffer(); } catch (_) { /* aborted or already consumed */ }
}

export async function probeServer() {
    const UNREACHABLE = { reachable: false };
    try {
        const res = await fetch('/api/plan-settings', { cache: 'no-store', signal: _timeoutSignal(PROBE_TIMEOUT_MS) });
        if (res.status === 401) {
            await discardBody(res);
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
    const res = await fetch('/auth/setup-status', { cache: 'no-store', signal: _timeoutSignal(PROBE_TIMEOUT_MS) });
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

// Thrown by loadFromPostgres when the session expired between the probe and
// the load: init() re-probes (which leads to the login gate) instead of
// showing the unreachable gate.
export class SessionExpiredError extends Error {
    constructor(path) {
        super(`GET ${path} returned 401`);
        this.name = 'SessionExpiredError';
    }
}

// Fetch one API resource as JSON, throwing on any non-2xx (or timeout) so a
// failed load reaches init()'s gates instead of assigning an error body as data.
async function _getJson(path, signal) {
    const res = await fetch(path, { cache: 'no-store', signal });
    if (res.status === 401) throw new SessionExpiredError(path);
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return res.json();
}

// Throws when any request fails or the whole fan-out exceeds LOAD_TIMEOUT_MS;
// init() then shows the unreachable gate (or re-probes on SessionExpiredError).
export async function loadFromPostgres(app) {
    const signal = _timeoutSignal(LOAD_TIMEOUT_MS);
    const entries = Object.entries(POSTGRES_RESOURCE_ENDPOINTS);
    const [lists, snapshots, settingsRows, overrides, clearedTransactions, planSettings] = await Promise.all([
        Promise.all(entries.map(([, path]) => _getJson(path, signal))),
        _getJson('/api/net-worth-snapshots', signal),
        _getJson('/api/settings', signal),
        _getJson('/api/ledger-overrides', signal),
        _getJson('/api/ledger-cleared', signal),
        _getJson('/api/plan-settings', signal)
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

function _readPlanInputs() {
    return {
        monthlyPayment: document.getElementById('monthlyPayment')?.value,
        strategy: document.getElementById('paymentStrategy')?.value
    };
}

// Persist the named plan-settings fields (issues #564, #521); see
// PLAN_SETTINGS_FIELDS in planSettingsPatch.js for the names. Only those
// fields are sent, so a stale tab or device can't overwrite the others.
// Record collections are synced by their own feature modules through
// postgresSync.js and must not call this. The name is historical.
//
// Called with no known field it sends nothing: a forgotten argument must
// never fall back to writing the whole row.
export function saveToStorage(app, fields) {
    const { body: patch, unknown } = buildPlanSettingsPatch(app, fields, _readPlanInputs);
    if (unknown.length > 0) {
        console.warn(`saveToStorage: unknown plan-settings field(s) ignored: ${unknown.join(', ')}`);
    }
    if (!patch) {
        console.warn('saveToStorage called without a plan-settings field; nothing sent.');
        return Promise.resolve(true);
    }
    const body = JSON.stringify(patch);
    // The csrf cookie is re-read per attempt: signing in issues a new one.
    const send = () => fetch('/api/plan-settings', {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfCookie()
        },
        body
    });
    return send().then(async first => {
        let res = first;
        if (res.status === 401) {
            // Several saves can fail at once; one gate is enough. Retry once
            // after sign-in so the save is not silently lost.
            await discardBody(res);
            await requestLogin(app);
            res = await send();
        }
        await discardBody(res);
        if (res.ok) return true;
        console.error(`Error saving plan settings: PATCH /api/plan-settings failed: ${res.status}`);
        showSyncErrorBanner();
        return false;
    }).catch(err => {
        console.error('Error saving plan settings to Postgres:', err);
        showSyncErrorBanner();
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
        // In memory only; it re-runs on every load. (It used to call
        // saveToStorage, which only ever wrote plan settings, never incomes.)
        const firstAccountId = app.accounts[0].id;
        for (let index = 0; index < app.incomes.length; index++) {
            if (!app.incomes[index].accountId || isNaN(app.incomes[index].accountId)) {
                app.incomes[index].accountId = firstAccountId;
            }
        }
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
    app.recurringTemplates = [];
    app.emergencyFunds = [];
    app.sinkingFunds = [];
    app.monthlySnapshots = [];
    app.netWorthMilestonesAwarded = [];
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
