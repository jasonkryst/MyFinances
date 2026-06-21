// Account reconciliation: compare tracked balances against statement balances,
// log adjustments, and surface expected transactions since the last reconciliation.

import { formatCurrency, normalizeText, sanitizeFiniteNumber, sanitizeDateISO, escapeHtml, todayISO } from './utils.js';
import { getLedgerTransactionsForMonth, renderLedgerPage } from './ledger.js';
import { getSetting, RECONCILIATION_ADJUSTS_BALANCE } from './settings.js';

const TYPE_ICON = { Checking: '🏦', Savings: '💰', Cash: '💵', Investment: '📈', 'Credit Card': '💳', Loan: '🏠', Other: '🗂️' };

function _formatDate(dateStr) {
    const d = new Date(`${dateStr}T12:00:00`);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

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

export function applyReconciliation(app, accountId, statementBalance, note, date) {
    const balance = sanitizeFiniteNumber(statementBalance, NaN);
    if (!Number.isFinite(balance)) {
        alert('Please enter a valid statement balance.');
        return { success: false };
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
        date: sanitizeDateISO(date) || todayISO(),
        previousBalance,
        statementBalance: balance,
        difference: balance - previousBalance,
        note: normalizeText(note, 200),
        createdAt: new Date().toISOString()
    };
    app.reconciliations.push(entry);

    app.saveToStorage();
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
    const dateInput = document.getElementById(`recon-date-${accountId}`);
    const noteInput = document.getElementById(`recon-note-${accountId}`);

    return applyReconciliation(
        app,
        accountId,
        balanceInput ? balanceInput.value : NaN,
        noteInput ? noteInput.value : '',
        dateInput ? dateInput.value : ''
    );
}

export function deleteReconciliationEntry(app, id) {
    app.reconciliations = (app.reconciliations || []).filter(r => r.id !== id);
    app.saveToStorage();
    if (typeof app.renderReconciliationPage === 'function') app.renderReconciliationPage();
}

function getLastReconciliationDate(app, accountId) {
    const entries = (app.reconciliations || []).filter(r => r.accountId === accountId);
    if (entries.length === 0) {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    }
    entries.sort((a, b) => new Date(b.date) - new Date(a.date));
    return entries[0].date;
}

function renderReconcileCard(app, acct) {
    const today = todayISO();
    const lastDate = getLastReconciliationDate(app, acct.id);
    const expected = getExpectedTransactionsInRange(app, acct.id, lastDate, today);
    const expectedHtml = expected.length === 0
        ? `<p class="recon-expected-empty">No expected transactions in this period.</p>`
        : `<table class="recon-expected-table"><thead><tr><th>Date</th><th>Name</th><th>Amount</th><th>Category</th></tr></thead><tbody>${
            expected.map(tx => `<tr><td>${_formatDate(tx.date.slice(0, 10))}</td><td>${escapeHtml(tx.name)}</td><td>${formatCurrency(tx.amount)}</td><td>${escapeHtml(tx.category || '')}</td></tr>`).join('')
        }</tbody></table>`;

    return `<div class="recon-card">
        <div class="recon-card-header">
            <span class="acct-type-icon">${TYPE_ICON[acct.type] || '🗂️'}</span>
            <div class="recon-card-info">
                <span class="acct-card-name">${escapeHtml(acct.name)}</span>
                <span class="recon-current-balance">Current Tracked Balance: ${formatCurrency(acct.startingBalance)}</span>
            </div>
        </div>
        <div class="recon-form-grid">
            <div class="form-group form-no-margin">
                <label for="recon-date-${acct.id}" class="label-compact">Statement Date</label>
                <input type="date" id="recon-date-${acct.id}" value="${today}" class="form-full-width">
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
        <div class="recon-diff-row">
            <span class="recon-diff-label">Difference:</span>
            <span id="recon-diff-${acct.id}" class="recon-diff--zero">${formatCurrency(0)}</span>
        </div>
        <button class="btn btn-primary" data-recon-action="reconcile" data-recon-id="${acct.id}">Reconcile</button>
        <details class="recon-expected">
            <summary>Expected transactions since ${_formatDate(lastDate)}</summary>
            ${expectedHtml}
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
            ${(app.accounts || []).map(a => `<option value="${a.id}"${String(filter) === String(a.id) ? ' selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
        </select>
    </div>`;

    let rowsHtml;
    if (entries.length === 0) {
        rowsHtml = `<tr><td colspan="5" class="text-center text-muted-secondary p-32">No reconciliation history yet.</td></tr>`;
    } else {
        rowsHtml = entries.map(entry => {
            const account = (app.accounts || []).find(a => a.id === entry.accountId);
            const accountName = account ? escapeHtml(account.name) : 'Unknown account';
            return `<tr>
                <td>${_formatDate(entry.date)}</td>
                <td>${accountName}</td>
                <td><span class="recon-badge">🔄 Balance Reconciliation</span>${entry.note ? ` ${escapeHtml(entry.note)}` : ''}</td>
                <td class="${_diffClass(entry.difference)}">${formatCurrency(entry.previousBalance)} → ${formatCurrency(entry.statementBalance)} (${formatCurrency(entry.difference)})</td>
                <td><button class="btn btn-danger btn-small" data-recon-action="delete-history" data-recon-history-id="${entry.id}">Delete</button></td>
            </tr>`;
        }).join('');
    }

    return `<h3>History</h3>${filterHtml}
        <table class="recon-history-table ledger-table">
            <thead><tr><th>Date</th><th>Account</th><th>Event</th><th>Previous → Statement</th><th></th></tr></thead>
            <tbody>${rowsHtml}</tbody>
        </table>`;
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

    if (!app.accounts || app.accounts.length === 0) {
        section.innerHTML = `<h2>🔄 Reconcile</h2><p class="acct-empty-msg">No accounts yet. Add an account first to reconcile its balance.</p>`;
        return;
    }

    const cardsHtml = app.accounts.map(acct => renderReconcileCard(app, acct)).join('');
    const historyHtml = renderReconciliationHistory(app);

    section.innerHTML = `<h2>🔄 Reconcile</h2>${cardsHtml}${historyHtml}`;

    for (const acct of app.accounts) {
        attachReconcileCardEvents(app, acct.id);
    }
    attachReconciliationHistoryEvents(app, section);
}

export function openReconcileModal(app, accountId) {
    const modal = document.getElementById('reconcileModal');
    const account = (app.accounts || []).find(a => a.id === accountId);
    if (!modal || !account) return;

    const currentEl = document.getElementById('reconcileModalCurrent');
    const dateInput = document.getElementById('reconcileModalDate');
    const balanceInput = document.getElementById('reconcileModalBalance');
    const noteInput = document.getElementById('reconcileModalNote');
    const confirmBtn = document.getElementById('reconcileModalConfirmBtn');
    const cancelBtn = document.getElementById('reconcileModalCancelBtn');
    const closeBtn = document.getElementById('reconcileModalCloseBtn');

    if (!currentEl || !dateInput || !balanceInput || !noteInput || !confirmBtn || !cancelBtn || !closeBtn) {
        return;
    }

    currentEl.textContent = formatCurrency(account.startingBalance);
    dateInput.value = todayISO();
    balanceInput.value = account.startingBalance;
    noteInput.value = '';

    const close = () => {
        modal.classList.add('hidden'); modal.classList.remove('flex-visible');
        modal.onkeydown = null;
    };

    confirmBtn.onclick = () => {
        const result = applyReconciliation(app, accountId, balanceInput.value, noteInput.value, dateInput.value);
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
        if (event.key === 'Enter') {
            event.preventDefault();
            confirmBtn.click();
        }
    };

    modal.classList.add('flex-visible'); modal.classList.remove('hidden');
    setTimeout(() => balanceInput.focus(), 30);
}
