// Account management

import { formatCurrency, normalizeText, sanitizeFiniteNumber, escapeHtml } from './utils.js';
import { getLedgerTransactionsForMonth } from './ledger.js';

export function refreshAccountSelectors(app) {
    const selIds = ['incomeAccount','bonusAccount','billAccount','expenseAccount','debtAccount'];
    // opts must already be fully escaped HTML before reaching el.innerHTML below —
    // account name/type are wrapped in escapeHtml() here, not at the assignment site.
    const opts = [
        `<option value="">— No account —</option>`,
        ...app.accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)} (${escapeHtml(a.type)})</option>`)
    ].join('');
    for (const id of selIds) {
        const el = document.getElementById(id);
        if (!el) continue;
        const prev = el.value;
        el.innerHTML = opts;
        if (app.accounts.find(a => String(a.id) === prev)) el.value = prev;
    }
}

export function computeAccountBalance(app, accountId, year = null, month = null) {
    const acct = app.accounts.find(a => a.id === accountId);
    if (!acct) return 0;
    let balance = Number(acct.startingBalance) || 0;

    const now = new Date();
    const yr = year !== null ? year : now.getFullYear();
    const mo = month !== null ? month : now.getMonth();
    const monthTxs = getLedgerTransactionsForMonth(app, yr, mo, accountId);

    for (const tx of monthTxs) {
        balance += Number(tx.amount) || 0;
    }

    return balance;
}

export function renderAccountsList(app) {
    const container = document.getElementById('accountList');
    if (!container) return;

    if (!app.accounts || app.accounts.length === 0) {
        container.innerHTML = `<p class="acct-empty-msg">No accounts yet. Add your first account above to start tracking cash flow per account.</p>`;
        return;
    }

    const ACCT_TYPES = ['Checking','Savings','Cash','Investment','Credit Card','Loan','Other'];
    const typeIcon = { Checking:'🏦', Savings:'💰', Cash:'💵', Investment:'📈', 'Credit Card':'💳', Loan:'🏠', Other:'🗂️' };

    const now = new Date();
    const monthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const cards = app.accounts.map(a => {
        if (app.editingAccountId === a.id) {
            return `<div class="acct-card acct-card--editing">
                <div class="acct-edit-grid">
                    <div class="form-group form-no-margin">
                        <label class="label-compact">Name</label>
                        <input type="text" id="ac-name-${a.id}" value="${escapeHtml(a.name)}" class="form-full-width">
                    </div>
                    <div class="form-group form-no-margin">
                        <label class="label-compact">Type</label>
                        <select id="ac-type-${a.id}" class="form-full-width">
                            ${ACCT_TYPES.map(t => `<option value="${t}" ${a.type===t?'selected':''}>${t}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group form-no-margin">
                        <label class="label-compact">Starting Balance ($)</label>
                        <input type="number" id="ac-bal-${a.id}" value="${a.startingBalance}" step="0.01" class="form-full-width">
                    </div>
                </div>
                <div class="acct-edit-actions">
                    <button class="btn btn-primary btn-small" data-account-action="save" data-account-id="${a.id}">Save</button>
                    <button class="btn btn-secondary btn-small" data-account-action="cancel">Cancel</button>
                </div>
            </div>`;
        }

        const projBalance = app.computeAccountBalance(a.id);
        const balClass = projBalance >= 0 ? 'acct-balance--pos' : 'acct-balance--neg';

        // Items linked to this account
        const linkedIncome  = app.incomes.filter(i => i.accountId === a.id);
        const linkedBonuses = app.bonuses.filter(b => b.accountId === a.id);
        const linkedDebts   = app.debts.filter(d => d.accountId === a.id);
        const linkedBills   = app.bills.filter(b => b.accountId === a.id);
        const linkedExp     = app.expenses.filter(e => e.accountId === a.id);
        const hasLinks = linkedIncome.length || linkedBonuses.length || linkedDebts.length || linkedBills.length || linkedExp.length;

        const linkRows = !hasLinks ? '' : `
            <div class="acct-links">
                ${linkedIncome.map(i  => `<span class="acct-link acct-link--income">💰 ${escapeHtml(i.name)}</span>`).join('')}
                ${linkedBonuses.map(b => `<span class="acct-link acct-link--bonus">🎁 ${escapeHtml(b.name)}</span>`).join('')}
                ${linkedDebts.map(d   => `<span class="acct-link acct-link--debt">💳 ${escapeHtml(d.name)}</span>`).join('')}
                ${linkedBills.map(b   => `<span class="acct-link acct-link--bill">🧾 ${escapeHtml(b.name)}</span>`).join('')}
                ${linkedExp.map(e     => `<span class="acct-link acct-link--exp">💸 ${escapeHtml(e.name)}</span>`).join('')}
            </div>`;

        return `<div class="acct-card">
            <div class="acct-card-header">
                <span class="acct-type-icon">${typeIcon[a.type] || '🗂️'}</span>
                <div class="acct-card-info">
                    <span class="acct-card-name">${escapeHtml(a.name)}</span>
                    <span class="acct-type-badge">${escapeHtml(a.type)}</span>
                </div>
                <div class="acct-balances">
                    <div class="acct-balance-item">
                        <span class="acct-balance-label">Starting</span>
                        <span class="acct-balance-value">${formatCurrency(a.startingBalance)}</span>
                    </div>
                    <div class="acct-balance-item">
                        <span class="acct-balance-label">Proj. (${monthLabel})</span>
                        <span class="acct-balance-value ${balClass}">${formatCurrency(projBalance)}</span>
                    </div>
                </div>
                <div class="debt-actions">
                    <button class="btn-edit" data-account-action="edit" data-account-id="${a.id}">Edit</button>
                    <button class="btn btn-danger btn-small" data-account-action="delete" data-account-id="${a.id}">Delete</button>
                </div>
            </div>
            ${linkRows}
        </div>`;
    }).join('');

    container.innerHTML = cards;
    container.onclick = (event) => {
        const actionEl = event.target.closest('[data-account-action]');
        if (!actionEl) return;
        const action = actionEl.getAttribute('data-account-action');
        const id = parseInt(actionEl.getAttribute('data-account-id'), 10);
        if (action === 'cancel') {
            app.cancelEditAccount();
            return;
        }
        if (Number.isNaN(id)) return;
        if (action === 'save') app.saveEditAccount(id);
        if (action === 'edit') app.startEditAccount(id);
        if (action === 'delete') app.deleteAccount(id);
    };
}

