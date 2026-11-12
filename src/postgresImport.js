import { getCsrfCookie } from './storage.js';
import { pgDeleteAll, pgDeleteMilestones, seedShadows } from './postgresSync.js';
import { showSyncErrorBanner } from './ui.js';
import { sanitizeFiniteNumber, normalizeText } from './utils.js';
import { remapHistoryOwners, excludeExistingHistory } from './balanceHistoryCore.js';
import { mapWithConcurrency, mapSettledWithConcurrency, IMPORT_CONCURRENCY } from './concurrency.js';
import { planMerge } from './mergeDedupe.js';
import { remapLedgerEntries, ledgerKeyDropWarning } from './ledgerKeyRemap.js';
import { isAllowedSetting } from './settingsSchema.js';

// Every per-record fan-out below goes through this pool (#519): an unbounded
// Promise.all of a few thousand requests made Chromium abort some of them.
const pool = (items, fn) => mapWithConcurrency(items, IMPORT_CONCURRENCY, fn);

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
    { field: 'planHistory',        path: '/api/plan-history' },
    { field: 'retirementSnapshots', path: '/api/retirement-snapshots' },
    { field: 'transfers',           path: '/api/transfers' },
    { field: 'manualTransactions',  path: '/api/manual-transactions' },
];

function accountIdMapFrom(idMap) {
    return new Map(Object.entries(idMap).map(([localId, serverId]) => [Number(localId), serverId]));
}

function remapFk(record, idMap, personIdMap = {}) {
    const r = { ...record };
    if (r.accountId != null && idMap[r.accountId] != null) r.accountId = idMap[r.accountId];
    if (r.targetAccountId != null && idMap[r.targetAccountId] != null) r.targetAccountId = idMap[r.targetAccountId];
    // Transfers (#248) carry two account FKs instead of one.
    if (r.fromAccountId != null && idMap[r.fromAccountId] != null) r.fromAccountId = idMap[r.fromAccountId];
    if (r.toAccountId != null && idMap[r.toAccountId] != null) r.toAccountId = idMap[r.toAccountId];
    // An unresolved person reference becomes null, never a dangling id.
    if (r.personId != null) r.personId = personIdMap[r.personId] ?? null;
    if (Array.isArray(r.personIds)) r.personIds = r.personIds.map(id => personIdMap[id] ?? null).filter(id => id !== null);
    // #272: ownershipSplit is keyed by person id — remap its keys the same way.
    if (r.ownershipSplit && typeof r.ownershipSplit === 'object') {
        r.ownershipSplit = Object.fromEntries(Object.entries(r.ownershipSplit).filter(([k]) => personIdMap[k] != null).map(([k, v]) => [personIdMap[k], v]));
    }
    return r;
}

// Map(String(oldId) -> newId) from records zipped with their POST responses.
function idPairs(records, results) {
    const m = new Map();
    (records || []).forEach((r, i) => {
        const rec = results?.[i];
        if (rec && r?.id != null) m.set(String(r.id), rec.id);
    });
    return m;
}

// Savings rows (#520) need each fund's export-time account to disambiguate
// emergency vs sinking fund ids; see ledgerKeyRemap.js.
function savingsPairs(records, results) {
    const out = [];
    (records || []).forEach((r, i) => {
        const rec = results?.[i];
        if (rec && r?.id != null) out.push({ oldId: r.id, newId: rec.id, oldAccountId: r.accountId ?? null });
    });
    return out;
}

// Rewrite the override/cleared keys (`type|sourceId|accountId|date`) to the
// new server ids (#520). Keys whose record or account isn't in the import are
// dropped, with one summary warning per map when the caller collects them.
function remapKeyedEntries(src, ledgerIdMaps, warnings) {
    const o = remapLedgerEntries(Object.entries(src.ledgerAmountOverrides || {}), ledgerIdMaps);
    const c = remapLedgerEntries(Object.entries(src.ledgerClearedTransactions || {}), ledgerIdMaps);
    if (Array.isArray(warnings)) {
        for (const w of [ledgerKeyDropWarning('Ledger Override', o.dropped), ledgerKeyDropWarning('Ledger Cleared Flag', c.dropped)]) {
            if (w) warnings.push(w);
        }
    }
    return { overrideEntries: o.entries, clearedEntries: c.entries };
}

