// The import algorithm (#529), shared by the browser tests and the server's
// POST /api/import. It decides what to create, in which order, and how every
// foreign key, Ledger key and account-id setting is remapped; the `store`
// argument is the only thing that touches storage. The server passes a store
// backed by one database transaction, the Jest tests an in-memory fake.
//
// Pure: it may import only other pure modules. The server imports this file by
// relative path, so it must never import ui.js, postgresSync.js, storage.js,
// settings.js or any DOM/network module.
//
// store (every call is awaited one at a time):
//   deleteAll()                          replace only: wipe the user's data
//   create(field, record, index)         accounts, persons, a CRUD_RESOURCES field or
//                                        balanceHistory; returns the stored row (has .id)
//   putKeyed(kind, key, value)           kind: ledgerOverride | ledgerCleared |
//                                        netWorthSnapshot | setting
//   addMilestone(milestone)
//   patchPlanSettings(patch)
// `index` is the record's position in the incoming array, for error messages.
// A store reports a record it rejects by throwing; runImport lets that
// propagate, so there is never a partial "success".

import { sanitizeFiniteNumber, normalizeText, dateToISO } from './utils.js';
import { remapHistoryOwners, excludeExistingHistory } from './balanceHistoryCore.js';
import { planMerge } from './mergeDedupe.js';
import { remapLedgerEntries, ledgerKeyDropWarning } from './ledgerKeyRemap.js';
import { isAllowedSetting } from './settingsSchema.js';
import { remapAccountSettings } from './settingsRemap.js';
import { remapDebtPersonRefs, remapIncomePersonRef } from './sanitizers.js';
import { remapPlanHistoryDebtIds } from './planHistoryCompare.js';

