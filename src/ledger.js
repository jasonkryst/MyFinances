// Ledger logic: rendering, amount overrides

import { formatCurrency, escapeHtml, formatShortDate, buildPersonPillsHtml } from './utils.js';
import { getSetting, setSetting, RECONCILIATION_ADJUSTS_BALANCE } from './settings.js';
import { getFilteredSortedLedgerTransactions } from './ledgerTransactions.js';
import { clearLedgerAmountOverride, openLedgerOverrideModal } from './ledgerOverrides.js';
import { setLedgerCleared } from './ledgerCleared.js';
import { LEDGER_EXPORT_COLUMN_KEYS } from './dataExport.js';

const LEDGER_ALL_COLS = ['date', 'account', 'name', 'amount', 'balance', 'cleared'];
const LEDGER_COL_LABELS = { date: 'Date', account: 'Account', name: 'Transaction', amount: 'Amount', balance: 'Running Balance', cleared: 'Cleared' };
const LEDGER_COLS_LS_KEY = 'ledgerHiddenColumns';

function loadHiddenCols() {
    try {
        const raw = localStorage.getItem(LEDGER_COLS_LS_KEY);
        if (!raw) return new Set();
        return new Set(raw.split(',').filter(c => LEDGER_ALL_COLS.includes(c)));
    } catch { return new Set(); }
}

function saveHiddenCols(hidden) {
    try {
        if (hidden.size === 0) {
            localStorage.removeItem(LEDGER_COLS_LS_KEY);
        } else {
            localStorage.setItem(LEDGER_COLS_LS_KEY, [...hidden].join(','));
        }
    } catch { /* quota — non-fatal */ }
}

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

function openLedgerMarkAllClearedModal(app, clearableTxs, onComplete) {
    const modal = document.getElementById('ledgerMarkAllClearedModal');
    if (!modal) return;
    const desc = document.getElementById('ledgerMarkAllClearedDesc');
    const confirmBtn = document.getElementById('ledgerMarkAllClearedConfirmBtn');
    const cancelBtn = document.getElementById('ledgerMarkAllClearedCancelBtn');
    const closeBtn = document.getElementById('ledgerMarkAllClearedCloseBtn');
    if (!desc || !confirmBtn || !cancelBtn || !closeBtn) return;

    const count = clearableTxs.length;
    desc.textContent = `Mark ${count} transaction${count !== 1 ? 's' : ''} as cleared? This will apply to all uncleared transactions matching the current filters.`;

    const close = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex-visible');
        modal.onkeydown = null;
    };

    confirmBtn.onclick = () => {
        for (const tx of clearableTxs) {
            setLedgerCleared(app, tx.transactionId, true);
        }
        app.saveToStorage();
        close();
        onComplete();
    };
    cancelBtn.onclick = close;
    closeBtn.onclick = close;
    modal.onclick = (event) => { if (event.target === modal) close(); };
    modal.onkeydown = (event) => {
        if (event.key === 'Escape') { event.preventDefault(); close(); }
    };

    modal.classList.add('flex-visible');
    modal.classList.remove('hidden');
    setTimeout(() => closeBtn.focus(), 30);
}

