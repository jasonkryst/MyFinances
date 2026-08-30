import { getCsrfCookie } from './storage.js';
import { pgDeleteAll, pgDeleteMilestones } from './postgresSync.js';
import { showPgErrorToast } from './ui.js';
import { sanitizeFiniteNumber, normalizeText } from './utils.js';

// CRUD resources that carry accountId / targetAccountId FK references
const CRUD_RESOURCES = [
    { field: 'debts',              path: '/api/debts' },
    { field: 'incomes',            path: '/api/incomes' },
    { field: 'bonuses',            path: '/api/bonuses' },
    { field: 'bills',              path: '/api/bills' },
    { field: 'expenses',           path: '/api/expenses' },
    { field: 'recurringTemplates', path: '/api/recurring-templates' },
    { field: 'emergencyFunds',     path: '/api/emergency-funds' },
    { field: 'sinkingFunds',       path: '/api/sinking-funds' },
    { field: 'reconciliations',    path: '/api/reconciliations' },
];

// Resources deduplicated by name in merge mode (same logic as localStorage merge)
const MERGE_DEDUP_BY_NAME = new Set([
    'debts', 'incomes', 'bonuses', 'bills',
    'recurringTemplates', 'sinkingFunds'
]);

function remapFk(record, idMap) {
    const r = { ...record };
    if (r.accountId != null && idMap[r.accountId] != null) r.accountId = idMap[r.accountId];
    if (r.targetAccountId != null && idMap[r.targetAccountId] != null) r.targetAccountId = idMap[r.targetAccountId];
    return r;
}

// Throws on non-OK responses so callers can catch and rollback.
async function apiFetch(method, path, body) {
    const res = await fetch(path, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfCookie()
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`[pgImport] ${method} ${path} → ${res.status}: ${text}`);
    }
    return res.status === 204 ? null : res.json();
}

function snapshotAppState(app) {
    return {
        accounts:              app.accounts.map(r => ({ ...r })),
        debts:                 app.debts.map(r => ({ ...r })),
        incomes:               app.incomes.map(r => ({ ...r })),
        bonuses:               app.bonuses.map(r => ({ ...r })),
        bills:                 app.bills.map(r => ({ ...r })),
        expenses:              app.expenses.map(r => ({ ...r })),
        recurringTemplates:    app.recurringTemplates.map(r => ({ ...r })),
        emergencyFunds:        app.emergencyFunds.map(r => ({ ...r })),
        sinkingFunds:          app.sinkingFunds.map(r => ({ ...r })),
        reconciliations:       app.reconciliations.map(r => ({ ...r })),
        ledgerAmountOverrides: { ...app.ledgerAmountOverrides },
        monthlySnapshots:      app.monthlySnapshots.map(r => ({ ...r })),
        settings:              (app.settings || []).map(r => ({ ...r })),
        netWorthMilestonesAwarded: [...(app.netWorthMilestonesAwarded || [])],
        perMonthStimulus:      [...(app.perMonthStimulus || [])],
        // Plan-settings fields stored on app as _saved* / _ledger* / _forecast*
        strategy:              app._savedStrategy ?? null,
        monthlyPayment:        app._savedMonthlyPayment ?? null,
        ledgerSettings: {
            accountFilter: app._ledgerAccountFilter || 'all',
            dateRange:     app._ledgerDateRange     || 'all',
            sortKey:       app._ledgerSortKey       || 'date',
            sortDir:       app._ledgerSortDir       || 'desc'
        },
        forecastSettings: {
            rangeMonths:          app._forecastRangeMonths          || 1,
            accountId:            app._forecastAccountId            || 'total',
            notableThresholdPct:  app._forecastNotableThresholdPct  || 130
        }
    };
}

