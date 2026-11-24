// #689: Year in review. Pure core (its only import is the pure manualSplits.js): the period and data-floor
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

import { expandManualSplits } from './manualSplits.js';

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

// The earliest dated evidence of real data, or null: balances, snapshots,
// recorded transactions, reconciliations and Ledger overrides / Cleared marks.
// Plan inputs (an income's first payday, a template's start date, a bonus
// date) are deliberately not evidence: an old first payday would otherwise
// open years the app only projects into (review of #689).
export function dataFloorIso(data) {
    const dates = [];
    const take = (list, field) => { for (const r of (Array.isArray(list) ? list : [])) if (r && typeof r[field] === 'string') dates.push(r[field]); };
    take(data.balanceHistory, 'date');
    take(data.snapshots, 'date');
    take(data.manualTransactions, 'date');
    take(data.reconciliations, 'date');
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
    // A last point before the period's last month (e.g. the latest snapshot was
    // in June) names its month, so the sentence never implies "up to now".
    const until = last.monthKey < input.period.endIso.slice(0, 7);
    const base = delta >= 0 ? 'yearReview.i.netWorthUp' : 'yearReview.i.netWorthDown';
    const vars = { amount: { $: Math.abs(delta) }, since: { m: first.monthKey } };
    if (until) vars.until = { m: last.monthKey };
    return _insight('netWorthChange', 'actual', 100, until ? `${base}Until` : base, vars,
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

const OCCURRENCES_PER_YEAR = { weekly: 52, biweekly: 26, twice_monthly: 24, monthly: 12, quarterly: 4, yearly: 1 };

// The amount in effect the day before `iso`: the base amount, or the latest
// change dated before `iso` (#678's rule, inlined: this module imports only pure helpers).
function _amountBefore(record, iso) {
    let amount = Number(record.amount) || 0;
    const changes = (Array.isArray(record.amountChanges) ? record.amountChanges : [])
        .filter(c => c && typeof c.from === 'string')
        .sort((a, b) => a.from.localeCompare(b.from));
    for (const c of changes) { if (c.from < iso) amount = Number(c.amount) || 0; else break; }
    return amount;
}

export function amountChanges(input) {
    const found = [];
    const collect = (record, isPay) => {
        for (const c of (Array.isArray(record.amountChanges) ? record.amountChanges : [])) {
            if (!c || !_inPeriod(c.from, input.period)) continue;
            const from = _amountBefore(record, c.from);
            const to = Number(c.amount) || 0;
            const perYear = OCCURRENCES_PER_YEAR[record.frequency] || 12;
            found.push({ isPay, name: record.name || '', from, to, month: c.from.slice(0, 7), impact: Math.abs(to - from) * perYear });
        }
    };
    for (const inc of (input.incomes || [])) collect(inc, true);
    for (const t of (input.recurringTemplates || [])) {
        if (t.type === 'transfer') continue;
        collect(t, t.type === 'income' || t.type === 'reimbursement');
    }
    if (!found.length) return null;
    found.sort((a, b) => b.impact - a.impact);
    const out = found.slice(0, MAX_NAMED_CHANGES).map((f, i) => _insight('amountChanges', 'actual', 70 - i * 0.01,
        f.isPay ? 'yearReview.i.payChange' : 'yearReview.i.priceChange',
        { name: f.name, from: { $: f.from }, to: { $: f.to }, month: { m: f.month } }));
    if (found.length > MAX_NAMED_CHANGES) {
        out.push(_insight('changesMore', 'actual', 69, 'yearReview.i.changesMore',
            { count: found.length - MAX_NAMED_CHANGES }, { plural: true }));
    }
    return out;
}

export function actualsVsPlan(input) {
    let count = 0;
    let diff = 0;
    for (const [key, ov] of Object.entries(input.overrides || {})) {
        const date = key.split('|').pop();
        if (!_inPeriod(date, input.period)) continue;
        const amount = Number(ov?.amount);
        const original = ov?.originalAmount;
        if (original === null || original === undefined || !Number.isFinite(Number(original)) || !Number.isFinite(amount)) continue;
        if (amount === Number(original)) continue;
        count++;
        diff += Math.abs(amount) - Math.abs(Number(original));
    }
    if (count === 0) return null;
    diff = round2(diff);
    const key = diff > 0 ? 'yearReview.i.actualsMore' : diff < 0 ? 'yearReview.i.actualsLess' : 'yearReview.i.actualsEven';
    return _insight('actualsVsPlan', 'actual', 60, key, { count, amount: { $: Math.abs(diff) } }, { plural: true });
}

export function goalsReached(input) {
    const done = (input.sinkingFunds || []).filter(f => f && _inPeriod(f.completedDate, input.period))
        .sort((a, b) => a.completedDate.localeCompare(b.completedDate));
    if (!done.length) return null;
    return _insight('goalsReached', 'actual', 55, 'yearReview.i.goalsReached',
        { count: done.length, names: done.slice(0, MAX_NAMED_GOALS).map(f => f.name || '').join(', ') }, { plural: true });
}

// Only the count: a reconciliation's `difference` is statement minus the
// account's starting balance, which is not an adjustment in record-only mode.
export function reconciliations(input) {
    const count = (input.reconciliations || []).filter(r => r && _inPeriod(r.date, input.period)).length;
    if (!count) return null;
    return _insight('reconciliations', 'actual', 50, 'yearReview.i.reconciled', { count }, { plural: true });
}

// ─── From your plan (planned) ───────────────────────────────────────────────

// Classifies a Ledger transaction like computeReportsSummaryMetrics: own-account
// transfers are neither income nor outflow.
function _flow(tx) {
    if (!tx || tx.isTransferLeg || tx.type === 'transfer') return null;
    const amount = Number(tx.amount) || 0;
    switch (tx.type) {
        case 'income': case 'bonus': case 'interest':
            return { income: amount, outflow: 0 };
        case 'manual': case 'recurring':
            return amount >= 0 ? { income: amount, outflow: 0 } : { income: 0, outflow: -amount };
        case 'bill': case 'expense':
            return { income: 0, outflow: Math.abs(amount) };
        case 'debt': case 'savings':
            return { income: 0, outflow: Math.abs(amount) };
        default:
            return null;
    }
}

function _sum(monthsTx, pick) {
    let total = 0;
    for (const txs of (monthsTx || [])) for (const t of (txs || [])) total += pick(t) || 0;
    return total;
}

function _canCompare(input) {
    return !!input.floorIso && input.floorIso <= input.priorPeriod.startIso;
}

const _pct = (a, b) => Math.round(((a - b) / b) * 100);

function _subscriptions(t) {
    return t && t.type === 'recurring' && !t.isTransferLeg && Number(t.amount) < 0 ? -Number(t.amount) : 0;
}

function _incomeOf(t) {
    return _flow(t)?.income || 0;
}

// The Spending tab's categories (spendingCategoryForTx in spending.js),
// inlined so this module stays free of spending.js: debt payments and savings
// contributions are categories too, so both pages agree.
function _spendingCategory(t) {
    if (!t || t.isTransferLeg || t.type === 'transfer') return null;
    const amount = Number(t.amount) || 0;
    if (t.type === 'bill' || t.type === 'expense') return t.category || 'Other';
    if ((t.type === 'manual' || t.type === 'recurring') && amount < 0) return t.category || 'Other';
    if (t.type === 'debt') return 'Debt Payments';
    if (t.type === 'savings' && amount < 0) return 'Savings';
    return null;
}

function _byCategory(monthsTx) {
    const map = new Map();
    for (const txs of (monthsTx || [])) {
        for (const t of (txs || [])) {
            // #688: a split manual outflow counts toward each split's category.
            if (t && t.type === 'manual' && !t.isTransferLeg && Array.isArray(t.splits) && t.splits.length > 0) {
                if (!(Number(t.amount) < 0)) continue;
                for (const part of expandManualSplits(t)) {
                    map.set(part.category, (map.get(part.category) || 0) + Math.abs(part.amount));
                }
                continue;
            }
            const cat = _spendingCategory(t);
            if (!cat) continue;
            map.set(cat, (map.get(cat) || 0) + Math.abs(Number(t.amount) || 0));
        }
    }
    return map;
}

export function subscriptionsTotal(input) {
    const total = round2(_sum(input.monthsTx, _subscriptions));
    if (total <= 0) return null;
    const prior = _sum(input.priorMonthsTx, _subscriptions);
    if (_canCompare(input) && prior > 0 && Math.round(prior * 100) !== Math.round(total * 100)) {
        return _insight('subscriptionsTotal', 'planned', 40,
            total > prior ? 'yearReview.i.subscriptionsUp' : 'yearReview.i.subscriptionsDown',
            { amount: { $: total }, pct: { pct: Math.abs(_pct(total, prior)) } });
    }
    return _insight('subscriptionsTotal', 'planned', 40, 'yearReview.i.subscriptions', { amount: { $: total } });
}

export function topCategory(input) {
    const cats = [..._byCategory(input.monthsTx).entries()].sort((a, b) => b[1] - a[1]);
    const total = cats.reduce((s, [, v]) => s + v, 0);
    if (!cats.length || total <= 0) return null;
    return _insight('topCategory', 'planned', 35, 'yearReview.i.topCategory',
        { category: { cat: cats[0][0] }, pct: { pct: Math.round((cats[0][1] / total) * 100) } });
}

export function biggestCategoryChange(input) {
    if (!_canCompare(input)) return null;
    const cur = _byCategory(input.monthsTx);
    const prior = _byCategory(input.priorMonthsTx);
    let best = null;
    for (const [cat, amount] of cur) {
        const before = prior.get(cat) || 0;
        if (before <= 0) continue;
        const increase = amount - before;
        const pct = (increase / before) * 100;
        if (pct < CATEGORY_RISE_MIN_PCT || increase < CATEGORY_RISE_MIN_AMOUNT) continue;
        if (!best || increase > best.increase) best = { cat, increase, pct };
    }
    if (!best) return null;
    return _insight('biggestCategoryChange', 'planned', 30, 'yearReview.i.categoryRise',
        { category: { cat: best.cat }, amount: { $: round2(best.increase) }, pct: { pct: Math.round(best.pct) } });
}

export function bestAndWorstMonth(input) {
    const { period } = input;
    const months = period.isYtd ? period.months.slice(0, -1) : period.months;
    if (months.length < 2) return null;
    const nets = months.map((m, i) => ({
        m,
        net: round2(_sum([input.monthsTx[i]], t => { const f = _flow(t); return f ? f.income - f.outflow : 0; }))
    }));
    const best = nets.reduce((a, b) => (b.net > a.net ? b : a));
    const worst = nets.reduce((a, b) => (b.net < a.net ? b : a));
    if (best.net === worst.net) return null; // no activity, or every month alike
    const key = m => `${period.year}-${pad(m + 1)}`;
    return _insight('bestAndWorstMonth', 'planned', 25, 'yearReview.i.bestWorst',
        { best: { m: key(best.m) }, bestNet: { $: best.net }, worst: { m: key(worst.m) }, worstNet: { $: worst.net } });
}

export function debtShareOfIncome(input) {
    const income = _sum(input.monthsTx, _incomeOf);
    const debt = _sum(input.monthsTx, t => (t && t.type === 'debt' && !t.isTransferLeg ? Math.abs(Number(t.amount) || 0) : 0));
    if (income <= 0 || debt <= 0) return null;
    return _insight('debtShareOfIncome', 'planned', 20, 'yearReview.i.debtShare',
        { pct: { pct: Math.round((debt / income) * 100) } });
}

export function incomeChange(input) {
    const total = round2(_sum(input.monthsTx, _incomeOf));
    if (total <= 0) return null;
    const prior = _sum(input.priorMonthsTx, _incomeOf);
    if (_canCompare(input) && prior > 0 && Math.round(prior * 100) !== Math.round(total * 100)) {
        return _insight('incomeChange', 'planned', 15,
            total > prior ? 'yearReview.i.incomeUp' : 'yearReview.i.incomeDown',
            { amount: { $: total }, pct: { pct: Math.abs(_pct(total, prior)) } });
    }
    return _insight('incomeChange', 'planned', 15, 'yearReview.i.income', { amount: { $: total } });
}

// ─── Runner ─────────────────────────────────────────────────────────────────

export const RULES = [
    netWorthChange, debtPaidDown, debtCleared, interestEstimate,
    amountChanges, actualsVsPlan, goalsReached, reconciliations,
    subscriptionsTotal, topCategory, biggestCategoryChange, bestAndWorstMonth,
    debtShareOfIncome, incomeChange
];

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
