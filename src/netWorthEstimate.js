// Pure net-worth trend builder (issue #585, #574) — no DOM/app state access.
// Balance history records debts and the history-tracked accounts (Credit Card,
// Loan, Savings). A tracked account's entry is its signed balance: Credit Card
// and Loan balances are negative (they add nothing), Savings is a positive
// asset. So an estimated point is:
//   liabilities = each debt's last recorded balance on or before the month
//   assets      = `baselineAssets` (today's assets outside the history-tracked
//                 accounts, held flat) + each tracked account's last recorded
//                 positive balance. A tracked account with no entry yet that
//                 early is held flat at its FIRST entry's balance, so adopting
//                 tracking for an existing account (seeded today) does not drop
//                 it from earlier estimated months.
// A real snapshot always wins over an estimate for the same month. A month is
// only estimated once at least one owner has a usable entry on or before it.

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

export function monthKeyOf(date) {
    return String(date || '').slice(0, 7);
}

export function addMonths(monthKey, delta) {
    const [y, m] = monthKey.split('-').map(Number);
    const idx = y * 12 + (m - 1) + delta;
    return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

function round2(value) {
    return parseFloat(Number(value).toFixed(2));
}

function usableEntries(entries) {
    const out = [];
    for (const e of Array.isArray(entries) ? entries : []) {
        if (!e || typeof e !== 'object') continue;
        if (typeof e.date !== 'string' || !DATE_RE.test(e.date)) continue;
        if (e.balance === null || e.balance === undefined || e.balance === '') continue;
        const balance = Number(e.balance);
        if (!Number.isFinite(balance)) continue;
        const hasDebt = e.debtId !== null && e.debtId !== undefined;
        const hasAccount = e.accountId !== null && e.accountId !== undefined;
        if (hasDebt === hasAccount) continue;
        out.push({
            owner: hasDebt ? `d${e.debtId}` : `a${e.accountId}`,
            isDebt: hasDebt,
            date: e.date.slice(0, 10),
            id: Number(e.id) || 0,
            balance
        });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

// Estimated point for one month, or null when no usable entry exists on or
// before it. `entries` must already be the output of usableEntries.
function estimateMonth(entries, monthKey, baselineAssets) {
    const latest = new Map();
    const firstOfAccount = new Map();
    for (const e of entries) {
        if (!e.isDebt && !firstOfAccount.has(e.owner)) firstOfAccount.set(e.owner, e);
        if (monthKeyOf(e.date) > monthKey) continue; // sorted by date
        latest.set(e.owner, e);
    }
    if (latest.size === 0) return null;
    let assets = Math.max(0, Number(baselineAssets) || 0);
    let liabilities = 0;
    let contributes = false; // an account at or below zero adds nothing to estimate from
    for (const e of latest.values()) {
        if (e.isDebt) { liabilities += Math.max(0, e.balance); contributes = true; }
        else if (e.balance > 0) { assets += e.balance; contributes = true; }
    }
    for (const [owner, first] of firstOfAccount) {
        if (!latest.has(owner) && first.balance > 0) { assets += first.balance; contributes = true; }
    }
    if (!contributes) return null;
    return {
        totalAssets: round2(assets),
        totalLiabilities: round2(liabilities),
        netWorth: round2(assets - liabilities)
    };
}

// Estimated points keyed by month, for the given month keys (YYYY-MM).
export function estimateNetWorthByMonth(entries, monthKeys, baselineAssets) {
    const usable = usableEntries(entries);
    const result = new Map();
    for (const key of monthKeys) {
        const est = estimateMonth(usable, key, baselineAssets);
        if (est) result.set(key, est);
    }
    return result;
}

// Builds the Net Worth trend: real snapshots, estimates for months without
// one, and (only when no snapshot exists) a live point for the current month.
// Each point carries kind 'snapshot' | 'estimated' | 'live'.
//   snapshots: all snapshots (any order); horizon: max months shown
//   now: { year, month } (month 0-11); live: metrics object or null
export function buildNetWorthTrend({ snapshots, entries, baselineAssets, now, horizon, live }) {
    const currentKey = `${now.year}-${String(now.month + 1).padStart(2, '0')}`;
    const real = (Array.isArray(snapshots) ? snapshots : [])
        .filter(s => s && DATE_RE.test(String(s.date || '')) && Number.isFinite(s.netWorth))
        .sort((a, b) => a.date.localeCompare(b.date));
    const shown = real.slice(Math.max(0, real.length - horizon));
    const byMonth = new Map(shown.map(s => [monthKeyOf(s.date), s]));

    let startKey, endKey;
    if (shown.length > 0) {
        startKey = monthKeyOf(shown[0].date);
        endKey = monthKeyOf(shown[shown.length - 1].date);
    } else {
        startKey = endKey = currentKey;
    }
    // Months already covered, then extend backwards up to `horizon` points.
    const keys = [];
    for (let k = startKey; k <= endKey; k = addMonths(k, 1)) keys.push(k);
    let back = addMonths(startKey, -1);
    while (keys.length < horizon && back < startKey) {
        keys.unshift(back);
        back = addMonths(back, -1);
    }
    const estimates = estimateNetWorthByMonth(entries, keys.filter(k => !byMonth.has(k) && k <= currentKey), baselineAssets);

    const points = [];
    for (const key of keys) {
        const snap = byMonth.get(key);
        if (snap) {
            points.push({ ...snap, monthKey: key, kind: 'snapshot' });
        } else if (shown.length === 0 && key === currentKey && live) {
            points.push({ ...live, date: `${key}-01`, monthKey: key, kind: 'live' });
        } else if (estimates.has(key) && !(shown.length === 0 && key === currentKey)) {
            points.push({ ...estimates.get(key), date: `${key}-01`, monthKey: key, kind: 'estimated' });
        }
    }
    return points;
}
