// Account reconciliation: compare tracked balances against statement balances,
// log adjustments, and surface expected transactions since the last reconciliation.

import { formatCurrency, normalizeText, sanitizeFiniteNumber, sanitizeDateISO, escapeHtml, todayISO, formatShortDate, dateToISO } from './utils.js';
import { getLedgerTransactionsForMonth } from './ledgerTransactions.js';
import { renderLedgerPage } from './ledger.js';
import { getSetting, RECONCILIATION_ADJUSTS_BALANCE } from './settings.js';
import { ACCOUNT_TYPE_ICONS } from './accounts.js';
import { pgPost, pgPatch, pgDelete } from './postgresSync.js';
import { showAlertModal } from './ui.js';

function _diffClass(diff) {
    if (diff > 0) return 'recon-diff--pos';
    if (diff < 0) return 'recon-diff--neg';
    return 'recon-diff--zero';
}

export function getExpectedTransactionsInRange(app, accountId, startDate, endDate) {
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T23:59:59`);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return [];

    const results = [];
    let year = start.getFullYear();
    let month = start.getMonth();
    const endYear = end.getFullYear();
    const endMonth = end.getMonth();

    while (year < endYear || (year === endYear && month <= endMonth)) {
        const monthTxs = getLedgerTransactionsForMonth(app, year, month, accountId);
        for (const tx of monthTxs) {
            if (tx.type === 'reconciliation') continue;
            const txDate = new Date(tx.date);
            if (txDate >= start && txDate <= end) {
                results.push(tx);
            }
        }
        month++;
        if (month > 11) {
            month = 0;
            year++;
        }
    }

    results.sort((a, b) => new Date(a.date) - new Date(b.date));
    return results;
}

// Returns '' for a valid statement range, otherwise a user-facing error message.
export function validateStatementRange(startDate, endDate) {
    const start = sanitizeDateISO(startDate);
    const end = sanitizeDateISO(endDate);
    if (!start || !end) return 'Please enter valid statement start and end dates.';
    if (end < start) return 'Statement end date must not be before the start date.';
    return '';
}

// Default statement range: the day after the account's most recent reconciliation
// (or the 1st of the current month if none) through today, never inverted.
export function getDefaultStatementRange(app, accountId) {
    const end = todayISO();
    const lastDate = (app.reconciliations || [])
        .filter(r => r.accountId === accountId)
        .reduce((latest, r) => (r.date > latest ? r.date : latest), '');
    let start = `${end.slice(0, 8)}01`;
    if (lastDate) {
        const next = new Date(`${lastDate}T12:00:00`);
        next.setDate(next.getDate() + 1);
        start = dateToISO(next);
    }
    return { start: start > end ? end : start, end };
}

function renderExpectedTransactionsHtml(expected) {
    return expected.length === 0
        ? `<p class="recon-expected-empty">No expected transactions in this period.</p>`
        : `<div class="recon-table-wrap"><table class="recon-expected-table"><thead><tr><th>Date</th><th>Name</th><th>Amount</th><th>Category</th></tr></thead><tbody>${
            expected.map(tx => `<tr><td>${formatShortDate(tx.date.slice(0, 10))}</td><td>${escapeHtml(tx.name)}</td><td>${formatCurrency(tx.amount)}</td><td>${escapeHtml(tx.category || '')}</td></tr>`).join('')
        }</tbody></table></div>`;
}

function expectedSummaryText(start, end) {
    return `Expected transactions ${formatShortDate(start)} – ${formatShortDate(end)}`;
}

// Wires a start/end date pair to live validation and the expected-transactions
// preview. Returns the refresh function so callers can run it once up front.
function bindStatementRange(app, accountId, { startInput, endInput, errorEl, submitBtn, summaryEl, bodyEl }) {
    const refresh = () => {
        const error = validateStatementRange(startInput.value, endInput.value);
        errorEl.textContent = error;
        errorEl.classList.toggle('hidden', !error);
        submitBtn.disabled = Boolean(error);
        if (error) return;
        if (summaryEl) summaryEl.textContent = expectedSummaryText(startInput.value, endInput.value);
        if (bodyEl) bodyEl.innerHTML = renderExpectedTransactionsHtml(getExpectedTransactionsInRange(app, accountId, startInput.value, endInput.value));
    };
    startInput.oninput = refresh;
    endInput.oninput = refresh;
    return refresh;
}

// `dates` is { statementStartDate, statementEndDate } (issue #275). A plain date
// string is still accepted for older callers: it is treated as the statement end
// date with no known start.
export async function applyReconciliation(app, accountId, statementBalance, note, dates) {
    const balance = sanitizeFiniteNumber(statementBalance, NaN);
    if (!Number.isFinite(balance)) {
        await showAlertModal('Please enter a valid statement balance.');
        return { success: false };
    }

    let statementStartDate = null;
    let statementEndDate;
    if (dates && typeof dates === 'object') {
        const error = validateStatementRange(dates.statementStartDate, dates.statementEndDate);
        if (error) {
            await showAlertModal(error);
            return { success: false, error };
        }
        statementStartDate = sanitizeDateISO(dates.statementStartDate);
        statementEndDate = sanitizeDateISO(dates.statementEndDate);
    } else {
        statementEndDate = sanitizeDateISO(dates) || todayISO();
    }

    const account = (app.accounts || []).find(a => a.id === accountId);
    if (!account) return { success: false };

    const previousBalance = account.startingBalance;
    const adjustsBalance = getSetting(app, RECONCILIATION_ADJUSTS_BALANCE, false);
    if (adjustsBalance) {
        account.startingBalance = balance;
    }

    const entry = {
        id: Date.now(),
        accountId,
        date: statementEndDate,
        statementStartDate,
        statementEndDate,
        previousBalance,
        statementBalance: balance,
        difference: balance - previousBalance,
        note: normalizeText(note, 200),
        createdAt: new Date().toISOString()
    };
    app.reconciliations.push(entry);

    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') {
        const saved = await pgPost(app, '/api/reconciliations', entry);
        if (saved?.id) entry.id = saved.id;
        if (adjustsBalance) pgPatch(app, `/api/accounts/${accountId}`, account);
    }
    if (typeof app.renderReconciliationPage === 'function') app.renderReconciliationPage();
    if (typeof app.renderAccountsList === 'function') app.renderAccountsList();
    if (typeof app.renderNetWorthWidget === 'function') app.renderNetWorthWidget();

    const ledgerSection = document.getElementById('ledgerSection');
    if (ledgerSection && ledgerSection.classList.contains('active')) {
        renderLedgerPage(app);
    }

    return { success: true, balance: account.startingBalance, entry };
}

export function reconcileAccount(app, accountId) {
    const balanceInput = document.getElementById(`recon-balance-${accountId}`);
    const startInput = document.getElementById(`recon-start-${accountId}`);
    const endInput = document.getElementById(`recon-end-${accountId}`);
    const noteInput = document.getElementById(`recon-note-${accountId}`);

    return applyReconciliation(
        app,
        accountId,
        balanceInput ? balanceInput.value : NaN,
        noteInput ? noteInput.value : '',
        {
            statementStartDate: startInput ? startInput.value : '',
            statementEndDate: endInput ? endInput.value : ''
        }
    );
}

export function deleteReconciliationEntry(app, id) {
    app.reconciliations = (app.reconciliations || []).filter(r => r.id !== id);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/reconciliations/${id}`);
    if (typeof app.renderReconciliationPage === 'function') app.renderReconciliationPage();
}

