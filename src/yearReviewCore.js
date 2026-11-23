// #689: Year in review. Pure, import-free core: the period and data-floor
// helpers and one rule per insight. Each rule takes the prepared, plain input
// built by reportsYearReview.js and returns an Insight, an array of them, or
// null when it has nothing to say:
//
//   { id, kind: 'actual'|'planned', estimated, key, plural, vars, weight }
//
// `vars` values are raw and typed, formatted by the renderer: { $: n } is a
// currency amount, { m: 'YYYY-MM' } a month, { d: 'YYYY-MM-DD' } a date,
// { pct: n } a percent, { cat: 'Housing' } a stored category; plain strings and
// numbers are shown as they are. Dates are local YYYY-MM-DD strings.

export const CATEGORY_RISE_MIN_PCT = 10;
export const CATEGORY_RISE_MIN_AMOUNT = 100;
export const MAX_NAMED = 3;
export const MAX_NAMED_CHANGES = 2;
export const MAX_NAMED_GOALS = 2;
export const NET_WORTH_TREND_MONTHS = 240;

const pad = n => String(n).padStart(2, '0');
const round2 = n => Math.round(n * 100) / 100;

function _monthEndIso(year, month) {
    return `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`;
}

function _inPeriod(iso, period) {
    return typeof iso === 'string' && iso >= period.startIso && iso <= period.endIso;
}

function _insight(id, kind, weight, key, vars, extra = {}) {
    return { id, kind, estimated: false, plural: false, key, vars, weight, ...extra };
}

// ─── Period and data floor ──────────────────────────────────────────────────

export function buildPeriod(year, todayIso) {
    const thisYear = Number(todayIso.slice(0, 4));
    const y = Math.min(Number(year), thisYear);
    const isYtd = y === thisYear;
    const lastMonth = isYtd ? Number(todayIso.slice(5, 7)) - 1 : 11;
    return {
        year: y,
        startIso: `${y}-01-01`,
        endIso: isYtd ? todayIso : `${y}-12-31`,
        months: Array.from({ length: lastMonth + 1 }, (_, m) => m),
        isYtd
    };
}

export function priorPeriodOf(period) {
    const y = period.year - 1;
    let endIso = `${y}-12-31`;
    if (period.isYtd) {
        const m = Number(period.endIso.slice(5, 7));
        const d = Math.min(Number(period.endIso.slice(8, 10)), new Date(y, m, 0).getDate());
        endIso = `${y}-${pad(m)}-${pad(d)}`;
    }
    return { year: y, startIso: `${y}-01-01`, endIso, months: period.months.slice(), isYtd: false };
}

// The earliest dated evidence of real data, or null.
export function dataFloorIso(data) {
    const dates = [];
    const take = (list, field) => { for (const r of (Array.isArray(list) ? list : [])) if (r && typeof r[field] === 'string') dates.push(r[field]); };
    take(data.balanceHistory, 'date');
    take(data.snapshots, 'date');
    take(data.manualTransactions, 'date');
    take(data.reconciliations, 'date');
    take(data.incomes, 'firstPayDate');
    take(data.recurringTemplates, 'startDate');
    take(data.bonuses, 'date');
    for (const map of [data.overrides, data.cleared]) {
        for (const key of Object.keys(map || {})) dates.push(key.split('|').pop());
    }
    const valid = dates.filter(d => /^\d{4}-\d{2}-\d{2}/.test(d)).map(d => d.slice(0, 10)).sort();
    return valid.length ? valid[0] : null;
}

// ─── Balance-history helpers ────────────────────────────────────────────────

function _entriesByDebt(input) {
    const map = new Map();
    for (const e of (input.balanceHistory || [])) {
        if (!e || e.debtId === null || e.debtId === undefined || typeof e.date !== 'string') continue;
        if (e.balance === null || !Number.isFinite(Number(e.balance))) continue;
        if (!map.has(e.debtId)) map.set(e.debtId, []);
        map.get(e.debtId).push({ date: e.date, balance: Number(e.balance) });
    }
    for (const list of map.values()) list.sort((a, b) => a.date.localeCompare(b.date));
    return map;
}

function _lastOnOrBefore(entries, iso) {
    let found = null;
    for (const e of entries) { if (e.date <= iso) found = e; else break; }
    return found;
}

function _debtName(input, id) {
    return (input.debts || []).find(d => d.id === id)?.name || '';
}

// ─── What happened (actual) ─────────────────────────────────────────────────

