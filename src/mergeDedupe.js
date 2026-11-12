// Merge-mode import dedupe (#567, #478). Pure and DOM-free: decides, per
// collection, which incoming records already exist (or repeat earlier in the
// same file) and so must not be POSTed. No imports, so it stays a leaf module.
//
// A record's natural key is a string, or null meaning "never dedupe".
// Foreign-key parts (accountId, fromAccountId, ...) must already be remapped to
// server ids on the incoming side, or they never match existing records.
// A new CRUD resource needs an entry in KEY_FNS, or merge re-creates it on
// every re-import.

function nameKey(r) {
    const n = typeof r?.name === 'string' ? r.name.trim().toLowerCase() : '';
    return n || null;
}

// Calendar date as YYYY-MM-DD. Incoming dates are ISO strings or Date objects
// (expenses); the server returns date columns as strings.
function dayPart(v) {
    if (v instanceof Date) {
        if (Number.isNaN(v.getTime())) return null;
        const p = n => String(n).padStart(2, '0');
        return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
    }
    if (typeof v === 'string') {
        const m = /^(\d{4}-\d{2}-\d{2})/.exec(v.trim());
        return m ? m[1] : null;
    }
    return null;
}

function numPart(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : null;
}

function idPart(v) {
    return v === null || v === undefined || v === '' ? null : String(v);
}

// An instant in ms since epoch. Postgres returns timestamptz as
// "2026-11-12 10:00:00.123+00", the export carries "2026-11-12T10:00:00.123Z".
function instantPart(v) {
    if (typeof v !== 'string') return null;
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(v.trim());
    if (!m) return null;
    let tz = m[4] || 'Z';
    if (tz !== 'Z') {
        const d = tz.replace(':', '');
        tz = `${d.slice(0, 3)}:${d.length > 3 ? d.slice(3, 5) : '00'}`;
    }
    const frac = m[3] ? m[3].slice(1, 4).padEnd(3, '0') : '000';
    const ms = Date.parse(`${m[1]}T${m[2]}.${frac}${tz}`);
    return Number.isNaN(ms) ? null : String(ms);
}

function join(parts) {
    return parts.some(p => p === null) ? null : parts.join('|');
}

const KEY_FNS = {
    accounts: nameKey,
    persons: nameKey,
    debts: nameKey,
    incomes: nameKey,
    bonuses: nameKey,
    bills: nameKey,
    recurringTemplates: nameKey,
    sinkingFunds: nameKey,
    expenses: r => { const n = nameKey(r); return n === null ? null : `${n}|${dayPart(r.date) ?? ''}`; },
    emergencyFunds: r => join([idPart(r?.accountId)]),
    transfers: r => join([idPart(r?.fromAccountId), idPart(r?.toAccountId), numPart(r?.amount), dayPart(r?.date)]),
    retirementSnapshots: r => join([idPart(r?.accountId), dayPart(r?.date)]),
    reconciliations: r => join([idPart(r?.accountId), dayPart(r?.statementEndDate) ?? dayPart(r?.date)]),
    planHistory: r => join([instantPart(r?.createdAt)]),
    manualTransactions: r => join([idPart(r?.accountId), dayPart(r?.date), numPart(r?.amount), nameKey(r)]),
};

export function mergeKeyFor(field, record) {
    const fn = KEY_FNS[field];
    if (!fn || !record || typeof record !== 'object') return null;
    const key = fn(record);
    return key === null || key === undefined ? null : `${field}:${key}`;
}

// Splits `incoming` into records to POST and records to skip.
//   toPost:   incoming records to create, original order kept.
//   matched:  [incomingId, existingId] for records that match an existing one.
//   repeats:  [incomingId, firstIncomingId] for in-file repeats of a record
//             that is being posted; resolve to the first one's new id.
//   skipped:  matched.length + repeats.length (null-key records are never skipped).
export function planMerge(field, existing, incoming) {
    const existingByKey = new Map();
    for (const r of existing || []) {
        const k = mergeKeyFor(field, r);
        if (k !== null && !existingByKey.has(k)) existingByKey.set(k, r.id);
    }
    const firstByKey = new Map();
    const toPost = [];
    const matched = [];
    const repeats = [];
    for (const r of incoming || []) {
        const k = mergeKeyFor(field, r);
        if (k === null) { toPost.push(r); continue; }
        if (existingByKey.has(k)) {
            if (r?.id != null) matched.push([r.id, existingByKey.get(k)]);
            else matched.push([null, existingByKey.get(k)]);
        } else if (firstByKey.has(k)) {
            repeats.push([r?.id ?? null, firstByKey.get(k)]);
        } else {
            firstByKey.set(k, r?.id ?? null);
            toPost.push(r);
        }
    }
    return { toPost, matched, repeats, skipped: matched.length + repeats.length };
}
