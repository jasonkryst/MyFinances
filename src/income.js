// Income and bonus management


// Render the income list and summary panel inside the Income page.
export function renderIncomeList(app) {
    const container = document.getElementById('incomeList');
    const summaryEl = document.getElementById('incomeSummary');
    if (!container) return;

    if (app.incomes.length === 0) {
        container.innerHTML = `<p class="empty-income-msg" style="color:#9ca3af;font-style:italic;margin:8px 0 0 0;">No income sources added yet.</p>`;
        if (summaryEl) summaryEl.style.display = 'none';
        return;
    }

    const freqLabel = { biweekly: 'Every other week', monthly: 'Once per month' };

    container.innerHTML = app.incomes.map(inc => {
        if (app.editingIncomeId === inc.id) {
            return `
                <div class="income-card income-card--editing">
                    <div class="income-edit-form">
                        <div class="income-edit-grid">
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem;font-weight:600;">Name</label>
                                <input type="text" id="ie-name-${inc.id}" value="${inc.name.replace(/"/g, '&quot;')}" class="form-control" style="width:100%;">
                            </div>
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem;font-weight:600;">Amount per paycheck ($)</label>
                                <input type="number" id="ie-amount-${inc.id}" value="${inc.amount}" min="0.01" step="0.01" class="form-control" style="width:100%;">
                            </div>
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem;font-weight:600;">First pay date</label>
                                <input type="date" id="ie-date-${inc.id}" value="${inc.firstPayDate}" class="form-control" style="width:100%;">
                            </div>
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem;font-weight:600;">Frequency</label>
                                <select id="ie-freq-${inc.id}" class="form-control" style="width:100%;">
                                    <option value="biweekly" ${inc.frequency === 'biweekly' ? 'selected' : ''}>Every other week</option>
                                    <option value="monthly"  ${inc.frequency === 'monthly' ? 'selected' : ''}>Once per month</option>
                                </select>
                            </div>
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem;font-weight:600;">Account</label>
                                <select id="ie-account-${inc.id}" class="form-control" style="width:100%;">
                                    <option value="">— No account —</option>
                                    ${app.accounts.map(a => `<option value="${a.id}" ${inc.accountId === a.id ? 'selected' : ''}>${a.name}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        <div class="income-edit-actions">
                            <button class="btn btn-primary btn-small" onclick="app.saveEditIncome(${inc.id})">Save</button>
                            <button class="btn btn-secondary btn-small" onclick="app.cancelEditIncome()">Cancel</button>
                        </div>
                    </div>
                </div>`;
        }

        const dateStr = new Date(inc.firstPayDate + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        const pdays = app.paydaysInCurrentMonth(inc);
        const pdayLabel = pdays === 1 ? '1 payday this month' : `${pdays} paydays this month`;

        const upcomingDates = app.nextPayDates(inc, 3);
        const upcomingHTML = upcomingDates.length
            ? upcomingDates.map(d => {
                const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                return `<span class="income-upcoming-chip">${label}</span>`;
            }).join('')
            : '';

        return `
            <div class="income-card">
                <div class="income-card-info">
                    <span class="income-card-name">${inc.name}</span>
                    <span class="income-card-amount">${app.formatCurrency(inc.amount)}</span>
                    <span class="income-card-detail">First pay: ${dateStr}</span>
                    <span class="income-card-freq">${freqLabel[inc.frequency] || inc.frequency} &mdash; ${pdayLabel}</span>
                    ${upcomingHTML ? `<span class="income-card-upcoming-label">Next paydays:</span>${upcomingHTML}` : ''}
                </div>
                <div class="debt-actions">
                    <button class="btn-edit" onclick="app.startEditIncome(${inc.id})">Edit</button>
                    <button class="btn btn-danger btn-small" onclick="app.deleteIncome(${inc.id})">Delete</button>
                </div>
            </div>`;
    }).join('');

    if (summaryEl) {
        const { monthlyTotal } = app.computeMonthlyIncome();
        const bonusThisMonth = app.computeMonthlyBonuses();
        const regularThisMonth = monthlyTotal - bonusThisMonth;
        const totalAnnual = app.incomes.reduce((s, i) => {
            return s + (i.frequency === 'biweekly' ? i.amount * 26 : i.amount * 12);
        }, 0);

        const bonusRow = bonusThisMonth > 0
            ? `<div class="income-summary-item">
                   <span class="income-summary-label">Bonuses this month</span>
                   <span class="income-summary-value income-summary-value--bonus">${app.formatCurrency(bonusThisMonth)}</span>
               </div>`
            : '';

        summaryEl.style.display = 'block';
        summaryEl.innerHTML = `
            <h4>📅 Estimated Income Summary</h4>
            <div class="income-summary-grid">
                <div class="income-summary-item">
                    <span class="income-summary-label">Expected this month</span>
                    <span class="income-summary-value">${app.formatCurrency(monthlyTotal)}</span>
                </div>
                <div class="income-summary-item">
                    <span class="income-summary-label">Regular pay this month</span>
                    <span class="income-summary-value">${app.formatCurrency(regularThisMonth)}</span>
                </div>
                ${bonusRow}
                <div class="income-summary-item">
                    <span class="income-summary-label">Income sources</span>
                    <span class="income-summary-value">${app.incomes.length}</span>
                </div>
                <div class="income-summary-item">
                    <span class="income-summary-label">Estimated annual</span>
                    <span class="income-summary-value">${app.formatCurrency(totalAnnual)}</span>
                </div>
            </div>`;
    }
}

// Add a new income source
export function addIncome(app) {
    const name = document.getElementById('incomeName').value.trim();
    const amount = parseFloat(document.getElementById('incomeAmount').value);
    const firstPayDate = document.getElementById('incomeFirstDate').value;
    const frequency = document.getElementById('incomeFrequency').value;
    const accountId = parseInt(document.getElementById('incomeAccount')?.value);

    if (!name) { alert('Please enter a name for this income source.'); return; }
    if (isNaN(amount) || amount <= 0) { alert('Please enter a valid amount greater than 0.'); return; }
    if (!firstPayDate) { alert('Please enter the first pay date.'); return; }
    if (!accountId || isNaN(accountId)) { alert('Please select an account for this income source.'); return; }

    app.incomes.push({ id: Date.now(), name, amount, firstPayDate, frequency, accountId });
    app.saveToStorage();
    app.renderIncomeList();
    document.getElementById('incomeForm').reset();
}

// Delete an income source
export function deleteIncome(app, incomeId) {
    app.incomes = app.incomes.filter(i => i.id !== incomeId);
    app.saveToStorage();
    app.renderIncomeList();
    app.renderStrategyIncomeWidget();
}

// Enter inline-edit mode for an income card
export function startEditIncome(app, incomeId) {
    app.editingIncomeId = incomeId;
    app.renderIncomeList();
    setTimeout(() => {
        const el = document.getElementById(`ie-name-${incomeId}`);
        if (el) el.focus();
    }, 0);
}

// Cancel inline-edit without saving
export function cancelEditIncome(app) {
    app.editingIncomeId = null;
    app.renderIncomeList();
}

// Validate and save the inline-edit form for an income card
export function saveEditIncome(app, incomeId) {
    const nameEl      = document.getElementById(`ie-name-${incomeId}`);
    const amountEl    = document.getElementById(`ie-amount-${incomeId}`);
    const dateEl      = document.getElementById(`ie-date-${incomeId}`);
    const freqEl      = document.getElementById(`ie-freq-${incomeId}`);
    const accountEl   = document.getElementById(`ie-account-${incomeId}`);

    if (!nameEl || !amountEl || !dateEl || !freqEl) return;

    const name        = nameEl.value.trim();
    const amount      = parseFloat(amountEl.value);
    const firstPayDate = dateEl.value;
    const frequency   = freqEl.value;
    const accountId   = accountEl?.value ? parseInt(accountEl.value) : null;

    if (!name)                        { alert('Please enter a name.');            return; }
    if (isNaN(amount) || amount <= 0) { alert('Please enter a valid amount.');     return; }
    if (!firstPayDate)                { alert('Please select a first pay date.');  return; }

    const idx = app.incomes.findIndex(i => i.id === incomeId);
    if (idx === -1) return;

    app.incomes[idx] = { ...app.incomes[idx], name, amount, firstPayDate, frequency, accountId };
    app.editingIncomeId = null;
    app.saveToStorage();
    app.renderIncomeList();
    app.renderStrategyIncomeWidget();
}

// Bonus CRUD
export function addBonus(app) {
    const name      = document.getElementById('bonusName').value.trim();
    const amount    = parseFloat(document.getElementById('bonusAmount').value);
    const date      = document.getElementById('bonusDate').value;
    const category  = document.getElementById('bonusCategory').value;
    const accountId = parseInt(document.getElementById('bonusAccount')?.value) || null;

    if (!name)                        { alert('Please enter a label for this bonus.'); return; }
    if (isNaN(amount) || amount <= 0) { alert('Please enter a valid amount greater than 0.'); return; }
    if (!date)                        { alert('Please enter the date received.'); return; }

    app.bonuses.push({ id: Date.now(), name, amount, date, category, accountId });
    app.saveToStorage();
    app.renderBonusList();
    app.renderStrategyIncomeWidget();
    document.getElementById('bonusForm').reset();
}

export function deleteBonus(app, bonusId) {
    app.bonuses = app.bonuses.filter(b => b.id !== bonusId);
    app.saveToStorage();
    app.renderBonusList();
    app.renderStrategyIncomeWidget();
}

export function startEditBonus(app, bonusId) {
    app.editingBonusId = bonusId;
    app.renderBonusList();
    setTimeout(() => {
        const el = document.getElementById(`be-name-${bonusId}`);
        if (el) el.focus();
    }, 0);
}

export function cancelEditBonus(app) {
    app.editingBonusId = null;
    app.renderBonusList();
}

export function saveEditBonus(app, bonusId) {
    const nameEl      = document.getElementById(`be-name-${bonusId}`);
    const amtEl       = document.getElementById(`be-amount-${bonusId}`);
    const dateEl      = document.getElementById(`be-date-${bonusId}`);
    const catEl       = document.getElementById(`be-category-${bonusId}`);
    const accountEl   = document.getElementById(`be-account-${bonusId}`);
    if (!nameEl || !amtEl || !dateEl || !catEl) return;

    const name = nameEl.value.trim();
    const amount = parseFloat(amtEl.value);
    const date = dateEl.value;
    const category = catEl.value;
    const accountId = accountEl && accountEl.value ? parseInt(accountEl.value) : null;

    if (!name) { alert('Please enter a name for this bonus.'); return; }
    if (isNaN(amount) || amount <= 0) { alert('Please enter a valid amount greater than 0.'); return; }
    if (!date) { alert('Please enter the date received.'); return; }

    const idx = app.bonuses.findIndex(b => b.id === bonusId);
    if (idx === -1) return;
    app.bonuses[idx] = { ...app.bonuses[idx], name, amount, date, category, accountId };
    app.editingBonusId = null;
    app.saveToStorage();
    app.renderBonusList();
    app.renderStrategyIncomeWidget();
}

export function renderBonusList(app) {
    const container = document.getElementById('bonusList');
    if (!container) return;
    if (!app.bonuses || app.bonuses.length === 0) {
        container.innerHTML = '';
        return;
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const catBadgeClass = { Bonus: 'bonus-cat--bonus', 'Tax Refund': 'bonus-cat--tax', Other: 'bonus-cat--other' };

    container.innerHTML = `
        <div class="bonus-list-wrap">
            <h4 class="bonus-list-title">One-time Bonuses &amp; Windfalls</h4>
            ${app.bonuses.map(b => {
                const d = new Date(b.date + 'T12:00:00');
                const isThisMonth = d.getFullYear() === year && d.getMonth() === month;
                const dateStr = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
                const badgeCls = catBadgeClass[b.category] || 'bonus-cat--other';

                if (app.editingBonusId === b.id) {
                    return `
                    <div class="bonus-card bonus-card--editing">
                        <div class="bonus-edit-grid">
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem;font-weight:600;">Label</label>
                                <input type="text" id="be-name-${b.id}" value="${b.name.replace(/"/g,'&quot;')}" style="width:100%;">
                            </div>
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem;font-weight:600;">Amount ($)</label>
                                <input type="number" id="be-amount-${b.id}" value="${b.amount}" min="0.01" step="0.01" style="width:100%;">
                            </div>
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem;font-weight:600;">Date received</label>
                                <input type="date" id="be-date-${b.id}" value="${b.date}" style="width:100%;">
                            </div>
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem;font-weight:600;">Category</label>
                                <select id="be-category-${b.id}" style="width:100%;">
                                    <option value="Bonus"      ${b.category==='Bonus'      ?'selected':''}>Bonus</option>
                                    <option value="Tax Refund" ${b.category==='Tax Refund' ?'selected':''}>Tax Refund</option>
                                    <option value="Other"      ${b.category==='Other'      ?'selected':''}>Other</option>
                                </select>
                            </div>
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem;font-weight:600;">Account</label>
                                <select id="be-account-${b.id}" style="width:100%;">
                                    <option value="">— No account —</option>
                                    ${app.accounts.map(a => `<option value="${a.id}" ${b.accountId === a.id ? 'selected' : ''}>${a.name}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        <div class="income-edit-actions" style="margin-top:10px;">
                            <button class="btn btn-primary btn-small" onclick="app.saveEditBonus(${b.id})">Save</button>
                            <button class="btn btn-secondary btn-small" onclick="app.cancelEditBonus()">Cancel</button>
                        </div>
                    </div>`;
                }

                return `
                <div class="bonus-card${isThisMonth ? ' bonus-card--current' : ''}">
                    <div class="bonus-card-info">
                        <span class="bonus-card-name">${b.name}</span>
                        <span class="bonus-card-amount">${app.formatCurrency(b.amount)}</span>
                        <span class="bonus-card-meta">${dateStr} &nbsp;·&nbsp; <span class="bonus-cat-badge ${badgeCls}">${b.category}</span></span>
                        ${isThisMonth ? '<span class="bonus-this-month-tag">✅ Included in this month\'s income</span>' : ''}
                    </div>
                    <div class="debt-actions">
                        <button class="btn-edit" onclick="app.startEditBonus(${b.id})">Edit</button>
                        <button class="btn btn-danger btn-small" onclick="app.deleteBonus(${b.id})">Delete</button>
                    </div>
                </div>`;
            }).join('')}
        </div>`;
}
