// Ledger transaction aggregation: pure computation, no DOM.

import { formatMonthYear } from './utils.js';
import { t, categoryLabel } from './i18n.js';
import { matchesLedgerSearch, buildLedgerMemoLookup, normalizeLedgerSearchTerm } from './ledgerSearch.js';
import { getSetting, RECONCILIATION_ADJUSTS_BALANCE } from './settings.js';
import { getOverrideAmount, getEffectiveAmount, isCleared, getClearedAt } from './ledgerStateCore.js';
import {
    UNLINKED_KEY, makeLedgerTransactionId, getProjectionBuildCount,
    buildProjectedAccountTransactions, getLedgerTransactionsForMonth
} from './projectionCore.js';

export function toLedgerTxOutput(app, tx) {
    const overrideAmount = getOverrideAmount(app, tx.transactionId);
    const amount = overrideAmount !== null ? overrideAmount : tx.originalAmount;
    return {
        date: tx.date.toISOString(),
        account: tx.account,
        accountId: tx.accountId,
        name: tx.name,
        amount,
        originalAmount: tx.originalAmount,
        hasOverride: overrideAmount !== null,
        overrideAmount,
        balance: tx.balance,
        type: tx.type,
        isTransferLeg: tx.isTransferLeg === true,
        counterpartAccountId: tx.counterpartAccountId ?? null,
        category: tx.category,
        sourceId: tx.sourceId,
        transactionId: tx.transactionId,
        isRollover: tx.type === 'rollover',
        cleared: isCleared(app, tx.transactionId),
        clearedAt: getClearedAt(app, tx.transactionId),
        meta: tx.meta || null,
        _seq: tx._seq
    };
}

// The projection builder lives in projectionCore.js (pure, shared with the
// server, #579); re-exported so existing imports keep working.
export { makeLedgerTransactionId, getProjectionBuildCount, buildProjectedAccountTransactions, getLedgerTransactionsForMonth };

// Project a single account's balance forward `monthsAhead` months from the
// current calendar month. Index 0 is "Now" (the account's starting balance);
// indices 1..monthsAhead are consecutive future months with a cumulative
// running balance.
export function getAccountForecastSeries(app, accountId, monthsAhead) {
    const account = (app.accounts || []).find(a => a.id === accountId);
    const startingBalance = account ? (account.startingBalance || 0) : 0;

    const series = [{
        label: t('reports.fcNow'),
        income: 0,
        outflow: 0,
        net: 0,
        balance: Math.round(startingBalance * 100) / 100
    }];

    const now = new Date();
    let balance = startingBalance;

    // Build the whole horizon in a single pass and bucket transactions by
    // month. A per-month rebuild (getLedgerTransactionsForMonth in a loop)
    // re-seeds each month's interest from the static startingBalance, so
    // interest would show flat instead of compounding — this keeps the
    // Forecast tab consistent with the Ledger page (#30).
    const startTotalMonths = now.getMonth() + 1;
    const startYear = now.getFullYear() + Math.floor(startTotalMonths / 12);
    const startMonth = startTotalMonths % 12;
    const horizonMap = buildProjectedAccountTransactions(app, startYear, startMonth, monthsAhead);
    const horizonAcct = horizonMap[accountId];
    const horizonTxs = horizonAcct ? horizonAcct.txs : [];

    for (let i = 1; i <= monthsAhead; i++) {
        const totalMonths = now.getMonth() + i;
        const year = now.getFullYear() + Math.floor(totalMonths / 12);
        const month = totalMonths % 12;

        const txs = horizonTxs
            .filter(tx => tx.date.getFullYear() === year && tx.date.getMonth() === month)
            .map(tx => ({ date: tx.date, amount: getEffectiveAmount(app, tx) }));
        let income = 0;
        let outflow = 0;
        for (const tx of txs) {
            if (tx.amount >= 0) income += tx.amount;
            else outflow += Math.abs(tx.amount);
        }
        const net = income - outflow;

        // Walk the month's transactions in order to find the lowest the
        // running balance dips to during the month, which can be below both
        // the prior month's ending balance and this month's ending balance.
        let running = balance;
        let lowBalance = running;
        let lowDate = null;
        for (const tx of txs) {
            running += tx.amount;
            if (running < lowBalance - 1e-9) {
                lowBalance = running;
                lowDate = new Date(tx.date);
            }
        }

        balance += net;

        const label = formatMonthYear(new Date(year, month, 1));

        series.push({
            year,
            month,
            label,
            income: Math.round(income * 100) / 100,
            outflow: Math.round(outflow * 100) / 100,
            net: Math.round(net * 100) / 100,
            balance: Math.round(balance * 100) / 100,
            lowBalance: Math.round(lowBalance * 100) / 100,
            lowDate
        });
    }

    return series;
}

