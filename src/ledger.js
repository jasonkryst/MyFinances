// Ledger logic: rendering, transaction gathering

import { getIncomePaydaysInMonth, formatCurrency, escapeHtml } from './utils.js';
import { getRecurringOccurrencesInMonth } from './recurring.js';
import { getSetting, setSetting, RECONCILIATION_ADJUSTS_BALANCE } from './settings.js';

function getDateKey(date) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function parseFiniteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function getOverrideAmount(app, txId) {
    if (!txId) return null;
    const map = app.ledgerAmountOverrides || {};
    const entry = map[txId];
    if (!entry) return null;
    return parseFiniteNumber(entry.amount);
}

function getEffectiveAmount(app, tx) {
    const overrideAmount = getOverrideAmount(app, tx.transactionId);
    return overrideAmount !== null ? overrideAmount : tx.originalAmount;
}

function toLedgerTxOutput(app, tx) {
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
    const dateKey = getDateKey(tx.date);
    const account = String(tx.accountId ?? '');
    const type = String(tx.type ?? 'other');
    const source = String(tx.sourceId ?? 'none');
    return `${type}|${source}|${account}|${dateKey}`;
}

// Sentinel key for transactions that have no account linked.
// These appear in report-wide queries (accountId = null) but are excluded
// from the per-account ledger view and per-account balance calculations.
const UNLINKED_KEY = '__unlinked__';

function buildProjectedAccountTransactions(app, startYear, startMonth, monthsToProject = 12) {
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

export function setLedgerAmountOverride(app, transactionId, amount, metadata = {}) {
    if (!transactionId) return;
    const parsed = parseFiniteNumber(amount);
    if (parsed === null) return;
    if (!app.ledgerAmountOverrides) app.ledgerAmountOverrides = {};

    app.ledgerAmountOverrides[transactionId] = {
        amount: parsed,
        originalAmount: parseFiniteNumber(metadata.originalAmount),
        transactionName: metadata.transactionName || null,
        accountId: metadata.accountId || null,
        date: metadata.date || null,
        updatedAt: new Date().toISOString()
    };
}

export function clearLedgerAmountOverride(app, transactionId) {
    if (!transactionId || !app.ledgerAmountOverrides) return;
    delete app.ledgerAmountOverrides[transactionId];
}

function openLedgerOverrideModal(app, tx) {
    const modal = document.getElementById('ledgerOverrideModal');
    if (!modal || !tx || tx.isRollover || !tx.transactionId) return;

    const nameEl = document.getElementById('ledgerOverrideTxName');
    const accountEl = document.getElementById('ledgerOverrideAccount');
    const dateEl = document.getElementById('ledgerOverrideDate');
    const originalEl = document.getElementById('ledgerOverrideOriginal');
    const input = document.getElementById('ledgerOverrideAmountInput');
    const confirmBtn = document.getElementById('ledgerOverrideConfirmBtn');
    const cancelBtn = document.getElementById('ledgerOverrideCancelBtn');
    const closeBtn = document.getElementById('ledgerOverrideCloseBtn');

    if (!nameEl || !accountEl || !dateEl || !originalEl || !input || !confirmBtn || !cancelBtn || !closeBtn) {
        return;
    }

    nameEl.textContent = tx.name || '';
    accountEl.textContent = tx.account || '';
    dateEl.textContent = tx.date ? _formatLedgerDate(tx.date) : '';
    originalEl.textContent = formatCurrency(tx.originalAmount);
    input.value = Number(tx.amount || 0).toFixed(2);

    const close = () => {
        modal.classList.add('hidden'); modal.classList.remove('flex-visible');
        modal.onkeydown = null;
    };

    confirmBtn.onclick = () => {
        const parsed = parseFiniteNumber(input.value);
        if (parsed === null) {
            alert('Please enter a valid number.');
            return;
        }
        setLedgerAmountOverride(app, tx.transactionId, parsed, {
            originalAmount: tx.originalAmount,
            transactionName: tx.name,
            accountId: tx.accountId,
            date: tx.date
        });
        app.saveToStorage();
        close();
        renderLedgerPage(app);
        if (typeof app.renderReportsPage === 'function') app.renderReportsPage();
        if (typeof app.renderAccountsList === 'function') app.renderAccountsList();
    };

    cancelBtn.onclick = close;
    closeBtn.onclick = close;
    modal.onclick = (event) => {
        if (event.target === modal) close();
    };
    modal.onkeydown = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            confirmBtn.click();
        }
    };

    modal.classList.add('flex-visible'); modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 30);
}

const LEDGER_EXPORT_COLUMN_KEYS = ['date', 'account', 'name', 'amount', 'category', 'balance', 'type'];

