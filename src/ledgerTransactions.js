// Ledger transaction aggregation: pure computation, no DOM.

import { getIncomePaydaysInMonth, dateToISO, parseFiniteOrNull } from './utils.js';
import { getRecurringOccurrencesInMonth } from './recurring.js';
import { getSetting, RECONCILIATION_ADJUSTS_BALANCE } from './settings.js';

function getOverrideAmount(app, txId) {
    if (!txId) return null;
    const map = app.ledgerAmountOverrides || {};
    const entry = map[txId];
    if (!entry) return null;
    return parseFiniteOrNull(entry.amount);
}

function getEffectiveAmount(app, tx) {
    const overrideAmount = getOverrideAmount(app, tx.transactionId);
    return overrideAmount !== null ? overrideAmount : tx.originalAmount;
}

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
        category: tx.category,
        sourceId: tx.sourceId,
        transactionId: tx.transactionId,
        isRollover: tx.type === 'rollover',
        meta: tx.meta || null,
        _seq: tx._seq
    };
}

export function makeLedgerTransactionId(tx) {
    const dateKey = dateToISO(new Date(tx.date));
    const account = String(tx.accountId ?? '');
    const type = String(tx.type ?? 'other');
    const source = String(tx.sourceId ?? 'none');
    return `${type}|${source}|${account}|${dateKey}`;
}

// Sentinel key for transactions that have no account linked.
// These appear in report-wide queries (accountId = null) but are excluded
// from the per-account ledger view and per-account balance calculations.
const UNLINKED_KEY = '__unlinked__';

