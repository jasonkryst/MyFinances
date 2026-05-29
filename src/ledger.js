// Ledger logic: rendering, transaction gathering

import { getIncomePaydaysInMonth, formatCurrency } from './utils.js';
import { getRecurringOccurrencesInMonth } from './recurring.js';

function getDateKey(date) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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
        isRollover: tx.type === 'rollover'
    };
}

export function makeLedgerTransactionId(tx) {
    const dateKey = getDateKey(tx.date);
    const account = String(tx.accountId ?? '');
    const type = String(tx.type ?? 'other');
    const source = String(tx.sourceId ?? 'none');
    return `${type}|${source}|${account}|${dateKey}`;
}

function buildProjectedAccountTransactions(app, startYear, startMonth, monthsToProject = 12) {
    const accountMap = {};
    for (const acct of app.accounts || []) {
        accountMap[acct.id] = { ...acct, txs: [] };
    }

    function addTx({ accountId, date, name, amount, type, sourceId, category }) {
        if (!accountId || !accountMap[accountId]) return;
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
            accountId,
            date: txDate,
            type,
            sourceId
        });
        accountMap[accountId].txs.push(tx);
    }

    for (let m = 0; m < monthsToProject; m++) {
        const year = startYear + Math.floor((startMonth + m) / 12);
        const month = (startMonth + m) % 12;

        for (const inc of app.incomes || []) {
            if (!inc.accountId || !inc.amount) continue;
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
            if (!bonus.accountId) continue;
            if (bonus.date && bonus.amount) {
                const bonusDate = new Date(bonus.date);
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
            if (!debt.accountId) continue;
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
            if (!bill.accountId) continue;
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
            if (!exp.accountId) continue;
            if (exp.budgetAmount && exp.date) {
                const expDate = new Date(exp.date);
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
            if (!tmpl.accountId) continue;
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
        if (accountId !== null && String(acctId) !== String(accountId)) continue;
        const acct = accountMap[acctId];
        for (const tx of acct.txs) {
            const amount = getEffectiveAmount(app, tx);
            out.push({
                date: tx.date.toISOString(),
                account: acct.name,
                accountId: acctId,
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

// Gather all transactions for the ledger
export function getLedgerTransactions(app) {
    const today = new Date();
    const accountMap = buildProjectedAccountTransactions(app, today.getFullYear(), today.getMonth(), 12);
    const allTxs = [];

    for (const acctId in accountMap) {
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
                    transactionId: null
                });
            }

            const amount = getEffectiveAmount(app, tx);
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
                transactionId: tx.transactionId
            });
            lastMonth = txMonth;
        }
    }

    allTxs.sort((a, b) => b.date - a.date);
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
        modal.style.display = 'none';
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

    modal.style.display = 'flex';
    setTimeout(() => input.focus(), 30);
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
    let selectedPageSize = parseInt(app._ledgerPageSize, 10);
    if (![10, 25, 50, 100].includes(selectedPageSize)) {
        selectedPageSize = 25;
    }
    let currentPage = parseInt(app._ledgerPage, 10);
    if (isNaN(currentPage) || currentPage < 1) {
        currentPage = 1;
    }
    let filterHtml = '';
    filterHtml += `<div style="margin-bottom:18px;display:flex;align-items:center;gap:18px;flex-wrap:wrap;">`;
    if (accounts.length > 0) {
        filterHtml += `<label for="ledgerAccountFilter" style="font-weight:600;">Account:</label>
            <select id="ledgerAccountFilter" style="padding:7px 14px;border-radius:6px;border:1.5px solid var(--border-color);font-size:1rem;">
                <option value="all">All Accounts</option>`;
        for (const acct of accounts) {
            filterHtml += `<option value="${acct.id}"${selectedAccount == acct.id ? ' selected' : ''}>${escapeHtml(acct.name)}</option>`;
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
    filterHtml += `<label for="ledgerPageSize" style="font-weight:600;">Rows:</label>
        <select id="ledgerPageSize" style="padding:7px 14px;border-radius:6px;border:1.5px solid var(--border-color);font-size:1rem;">
            <option value="10"${selectedPageSize===10?' selected':''}>10</option>
            <option value="25"${selectedPageSize===25?' selected':''}>25</option>
            <option value="50"${selectedPageSize===50?' selected':''}>50</option>
            <option value="100"${selectedPageSize===100?' selected':''}>100</option>
        </select>`;
    filterHtml += `</div>`;
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
    if (pagedTransactions.length === 0) {
        html += `<tr><td colspan="5" style="text-align:center;color:#888;padding:32px 0;">No transactions yet.</td></tr>`;
    } else {
        for (const tx of pagedTransactions) {
            const canOverride = !tx.isRollover && !!tx.transactionId;
            const amountColor = tx.amount < 0 ? '#dc2626' : '#059669';
            const amountCell = tx.hasOverride
                ? `<div class="ledger-amount-stack"><span class="ledger-amount-effective">${formatCurrency(tx.amount)}</span><span class="ledger-amount-original">Original ${formatCurrency(tx.originalAmount)}</span></div>`
                : `<span>${formatCurrency(tx.amount)}</span>`;
            const overrideActions = canOverride
                ? `<div class="ledger-override-actions"><button class="ledger-override-btn" data-ledger-override="${escapeHtml(tx.transactionId)}">${tx.hasOverride ? 'Edit override' : 'Override'}</button>${tx.hasOverride ? `<button class="ledger-override-clear-btn" data-ledger-clear-override="${escapeHtml(tx.transactionId)}">Reset</button>` : ''}</div>`
                : '';
            html += `<tr>
                <td>${tx.date ? _formatLedgerDate(tx.date) : ''}</td>
                <td>${escapeHtml(tx.account || '')}</td>
                <td>${escapeHtml(tx.name || '')}</td>
                <td style="text-align:right;color:${amountColor};">${amountCell}${overrideActions}</td>
                <td style="text-align:right;">${formatCurrency(tx.balance)}</td>
            </tr>`;
        }
    }
    html += `</tbody></table>`;
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
            th.style.cursor = 'pointer';
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
    // --- End: renderLedgerPage logic ---
}

// Helper for formatting ledger dates (copied from app.js)
function _formatLedgerDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