function openLedgerExportModal(app) {
    const modal = document.getElementById('ledgerExportModal');
    const confirmBtn = document.getElementById('ledgerExportConfirmBtn');
    const cancelBtn = document.getElementById('ledgerExportCancelBtn');
    const closeBtn = document.getElementById('ledgerExportCloseBtn');
    const warning = document.getElementById('ledgerExportEmptyWarning');
    if (!modal || !confirmBtn || !cancelBtn || !closeBtn || !warning) return;

    const savedColumns = (getSetting(app, 'ledgerExportColumns', LEDGER_EXPORT_COLUMN_KEYS.join(',')) || '')
        .split(',')
        .filter(c => LEDGER_EXPORT_COLUMN_KEYS.includes(c));
    const activeColumns = savedColumns.length > 0 ? savedColumns : LEDGER_EXPORT_COLUMN_KEYS;
    for (const key of LEDGER_EXPORT_COLUMN_KEYS) {
        const checkbox = document.getElementById(`ledgerExportCol-${key}`);
        if (checkbox) checkbox.checked = activeColumns.includes(key);
    }

    const hasRows = getFilteredSortedLedgerTransactions(app).length > 0;
    warning.hidden = hasRows;
    confirmBtn.disabled = !hasRows;

    const close = () => {
        modal.classList.add('hidden'); modal.classList.remove('flex-visible');
        modal.onkeydown = null;
    };

    confirmBtn.onclick = () => {
        const columns = LEDGER_EXPORT_COLUMN_KEYS.filter(key => document.getElementById(`ledgerExportCol-${key}`)?.checked);
        if (columns.length === 0) return;
        setSetting(app, 'ledgerExportColumns', columns.join(','));
        app.exportLedgerToCSV(columns);
        close();
    };
    cancelBtn.onclick = close;
    closeBtn.onclick = close;
    modal.onclick = (event) => { if (event.target === modal) close(); };
    modal.onkeydown = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
        }
    };

    modal.classList.add('flex-visible'); modal.classList.remove('hidden');
    setTimeout(() => closeBtn.focus(), 30);
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

