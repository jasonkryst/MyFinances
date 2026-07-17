// Ledger logic: rendering, amount overrides

import { formatCurrency, escapeHtml, parseFiniteOrNull, formatShortDate } from './utils.js';
import { getSetting, setSetting, RECONCILIATION_ADJUSTS_BALANCE } from './settings.js';
import { getFilteredSortedLedgerTransactions } from './ledgerTransactions.js';

export function setLedgerAmountOverride(app, transactionId, amount, metadata = {}) {
    if (!transactionId) return;
    const parsed = parseFiniteOrNull(amount);
    if (parsed === null) return;
    if (!app.ledgerAmountOverrides) app.ledgerAmountOverrides = {};

    app.ledgerAmountOverrides[transactionId] = {
        amount: parsed,
        originalAmount: parseFiniteOrNull(metadata.originalAmount),
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
    dateEl.textContent = tx.date ? formatShortDate(tx.date) : '';
    originalEl.textContent = formatCurrency(tx.originalAmount);
    input.value = Number(tx.amount || 0).toFixed(2);

    const close = () => {
        modal.classList.add('hidden'); modal.classList.remove('flex-visible');
        modal.onkeydown = null;
    };

    confirmBtn.onclick = () => {
        const parsed = parseFiniteOrNull(input.value);
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
                <td>${tx.date ? formatShortDate(tx.date) : ''}</td>
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