// The keyed upserts (PUT is idempotent, so safe in replace and merge) as
// thunks, so the caller's pool decides when each request starts.
function keyedPuts(src, overrideEntries, clearedEntries, idMap, personIdMap) {
    return [
        ...overrideEntries.map(([key, val]) => () =>
            apiFetch('PUT', `/api/ledger-overrides/${encodeURIComponent(key)}`, remapFk(val, idMap, personIdMap))),
        ...clearedEntries.map(([key, val]) => () =>
            apiFetch('PUT', `/api/ledger-cleared/${encodeURIComponent(key)}`, val)),
        ...(src.monthlySnapshots || []).map(s => () =>
            apiFetch('PUT', `/api/net-worth-snapshots/${encodeURIComponent(s.date)}`, s)),
        ...(src.settings || []).filter(s => isAllowedSetting(s.key, s.value)).map(s => () =>
            apiFetch('PUT', `/api/settings/${encodeURIComponent(s.key)}`, s)),
    ];
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
        persons:               (app.persons || []).map(r => ({ ...r })),
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
        planHistory:           (app.planHistory || []).map(r => ({ ...r })),
        retirementSnapshots:   (app.retirementSnapshots || []).map(r => ({ ...r })),
        transfers:             (app.transfers || []).map(r => ({ ...r })),
        manualTransactions:    (app.manualTransactions || []).map(r => ({ ...r })),
        balanceHistory:        (app.balanceHistory || []).map(r => ({ ...r })),
        ledgerAmountOverrides: { ...app.ledgerAmountOverrides },
        ledgerClearedTransactions: { ...app.ledgerClearedTransactions },
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
        },
        retirementTargetDate:  app.retirementTargetDate ?? null,
        homePurchasePlan:      app.homePurchasePlan ?? null,
        budgetCategories:      app.budgetCategories ?? {}
    };
}

// Post accounts first (to get server IDs), then post all other resources with
// remapped FK references.  Returns idMap for app.* update after success.
async function postAllResources(data, warnings) {
    // Accounts first -- server assigns bigserial IDs we need for FK remapping
    const accountResults = await pool(data.accounts || [], acc => apiFetch('POST', '/api/accounts', acc));

    const idMap = {};
    (data.accounts || []).forEach((acc, i) => {
        if (accountResults[i]) idMap[acc.id] = accountResults[i].id;
    });

    // Persons second — IDs needed for personId/personIds FK remapping on debts/incomes
    const personResults = await pool(data.persons || [], p => apiFetch('POST', '/api/persons', p));
    const personIdMap = {};
    (data.persons || []).forEach((p, i) => {
        if (personResults[i]) personIdMap[p.id] = personResults[i].id;
    });

    // All non-account/person CRUD arrays with remapped FK references, one
    // resource at a time so the pool bounds the total in flight.
    const resourceResults = [];
    for (const { field, path } of CRUD_RESOURCES) {
        resourceResults.push(await pool(data[field] || [],
            record => apiFetch('POST', path, remapFk(record, idMap, personIdMap))));
    }

    // Keyed resources -- PUT is always upsert, safe in both replace and merge.
    // Their keys embed record and account ids, so remap them first (#520).
    const ledgerIdMaps = { accounts: new Map(Object.entries(idMap).map(([k, v]) => [String(k), v])) };
    CRUD_RESOURCES.forEach(({ field }, i) => { ledgerIdMaps[field] = idPairs(data[field], resourceResults[i]); });
    ledgerIdMaps.savings = [
        ...savingsPairs(data.emergencyFunds, resourceResults[CRUD_RESOURCES.findIndex(r => r.field === 'emergencyFunds')]),
        ...savingsPairs(data.sinkingFunds, resourceResults[CRUD_RESOURCES.findIndex(r => r.field === 'sinkingFunds')]),
    ];
    const { overrideEntries, clearedEntries } = remapKeyedEntries(data, ledgerIdMaps, warnings);
    await pool(keyedPuts(data, overrideEntries, clearedEntries, idMap, personIdMap), put => put());

    // Milestones -- ON CONFLICT DO NOTHING server-side, safe to call in both modes
    await pool(data.netWorthMilestonesAwarded || [],
        m => apiFetch('POST', '/api/plan-settings/milestones', { milestone: m }));

    // Plan-settings scalars
    await apiFetch('PATCH', '/api/plan-settings', {
        strategy:        data.strategy        ?? null,
        monthlyPayment:  data.monthlyPayment  ?? null,
        perMonthStimulus: data.perMonthStimulus || [],
        ledgerSettings:   data.ledgerSettings,
        forecastSettings: data.forecastSettings,
        retirementTargetDate: data.retirementTargetDate ?? null,
        homePurchasePlan: data.homePurchasePlan ?? null,
        budgetCategories: data.budgetCategories ?? {}
    });

    // Balance history FKs to debts (which remapFk doesn't handle), so it is
    // posted after debts exist, remapping debtId via the debt POST responses.
    const debtsIndex = CRUD_RESOURCES.findIndex(r => r.field === 'debts');
    const debtIdMap = new Map();
    (data.debts || []).forEach((d, i) => {
        const rec = resourceResults[debtsIndex][i];
        if (rec) debtIdMap.set(d.id, rec.id);
    });
    const balanceHistoryResults = await pool(
        remapHistoryOwners(data.balanceHistory || [], debtIdMap, accountIdMapFrom(idMap)),
        h => apiFetch('POST', '/api/balance-history', h));

    return { accountResults, personResults, resourceResults, balanceHistoryResults, idMap, personIdMap, overrideEntries, clearedEntries };
}

