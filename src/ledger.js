// Ledger logic: rendering, amount overrides

import { formatCurrency, escapeHtml, formatShortDate, buildPersonPillsHtml, isCollapsibleOpen, buildFiltersLabel } from './utils.js';
import { t, plural, categoryLabel, accountTypeLabel, getIntlLocale } from './i18n.js';
import { getSetting, setSetting, RECONCILIATION_ADJUSTS_BALANCE } from './settings.js';
import { getFilteredSortedLedgerTransactions, getLedgerTransactions } from './ledgerTransactions.js';
import { clearLedgerAmountOverride, openLedgerOverrideModal } from './ledgerOverrides.js';
import { setLedgerCleared } from './ledgerCleared.js';
import { LEDGER_EXPORT_COLUMN_KEYS } from './dataExport.js';

const LEDGER_ALL_COLS = ['date', 'account', 'name', 'amount', 'balance', 'cleared'];
const LEDGER_COL_LABEL_KEYS = { date: 'ledger.colDate', account: 'ledger.colAccount', name: 'ledger.colTransaction', amount: 'ledger.colAmount', balance: 'ledger.colBalance', cleared: 'ledger.colCleared' };
const ledgerColLabel = col => t(LEDGER_COL_LABEL_KEYS[col]);
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

    const lastFocused = document.activeElement;
    const close = () => {
        modal.classList.add('hidden'); modal.classList.remove('flex-visible');
        modal.onkeydown = null;
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
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
        if (event.key === 'Escape') { event.preventDefault(); close(); return; }
        if (event.key === 'Tab') {
            const focusable = modal.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])');
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (!first || !last) return;
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    };

    modal.classList.add('flex-visible'); modal.classList.remove('hidden');
    modal.focus();
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
    desc.textContent = plural('ledger.markAllDesc', count);

    const lastFocused = document.activeElement;
    const close = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex-visible');
        modal.onkeydown = null;
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    };

    confirmBtn.onclick = () => {
        for (const tx of clearableTxs) {
            setLedgerCleared(app, tx.transactionId, true);
        }
        app.syncRecurringPaidFromLedger(clearableTxs.map(tx => tx.transactionId));
        app.saveToStorage();
        close();
        onComplete();
    };
    cancelBtn.onclick = close;
    closeBtn.onclick = close;
    modal.onclick = (event) => { if (event.target === modal) close(); };
    modal.onkeydown = (event) => {
        if (event.key === 'Escape') { event.preventDefault(); close(); return; }
        if (event.key === 'Tab') {
            const focusable = modal.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])');
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (!first || !last) return;
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    };

    modal.classList.add('flex-visible');
    modal.classList.remove('hidden');
    modal.focus();
    setTimeout(() => closeBtn.focus(), 30);
}

function saveLedgerFilters(accountFilter, dateRange, clearedFilter, pageSize, categoryFilter) {
    try {
        localStorage.setItem('debtTrackerLedgerFilters', JSON.stringify({ accountFilter, dateRange, clearedFilter, pageSize, categoryFilter }));
    } catch (_) {}
}

export function loadLedgerFilters() {
    try {
        return JSON.parse(localStorage.getItem('debtTrackerLedgerFilters') || 'null');
    } catch (_) { return null; }
}

