// Pure month-end balance series for the Emergency Fund history chart (#307),
// built from balance-history entries (app.balanceHistory). No imports, no DOM.

// The trailing `count` months ending at `now`'s month, oldest first.
export function trailingMonths(now, count) {
    const out = [];
    for (let i = count - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        out.push({ year: d.getFullYear(), month: d.getMonth() });
    }
    return out;
}

function monthKey(year, month) {
    return `${year}-${String(month + 1).padStart(2, '0')}`;
}

// One dataset per account. A month's value is the account's last history entry
// dated on or before the end of that month (the last one when a month has
// several), carried forward; null for months before the account's first entry.
// `pointCount` is the largest number of non-null months in any dataset.
export function buildBalanceSeries({ months, accounts, entries }) {
    const all = (Array.isArray(entries) ? entries : []).filter(e =>
        e && typeof e.date === 'string' && /^\d{4}-\d{2}/.test(e.date)
        && e.accountId !== null && e.accountId !== undefined
        && e.balance !== null && e.balance !== undefined && Number.isFinite(Number(e.balance)));
    const datasets = (accounts || []).map(acct => {
        const own = all
            .filter(e => Number(e.accountId) === Number(acct.id))
            .sort((a, b) => a.date.localeCompare(b.date) || (Number(a.id) || 0) - (Number(b.id) || 0));
        const data = months.map(({ year, month }) => {
            const key = monthKey(year, month);
            let value = null;
            for (const e of own) {
                if (e.date.slice(0, 7) > key) break;
                value = Number(e.balance);
            }
            return value;
        });
        return { accountId: acct.id, name: acct.name, data };
    });
    const pointCount = datasets.reduce((m, ds) => Math.max(m, ds.data.filter(v => v !== null).length), 0);
    return { months, datasets, pointCount };
}
