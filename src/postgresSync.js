import { getCsrfCookie, discardBody } from './storage.js';
import { requestLogin } from './loginGate.js';
import { showSyncErrorBanner } from './ui.js';

const ALL_RESOURCE_PATHS = [
    '/api/persons',
    '/api/debts',
    '/api/accounts',
    '/api/incomes',
    '/api/bonuses',
    '/api/bills',
    '/api/expenses',
    '/api/recurring-templates',
    '/api/emergency-funds',
    '/api/sinking-funds',
    '/api/reconciliations',
    '/api/plan-history',
    '/api/retirement-snapshots',
    '/api/transfers',
    '/api/ledger-overrides',
    '/api/ledger-cleared',
    '/api/net-worth-snapshots',
    '/api/balance-history',
    '/api/settings',
];

async function pgFetch(app, method, path, body) {
    try {
        // The csrf cookie is re-read per attempt: signing in issues a new one.
        const send = () => fetch(path, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': getCsrfCookie()
            },
            body: body !== undefined ? JSON.stringify(body) : undefined
        });
        let res = await send();
        if (res.status === 401) {
            // Several saves can fail at once; one gate is enough. After
            // signing in, retry this write exactly once (no loop) so it is
            // not silently lost.
            await discardBody(res);
            await requestLogin(app);
            res = await send();
        }
        if (!res.ok) {
            let errorBody = null;
            try { errorBody = await res.json(); } catch { /* non-JSON body */ }
            console.error(`[postgresSync] ${method} ${path} failed: ${res.status}`, errorBody);
            showSyncErrorBanner();
            return null;
        }
        if (res.status === 204) return null;
        return await res.json();
    } catch (err) {
        console.error(`[postgresSync] ${method} ${path} error:`, err);
        showSyncErrorBanner();
        return null;
    }
}

export async function pgPost(app, path, body) {
    return pgFetch(app, 'POST', path, body);
}

export function pgPatch(app, path, body) {
    pgFetch(app, 'PATCH', path, body);
}

export function pgDelete(app, path) {
    pgFetch(app, 'DELETE', path);
}

export function pgPut(app, path, body) {
    pgFetch(app, 'PUT', path, body);
}

export async function pgDeleteMilestones(app) {
    await pgFetch(app, 'DELETE', '/api/plan-settings/milestones');
}

const DEFAULT_PLAN_SETTINGS = {
    strategy: null,
    monthlyPayment: null,
    perMonthStimulus: [],
    ledgerSettings: { accountFilter: 'all', dateRange: 'around7', sortKey: 'date', sortDir: 'desc', clearedFilter: 'all' },
    forecastSettings: { rangeMonths: 1, accountId: 'total', notableThresholdPct: 130 },
    retirementTargetDate: null,
    homePurchasePlan: null,
    budgetCategories: {}
};

export async function pgDeleteAll(app) {
    await Promise.all([
        ...ALL_RESOURCE_PATHS.map(path => pgFetch(app, 'DELETE', path)),
        pgFetch(app, 'DELETE', '/api/plan-settings/milestones'),
        pgFetch(app, 'PATCH', '/api/plan-settings', DEFAULT_PLAN_SETTINGS)
    ]);
}
