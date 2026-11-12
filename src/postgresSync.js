import { getCsrfCookie, discardBody, POSTGRES_RESOURCE_ENDPOINTS } from './storage.js';
import { requestLogin } from './loginGate.js';
import { showSyncErrorBanner, showSyncConflictModal, showRecordGoneBanner } from './ui.js';
import { mapWithConcurrency, IMPORT_CONCURRENCY } from './concurrency.js';
import { createShadowStore, diffFields, classifyConflict, itemPath } from './recordVersions.js';
import { deletionLayers } from './resourceDeletion.js';
import { invalidateProjectionCache } from './projectionCache.js';

// Last server-confirmed copy of every record, keyed by item path (#578).
const shadows = createShadowStore();
// One PATCH at a time per record, so a quick second edit can't race the first
// and 409 against this tab's own write.
const patchQueues = new Map();
// Conflict prompts are shown one at a time.
let conflictPrompt = Promise.resolve();
// A 409 is resolved (merge or prompt) and resent at most this many times.
const MAX_PATCH_ATTEMPTS = 3;

// Writes in flight, and a counter bumped when each one starts (#575). A
// background refresh waits while any write is pending, and throws its result
// away if a write started while it was loading.
let writesInFlight = 0;
let writeGeneration = 0;

// Fired on window after every successful write; liveRefresh.js relays it to
// the other tabs. An event instead of an import keeps this module out of
// another import cycle.
export const DATA_WRITTEN_EVENT = 'myfinances:data-written';

export function pendingWriteCount() {
    return writesInFlight + patchQueues.size;
}

export function currentWriteGeneration() {
    return writeGeneration;
}

// One request, with the 401 → sign in → retry-once flow. Never throws and
// never shows the banner: returns { ok, status, body } (status 0 on a network
// error) so callers can treat a 409 differently from a failure.
async function pgRequest(app, method, path, body) {
    const isWrite = method !== 'GET';
    if (isWrite) { writesInFlight++; writeGeneration++; }
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
        if (isWrite && res.ok && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent(DATA_WRITTEN_EVENT, { detail: { method, path } }));
        }
        return { ok: res.ok, status: res.status, body: resBody };
    } catch (err) {
        return { ok: false, status: 0, body: null, error: err };
    } finally {
        if (isWrite) writesInFlight--;
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

// The collection and index of the in-memory record an item path refers to.
function locateRecord(app, path) {
    const slash = path.lastIndexOf('/');
    const collectionPath = path.slice(0, slash);
    const id = path.slice(slash + 1);
    const field = Object.keys(POSTGRES_RESOURCE_ENDPOINTS).find(f => POSTGRES_RESOURCE_ENDPOINTS[f] === collectionPath);
    if (!field || !Array.isArray(app?.[field])) return null;
    const index = app[field].findIndex(r => String(r?.id) === id);
    return index === -1 ? null : { field, index };
}

// True for an item path under one of the record collections (not a keyed
// resource such as /api/ledger-overrides/<key>).
function isRecordPath(path) {
    const collectionPath = path.slice(0, path.lastIndexOf('/'));
    return Object.values(POSTGRES_RESOURCE_ENDPOINTS).includes(collectionPath);
}

// The in-memory record an item path refers to, or null.
function findRecord(app, path) {
    const at = locateRecord(app, path);
    return at ? app[at.field][at.index] : null;
}

// A PATCH or DELETE hit 404: another tab or device deleted the record (#565).
// Say so instead of blaming the connection. The stale copy stays on screen
// (with the edit the user just made) until they choose Reload, which re-reads
// the server and removes it; nothing vanishes mid-edit.
function recordGone(app, path) {
    shadows.delete(path);
    showRecordGoneBanner(app);
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
    if (!base) {
        const res = await pgRequest(app, 'PATCH', path, body);
        if (res.ok) {
            shadows.set(path, res.body);
            return res.body;
        }
        if (res.status === 404) recordGone(app, path);
        else reportFailure('PATCH', path, res);
        return null;
    }

    let diff = diffFields(base, body);
    if (Object.keys(diff).length === 0) return base;

    for (let attempt = 0; attempt < MAX_PATCH_ATTEMPTS; attempt++) {
        const res = await pgRequest(app, 'PATCH', path, { ...diff, rowVersion: base.rowVersion });
        if (res.ok) {
            shadows.set(path, res.body);
            applyToRecord(app, path, { rowVersion: res.body?.rowVersion });
            return res.body;
        }
        if (res.status === 404) {
            recordGone(app, path);
            return null;
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
    invalidateProjectionCache();
    const created = await pgFetch(app, 'POST', path, body);
    const createdPath = itemPath(path, created?.id);
    if (createdPath) shadows.set(createdPath, created);
    return created;
}

// Create a record and add it to app[collection] only once the server has
// assigned its id (#460, #593). Until then the record is in no collection, so
// no dropdown can offer it and nothing can link to a temporary id. On failure
// it is never added; pgFetch has already shown the sync-error banner, and the
// caller keeps its form filled so the user can retry. Returns the record with
// its server id, or null.
export async function pgCreate(app, collection, path, record) {
    const saved = await pgPost(app, path, record);
    if (saved?.id == null) return null;
    record.id = saved.id;
    if (!Array.isArray(app[collection])) app[collection] = [];
    app[collection].push(record);
    invalidateProjectionCache();
    return record;
}

// Fire-and-forget for most callers, but returns a promise that settles when
// this record's queued PATCH (and any conflict prompt) is done.
export function pgPatch(app, path, body) {
    // Every write follows an in-memory mutation; drop any projection a render
    // in progress has memoized (#518).
    invalidateProjectionCache();
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

// Returns a promise that settles when the DELETE is done (callers may ignore it).
export async function pgDelete(app, path) {
    invalidateProjectionCache();
    shadows.delete(path);
    const res = await pgRequest(app, 'DELETE', path);
    if (res.ok) return;
    if (res.status === 404) {
        // Already gone, which is what the user wanted. For a record, another
        // tab or device deleted it (#565): say why it vanished. A keyed entry
        // (Ledger override or cleared flag) that was never stored is simply
        // absent, so stay quiet.
        if (isRecordPath(path)) recordGone(app, path);
        return;
    }
    reportFailure('DELETE', path, res);
}

export function pgPut(app, path, body) {
    invalidateProjectionCache();
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
    // Children before parents (#608): deleting accounts while a child table is
    // being deleted makes the foreign keys' SET NULL/CASCADE lock the same rows
    // in the opposite order, and Postgres aborts one request with a deadlock.
    // Each layer is bounded like the import that usually follows it (#519).
    const [firstLayer, ...laterLayers] = deletionLayers();
    const deleteAll = path => () => pgFetch(app, 'DELETE', path);
    // Plan settings and milestones reference no collection, so they ride with the first layer.
    await mapWithConcurrency([
        ...firstLayer.map(deleteAll),
        () => pgFetch(app, 'DELETE', '/api/plan-settings/milestones'),
        () => pgFetch(app, 'PATCH', '/api/plan-settings', DEFAULT_PLAN_SETTINGS)
    ], IMPORT_CONCURRENCY, request => request());
    for (const layer of laterLayers) {
        await mapWithConcurrency(layer.map(deleteAll), IMPORT_CONCURRENCY, request => request());
    }
}
