// Ledger logic: rendering, transaction gathering

import { getIncomePaydaysInMonth, formatCurrency } from './utils.js';

// Gather all transactions for the ledger
export function getLedgerTransactions(app) {
    // --- Begin: _getLedgerTransactions logic from app.js ---
    const accountMap = {};
    for (const acct of app.accounts) {
        accountMap[acct.id] = { ...acct, txs: [] };
    }
    function addTx({accountId, date, name, amount, type}) {
        if (!accountId || !accountMap[accountId]) return;
        accountMap[accountId].txs.push({ date: new Date(date), name, amount, type });
    }
    const today = new Date();
    const startYear = today.getFullYear();
    const startMonth = today.getMonth();
    const monthsToProject = 12;
    for (let m = 0; m < monthsToProject; m++) {
        const year = startYear + Math.floor((startMonth + m) / 12);
        const month = (startMonth + m) % 12;
        for (const inc of app.incomes) {
            if (!inc.accountId || !inc.amount) continue;
            const paydays = getIncomePaydaysInMonth(inc, year, month);
            for (const payDate of paydays) {
                addTx({
                    accountId: inc.accountId,
                    date: payDate,
                    name: inc.name || 'Income',
                    amount: Number(inc.amount),
                    type: 'income'
                });
            }
        }
        for (const bonus of app.bonuses) {
            if (!bonus.accountId) continue;
            if (bonus.date && bonus.amount) {
                const bonusDate = new Date(bonus.date);
                if (bonusDate.getFullYear() === year && bonusDate.getMonth() === month) {
                    addTx({
                        accountId: bonus.accountId,
                        date: bonusDate,
                        name: bonus.name || 'Bonus',
                        amount: Number(bonus.amount),
                        type: 'bonus'
                    });
                }
            }
        }
        for (const debt of app.debts) {
            if (!debt.accountId) continue;
            if (debt.dueDate && debt.minimumPayment) {
                const due = new Date(year, month, debt.dueDate);
                addTx({
                    accountId: debt.accountId,
                    date: due,
                    name: debt.name || 'Debt Payment',
                    amount: -Math.abs(Number(debt.minimumPayment)),
                    type: 'debt'
                });
            }
        }
        for (const bill of app.bills) {
            if (!bill.accountId) continue;
            if (bill.dueDay && bill.amount) {
                const due = new Date(year, month, bill.dueDay);
                addTx({
                    accountId: bill.accountId,
                    date: due,
                    name: bill.name || 'Bill',
                    amount: -Math.abs(Number(bill.amount)),
                    type: 'bill'
                });
            }
        }
        for (const exp of app.expenses) {
            if (!exp.accountId) continue;
            if (exp.budgetAmount && exp.date) {
                const expDate = new Date(exp.date);
                if (expDate.getFullYear() === year && expDate.getMonth() === month) {
                    addTx({
                        accountId: exp.accountId,
                        date: expDate,
                        name: exp.name || 'Expense',
                        amount: -Math.abs(Number(exp.budgetAmount)),
                        type: 'expense'
                    });
                }
            }
        }
    }
    for (var acctId in accountMap) {
        accountMap[acctId].txs.sort(function(a, b) { return a.date - b.date; });
    }
    var allTxs = [];
    for (var acctId in accountMap) {
        var lastMonth = null;
        var running = accountMap[acctId].startingBalance;
        for (var i = 0; i < accountMap[acctId].txs.length; i++) {
            var tx = accountMap[acctId].txs[i];
            var txMonth = tx.date.getFullYear() + '-' + (tx.date.getMonth() + 1);
            if (lastMonth && txMonth !== lastMonth) {
                allTxs.push({
                    date: new Date(tx.date.getFullYear(), tx.date.getMonth(), 1),
                    account: accountMap[acctId].name,
                    accountId: acctId,
                    name: 'Balance Rollover',
                    amount: 0,
                    balance: running
                });
            }
            running += tx.amount;
            tx.balance = running;
            allTxs.push({
                date: tx.date,
                account: accountMap[acctId].name,
                accountId: acctId,
                name: tx.name,
                amount: tx.amount,
                balance: tx.balance
            });
            lastMonth = txMonth;
        }
    }
    allTxs.sort(function(a, b) { return b.date - a.date; });
    return allTxs.map(function(tx) {
        return {
            date: tx.date.toISOString(),
            account: tx.account,
            accountId: tx.accountId,
            name: tx.name,
            amount: tx.amount,
            balance: tx.balance
        };
    });
    // --- End: _getLedgerTransactions logic ---
}

