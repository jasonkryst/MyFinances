// #678: effective-dated amounts for income sources and recurring templates.
//
// A record keeps its base `amount` (in effect before the first change) plus
// `amountChanges: [{ from: 'YYYY-MM-DD', amount }]`, ascending by `from`.
// getAmountOn() is the single definition of "the amount on a date"; every
// per-occurrence read uses it with the occurrence date, every display uses
// today. Dates are local YYYY-MM-DD strings, compared as strings.
//
// Pure leaf module with no imports: the server imports it by relative path
// (calendar feed, sanitizers), and every export is a hoisted function so it is
// safe inside the ui.js/postgresSync.js import cycles.

const MAX_CHANGES = 120;
const MAX_AMOUNT = 1e9;

function _isIsoDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function _dayBefore(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d - 1));
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

function _base(record) {
    const n = Number(record?.amount);
    return Number.isFinite(n) ? n : 0;
}

function _changes(record) {
    const list = Array.isArray(record?.amountChanges) ? record.amountChanges : [];
    return list
        .filter(c => c && typeof c.from === 'string' && Number.isFinite(Number(c.amount)))
        .map(c => ({ from: c.from, amount: Number(c.amount) }))
        .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

export function getAmountOn(record, isoDate) {
    let amount = _base(record);
    for (const c of _changes(record)) {
        if (c.from <= isoDate) amount = c.amount;
        else break;
    }
    return amount;
}

export function getCurrentAmount(record, todayIso) {
    return getAmountOn(record, todayIso);
}

export function sanitizeAmountChanges(raw, { min = 0, max = MAX_AMOUNT } = {}) {
    if (!Array.isArray(raw)) return [];
    const byDate = new Map();
    for (const c of raw) {
        if (!c || !_isIsoDate(c.from)) continue;
        if (c.amount === null || c.amount === '' || typeof c.amount === 'boolean') continue;
        const amount = Number(c.amount);
        if (!Number.isFinite(amount) || amount < min || amount > max) continue;
        byDate.set(c.from, amount);
    }
    const out = [...byDate.entries()]
        .map(([from, amount]) => ({ from, amount }))
        .sort((a, b) => (a.from < b.from ? -1 : 1));
    return out.slice(-MAX_CHANGES);
}

// The edit operation. `from === 'all'` (or a date on or before the record's
// first occurrence) corrects every occurrence: the base amount becomes
// `newAmount` and all changes, scheduled ones included, are removed. Otherwise
// the change for `from` is inserted or replaced, then any change that repeats
// the amount already in effect before it is dropped.
export function applyAmountChange(record, newAmount, from, firstOccurrenceIso) {
    const amount = Number(newAmount);
    if (from === 'all' || (firstOccurrenceIso && from <= firstOccurrenceIso)) {
        return { amount, amountChanges: [] };
    }
    const base = _base(record);
    const merged = _changes(record).filter(c => c.from !== from);
    merged.push({ from, amount });
    merged.sort((a, b) => (a.from < b.from ? -1 : 1));
    const amountChanges = [];
    let inEffect = base;
    for (const c of merged) {
        if (c.amount === inEffect) continue;
        amountChanges.push(c);
        inEffect = c.amount;
    }
    return { amount: base, amountChanges };
}

export function getAmountChangeSummary(record, todayIso) {
    const changes = _changes(record);
    const current = getAmountOn(record, todayIso);
    const past = changes.filter(c => c.from <= todayIso);
    const latestPast = past.length ? past[past.length - 1] : null;
    const previousUntil = latestPast ? _dayBefore(latestPast.from) : null;
    const previous = latestPast ? getAmountOn(record, previousUntil) : null;
    const upcoming = changes.find(c => c.from > todayIso) || null;
    return {
        current,
        previous,
        previousUntil,
        upcoming,
        changes: changes.slice().reverse().map(c => ({ from: c.from, amount: c.amount, isFuture: c.from > todayIso }))
    };
}
