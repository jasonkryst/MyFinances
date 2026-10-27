// Income and bonus management
import {
    formatCurrency,
    countIncomePaydaysInMonth,
    getNextIncomePayDates,
    computeMonthlyIncomeForMonth,
    computeMonthlyBonusesForMonth,
    computeNetIncomeAmount,
    normalizeText,
    sanitizeFiniteNumber,
    sanitizeDateISO,
    escapeHtml,
    formatShortDate,
    buildPersonPillsHtml,
    todayISO,
    renderChartDataTable
} from './utils.js';
import { buildAccountOptionsHtml } from './accounts.js';
import { buildPersonOptionsHtml } from './people.js';
import { pgPost, pgPatch, pgDelete } from './postgresSync.js';
import { showAlertModal } from './ui.js';


// Module-level filter state for the bonus list (null = all time).
let _bonusFilterYear = new Date().getFullYear();

// Render the income list and summary panel inside the Income page.
export function renderIncomeList(app) {
    const container = document.getElementById('incomeList');
    const summaryEl = document.getElementById('incomeSummary');
    if (!container) return;

    if (app.incomes.length === 0) {
        container.innerHTML = `<div class="empty-state">
            <div class="empty-state__icon">💰</div>
            <h3 class="empty-state__heading">No income sources yet</h3>
            <p class="empty-state__body">Add a salary, freelance income, or any regular paycheck to see payday forecasts and cash flow projections.</p>
            <button class="btn btn-primary empty-state__cta" id="incomeEmptyStateCta">Add Your First Income</button>
        </div>`;
        document.getElementById('incomeEmptyStateCta')?.addEventListener('click', () => {
            document.getElementById('incomeForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setTimeout(() => document.getElementById('incomeName')?.focus(), 300);
        });
        if (summaryEl) { summaryEl.classList.add('hidden'); summaryEl.classList.remove('visible'); }
        renderIncomeTrendChart(app);
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
                                <label class="label-compact">Tax withholding (%)</label>
                                <input type="number" id="ie-withholding-${inc.id}" value="${inc.withholdingPercent || 0}" min="0" max="99.9" step="0.1" class="form-control form-full-width">
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
                                    ${buildAccountOptionsHtml(app.accounts, inc.accountId, { emptyLabel: '— No account —' })}
                                </select>
                            </div>
                            <div class="form-group form-no-margin">
                                <label class="label-compact">Person</label>
                                <select id="ie-person-${inc.id}" class="form-control form-full-width">
                                    ${buildPersonOptionsHtml(app.persons, inc.personId, { emptyLabel: '— No person —' })}
                                </select>
                            </div>
                            <div class="form-group form-no-margin">
                                <label class="label-compact">Category</label>
                                <select id="ie-category-${inc.id}" class="form-control form-full-width">
                                    ${['Salary','Freelance','Rental','Investment','Other'].map(c => `<option value="${c}"${inc.category === c ? ' selected' : ''}>${c}</option>`).join('')}
                                </select>
                            </div>
                            <div class="form-group form-no-margin income-variable-edit-group">
                                <label class="income-variable-label">
                                    <input type="checkbox" id="ie-variable-${inc.id}"${inc.isVariable ? ' checked' : ''}>
                                    Variable / hourly amount
                                </label>
                            </div>
                        </div>
                        <div class="income-edit-actions">
                            <button class="btn btn-primary btn-small" data-income-action="save" data-income-id="${inc.id}" aria-label="Save changes to ${escapeHtml(inc.name)}">Save</button>
                            <button class="btn btn-secondary btn-small" data-income-action="cancel" aria-label="Cancel editing ${escapeHtml(inc.name)}">Cancel</button>
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

        const linkedPerson = inc.personId ? (app.persons || []).find(p => p.id === inc.personId) : null;
        // #251: net is the primary displayed amount; gross only shown
        // (as a tooltip + secondary span) when withholding is actually set,
        // so an income record with the default 0% looks exactly as before.
        const netAmount = computeNetIncomeAmount(inc);
        const hasWithholding = (inc.withholdingPercent || 0) > 0;
        const grossNote = hasWithholding
            ? `Gross: ${formatCurrency(inc.amount)} (${inc.withholdingPercent}% withheld)`
            : '';
        return `
            <div class="income-card" id="income-card-${inc.id}">
                <div class="income-card-info">
                    <span class="income-card-name">${escapeHtml(inc.name)}</span>
                    ${inc.isVariable ? `<span class="income-variable-badge" title="Amount varies — update the actual amount in the Ledger each pay period">~ Est.</span>` : ''}
                    ${inc.category && inc.category !== 'Salary' ? `<span class="income-category-badge">${escapeHtml(inc.category)}</span>` : ''}
                    ${linkedPerson ? `<span class="income-card-detail"><span class="person-pill">${escapeHtml(linkedPerson.name)}</span></span>` : ''}
                    <span class="income-card-amount"${grossNote ? ` title="${escapeHtml(grossNote)}"` : ''}>${formatCurrency(netAmount)}</span>
                    ${grossNote ? `<span class="income-card-gross-note">${escapeHtml(grossNote)}</span>` : ''}
                    <span class="income-card-detail">First pay: ${dateStr}</span>
                    <span class="income-card-freq">${escapeHtml(freqLabel[inc.frequency] || inc.frequency)} &mdash; ${escapeHtml(pdayLabel)}</span>
                    ${upcomingHTML ? `<span class="income-card-upcoming-label">Next paydays:</span>${upcomingHTML}` : ''}
                </div>
                <div class="debt-actions">
                    <button class="btn-edit" data-income-action="edit" data-income-id="${inc.id}" aria-label="Edit ${escapeHtml(inc.name)}">Edit</button>
                    <button class="btn btn-danger btn-small" data-income-action="delete" data-income-id="${inc.id}" aria-label="Delete ${escapeHtml(inc.name)}">Delete</button>
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
        // #251: net, matching the net "Expected this month"/"Regular pay" figures above.
        const totalAnnual = app.incomes.reduce((s, i) => {
            const net = computeNetIncomeAmount(i);
            return s + (i.frequency === 'biweekly' ? net * 26 : net * 12);
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
    renderIncomeTrendChart(app);
}

// Add a new income source
export async function addIncome(app) {
    const name = normalizeText(document.getElementById('incomeName').value, 80);
    const rawAmount = document.getElementById('incomeAmount').value;
    const amount = sanitizeFiniteNumber(rawAmount, NaN, { min: 0.01 });
    const firstPayDate = sanitizeDateISO(document.getElementById('incomeFirstDate').value);
    const frequency = document.getElementById('incomeFrequency').value;
    const accountId = parseInt(document.getElementById('incomeAccount')?.value);
    const personIdRaw = document.getElementById('incomePerson')?.value;
    const personId = personIdRaw ? parseInt(personIdRaw, 10) : null;
    const category = document.getElementById('incomeCategory')?.value || 'Salary';
    const isVariable = Boolean(document.getElementById('incomeIsVariable')?.checked);
    const rawWithholding = document.getElementById('incomeWithholding')?.value;
    const withholdingPercent = sanitizeFiniteNumber(rawWithholding, 0, { min: 0, max: 99.9 });

    if (!name) { await showAlertModal('Please enter a name for this income source.'); return; }
    if (!rawAmount || isNaN(Number(rawAmount)) || Number(rawAmount) <= 0) { await showAlertModal('Please enter a valid amount greater than 0.'); return; }
    if (!firstPayDate) { await showAlertModal('Please enter the first pay date.'); return; }
    if (!accountId || isNaN(accountId)) { await showAlertModal('Please select an account for this income source.'); return; }
    if (rawWithholding && (isNaN(Number(rawWithholding)) || Number(rawWithholding) < 0 || Number(rawWithholding) > 99.9)) {
        await showAlertModal('Please enter a tax withholding percent between 0 and 99.9.'); return;
    }

    const income = { id: Date.now(), name, amount, firstPayDate, frequency, accountId, personId, category, isVariable, withholdingPercent, updatedAt: todayISO() };
    app.incomes.push(income);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') {
        const saved = await pgPost(app, '/api/incomes', income);
        if (saved?.id) income.id = saved.id;
    }
    app.renderIncomeList();
    document.getElementById('incomeForm').reset();
}

// Delete an income source
export function deleteIncome(app, incomeId) {
    app.incomes = app.incomes.filter(i => i.id !== incomeId);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/incomes/${incomeId}`);
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
export async function saveEditIncome(app, incomeId) {
    const nameEl      = document.getElementById(`ie-name-${incomeId}`);
    const amountEl    = document.getElementById(`ie-amount-${incomeId}`);
    const dateEl      = document.getElementById(`ie-date-${incomeId}`);
    const freqEl      = document.getElementById(`ie-freq-${incomeId}`);
    const accountEl   = document.getElementById(`ie-account-${incomeId}`);
    const personEl    = document.getElementById(`ie-person-${incomeId}`);
    const categoryEl  = document.getElementById(`ie-category-${incomeId}`);
    const withholdingEl = document.getElementById(`ie-withholding-${incomeId}`);

    if (!nameEl || !amountEl || !dateEl || !freqEl) return;

    const name        = normalizeText(nameEl.value, 80);
    const rawAmount   = amountEl.value;
    const amount      = sanitizeFiniteNumber(rawAmount, NaN, { min: 0.01 });
    const firstPayDate = sanitizeDateISO(dateEl.value);
    const frequency   = freqEl.value;
    const accountId   = accountEl?.value ? parseInt(accountEl.value) : null;
    const personId    = personEl?.value ? parseInt(personEl.value, 10) : null;
    const category    = categoryEl?.value || 'Salary';
    const isVariable  = Boolean(document.getElementById(`ie-variable-${incomeId}`)?.checked);
    const rawWithholding = withholdingEl?.value;
    const withholdingPercent = sanitizeFiniteNumber(rawWithholding, 0, { min: 0, max: 99.9 });

    if (!name)                        { await showAlertModal('Please enter a name.');            return; }
    if (!rawAmount || isNaN(Number(rawAmount)) || Number(rawAmount) <= 0) { await showAlertModal('Please enter a valid amount.');     return; }
    if (!firstPayDate)                { await showAlertModal('Please select a first pay date.');  return; }
    if (rawWithholding && (isNaN(Number(rawWithholding)) || Number(rawWithholding) < 0 || Number(rawWithholding) > 99.9)) {
        await showAlertModal('Please enter a tax withholding percent between 0 and 99.9.'); return;
    }

    const idx = app.incomes.findIndex(i => i.id === incomeId);
    if (idx === -1) return;

    app.incomes[idx] = { ...app.incomes[idx], name, amount, firstPayDate, frequency, accountId, personId, category, isVariable, withholdingPercent, updatedAt: todayISO() };
    app.editingIncomeId = null;
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/incomes/${app.incomes[idx].id}`, app.incomes[idx]);
    app.renderIncomeList();
    app.renderStrategyIncomeWidget();
}

// Bonus CRUD
export async function addBonus(app) {
    const name      = normalizeText(document.getElementById('bonusName').value, 80);
    const rawAmount = document.getElementById('bonusAmount').value;
    const amount    = sanitizeFiniteNumber(rawAmount, NaN, { min: 0.01 });
    const date      = sanitizeDateISO(document.getElementById('bonusDate').value);
    const category  = normalizeText(document.getElementById('bonusCategory').value, 40);
    const accountId = parseInt(document.getElementById('bonusAccount')?.value) || null;
    const rawPurpose = document.getElementById('bonusPurpose')?.value;
    const purpose   = (rawPurpose === 'cashFlow' || rawPurpose === 'savings') ? rawPurpose : null;

    if (!name)                        { await showAlertModal('Please enter a label for this one-time entry.'); return; }
    if (!rawAmount || isNaN(Number(rawAmount)) || Number(rawAmount) <= 0) { await showAlertModal('Please enter a valid amount greater than 0.'); return; }
    if (!date)                        { await showAlertModal('Please enter the date received.'); return; }

    const bonus = { id: Date.now(), name, amount, date, category, accountId, purpose };
    app.bonuses.push(bonus);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') {
        const saved = await pgPost(app, '/api/bonuses', bonus);
        if (saved?.id) bonus.id = saved.id;
    }
    app.renderBonusList();
    app.renderStrategyIncomeWidget();
    document.getElementById('bonusForm').reset();
    const adviceEl = document.getElementById('bonusAdviceResult');
    if (adviceEl) adviceEl.innerHTML = '';
}

export function deleteBonus(app, bonusId) {
    app.bonuses = app.bonuses.filter(b => b.id !== bonusId);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/bonuses/${bonusId}`);
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

export async function saveEditBonus(app, bonusId) {
    const nameEl      = document.getElementById(`be-name-${bonusId}`);
    const amtEl       = document.getElementById(`be-amount-${bonusId}`);
    const dateEl      = document.getElementById(`be-date-${bonusId}`);
    const catEl       = document.getElementById(`be-category-${bonusId}`);
    const accountEl   = document.getElementById(`be-account-${bonusId}`);
    const purposeEl   = document.getElementById(`be-purpose-${bonusId}`);
    if (!nameEl || !amtEl || !dateEl || !catEl) return;

    const name = normalizeText(nameEl.value, 80);
    const rawAmount = amtEl.value;
    const amount = sanitizeFiniteNumber(rawAmount, NaN, { min: 0.01 });
    const date = sanitizeDateISO(dateEl.value);
    const category = normalizeText(catEl.value, 40);
    const accountId = accountEl && accountEl.value ? parseInt(accountEl.value) : null;
    const rawPurpose = purposeEl?.value;
    const purpose = (rawPurpose === 'cashFlow' || rawPurpose === 'savings') ? rawPurpose : null;

    if (!name) { await showAlertModal('Please enter a name for this one-time entry.'); return; }
    if (!rawAmount || isNaN(Number(rawAmount)) || Number(rawAmount) <= 0) { await showAlertModal('Please enter a valid amount greater than 0.'); return; }
    if (!date) { await showAlertModal('Please enter the date received.'); return; }

    const idx = app.bonuses.findIndex(b => b.id === bonusId);
    if (idx === -1) return;
    app.bonuses[idx] = { ...app.bonuses[idx], name, amount, date, category, accountId, purpose };
    app.editingBonusId = null;
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/bonuses/${app.bonuses[idx].id}`, app.bonuses[idx]);
    app.renderBonusList();
    app.renderStrategyIncomeWidget();
}

export function renderBonusList(app) {
    const container = document.getElementById('bonusList');
    if (!container) return;
    if (!app.bonuses || app.bonuses.length === 0) {
        container.innerHTML = '';
        renderIncomeTrendChart(app);
        return;
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // Build sorted list of years that have at least one bonus entry
    const availableYears = [...new Set(
        app.bonuses.map(b => new Date(b.date + 'T12:00:00').getFullYear())
    )].sort((a, b) => a - b);

    // Clamp filter to an actually-present year when navigating
    if (_bonusFilterYear !== null && !availableYears.includes(_bonusFilterYear)) {
        _bonusFilterYear = availableYears[availableYears.length - 1] ?? currentYear;
    }

    const filtered = _bonusFilterYear === null
        ? app.bonuses
        : app.bonuses.filter(b => new Date(b.date + 'T12:00:00').getFullYear() === _bonusFilterYear);

    const yearIdx = _bonusFilterYear !== null ? availableYears.indexOf(_bonusFilterYear) : -1;
    const prevYear = yearIdx > 0 ? availableYears[yearIdx - 1] : null;
    const nextYear = yearIdx !== -1 && yearIdx < availableYears.length - 1 ? availableYears[yearIdx + 1] : null;

    const catBadgeClass = {
        Bonus: 'bonus-cat--bonus',
        'Tax Refund': 'bonus-cat--tax',
        'Cash Deposit': 'bonus-cat--bonus',
        'Check Deposit': 'bonus-cat--tax',
        Other: 'bonus-cat--other'
    };
    const purposeBadgeMeta = {
        cashFlow: { cls: 'bonus-purpose--cashflow', label: '💳 Cash Flow' },
        savings:  { cls: 'bonus-purpose--savings',  label: '🏦 Savings' }
    };

    const filterHtml = `
        <div class="bonus-filter-row">
            <button class="bonus-filter-nav" data-bonus-year-nav="prev"
                aria-label="${prevYear === null ? 'Previous year (none available)' : `Show ${prevYear}`}"${prevYear === null ? ' disabled aria-disabled="true"' : ''}>&#8249;</button>
            <span class="bonus-filter-label">${_bonusFilterYear ?? 'All time'}</span>
            <button class="bonus-filter-nav" data-bonus-year-nav="next"
                aria-label="${nextYear === null ? 'Next year (none available)' : `Show ${nextYear}`}"${nextYear === null ? ' disabled aria-disabled="true"' : ''}>&#8250;</button>
            ${_bonusFilterYear !== null
                ? `<button class="bonus-filter-all" data-bonus-show-all>All time</button>`
                : `<button class="bonus-filter-all" data-bonus-show-year="${currentYear}">This year</button>`
            }
        </div>`;

    const cardsHtml = filtered.length === 0
        ? `<p class="text-muted-secondary" style="padding:12px 0;font-size:0.9rem;">No entries for ${_bonusFilterYear ?? 'this period'}.</p>`
        : filtered.map(b => {
            const d = new Date(b.date + 'T12:00:00');
            const isThisMonth = d.getFullYear() === currentYear && d.getMonth() === currentMonth;
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
                                <option value="Bonus"        ${b.category==='Bonus'        ?'selected':''}>Bonus</option>
                                <option value="Tax Refund"   ${b.category==='Tax Refund'   ?'selected':''}>Tax Refund</option>
                                <option value="Cash Deposit" ${b.category==='Cash Deposit' ?'selected':''}>Cash Deposit</option>
                                <option value="Check Deposit"${b.category==='Check Deposit'?'selected':''}>Check Deposit</option>
                                <option value="Other"        ${b.category==='Other'        ?'selected':''}>Other</option>
                            </select>
                        </div>
                        <div class="form-group form-no-margin">
                            <label class="label-compact">Account</label>
                            <select id="be-account-${b.id}" class="form-full-width">
                                ${buildAccountOptionsHtml(app.accounts, b.accountId, { emptyLabel: '— No account —' })}
                            </select>
                        </div>
                        <div class="form-group form-no-margin">
                            <label class="label-compact">Purpose</label>
                            <select id="be-purpose-${b.id}" class="form-full-width">
                                <option value=""         ${!b.purpose             ?'selected':''}>— Not decided —</option>
                                <option value="cashFlow" ${b.purpose==='cashFlow' ?'selected':''}>💳 Cash Flow</option>
                                <option value="savings"  ${b.purpose==='savings'  ?'selected':''}>🏦 Savings</option>
                            </select>
                        </div>
                    </div>
                    <div class="income-edit-actions margin-top-auto">
                        <button class="btn btn-primary btn-small" data-bonus-action="save" data-bonus-id="${b.id}" aria-label="Save changes to ${escapeHtml(b.name)}">Save</button>
                        <button class="btn btn-secondary btn-small" data-bonus-action="cancel" aria-label="Cancel editing ${escapeHtml(b.name)}">Cancel</button>
                    </div>
                </div>`;
            }

            const purposeMeta = purposeBadgeMeta[b.purpose];
            const purposeBadge = purposeMeta
                ? `<span class="bonus-purpose-badge ${purposeMeta.cls}">${escapeHtml(purposeMeta.label)}</span>`
                : '';

            return `
            <div class="bonus-card${isThisMonth ? ' bonus-card--current' : ''}">
                <div class="bonus-card-info">
                    <span class="bonus-card-name">${escapeHtml(b.name)}</span>
                    <span class="bonus-card-amount">${formatCurrency(b.amount)}</span>
                    <span class="bonus-card-meta">${escapeHtml(dateStr)} &nbsp;·&nbsp; <span class="bonus-cat-badge ${badgeCls}">${escapeHtml(b.category)}</span>${purposeBadge ? ' ' + purposeBadge : ''}</span>
                    ${isThisMonth ? '<span class="bonus-this-month-tag">✅ Included in this month\'s income</span>' : ''}
                </div>
                <div class="debt-actions">
                    <button class="btn-edit" data-bonus-action="edit" data-bonus-id="${b.id}" aria-label="Edit ${escapeHtml(b.name)}">Edit</button>
                    <button class="btn btn-danger btn-small" data-bonus-action="delete" data-bonus-id="${b.id}" aria-label="Delete ${escapeHtml(b.name)}">Delete</button>
                </div>
            </div>`;
        }).join('');

    container.innerHTML = `
        <div class="bonus-list-wrap">
            <h4 class="bonus-list-title">One-time Bonuses &amp; Deposits</h4>
            ${filterHtml}
            ${cardsHtml}
        </div>`;

    container.onclick = event => {
        const navEl = event.target.closest('[data-bonus-year-nav]');
        if (navEl) {
            const dir = navEl.getAttribute('data-bonus-year-nav');
            if (dir === 'prev' && prevYear !== null) _bonusFilterYear = prevYear;
            if (dir === 'next' && nextYear !== null) _bonusFilterYear = nextYear;
            renderBonusList(app);
            return;
        }
        if (event.target.closest('[data-bonus-show-all]')) {
            _bonusFilterYear = null;
            renderBonusList(app);
            return;
        }
        const showYearEl = event.target.closest('[data-bonus-show-year]');
        if (showYearEl) {
            _bonusFilterYear = parseInt(showYearEl.getAttribute('data-bonus-show-year'), 10);
            renderBonusList(app);
            return;
        }
        const actionEl = event.target.closest('[data-bonus-action]');
        if (!actionEl) return;
        const action = actionEl.getAttribute('data-bonus-action');
        const id = parseInt(actionEl.getAttribute('data-bonus-id'), 10);
        if (action === 'cancel') { app.cancelEditBonus(); return; }
        if (Number.isNaN(id)) return;
        if (action === 'save') app.saveEditBonus(id);
        if (action === 'edit') app.startEditBonus(id);
        if (action === 'delete') app.deleteBonus(id);
    };
    renderIncomeTrendChart(app);
}