// Render the Ledger page
export function renderLedgerPage(app) {
    // --- Begin: renderLedgerPage logic from app.js ---
    const container = document.getElementById('ledgerTableContainer');
    if (!container) return;
    const accounts = app.accounts || [];
    let selectedAccount = app._ledgerAccountFilter || 'all';
    let selectedDateRange = app._ledgerDateRange || 'around7';
    let selectedClearedFilter = app._ledgerClearedFilter || 'all';
    let selectedPageSize = parseInt(app._ledgerPageSize, 10);
    if (![10, 25, 50, 100].includes(selectedPageSize)) {
        selectedPageSize = 25;
    }
    let currentPage = parseInt(app._ledgerPage, 10);
    if (isNaN(currentPage) || currentPage < 1) {
        currentPage = 1;
    }
    let transactions = getFilteredSortedLedgerTransactions(app);
    const clearableUncleared = transactions.filter(tx => tx.transactionId && !tx.cleared);
    let activeFilterCount = 0;
    if (selectedAccount !== 'all') activeFilterCount++;
    if (selectedDateRange !== 'around7') activeFilterCount++;
    if (selectedClearedFilter !== 'all') activeFilterCount++;

    let filterHtml = '';
    filterHtml += `<div class="filter-controls">`;
    if (accounts.length > 0) {
        filterHtml += `<label for="ledgerAccountFilter" class="filter-label">Account:</label>
            <select id="ledgerAccountFilter" class="select-styled">
                <option value="all">All Accounts</option>`;
        for (const acct of accounts) {
            filterHtml += `<option value="${acct.id}"${selectedAccount == acct.id ? ' selected' : ''}>${escapeHtml(acct.name)} (${escapeHtml(acct.type)})</option>`;
        }
        filterHtml += `</select>`;
    }
    filterHtml += `<label for="ledgerDateRange" class="filter-label">Show:</label>
        <select id="ledgerDateRange" class="select-styled">
            <option value="around7"${selectedDateRange==='around7'?' selected':''}>Around Today (±7 days)</option>
            <option value="all"${selectedDateRange==='all'?' selected':''}>All</option>
            <option value="past"${selectedDateRange==='past'?' selected':''}>Past &amp; Today Only</option>
            <option value="30"${selectedDateRange==='30'?' selected':''}>Next 30 Days</option>
            <option value="month"${selectedDateRange==='month'?' selected':''}>Through Next Month</option>
            <option value="60"${selectedDateRange==='60'?' selected':''}>Next 60 Days</option>
            <option value="90"${selectedDateRange==='90'?' selected':''}>Next 90 Days</option>
        </select>`;
    filterHtml += `<label for="ledgerClearedFilter" class="filter-label">Status:</label>
        <select id="ledgerClearedFilter" class="select-styled">
            <option value="all"${selectedClearedFilter==='all'?' selected':''}>All</option>
            <option value="uncleared"${selectedClearedFilter==='uncleared'?' selected':''}>Uncleared Only</option>
            <option value="cleared"${selectedClearedFilter==='cleared'?' selected':''}>Cleared Only</option>
        </select>`;
    filterHtml += `<label for="ledgerPageSize" class="filter-label">Rows:</label>
        <select id="ledgerPageSize" class="select-styled">
            <option value="10"${selectedPageSize===10?' selected':''}>10</option>
            <option value="25"${selectedPageSize===25?' selected':''}>25</option>
            <option value="50"${selectedPageSize===50?' selected':''}>50</option>
            <option value="100"${selectedPageSize===100?' selected':''}>100</option>
        </select>`;
    filterHtml += `<label for="ledgerColsSelect" class="filter-label">Columns:</label>
        <select id="ledgerColsSelect" class="ledger-cols-select" multiple size="${LEDGER_ALL_COLS.length}" aria-label="Visible columns">
            ${LEDGER_ALL_COLS.map(col => `<option value="${col}">${escapeHtml(LEDGER_COL_LABELS[col])}</option>`).join('')}
        </select>`;
    filterHtml += `<button id="ledgerExportCsvBtn" class="btn btn-secondary btn-small" type="button">⬇️ Export CSV</button>`;
    if (selectedAccount !== 'all') {
        filterHtml += `<button id="reconcileFromLedgerBtn" class="btn btn-secondary btn-small" data-ledger-reconcile="${escapeHtml(String(selectedAccount))}">🔄 Reconcile this account</button>`;
    }
    if (clearableUncleared.length > 0) {
        filterHtml += `<button id="ledgerMarkAllClearedBtn" class="btn btn-secondary btn-small" type="button">✓ Mark ${clearableUncleared.length} as Cleared</button>`;
    }
    if (activeFilterCount > 0) {
        filterHtml += `<button id="ledgerClearFiltersBtn" class="btn btn-secondary btn-small" type="button">✕ Clear Filters</button>`;
        filterHtml += `<span class="filter-active-badge">${activeFilterCount} filter${activeFilterCount !== 1 ? 's' : ''} active</span>`;
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

    const hiddenCols = loadHiddenCols();
    const ch = col => hiddenCols.has(col) ? ' class="ledger-col-hidden"' : '';

    let html = filterHtml;
    html += `<div class="table-wrapper"><table class="ledger-table">
        <thead><tr>
            <th data-key="date" data-col="date"${ch('date')}>Date ${sortIcon('date')}</th>
            <th data-key="account" data-col="account"${ch('account')}>Account ${sortIcon('account')}</th>
            <th data-key="name" data-col="name"${ch('name')}>Transaction ${sortIcon('name')}</th>
            <th data-key="amount" data-col="amount"${ch('amount')}>Amount ${sortIcon('amount')}</th>
            <th data-key="balance" data-col="balance"${ch('balance')}>Running Balance ${sortIcon('balance')}</th>
            <th data-col="cleared"${ch('cleared')}>Cleared</th>
        </tr></thead>
        <tbody>`;
    const visibleColCount = LEDGER_ALL_COLS.length - hiddenCols.size;
    if (pagedTransactions.length === 0) {
        html += `<tr><td colspan="${visibleColCount}" class="text-center text-muted-secondary p-32">No transactions yet.</td></tr>`;
    } else {
        for (const tx of pagedTransactions) {
            const isReconciliation = tx.type === 'reconciliation';
            const canOverride = !tx.isRollover && !isReconciliation && !!tx.transactionId;
            const amountColorClass = isReconciliation ? '' : (tx.amount < 0 ? 'text-expense' : 'text-income');
            const reconDiffClass = isReconciliation && tx.meta
                ? (tx.meta.difference > 0 ? 'recon-diff--pos' : tx.meta.difference < 0 ? 'recon-diff--neg' : 'recon-diff--zero')
                : '';
            const isVariableIncome = tx.type === 'income' && (() => {
                const inc = (app.incomes || []).find(i => i.id === tx.sourceId);
                return inc?.isVariable === true;
            })();
            const amountCell = isReconciliation
                ? `<span class="ledger-recon-diff ${reconDiffClass}">${tx.meta ? formatCurrency(tx.meta.difference) : formatCurrency(tx.amount)}</span>`
                : tx.hasOverride
                    ? `<div class="ledger-amount-stack"><span class="ledger-amount-effective">${formatCurrency(tx.amount)}</span><span class="ledger-override-icon" data-ledger-override="${escapeHtml(tx.transactionId)}" title="Overridden — original: ${formatCurrency(tx.originalAmount)}" aria-label="Amount overridden, original was ${formatCurrency(tx.originalAmount)}" role="button" tabindex="0">✎</span><span class="ledger-amount-original">Original ${formatCurrency(tx.originalAmount)}</span></div>`
                    : isVariableIncome
                        ? `<span>${formatCurrency(tx.amount)}</span><span class="ledger-est-badge" title="Estimated — enter actual amount when paycheck arrives">~ Est.</span>`
                        : `<span>${formatCurrency(tx.amount)}</span>`;

            let reconInfoIcon = '';
            if (isReconciliation && tx.meta) {
                const tipText = reconAdjusts
                    ? `Running balance snaps to statement balance (${formatCurrency(tx.meta.statementBalance)}) at this row.\nTransactions after this point project forward from that balance.\n\nReconciliation Adjusts Balance: On`
                    : `Informational only — the running balance is not changed by this row.\nEnable "Reconciliation Adjusts Balance" in Settings to have the balance snap to the statement balance at reconciliation points.\n\nReconciliation Adjusts Balance: Off`;
                reconInfoIcon = `<span class="ledger-recon-info${reconAdjusts ? ' ledger-recon-info--active' : ''}" title="${escapeHtml(tipText)}" aria-label="Reconciliation balance info" tabindex="0">ℹ</span>`;
            }

            let txPersonPill = '';
            if (!isReconciliation && tx.sourceId) {
                if (tx.type === 'income') {
                    const inc = (app.incomes || []).find(i => i.id === tx.sourceId);
                    const person = inc?.personId ? (app.persons || []).find(p => p.id === inc.personId) : null;
                    if (person) txPersonPill = `<span class="person-pill">${escapeHtml(person.name)}</span>`;
                } else if (tx.type === 'debt') {
                    const debt = (app.debts || []).find(d => d.id === tx.sourceId);
                    const pills = debt ? buildPersonPillsHtml(debt.personIds, app.persons) : '';
                    if (pills) txPersonPill = `<span class="person-pills">${pills}</span>`;
                }
            }
            const nameCell = isReconciliation && tx.meta
                ? `🔄 ${escapeHtml(tx.name || '')} <span class="text-muted-secondary">(${formatCurrency(tx.meta.previousBalance)} → ${formatCurrency(tx.meta.statementBalance)})</span>${reconInfoIcon}`
                : `${escapeHtml(tx.name || '')}${txPersonPill ? `<br>${txPersonPill}` : ''}`;
            const overrideBtnLabel = isVariableIncome && !tx.hasOverride ? null
                : isVariableIncome && tx.hasOverride ? 'Edit actual'
                : tx.hasOverride ? 'Edit override'
                : 'Override';
            const overrideActions = canOverride
                ? `<div class="ledger-override-actions">${overrideBtnLabel === null ? `<button class="ledger-override-btn ledger-enter-actual-btn" data-ledger-override="${escapeHtml(tx.transactionId)}">Enter actual</button>` : `<button class="ledger-override-btn" data-ledger-override="${escapeHtml(tx.transactionId)}">${overrideBtnLabel}</button>`}${tx.hasOverride ? `<button class="ledger-override-clear-btn" data-ledger-clear-override="${escapeHtml(tx.transactionId)}">Reset</button>` : ''}</div>`
                : '';
            const clearedCell = canOverride
                ? `<input type="checkbox" class="ledger-cleared-checkbox" data-ledger-cleared="${escapeHtml(tx.transactionId)}"${tx.cleared ? ' checked' : ''}${tx.clearedAt ? ` title="Cleared ${escapeHtml(new Date(tx.clearedAt).toLocaleString())}"` : ''} aria-label="Mark cleared">`
                : '';
            html += `<tr${isReconciliation ? ' class="ledger-row--reconciliation"' : ''}>
                <td data-col="date"${ch('date')}>${tx.date ? formatShortDate(tx.date) : ''}</td>
                <td data-col="account"${ch('account')}>${escapeHtml(tx.account || '')}</td>
                <td data-col="name"${ch('name')}>${nameCell}</td>
                <td data-col="amount" class="text-right ${amountColorClass}"${ch('amount')}>${amountCell}${overrideActions}</td>
                <td data-col="balance" class="text-right"${ch('balance')}>${formatCurrency(tx.balance)}</td>
                <td data-col="cleared" class="text-center"${ch('cleared')}>${clearedCell}</td>
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
    const clearedFilterEl = container.querySelector('#ledgerClearedFilter');
    if (clearedFilterEl) {
        clearedFilterEl.onchange = (e) => {
            app._ledgerClearedFilter = e.target.value;
            app._ledgerPage = 1;
            renderLedgerPage(app);
        };
    }
    const clearFiltersBtn = container.querySelector('#ledgerClearFiltersBtn');
    if (clearFiltersBtn) {
        clearFiltersBtn.onclick = () => {
            app._ledgerAccountFilter = 'all';
            app._ledgerDateRange = 'around7';
            app._ledgerClearedFilter = 'all';
            app._ledgerPage = 1;
            renderLedgerPage(app);
        };
    }
    const markAllClearedBtn = container.querySelector('#ledgerMarkAllClearedBtn');
    if (markAllClearedBtn) {
        markAllClearedBtn.onclick = () => {
            openLedgerMarkAllClearedModal(app, clearableUncleared, () => renderLedgerPage(app));
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
            openLedgerOverrideModal(app, tx, () => renderLedgerPage(app));
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

    container.querySelectorAll('[data-ledger-cleared]').forEach(checkbox => {
        checkbox.onchange = () => {
            const txId = checkbox.getAttribute('data-ledger-cleared');
            setLedgerCleared(app, txId, checkbox.checked);
            app.saveToStorage();
            renderLedgerPage(app);
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

    // Column visibility multi-select
    const colsSelect = container.querySelector('#ledgerColsSelect');
    if (colsSelect) {
        const saved = loadHiddenCols();
        Array.from(colsSelect.options).forEach(opt => {
            opt.selected = !saved.has(opt.value);
        });
        colsSelect.onchange = () => {
            const selected = new Set(Array.from(colsSelect.selectedOptions).map(o => o.value));
            // Require at least one column visible
            if (selected.size === 0) {
                Array.from(colsSelect.options).forEach(opt => { opt.selected = true; });
                return;
            }
            const newHidden = new Set(LEDGER_ALL_COLS.filter(c => !selected.has(c)));
            saveHiddenCols(newHidden);
            LEDGER_ALL_COLS.forEach(col => {
                container.querySelectorAll(`[data-col="${col}"]`).forEach(el => {
                    el.classList.toggle('ledger-col-hidden', newHidden.has(col));
                });
            });
        };
    }
    // --- End: renderLedgerPage logic ---
}
