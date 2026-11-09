import { getCsrfCookie, discardBody, POSTGRES_RESOURCE_ENDPOINTS } from './storage.js';
import { requestLogin } from './loginGate.js';
import { showSyncErrorBanner, showSyncConflictModal } from './ui.js';
import { mapWithConcurrency, IMPORT_CONCURRENCY } from './concurrency.js';
import { createShadowStore, diffFields, classifyConflict, itemPath } from './recordVersions.js';

// Last server-confirmed copy of every record, keyed by item path (#578).
const shadows = createShadowStore();
// One PATCH at a time per record, so a quick second edit can't race the first
// and 409 against this tab's own write.
const patchQueues = new Map();
// Conflict prompts are shown one at a time.
let conflictPrompt = Promise.resolve();
// A 409 is resolved (merge or prompt) and resent at most this many times.
const MAX_PATCH_ATTEMPTS = 3;

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

// One request, with the 401 → sign in → retry-once flow. Never throws and
// never shows the banner: returns { ok, status, body } (status 0 on a network
// error) so callers can treat a 409 differently from a failure.
async function pgRequest(app, method, path, body) {
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
        let resBody = null;
        if (res.status !== 204) {
            try { resBody = await res.json(); } catch { /* empty or non-JSON body */ }
        }
        return { ok: res.ok, status: res.status, body: resBody };
    } catch (err) {
        return { ok: false, status: 0, body: null, error: err };
    }
}

function reportFailure(method, path, res) {
    if (res.status === 0) console.error(`[postgresSync] ${method} ${path} error:`, res.error);
    else console.error(`[postgresSync] ${method} ${path} failed: ${res.status}`, res.body);
    showSyncErrorBanner();
}

async function pgFetch(app, method, path, body) {
    const res = await pgRequest(app, method, path, body);
    if (!res.ok) {
        reportFailure(method, path, res);
        return null;
    }
    return res.body;
}

// ─── Record shadows (#578) ───────────────────────────────────────────────────

// Replace every shadow with the records now in memory. Call after the
// collections were (re)loaded from the server: boot load, import, rollback.
export function seedShadows(app) {
    shadows.clear();
    for (const [field, collectionPath] of Object.entries(POSTGRES_RESOURCE_ENDPOINTS)) {
        for (const record of app?.[field] || []) {
            const path = itemPath(collectionPath, record?.id);
            if (path) shadows.set(path, record);
        }
    }
}

// The in-memory record an item path refers to, or null.
function findRecord(app, path) {
    const slash = path.lastIndexOf('/');
    const collectionPath = path.slice(0, slash);
    const id = path.slice(slash + 1);
    const field = Object.keys(POSTGRES_RESOURCE_ENDPOINTS).find(f => POSTGRES_RESOURCE_ENDPOINTS[f] === collectionPath);
    if (!field || !Array.isArray(app?.[field])) return null;
    return app[field].find(r => String(r?.id) === id) || null;
}

function applyToRecord(app, path, fields) {
    const record = findRecord(app, path);
    if (record && fields && Object.keys(fields).length > 0) Object.assign(record, fields);
    return record;
}

function rerender(app) {
    if (typeof app?.updateUI === 'function') app.updateUI();
    if (typeof app?.refreshCurrentPageData === 'function') app.refreshCurrentPageData();
}

function promptConflict(record) {
    const ask = conflictPrompt.then(() => showSyncConflictModal(record?.name || null));
    conflictPrompt = ask.catch(() => {});
    return ask;
}

function pick(obj, keys) {
    return Object.fromEntries(keys.filter(k => k in obj).map(k => [k, obj[k]]));
}

async function sendPatch(app, path, body) {
    let base = shadows.get(path);
    // No shadow (no known version): an unchecked write, as before #578.
    if (!base) return pgFetch(app, 'PATCH', path, body);

    let diff = diffFields(base, body);
    if (Object.keys(diff).length === 0) return base;

    for (let attempt = 0; attempt < MAX_PATCH_ATTEMPTS; attempt++) {
        const res = await pgRequest(app, 'PATCH', path, { ...diff, rowVersion: base.rowVersion });
        if (res.ok) {
            shadows.set(path, res.body);
            applyToRecord(app, path, { rowVersion: res.body?.rowVersion });
            return res.body;
        }
        const theirs = res.body?.current;
        if (res.status !== 409 || !theirs || typeof theirs !== 'object') {
            reportFailure('PATCH', path, res);
            return null;
        }

        // Changed elsewhere. Take the other side's changes to fields this tab
        // didn't touch; ask only when both changed the same field.
        const { conflicts, theirsChanges } = classifyConflict(base, theirs, diff);
        const record = applyToRecord(app, path, { ...theirsChanges, rowVersion: theirs.rowVersion });
        shadows.set(path, theirs);
        base = shadows.get(path);
        if (conflicts.length > 0) {
            const keepMine = await promptConflict(record);
            if (!keepMine) {
                applyToRecord(app, path, pick(theirs, Object.keys(diff)));
                rerender(app);
                return theirs;
            }
        }
        if (Object.keys(theirsChanges).length > 0) rerender(app);
        diff = diffFields(base, diff);
        if (Object.keys(diff).length === 0) return theirs;
    }
    reportFailure('PATCH', path, { status: 409, body: 'gave up after repeated conflicts' });
    return null;
}

export async function pgPost(app, path, body) {
    const created = await pgFetch(app, 'POST', path, body);
    const createdPath = itemPath(path, created?.id);
    if (createdPath) shadows.set(createdPath, created);
    return created;
}

// Fire-and-forget for most callers, but returns a promise that settles when
// this record's queued PATCH (and any conflict prompt) is done.
export function pgPatch(app, path, body) {
    // Callers mostly don't await this, so it must never reject: an unexpected
    // error is reported like any other failed save.
    const guarded = () => sendPatch(app, path, body).catch(err => {
        reportFailure('PATCH', path, { status: 0, error: err });
        return null;
    });
    const run = (patchQueues.get(path) || Promise.resolve()).then(guarded);
    const tail = run.catch(() => {});
    patchQueues.set(path, tail);
    tail.then(() => { if (patchQueues.get(path) === tail) patchQueues.delete(path); });
    return run;
}

export function pgDelete(app, path) {
    shadows.delete(path);
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
    shadows.clear();
    // Bounded like the import that usually follows it (#519); about 20 requests.
    const requests = [
        ...ALL_RESOURCE_PATHS.map(path => () => pgFetch(app, 'DELETE', path)),
        () => pgFetch(app, 'DELETE', '/api/plan-settings/milestones'),
        () => pgFetch(app, 'PATCH', '/api/plan-settings', DEFAULT_PLAN_SETTINGS)
    ];
    await mapWithConcurrency(requests, IMPORT_CONCURRENCY, request => request());
}