// Sync app.* with the server-returned records after a successful postAllResources.
function applyResultsToApp(app, data, { accountResults, personResults, resourceResults, balanceHistoryResults, idMap, personIdMap, overrideEntries, clearedEntries }) {
    app.accounts = accountResults.filter(Boolean);
    app.persons  = (personResults || []).filter(Boolean);

    CRUD_RESOURCES.forEach(({ field }, i) => {
        app[field] = resourceResults[i].filter(Boolean);
    });
    app.balanceHistory = (balanceHistoryResults || []).filter(Boolean);

    app.ledgerAmountOverrides = Object.fromEntries(
        overrideEntries.map(([key, val]) => [key, { overrideKey: key, ...remapFk(val, idMap, personIdMap) }])
    );
    app.ledgerClearedTransactions = Object.fromEntries(
        clearedEntries.map(([key, val]) => [key, { clearedKey: key, ...val }])
    );
    app.monthlySnapshots           = data.monthlySnapshots || [];
    app.settings                   = data.settings || [];
    app.netWorthMilestonesAwarded  = data.netWorthMilestonesAwarded || [];
    app.perMonthStimulus           = data.perMonthStimulus || [];
    app._savedMonthlyPayment       = data.monthlyPayment ?? null;
    app._savedStrategy             = data.strategy ?? null;
    app.retirementTargetDate       = data.retirementTargetDate ?? null;
    app.homePurchasePlan           = data.homePurchasePlan ?? null;
    app.budgetCategories           = data.budgetCategories ?? {};

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
        persons:               snapshot.persons,
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
        planHistory:           snapshot.planHistory,
        retirementSnapshots:   snapshot.retirementSnapshots,
        transfers:             snapshot.transfers,
        manualTransactions:    snapshot.manualTransactions || [],
        balanceHistory:        snapshot.balanceHistory,
        ledgerAmountOverrides: snapshot.ledgerAmountOverrides,
        ledgerClearedTransactions: snapshot.ledgerClearedTransactions,
        monthlySnapshots:      snapshot.monthlySnapshots,
        settings:              snapshot.settings,
        netWorthMilestonesAwarded: snapshot.netWorthMilestonesAwarded,
        perMonthStimulus:      snapshot.perMonthStimulus,
        strategy:              snapshot.strategy,
        monthlyPayment:        snapshot.monthlyPayment,
        ledgerSettings:        snapshot.ledgerSettings,
        forecastSettings:      snapshot.forecastSettings,
        retirementTargetDate:  snapshot.retirementTargetDate,
        homePurchasePlan:      snapshot.homePurchasePlan,
        budgetCategories:      snapshot.budgetCategories
    };
}

async function doReplaceRollback(app, snapshot) {
    try {
        await pgDeleteAll(app);
        const results = await postAllResources(snapshotToPostData(snapshot));
        applyResultsToApp(app, snapshotToPostData(snapshot), results);
    } catch (rollbackErr) {
        console.error('[pgImport] Rollback also failed — data may be inconsistent:', rollbackErr);
        showSyncErrorBanner();
    }
}

// ─── Public API ──────────────────────────────────────────────────────────────