// Post accounts first (to get server IDs), then post all other resources with
// remapped FK references.  Returns idMap for app.* update after success.
async function postAllResources(data) {
    // Accounts first -- server assigns bigserial IDs we need for FK remapping
    const accountResults = await Promise.all(
        (data.accounts || []).map(acc => apiFetch('POST', '/api/accounts', acc))
    );

    const idMap = {};
    (data.accounts || []).forEach((acc, i) => {
        if (accountResults[i]) idMap[acc.id] = accountResults[i].id;
    });

    // All non-account CRUD arrays in parallel with remapped FK references
    const resourceResults = await Promise.all(
        CRUD_RESOURCES.map(({ field, path }) =>
            Promise.all(
                (data[field] || []).map(record => apiFetch('POST', path, remapFk(record, idMap)))
            )
        )
    );

    // Keyed resources -- PUT is always upsert, safe in both replace and merge
    const overrideEntries = Object.entries(data.ledgerAmountOverrides || {});
    await Promise.all([
        ...overrideEntries.map(([key, val]) =>
            apiFetch('PUT', `/api/ledger-overrides/${encodeURIComponent(key)}`, remapFk(val, idMap))
        ),
        ...(data.monthlySnapshots || []).map(s =>
            apiFetch('PUT', `/api/net-worth-snapshots/${encodeURIComponent(s.date)}`, s)
        ),
        ...(data.settings || []).map(s =>
            apiFetch('PUT', `/api/settings/${encodeURIComponent(s.key)}`, s)
        ),
    ]);

    // Milestones -- ON CONFLICT DO NOTHING server-side, safe to call in both modes
    await Promise.all(
        (data.netWorthMilestonesAwarded || []).map(m =>
            apiFetch('POST', '/api/plan-settings/milestones', { milestone: m })
        )
    );

    // Plan-settings scalars
    await apiFetch('PATCH', '/api/plan-settings', {
        strategy:        data.strategy        ?? null,
        monthlyPayment:  data.monthlyPayment  ?? null,
        perMonthStimulus: data.perMonthStimulus || [],
        ledgerSettings:   data.ledgerSettings,
        forecastSettings: data.forecastSettings
    });

    return { accountResults, resourceResults, idMap, overrideEntries };
}

// Sync app.* with the server-returned records after a successful postAllResources.
function applyResultsToApp(app, data, { accountResults, resourceResults, idMap, overrideEntries }) {
    app.accounts = accountResults.filter(Boolean);

    CRUD_RESOURCES.forEach(({ field }, i) => {
        app[field] = resourceResults[i].filter(Boolean);
    });

    app.ledgerAmountOverrides = Object.fromEntries(
        overrideEntries.map(([key, val]) => [key, { overrideKey: key, ...remapFk(val, idMap) }])
    );
    app.monthlySnapshots           = data.monthlySnapshots || [];
    app.settings                   = data.settings || [];
    app.netWorthMilestonesAwarded  = data.netWorthMilestonesAwarded || [];
    app.perMonthStimulus           = data.perMonthStimulus || [];
    app._savedMonthlyPayment       = data.monthlyPayment ?? null;
    app._savedStrategy             = data.strategy ?? null;

    if (data.ledgerSettings) {
        app._ledgerAccountFilter = data.ledgerSettings.accountFilter || 'all';
        app._ledgerDateRange     = data.ledgerSettings.dateRange     || 'all';
        app._ledgerSortKey       = data.ledgerSettings.sortKey       || 'date';
        app._ledgerSortDir       = data.ledgerSettings.sortDir       || 'desc';
    }
    if (data.forecastSettings) {
        app._forecastRangeMonths         = data.forecastSettings.rangeMonths         || 1;
        app._forecastAccountId           = data.forecastSettings.accountId           || 'total';
        app._forecastNotableThresholdPct = data.forecastSettings.notableThresholdPct || 130;
    }
}

// Build a postable data object from a snapshot (for rollback restore).
// Snapshot records already carry server IDs as their .id fields;
// postAllResources treats those as localIds and builds a new idMap.
function snapshotToPostData(snapshot) {
    return {
        accounts:              snapshot.accounts,
        debts:                 snapshot.debts,
        incomes:               snapshot.incomes,
        bonuses:               snapshot.bonuses,
        bills:                 snapshot.bills,
        expenses:              snapshot.expenses,
        recurringTemplates:    snapshot.recurringTemplates,
        emergencyFunds:        snapshot.emergencyFunds,
        sinkingFunds:          snapshot.sinkingFunds,
        reconciliations:       snapshot.reconciliations,
        ledgerAmountOverrides: snapshot.ledgerAmountOverrides,
        monthlySnapshots:      snapshot.monthlySnapshots,
        settings:              snapshot.settings,
        netWorthMilestonesAwarded: snapshot.netWorthMilestonesAwarded,
        perMonthStimulus:      snapshot.perMonthStimulus,
        strategy:              snapshot.strategy,
        monthlyPayment:        snapshot.monthlyPayment,
        ledgerSettings:        snapshot.ledgerSettings,
        forecastSettings:      snapshot.forecastSettings
    };
}

