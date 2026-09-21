// Family member (person) management
import { normalizeText, escapeHtml, formatCurrency } from './utils.js';
import { pgPost, pgPatch, pgDelete } from './postgresSync.js';
import { showDeleteConfirmModal, showAlertModal, showPersonReplacementModal } from './ui.js';

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
        el.innerHTML = buildPersonOptionsHtml(app.persons, null, { emptyLabel: '— No person —' });
        el.value = val;
    }
    // Debt multi-select
    const debtPersonEl = document.getElementById('debtPersons');
    if (debtPersonEl) {
        const selected = new Set(Array.from(debtPersonEl.selectedOptions).map(o => o.value));
        debtPersonEl.innerHTML = (app.persons || []).map(p =>
            `<option value="${p.id}"${selected.has(String(p.id)) ? ' selected' : ''}>${escapeHtml(p.name)}</option>`
        ).join('');
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
        listEl.innerHTML = '<p class="empty-income-msg text-muted-secondary">No family members added yet.</p>';
        return;
    }

    listEl.innerHTML = (app.persons || []).map(p => {
        if (app.editingPersonId === p.id) {
            return `
                <div class="income-card income-card--editing">
                    <div class="income-edit-form">
                        <div class="income-edit-grid">
                            <div class="form-group form-no-margin">
                                <label class="label-compact">Name *</label>
                                <input type="text" id="pe-name-${p.id}" value="${escapeHtml(p.name)}" class="form-control form-full-width">
                            </div>
                        </div>
                        <div class="income-edit-actions">
                            <button class="btn btn-primary btn-small" data-person-action="save" data-person-id="${p.id}">Save</button>
                            <button class="btn btn-secondary btn-small" data-person-action="cancel">Cancel</button>
                        </div>
                    </div>
                </div>`;
        }

        const linkedDebts = (app.debts || []).filter(d => !d.archived && (d.personIds || []).includes(p.id));
        const linkedIncomes = (app.incomes || []).filter(inc => inc.personId === p.id);
        const annualIncome = personAnnualIncome(app, p.id);
        const totalDebt = linkedDebts.reduce((s, d) =>
            s + (d.debtType === 'fixedAmount' ? (d.fixedAmount || 0) : (d.accountBalance || 0)), 0);
        const ccDebts = linkedDebts.filter(d => d.debtType === 'creditCard' && d.creditLimit > 0);
        const totalBalance = ccDebts.reduce((s, d) => s + (d.accountBalance || 0), 0);
        const totalLimit = ccDebts.reduce((s, d) => s + d.creditLimit, 0);
        const utilPct = totalLimit > 0 ? Math.round((totalBalance / totalLimit) * 100) : 0;
        const monthlyIncome = annualIncome / 12;
        const totalMinPayment = linkedDebts.reduce((s, d) => s + (d.minimumPayment || 0), 0);
        const dtiPct = monthlyIncome > 0 ? Math.round((totalMinPayment / monthlyIncome) * 100) : null;

        return `
            <div class="income-card">
                <div class="income-card-info">
                    <span class="income-card-name">${escapeHtml(p.name)}</span>
                    <span class="income-card-detail">${linkedIncomes.length} income source${linkedIncomes.length !== 1 ? 's' : ''} &mdash; Est. ${formatCurrency(annualIncome)}/yr</span>
                    <span class="income-card-detail">${linkedDebts.length} debt${linkedDebts.length !== 1 ? 's' : ''} &mdash; Balance: ${formatCurrency(totalDebt)}</span>
                    <span class="income-card-freq">Credit Util: ${utilPct}%${dtiPct !== null ? ` &nbsp;&bull;&nbsp; DTI: ${dtiPct}%` : ''}</span>
                </div>
                <div class="debt-actions">
                    <button class="btn-edit" data-person-action="edit" data-person-id="${p.id}">Edit</button>
                    <button class="btn btn-danger btn-small" data-person-action="delete" data-person-id="${p.id}">Delete</button>
                </div>
            </div>`;
    }).join('');

    listEl.onclick = e => {
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
    if (!name) { await showAlertModal('Please enter a name.'); return; }

    const person = { id: Date.now(), name };
    app.persons.push(person);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') {
        const saved = await pgPost(app, '/api/persons', person);
        if (saved?.id) person.id = saved.id;
    }
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
            const newIds = app.debts[i].personIds.filter(id => id !== personId);
            if (replacementId !== null && !newIds.includes(replacementId)) newIds.push(replacementId);
            app.debts[i] = { ...app.debts[i], personIds: newIds };
            if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/debts/${app.debts[i].id}`, app.debts[i]);
        }
    }

    for (let i = 0; i < app.incomes.length; i++) {
        if (app.incomes[i].personId !== personId) continue;
        app.incomes[i] = { ...app.incomes[i], personId: null };
        if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/incomes/${app.incomes[i].id}`, app.incomes[i]);
    }

    const confirmed = await showDeleteConfirmModal(`Delete "${(app.persons.find(p => p.id === personId) || {}).name}"?`);
    if (!confirmed) return;

    app.persons = app.persons.filter(p => p.id !== personId);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/persons/${personId}`);
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
    if (!name) { await showAlertModal('Please enter a name.'); return; }

    const idx = app.persons.findIndex(p => p.id === personId);
    if (idx === -1) return;

    app.persons[idx] = { ...app.persons[idx], name };
    app.editingPersonId = null;
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/persons/${personId}`, app.persons[idx]);
    refreshPersonSelectors(app);
    app.renderPeopleList();
}