// Gather all transactions for the ledger
export function getLedgerTransactions(app) {
    const today = new Date();
    // Start one month back so the ±7-day filter works at month boundaries
    // (e.g. Oct 4: "5 days ago" = Sep 29 would otherwise be outside the window).
    const prevMonth = today.getMonth() === 0 ? 11 : today.getMonth() - 1;
    const prevYear  = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
    const accountMap = buildProjectedAccountTransactions(app, prevYear, prevMonth, 13);
    const allTxs = [];
    const adjustsBalance = getSetting(app, RECONCILIATION_ADJUSTS_BALANCE, false);

    // Monotonic counter reflecting the true order each row's running balance
    // was computed in (per account, oldest to newest). Same-date rows (e.g. a
    // "Balance Rollover" and the transaction that triggered it) can't be
    // ordered by date alone, so the display sort breaks ties using this —
    // never by a fixed type-priority — so the tie-break stays correct
    // whether the ledger is sorted ascending or descending (#46).
    let seq = 0;

    for (const acctId in accountMap) {
        if (acctId === UNLINKED_KEY) continue;
        const acct = accountMap[acctId];
        let lastMonth = null;
        let running = Number(acct.startingBalance) || 0;

        for (let i = 0; i < acct.txs.length; i++) {
            const tx = acct.txs[i];
            const txMonth = `${tx.date.getFullYear()}-${tx.date.getMonth() + 1}`;
            if (lastMonth && txMonth !== lastMonth) {
                allTxs.push({
                    date: new Date(tx.date.getFullYear(), tx.date.getMonth(), 1),
                    account: acct.name,
                    accountId: acctId,
                    name: t('ledger.txRollover'),
                    originalAmount: 0,
                    balance: running,
                    type: 'rollover',
                    category: 'Balance',
                    sourceId: null,
                    transactionId: null,
                    _seq: seq++
                });
            }

            // When the "reconciliation adjusts balance" setting is on, treat the
            // reconciliation row as a hard reset point: snap running to the
            // statement balance rather than adding its (always-zero) originalAmount.
            // This ensures the balance column at the reconciliation row shows the
            // authoritative statement balance, and all subsequent rows project from it.
            let amount;
            if (tx.type === 'reconciliation' && tx.meta && adjustsBalance) {
                amount = tx.meta.statementBalance - running;
            } else {
                amount = getEffectiveAmount(app, tx);
            }
            running += amount;
            tx.balance = running;

            allTxs.push({
                date: tx.date,
                account: acct.name,
                accountId: acctId,
                name: tx.name,
                originalAmount: tx.originalAmount,
                balance: tx.balance,
                type: tx.type,
                isTransferLeg: tx.isTransferLeg === true,
        counterpartAccountId: tx.counterpartAccountId ?? null,
                category: tx.category,
                sourceId: tx.sourceId,
                transactionId: tx.transactionId,
                meta: tx.meta || null,
                _seq: seq++
            });
            lastMonth = txMonth;
        }
    }

    // Sort newest-first. For same-millisecond timestamps, break ties by
    // _seq (descending) rather than a fixed type-priority: whichever row's
    // balance was computed later in the true running-balance chain is the
    // "newer" one and belongs on top, regardless of whether it's a real
    // transaction or a synthetic rollover/reconciliation row (#46).
    allTxs.sort((a, b) => {
        const dateDiff = b.date - a.date;
        if (dateDiff !== 0) return dateDiff;
        return b._seq - a._seq;
    });
    return allTxs.map(tx => toLedgerTxOutput(app, tx));
}