// Render the Ledger page
export function renderLedgerPage(app) {
    // --- Begin: renderLedgerPage logic from app.js ---
    const container = document.getElementById('ledgerTableContainer');
    if (!container) return;
    let transactions = getLedgerTransactions(app);
    const accounts = app.accounts || [];
    let selectedAccount = app._ledgerAccountFilter || 'all';
    let selectedDateRange = app._ledgerDateRange || '30';
    let filterHtml = '';
    filterHtml += `<div style="margin-bottom:18px;display:flex;align-items:center;gap:18px;flex-wrap:wrap;">`;
    if (accounts.length > 0) {
        filterHtml += `<label for="ledgerAccountFilter" style="font-weight:600;">Account:</label>
            <select id="ledgerAccountFilter" style="padding:7px 14px;border-radius:6px;border:1.5px solid var(--border-color);font-size:1rem;">
                <option value="all">All Accounts</option>`;
        for (const acct of accounts) {
            filterHtml += `<option value="${acct.id}"${selectedAccount == acct.id ? ' selected' : ''}>${acct.name}</option>`;
        }
        filterHtml += `</select>`;
    }
    filterHtml += `<label for="ledgerDateRange" style="font-weight:600;">Show:</label>
        <select id="ledgerDateRange" style="padding:7px 14px;border-radius:6px;border:1.5px solid var(--border-color);font-size:1rem;">
            <option value="all"${selectedDateRange==='all'?' selected':''}>All</option>
            <option value="past"${selectedDateRange==='past'?' selected':''}>Past & Today Only</option>
            <option value="30"${selectedDateRange==='30'?' selected':''}>Next 30 Days</option>
            <option value="month"${selectedDateRange==='month'?' selected':''}>Through Next Month</option>
            <option value="60"${selectedDateRange==='60'?' selected':''}>Next 60 Days</option>
            <option value="90"${selectedDateRange==='90'?' selected':''}>Next 90 Days</option>
        </select>`;
    filterHtml += `</div>`;
    if (selectedAccount !== 'all') {
        transactions = transactions.filter(tx => String(tx.accountId) === String(selectedAccount));
    }
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
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
    let sortKey = app._ledgerSortKey || 'date';
    let sortDir = app._ledgerSortDir || 'desc';
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
        return 0;
    });
    const sortIcon = key => {
        if (app._ledgerSortKey !== key) return '<span class="sort-icon">⇅</span>';
        return app._ledgerSortDir === 'asc' ? '<span class="sort-icon">↑</span>' : '<span class="sort-icon">↓</span>';
    };
    let html = filterHtml;
    html += `<table class="ledger-table">
        <thead><tr>
            <th data-key="date">Date ${sortIcon('date')}</th>
            <th data-key="account">Account ${sortIcon('account')}</th>
            <th data-key="name">Transaction ${sortIcon('name')}</th>
            <th data-key="amount">Amount ${sortIcon('amount')}</th>
            <th data-key="balance">Running Balance ${sortIcon('balance')}</th>
        </tr></thead>
        <tbody>`;
    if (transactions.length === 0) {
        html += `<tr><td colspan="5" style="text-align:center;color:#888;padding:32px 0;">No transactions yet.</td></tr>`;
    } else {
        for (const tx of transactions) {
            html += `<tr>
                <td>${tx.date ? _formatLedgerDate(tx.date) : ''}</td>
                <td>${tx.account || ''}</td>
                <td>${tx.name || ''}</td>
                <td style="text-align:right;${tx.amount < 0 ? 'color:#dc2626;' : 'color:#059669;'}">${formatCurrency(tx.amount)}</td>
                <td style="text-align:right;">${formatCurrency(tx.balance)}</td>
            </tr>`;
        }
    }
    html += `</tbody></table>`;
    container.innerHTML = html;
    const table = container.querySelector('.ledger-table');
    if (table) {
        table.querySelectorAll('th[data-key]').forEach(th => {
            th.style.cursor = 'pointer';
            th.onclick = () => {
                const key = th.getAttribute('data-key');
                if (app._ledgerSortKey === key) {
                    app._ledgerSortDir = app._ledgerSortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    app._ledgerSortKey = key;
                    app._ledgerSortDir = key === 'amount' || key === 'balance' ? 'desc' : 'asc';
                }
                renderLedgerPage(app);
            };
        });
    }
    const acctFilter = container.querySelector('#ledgerAccountFilter');
    if (acctFilter) {
        acctFilter.onchange = (e) => {
            app._ledgerAccountFilter = e.target.value;
            renderLedgerPage(app);
        };
    }
    const dateRangeFilter = container.querySelector('#ledgerDateRange');
    if (dateRangeFilter) {
        dateRangeFilter.onchange = (e) => {
            app._ledgerDateRange = e.target.value;
            renderLedgerPage(app);
        };
    }
    // --- End: renderLedgerPage logic ---
}

// Helper for formatting ledger dates (copied from app.js)
function _formatLedgerDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