export function addAccount(app) {
    const name = normalizeText(document.getElementById('accountName').value, 80);
    const type = normalizeText(document.getElementById('accountType').value, 30);
    const startingBalance = sanitizeFiniteNumber(document.getElementById('accountStartingBalance').value, NaN);

    if (!name) { alert('Please enter an account name.'); return; }
    if (isNaN(startingBalance)) { alert('Please enter a starting balance (use 0 if unknown).'); return; }

    app.accounts.push({ id: Date.now(), name, type, startingBalance });
    app.saveToStorage();
    app.renderAccountsList();
    app.renderNetWorthWidget();
    refreshAccountSelectors(app);
    document.getElementById('accountForm').reset();
}

export function deleteAccount(app, id) {
    app.accounts = app.accounts.filter(a => a.id !== id);
    app.saveToStorage();
    app.renderAccountsList();
    app.renderNetWorthWidget();
    refreshAccountSelectors(app);
}

export function startEditAccount(app, id) {
    app.editingAccountId = id;
    app.renderAccountsList();
    setTimeout(() => { const el = document.getElementById(`ac-name-${id}`); if (el) el.focus(); }, 0);
}

export function cancelEditAccount(app) {
    app.editingAccountId = null;
    app.renderAccountsList();
}

export function saveEditAccount(app, id) {
    const idx = app.accounts.findIndex(a => a.id === id);
    if (idx === -1) return;
    const name = normalizeText(document.getElementById(`ac-name-${id}`)?.value, 80);
    const type = normalizeText(document.getElementById(`ac-type-${id}`)?.value, 30);
    const startingBalance = sanitizeFiniteNumber(document.getElementById(`ac-bal-${id}`)?.value, NaN);
    if (!name) { alert('Please enter an account name.'); return; }
    if (isNaN(startingBalance)) { alert('Please enter a valid starting balance.'); return; }
    app.accounts[idx] = { ...app.accounts[idx], name, type, startingBalance };
    app.editingAccountId = null;
    app.saveToStorage();
    app.renderAccountsList();
    app.renderNetWorthWidget();
    refreshAccountSelectors(app);
}