function renderReconcileCard(app, acct) {
    const { start, end } = getDefaultStatementRange(app, acct.id);
    const expected = getExpectedTransactionsInRange(app, acct.id, start, end);

    return `<div class="recon-card">
        <div class="recon-card-header">
            <span class="acct-type-icon">${ACCOUNT_TYPE_ICONS[acct.type] || '🗂️'}</span>
            <div class="recon-card-info">
                <span class="acct-card-name">${escapeHtml(acct.name)}</span>
                <span class="recon-current-balance">Current Tracked Balance: ${formatCurrency(acct.startingBalance)}</span>
            </div>
        </div>
        <div class="recon-form-grid">
            <div class="form-group form-no-margin">
                <label for="recon-start-${acct.id}" class="label-compact">Statement Start Date</label>
                <input type="date" id="recon-start-${acct.id}" value="${start}" class="form-full-width">
            </div>
            <div class="form-group form-no-margin">
                <label for="recon-end-${acct.id}" class="label-compact">Statement End Date</label>
                <input type="date" id="recon-end-${acct.id}" value="${end}" class="form-full-width">
            </div>
            <div class="form-group form-no-margin">
                <label for="recon-balance-${acct.id}" class="label-compact">Statement Balance ($)</label>
                <input type="number" id="recon-balance-${acct.id}" step="0.01" value="${acct.startingBalance}" class="form-full-width">
            </div>
            <div class="form-group form-no-margin">
                <label for="recon-note-${acct.id}" class="label-compact">Note (optional)</label>
                <input type="text" id="recon-note-${acct.id}" maxlength="200" class="form-full-width">
            </div>
        </div>
        <p id="recon-range-error-${acct.id}" class="recon-range-error hidden" role="alert"></p>
        <div class="recon-diff-row">
            <span class="recon-diff-label">Difference:</span>
            <span id="recon-diff-${acct.id}" class="recon-diff--zero">${formatCurrency(0)}</span>
        </div>
        <button class="btn btn-primary" data-recon-action="reconcile" data-recon-id="${acct.id}">Reconcile</button>
        <details class="recon-expected">
            <summary id="recon-expected-summary-${acct.id}">${expectedSummaryText(start, end)}</summary>
            <div id="recon-expected-body-${acct.id}">${renderExpectedTransactionsHtml(expected)}</div>
        </details>
    </div>`;
}