export function buildProjectedAccountTransactions(app, startYear, startMonth, monthsToProject = 12) {
    const accountMap = {};
    for (const acct of app.accounts || []) {
        accountMap[acct.id] = { ...acct, txs: [] };
    }
    accountMap[UNLINKED_KEY] = { id: UNLINKED_KEY, name: null, txs: [] };

    // Running balances used to compute monthly interest deposits (#30).
    // Seeded from startingBalance and carried across the projected window so
    // interest compounds month over month.
    const interestBalances = {};
    for (const acct of app.accounts || []) {
        interestBalances[acct.id] = Number(acct.startingBalance) || 0;
    }

    function addTx({ accountId, date, name, amount, type, sourceId, category }) {
        const key = accountId && accountMap[accountId] ? accountId : UNLINKED_KEY;
        const txDate = new Date(date);
        const tx = {
            date: txDate,
            name,
            originalAmount: Number(amount),
            type,
            sourceId,
            category
        };
        tx.transactionId = makeLedgerTransactionId({
            accountId: key,
            date: txDate,
            type,
            sourceId
        });
        accountMap[key].txs.push(tx);
    }

    for (let m = 0; m < monthsToProject; m++) {
        const year = startYear + Math.floor((startMonth + m) / 12);
        const month = (startMonth + m) % 12;

        // Snapshot per-account tx counts so "this month's transactions" is
        // defined by generation pass, not by date — a bill with dueDay 31
        // generated for February date-overflows into March but still belongs
        // to February's balance.
        const monthStartTxCounts = {};
        for (const acctId in accountMap) {
            monthStartTxCounts[acctId] = accountMap[acctId].txs.length;
        }

        for (const inc of app.incomes || []) {
            if (!inc.amount) continue;
            const paydays = getIncomePaydaysInMonth(inc, year, month);
            for (const payDate of paydays) {
                addTx({
                    accountId: inc.accountId,
                    date: payDate,
                    name: inc.name || 'Income',
                    amount: Number(inc.amount),
                    type: 'income',
                    sourceId: inc.id,
                    category: inc.category || 'Income'
                });
            }
        }

        for (const bonus of app.bonuses || []) {
            if (bonus.date && bonus.amount) {
                const bonusDate = new Date(String(bonus.date).includes('T') ? bonus.date : bonus.date + 'T00:00:00');
                if (bonusDate.getFullYear() === year && bonusDate.getMonth() === month) {
                    addTx({
                        accountId: bonus.accountId,
                        date: bonusDate,
                        name: bonus.name || 'Bonus',
                        amount: Number(bonus.amount),
                        type: 'bonus',
                        sourceId: bonus.id,
                        category: bonus.category || 'Bonus'
                    });
                }
            }
        }

        for (const debt of app.debts || []) {
            if (debt.dueDate && debt.minimumPayment) {
                const due = new Date(year, month, debt.dueDate);
                addTx({
                    accountId: debt.accountId,
                    date: due,
                    name: debt.name || 'Debt Payment',
                    amount: -Math.abs(Number(debt.minimumPayment)),
                    type: 'debt',
                    sourceId: debt.id,
                    category: debt.name || 'Debt'
                });
            }
        }

        for (const bill of app.bills || []) {
            if (bill.dueDay && bill.amount) {
                const due = new Date(year, month, bill.dueDay);
                addTx({
                    accountId: bill.accountId,
                    date: due,
                    name: bill.name || 'Bill',
                    amount: -Math.abs(Number(bill.amount)),
                    type: 'bill',
                    sourceId: bill.id,
                    category: bill.category || 'Other'
                });
            }
        }

        for (const exp of app.expenses || []) {
            if (exp.budgetAmount && exp.date) {
                const expDate = new Date(String(exp.date).includes('T') ? exp.date : exp.date + 'T00:00:00');
                if (expDate.getFullYear() === year && expDate.getMonth() === month) {
                    addTx({
                        accountId: exp.accountId,
                        date: expDate,
                        name: exp.name || 'Expense',
                        amount: -Math.abs(Number(exp.budgetAmount)),
                        type: 'expense',
                        sourceId: exp.id,
                        category: exp.category || 'Other'
                    });
                }
            }
        }

        for (const tmpl of app.recurringTemplates || []) {
            const occurrences = getRecurringOccurrencesInMonth(tmpl, year, month);
            for (const occDate of occurrences) {
                if (tmpl.type === 'reimbursement') {
                    addTx({
                        accountId: tmpl.accountId,
                        date: occDate,
                        name: tmpl.name || 'Recurring',
                        amount: Math.abs(Number(tmpl.amount)),
                        type: 'recurring',
                        sourceId: tmpl.id,
                        category: tmpl.category || 'Reimbursement'
                    });
                } else if (tmpl.type === 'transfer' && tmpl.targetAccountId) {
                    addTx({
                        accountId: tmpl.accountId,
                        date: occDate,
                        name: tmpl.name || 'Transfer (out)',
                        amount: -Math.abs(Number(tmpl.amount)),
                        type: 'recurring',
                        sourceId: tmpl.id,
                        category: tmpl.category || 'Transfer'
                    });
                    addTx({
                        accountId: tmpl.targetAccountId,
                        date: occDate,
                        name: tmpl.name || 'Transfer (in)',
                        amount: Math.abs(Number(tmpl.amount)),
                        type: 'recurring',
                        sourceId: tmpl.id,
                        category: tmpl.category || 'Transfer'
                    });
                } else {
                    addTx({
                        accountId: tmpl.accountId,
                        date: occDate,
                        name: tmpl.name || 'Recurring',
                        amount: -Math.abs(Number(tmpl.amount)),
                        type: 'recurring',
                        sourceId: tmpl.id,
                        category: tmpl.category || 'Subscription'
                    });
                }
            }
        }

        // Add auto-contributing savings to ledger
        for (const fund of app.emergencyFunds || []) {
            if (fund.autoContribute && fund.monthlyContribution > 0 && fund.currentAmount < fund.targetAmount) {
                const savingDate = new Date(year, month, 1); // First day of month
                addTx({
                    accountId: fund.accountId,
                    date: savingDate,
                    name: 'Emergency Fund Contribution',
                    amount: -Math.abs(Number(fund.monthlyContribution)),
                    type: 'savings',
                    sourceId: fund.id,
                    category: 'Savings'
                });
            }
        }

        for (const fund of app.sinkingFunds || []) {
            if (fund.autoContribute && fund.monthlyAllocation > 0 && fund.currentAmount < fund.targetAmount) {
                const savingDate = new Date(year, month, 1); // First day of month
                addTx({
                    accountId: fund.accountId,
                    date: savingDate,
                    name: fund.name || 'Sinking Fund',
                    amount: -Math.abs(Number(fund.monthlyAllocation)),
                    type: 'savings',
                    sourceId: fund.id,
                    category: 'Savings'
                });
            }
        }

        // Monthly interest deposits (#30): APY/12 on the projected
        // end-of-month balance, posted on the last day of the month.
        // Override-aware in both directions — the base balance uses effective
        // amounts, and an overridden interest amount feeds later months.
        for (const acct of app.accounts || []) {
            const monthTxs = accountMap[acct.id].txs.slice(monthStartTxCounts[acct.id]);
            let balance = interestBalances[acct.id];
            for (const tx of monthTxs) {
                balance += getEffectiveAmount(app, tx);
            }
            const rate = Number(acct.interestRate) || 0;
            if (rate > 0 && balance > 0) {
                const interest = Math.round(balance * (rate / 100 / 12) * 100) / 100;
                if (interest > 0) {
                    addTx({
                        accountId: acct.id,
                        date: new Date(year, month + 1, 0),
                        name: 'Interest',
                        amount: interest,
                        type: 'interest',
                        sourceId: acct.id,
                        category: 'Interest'
                    });
                    const txList = accountMap[acct.id].txs;
                    balance += getEffectiveAmount(app, txList[txList.length - 1]);
                }
            }
            interestBalances[acct.id] = balance;
        }
    }

    // Reconciliation entries are recorded against real calendar dates rather
    // than generated per projected month, so they're folded in separately
    // here and only kept if their date falls inside the projected window.
    const windowMonths = new Set();
    for (let m = 0; m < monthsToProject; m++) {
        const y = startYear + Math.floor((startMonth + m) / 12);
        const mo = (startMonth + m) % 12;
        windowMonths.add(`${y}-${mo}`);
    }
    for (const recon of app.reconciliations || []) {
        if (!recon.accountId || !accountMap[recon.accountId]) continue;
        const reconDate = new Date(`${recon.date}T00:00:00`);
        if (!windowMonths.has(`${reconDate.getFullYear()}-${reconDate.getMonth()}`)) continue;
        accountMap[recon.accountId].txs.push({
            date: reconDate,
            name: 'Balance Reconciliation',
            originalAmount: 0,
            type: 'reconciliation',
            sourceId: recon.id,
            category: 'Reconciliation',
            transactionId: null,
            meta: {
                previousBalance: recon.previousBalance,
                statementBalance: recon.statementBalance,
                difference: recon.difference,
                note: recon.note
            }
        });
    }

    for (const acctId in accountMap) {
        accountMap[acctId].txs.sort((a, b) => a.date - b.date);
    }

    return accountMap;
}