async function doReplaceRollback(app, snapshot) {
    try {
        await pgDeleteAll(app);
        const results = await postAllResources(snapshotToPostData(snapshot));
        applyResultsToApp(app, snapshotToPostData(snapshot), results);
    } catch (rollbackErr) {
        console.error('[pgImport] Rollback also failed — data may be inconsistent:', rollbackErr);
        showPgErrorToast();
    }
}

// ─── Public API ──────────────────────────────────────────────────────────────

// Replace-mode import: wipe server, re-post everything from clean, rollback to
// snapshot on any failure.
export async function replaceForPostgres(app, clean, incomingStrategy) {
    const snapshot = snapshotAppState(app);

    const data = {
        ...clean,
        strategy:       normalizeText(incomingStrategy?.paymentStrategy, 30) || null,
        monthlyPayment: sanitizeFiniteNumber(incomingStrategy?.monthlyPayment, null, { min: 0 })
    };

    try {
        await pgDeleteAll(app);
        const results = await postAllResources(data);
        applyResultsToApp(app, data, results);
    } catch (err) {
        console.error('[pgImport] Replace failed, rolling back:', err);
        await doReplaceRollback(app, snapshot);
        showPgErrorToast();
        throw err;
    }
}

// Merge-mode import: POST only new records (by name), PUT keyed resources,
// rollback only newly created records on failure.
export async function mergeForPostgres(app, clean, incomingStrategy) {
    const snapshot = snapshotAppState(app);
    const newlyCreatedPaths = [];

    try {
        // Build idMap from existing server accounts by name
        const idMap = {};
        const existingAccountNames = new Map(app.accounts.map(a => [a.name.toLowerCase(), a.id]));
        const newAccounts = [];

        for (const acc of (clean.accounts || [])) {
            const existingId = existingAccountNames.get(acc.name.toLowerCase());
            if (existingId != null) {
                idMap[acc.id] = existingId;
            } else {
                newAccounts.push(acc);
            }
        }

        // POST new accounts, collect server IDs
        const newAccountResults = await Promise.all(
            newAccounts.map(acc => apiFetch('POST', '/api/accounts', acc))
        );
        newAccounts.forEach((acc, i) => {
            const rec = newAccountResults[i];
            if (rec) {
                idMap[acc.id] = rec.id;
                newlyCreatedPaths.push(`/api/accounts/${rec.id}`);
                app.accounts.push(rec);
            }
        });

        // POST new records for each CRUD resource (dedup by name where applicable)
        for (const { field, path } of CRUD_RESOURCES) {
            const dedup = MERGE_DEDUP_BY_NAME.has(field);
            const existingNames = dedup
                ? new Set((app[field] || []).map(r => r.name?.toLowerCase()))
                : null;

            const toPost = (clean[field] || [])
                .filter(r => !dedup || !existingNames.has(r.name?.toLowerCase()))
                .map(r => remapFk(r, idMap));

            const results = await Promise.all(toPost.map(r => apiFetch('POST', path, r)));
            results.forEach(rec => {
                if (rec) {
                    newlyCreatedPaths.push(`${path}/${rec.id}`);
                    app[field].push(rec);
                }
            });
        }

        // Keyed resources -- always upsert (safe merge semantics)
        const overrideEntries = Object.entries(clean.ledgerAmountOverrides || {});
        await Promise.all([
            ...overrideEntries.map(([key, val]) =>
                apiFetch('PUT', `/api/ledger-overrides/${encodeURIComponent(key)}`, remapFk(val, idMap))
            ),
            ...(clean.monthlySnapshots || []).map(s =>
                apiFetch('PUT', `/api/net-worth-snapshots/${encodeURIComponent(s.date)}`, s)
            ),
            ...(clean.settings || []).map(s =>
                apiFetch('PUT', `/api/settings/${encodeURIComponent(s.key)}`, s)
            ),
        ]);

        // Merge keyed resources into app state
        for (const [key, val] of overrideEntries) {
            app.ledgerAmountOverrides[key] = { overrideKey: key, ...remapFk(val, idMap) };
        }
        const existingSnapshotDates = new Set((app.monthlySnapshots || []).map(s => s.date));
        for (const s of (clean.monthlySnapshots || [])) {
            const idx = app.monthlySnapshots.findIndex(ms => ms.date === s.date);
            if (idx >= 0) { app.monthlySnapshots[idx] = s; } else { app.monthlySnapshots.push(s); }
        }
        for (const s of (clean.settings || [])) {
            const idx = (app.settings || []).findIndex(r => r.key === s.key);
            if (idx >= 0) { app.settings[idx] = s; } else { (app.settings = app.settings || []).push(s); }
        }

        // Milestones -- additive, ON CONFLICT DO NOTHING server-side
        const existingMilestones = new Set(app.netWorthMilestonesAwarded || []);
        await Promise.all(
            (clean.netWorthMilestonesAwarded || []).map(m =>
                apiFetch('POST', '/api/plan-settings/milestones', { milestone: m })
            )
        );
        for (const m of (clean.netWorthMilestonesAwarded || [])) {
            if (!existingMilestones.has(m)) {
                (app.netWorthMilestonesAwarded = app.netWorthMilestonesAwarded || []).push(m);
            }
        }

        // Plan-settings -- always update in merge mode
        app.perMonthStimulus = clean.perMonthStimulus || [];
        app._savedStrategy      = normalizeText(incomingStrategy?.paymentStrategy, 30) || null;
        app._savedMonthlyPayment = sanitizeFiniteNumber(incomingStrategy?.monthlyPayment, null, { min: 0 });
        if (clean.ledgerSettings) {
            app._ledgerAccountFilter = clean.ledgerSettings.accountFilter || 'all';
            app._ledgerDateRange     = clean.ledgerSettings.dateRange     || 'all';
            app._ledgerSortKey       = clean.ledgerSettings.sortKey       || 'date';
            app._ledgerSortDir       = clean.ledgerSettings.sortDir       || 'desc';
        }
        if (clean.forecastSettings) {
            app._forecastRangeMonths         = clean.forecastSettings.rangeMonths         || 1;
            app._forecastAccountId           = clean.forecastSettings.accountId           || 'total';
            app._forecastNotableThresholdPct = clean.forecastSettings.notableThresholdPct || 130;
        }
        await apiFetch('PATCH', '/api/plan-settings', {
            strategy:        app._savedStrategy,
            monthlyPayment:  app._savedMonthlyPayment,
            perMonthStimulus: app.perMonthStimulus,
            ledgerSettings:   clean.ledgerSettings,
            forecastSettings: clean.forecastSettings
        });

    } catch (err) {
        console.error('[pgImport] Merge failed, rolling back newly created records:', err);
        // Restore in-memory state from snapshot
        Object.assign(app, {
            accounts:             snapshot.accounts,
            debts:                snapshot.debts,
            incomes:              snapshot.incomes,
            bonuses:              snapshot.bonuses,
            bills:                snapshot.bills,
            expenses:             snapshot.expenses,
            recurringTemplates:   snapshot.recurringTemplates,
            emergencyFunds:       snapshot.emergencyFunds,
            sinkingFunds:         snapshot.sinkingFunds,
            reconciliations:      snapshot.reconciliations,
            ledgerAmountOverrides: snapshot.ledgerAmountOverrides,
            monthlySnapshots:     snapshot.monthlySnapshots,
            settings:             snapshot.settings,
            netWorthMilestonesAwarded: snapshot.netWorthMilestonesAwarded,
            perMonthStimulus:     snapshot.perMonthStimulus,
            _savedStrategy:       snapshot.strategy,
            _savedMonthlyPayment: snapshot.monthlyPayment,
            _ledgerAccountFilter: snapshot.ledgerSettings.accountFilter,
            _ledgerDateRange:     snapshot.ledgerSettings.dateRange,
            _ledgerSortKey:       snapshot.ledgerSettings.sortKey,
            _ledgerSortDir:       snapshot.ledgerSettings.sortDir,
            _forecastRangeMonths:         snapshot.forecastSettings.rangeMonths,
            _forecastAccountId:           snapshot.forecastSettings.accountId,
            _forecastNotableThresholdPct: snapshot.forecastSettings.notableThresholdPct
        });
        // Delete only the records created in this session
        await Promise.allSettled(
            newlyCreatedPaths.map(path =>
                fetch(path, { method: 'DELETE', headers: { 'X-CSRF-Token': getCsrfCookie() } })
            )
        );
        showPgErrorToast();
        throw err;
    }
}