// Filter (account + date-range) and sort the ledger transaction list, reading
// the same app._ledgerAccountFilter / app._ledgerDateRange / app._ledgerSortKey /
// app._ledgerSortDir state renderLedgerPage uses. No pagination is applied here;
// callers slice the page window themselves.
export function getFilteredSortedLedgerTransactions(app) {
    let transactions = getLedgerTransactions(app);
    const selectedAccount = app._ledgerAccountFilter || 'all';
    const selectedDateRange = app._ledgerDateRange || 'around7';

    if (selectedAccount !== 'all') {
        transactions = transactions.filter(tx => String(tx.accountId) === String(selectedAccount));
    }

    const selectedCategory = app._ledgerCategoryFilter || 'all';
    if (selectedCategory !== 'all') {
        transactions = transactions.filter(tx => (tx.category || 'Other') === selectedCategory);
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (selectedDateRange !== 'all') {
        transactions = transactions.filter(tx => {
            const txDate = new Date(tx.date);
            const txDateOnly = new Date(txDate.getFullYear(), txDate.getMonth(), txDate.getDate());
            if (selectedDateRange === 'past') {
                return txDateOnly <= todayStart;
            } else if (selectedDateRange === 'around7') {
                const sevenDaysBefore = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
                const sevenDaysAfter = new Date(todayStart.getTime() + 7 * 24 * 60 * 60 * 1000);
                return txDateOnly >= sevenDaysBefore && txDateOnly <= sevenDaysAfter;
            } else if (selectedDateRange === '30' || selectedDateRange === '60' || selectedDateRange === '90') {
                const days = parseInt(selectedDateRange, 10);
                const futureLimit = new Date(todayStart.getTime() + days * 24 * 60 * 60 * 1000);
                return txDateOnly >= todayStart && txDateOnly < futureLimit;
            } else if (selectedDateRange === 'month') {
                const y = now.getFullYear();
                const m = now.getMonth();
                const endOfNextMonth = new Date(y, m + 2, 0, 23, 59, 59, 999);
                return txDateOnly >= todayStart && txDateOnly <= endOfNextMonth;
            }
            return true;
        });
    }

    // #586: free-text search (session-only view state, never persisted).
    if (normalizeLedgerSearchTerm(app._ledgerSearch)) {
        const memoLookup = buildLedgerMemoLookup(app);
        transactions = transactions.filter(tx => matchesLedgerSearch(tx, app._ledgerSearch, memoLookup, categoryLabel));
    }

    const clearedFilter = app._ledgerClearedFilter || 'all';
    if (clearedFilter !== 'all') {
        transactions = transactions.filter(tx =>
            clearedFilter === 'uncleared' ? !tx.cleared : tx.cleared
        );
    }

    const sortKey = app._ledgerSortKey || 'date';
    const sortDir = app._ledgerSortDir || 'desc';
    transactions.sort((a, b) => {
        let vA = a[sortKey], vB = b[sortKey];
        if (sortKey === 'amount' || sortKey === 'balance') {
            vA = Number(vA); vB = Number(vB);
        } else if (sortKey === 'date') {
            vA = new Date(vA); vB = new Date(vB);
        } else {
            vA = (vA || '').toString().toLowerCase();
            vB = (vB || '').toString().toLowerCase();
        }
        if (vA < vB) return sortDir === 'asc' ? -1 : 1;
        if (vA > vB) return sortDir === 'asc' ? 1 : -1;
        // Same-date rows (e.g. a "Balance Rollover" and the transaction that
        // triggered it) can't be ordered by date alone. Break the tie by
        // _seq — the true order their running balance was computed in — and
        // flip it along with sortDir, same as the date comparison above.
        // Leaving ties unresolved here let the running-balance column go
        // inconsistent whenever the ledger was sorted ascending (#46),
        // because it silently fell back to whatever order the rows already
        // arrived in from getLedgerTransactions (always its own fixed
        // descending convention) instead of respecting the requested sortDir.
        if (sortKey === 'date' && typeof a._seq === 'number' && typeof b._seq === 'number' && a._seq !== b._seq) {
            return sortDir === 'asc' ? a._seq - b._seq : b._seq - a._seq;
        }
        return 0;
    });

    return transactions;
}