export function getLedgerTransactionsForMonth(app, year, month, accountId = null) {
    const accountMap = buildProjectedAccountTransactions(app, year, month, 1);
    const out = [];
    for (const acctId in accountMap) {
        // When filtering by a specific account, skip the unlinked sentinel
        // (it never matches a numeric id anyway, but be explicit)
        if (acctId === UNLINKED_KEY && accountId !== null) continue;
        if (accountId !== null && String(acctId) !== String(accountId)) continue;
        const acct = accountMap[acctId];
        for (const tx of acct.txs) {
            const amount = getEffectiveAmount(app, tx);
            out.push({
                date: tx.date.toISOString(),
                account: acct.name,
                accountId: acctId === UNLINKED_KEY ? null : acctId,
                name: tx.name,
                amount,
                originalAmount: tx.originalAmount,
                hasOverride: amount !== tx.originalAmount,
                overrideAmount: amount !== tx.originalAmount ? amount : null,
                type: tx.type,
                category: tx.category,
                sourceId: tx.sourceId,
                transactionId: tx.transactionId
            });
        }
    }
    out.sort((a, b) => new Date(a.date) - new Date(b.date));
    return out;
}

// Project a single account's balance forward `monthsAhead` months from the
// current calendar month. Index 0 is "Now" (the account's starting balance);
// indices 1..monthsAhead are consecutive future months with a cumulative
// running balance.
export function getAccountForecastSeries(app, accountId, monthsAhead) {
    const account = (app.accounts || []).find(a => a.id === accountId);
    const startingBalance = account ? (account.startingBalance || 0) : 0;

    const series = [{
        label: 'Now',
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

        const label = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

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
    const accountMap = buildProjectedAccountTransactions(app, today.getFullYear(), today.getMonth(), 12);
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
                    name: 'Balance Rollover',
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
    const selectedDateRange = app._ledgerDateRange || '30';

    if (selectedAccount !== 'all') {
        transactions = transactions.filter(tx => String(tx.accountId) === String(selectedAccount));
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (selectedDateRange !== 'all') {
        transactions = transactions.filter(tx => {
            const txDate = new Date(tx.date);
            const txDateOnly = new Date(txDate.getFullYear(), txDate.getMonth(), txDate.getDate());
            if (selectedDateRange === 'past') {
                return txDateOnly <= todayStart;
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
