// Category budget rollover (issue #687). Pure: no DOM, network or app state, so
// the browser and the server can both import it.
//
// A category budget with rollover carries each month's leftover (or overspend)
// into the next month, starting from `rolloverStart` ('YYYY-MM'):
//   'both'      carry' = carry + budget - actual   (unspent adds, overspend subtracts)
//   'overspend' carry' = min(0, carry + budget - actual)   (only overspend carries)

export const ROLLOVER_MODES = ['both', 'overspend'];
export const ROLLOVER_MAX_LOOKBACK_MONTHS = 120;

export function isValidRolloverMode(mode) {
    return mode === 'both' || mode === 'overspend';
}

// 'YYYY-MM' with a real month and a sane year.
export function isValidRolloverStart(value) {
    if (typeof value !== 'string') return false;
    const m = /^(\d{4})-(\d{2})$/.exec(value);
    if (!m) return false;
    const year = Number(m[1]);
    const month = Number(m[2]);
    return year >= 1900 && year <= 2200 && month >= 1 && month <= 12;
}

export function roundCents(n) {
    return (Math.round((Number(n) + Number.EPSILON) * 100) / 100) || 0;
}

function _num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

// rows: [{ budget, actual }] in chronological order. Returns the carry INTO each
// row (the first is always 0). Unknown mode: all zeros.
export function computeRolloverCarries(rows, mode) {
    const list = Array.isArray(rows) ? rows : [];
    const out = [];
    let carry = 0;
    for (const row of list) {
        out.push(carry);
        if (!isValidRolloverMode(mode)) continue;
        const next = carry + _num(row && row.budget) - _num(row && row.actual);
        carry = roundCents(mode === 'overspend' ? Math.min(0, next) : next);
    }
    return out;
}

// The carry out of the last row, i.e. into the month after the rows.
export function computeRolloverCarry(rows, mode) {
    const list = Array.isArray(rows) ? rows : [];
    if (!isValidRolloverMode(mode) || list.length === 0) return 0;
    const carries = computeRolloverCarries(list, mode);
    const last = list[list.length - 1];
    const next = carries[carries.length - 1] + _num(last && last.budget) - _num(last && last.actual);
    return roundCents(mode === 'overspend' ? Math.min(0, next) : next);
}

// The months [{ year, month }] (month 0-11) from `start` ('YYYY-MM') up to but
// excluding (year, month 0-11), capped to the most recent `cap` months. Empty
// when start is invalid or not before the target month.
export function rolloverMonthsBefore(start, year, month, cap = ROLLOVER_MAX_LOOKBACK_MONTHS) {
    if (!isValidRolloverStart(start)) return [];
    const startIndex = Number(start.slice(0, 4)) * 12 + (Number(start.slice(5, 7)) - 1);
    const endIndex = year * 12 + month;
    const first = Math.max(startIndex, endIndex - cap);
    const out = [];
    for (let i = first; i < endIndex; i++) {
        out.push({ year: Math.floor(i / 12), month: i % 12 });
    }
    return out;
}