// Render the Ledger page
export function renderLedgerPage(app) {
    // --- Begin: renderLedgerPage logic from app.js ---
    const container = document.getElementById('ledgerTableContainer');
    if (!container) return;
    const accounts = app.accounts || [];
    let selectedAccount = app._ledgerAccountFilter || 'all';
    let selectedDateRange = app._ledgerDateRange || '30';
    let selectedPageSize = parseInt(app._ledgerPageSize, 10);
    if (![10, 25, 50, 100].includes(selectedPageSize)) {
        selectedPageSize = 25;
    }
    let currentPage = parseInt(app._ledgerPage, 10);
    if (isNaN(currentPage) || currentPage < 1) {
        currentPage = 1;
    }
    let transactions = getFilteredSortedLedgerTransactions(app);
    let filterHtml = '';
    filterHtml += `<div class="filter-controls">`;
    if (accounts.length > 0) {
        filterHtml += `<label for="ledgerAccountFilter" class="filter-label">Account:</label>
            <select id="ledgerAccountFilter" class="select-styled">
                <option value="all">All Accounts</option>`;
        for (const acct of accounts) {
            filterHtml += `<option value="${acct.id}"${selectedAccount == acct.id ? ' selected' : ''}>${escapeHtml(acct.name)}</option>`;
        }
        filterHtml += `</select>`;
    }
    filterHtml += `<label for="ledgerDateRange" class="filter-label">Show:</label>
        <select id="ledgerDateRange" class="select-styled">
            <option value="all"${selectedDateRange==='all'?' selected':''}>All</option>
            <option value="past"${selectedDateRange==='past'?' selected':''}>Past & Today Only</option>
            <option value="30"${selectedDateRange==='30'?' selected':''}>Next 30 Days</option>
            <option value="month"${selectedDateRange==='month'?' selected':''}>Through Next Month</option>
            <option value="60"${selectedDateRange==='60'?' selected':''}>Next 60 Days</option>
            <option value="90"${selectedDateRange==='90'?' selected':''}>Next 90 Days</option>
        </select>`;
    filterHtml += `<label for="ledgerPageSize" class="filter-label">Rows:</label>
        <select id="ledgerPageSize" class="select-styled">
            <option value="10"${selectedPageSize===10?' selected':''}>10</option>
            <option value="25"${selectedPageSize===25?' selected':''}>25</option>
            <option value="50"${selectedPageSize===50?' selected':''}>50</option>
            <option value="100"${selectedPageSize===100?' selected':''}>100</option>
        </select>`;
    filterHtml += `<button id="ledgerExportCsvBtn" class="btn btn-secondary btn-small" type="button">⬇️ Export CSV</button>`;
    if (selectedAccount !== 'all') {
        filterHtml += `<button id="reconcileFromLedgerBtn" class="btn btn-secondary btn-small" data-ledger-reconcile="${escapeHtml(String(selectedAccount))}">🔄 Reconcile this account</button>`;
    }
    filterHtml += `</div>`;

    const totalRows = transactions.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / selectedPageSize));
    if (currentPage > totalPages) {
        currentPage = totalPages;
    }
    app._ledgerPageSize = selectedPageSize;
    app._ledgerPage = currentPage;

    const startIndex = (currentPage - 1) * selectedPageSize;
    const endIndex = startIndex + selectedPageSize;
    const pagedTransactions = transactions.slice(startIndex, endIndex);
    const startItem = totalRows === 0 ? 0 : startIndex + 1;
    const endItem = Math.min(endIndex, totalRows);

    const sortIcon = key => {
        if (app._ledgerSortKey !== key) return '<span class="sort-icon">⇅</span>';
        return app._ledgerSortDir === 'asc' ? '<span class="sort-icon">↑</span>' : '<span class="sort-icon">↓</span>';
    };
    const reconAdjusts = getSetting(app, RECONCILIATION_ADJUSTS_BALANCE, false);

    let html = filterHtml;
    html += `<div class="table-wrapper"><table class="ledger-table">
        <thead><tr>
            <th data-key="date">Date ${sortIcon('date')}</th>
            <th data-key="account">Account ${sortIcon('account')}</th>
            <th data-key="name">Transaction ${sortIcon('name')}</th>
            <th data-key="amount">Amount ${sortIcon('amount')}</th>
            <th data-key="balance">Running Balance ${sortIcon('balance')}</th>
        </tr></thead>
        <tbody>`;
    if (pagedTransactions.length === 0) {
        html += `<tr><td colspan="5" class="text-center text-muted-secondary p-32">No transactions yet.</td></tr>`;
    } else {
        for (const tx of pagedTransactions) {
            const isReconciliation = tx.type === 'reconciliation';
            const canOverride = !tx.isRollover && !isReconciliation && !!tx.transactionId;
            const amountColorClass = isReconciliation ? '' : (tx.amount < 0 ? 'text-expense' : 'text-income');
            const reconDiffClass = isReconciliation && tx.meta
                ? (tx.meta.difference > 0 ? 'recon-diff--pos' : tx.meta.difference < 0 ? 'recon-diff--neg' : 'recon-diff--zero')
                : '';
            const amountCell = isReconciliation
                ? `<span class="ledger-recon-diff ${reconDiffClass}">${tx.meta ? formatCurrency(tx.meta.difference) : formatCurrency(tx.amount)}</span>`
                : tx.hasOverride
                    ? `<div class="ledger-amount-stack"><span class="ledger-amount-effective">${formatCurrency(tx.amount)}</span><span class="ledger-amount-original">Original ${formatCurrency(tx.originalAmount)}</span></div>`
                    : `<span>${formatCurrency(tx.amount)}</span>`;

            let reconInfoIcon = '';
            if (isReconciliation && tx.meta) {
                const tipText = reconAdjusts
                    ? `Running balance snaps to statement balance (${formatCurrency(tx.meta.statementBalance)}) at this row.\nTransactions after this point project forward from that balance.\n\nReconciliation Adjusts Balance: On`
                    : `Informational only — the running balance is not changed by this row.\nEnable "Reconciliation Adjusts Balance" in Settings to have the balance snap to the statement balance at reconciliation points.\n\nReconciliation Adjusts Balance: Off`;
                reconInfoIcon = `<span class="ledger-recon-info${reconAdjusts ? ' ledger-recon-info--active' : ''}" title="${escapeHtml(tipText)}" aria-label="Reconciliation balance info" tabindex="0">ℹ</span>`;
            }

            const nameCell = isReconciliation && tx.meta
                ? `🔄 ${escapeHtml(tx.name || '')} <span class="text-muted-secondary">(${formatCurrency(tx.meta.previousBalance)} → ${formatCurrency(tx.meta.statementBalance)})</span>${reconInfoIcon}`
                : escapeHtml(tx.name || '');
            const overrideActions = canOverride
                ? `<div class="ledger-override-actions"><button class="ledger-override-btn" data-ledger-override="${escapeHtml(tx.transactionId)}">${tx.hasOverride ? 'Edit override' : 'Override'}</button>${tx.hasOverride ? `<button class="ledger-override-clear-btn" data-ledger-clear-override="${escapeHtml(tx.transactionId)}">Reset</button>` : ''}</div>`
                : '';
            html += `<tr${isReconciliation ? ' class="ledger-row--reconciliation"' : ''}>
                <td>${tx.date ? _formatLedgerDate(tx.date) : ''}</td>
                <td>${escapeHtml(tx.account || '')}</td>
                <td>${nameCell}</td>
                <td class="text-right ${amountColorClass}">${amountCell}${overrideActions}</td>
                <td class="text-right">${formatCurrency(tx.balance)}</td>
            </tr>`;
        }
    }
    html += `</tbody></table></div>`;
    html += `<div class="ledger-pagination">
        <div class="ledger-page-summary">Showing ${startItem}-${endItem} of ${totalRows}</div>
        <div class="ledger-page-controls">
            <button id="ledgerPrevPage" class="ledger-page-btn" ${currentPage <= 1 ? 'disabled' : ''}>Previous</button>
            <span class="ledger-page-info">Page ${currentPage} of ${totalPages}</span>
            <button id="ledgerNextPage" class="ledger-page-btn" ${currentPage >= totalPages ? 'disabled' : ''}>Next</button>
        </div>
    </div>`;
    container.innerHTML = html;
    const table = container.querySelector('.ledger-table');
    if (table) {
        table.querySelectorAll('th[data-key]').forEach(th => {
            th.classList.add('cursor-pointer');
            th.onclick = () => {
                const key = th.getAttribute('data-key');
                if (app._ledgerSortKey === key) {
                    app._ledgerSortDir = app._ledgerSortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    app._ledgerSortKey = key;
                    app._ledgerSortDir = key === 'amount' || key === 'balance' ? 'desc' : 'asc';
                }
                app._ledgerPage = 1;
                renderLedgerPage(app);
            };
        });
    }
    const acctFilter = container.querySelector('#ledgerAccountFilter');
    if (acctFilter) {
        acctFilter.onchange = (e) => {
            app._ledgerAccountFilter = e.target.value;
            app._ledgerPage = 1;
            renderLedgerPage(app);
        };
    }
    const dateRangeFilter = container.querySelector('#ledgerDateRange');
    if (dateRangeFilter) {
        dateRangeFilter.onchange = (e) => {
            app._ledgerDateRange = e.target.value;
            app._ledgerPage = 1;
            renderLedgerPage(app);
        };
    }
    const pageSizeFilter = container.querySelector('#ledgerPageSize');
    if (pageSizeFilter) {
        pageSizeFilter.onchange = (e) => {
            const pageSize = parseInt(e.target.value, 10);
            app._ledgerPageSize = [10, 25, 50, 100].includes(pageSize) ? pageSize : 25;
            app._ledgerPage = 1;
            renderLedgerPage(app);
        };
    }
    const prevBtn = container.querySelector('#ledgerPrevPage');
    if (prevBtn) {
        prevBtn.onclick = () => {
            if ((app._ledgerPage || 1) > 1) {
                app._ledgerPage = (app._ledgerPage || 1) - 1;
                renderLedgerPage(app);
            }
        };
    }
    const nextBtn = container.querySelector('#ledgerNextPage');
    if (nextBtn) {
        nextBtn.onclick = () => {
            const page = app._ledgerPage || 1;
            if (page < totalPages) {
                app._ledgerPage = page + 1;
                renderLedgerPage(app);
            }
        };
    }

    container.querySelectorAll('[data-ledger-override]').forEach(btn => {
        btn.onclick = () => {
            const txId = btn.getAttribute('data-ledger-override');
            const tx = transactions.find(item => item.transactionId === txId);
            if (!tx || tx.isRollover) return;
            openLedgerOverrideModal(app, tx);
        };
    });

    container.querySelectorAll('[data-ledger-clear-override]').forEach(btn => {
        btn.onclick = () => {
            const txId = btn.getAttribute('data-ledger-clear-override');
            clearLedgerAmountOverride(app, txId);
            app.saveToStorage();
            renderLedgerPage(app);
            if (typeof app.renderReportsPage === 'function') app.renderReportsPage();
            if (typeof app.renderAccountsList === 'function') app.renderAccountsList();
        };
    });

    const reconcileBtn = container.querySelector('#reconcileFromLedgerBtn');
    if (reconcileBtn) {
        reconcileBtn.onclick = () => {
            const accountId = parseInt(reconcileBtn.getAttribute('data-ledger-reconcile'), 10);
            if (typeof app.openReconcileModal === 'function') app.openReconcileModal(accountId);
        };
    }

    const exportCsvBtn = container.querySelector('#ledgerExportCsvBtn');
    if (exportCsvBtn) {
        exportCsvBtn.onclick = () => openLedgerExportModal(app);
    }
    // --- End: renderLedgerPage logic ---
}

// Helper for formatting ledger dates (copied from app.js)
function _formatLedgerDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
