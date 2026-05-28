// Account management

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
                    <div class="form-group" style="margin:0">
                        <label style="font-size:0.8rem;font-weight:600">Name</label>
                        <input type="text" id="ac-name-${a.id}" value="${a.name.replace(/\"/g,'&quot;')}" style="width:100%">
                    </div>
                    <div class="form-group" style="margin:0">
                        <label style="font-size:0.8rem;font-weight:600">Type</label>
                        <select id="ac-type-${a.id}" style="width:100%">
                            ${ACCT_TYPES.map(t => `<option value="${t}" ${a.type===t?'selected':''}>${t}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group" style="margin:0">
                        <label style="font-size:0.8rem;font-weight:600">Starting Balance ($)</label>
                        <input type="number" id="ac-bal-${a.id}" value="${a.startingBalance}" step="0.01" style="width:100%">
                    </div>
                </div>
                <div class="acct-edit-actions">
                    <button class="btn btn-primary btn-small" onclick="app.saveEditAccount(${a.id})">Save</button>
                    <button class="btn btn-secondary btn-small" onclick="app.cancelEditAccount()">Cancel</button>
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
                ${linkedIncome.map(i  => `<span class="acct-link acct-link--income">💰 ${i.name}</span>`).join('')}
                ${linkedBonuses.map(b => `<span class="acct-link acct-link--bonus">🎁 ${b.name}</span>`).join('')}
                ${linkedDebts.map(d   => `<span class="acct-link acct-link--debt">💳 ${d.name}</span>`).join('')}
                ${linkedBills.map(b   => `<span class="acct-link acct-link--bill">🧾 ${b.name}</span>`).join('')}
                ${linkedExp.map(e     => `<span class="acct-link acct-link--exp">💸 ${e.name}</span>`).join('')}
            </div>`;

        return `<div class="acct-card">
            <div class="acct-card-header">
                <span class="acct-type-icon">${typeIcon[a.type] || '🗂️'}</span>
                <div class="acct-card-info">
                    <span class="acct-card-name">${a.name}</span>
                    <span class="acct-type-badge">${a.type}</span>
                </div>
                <div class="acct-balances">
                    <div class="acct-balance-item">
                        <span class="acct-balance-label">Starting</span>
                        <span class="acct-balance-value">${app.formatCurrency(a.startingBalance)}</span>
                    </div>
                    <div class="acct-balance-item">
                        <span class="acct-balance-label">Proj. (${monthLabel})</span>
                        <span class="acct-balance-value ${balClass}">${app.formatCurrency(projBalance)}</span>
                    </div>
                </div>
                <div class="debt-actions">
                    <button class="btn-edit" onclick="app.startEditAccount(${a.id})">Edit</button>
                    <button class="btn btn-danger btn-small" onclick="app.deleteAccount(${a.id})">Delete</button>
                </div>
            </div>
            ${linkRows}
        </div>`;
    }).join('');

    container.innerHTML = cards;
}