// Replace-mode import: wipe server, re-post everything from clean, rollback to
// snapshot on any failure.
// `warnings` (optional) collects import warnings, e.g. dropped ledger keys.
export async function replaceForPostgres(app, clean, incomingStrategy, warnings) {
    const snapshot = snapshotAppState(app);

    const data = {
        ...clean,
        strategy:       normalizeText(incomingStrategy?.paymentStrategy, 30) || null,
        monthlyPayment: sanitizeFiniteNumber(incomingStrategy?.monthlyPayment, null, { min: 0 })
    };

    try {
        await pgDeleteAll(app);
        const results = await postAllResources(data, warnings);
        applyResultsToApp(app, data, results);
    } catch (err) {
        console.error('[pgImport] Replace failed, rolling back:', err);
        await doReplaceRollback(app, snapshot);
        showSyncErrorBanner();
        throw err;
    } finally {
        // Every collection now holds server rows (imported or restored) (#578).
        seedShadows(app);
    }
}

// Merge-mode import: POST only new records (by name), PUT keyed resources,
// rollback only newly created records on failure.
export async function mergeForPostgres(app, clean, incomingStrategy, warnings) {
    const snapshot = snapshotAppState(app);
    const newlyCreatedPaths = [];
    // Records skipped as duplicates, per collection (#567, #478).
    const skipped = {};
    const noteSkipped = (field, n) => { if (n > 0) skipped[field] = (skipped[field] || 0) + n; };

    try {
        // Accounts and persons dedupe by name against existing rows and
        // against earlier repeats in the file (planMerge in mergeDedupe.js).
        const idMap = {};
        const accPlan = planMerge('accounts', app.accounts, clean.accounts || []);
        for (const [inId, existingId] of accPlan.matched) if (inId != null) idMap[inId] = existingId;
        noteSkipped('accounts', accPlan.skipped);

        // POST new accounts, collect server IDs
        const newAccounts = accPlan.toPost;
        const newAccountResults = await pool(newAccounts, acc => apiFetch('POST', '/api/accounts', acc));
        newAccounts.forEach((acc, i) => {
            const rec = newAccountResults[i];
            if (rec) {
                idMap[acc.id] = rec.id;
                newlyCreatedPaths.push(`/api/accounts/${rec.id}`);
                app.accounts.push(rec);
            }
        });
        for (const [repeatId, firstId] of accPlan.repeats) {
            if (repeatId != null && idMap[firstId] != null) idMap[repeatId] = idMap[firstId];
        }

        const personIdMap = {};
        const personPlan = planMerge('persons', app.persons || [], clean.persons || []);
        for (const [inId, existingId] of personPlan.matched) if (inId != null) personIdMap[inId] = existingId;
        noteSkipped('persons', personPlan.skipped);
        const newPersons = personPlan.toPost;
        const newPersonResults = await pool(newPersons, p => apiFetch('POST', '/api/persons', p));
        newPersons.forEach((p, i) => {
            const rec = newPersonResults[i];
            if (rec) {
                personIdMap[p.id] = rec.id;
                newlyCreatedPaths.push(`/api/persons/${rec.id}`);
                (app.persons = app.persons || []).push(rec);
            }
        });
        for (const [repeatId, firstId] of personPlan.repeats) {
            if (repeatId != null && personIdMap[firstId] != null) personIdMap[repeatId] = personIdMap[firstId];
        }

        // POST new records for each CRUD resource (dedup by name where applicable).
        // ledgerIdMaps records where every incoming id ended up (#520): a
        // name-matched record resolves to the existing one, a posted record to
        // its new id, so imported Ledger keys attach to the surviving record.
        const ledgerIdMaps = { accounts: new Map(Object.entries(idMap).map(([k, v]) => [String(k), v])), savings: [] };
        for (const { field, path } of CRUD_RESOURCES) {
            const fieldMap = new Map();
            // FK parts of the natural keys are remapped first, so they compare
            // against the server ids the existing records hold.
            const originals = new Map((clean[field] || []).map(r => [r?.id, r]));
            const plan = planMerge(field, app[field] || [],
                (clean[field] || []).map(r => remapFk(r, idMap, personIdMap)));
            noteSkipped(field, plan.skipped);
            for (const [inId, existingId] of plan.matched) if (inId != null) fieldMap.set(String(inId), existingId);
            const incoming = plan.toPost.map(r => originals.get(r?.id) ?? r);

            const results = await pool(plan.toPost, r => apiFetch('POST', path, r));
            results.forEach(rec => {
                if (rec) {
                    newlyCreatedPaths.push(`${path}/${rec.id}`);
                    app[field].push(rec);
                }
            });
            for (const [k, v] of idPairs(incoming, results)) fieldMap.set(k, v);
            // In-file repeats resolve to the record that was posted for them (#478).
            for (const [repeatId, firstId] of plan.repeats) {
                if (repeatId != null && fieldMap.has(String(firstId))) fieldMap.set(String(repeatId), fieldMap.get(String(firstId)));
            }
            ledgerIdMaps[field] = fieldMap;
            if (field === 'emergencyFunds' || field === 'sinkingFunds') {
                ledgerIdMaps.savings.push(...savingsPairs(incoming, results));
            }
        }

        // Balance history: debts are name-deduped, so resolve each incoming
        // debt to the surviving (existing or newly posted) debt by name.
        const debtIdByName = new Map(app.debts.map(d => [d.name?.toLowerCase(), d.id]));
        const debtIdMap = new Map((clean.debts || []).map(d => [d.id, debtIdByName.get(d.name?.toLowerCase())]));
        const historyToPost = excludeExistingHistory(
            app.balanceHistory || [],
            remapHistoryOwners(clean.balanceHistory || [], debtIdMap, accountIdMapFrom(idMap))
        );
        const historyResults = await pool(historyToPost, h => apiFetch('POST', '/api/balance-history', h));
        historyResults.forEach(rec => {
            if (rec) {
                newlyCreatedPaths.push(`/api/balance-history/${rec.id}`);
                (app.balanceHistory = app.balanceHistory || []).push(rec);
            }
        });

        // Keyed resources -- always upsert (safe merge semantics), keys remapped (#520)
        const { overrideEntries, clearedEntries } = remapKeyedEntries(clean, ledgerIdMaps, warnings);
        await pool(keyedPuts(clean, overrideEntries, clearedEntries, idMap, personIdMap), put => put());

        // Merge keyed resources into app state
        for (const [key, val] of overrideEntries) {
            app.ledgerAmountOverrides[key] = { overrideKey: key, ...remapFk(val, idMap, personIdMap) };
        }
        for (const [key, val] of clearedEntries) {
            app.ledgerClearedTransactions[key] = { clearedKey: key, ...val };
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
        await pool(clean.netWorthMilestonesAwarded || [],
            m => apiFetch('POST', '/api/plan-settings/milestones', { milestone: m }));
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
        if (clean.retirementTargetDate) app.retirementTargetDate = clean.retirementTargetDate;
        if (clean.homePurchasePlan) app.homePurchasePlan = clean.homePurchasePlan;
        app.budgetCategories = { ...(app.budgetCategories || {}), ...(clean.budgetCategories || {}) };
        await apiFetch('PATCH', '/api/plan-settings', {
            strategy:        app._savedStrategy,
            monthlyPayment:  app._savedMonthlyPayment,
            perMonthStimulus: app.perMonthStimulus,
            ledgerSettings:   clean.ledgerSettings,
            forecastSettings: clean.forecastSettings,
            retirementTargetDate: app.retirementTargetDate,
            homePurchasePlan: app.homePurchasePlan ?? null,
            budgetCategories: app.budgetCategories ?? {}
        });

        return { skipped };
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
            planHistory:          snapshot.planHistory,
            retirementSnapshots:  snapshot.retirementSnapshots,
            transfers:            snapshot.transfers,
            manualTransactions:   snapshot.manualTransactions || [],
            retirementTargetDate: snapshot.retirementTargetDate,
            homePurchasePlan:     snapshot.homePurchasePlan,
            budgetCategories:     snapshot.budgetCategories,
            balanceHistory:       snapshot.balanceHistory,
            ledgerAmountOverrides: snapshot.ledgerAmountOverrides,
            ledgerClearedTransactions: snapshot.ledgerClearedTransactions,
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
        await mapSettledWithConcurrency(newlyCreatedPaths, IMPORT_CONCURRENCY,
            path => fetch(path, { method: 'DELETE', headers: { 'X-CSRF-Token': getCsrfCookie() } }));
        showSyncErrorBanner();
        throw err;
    } finally {
        // Kept and newly created records are all server rows (#578).
        seedShadows(app);
    }
}