// The CRUD collections that carry account / person foreign keys, in the order
// they are created. `path` is the REST collection (kept for the lists that
// cross-check it). Accounts, persons and balance history are handled by their
// own steps. A new CRUD resource needs an entry here.
export const CRUD_RESOURCES = [
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

// JSON for an import body or for records handed to the per-record sanitizers.
// The sanitizers turn an expense's date into a local-midnight Date object;
// JSON.stringify would write it as a UTC instant, which is the previous day
// anywhere east of Greenwich. A Date at local midnight is written as its
// calendar date instead, so the date means the same on both sides.
export function toWireJson(value) {
    return JSON.stringify(value, function replacer(key, converted) {
        const raw = this[key];
        if (raw instanceof Date && !Number.isNaN(raw.getTime())
            && raw.getHours() === 0 && raw.getMinutes() === 0 && raw.getSeconds() === 0 && raw.getMilliseconds() === 0) {
            return dateToISO(raw);
        }
        return converted;
    });
}

function accountIdMapFrom(idMap) {
    return new Map(Object.entries(idMap).map(([localId, serverId]) => [Number(localId), serverId]));
}

export function remapFk(record, idMap, personIdMap = {}) {
    let r = { ...record };
    if (r.accountId != null && idMap[r.accountId] != null) r.accountId = idMap[r.accountId];
    if (r.targetAccountId != null && idMap[r.targetAccountId] != null) r.targetAccountId = idMap[r.targetAccountId];
    // Transfers (#248) carry two account FKs instead of one.
    if (r.fromAccountId != null && idMap[r.fromAccountId] != null) r.fromAccountId = idMap[r.fromAccountId];
    if (r.toAccountId != null && idMap[r.toAccountId] != null) r.toAccountId = idMap[r.toAccountId];
    // Person references (#421, #471): the pure sanitizers.js helpers are the
    // one implementation. An unresolved id becomes null (income) or is dropped
    // (debt personIds, and its #272 ownershipSplit keys, renormalized).
    if (r.personId != null) r = remapIncomePersonRef(r, personIdMap);
    if (Array.isArray(r.personIds)) r = remapDebtPersonRefs(r, personIdMap);
    return r;
}

// Map(String(oldId) -> newId) from records zipped with their created rows.
export function idPairs(records, results) {
    const m = new Map();
    (records || []).forEach((r, i) => {
        const rec = results?.[i];
        if (rec && r?.id != null) m.set(String(r.id), rec.id);
    });
    return m;
}

// Savings rows (#520) need each fund's export-time account to disambiguate
// emergency vs sinking fund ids; see ledgerKeyRemap.js.
export function savingsPairs(records, results) {
    const out = [];
    (records || []).forEach((r, i) => {
        const rec = results?.[i];
        if (rec && r?.id != null) out.push({ oldId: r.id, newId: rec.id, oldAccountId: r.accountId ?? null });
    });
    return out;
}

// Rewrite the override/cleared keys (`type|sourceId|accountId|date`) to the
// new ids (#520). Keys whose record or account isn't in the import are
// dropped, with one summary warning per map.
function remapKeyedEntries(src, ledgerIdMaps, warnings) {
    const o = remapLedgerEntries(Object.entries(src.ledgerAmountOverrides || {}), ledgerIdMaps);
    const c = remapLedgerEntries(Object.entries(src.ledgerClearedTransactions || {}), ledgerIdMaps);
    for (const w of [ledgerKeyDropWarning('Ledger Override', o.dropped), ledgerKeyDropWarning('Ledger Cleared Flag', c.dropped)]) {
        if (w) warnings.push(w);
    }
    return { overrideEntries: o.entries, clearedEntries: c.entries };
}

// Remap the settings that hold an account id through the finished account id
// map (#651). A dropped value is reported as an import warning; a plain
// remap to the new id is not.
function remapSettingsForImport(settings, idMap, warnings) {
    const { settings: remapped, changes } = remapAccountSettings(settings, idMap);
    for (const c of changes) {
        if (c.kind === 'rejected') {
            warnings.push({ recordType: 'Setting', recordName: c.key, kind: 'rejected', reason: 'account not in import' });
        }
    }
    return remapped;
}

// The keyed upserts (idempotent, so safe in replace and merge), in order.
async function putKeyedEntries(store, src, overrideEntries, clearedEntries, idMap, personIdMap, settings) {
    for (const [key, val] of overrideEntries) {
        await store.putKeyed('ledgerOverride', key, remapFk(val, idMap, personIdMap));
    }
    for (const [key, val] of clearedEntries) await store.putKeyed('ledgerCleared', key, val);
    for (const s of (src.monthlySnapshots || [])) await store.putKeyed('netWorthSnapshot', s.date, s);
    for (const s of (settings || []).filter(x => isAllowedSetting(x.key, x.value))) {
        await store.putKeyed('setting', s.key, s);
    }
}

// The server feeds this user-supplied JSON (#529): iterate only real arrays,
// never an object's own `length`.
const asArray = v => (Array.isArray(v) ? v : []);

async function createAll(store, field, records) {
    const out = [];
    let i = 0;
    for (const record of asArray(records)) out.push(await store.create(field, record, i++));
    return out;
}

// Where each record sits in the incoming array, for error messages.
function indexById(records) {
    const m = new Map();
    (records || []).forEach((r, i) => { if (r?.id != null && !m.has(r.id)) m.set(r.id, i); });
    return m;
}

async function createPlanned(store, field, toPost, incomingRecords) {
    const idx = indexById(incomingRecords);
    const out = [];
    let i = 0;
    for (const record of asArray(toPost)) {
        out.push(await store.create(field, record, idx.get(record?.id) ?? i));
        i++;
    }
    return out;
}

function milestonesOf(data) {
    return data.netWorthMilestonesAwarded || [];
}

// Replace: the server collection is wiped, then everything is created from
// clean, with the new ids remapped into every reference.
async function replaceAll(data, store, warnings) {
    await store.deleteAll();

    // Accounts first -- the server assigns the ids we need for FK remapping.
    const accountResults = await createAll(store, 'accounts', data.accounts || []);
    const idMap = {};
    (data.accounts || []).forEach((acc, i) => {
        if (accountResults[i]) idMap[acc.id] = accountResults[i].id;
    });

    // Persons second: their ids remap personId/personIds on debts and incomes.
    const personResults = await createAll(store, 'persons', data.persons || []);
    const personIdMap = {};
    (data.persons || []).forEach((p, i) => {
        if (personResults[i]) personIdMap[p.id] = personResults[i].id;
    });

    const resourceResults = [];
    let debtIds = new Map();
    for (const { field } of CRUD_RESOURCES) {
        // #312: Plan History entries name debts by id inside their per-debt list.
        const remap = field === 'planHistory'
            ? record => remapPlanHistoryDebtIds(remapFk(record, idMap, personIdMap), debtIds)
            : record => remapFk(record, idMap, personIdMap);
        const results = [];
        let i = 0;
        for (const record of asArray(data[field])) results.push(await store.create(field, remap(record), i++));
        resourceResults.push(results);
        if (field === 'debts') debtIds = idPairs(data.debts, results);
    }

    // Keyed resources: their keys embed record and account ids, so remap them
    // first (#520).
    const ledgerIdMaps = { accounts: new Map(Object.entries(idMap).map(([k, v]) => [String(k), v])) };
    CRUD_RESOURCES.forEach(({ field }, i) => { ledgerIdMaps[field] = idPairs(data[field], resourceResults[i]); });
    ledgerIdMaps.savings = [
        ...savingsPairs(data.emergencyFunds, resourceResults[CRUD_RESOURCES.findIndex(r => r.field === 'emergencyFunds')]),
        ...savingsPairs(data.sinkingFunds, resourceResults[CRUD_RESOURCES.findIndex(r => r.field === 'sinkingFunds')]),
    ];
    const { overrideEntries, clearedEntries } = remapKeyedEntries(data, ledgerIdMaps, warnings);
    const settings = remapSettingsForImport(data.settings, idMap, warnings);
    await putKeyedEntries(store, data, overrideEntries, clearedEntries, idMap, personIdMap, settings);

    // Milestones are ON CONFLICT DO NOTHING in the store, safe in both modes.
    for (const m of milestonesOf(data)) await store.addMilestone(m);

    await store.patchPlanSettings({
        strategy:        data.strategy        ?? null,
        monthlyPayment:  data.monthlyPayment  ?? null,
        perMonthStimulus: data.perMonthStimulus || [],
        ledgerSettings:   data.ledgerSettings,
        forecastSettings: data.forecastSettings,
        retirementTargetDate: data.retirementTargetDate ?? null,
        homePurchasePlan: data.homePurchasePlan ?? null,
        budgetCategories: data.budgetCategories ?? {}
    });

    // Balance history references debts (which remapFk doesn't handle), so it
    // is created after debts exist, remapping debtId through the created rows.
    const debtsIndex = CRUD_RESOURCES.findIndex(r => r.field === 'debts');
    const debtIdMap = new Map();
    (data.debts || []).forEach((d, i) => {
        const rec = resourceResults[debtsIndex][i];
        if (rec) debtIdMap.set(d.id, rec.id);
    });
    await createAll(store, 'balanceHistory',
        remapHistoryOwners(data.balanceHistory || [], debtIdMap, accountIdMapFrom(idMap)));

    return {};
}

// Merge: create only the records whose natural key is not already there (or
// repeated earlier in the file), upsert keyed resources, merge plan settings.
// `existing` is the user's current state (browser shape). It is copied, never
// mutated.
async function mergeInto(clean, store, existing, strategy, warnings) {
    const cur = {
        accounts: [...(existing.accounts || [])],
        persons: [...(existing.persons || [])],
        balanceHistory: [...(existing.balanceHistory || [])],
    };
    for (const { field } of CRUD_RESOURCES) cur[field] = [...(existing[field] || [])];

    // Records skipped as duplicates, per collection (#567, #478).
    const skipped = {};
    const noteSkipped = (field, n) => { if (n > 0) skipped[field] = (skipped[field] || 0) + n; };

    // Accounts and persons dedupe by name against existing rows and against
    // earlier repeats in the file (planMerge in mergeDedupe.js).
    const idMap = {};
    const accPlan = planMerge('accounts', cur.accounts, clean.accounts || []);
    for (const [inId, existingId] of accPlan.matched) if (inId != null) idMap[inId] = existingId;
    noteSkipped('accounts', accPlan.skipped);
    const newAccountResults = await createPlanned(store, 'accounts', accPlan.toPost, clean.accounts);
    accPlan.toPost.forEach((acc, i) => {
        const rec = newAccountResults[i];
        if (rec) {
            idMap[acc.id] = rec.id;
            cur.accounts.push(rec);
        }
    });
    for (const [repeatId, firstId] of accPlan.repeats) {
        if (repeatId != null && idMap[firstId] != null) idMap[repeatId] = idMap[firstId];
    }

    const personIdMap = {};
    const personPlan = planMerge('persons', cur.persons, clean.persons || []);
    for (const [inId, existingId] of personPlan.matched) if (inId != null) personIdMap[inId] = existingId;
    noteSkipped('persons', personPlan.skipped);
    const newPersonResults = await createPlanned(store, 'persons', personPlan.toPost, clean.persons);
    personPlan.toPost.forEach((p, i) => {
        const rec = newPersonResults[i];
        if (rec) {
            personIdMap[p.id] = rec.id;
            cur.persons.push(rec);
        }
    });
    for (const [repeatId, firstId] of personPlan.repeats) {
        if (repeatId != null && personIdMap[firstId] != null) personIdMap[repeatId] = personIdMap[firstId];
    }

    // New records for each CRUD resource (dedupe by natural key). ledgerIdMaps
    // records where every incoming id ended up (#520): a matched record
    // resolves to the existing one, a created record to its new id, so
    // imported Ledger keys attach to the surviving record.
    const ledgerIdMaps = { accounts: new Map(Object.entries(idMap).map(([k, v]) => [String(k), v])), savings: [] };
    for (const { field } of CRUD_RESOURCES) {
        const fieldMap = new Map();
        // FK parts of the natural keys are remapped first, so they compare
        // against the ids the existing records hold.
        const originals = new Map((clean[field] || []).map(r => [r?.id, r]));
        const plan = planMerge(field, cur[field],
            (clean[field] || []).map(r => (field === 'planHistory'
                ? remapPlanHistoryDebtIds(remapFk(r, idMap, personIdMap), ledgerIdMaps.debts) // #312
                : remapFk(r, idMap, personIdMap))));
        noteSkipped(field, plan.skipped);
        for (const [inId, existingId] of plan.matched) if (inId != null) fieldMap.set(String(inId), existingId);
        const incoming = plan.toPost.map(r => originals.get(r?.id) ?? r);

        const results = await createPlanned(store, field, plan.toPost, clean[field]);
        results.forEach(rec => { if (rec) cur[field].push(rec); });
        for (const [k, v] of idPairs(incoming, results)) fieldMap.set(k, v);
        // In-file repeats resolve to the record that was created for them (#478).
        for (const [repeatId, firstId] of plan.repeats) {
            if (repeatId != null && fieldMap.has(String(firstId))) fieldMap.set(String(repeatId), fieldMap.get(String(firstId)));
        }
        ledgerIdMaps[field] = fieldMap;
        if (field === 'emergencyFunds' || field === 'sinkingFunds') {
            ledgerIdMaps.savings.push(...savingsPairs(incoming, results));
        }
    }

    // Balance history: debts are name-deduped, so resolve each incoming debt
    // to the surviving (existing or newly created) debt by name.
    const debtIdByName = new Map(cur.debts.map(d => [d.name?.toLowerCase(), d.id]));
    const debtIdMap = new Map((clean.debts || []).map(d => [d.id, debtIdByName.get(d.name?.toLowerCase())]));
    const historyToPost = excludeExistingHistory(
        cur.balanceHistory,
        remapHistoryOwners(clean.balanceHistory || [], debtIdMap, accountIdMapFrom(idMap))
    );
    await createAll(store, 'balanceHistory', historyToPost);

    // Keyed resources always upsert (safe merge semantics), keys remapped (#520).
    const { overrideEntries, clearedEntries } = remapKeyedEntries(clean, ledgerIdMaps, warnings);
    const settings = remapSettingsForImport(clean.settings, idMap, warnings);
    await putKeyedEntries(store, clean, overrideEntries, clearedEntries, idMap, personIdMap, settings);

    // Milestones are additive.
    for (const m of milestonesOf(clean)) await store.addMilestone(m);

    // Plan settings: the file's values win, except the optional ones it does
    // not carry; budget categories are merged key by key.
    const retirementTargetDate = clean.retirementTargetDate || existing.retirementTargetDate || null;
    const homePurchasePlan = clean.homePurchasePlan || existing.homePurchasePlan || null;
    const budgetCategories = { ...(existing.budgetCategories || {}), ...(clean.budgetCategories || {}) };
    await store.patchPlanSettings({
        strategy:        strategy.strategy,
        monthlyPayment:  strategy.monthlyPayment,
        perMonthStimulus: clean.perMonthStimulus || [],
        ledgerSettings:   clean.ledgerSettings,
        forecastSettings: clean.forecastSettings,
        retirementTargetDate,
        homePurchasePlan,
        budgetCategories
    });

    return skipped;
}

// `data` is sanitized state (sanitizeParsedState output); `strategy` is the
// file's { paymentStrategy, monthlyPayment } (or null). Resolves to
// { warnings, skipped }; rejects with whatever the store threw.
export async function runImport({ mode, data, strategy, existing, store }) {
    if (mode !== 'replace' && mode !== 'merge') throw new Error(`Unknown import mode: ${mode}`);
    const warnings = [];
    const plan = {
        strategy: normalizeText(strategy?.paymentStrategy, 30) || null,
        monthlyPayment: sanitizeFiniteNumber(strategy?.monthlyPayment, null, { min: 0 }),
    };
    if (mode === 'replace') {
        await replaceAll({ ...data, strategy: plan.strategy, monthlyPayment: plan.monthlyPayment }, store, warnings);
        return { warnings, skipped: {} };
    }
    const skipped = await mergeInto(data, store, existing || {}, plan, warnings);
    return { warnings, skipped };
}