// Persists the current filter state, except while a Spending cross-nav
// (#315) is active: its account/date-range reset to 'all' is a transient
// view override, not a preference the user chose, so touching an unrelated
// control (e.g. page size) while viewing it must not overwrite whatever
// account/date the user had deliberately saved before cross-navigating —
// those are restored from app._ledgerPreCrossNavAccount/-DateRange, set by
// spending.js's "View in Ledger" handler.
function persistLedgerFilters(app) {
    const accountFilter = app._ledgerCrossNavLabel
        ? (app._ledgerPreCrossNavAccount ?? 'all')
        : (app._ledgerAccountFilter || 'all');
    const dateRange = app._ledgerCrossNavLabel
        ? (app._ledgerPreCrossNavDateRange ?? 'around7')
        : (app._ledgerDateRange || 'around7');
    saveLedgerFilters(accountFilter, dateRange, app._ledgerClearedFilter || 'all', app._ledgerPageSize || 25, app._ledgerCategoryFilter || 'all');
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
    let selectedCategory = app._ledgerCategoryFilter || 'all';
    let selectedPageSize = parseInt(app._ledgerPageSize, 10);
    if (![10, 25, 50, 100].includes(selectedPageSize)) {
        selectedPageSize = 25;
    }
    if (!app._ledgerFiltersRestored) {
        const saved = loadLedgerFilters();
        if (saved) {
            app._ledgerAccountFilter = saved.accountFilter ?? app._ledgerAccountFilter;
            app._ledgerDateRange = saved.dateRange ?? app._ledgerDateRange;
            app._ledgerClearedFilter = saved.clearedFilter ?? app._ledgerClearedFilter;
            app._ledgerPageSize = saved.pageSize ?? app._ledgerPageSize;
            app._ledgerCategoryFilter = saved.categoryFilter ?? app._ledgerCategoryFilter;
        }
        app._ledgerFiltersRestored = true;
        selectedAccount = app._ledgerAccountFilter || 'all';
        selectedDateRange = app._ledgerDateRange || 'around7';
        selectedClearedFilter = app._ledgerClearedFilter || 'all';
        selectedCategory = app._ledgerCategoryFilter || 'all';
        selectedPageSize = parseInt(app._ledgerPageSize, 10);
        if (![10, 25, 50, 100].includes(selectedPageSize)) selectedPageSize = 25;
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
    if (selectedCategory !== 'all') activeFilterCount++;

    // #315: category options come from the full unfiltered transaction set,
    // same convention as the Account <select> (built from app.accounts, not
    // from whatever the other active filters currently show) — otherwise
    // picking an account filter first could make a category disappear from
    // its own dropdown.
    const allCategories = [...new Set(getLedgerTransactions(app).map(tx => tx.category || 'Other'))].sort();

    let filterHtml = '';
    const filtersOpen = isCollapsibleOpen('ledgerFiltersBody');
    filterHtml += `<div class="filter-controls">`;
    filterHtml += `<button type="button" class="filters-disclosure-toggle${activeFilterCount > 0 ? ' filters-disclosure-toggle--active' : ''}${filtersOpen ? ' is-open' : ''}" id="ledgerFiltersToggle" data-collapse-toggle="ledgerFiltersBody" data-filters-count="server" aria-expanded="${filtersOpen}" aria-controls="ledgerFiltersBody">${buildFiltersLabel(activeFilterCount)}</button>`;
    filterHtml += `<div class="filters-disclosure-body${filtersOpen ? ' is-open' : ''}" id="ledgerFiltersBody">`;
    if (accounts.length > 0) {
        filterHtml += `<div class="fd-field"><label for="ledgerAccountFilter" class="filter-label">${escapeHtml(t('filters.account'))}</label>
            <select id="ledgerAccountFilter" class="select-styled">
                <option value="all">${escapeHtml(t('ledger.allAccounts'))}</option>`;
        for (const acct of accounts) {
            filterHtml += `<option value="${acct.id}"${selectedAccount == acct.id ? ' selected' : ''}>${escapeHtml(acct.name)} (${escapeHtml(accountTypeLabel(acct.type))})</option>`;
        }
        filterHtml += `</select></div>`;
    }
    if (allCategories.length > 0) {
        filterHtml += `<div class="fd-field"><label for="ledgerCategoryFilter" class="filter-label">${escapeHtml(t('filters.category'))}</label>
            <select id="ledgerCategoryFilter" class="select-styled">
                <option value="all">${escapeHtml(t('ledger.allCategories'))}</option>`;
        for (const cat of allCategories) {
            filterHtml += `<option value="${escapeHtml(cat)}"${selectedCategory === cat ? ' selected' : ''}>${escapeHtml(categoryLabel(cat))}</option>`;
        }
        filterHtml += `</select></div>`;
    }
    filterHtml += `<div class="fd-field"><label for="ledgerDateRange" class="filter-label">${escapeHtml(t('ledger.showLabel'))}</label>
        <select id="ledgerDateRange" class="select-styled">
            <option value="around7"${selectedDateRange==='around7'?' selected':''}>${escapeHtml(t('ledger.rangeAround7'))}</option>
            <option value="all"${selectedDateRange==='all'?' selected':''}>${escapeHtml(t('filters.all'))}</option>
            <option value="past"${selectedDateRange==='past'?' selected':''}>${escapeHtml(t('ledger.rangePast'))}</option>
            <option value="30"${selectedDateRange==='30'?' selected':''}>${escapeHtml(t('ledger.range30'))}</option>
            <option value="month"${selectedDateRange==='month'?' selected':''}>${escapeHtml(t('ledger.rangeMonth'))}</option>
            <option value="60"${selectedDateRange==='60'?' selected':''}>${escapeHtml(t('ledger.range60'))}</option>
            <option value="90"${selectedDateRange==='90'?' selected':''}>${escapeHtml(t('ledger.range90'))}</option>
        </select></div>`;
    filterHtml += `<div class="fd-field"><label for="ledgerClearedFilter" class="filter-label">${escapeHtml(t('ledger.statusLabel'))}</label>
        <select id="ledgerClearedFilter" class="select-styled">
            <option value="all"${selectedClearedFilter==='all'?' selected':''}>${escapeHtml(t('filters.all'))}</option>
            <option value="uncleared"${selectedClearedFilter==='uncleared'?' selected':''}>${escapeHtml(t('ledger.statusUncleared'))}</option>
            <option value="cleared"${selectedClearedFilter==='cleared'?' selected':''}>${escapeHtml(t('ledger.statusCleared'))}</option>
        </select></div>`;
    filterHtml += `<div class="fd-field"><label for="ledgerPageSize" class="filter-label">${escapeHtml(t('ledger.rowsLabel'))}</label>
        <select id="ledgerPageSize" class="select-styled">
            <option value="10"${selectedPageSize===10?' selected':''}>10</option>
            <option value="25"${selectedPageSize===25?' selected':''}>25</option>
            <option value="50"${selectedPageSize===50?' selected':''}>50</option>
            <option value="100"${selectedPageSize===100?' selected':''}>100</option>
        </select></div>`;
    filterHtml += `<div class="fd-field fd-field--wide"><label for="ledgerColsSelect" class="filter-label">${escapeHtml(t('ledger.columnsLabel'))}</label>
        <select id="ledgerColsSelect" class="ledger-cols-select" multiple size="${LEDGER_ALL_COLS.length}" aria-label="${escapeHtml(t('ledger.visibleColumnsAria'))}">
            ${LEDGER_ALL_COLS.map(col => `<option value="${col}">${escapeHtml(ledgerColLabel(col))}</option>`).join('')}
        </select></div>`;
    filterHtml += `</div>`;
    filterHtml += `<button id="ledgerExportCsvBtn" class="btn btn-secondary btn-small" type="button">⬇️ ${escapeHtml(t('ledger.exportCsv'))}</button>`;
    filterHtml += `<button id="ledgerTransferBtn" class="btn btn-secondary btn-small" type="button">⇄ ${escapeHtml(t('ledger.transferBtn'))}</button>`;
    if (selectedAccount !== 'all') {
        filterHtml += `<button id="reconcileFromLedgerBtn" class="btn btn-secondary btn-small" data-ledger-reconcile="${escapeHtml(String(selectedAccount))}">🔄 ${escapeHtml(t('ledger.reconcileAccount'))}</button>`;
    }
    if (clearableUncleared.length > 0) {
        filterHtml += `<button id="ledgerMarkAllClearedBtn" class="btn btn-secondary btn-small" type="button">✓ ${escapeHtml(t('ledger.markAllClearedBtn', { count: clearableUncleared.length }))}</button>`;
    }
    if (activeFilterCount > 0) {
        filterHtml += `<button id="ledgerClearFiltersBtn" class="btn btn-secondary btn-small" type="button">✕ ${escapeHtml(t('ledger.clearFilters'))}</button>`;
        filterHtml += `<span class="filter-active-badge">${escapeHtml(plural('ledger.filtersActive', activeFilterCount))}</span>`;
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

    // Sort header names come from ledgerColLabel().
    const sortThAttrs = key => {
        const active = app._ledgerSortKey === key;
        const dirWord = app._ledgerSortDir === 'asc' ? 'ascending' : 'descending';
        const name = ledgerColLabel(key);
        const label = !active ? t('strategy.sortBy', { name })
            : t(app._ledgerSortDir === 'asc' ? 'strategy.sortByAsc' : 'strategy.sortByDesc', { name });
        return ` tabindex="0" aria-label="${escapeHtml(label)}"${active ? ` aria-sort="${dirWord}"` : ''}`;
    };
    const sortIcon = key => {
        if (app._ledgerSortKey !== key) return '<span class="sort-icon">⇅</span>';
        return app._ledgerSortDir === 'asc' ? '<span class="sort-icon">↑</span>' : '<span class="sort-icon">↓</span>';
    };
    const reconAdjusts = getSetting(app, RECONCILIATION_ADJUSTS_BALANCE, false);

    const hiddenCols = loadHiddenCols();
    const ch = col => hiddenCols.has(col) ? ' class="ledger-col-hidden"' : '';

    // #315: cross-nav breadcrumb when arriving here via the Spending
    // drill-down modal's "View in Ledger →" link.
    const crossNavBanner = app._ledgerCrossNavLabel ? `
        <div class="ledger-crossnav-banner">
            <span>${escapeHtml(t('ledger.viewing', { label: app._ledgerCrossNavLabel }))}</span>
            <button id="ledgerCrossNavBackBtn" class="btn btn-secondary btn-small" type="button">&larr; ${escapeHtml(t('ledger.backToSpending'))}</button>
        </div>` : '';

    let html = crossNavBanner + filterHtml;
    html += `<div id="ledgerBulkBar" class="ledger-bulk-bar">
        <span id="ledgerBulkCount" class="ledger-bulk-count" aria-live="polite"></span>
        <button id="ledgerBulkClearBtn" class="btn btn-secondary btn-small" type="button">✓ ${escapeHtml(t('ledger.bulkMarkCleared'))}</button>
        <button id="ledgerBulkUnclearBtn" class="btn btn-secondary btn-small" type="button">✕ ${escapeHtml(t('ledger.bulkMarkUncleared'))}</button>
    </div>`;
    html += `<div class="table-wrapper"><table class="ledger-table">
        <thead><tr>
            <th data-col="select" class="ledger-select-col${hiddenCols.has('cleared') ? ' ledger-col-hidden' : ''}"><input type="checkbox" id="ledgerSelectAll" aria-label="${escapeHtml(t('ledger.selectAllAria'))}"></th>
            <th data-key="date" data-col="date"${ch('date')}${sortThAttrs('date')}>${escapeHtml(ledgerColLabel('date'))} ${sortIcon('date')}</th>
            <th data-key="account" data-col="account"${ch('account')}${sortThAttrs('account')}>${escapeHtml(ledgerColLabel('account'))} ${sortIcon('account')}</th>
            <th data-key="name" data-col="name"${ch('name')}${sortThAttrs('name')}>${escapeHtml(ledgerColLabel('name'))} ${sortIcon('name')}</th>
            <th data-key="amount" data-col="amount"${ch('amount')}${sortThAttrs('amount')}>${escapeHtml(ledgerColLabel('amount'))} ${sortIcon('amount')}</th>
            <th data-key="balance" data-col="balance"${ch('balance')}${sortThAttrs('balance')}>${escapeHtml(ledgerColLabel('balance'))} ${sortIcon('balance')}</th>
            <th data-col="cleared"${ch('cleared')}>${escapeHtml(ledgerColLabel('cleared'))}</th>
        </tr></thead>
        <tbody>`;
    const visibleColCount = LEDGER_ALL_COLS.length - hiddenCols.size + (hiddenCols.has('cleared') ? 0 : 1);
    if (pagedTransactions.length === 0) {
        let emptyIcon, emptyHeading, emptyBody;
        if (activeFilterCount > 0) {
            emptyIcon = '🔍'; emptyHeading = t('ledger.emptyFilteredHeading');
            emptyBody = t('ledger.emptyFilteredBody');
        } else if ((app.accounts || []).length === 0) {
            emptyIcon = '🏦'; emptyHeading = t('ledger.emptyNoAccountsHeading');
            emptyBody = t('ledger.emptyNoAccountsBody');
        } else {
            emptyIcon = '📋'; emptyHeading = t('ledger.emptyNoTxHeading');
            emptyBody = t('ledger.emptyNoTxBody');
        }
        html += `<tr><td colspan="${visibleColCount}" class="ledger-empty-cell">
            <div class="empty-state empty-state--compact">
                <div class="empty-state__icon">${emptyIcon}</div>
                <h3 class="empty-state__heading">${escapeHtml(emptyHeading)}</h3>
                <p class="empty-state__body">${escapeHtml(emptyBody)}</p>
            </div>
        </td></tr>`;
    } else {
        for (const tx of pagedTransactions) {
            const isReconciliation = tx.type === 'reconciliation';
            // Transfers (#248) can be marked cleared per leg (informational,
            // like any other row) but never overridden -- overriding one leg's
            // amount independently of the other would break the record's
            // zero-sum guarantee, since both legs always come from the one
            // `amount` field on the underlying transfer record.
            const isTransfer = tx.type === 'transfer';
            const canClear = !tx.isRollover && !isReconciliation && !!tx.transactionId;
            const canOverride = canClear && !isTransfer;
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
                    ? (() => {
                        const overrideMemo = (app.ledgerAmountOverrides || {})[tx.transactionId]?.memo;
                        const original = formatCurrency(tx.originalAmount);
                        const overrideTitle = overrideMemo
                            ? t('ledger.overriddenTitleMemo', { original, memo: overrideMemo })
                            : t('ledger.overriddenTitle', { original });
                        const overrideAriaLabel = overrideMemo
                            ? t('ledger.overriddenAriaMemo', { original, memo: overrideMemo })
                            : t('ledger.overriddenAria', { original });
                        return `<div class="ledger-amount-stack"><span class="ledger-amount-effective">${formatCurrency(tx.amount)}</span><span class="ledger-override-icon" data-ledger-edit-icon="${escapeHtml(tx.transactionId)}" title="${escapeHtml(overrideTitle)}" aria-label="${escapeHtml(overrideAriaLabel)}" role="button" tabindex="0">✎</span><span class="ledger-amount-original">${escapeHtml(t('ledger.originalAmount', { amount: formatCurrency(tx.originalAmount) }))}</span></div>`;
                    })()
                    : isVariableIncome
                        ? `<span>${formatCurrency(tx.amount)}</span><span class="ledger-est-badge" title="${escapeHtml(t('ledger.estTitle'))}">${escapeHtml(t('income.estBadge'))}</span>`
                        : `<span>${formatCurrency(tx.amount)}</span>`;

            let reconInfoIcon = '';
            if (isReconciliation && tx.meta) {
                const tipText = reconAdjusts
                    ? t('ledger.reconTipOn', { balance: formatCurrency(tx.meta.statementBalance) })
                    : t('ledger.reconTipOff');
                reconInfoIcon = `<span class="ledger-recon-info${reconAdjusts ? ' ledger-recon-info--active' : ''}" title="${escapeHtml(tipText)}" aria-label="${escapeHtml(t('ledger.reconInfoAria'))}" tabindex="0">ℹ</span>`;
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
            const navableTypes = ['debt', 'income', 'recurring'];
            const NAV_TITLE_KEYS = { debt: 'ledger.navDebtTitle', income: 'ledger.navIncomeTitle', recurring: 'ledger.navRecurringTitle' };
            const NAV_ARIA_KEYS = { debt: 'ledger.navDebtAria', income: 'ledger.navIncomeAria', recurring: 'ledger.navRecurringAria' };
            const navIcon = (!isReconciliation && navableTypes.includes(tx.type) && tx.sourceId)
                ? `<button class="ledger-nav-btn" data-ledger-nav-type="${tx.type}" data-ledger-nav-id="${tx.sourceId}" title="${escapeHtml(t(NAV_TITLE_KEYS[tx.type]))}" aria-label="${escapeHtml(t(NAV_ARIA_KEYS[tx.type], { name: tx.name || '' }))}">↗</button>`
                : '';
            // Recurring-template transfer legs (#399) get the same ⇄ prefix as
            // one-off transfers, but stay `type: 'recurring'` rows -- they keep
            // the override/cleared controls (#434's paid sync writes per-leg
            // overrides) and the ↗ link back to the Recurring page.
            const isRecurringTransfer = tx.type === 'recurring' && tx.sourceId
                && (app.recurringTemplates || []).some(r => r.id === tx.sourceId && r.type === 'transfer' && r.targetAccountId);
            const nameCell = isReconciliation && tx.meta
                ? `🔄 ${escapeHtml(tx.name || '')} <span class="text-muted-secondary">(${formatCurrency(tx.meta.previousBalance)} → ${formatCurrency(tx.meta.statementBalance)})</span>${reconInfoIcon}`
                : isTransfer
                    ? `⇄ ${escapeHtml(tx.name || '')}`
                    : `${isRecurringTransfer ? '⇄ ' : ''}${escapeHtml(tx.name || '')}${txPersonPill ? `<br>${txPersonPill}` : ''}${navIcon}`;
            const transferActions = isTransfer
                ? `<div class="ledger-override-actions"><button class="ledger-override-btn" data-ledger-transfer-edit="${tx.sourceId}" aria-label="${escapeHtml(t('ledger.editTransferAria', { name: tx.name || '' }))}">${escapeHtml(t('common.edit'))}</button><button class="ledger-override-clear-btn" data-ledger-transfer-delete="${tx.sourceId}" aria-label="${escapeHtml(t('ledger.deleteTransferAria', { name: tx.name || '' }))}">${escapeHtml(t('common.delete'))}</button></div>`
                : '';
            const overrideKeys = isVariableIncome && !tx.hasOverride ? null
                : isVariableIncome && tx.hasOverride ? { text: 'ledger.editActual', aria: 'ledger.editActualAria' }
                : tx.hasOverride ? { text: 'ledger.editOverride', aria: 'ledger.editOverrideAria' }
                : { text: 'ledger.override', aria: 'ledger.overrideAria' };
            const txName = tx.name || '';
            const overrideActions = canOverride
                ? `<div class="ledger-override-actions">${overrideKeys === null ? `<button class="ledger-override-btn ledger-enter-actual-btn" data-ledger-override="${escapeHtml(tx.transactionId)}" aria-label="${escapeHtml(t('ledger.enterActualAria', { name: txName }))}">${escapeHtml(t('ledger.enterActual'))}</button>` : `<button class="ledger-override-btn" data-ledger-override="${escapeHtml(tx.transactionId)}" aria-label="${escapeHtml(t(overrideKeys.aria, { name: txName }))}">${escapeHtml(t(overrideKeys.text))}</button>`}${tx.hasOverride ? `<button class="ledger-override-clear-btn" data-ledger-clear-override="${escapeHtml(tx.transactionId)}" aria-label="${escapeHtml(t('ledger.resetAria', { name: txName }))}">${escapeHtml(t('ledger.reset'))}</button>` : ''}</div>`
                : '';
            const clearedCell = canClear
                ? `<input type="checkbox" class="ledger-cleared-checkbox" data-ledger-cleared="${escapeHtml(tx.transactionId)}"${tx.cleared ? ' checked' : ''}${tx.clearedAt ? ` title="${escapeHtml(t('ledger.clearedTitle', { date: new Date(tx.clearedAt).toLocaleString(getIntlLocale()) }))}"` : ''} aria-label="${escapeHtml(t('ledger.markClearedAria', { name: tx.name || t('ledger.transactionFallback') }))}">`
                : '';
            const selectCell = canClear
                ? `<input type="checkbox" class="ledger-row-select" data-ledger-select="${escapeHtml(tx.transactionId)}" aria-label="${escapeHtml(t('ledger.selectRowAria', { name: tx.name || t('ledger.transactionFallback') }))}">`
                : '';
            html += `<tr${isReconciliation ? ' class="ledger-row--reconciliation"' : ''}>
                <td data-col="select" class="ledger-select-col${hiddenCols.has('cleared') ? ' ledger-col-hidden' : ''}">${selectCell}</td>
                <td data-col="date"${ch('date')}>${tx.date ? formatShortDate(tx.date) : ''}</td>
                <td data-col="account"${ch('account')}>${escapeHtml(tx.account || '')}</td>
                <td data-col="name"${ch('name')}>${nameCell}</td>
                <td data-col="amount" class="text-right ${amountColorClass}"${ch('amount')}>${amountCell}${overrideActions}${transferActions}</td>
                <td data-col="balance" class="text-right"${ch('balance')}>${formatCurrency(tx.balance)}</td>
                <td data-col="cleared" class="text-center"${ch('cleared')}>${clearedCell}</td>
            </tr>`;
        }
    }
    html += `</tbody></table></div>`;
    html += `<div class="ledger-pagination">
        <div class="ledger-page-summary">${escapeHtml(t('ledger.showingRange', { start: startItem, end: endItem, total: totalRows }))}</div>
        <div class="ledger-page-controls">
            <button id="ledgerPrevPage" class="ledger-page-btn" ${currentPage <= 1 ? 'disabled' : ''}>${escapeHtml(t('ledger.prevPage'))}</button>
            <span class="ledger-page-info">${escapeHtml(t('ledger.pageInfo', { page: currentPage, pages: totalPages }))}</span>
            <button id="ledgerNextPage" class="ledger-page-btn" ${currentPage >= totalPages ? 'disabled' : ''}>${escapeHtml(t('ledger.nextPage'))}</button>
        </div>
    </div>`;
    container.innerHTML = html;
    const table = container.querySelector('.ledger-table');
    if (table) {
        table.querySelectorAll('th[data-key]').forEach(th => {
            th.classList.add('cursor-pointer');
            th.onkeydown = e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); th.click(); }
            };
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
    const crossNavBackBtn = container.querySelector('#ledgerCrossNavBackBtn');
    if (crossNavBackBtn) {
        crossNavBackBtn.onclick = () => {
            app._ledgerCategoryFilter = 'all';
            // switchPage() restores the pre-cross-nav account/date filters
            // and clears _ledgerCrossNavLabel — see ui.js.
            app.switchPage('reports');
            document.querySelector('.rpt-tab-btn[data-rptab="spending"]')?.click();
        };
    }
    const acctFilter = container.querySelector('#ledgerAccountFilter');
    if (acctFilter) {
        acctFilter.onchange = (e) => {
            app._ledgerAccountFilter = e.target.value;
            app._ledgerPage = 1;
            persistLedgerFilters(app);
            renderLedgerPage(app);
        };
    }
    const categoryFilterEl = container.querySelector('#ledgerCategoryFilter');
    if (categoryFilterEl) {
        categoryFilterEl.onchange = (e) => {
            app._ledgerCategoryFilter = e.target.value;
            app._ledgerPage = 1;
            persistLedgerFilters(app);
            renderLedgerPage(app);
        };
    }
    const dateRangeFilter = container.querySelector('#ledgerDateRange');
    if (dateRangeFilter) {
        dateRangeFilter.onchange = (e) => {
            app._ledgerDateRange = e.target.value;
            app._ledgerPage = 1;
            persistLedgerFilters(app);
            renderLedgerPage(app);
        };
    }
    const pageSizeFilter = container.querySelector('#ledgerPageSize');
    if (pageSizeFilter) {
        pageSizeFilter.onchange = (e) => {
            const pageSize = parseInt(e.target.value, 10);
            app._ledgerPageSize = [10, 25, 50, 100].includes(pageSize) ? pageSize : 25;
            app._ledgerPage = 1;
            persistLedgerFilters(app);
            renderLedgerPage(app);
        };
    }
    const clearedFilterEl = container.querySelector('#ledgerClearedFilter');
    if (clearedFilterEl) {
        clearedFilterEl.onchange = (e) => {
            app._ledgerClearedFilter = e.target.value;
            app._ledgerPage = 1;
            persistLedgerFilters(app);
            renderLedgerPage(app);
        };
    }
    const clearFiltersBtn = container.querySelector('#ledgerClearFiltersBtn');
    if (clearFiltersBtn) {
        clearFiltersBtn.onclick = () => {
            app._ledgerAccountFilter = 'all';
            app._ledgerDateRange = 'around7';
            app._ledgerClearedFilter = 'all';
            app._ledgerCategoryFilter = 'all';
            app._ledgerPage = 1;
            localStorage.removeItem('debtTrackerLedgerFilters');
            app._ledgerFiltersRestored = false;
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

    container.querySelectorAll('[data-ledger-edit-icon]').forEach(icon => {
        icon.onclick = () => {
            const txId = icon.getAttribute('data-ledger-edit-icon');
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

    container.querySelectorAll('[data-ledger-transfer-edit]').forEach(btn => {
        btn.onclick = () => {
            const id = parseInt(btn.getAttribute('data-ledger-transfer-edit'), 10);
            if (typeof app.openTransferModal === 'function') app.openTransferModal({ editId: id });
        };
    });
    container.querySelectorAll('[data-ledger-transfer-delete]').forEach(btn => {
        btn.onclick = async () => {
            const id = parseInt(btn.getAttribute('data-ledger-transfer-delete'), 10);
            if (typeof app.deleteTransfer === 'function') await app.deleteTransfer(id);
        };
    });

    container.querySelectorAll('[data-ledger-nav-type]').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const type = btn.dataset.ledgerNavType;
            const sourceId = parseInt(btn.dataset.ledgerNavId, 10);
            const pageMap = { debt: 'liabilities', income: 'income', recurring: 'recurring' };
            const cardIdMap = { debt: `debt-card-${sourceId}`, income: `income-card-${sourceId}`, recurring: `recurring-card-${sourceId}` };
            if (!pageMap[type]) return;
            app.switchPage(pageMap[type]);
            setTimeout(() => {
                const el = document.getElementById(cardIdMap[type]);
                if (!el) return;
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('ledger-nav-highlight');
                setTimeout(() => el.classList.remove('ledger-nav-highlight'), 2000);
            }, 150);
        };
    });

    container.querySelectorAll('[data-ledger-cleared]').forEach(checkbox => {
        checkbox.onchange = () => {
            const txId = checkbox.getAttribute('data-ledger-cleared');
            setLedgerCleared(app, txId, checkbox.checked);
            app.syncRecurringPaidFromLedger([txId]);
            app.saveToStorage();
            renderLedgerPage(app);
        };
    });

    // Bulk selection
    const bulkBar = container.querySelector('#ledgerBulkBar');
    const bulkCount = container.querySelector('#ledgerBulkCount');
    const selectAll = container.querySelector('#ledgerSelectAll');

    function _updateBulkBar() {
        const checked = container.querySelectorAll('.ledger-row-select:checked');
        const n = checked.length;
        if (bulkBar) bulkBar.classList.toggle('ledger-bulk-bar--visible', n > 0);
        if (bulkCount) bulkCount.textContent = n > 0 ? plural('ledger.rowsSelected', n) : '';
        if (selectAll) {
            const all = container.querySelectorAll('.ledger-row-select');
            selectAll.indeterminate = n > 0 && n < all.length;
            selectAll.checked = all.length > 0 && n === all.length;
        }
    }

    if (selectAll) {
        selectAll.onchange = () => {
            container.querySelectorAll('.ledger-row-select').forEach(cb => { cb.checked = selectAll.checked; });
            _updateBulkBar();
        };
    }

    container.querySelectorAll('.ledger-row-select').forEach(cb => {
        cb.onchange = _updateBulkBar;
    });

    const bulkClearBtn = container.querySelector('#ledgerBulkClearBtn');
    if (bulkClearBtn) {
        bulkClearBtn.onclick = () => {
            const ids = [...container.querySelectorAll('.ledger-row-select:checked')].map(cb => cb.getAttribute('data-ledger-select'));
            ids.forEach(txId => setLedgerCleared(app, txId, true));
            app.syncRecurringPaidFromLedger(ids);
            app.saveToStorage();
            renderLedgerPage(app);
        };
    }

    const bulkUnclearBtn = container.querySelector('#ledgerBulkUnclearBtn');
    if (bulkUnclearBtn) {
        bulkUnclearBtn.onclick = () => {
            const ids = [...container.querySelectorAll('.ledger-row-select:checked')].map(cb => cb.getAttribute('data-ledger-select'));
            ids.forEach(txId => setLedgerCleared(app, txId, false));
            app.syncRecurringPaidFromLedger(ids);
            app.saveToStorage();
            renderLedgerPage(app);
        };
    }

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

    const transferBtn = container.querySelector('#ledgerTransferBtn');
    if (transferBtn) {
        transferBtn.onclick = () => {
            if (typeof app.openTransferModal === 'function') {
                app.openTransferModal(selectedAccount !== 'all' ? { fromAccountId: parseInt(selectedAccount, 10) } : {});
            }
        };
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
            // Select column mirrors the cleared column's visibility
            const selectColHidden = newHidden.has('cleared');
            container.querySelectorAll('[data-col="select"]').forEach(el => {
                el.classList.toggle('ledger-col-hidden', selectColHidden);
            });
            if (bulkBar) bulkBar.classList.toggle('ledger-bulk-bar--hidden', selectColHidden);
        };
    }
    // --- End: renderLedgerPage logic ---
}
