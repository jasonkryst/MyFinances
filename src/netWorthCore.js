// Net-worth snapshot metrics (#579). Pure and DOM-free: the browser's
// captureNetWorthSnapshot() (reportsNetWorth.js) and the server's monthly
// snapshot job (server/src/jobs/netWorthSnapshot.js) both call these, so an
// automatic snapshot taken by the server has exactly the values the app
// would have stored for the same data on the same day.

import { isTransferLegTx } from './utils.js';
import { computeAccountBalance, getLedgerTransactionsForMonth } from './projectionCore.js';

export function computeSnapshotMetrics(app, snapshotDate = new Date()) {
    const year = snapshotDate.getFullYear();
    const month = snapshotDate.getMonth();

    let totalAssets = 0;
    for (const account of app.accounts || []) {
        const projected = computeAccountBalance(app, account.id, year, month);
        if (projected > 0) totalAssets += projected;
    }

    let totalLiabilities = 0;
    for (const debt of app.debts || []) {
        if (debt.debtType === 'fixedAmount') {
            totalLiabilities += Math.max(0, Number(debt.fixedAmount) || 0);
            continue;
        }
        totalLiabilities += Math.max(0, Number(debt.accountBalance) || 0);
    }

    const txs = getLedgerTransactionsForMonth(app, year, month);
    let debtPaymentMade = 0;
    let incomeReceived = 0;
    for (const tx of txs) {
        if (tx.type === 'debt') {
            debtPaymentMade += Math.abs(tx.amount || 0);
            continue;
        }
        if (isTransferLegTx(tx)) continue; // #566
        if (tx.type === 'income' || tx.type === 'bonus' || tx.type === 'interest' || (tx.type === 'recurring' && tx.amount > 0) || (tx.type === 'manual' && tx.amount > 0)) {
            incomeReceived += Math.abs(tx.amount || 0);
        }
    }

    return {
        totalAssets: parseFloat(totalAssets.toFixed(2)),
        totalLiabilities: parseFloat(totalLiabilities.toFixed(2)),
        netWorth: parseFloat((totalAssets - totalLiabilities).toFixed(2)),
        debtPaymentMade: parseFloat(debtPaymentMade.toFixed(2)),
        incomeReceived: parseFloat(incomeReceived.toFixed(2))
    };
}

// The snapshot record stored for `now`: metrics for now's (local) month, the
// date as the app has always written it (the ISO calendar date), and the source.
export function buildNetWorthSnapshot(app, now = new Date(), source = 'auto') {
    return {
        date: now.toISOString().slice(0, 10),
        ...computeSnapshotMetrics(app, now),
        source: source === 'manual' ? 'manual' : 'auto'
    };
}

// 'YYYY-MM' of a Date in local time.
export function snapshotMonthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// True when `snapshots` already holds one dated in `now`'s local month. The
// automatic captures (the app on load, the server job) skip such a month.
export function hasSnapshotInMonth(snapshots, now = new Date()) {
    const monthKey = snapshotMonthKey(now);
    return (Array.isArray(snapshots) ? snapshots : []).some(s => String(s?.date || '').slice(0, 7) === monthKey);
}
