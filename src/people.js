// Family member (person) management
import { normalizeText, escapeHtml, formatCurrency } from './utils.js';
import { pgPost, pgPatch, pgDelete } from './postgresSync.js';
import { showDeleteConfirmModal, showAlertModal, showPersonReplacementModal } from './ui.js';
import { renderOwnershipControl, getDebtShare, removePersonFromDebt } from './debtOwnership.js';
import { t, plural } from './i18n.js';

// Cycle member: ui.js → people.js → postgresSync.js → ui.js (safe: all exports are hoisted function declarations)

function _dtiStatus(dtiPct) {
    if (dtiPct < 28) return { cls: 'health-status--green', label: t('health.status.healthy') };
    if (dtiPct < 40) return { cls: 'health-status--yellow', label: t('health.status.moderate') };
    return { cls: 'health-status--red', label: t('health.status.highRisk') };
}

function _utilStatus(utilPct) {
    if (utilPct <= 10) return { cls: 'health-status--green', label: t('debts.utilStatusGood') };
    if (utilPct <= 30) return { cls: 'health-status--yellow', label: t('debts.utilStatusFair') };
    if (utilPct <= 50) return { cls: 'health-status--orange', label: t('debts.utilStatusHigh') };
    return { cls: 'health-status--red', label: utilPct >= 100 ? t('debts.utilStatusMaxed') : t('debts.utilStatusCritical') };
}

export function buildPersonOptionsHtml(persons, selectedId, { emptyLabel } = {}) {
    const empty = emptyLabel ? `<option value="">${emptyLabel}</option>` : '';
    const options = (persons || []).map(p =>
        `<option value="${p.id}"${selectedId === p.id ? ' selected' : ''}>${escapeHtml(p.name)}</option>`
    ).join('');
    return empty + options;
}

export function refreshPersonSelectors(app) {
    // Single-person selects (income form)
    for (const el of document.querySelectorAll('.person-selector')) {
        const val = el.value;
        el.innerHTML = buildPersonOptionsHtml(app.persons, null, { emptyLabel: escapeHtml(t('income.noPerson')) });
        el.value = val;
    }
    // Debt multi-select
    const debtPersonEl = document.getElementById('debtPersons');
    if (debtPersonEl) {
        const selected = new Set(Array.from(debtPersonEl.selectedOptions).map(o => o.value));
        debtPersonEl.innerHTML = (app.persons || []).map(p =>
            `<option value="${p.id}"${selected.has(String(p.id)) ? ' selected' : ''}>${escapeHtml(p.name)}</option>`
        ).join('');
        renderOwnershipControl(app, document.getElementById('debtOwnership'), debtPersonEl);
    }
}

function personAnnualIncome(app, personId) {
    return (app.incomes || [])
        .filter(inc => inc.personId === personId)
        .reduce((s, inc) => {
            const mult = inc.frequency === 'biweekly' ? 26
                : inc.frequency === 'weekly' ? 52
                : inc.frequency === 'twice_monthly' ? 24
                : 12;
            return s + (inc.amount || 0) * mult;
        }, 0);
}