function attachReconcileCardEvents(app, accountId) {
    const balanceInput = document.getElementById(`recon-balance-${accountId}`);
    const diffEl = document.getElementById(`recon-diff-${accountId}`);
    const account = (app.accounts || []).find(a => a.id === accountId);

    if (balanceInput && diffEl && account) {
        balanceInput.oninput = () => {
            const value = sanitizeFiniteNumber(balanceInput.value, account.startingBalance);
            const diff = value - account.startingBalance;
            diffEl.textContent = formatCurrency(diff);
            diffEl.className = _diffClass(diff);
        };
    }

    const reconBtn = document.querySelector(`[data-recon-action="reconcile"][data-recon-id="${accountId}"]`);
    if (reconBtn) {
        reconBtn.onclick = () => reconcileAccount(app, accountId);
    }

    const startInput = document.getElementById(`recon-start-${accountId}`);
    const endInput = document.getElementById(`recon-end-${accountId}`);
    const errorEl = document.getElementById(`recon-range-error-${accountId}`);
    if (startInput && endInput && errorEl && reconBtn) {
        bindStatementRange(app, accountId, {
            startInput,
            endInput,
            errorEl,
            submitBtn: reconBtn,
            summaryEl: document.getElementById(`recon-expected-summary-${accountId}`),
            bodyEl: document.getElementById(`recon-expected-body-${accountId}`)
        });
    }
}

function renderReconciliationHistory(app) {
    const filter = app._reconciliationAccountFilter || 'all';
    let entries = [...(app.reconciliations || [])];
    if (filter !== 'all') {
        entries = entries.filter(r => String(r.accountId) === String(filter));
    }
    entries.sort((a, b) => new Date(b.date) - new Date(a.date));

    const filterHtml = `<div class="filter-controls">
        <label for="reconHistoryAccountFilter" class="filter-label">Account:</label>
        <select id="reconHistoryAccountFilter" class="select-styled">
            <option value="all"${filter === 'all' ? ' selected' : ''}>All Accounts</option>
            ${(app.accounts || []).map(a => `<option value="${a.id}"${String(filter) === String(a.id) ? ' selected' : ''}>${escapeHtml(a.name)} (${escapeHtml(a.type)})</option>`).join('')}
        </select>
    </div>`;

    let rowsHtml;
    if (entries.length === 0) {
        rowsHtml = `<tr><td colspan="5" class="text-center text-muted-secondary p-32">No reconciliation history yet.</td></tr>`;
    } else {
        rowsHtml = entries.map(entry => {
            const account = (app.accounts || []).find(a => a.id === entry.accountId);
            const accountName = account ? escapeHtml(account.name) : 'Unknown account';
            const periodHtml = entry.statementStartDate && entry.statementEndDate
                ? `<span class="recon-period">Statement: ${formatShortDate(entry.statementStartDate)} – ${formatShortDate(entry.statementEndDate)}</span>`
                : '';
            return `<tr>
                <td>${formatShortDate(entry.date)}</td>
                <td>${accountName}</td>
                <td><span class="recon-badge">🔄 Balance Reconciliation</span>${entry.note ? ` ${escapeHtml(entry.note)}` : ''}${periodHtml}</td>
                <td class="${_diffClass(entry.difference)}">${formatCurrency(entry.previousBalance)} → ${formatCurrency(entry.statementBalance)} (${formatCurrency(entry.difference)})</td>
                <td><button class="btn btn-danger btn-small" data-recon-action="delete-history" data-recon-history-id="${entry.id}">Delete</button></td>
            </tr>`;
        }).join('');
    }

    return `<h3>History</h3>${filterHtml}
        <div class="recon-table-wrap">
        <table class="recon-history-table ledger-table">
            <thead><tr><th>Date</th><th>Account</th><th>Event</th><th>Previous → Statement</th><th></th></tr></thead>
            <tbody>${rowsHtml}</tbody>
        </table>
        </div>`;
}