function _isDarkMode() { return document.body.classList.contains('dark-mode'); }

function _incomeTrendChartColors() {
    const dark = _isDarkMode();
    return { grid: dark ? '#374151' : '#e5e7eb', label: dark ? '#d1d5db' : '#374151' };
}

// Renders the "Income Trend" chart (issue #262): a stacked bar of regular
// income vs. one-time bonuses over a trailing 12/24-month range, with an
// optional dashed overlay line comparing each month against the same
// calendar month one year prior.
export function renderIncomeTrendChart(app) {
    const canvas = document.getElementById('incomeTrendChart');
    const card = document.getElementById('incomeTrendCard');
    if (!canvas || !card) return;
    if (app._incomeTrendChart) { app._incomeTrendChart.destroy(); app._incomeTrendChart = null; }

    if (app.incomes.length === 0 && app.bonuses.length === 0) {
        card.classList.add('hidden');
        return;
    }
    card.classList.remove('hidden');

    const rangeMonths = [12, 24].includes(app._incomeTrendRangeMonths) ? app._incomeTrendRangeMonths : 12;
    const showYoY = !!app._incomeTrendShowYoY;

    const rangeSelect = document.getElementById('incomeTrendRangeSelect');
    const yoyToggle = document.getElementById('incomeTrendYoYToggle');
    if (rangeSelect) rangeSelect.value = String(rangeMonths);
    if (yoyToggle) yoyToggle.checked = showYoY;

    const now = new Date();
    const months = [];
    for (let i = rangeMonths - 1; i >= 0; i--) {
        let m = now.getMonth() - i, y = now.getFullYear();
        while (m < 0) { m += 12; y--; }
        months.push({ year: y, month: m, label: new Date(y, m, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) });
    }

    // #251: net, consistent with the net figures shown everywhere else on this page.
    const regularTotals = months.map(({ year, month }) =>
        app.incomes.reduce((sum, inc) => sum + computeNetIncomeAmount(inc) * countIncomePaydaysInMonth(inc, year, month), 0));
    const bonusTotals = months.map(({ year, month }) => computeMonthlyBonusesForMonth(app.bonuses, year, month));
    const priorYearTotals = months.map(({ year, month }) =>
        app.incomes.reduce((sum, inc) => sum + computeNetIncomeAmount(inc) * countIncomePaydaysInMonth(inc, year - 1, month), 0)
        + computeMonthlyBonusesForMonth(app.bonuses, year - 1, month));

    const { grid, label } = _incomeTrendChartColors();
    const datasets = [
        { label: 'Regular Income', data: regularTotals, backgroundColor: '#2563eb', stack: 'income', borderRadius: 4 },
        { label: 'Bonuses', data: bonusTotals, backgroundColor: '#f59e0b', stack: 'income', borderRadius: 4 }
    ];
    if (showYoY) {
        datasets.push({
            type: 'line', label: 'Same month last year', data: priorYearTotals,
            borderColor: '#64748b', borderDash: [5, 5], borderWidth: 2, pointRadius: 2,
            backgroundColor: 'transparent', fill: false
        });
    }

    app._incomeTrendChart = new Chart(canvas, {
        type: 'bar',
        data: { labels: months.map(m => m.label), datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { stacked: true, ticks: { color: label }, grid: { color: grid } },
                y: { stacked: true, ticks: { color: label, callback: v => formatCurrency(v) }, grid: { color: grid } }
            },
            plugins: {
                legend: { position: 'bottom', labels: { color: label, boxWidth: 12, font: { size: 11 } } },
                tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}` } }
            }
        }
    });

    const columns = ['Month', 'Regular Income', 'Bonuses'];
    const rows = months.map((m, i) => [m.label, formatCurrency(regularTotals[i]), formatCurrency(bonusTotals[i])]);
    if (showYoY) {
        columns.push('Same month last year');
        rows.forEach((row, i) => row.push(formatCurrency(priorYearTotals[i])));
    }
    renderChartDataTable('incomeTrendChart', {
        caption: `Income trend — trailing ${rangeMonths} months`,
        columns, rows
    });

    if (rangeSelect) {
        rangeSelect.onchange = () => {
            app._incomeTrendRangeMonths = parseInt(rangeSelect.value, 10);
            app.renderIncomeTrendChart();
        };
    }
    if (yoyToggle) {
        yoyToggle.onchange = () => {
            app._incomeTrendShowYoY = yoyToggle.checked;
            app.renderIncomeTrendChart();
        };
    }
}