export function netWorthChange(input) {
    const pts = (input.netWorthPoints || [])
        .filter(p => p && typeof p.monthKey === 'string' && Number.isFinite(p.netWorth)
            && p.monthKey >= input.period.startIso.slice(0, 7) && p.monthKey <= input.period.endIso.slice(0, 7))
        .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
    if (pts.length < 2) return null;
    const first = pts[0];
    const last = pts[pts.length - 1];
    const delta = round2(last.netWorth - first.netWorth);
    return _insight('netWorthChange', 'actual', 100,
        delta >= 0 ? 'yearReview.i.netWorthUp' : 'yearReview.i.netWorthDown',
        { amount: { $: Math.abs(delta) }, since: { m: first.monthKey } },
        { estimated: first.kind === 'estimated' || last.kind === 'estimated' });
}

export function debtPaidDown(input) {
    const { startIso, endIso } = input.period;
    let total = 0;
    let count = 0;
    for (const entries of _entriesByDebt(input).values()) {
        const end = _lastOnOrBefore(entries, endIso);
        if (!end) continue;
        const start = _lastOnOrBefore(entries, startIso) || entries.find(e => _inPeriod(e.date, input.period));
        if (!start) continue;
        const drop = start.balance - end.balance;
        if (drop > 0) { total += drop; count++; }
    }
    if (count === 0) return null;
    return _insight('debtPaidDown', 'actual', 90, 'yearReview.i.debtPaidDown',
        { count, amount: { $: round2(total) } }, { plural: true });
}

export function debtCleared(input) {
    const cleared = [];
    for (const [debtId, entries] of _entriesByDebt(input)) {
        for (let i = 1; i < entries.length; i++) {
            if (_inPeriod(entries[i].date, input.period) && entries[i].balance <= 0 && entries[i - 1].balance > 0) {
                cleared.push({ debtId, date: entries[i].date });
                break;
            }
        }
    }
    if (!cleared.length) return null;
    cleared.sort((a, b) => a.date.localeCompare(b.date));
    const out = cleared.slice(0, MAX_NAMED).map((c, i) => _insight('debtCleared', 'actual', 85 - i * 0.01,
        'yearReview.i.debtCleared', { name: _debtName(input, c.debtId), month: { m: c.date.slice(0, 7) } }));
    if (cleared.length > MAX_NAMED) {
        out.push(_insight('debtClearedMore', 'actual', 84, 'yearReview.i.debtClearedMore',
            { count: cleared.length - MAX_NAMED }, { plural: true }));
    }
    return out;
}

export function interestEstimate(input) {
    const { period } = input;
    let total = 0;
    let top = null;
    for (const [debtId, entries] of _entriesByDebt(input)) {
        const apr = Number((input.debts || []).find(d => d.id === debtId)?.interestRate) || 0;
        if (apr <= 0) continue;
        let debtTotal = 0;
        for (const m of period.months) {
            const monthEnd = _monthEndIso(period.year, m);
            const cutoff = monthEnd < period.endIso ? monthEnd : period.endIso;
            const e = _lastOnOrBefore(entries, cutoff);
            if (!e || e.balance <= 0) continue;
            const days = monthEnd <= period.endIso ? Number(monthEnd.slice(8)) : Number(period.endIso.slice(8, 10));
            debtTotal += e.balance * (Math.pow(1 + apr / 100 / 365, days) - 1);
        }
        total += debtTotal;
        if (debtTotal > 0 && (!top || debtTotal > top.amount)) top = { debtId, amount: debtTotal };
    }
    if (total < 0.01 || !top) return null;
    return _insight('interestEstimate', 'actual', 80, 'yearReview.i.interest',
        { amount: { $: round2(total) }, name: _debtName(input, top.debtId) }, { estimated: true });
}

// ─── Runner ─────────────────────────────────────────────────────────────────

export const RULES = [netWorthChange, debtPaidDown, debtCleared, interestEstimate];

export function computeYearInsights(input, rules = RULES) {
    const out = [];
    for (const rule of rules) {
        const result = rule(input);
        if (Array.isArray(result)) out.push(...result.filter(Boolean));
        else if (result) out.push(result);
    }
    const rank = k => (k === 'actual' ? 0 : 1);
    return out
        .map((ins, i) => ({ ins, i }))
        .sort((a, b) => rank(a.ins.kind) - rank(b.ins.kind) || b.ins.weight - a.ins.weight || a.i - b.i)
        .map(x => x.ins);
}
