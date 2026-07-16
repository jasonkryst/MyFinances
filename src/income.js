// Income and bonus management
import {
    formatCurrency,
    countIncomePaydaysInMonth,
    getNextIncomePayDates,
    computeMonthlyIncomeForMonth,
    computeMonthlyBonusesForMonth,
    normalizeText,
    sanitizeFiniteNumber,
    sanitizeDateISO,
    escapeHtml,
    formatShortDate
} from './utils.js';


// Render the income list and summary panel inside the Income page.
export function renderIncomeList(app) {
    const container = document.getElementById('incomeList');
    const summaryEl = document.getElementById('incomeSummary');
    if (!container) return;

    if (app.incomes.length === 0) {
        container.innerHTML = `<p class="empty-income-msg text-muted-secondary">No income sources added yet.</p>`;
        if (summaryEl) { summaryEl.classList.add('hidden'); summaryEl.classList.remove('visible'); }
        return;
    }

    const freqLabel = { biweekly: 'Every other week', monthly: 'Once per month' };

    container.innerHTML = app.incomes.map(inc => {
        if (app.editingIncomeId === inc.id) {
            return `
                <div class="income-card income-card--editing">
                    <div class="income-edit-form">
                        <div class="income-edit-grid">
                            <div class="form-group form-no-margin">
                                <label class="label-compact">Name</label>
                                <input type="text" id="ie-name-${inc.id}" value="${escapeHtml(inc.name)}" class="form-control form-full-width">
                            </div>
                            <div class="form-group form-no-margin">
                                <label class="label-compact">Amount per paycheck ($)</label>
                                <input type="number" id="ie-amount-${inc.id}" value="${inc.amount}" min="0.01" step="0.01" class="form-control form-full-width">
                            </div>
                            <div class="form-group form-no-margin">
                                <label class="label-compact">First pay date</label>
                                <input type="date" id="ie-date-${inc.id}" value="${inc.firstPayDate}" class="form-control form-full-width">
                            </div>
                            <div class="form-group form-no-margin">
                                <label class="label-compact">Frequency</label>
                                <select id="ie-freq-${inc.id}" class="form-control form-full-width">
                                    <option value="biweekly" ${inc.frequency === 'biweekly' ? 'selected' : ''}>Every other week</option>
                                    <option value="monthly"  ${inc.frequency === 'monthly' ? 'selected' : ''}>Once per month</option>
                                </select>
                            </div>
                            <div class="form-group form-no-margin">
                                <label class="label-compact">Account</label>
                                <select id="ie-account-${inc.id}" class="form-control form-full-width">
                                    <option value="">— No account —</option>
                                    ${app.accounts.map(a => `<option value="${a.id}" ${inc.accountId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        <div class="income-edit-actions">
                            <button class="btn btn-primary btn-small" data-income-action="save" data-income-id="${inc.id}">Save</button>
                            <button class="btn btn-secondary btn-small" data-income-action="cancel">Cancel</button>
                        </div>
                    </div>
                </div>`;
        }

        const dateStr = formatShortDate(inc.firstPayDate);
        const now = new Date();
        const pdays = countIncomePaydaysInMonth(inc, now.getFullYear(), now.getMonth());
        const pdayLabel = pdays === 1 ? '1 payday this month' : `${pdays} paydays this month`;

        const upcomingDates = getNextIncomePayDates(inc, 3);
        const upcomingHTML = upcomingDates.length
            ? upcomingDates.map(d => {
                const label = formatShortDate(d);
                return `<span class="income-upcoming-chip">${label}</span>`;
            }).join('')
            : '';

        return `
            <div class="income-card">
                <div class="income-card-info">
                    <span class="income-card-name">${escapeHtml(inc.name)}</span>
                    <span class="income-card-amount">${formatCurrency(inc.amount)}</span>
                    <span class="income-card-detail">First pay: ${dateStr}</span>
                    <span class="income-card-freq">${escapeHtml(freqLabel[inc.frequency] || inc.frequency)} &mdash; ${escapeHtml(pdayLabel)}</span>
                    ${upcomingHTML ? `<span class="income-card-upcoming-label">Next paydays:</span>${upcomingHTML}` : ''}
                </div>
                <div class="debt-actions">
                    <button class="btn-edit" data-income-action="edit" data-income-id="${inc.id}">Edit</button>
                    <button class="btn btn-danger btn-small" data-income-action="delete" data-income-id="${inc.id}">Delete</button>
                </div>
            </div>`;
    }).join('');

    container.onclick = event => {
        const actionEl = event.target.closest('[data-income-action]');
        if (!actionEl) return;
        const action = actionEl.getAttribute('data-income-action');
        const id = parseInt(actionEl.getAttribute('data-income-id'), 10);
        if (action === 'cancel') {
            app.cancelEditIncome();
            return;
        }
        if (Number.isNaN(id)) return;
        if (action === 'save') app.saveEditIncome(id);
        if (action === 'edit') app.startEditIncome(id);
        if (action === 'delete') app.deleteIncome(id);
    };

    if (summaryEl) {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const { monthlyTotal } = computeMonthlyIncomeForMonth(app.incomes, app.bonuses, year, month);
        const bonusThisMonth = computeMonthlyBonusesForMonth(app.bonuses, year, month);
        const regularThisMonth = monthlyTotal - bonusThisMonth;
        const totalAnnual = app.incomes.reduce((s, i) => {
            return s + (i.frequency === 'biweekly' ? i.amount * 26 : i.amount * 12);
        }, 0);

        const bonusRow = bonusThisMonth > 0
            ? `<div class="income-summary-item">
                   <span class="income-summary-label">One-time entries this month</span>
                   <span class="income-summary-value income-summary-value--bonus">${formatCurrency(bonusThisMonth)}</span>
               </div>`
            : '';

        summaryEl.classList.add('visible'); summaryEl.classList.remove('hidden');
        summaryEl.innerHTML = `
            <h4>📅 Estimated Income Summary</h4>
            <div class="income-summary-grid">
                <div class="income-summary-item">
                    <span class="income-summary-label">Expected this month</span>
                    <span class="income-summary-value">${formatCurrency(monthlyTotal)}</span>
                </div>
                <div class="income-summary-item">
                    <span class="income-summary-label">Regular pay this month</span>
                    <span class="income-summary-value">${formatCurrency(regularThisMonth)}</span>
                </div>
                ${bonusRow}
                <div class="income-summary-item">
                    <span class="income-summary-label">Income sources</span>
                    <span class="income-summary-value">${app.incomes.length}</span>
                </div>
                <div class="income-summary-item">
                    <span class="income-summary-label">Estimated annual</span>
                    <span class="income-summary-value">${formatCurrency(totalAnnual)}</span>
                </div>
            </div>`;
    }
}

// Add a new income source
export function addIncome(app) {
    const name = normalizeText(document.getElementById('incomeName').value, 80);
    const rawAmount = document.getElementById('incomeAmount').value;
    const amount = sanitizeFiniteNumber(rawAmount, NaN, { min: 0.01 });
    const firstPayDate = sanitizeDateISO(document.getElementById('incomeFirstDate').value);
    const frequency = document.getElementById('incomeFrequency').value;
    const accountId = parseInt(document.getElementById('incomeAccount')?.value);

    if (!name) { alert('Please enter a name for this income source.'); return; }
    if (!rawAmount || isNaN(Number(rawAmount)) || Number(rawAmount) <= 0) { alert('Please enter a valid amount greater than 0.'); return; }
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

    const name        = normalizeText(nameEl.value, 80);
    const rawAmount   = amountEl.value;
    const amount      = sanitizeFiniteNumber(rawAmount, NaN, { min: 0.01 });
    const firstPayDate = sanitizeDateISO(dateEl.value);
    const frequency   = freqEl.value;
    const accountId   = accountEl?.value ? parseInt(accountEl.value) : null;

    if (!name)                        { alert('Please enter a name.');            return; }
    if (!rawAmount || isNaN(Number(rawAmount)) || Number(rawAmount) <= 0) { alert('Please enter a valid amount.');     return; }
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
    const name      = normalizeText(document.getElementById('bonusName').value, 80);
    const rawAmount = document.getElementById('bonusAmount').value;
    const amount    = sanitizeFiniteNumber(rawAmount, NaN, { min: 0.01 });
    const date      = sanitizeDateISO(document.getElementById('bonusDate').value);
    const category  = normalizeText(document.getElementById('bonusCategory').value, 40);
    const accountId = parseInt(document.getElementById('bonusAccount')?.value) || null;

    if (!name)                        { alert('Please enter a label for this one-time entry.'); return; }
    if (!rawAmount || isNaN(Number(rawAmount)) || Number(rawAmount) <= 0) { alert('Please enter a valid amount greater than 0.'); return; }
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

    const name = normalizeText(nameEl.value, 80);
    const rawAmount = amtEl.value;
    const amount = sanitizeFiniteNumber(rawAmount, NaN, { min: 0.01 });
    const date = sanitizeDateISO(dateEl.value);
    const category = normalizeText(catEl.value, 40);
    const accountId = accountEl && accountEl.value ? parseInt(accountEl.value) : null;

    if (!name) { alert('Please enter a name for this one-time entry.'); return; }
    if (!rawAmount || isNaN(Number(rawAmount)) || Number(rawAmount) <= 0) { alert('Please enter a valid amount greater than 0.'); return; }
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
    const catBadgeClass = {
        Bonus: 'bonus-cat--bonus',
        'Tax Refund': 'bonus-cat--tax',
        'Cash Deposit': 'bonus-cat--bonus',
        'Check Deposit': 'bonus-cat--tax',
        Other: 'bonus-cat--other'
    };

    container.innerHTML = `
        <div class="bonus-list-wrap">
            <h4 class="bonus-list-title">One-time Bonuses &amp; Deposits</h4>
            ${app.bonuses.map(b => {
                const d = new Date(b.date + 'T12:00:00');
                const isThisMonth = d.getFullYear() === year && d.getMonth() === month;
                const dateStr = formatShortDate(d);
                const badgeCls = catBadgeClass[b.category] || 'bonus-cat--other';

                if (app.editingBonusId === b.id) {
                    return `
                    <div class="bonus-card bonus-card--editing">
                        <div class="bonus-edit-grid">
                            <div class="form-group form-no-margin">
                                <label class="label-compact">Label</label>
                                <input type="text" id="be-name-${b.id}" value="${escapeHtml(b.name)}" class="form-full-width">
                            </div>
                            <div class="form-group form-no-margin">
                                <label class="label-compact">Amount ($)</label>
                                <input type="number" id="be-amount-${b.id}" value="${b.amount}" min="0.01" step="0.01" class="form-full-width">
                            </div>
                            <div class="form-group form-no-margin">
                                <label class="label-compact">Date received</label>
                                <input type="date" id="be-date-${b.id}" value="${b.date}" class="form-full-width">
                            </div>
                            <div class="form-group form-no-margin">
                                <label class="label-compact">Category</label>
                                <select id="be-category-${b.id}" class="form-full-width">
                                    <option value="Bonus"      ${b.category==='Bonus'      ?'selected':''}>Bonus</option>
                                    <option value="Tax Refund" ${b.category==='Tax Refund' ?'selected':''}>Tax Refund</option>
                                    <option value="Cash Deposit" ${b.category==='Cash Deposit' ?'selected':''}>Cash Deposit</option>
                                    <option value="Check Deposit" ${b.category==='Check Deposit' ?'selected':''}>Check Deposit</option>
                                    <option value="Other"      ${b.category==='Other'      ?'selected':''}>Other</option>
                                </select>
                            </div>
                            <div class="form-group form-no-margin">
                                <label class="label-compact">Account</label>
                                <select id="be-account-${b.id}" class="form-full-width">
                                    <option value="">— No account —</option>
                                    ${app.accounts.map(a => `<option value="${a.id}" ${b.accountId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        <div class="income-edit-actions margin-top-auto">
                            <button class="btn btn-primary btn-small" data-bonus-action="save" data-bonus-id="${b.id}">Save</button>
                            <button class="btn btn-secondary btn-small" data-bonus-action="cancel">Cancel</button>
                        </div>
                    </div>`;
                }

                return `
                <div class="bonus-card${isThisMonth ? ' bonus-card--current' : ''}">
                    <div class="bonus-card-info">
                        <span class="bonus-card-name">${escapeHtml(b.name)}</span>
                        <span class="bonus-card-amount">${formatCurrency(b.amount)}</span>
                        <span class="bonus-card-meta">${escapeHtml(dateStr)} &nbsp;·&nbsp; <span class="bonus-cat-badge ${badgeCls}">${escapeHtml(b.category)}</span></span>
                        ${isThisMonth ? '<span class="bonus-this-month-tag">✅ Included in this month\'s income</span>' : ''}
                    </div>
                    <div class="debt-actions">
                        <button class="btn-edit" data-bonus-action="edit" data-bonus-id="${b.id}">Edit</button>
                        <button class="btn btn-danger btn-small" data-bonus-action="delete" data-bonus-id="${b.id}">Delete</button>
                    </div>
                </div>`;
            }).join('')}
        </div>`;

    container.onclick = event => {
        const actionEl = event.target.closest('[data-bonus-action]');
        if (!actionEl) return;
        const action = actionEl.getAttribute('data-bonus-action');
        const id = parseInt(actionEl.getAttribute('data-bonus-id'), 10);
        if (action === 'cancel') {
            app.cancelEditBonus();
            return;
        }
        if (Number.isNaN(id)) return;
        if (action === 'save') app.saveEditBonus(id);
        if (action === 'edit') app.startEditBonus(id);
        if (action === 'delete') app.deleteBonus(id);
    };
}