export function renderPeopleList(app) {
    const listEl = document.getElementById('peopleList');
    if (!listEl) return;

    if ((app.persons || []).length === 0) {
        listEl.innerHTML = `<p class="empty-income-msg text-muted-secondary">${escapeHtml(t('people.emptyList'))}</p>`;
        return;
    }

    listEl.innerHTML = (app.persons || []).map(p => {
        if (app.editingPersonId === p.id) {
            return `
                <div class="income-card income-card--editing">
                    <div class="income-edit-form">
                        <div class="income-edit-grid">
                            <div class="form-group form-no-margin">
                                <label class="label-compact">${escapeHtml(t('people.nameLabel'))}</label>
                                <input type="text" id="pe-name-${p.id}" value="${escapeHtml(p.name)}" class="form-control form-full-width">
                            </div>
                        </div>
                        <div class="income-edit-actions">
                            <button class="btn btn-primary btn-small" data-person-action="save" data-person-id="${p.id}" aria-label="${escapeHtml(t('entity.saveChangesAria', { name: p.name }))}">${escapeHtml(t('common.save'))}</button>
                            <button class="btn btn-secondary btn-small" data-person-action="cancel" aria-label="${escapeHtml(t('entity.cancelEditAria', { name: p.name }))}">${escapeHtml(t('common.cancel'))}</button>
                        </div>
                    </div>
                </div>`;
        }

        const linkedDebts = (app.debts || []).filter(d => !d.archived && (d.personIds || []).includes(p.id));
        const linkedIncomes = (app.incomes || []).filter(inc => inc.personId === p.id);
        const annualIncome = personAnnualIncome(app, p.id);
        // #272: shared debts are attributed to each person by their ownership share
        // (equal share when the debt has no custom split).
        const totalDebt = linkedDebts.reduce((s, d) =>
            s + getDebtShare(d, p.id) * (d.debtType === 'fixedAmount' ? (d.fixedAmount || 0) : (d.accountBalance || 0)), 0);
        const ccDebts = linkedDebts.filter(d => d.debtType === 'creditCard' && d.creditLimit > 0);
        const totalBalance = ccDebts.reduce((s, d) => s + getDebtShare(d, p.id) * (d.accountBalance || 0), 0);
        const totalLimit = ccDebts.reduce((s, d) => s + getDebtShare(d, p.id) * d.creditLimit, 0);
        const utilPct = totalLimit > 0 ? Math.round((totalBalance / totalLimit) * 100) : 0;
        const monthlyIncome = annualIncome / 12;
        const totalMinPayment = linkedDebts.reduce((s, d) => s + getDebtShare(d, p.id) * (d.minimumPayment || 0), 0);
        const dtiPct = monthlyIncome > 0 ? Math.round((totalMinPayment / monthlyIncome) * 100) : null;

        const monthlyNet = monthlyIncome - totalMinPayment;
        const dtiSt = dtiPct !== null ? _dtiStatus(dtiPct) : null;
        const utilSt = totalLimit > 0 ? _utilStatus(utilPct) : null;

        const hasLinked = linkedIncomes.length > 0 || linkedDebts.length > 0;
        const linkedSummary = [
            linkedIncomes.length ? plural('people.linkedIncomes', linkedIncomes.length) : '',
            linkedDebts.length ? plural('people.linkedDebts', linkedDebts.length) : '',
        ].filter(Boolean).join(' · ');

        const utilTile = utilSt
            ? `<div class="person-kpi-tile" role="group" aria-label="${escapeHtml(t('people.creditUtilAria', { name: p.name, pct: utilPct }))}">
                    <span class="person-kpi-label">${escapeHtml(t('people.creditUtil'))}</span>
                    <span class="person-kpi-value health-badge ${utilSt.cls}">${utilPct}% <span class="person-kpi-status-label">${utilSt.label}</span></span>
               </div>`
            : `<div class="person-kpi-tile" role="group" aria-label="${escapeHtml(t('people.creditUtilNaAria', { name: p.name }))}">
                    <span class="person-kpi-label">${escapeHtml(t('people.creditUtil'))}</span>
                    <span class="person-kpi-value person-kpi--na">${escapeHtml(t('people.notAvailable'))}</span>
               </div>`;

        return `
            <div class="income-card">
                <div class="income-card-info">
                    <div class="person-card-header">
                        <span class="income-card-name">${escapeHtml(p.name)}</span>
                        ${dtiSt ? `<span class="health-badge health-badge--sm ${dtiSt.cls}" aria-label="${escapeHtml(t('people.dtiAria', { name: p.name, pct: dtiPct, status: dtiSt.label }))}">${escapeHtml(t('people.dtiBadge', { pct: dtiPct }))}</span>` : ''}
                    </div>
                    <div class="person-summary-card">
                        <div class="person-kpi-tile" role="group" aria-label="${escapeHtml(t('people.annualIncomeAria', { name: p.name, amount: formatCurrency(annualIncome) }))}">
                            <span class="person-kpi-label">${escapeHtml(t('people.annualIncome'))}</span>
                            <span class="person-kpi-value">${formatCurrency(annualIncome)}</span>
                        </div>
                        <div class="person-kpi-tile" role="group" aria-label="${escapeHtml(t('people.totalDebtAria', { name: p.name, amount: formatCurrency(totalDebt) }))}">
                            <span class="person-kpi-label">${escapeHtml(t('people.totalDebt'))}</span>
                            <span class="person-kpi-value">${formatCurrency(totalDebt)}</span>
                        </div>
                        <div class="person-kpi-tile" role="group" aria-label="${escapeHtml(t('people.monthlyNetAria', { name: p.name, amount: formatCurrency(monthlyNet) }))}">
                            <span class="person-kpi-label">${escapeHtml(t('people.monthlyNet'))}</span>
                            <span class="person-kpi-value ${monthlyNet >= 0 ? 'person-kpi--positive' : 'person-kpi--negative'}">${formatCurrency(monthlyNet)}</span>
                        </div>
                        ${utilTile}
                    </div>
                    ${hasLinked ? `
                    <details class="person-linked-details">
                        <summary>${linkedSummary}</summary>
                        <div class="person-linked-body">
                            ${linkedIncomes.length ? `
                            <div class="person-linked-section">
                                <div class="person-linked-label">${escapeHtml(t('people.incomeSources'))}</div>
                                ${linkedIncomes.map(inc => `
                                <button class="person-link-btn" data-person-nav="income" data-person-nav-id="${inc.id}">
                                    ${escapeHtml(inc.name)} &mdash; ${formatCurrency(inc.amount)}
                                </button>`).join('')}
                            </div>` : ''}
                            ${linkedDebts.length ? `
                            <div class="person-linked-section">
                                <div class="person-linked-label">${escapeHtml(t('nav.liabilities'))}</div>
                                ${linkedDebts.map(d => `
                                <button class="person-link-btn" data-person-nav="liabilities" data-person-nav-id="${d.id}">
                                    ${escapeHtml(d.name)} &mdash; ${formatCurrency(d.debtType === 'fixedAmount' ? (d.fixedAmount || 0) : (d.accountBalance || 0))}
                                </button>`).join('')}
                            </div>` : ''}
                        </div>
                    </details>` : ''}
                </div>
                <div class="debt-actions">
                    <button class="btn-edit" data-person-action="edit" data-person-id="${p.id}" aria-label="${escapeHtml(t('entity.editAria', { name: p.name }))}">${escapeHtml(t('common.edit'))}</button>
                    <button class="btn btn-danger btn-small" data-person-action="delete" data-person-id="${p.id}" aria-label="${escapeHtml(t('entity.deleteAria', { name: p.name }))}">${escapeHtml(t('common.delete'))}</button>
                </div>
            </div>`;
    }).join('');

    listEl.onclick = e => {
        const navEl = e.target.closest('[data-person-nav]');
        if (navEl) {
            const page = navEl.getAttribute('data-person-nav');
            const navId = parseInt(navEl.getAttribute('data-person-nav-id'), 10);
            app.switchPage(page);
            requestAnimationFrame(() => {
                const target = page === 'liabilities'
                    ? document.getElementById(`debt-card-${navId}`)
                    : document.getElementById(`income-card-${navId}`);
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
            return;
        }
        const el = e.target.closest('[data-person-action]');
        if (!el) return;
        const action = el.getAttribute('data-person-action');
        const id = parseInt(el.getAttribute('data-person-id'), 10);
        if (action === 'cancel') { app.cancelEditPerson(); return; }
        if (Number.isNaN(id)) return;
        if (action === 'save') app.saveEditPerson(id);
        if (action === 'edit') app.startEditPerson(id);
        if (action === 'delete') app.deletePerson(id);
    };
}

export async function addPerson(app) {
    const name = normalizeText(document.getElementById('personName')?.value, 80);
    if (!name) { await showAlertModal(t('people.errName')); return; }

    const person = { id: Date.now(), name };
    app.persons.push(person);
    app.saveToStorage();
    const saved = await pgPost(app, '/api/persons', person);
    if (saved?.id) person.id = saved.id;
    refreshPersonSelectors(app);
    app.renderPeopleList();
    document.getElementById('personForm')?.reset();
}

export async function deletePerson(app, personId) {
    const linkedDebts = (app.debts || []).filter(d => (d.personIds || []).includes(personId));
    const linkedIncomes = (app.incomes || []).filter(inc => inc.personId === personId);

    if (linkedDebts.length > 0) {
        const otherPersons = (app.persons || []).filter(p => p.id !== personId);
        const replacementId = await showPersonReplacementModal(app, personId, otherPersons, linkedDebts);
        if (replacementId === undefined) return; // cancelled

        for (let i = 0; i < app.debts.length; i++) {
            if (!(app.debts[i].personIds || []).includes(personId)) continue;
            // #272: also moves/renormalizes the removed person's ownership share.
            app.debts[i] = removePersonFromDebt(app.debts[i], personId, replacementId);
            pgPatch(app, `/api/debts/${app.debts[i].id}`, app.debts[i]);
        }
    }

    for (let i = 0; i < app.incomes.length; i++) {
        if (app.incomes[i].personId !== personId) continue;
        app.incomes[i] = { ...app.incomes[i], personId: null };
        pgPatch(app, `/api/incomes/${app.incomes[i].id}`, app.incomes[i]);
    }

    const confirmed = await showDeleteConfirmModal(t('people.deleteConfirm', { name: (app.persons.find(p => p.id === personId) || {}).name }));
    if (!confirmed) return;

    app.persons = app.persons.filter(p => p.id !== personId);
    app.saveToStorage();
    pgDelete(app, `/api/persons/${personId}`);
    refreshPersonSelectors(app);
    app.renderPeopleList();
    app.renderIncomeList();
    app.renderHealthDashboard();
}

export function startEditPerson(app, personId) {
    app.editingPersonId = personId;
    app.renderPeopleList();
    setTimeout(() => document.getElementById(`pe-name-${personId}`)?.focus(), 0);
}

export function cancelEditPerson(app) {
    app.editingPersonId = null;
    app.renderPeopleList();
}

export async function saveEditPerson(app, personId) {
    const nameEl = document.getElementById(`pe-name-${personId}`);
    if (!nameEl) return;
    const name = normalizeText(nameEl.value, 80);
    if (!name) { await showAlertModal(t('people.errName')); return; }

    const idx = app.persons.findIndex(p => p.id === personId);
    if (idx === -1) return;

    app.persons[idx] = { ...app.persons[idx], name };
    app.editingPersonId = null;
    app.saveToStorage();
    pgPatch(app, `/api/persons/${personId}`, app.persons[idx]);
    refreshPersonSelectors(app);
    app.renderPeopleList();
}