function attachReconciliationHistoryEvents(app, section) {
    const filterEl = section.querySelector('#reconHistoryAccountFilter');
    if (filterEl) {
        filterEl.onchange = (e) => {
            app._reconciliationAccountFilter = e.target.value;
            renderReconciliationPage(app);
        };
    }

    section.querySelectorAll('[data-recon-action="delete-history"]').forEach(btn => {
        btn.onclick = () => {
            const id = parseInt(btn.getAttribute('data-recon-history-id'), 10);
            deleteReconciliationEntry(app, id);
        };
    });
}

export function renderReconciliationPage(app) {
    const section = document.getElementById('reconcileSection');
    if (!section) return;

    const headerHtml = `<div class="page-header-row">
        <h2>🔄 Reconcile</h2>
        <button type="button" class="page-print-btn" id="reconcilePrintBtn" title="Print this page" aria-label="Print the Reconcile page">🖨️ Print</button>
    </div>`;

    if (!app.accounts || app.accounts.length === 0) {
        section.innerHTML = `${headerHtml}<p class="acct-empty-msg">No accounts yet. Add an account first to reconcile its balance.</p>`;
        attachReconcilePrintEvent();
        return;
    }

    const cardsHtml = app.accounts.map(acct => renderReconcileCard(app, acct)).join('');
    const historyHtml = renderReconciliationHistory(app);

    section.innerHTML = `${headerHtml}${cardsHtml}${historyHtml}`;

    for (const acct of app.accounts) {
        attachReconcileCardEvents(app, acct.id);
    }
    attachReconciliationHistoryEvents(app, section);
    attachReconcilePrintEvent();
}

function attachReconcilePrintEvent() {
    const reconcilePrintBtn = document.getElementById('reconcilePrintBtn');
    if (reconcilePrintBtn) {
        reconcilePrintBtn.addEventListener('click', () => window.print());
    }
}

export function openReconcileModal(app, accountId) {
    const modal = document.getElementById('reconcileModal');
    const account = (app.accounts || []).find(a => a.id === accountId);
    if (!modal || !account) return;

    const currentEl = document.getElementById('reconcileModalCurrent');
    const startInput = document.getElementById('reconcileModalStartDate');
    const endInput = document.getElementById('reconcileModalEndDate');
    const errorEl = document.getElementById('reconcileModalRangeError');
    const balanceInput = document.getElementById('reconcileModalBalance');
    const noteInput = document.getElementById('reconcileModalNote');
    const confirmBtn = document.getElementById('reconcileModalConfirmBtn');
    const cancelBtn = document.getElementById('reconcileModalCancelBtn');
    const closeBtn = document.getElementById('reconcileModalCloseBtn');

    if (!currentEl || !startInput || !endInput || !errorEl || !balanceInput || !noteInput || !confirmBtn || !cancelBtn || !closeBtn) {
        return;
    }

    currentEl.textContent = formatCurrency(account.startingBalance);
    const { start, end } = getDefaultStatementRange(app, accountId);
    startInput.value = start;
    endInput.value = end;
    balanceInput.value = account.startingBalance;
    noteInput.value = '';
    bindStatementRange(app, accountId, {
        startInput,
        endInput,
        errorEl,
        submitBtn: confirmBtn,
        summaryEl: document.getElementById('reconcileModalExpectedSummary'),
        bodyEl: document.getElementById('reconcileModalExpected')
    })();

    const lastFocused = document.activeElement;
    const close = () => {
        modal.classList.add('hidden'); modal.classList.remove('flex-visible');
        modal.onkeydown = null;
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    };

    confirmBtn.onclick = async () => {
        const result = await applyReconciliation(app, accountId, balanceInput.value, noteInput.value, {
            statementStartDate: startInput.value,
            statementEndDate: endInput.value
        });
        if (result.success) close();
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
        // Only fields confirm on Enter — buttons and the expected-transactions
        // <summary> keep their native Enter behavior (activate / toggle).
        if (event.key === 'Enter' && event.target.tagName === 'INPUT') {
            event.preventDefault();
            if (!confirmBtn.disabled) confirmBtn.click();
            return;
        }
        if (event.key === 'Tab') {
            const focusable = modal.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])');
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (!first || !last) return;
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    };

    modal.classList.add('flex-visible'); modal.classList.remove('hidden');
    setTimeout(() => balanceInput.focus(), 30);
}
