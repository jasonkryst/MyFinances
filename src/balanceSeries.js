// Pure month-end balance series for the Emergency Fund history chart (#307).
// No imports: the caller passes the balance function, so this is DOM-free and
// unit testable.

// The trailing `count` months ending at `now`'s month, oldest first.
export function trailingMonths(now, count) {
    const out = [];
    for (let i = count - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        out.push({ year: d.getFullYear(), month: d.getMonth() });
    }
    return out;
}

// One dataset per account. A month is a real data point only when the account
// had activity (its balance differs from its starting balance) or it is the
// current month; other months are null so a brand-new account does not draw a
// misleading flat line. `pointCount` is the largest number of real points in
// any dataset.
export function buildBalanceSeries({ months, accounts, balanceFn, now }) {
    const curY = now.getFullYear();
    const curM = now.getMonth();
    const datasets = (accounts || []).map(acct => {
        const start = Number(acct.startingBalance) || 0;
        const data = months.map(({ year, month }) => {
            const bal = balanceFn(acct.id, year, month);
            const isCurrent = year === curY && month === curM;
            return isCurrent || bal !== start ? bal : null;
        });
        return { accountId: acct.id, name: acct.name, data };
    });
    const pointCount = datasets.reduce((m, ds) => Math.max(m, ds.data.filter(v => v !== null).length), 0);
    return { months, datasets, pointCount };
}
