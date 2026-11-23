// Plan History per-debt comparison (#312). Pure, import-free and DOM-free
// (Jest + Stryker scope): what a Plan History entry records per debt, and the
// row-by-row comparison of two entries.

export const PLAN_HISTORY_DEBTS_MAX = 200;

const round2 = n => Math.round(n * 100) / 100;

function isoMonthStart(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

// One entry per interest-bearing debt of a finished plan: its id and name,
// the month it is paid off (first of that month; null when it never is) and
// the interest it costs. Fixed-amount debts have no payoff or interest to
// compare and are left out.
export function buildPlanDebtSnapshot(workingDebts, paymentPlan) {
    const plan = Array.isArray(paymentPlan) ? paymentPlan : [];
    return (Array.isArray(workingDebts) ? workingDebts : [])
        .filter(d => d && d.debtType !== 'fixedAmount')
        .slice(0, PLAN_HISTORY_DEBTS_MAX)
        .map(d => {
            const month = Number.isInteger(d.paidOffMonth) && d.paidOffMonth > 0 ? d.paidOffMonth : null;
            const entry = month !== null ? plan[month - 1] : null;
            return {
                debtId: Number.isInteger(d.id) ? d.id : null,
                name: typeof d.name === 'string' ? d.name : '',
                payoffDate: entry ? isoMonthStart(new Date(entry.date)) : null,
                totalInterest: round2(Number(d.totalInterest) || 0),
            };
        });
}

// Whole months from one YYYY-MM-DD to another (b - a), or null.
export function monthsBetween(aIso, bIso) {
    const parse = iso => {
        const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(typeof iso === 'string' ? iso : '');
        return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
    };
    const a = parse(aIso);
    const b = parse(bIso);
    return a === null || b === null ? null : b - a;
}

const keyOf = d => (d.debtId !== null && d.debtId !== undefined ? `id:${d.debtId}` : `name:${d.name}`);

// Compare entry A with entry B, one row per debt in either, in A's order and
// then B's new debts. Each row: { name, a, b, payoffDelta (months, B - A),
// interestDelta (B - A) }, where a/b are the debt's snapshot or null when the
// debt is not in that plan. Deltas are null unless both sides have a value.
// Returns null when either entry has no per-debt data (older entries).
export function comparePlanEntries(entryA, entryB) {
    const a = Array.isArray(entryA?.debts) ? entryA.debts : [];
    const b = Array.isArray(entryB?.debts) ? entryB.debts : [];
    if (a.length === 0 || b.length === 0) return null;
    const bByKey = new Map(b.map(d => [keyOf(d), d]));
    const seen = new Set();
    const rows = [];
    const row = (da, db) => ({
        name: (db || da).name,
        a: da,
        b: db,
        payoffDelta: da && db ? monthsBetween(da.payoffDate, db.payoffDate) : null,
        interestDelta: da && db ? round2(db.totalInterest - da.totalInterest) : null,
    });
    for (const da of a) {
        const key = keyOf(da);
        seen.add(key);
        rows.push(row(da, bByKey.get(key) || null));
    }
    for (const db of b) {
        if (!seen.has(keyOf(db))) rows.push(row(null, db));
    }
    return {
        rows,
        totals: {
            interestA: round2(a.reduce((s, d) => s + d.totalInterest, 0)),
            interestB: round2(b.reduce((s, d) => s + d.totalInterest, 0)),
        },
    };
}

// 'better' when B is lower (earlier payoff, less interest), 'worse' when
// higher, 'same' at 0, null when there is nothing to compare.
export function deltaTone(delta) {
    if (delta === null || delta === undefined || !Number.isFinite(delta)) return null;
    if (delta < 0) return 'better';
    if (delta > 0) return 'worse';
    return 'same';
}

// On import, debt ids change; rewrite each per-debt entry's debtId through
// `debtIdMap` (Map of String(oldId) -> newId). An unresolved id becomes null,
// so the comparison falls back to matching by name.
export function remapPlanHistoryDebtIds(entry, debtIdMap) {
    if (!entry || !Array.isArray(entry.debts)) return entry;
    const map = debtIdMap instanceof Map ? debtIdMap : new Map();
    return {
        ...entry,
        debts: entry.debts.map(d => {
            if (!d || d.debtId === null || d.debtId === undefined) return d;
            const next = map.get(String(d.debtId));
            return { ...d, debtId: next === undefined ? null : next };
        }),
    };
}

// Milliseconds for a stored createdAt: an ISO string, or Postgres text such as
// "2026-02-05 12:00:00+00". 0 when missing or unreadable.
function createdAtMs(value) {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
    if (typeof value !== 'string' || !value) return 0;
    const iso = value.trim().replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00');
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : 0;
}

// Plan History entries oldest first, by when the plan was saved, then by id.
// The server lists them by id, and ids follow the order the records were
// created, which an import does several at a time, so ids alone can put an
// older plan after a newer one. Returns a new array.
export function sortPlanEntries(entries) {
    return (Array.isArray(entries) ? entries : [])
        .slice()
        .sort((a, b) => (createdAtMs(a?.createdAt) - createdAtMs(b?.createdAt)) || (Number(a?.id) - Number(b?.id)));
}
