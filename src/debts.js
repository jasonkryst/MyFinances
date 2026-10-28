// Debt management and calculations
import { formatCurrency, getDayOrdinal, computeInterestPaidToDate, dailyCompoundInterest, normalizeText, sanitizeFiniteNumber, sanitizeInteger, sanitizeDateISO, escapeHtml, formatShortDate, formatMonthYear, todayISO, buildPersonPillsHtml } from './utils.js';
import { recalculatePaymentPlan } from './strategyPlanCalculation.js';
import { renderBreakEvenBadge } from './debtBreakEven.js';
import { pgPost, pgPatch, pgDelete } from './postgresSync.js';
import { showDeleteConfirmModal, showAlertModal, showArchiveConfirmModal } from './ui.js';
import { getSetting, SHOW_ARCHIVED_DEBTS } from './settings.js';
import { recordBalanceHistory, removeHistoryForOwner } from './balanceHistory.js';
import { renderOwnershipControl, readOwnershipSplit, buildOwnershipSplitHtml } from './debtOwnership.js';
import { sanitizeOwnershipSplit } from './sanitizers.js';

function utilizationStatus(pct) {
    if (pct <= 10) return { cls: 'health-status--green',  label: 'Good' };
    if (pct <= 30) return { cls: 'health-status--yellow', label: 'Fair' };
    if (pct <= 50) return { cls: 'health-status--orange', label: 'High' };
    return { cls: 'health-status--red', label: pct >= 100 ? 'Maxed' : 'Critical' };
}

function debtBalance(d) {
    return d.debtType === 'fixedAmount' ? (d.fixedAmount || 0) : (d.accountBalance || 0);
}

/**
 * #288: One group per person who appears in any debt's personIds, plus an
 * "Unassigned" group for debts with no linked person. A debt shared across
 * multiple people (personIds.length > 1) appears in each of their groups —
 * there's no single "owner" to pick for a shared debt.
 */
export function groupByPerson(debts, app) {
    const groups = new Map();
    const unassigned = [];
    for (const d of debts) {
        const personIds = d.personIds || [];
        if (personIds.length === 0) {
            unassigned.push(d);
            continue;
        }
        for (const personId of personIds) {
            if (!groups.has(personId)) {
                const person = (app.persons || []).find(p => p.id === personId);
                groups.set(personId, { key: `person-${personId}`, name: person ? person.name : 'Unknown Person', debts: [] });
            }
            groups.get(personId).debts.push(d);
        }
    }
    const sections = Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
    if (unassigned.length > 0) sections.push({ key: 'unassigned', name: 'Unassigned', debts: unassigned });
    return sections;
}

/**
 * #288: No dedicated "institution" field exists on debts, so the group key is
 * derived heuristically from the debt name — everything before the first
 * separator (-, –, —, comma, or open-paren), e.g. "Chase - Freedom" and
 * "Chase - Sapphire" both group under "Chase". Falls back to the full name
 * when no separator is present.
 */
export function groupByInstitution(debts) {
    const groups = new Map();
    for (const d of debts) {
        const name = (d.name || '').trim();
        const key = name ? (name.split(/[-–—,(]/)[0].trim() || name) : 'Other';
        if (!groups.has(key)) groups.set(key, { key, name: key, debts: [] });
        groups.get(key).debts.push(d);
    }
    return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function recalculateIfConfigured(app) {
    const monthlyPayment = parseFloat(document.getElementById('monthlyPayment').value);
    const strategy = document.getElementById('paymentStrategy').value;
    if (monthlyPayment && !isNaN(monthlyPayment) && monthlyPayment > 0) {
        recalculatePaymentPlan(app, {
            monthlyPayment, strategy,
            stimulus: app.perMonthStimulus && app.perMonthStimulus.length > 0 ? app.perMonthStimulus : 0,
            onError: (err) => console.error('Error recalculating plan after debt change', err)
        });
    }
}

export async function addDebt(app) {
    const debtType = document.getElementById('debtType').value;
    const name = normalizeText(document.getElementById('debtName').value, 80);
    const category = normalizeText(document.getElementById('debtCategory').value, 40);
    const priority = sanitizeInteger(document.getElementById('priority').value, null, { min: 1, max: 100 });
    const accountIdValue = document.getElementById('debtAccount').value;
    const accountId = accountIdValue ? parseInt(accountIdValue) : null;

    if (!name) {
        await showAlertModal('Please enter a debt name.');
        return;
    }

    const personIdsEl = document.getElementById('debtPersons');
    const personIds = personIdsEl
        ? Array.from(personIdsEl.selectedOptions).map(o => parseInt(o.value, 10)).filter(Number.isFinite)
        : [];

    const notes = normalizeText(document.getElementById('debtNotes')?.value ?? '', 500);
    const nextPaymentDue = sanitizeDateISO(document.getElementById('debtNextPaymentDue')?.value);
    const ownershipSplit = sanitizeOwnershipSplit(readOwnershipSplit(document.getElementById('debtOwnership')), personIds);

    const debt = {
        id: Date.now(),
        name,
        category,
        priority,
        debtType,
        accountId,
        personIds,
        ownershipSplit,
        notes,
        nextPaymentDue,
        updatedAt: todayISO()
    };

    if (debtType === 'fixedAmount') {
        const rawFixedAmount = document.getElementById('fixedAmount').value;
        const fixedAmount = sanitizeFiniteNumber(rawFixedAmount, NaN, { min: 0.01 });
        const fixedStartDate = sanitizeDateISO(document.getElementById('fixedStartDate').value);
        const fixedEndDate = sanitizeDateISO(document.getElementById('fixedEndDate').value);

        if (!rawFixedAmount || isNaN(Number(rawFixedAmount)) || Number(rawFixedAmount) <= 0 || !fixedStartDate || !fixedEndDate) {
            await showAlertModal('Please fill in all required fixed-amount debt fields.');
            return;
        }

        debt.fixedAmount = fixedAmount;
        debt.fixedStartDate = fixedStartDate;
        debt.fixedEndDate = fixedEndDate;
        debt.minimumPayment = fixedAmount;
    } else {
        const accountBalance = sanitizeFiniteNumber(document.getElementById('accountBalance').value, NaN, { min: 0 });
        const interestRate = sanitizeFiniteNumber(document.getElementById('interestRate').value, NaN, { min: 0, max: 100 });
        const minimumPayment = sanitizeFiniteNumber(document.getElementById('minimumPayment').value, NaN, { min: 0 });
        const dueDate = sanitizeInteger(document.getElementById('dueDate').value, NaN, { min: 1, max: 31 });
        const debtStartDate = sanitizeDateISO(document.getElementById('debtStartDate').value);

        if (isNaN(accountBalance) || isNaN(interestRate) || isNaN(minimumPayment) || isNaN(dueDate)) {
            await showAlertModal('Please fill in all required credit card debt fields.');
            return;
        }

        const creditLimitRaw = document.getElementById('creditLimit').value;
        const creditLimit = creditLimitRaw ? sanitizeFiniteNumber(creditLimitRaw, null, { min: 0 }) : null;

        debt.accountBalance = accountBalance;
        debt.originalBalance = accountBalance;
        debt.interestRate = interestRate;
        debt.minimumPayment = minimumPayment;
        debt.originalMinimumPayment = minimumPayment;
        debt.dueDate = dueDate;
        debt.debtStartDate = debtStartDate;
        debt.creditLimit = creditLimit;
    }

    app.debts.push(debt);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') {
        const saved = await pgPost(app, '/api/debts', debt);
        if (saved?.id) debt.id = saved.id;
    }
    await recordBalanceHistory(app, { kind: 'debt', id: debt.id });
    recalculateIfConfigured(app);
    app.updateUI();
    app.cancelEdit();
}

export async function deleteDebt(app, debtId) {
    const confirmed = await showDeleteConfirmModal('Delete this debt?');
    if (!confirmed) return;

    app.debts = app.debts.filter(d => d.id !== debtId);
    removeHistoryForOwner(app, { kind: 'debt', id: debtId });
    if (app.editingDebtId === debtId) app.editingDebtId = null;

    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/debts/${debtId}`);
    recalculateIfConfigured(app);
    app.updateUI();
}

export function isDebtPaidOff(debt) {
    if (debt.debtType === 'fixedAmount') {
        return !!(debt.fixedEndDate && new Date(debt.fixedEndDate) < new Date());
    }
    return (debt.accountBalance || 0) <= 0;
}

/**
 * Open celebration modal for a debt whose balance just reached zero (#294).
 * Mirrors openSinkingCompleteModal's structure/focus-trap in savings.js.
 */
async function openDebtPaidOffModal(app, debtId) {
    const debt = app.debts.find(d => d.id === debtId);
    if (!debt) return;
    const lastFocused = document.activeElement;
    const modal = document.createElement('div');
    modal.className = 'modal flex-visible';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'debtPaidOffTitle');
    modal.tabIndex = -1;  // lets modal.focus() succeed so Escape works before the button focus timer fires
    modal.innerHTML = `
      <div class="modal-card">
        <h3 class="modal-title" id="debtPaidOffTitle">🎉 Debt paid off!</h3>
        <p class="modal-message"><strong>${escapeHtml(debt.name)}</strong> is paid off. Congratulations!</p>
        <p class="modal-message">What would you like to do with it?</p>
        <div class="modal-actions">
          <button class="btn btn-primary" id="dpoArchiveBtn">Archive Debt</button>
          <button class="btn btn-secondary" id="dpoKeepBtn">Keep Active</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const close = () => {
        modal.remove();
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    };
    modal.onkeydown = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key === 'Tab') {
            const focusable = modal.querySelectorAll('button:not([disabled])');
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (!first || !last) return;
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    };
    modal.onclick = (e) => { if (e.target === modal) close(); };
    modal.querySelector('#dpoArchiveBtn').onclick = () => { close(); app.archiveDebt(debtId); };
    modal.querySelector('#dpoKeepBtn').onclick = close;
    modal.focus();
    setTimeout(() => modal.querySelector('#dpoArchiveBtn').focus(), 30);
}

export async function archiveDebt(app, debtId) {
    const debt = app.debts.find(d => d.id === debtId);
    if (!debt) return;
    const confirmed = await showArchiveConfirmModal(debt.name);
    if (!confirmed) return;

    debt.archived = true;
    debt.updatedAt = todayISO();
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/debts/${debtId}`, { archived: true, updatedAt: debt.updatedAt });
    recalculateIfConfigured(app);
    app.updateUI();
}

export async function unarchiveDebt(app, debtId) {
    const debt = app.debts.find(d => d.id === debtId);
    if (!debt) return;

    debt.archived = false;
    debt.updatedAt = todayISO();
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/debts/${debtId}`, { archived: false, updatedAt: debt.updatedAt });
    recalculateIfConfigured(app);
    app.updateUI();
}

export function showUpdateBalanceModal(app, debtId) {
    const id = typeof debtId === 'string' ? parseInt(debtId, 10) : debtId;
    const debt = app.debts.find(d => Number(d.id) === id);
    if (!debt || debt.debtType === 'fixedAmount') return;
    const modal = document.getElementById('updateBalanceModal');
    if (!modal) return;

    document.getElementById('updateBalanceDebtName').textContent = debt.name;
    document.getElementById('updateBalanceCurrent').textContent = formatCurrency(debt.accountBalance);

    const balInput = document.getElementById('updateBalanceInput');
    balInput.value = debt.accountBalance.toFixed(2);

    const origMin = debt.originalMinimumPayment ?? debt.minimumPayment ?? 0;
    document.getElementById('updateMinPaymentOriginal').textContent = formatCurrency(origMin);
    const minInput = document.getElementById('updateMinPaymentInput');
    minInput.value = (debt.minimumPayment ?? 0).toFixed(2);

    const lastFocused = document.activeElement;
    modal.classList.add('flex-visible'); modal.classList.remove('hidden');
    setTimeout(() => balInput.focus(), 50);

    const close = () => {
        modal.classList.add('hidden'); modal.classList.remove('flex-visible');
        modal.onkeydown = null;
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    };
    document.getElementById('confirmUpdateBalance').onclick = async () => {
        const newBal = parseFloat(balInput.value);
        if (isNaN(newBal) || newBal < 0) { await showAlertModal('Please enter a valid balance (0 or more).'); return; }
        const newMin = parseFloat(minInput.value);
        if (isNaN(newMin) || newMin < 0) { await showAlertModal('Please enter a valid minimum payment (0 or more).'); return; }
        updateDebtBalance(app, id, newBal, newMin);
        close();
    };
    document.getElementById('cancelUpdateBalanceBtn').onclick = close;
    document.getElementById('cancelUpdateBalance').onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };
    modal.onkeydown = (e) => {
        if (e.key === 'Escape') {
            close();
            return;
        }
        if (e.key === 'Tab') {
            const focusable = modal.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])');
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (!first || !last) return;
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    };
}

export async function updateDebtBalance(app, debtId, newBalance, newMinPayment) {
    const idx = app.debts.findIndex(d => Number(d.id) === Number(debtId));
    if (idx === -1) return;

    if (app.debts[idx].originalBalance == null) {
        app.debts[idx].originalBalance = app.debts[idx].accountBalance;
    }
    app.debts[idx].accountBalance = newBalance;

    if (newMinPayment !== undefined) {
        if (app.debts[idx].originalMinimumPayment === undefined) {
            app.debts[idx].originalMinimumPayment = app.debts[idx].minimumPayment ?? 0;
        }
        app.debts[idx].minimumPayment = newMinPayment;
    }
    app.debts[idx].updatedAt = todayISO();
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/debts/${app.debts[idx].id}`, app.debts[idx]);
    await recordBalanceHistory(app, { kind: 'debt', id: app.debts[idx].id });
    recalculateIfConfigured(app);
    app.renderDebtsList();
}

export async function saveEdit(app) {
    if (!app.editingDebtId) return;

    const name = normalizeText(document.getElementById('debtName').value, 80);
    const accountBalance = sanitizeFiniteNumber(document.getElementById('accountBalance').value, NaN, { min: 0 });
    const interestRate = sanitizeFiniteNumber(document.getElementById('interestRate').value, NaN, { min: 0, max: 100 });
    const priority = sanitizeInteger(document.getElementById('priority').value, null, { min: 1, max: 100 });
    const minimumPayment = sanitizeFiniteNumber(document.getElementById('minimumPayment').value, NaN, { min: 0 });
    const dueDate = sanitizeInteger(document.getElementById('dueDate').value, NaN, { min: 1, max: 31 });

    if (!name || isNaN(accountBalance) || isNaN(interestRate) || isNaN(minimumPayment) || isNaN(dueDate)) {
        await showAlertModal('Please fill in all required fields');
        return;
    }

    const idx = app.debts.findIndex(d => d.id === app.editingDebtId);
    if (idx === -1) return;

    const creditLimitRaw = document.getElementById('creditLimit').value;
    const creditLimit = creditLimitRaw ? sanitizeFiniteNumber(creditLimitRaw, null, { min: 0 }) : null;
    const personIdsEl = document.getElementById('debtPersons');
    const personIds = personIdsEl
        ? Array.from(personIdsEl.selectedOptions).map(o => parseInt(o.value, 10)).filter(Number.isFinite)
        : app.debts[idx].personIds || [];

    const notes = normalizeText(document.getElementById('debtNotes')?.value ?? '', 500);
    const nextPaymentDue = sanitizeDateISO(document.getElementById('debtNextPaymentDue')?.value);

    app.debts[idx] = {
        ...app.debts[idx],
        name,
        accountBalance,
        interestRate,
        priority,
        minimumPayment,
        dueDate,
        creditLimit,
        personIds,
        ownershipSplit: sanitizeOwnershipSplit(app.debts[idx].ownershipSplit, personIds),
        notes,
        nextPaymentDue
    };

    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/debts/${app.debts[idx].id}`, app.debts[idx]);
    await recordBalanceHistory(app, { kind: 'debt', id: app.debts[idx].id });
    app.updateUI();
    const monthlyPayment = parseFloat(document.getElementById('monthlyPayment').value);
    const strategy = document.getElementById('paymentStrategy').value;
    if (monthlyPayment && !isNaN(monthlyPayment) && monthlyPayment > 0) {
        recalculatePaymentPlan(app, {
            monthlyPayment, strategy,
            stimulus: app.perMonthStimulus && app.perMonthStimulus.length > 0 ? app.perMonthStimulus : 0,
            onError: (err) => console.error('Error recalculating after saveEdit', err)
        });
    }

    app.cancelEdit();
}

export function cancelEdit(app) {
    app.editingDebtId = null;
    document.getElementById('debtForm').reset();
    const submitBtn = document.getElementById('debtFormSubmit');
    if (submitBtn) submitBtn.textContent = 'Add Debt';
    const cancelBtn = document.getElementById('cancelEditBtn');
    if (cancelBtn) { cancelBtn.classList.add('hidden'); cancelBtn.classList.remove('visible'); }
    if (typeof window.closeDebtForm === 'function') window.closeDebtForm();
}

// Returns 0–1 payoff progress for a debt, or null if not calculable.
// Credit cards: (limit - balance) / limit. Fixed-amount: elapsed/total time.
// Other installment loans: null (no original balance stored) → sort to bottom.
function _debtPayoffProgress(debt) {
    if (debt.debtType === 'fixedAmount') {
        const start = new Date(debt.fixedStartDate + 'T12:00:00');
        const end = new Date(debt.fixedEndDate + 'T12:00:00');
        const total = end - start;
        if (!total || total <= 0) return null;
        const elapsed = Math.max(0, Math.min(Date.now() - start, total));
        return elapsed / total;
    }
    if (debt.creditLimit && debt.creditLimit > 0) {
        return Math.max(0, (debt.creditLimit - (debt.accountBalance || 0)) / debt.creditLimit);
    }
    return null;
}

// Returns utilization 0–N for a debt, or null if no credit limit.
function _debtUtilization(debt) {
    if (debt.creditLimit && debt.creditLimit > 0) {
        return (debt.accountBalance || 0) / debt.creditLimit;
    }
    return null;
}

/**
 * Render the Debts page list.
 */
export function renderDebtsList(app) {
    const categorySummary = document.getElementById('categorySummary');
    if (categorySummary) {
        if (app.debts.length === 0) {
            categorySummary.innerHTML = '';
        } else {
            const activeDebts = app.debts.filter(d => !d.archived);
            const totalDebt = activeDebts.reduce((s, d) => {
                return s + (d.debtType === 'fixedAmount' ? (d.fixedAmount || 0) : (d.accountBalance || 0));
            }, 0);
            const totalMin = activeDebts.reduce((s, d) => s + (d.minimumPayment || 0), 0);
            const totalInterest = app.lastSummary ? app.lastSummary.totalInterest : null;

            const catMap = {};
            for (const d of activeDebts) {
                const cat = d.category || 'Uncategorized';
                if (!catMap[cat]) catMap[cat] = { count: 0, total: 0, minTotal: 0 };
                catMap[cat].count++;
                catMap[cat].total += d.debtType === 'fixedAmount' ? (d.fixedAmount || 0) : (d.accountBalance || 0);
                catMap[cat].minTotal += d.minimumPayment || 0;
            }

            const catRows = Object.entries(catMap)
                .sort((a, b) => b[1].total - a[1].total)
                .map(([cat, v]) => `
                    <div class="debt-overview-cat-row">
                        <span class="debt-overview-cat-name">${escapeHtml(cat)}</span>
                        <span class="debt-overview-cat-count" data-label="Debts">${v.count} debt${v.count !== 1 ? 's' : ''}</span>
                        <span class="debt-overview-cat-min" data-label="Min/mo">${formatCurrency(v.minTotal)}/mo</span>
                        <span class="debt-overview-cat-total" data-label="Balance">${formatCurrency(v.total)}</span>
                    </div>`).join('');

            const interestHTML = totalInterest !== null
                ? `<div class="debt-overview-stat">
                        <span class="debt-overview-stat-label">Total Interest (projected)</span>
                        <span class="debt-overview-stat-value debt-overview-stat-value--interest">${formatCurrency(totalInterest)}</span>
                    </div>`
                : `<div class="debt-overview-stat">
                        <span class="debt-overview-stat-label">Total Interest (projected)</span>
                        <span class="debt-overview-stat-value debt-overview-stat-value--muted">Run a plan to see</span>
                    </div>`;

            categorySummary.innerHTML = `
                <div class="debt-overview-card">
                    <div class="debt-overview-header">📊 Debt Overview</div>
                    <div class="debt-overview-stats">
                        <div class="debt-overview-stat">
                            <span class="debt-overview-stat-label">Total Overall Debt</span>
                            <span class="debt-overview-stat-value">${formatCurrency(totalDebt)}</span>
                        </div>
                        <div class="debt-overview-stat">
                            <span class="debt-overview-stat-label">Monthly Minimums</span>
                            <span class="debt-overview-stat-value">${formatCurrency(totalMin)}</span>
                        </div>
                        ${interestHTML}
                    </div>
                    <div class="debt-overview-cats">
                        <div class="debt-overview-cats-header">
                            <span>Category</span>
                            <span>Count</span>
                            <span>Min/mo</span>
                            <span>Balance</span>
                        </div>
                        ${catRows}
                    </div>
                </div>`;
        }
    }

    const debtsList = document.getElementById('debtsList');
    debtsList.innerHTML = '';

    const showArchived = getSetting(app, SHOW_ARCHIVED_DEBTS, false);

    const categoryFilter = document.getElementById('categoryFilter');
    if (categoryFilter) {
        const visibleForFilter = showArchived ? app.debts : app.debts.filter(d => !d.archived);
        const categories = Array.from(new Set(visibleForFilter.map(d => d.category).filter(Boolean)));
        const prevValue = categoryFilter.value;
        categoryFilter.innerHTML = '<option value="">All</option>';
        categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            categoryFilter.appendChild(opt);
        });
        if (categories.includes(prevValue)) {
            categoryFilter.value = prevValue;
        }
    }

    // Populate account filter dropdown
    const accountFilter = document.getElementById('debtAccountFilter');
    if (accountFilter) {
        const prevAcct = accountFilter.value;
        accountFilter.innerHTML = '<option value="">All</option>';
        const linkedAccounts = Array.from(new Set(
            (showArchived ? app.debts : app.debts.filter(d => !d.archived))
                .map(d => d.accountId).filter(Boolean)
        ));
        linkedAccounts.forEach(id => {
            const acct = app.accounts?.find(a => a.id === id);
            if (!acct) return;
            const opt = document.createElement('option');
            opt.value = String(id);
            opt.textContent = acct.name;
            accountFilter.appendChild(opt);
        });
        if (linkedAccounts.map(String).includes(prevAcct)) accountFilter.value = prevAcct;
    }

    let filteredDebts = showArchived ? app.debts : app.debts.filter(d => !d.archived);
    if (categoryFilter && categoryFilter.value) {
        filteredDebts = filteredDebts.filter(d => d.category === categoryFilter.value);
    }

    if (accountFilter && accountFilter.value) {
        filteredDebts = filteredDebts.filter(d => String(d.accountId) === accountFilter.value);
    }

    const interestFilter = document.getElementById('debtInterestFilter');
    if (interestFilter && interestFilter.value === 'interestBearing') {
        filteredDebts = filteredDebts.filter(d => (d.interestRate || 0) > 0);
    } else if (interestFilter && interestFilter.value === 'noInterest') {
        filteredDebts = filteredDebts.filter(d => !((d.interestRate || 0) > 0));
    }

    const progressFilter = document.getElementById('debtProgressFilter');
    if (progressFilter && progressFilter.value) {
        filteredDebts = filteredDebts.filter(d => {
            const pct = _debtPayoffProgress(d);
            if (pct === null) return false;
            if (progressFilter.value === 'inprogress') return pct > 0 && pct < 1;
            if (progressFilter.value === 'half') return pct >= 0.5;
            if (progressFilter.value === 'most') return pct >= 0.75;
            if (progressFilter.value === 'paid') return pct >= 1;
            return true;
        });
    }

    const utilizationFilter = document.getElementById('debtUtilizationFilter');
    if (utilizationFilter && utilizationFilter.value) {
        filteredDebts = filteredDebts.filter(d => {
            const util = _debtUtilization(d);
            if (util === null) return false;
            if (utilizationFilter.value === 'low') return util < 0.30;
            if (utilizationFilter.value === 'medium') return util >= 0.30 && util <= 0.70;
            if (utilizationFilter.value === 'high') return util > 0.70;
            return true;
        });
    }

    const sortBy = document.getElementById('debtSortBy')?.value || '';
    if (sortBy) {
        filteredDebts = [...filteredDebts].sort((a, b) => {
            if (sortBy === 'balance-desc' || sortBy === 'balance-asc') {
                const va = a.debtType === 'fixedAmount' ? (a.fixedAmount || 0) : (a.accountBalance || 0);
                const vb = b.debtType === 'fixedAmount' ? (b.fixedAmount || 0) : (b.accountBalance || 0);
                return sortBy === 'balance-desc' ? vb - va : va - vb;
            }
            if (sortBy === 'interest-desc' || sortBy === 'interest-asc') {
                const va = a.interestRate || 0, vb = b.interestRate || 0;
                return sortBy === 'interest-desc' ? vb - va : va - vb;
            }
            if (sortBy === 'minpay-desc' || sortBy === 'minpay-asc') {
                const va = a.minimumPayment || 0, vb = b.minimumPayment || 0;
                return sortBy === 'minpay-desc' ? vb - va : va - vb;
            }
            if (sortBy === 'progress-desc' || sortBy === 'progress-asc') {
                const va = _debtPayoffProgress(a), vb = _debtPayoffProgress(b);
                if (va === null && vb === null) return 0;
                if (va === null) return 1;
                if (vb === null) return -1;
                return sortBy === 'progress-desc' ? vb - va : va - vb;
            }
            if (sortBy === 'utilization-desc' || sortBy === 'utilization-asc') {
                const va = _debtUtilization(a), vb = _debtUtilization(b);
                if (va === null && vb === null) return 0;
                if (va === null) return 1;
                if (vb === null) return -1;
                return sortBy === 'utilization-desc' ? vb - va : va - vb;
            }
            if (sortBy === 'due-asc') {
                const va = a.dueDate || 32, vb = b.dueDate || 32;
                return va - vb;
            }
            return 0;
        });
    }

    const groupBy = document.getElementById('debtGroupBy')?.value || '';
    let sections;
    if (groupBy === 'person') {
        sections = groupByPerson(filteredDebts, app);
    } else if (groupBy === 'institution') {
        sections = groupByInstitution(filteredDebts);
    } else {
        sections = [{ key: null, name: null, debts: filteredDebts }];
    }

    if (filteredDebts.length > 0) {
        const bulkBar = document.createElement('div');
        bulkBar.id = 'debtBulkBar';
        bulkBar.className = 'debt-bulk-bar';
        bulkBar.innerHTML = `<span id="debtBulkCount" class="debt-bulk-count" aria-live="polite"></span>
            <button id="debtBulkArchiveBtn" class="btn btn-secondary btn-small">📦 Archive</button>
            <button id="debtBulkExportBtn" class="btn btn-secondary btn-small">⬇️ Export CSV</button>
            <button id="debtBulkDeleteBtn" class="btn btn-danger btn-small">🗑️ Delete</button>`;
        debtsList.appendChild(bulkBar);
    }

    const _cardIdCounts = new Map();
    for (const section of sections) {
        if (section.name) {
            const groupTotal = section.debts.reduce((s, d) => s + debtBalance(d), 0);
            const groupMin = section.debts.reduce((s, d) => s + (d.minimumPayment || 0), 0);
            const header = document.createElement('div');
            header.className = 'debt-group-header';
            header.innerHTML = `
                <span class="debt-group-header-name">${escapeHtml(section.name)}</span>
                <span class="debt-group-header-summary">
                    ${section.debts.length} debt${section.debts.length !== 1 ? 's' : ''} &middot;
                    ${formatCurrency(groupTotal)} balance &middot;
                    ${formatCurrency(groupMin)}/mo min
                </span>`;
            debtsList.appendChild(header);
        }

        for (const debt of section.debts) {
        const card = document.createElement('div');
        card.className = 'debt-card';
        // A debt shared across multiple people (personIds.length > 1) renders once per
        // group under Person grouping — keep DOM ids unique so #debt-card-<id> lookups
        // (ledger/people-page "jump to debt" links) still resolve to a real element.
        const baseCardId = `debt-card-${debt.id}`;
        const seenCount = _cardIdCounts.get(baseCardId) || 0;
        card.id = seenCount === 0 ? baseCardId : `${baseCardId}-dup${seenCount}`;
        _cardIdCounts.set(baseCardId, seenCount + 1);

        const summaryRow = app._debtSummaryRows?.find(r => r.name === debt.name);
        const payoffDetailHTML = (summaryRow && summaryRow.payoffDate)
            ? `<div class="debt-detail debt-payoff-detail"><strong>📅 Payoff Date:</strong> ${summaryRow.payoffDate}</div>`
            : `<div class="debt-detail debt-payoff-detail debt-payoff-detail--muted"><strong>📅 Payoff Date:</strong> <span class="text-muted">Run a plan to see</span></div>`;

        if (app.editingDebtId === debt.id) {
            let editHTML = `
                <div class="debt-info">
                    <div class="debt-name"><input id="inline-name-${debt.id}" type="text" value="${escapeHtml(debt.name)}"></div>
                    <div class="debt-details">`;

            if (debt.debtType === 'fixedAmount') {
                editHTML += `
                        <div class="debt-detail"><strong>Amount:</strong> <input id="inline-fixed-amount-${debt.id}" type="number" step="0.01" value="${debt.fixedAmount}"></div>
                        <div class="debt-detail"><strong>Start Date:</strong> <input id="inline-start-date-${debt.id}" type="date" value="${debt.fixedStartDate}"></div>
                        <div class="debt-detail"><strong>End Date:</strong> <input id="inline-end-date-${debt.id}" type="date" value="${debt.fixedEndDate}"></div>
                        <div class="debt-detail"><strong>Priority:</strong> <input id="inline-priority-${debt.id}" type="number" min="1" max="100" value="${debt.priority || ''}"></div>`;
            } else {
                editHTML += `
                        <div class="debt-detail"><strong>Balance:</strong> <input id="inline-balance-${debt.id}" type="number" step="0.01" value="${debt.accountBalance}"></div>
                        <div class="debt-detail"><strong>Interest:</strong> <input id="inline-interest-${debt.id}" type="number" step="0.01" value="${debt.interestRate}">% </div>
                        <div class="debt-detail"><strong>Min Payment:</strong> <input id="inline-min-${debt.id}" type="number" step="0.01" value="${debt.minimumPayment}"></div>
                        <div class="debt-detail"><strong>Due Date:</strong> <input id="inline-due-${debt.id}" type="number" min="1" max="31" value="${debt.dueDate}"></div>
                        <div class="debt-detail"><strong>Priority:</strong> <input id="inline-priority-${debt.id}" type="number" min="1" max="100" value="${debt.priority || ''}"></div>
                        <div class="debt-detail"><strong>Date Opened:</strong> <input id="inline-start-date-cc-${debt.id}" type="date" value="${debt.debtStartDate || ''}"></div>
                        <div class="debt-detail"><strong>Credit Limit:</strong> <input id="inline-credit-limit-${debt.id}" type="number" step="0.01" min="0" placeholder="optional" value="${debt.creditLimit != null ? debt.creditLimit : ''}"></div>`;
            }

            editHTML += `
                        <div class="debt-detail"><strong>Category:</strong> <input id="inline-category-${debt.id}" type="text" value="${escapeHtml(debt.category || '')}"></div>
                        <div class="debt-detail"><strong>Account:</strong>
                            <select id="inline-account-${debt.id}">
                                <option value="">— No account —</option>
                                ${app.accounts.map(a => `<option value="${a.id}" ${debt.accountId === a.id ? 'selected' : ''}>${escapeHtml(a.name)} (${escapeHtml(a.type)})</option>`).join('')}
                            </select>
                        </div>
                        ${(app.persons || []).length > 0 ? `
                        <div class="debt-detail"><strong>People:</strong>
                            <select id="inline-persons-${debt.id}" multiple data-ownership-for="inline-ownership-${debt.id}">
                                ${(app.persons).map(p => `<option value="${p.id}"${(debt.personIds || []).includes(p.id) ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                            </select>
                            <div id="inline-ownership-${debt.id}" class="ownership-control hidden"></div>
                        </div>` : ''}
                        <div class="debt-detail debt-detail--notes"><strong>Notes:</strong>
                            <textarea id="inline-notes-${debt.id}" rows="2" maxlength="500" placeholder="Optional notes…">${escapeHtml(debt.notes || '')}</textarea>
                        </div>
                        <div class="debt-detail"><strong>Next Payment Due:</strong> <input id="inline-next-due-${debt.id}" type="date" value="${debt.nextPaymentDue || ''}"></div>
                    </div>
                </div>
                <div class="debt-actions">
                    <button class="btn btn-success btn-save" data-debt-action="save-inline" data-debt-id="${debt.id}" aria-label="Save changes to ${escapeHtml(debt.name)}">Save</button>
                    <button class="btn btn-secondary btn-cancel" data-debt-action="cancel-inline" aria-label="Cancel editing ${escapeHtml(debt.name)}">Cancel</button>
                </div>
            `;
            card.innerHTML = editHTML;
            renderOwnershipControl(app, card.querySelector(`#inline-ownership-${debt.id}`), card.querySelector(`#inline-persons-${debt.id}`), debt.ownershipSplit || null);
        } else {
            let cardHTML = `<label class="debt-select-label"><input type="checkbox" class="debt-row-select" data-debt-select="${debt.id}" aria-label="Select ${escapeHtml(debt.name)}"></label>
                <div class="debt-info">
                    <div class="debt-name">${escapeHtml(debt.name)}`;
            if (debt.debtType === 'fixedAmount') {
                cardHTML += ` <span class="debt-type-badge">Fixed Amount</span>`;
            }
            const personPills = buildPersonPillsHtml(debt.personIds, app.persons);
            const splitHtml = buildOwnershipSplitHtml(debt, app.persons);
            cardHTML += `</div>
                    ${personPills ? `<div class="person-pills debt-person-pills">${personPills}</div>` : ''}
                    ${splitHtml ? `<div class="debt-ownership-split text-muted-secondary" data-ownership-split>Ownership: ${splitHtml}</div>` : ''}
                    <div class="debt-details">`;

            if (debt.debtType === 'fixedAmount') {
                const start = new Date(debt.fixedStartDate);
                const end = new Date(debt.fixedEndDate);
                const now = new Date();
                const total = end - start;
                const elapsed = Math.max(0, Math.min(now - start, total));
                const fixedPct = total > 0 ? Math.min(100, Math.round(elapsed / total * 100)) : 0;

                cardHTML += `
                        <div class="debt-detail">
                            <strong>Monthly Amount:</strong> ${formatCurrency(debt.fixedAmount)}
                        </div>
                        <div class="debt-detail">
                            <strong>Period:</strong> ${debt.fixedStartDate} to ${debt.fixedEndDate}
                        </div>
                        ${payoffDetailHTML}
                        ${debt.priority ? `
                            <div class="debt-detail">
                                <strong>Priority:</strong> ${debt.priority}/100
                            </div>
                        ` : ''}`;
                cardHTML += `</div>
                    <div class="debt-progress-wrap">
                        <div class="debt-progress-label"><span>Time elapsed</span><span>${fixedPct}%</span></div>
                        <div class="debt-progress-bar"><div class="debt-progress-fill${fixedPct >= 100 ? ' debt-progress-fill--complete' : ''}" data-progress-width="${fixedPct}"></div></div>
                    </div>`;
            } else {
                const monthlyInterest = dailyCompoundInterest(debt.accountBalance, debt.interestRate, 30);
                const negAmortRisk = debt.minimumPayment <= monthlyInterest && debt.minimumPayment > 0;
                const origBal = debt.originalBalance || debt.accountBalance;

                const minPayMonths = (() => {
                    const P = debt.accountBalance, r = debt.interestRate / 100 / 12, M = debt.minimumPayment;
                    if (!P || !r || !M || M <= P * r) return null;
                    return Math.ceil(-Math.log(1 - (r * P) / M) / Math.log(1 + r));
                })();
                const minPayTrapMonths = (minPayMonths !== null && minPayMonths > 36) ? minPayMonths : null;
                const minPayTrapInterest = minPayTrapMonths
                    ? (() => {
                        const totalPaid = debt.minimumPayment * minPayTrapMonths;
                        return Math.max(0, totalPaid - debt.accountBalance);
                    })()
                    : null;
                const progressPct = origBal > 0 ? Math.min(100, Math.round((origBal - debt.accountBalance) / origBal * 100)) : 0;
                const iptd = computeInterestPaidToDate(debt);

                cardHTML += `
                        <div class="debt-detail">
                            <strong>Balance:</strong> ${formatCurrency(debt.accountBalance)}
                            ${origBal > debt.accountBalance ? `<span class="amount-secondary">(was ${formatCurrency(origBal)})</span>` : ''}
                        </div>
                        <div class="debt-detail">
                            <strong>Interest:</strong> ${debt.interestRate.toFixed(2)}%
                            <span class="text-monthly-interest">≈ ${formatCurrency(monthlyInterest)}/mo</span>
                        </div>
                        <div class="debt-detail">
                            <strong>Min Payment:</strong> ${formatCurrency(debt.minimumPayment)}
                            ${debt.originalMinimumPayment !== undefined && debt.originalMinimumPayment !== debt.minimumPayment
                                ? `<span class="amount-secondary">(originally ${formatCurrency(debt.originalMinimumPayment)})</span>`
                                : ''}
                            ${negAmortRisk ? `<span class="neg-amort-badge" title="Your minimum payment barely covers interest — the balance may never decrease!">⚠️ Neg. amortization risk</span>` : ''}
                        </div>
                        <div class="debt-detail">
                            <strong>Due Date:</strong> ${getDayOrdinal(debt.dueDate)} of month
                        </div>
                        ${debt.nextPaymentDue ? `
                        <div class="debt-detail">
                            <strong>Next Payment Due:</strong> ${formatShortDate(debt.nextPaymentDue)}
                        </div>` : ''}
                        ${debt.debtStartDate ? `
                        <div class="debt-detail">
                            <strong>Opened:</strong> ${formatShortDate(debt.debtStartDate)}
                        </div>` : ''}
                        ${iptd ? `
                        <div class="debt-detail iptd-detail">
                            <strong>Est. interest paid to date:</strong>
                            <span class="iptd-value">${formatCurrency(iptd.interestPaid)}</span>
                            <span class="iptd-sub">over ${iptd.days} days since ${formatMonthYear(iptd.start)}</span>
                        </div>` : ''}
                        ${payoffDetailHTML}
                        ${minPayTrapMonths ? `
                        <div class="debt-detail debt-min-trap-warn">
                            <span class="debt-min-trap-badge">⚠️ Min. payment trap</span>
                            At this rate: <strong>${(minPayTrapMonths / 12).toFixed(1)} years</strong> to pay off
                            ${minPayTrapInterest !== null ? `— costing <strong>${formatCurrency(minPayTrapInterest)}</strong> in interest` : ''}
                        </div>` : ''}
                        ${debt.priority ? `
                            <div class="debt-detail">
                                <strong>Priority:</strong> ${debt.priority}/100
                            </div>
                        ` : ''}`;
                let utilHTML = '';
                if (debt.creditLimit != null && debt.creditLimit > 0) {
                    const rawUtilPct = Math.round((debt.accountBalance / debt.creditLimit) * 100);
                    const utilPct = Math.min(rawUtilPct, 100);
                    const utilSt = utilizationStatus(rawUtilPct);
                    const fillCls = utilSt.cls === 'health-status--green' ? 'util-fill--green'
                        : utilSt.cls === 'health-status--yellow' ? 'util-fill--yellow'
                        : utilSt.cls === 'health-status--orange' ? 'util-fill--orange'
                        : 'util-fill--red';
                    utilHTML = `
                    <div class="debt-progress-wrap">
                        <div class="debt-progress-label">
                            <span>Credit utilization</span>
                            <span class="debt-util-badge health-badge ${utilSt.cls}">${utilSt.label} &mdash; ${rawUtilPct}%${rawUtilPct >= 100 ? ' ⚠' : ''}</span>
                        </div>
                        <div class="debt-progress-bar"><div class="debt-progress-fill ${fillCls}" data-progress-width="${utilPct}"></div></div>
                        <div class="debt-util-detail">${formatCurrency(debt.accountBalance)} of ${formatCurrency(debt.creditLimit)} limit</div>
                    </div>`;
                }

                cardHTML += `</div>
                    <div class="debt-progress-wrap">
                        <div class="debt-progress-label"><span>Payoff progress</span><span>${progressPct}%</span></div>
                        <div class="debt-progress-bar"><div class="debt-progress-fill${progressPct >= 100 ? ' debt-progress-fill--complete' : ''}" data-progress-width="${progressPct}"></div></div>
                    </div>${utilHTML}`;
            }

            cardHTML += `
                        ${debt.category ? `
                            <div class="debt-detail">
                                <strong>Category:</strong> ${escapeHtml(debt.category)}
                            </div>
                        ` : ''}
                        ${debt.notes ? `
                            <div class="debt-detail debt-notes-display">
                                ${escapeHtml(debt.notes)}
                            </div>
                        ` : ''}
                        ${debt.updatedAt ? `
                            <div class="debt-detail">
                                <strong>Last updated:</strong> <span class="text-muted">${formatShortDate(debt.updatedAt)}</span>
                            </div>
                        ` : ''}
                </div>
                <div class="debt-actions">
                    ${debt.archived
                        ? `<span class="debt-archived-badge">Archived</span>
                           <button class="btn btn-secondary btn-small" data-debt-action="history" data-debt-id="${debt.id}" aria-label="History for ${escapeHtml(debt.name)}">History</button>
                           <button class="btn btn-secondary btn-small" data-debt-action="unarchive" data-debt-id="${debt.id}" aria-label="Unarchive ${escapeHtml(debt.name)}">Unarchive</button>`
                        : `<button class="btn-edit" data-debt-action="edit" data-debt-id="${debt.id}" aria-label="Edit ${escapeHtml(debt.name)}">Edit</button>
                           ${debt.debtType !== 'fixedAmount' ? `<button class="btn btn-secondary btn-small" data-debt-action="update-balance" data-debt-id="${debt.id}" aria-label="Update Balance for ${escapeHtml(debt.name)}">Update Balance</button>` : ''}
                           <button class="btn btn-secondary btn-small" data-debt-action="history" data-debt-id="${debt.id}" aria-label="History for ${escapeHtml(debt.name)}">History</button>
                           ${debt.debtType !== 'fixedAmount' && debt.accountBalance > 0 && debt.interestRate > 0 ? `<button class="btn btn-secondary btn-small debt-breakeven-btn" data-be-shortcut="${debt.id}" aria-label="Run break-even analysis for ${escapeHtml(debt.name)}">Break-even</button>` : ''}
                           ${isDebtPaidOff(debt) ? `<button class="btn btn-primary btn-small debt-paid-off-btn" data-debt-action="celebrate" data-debt-id="${debt.id}" aria-label="Debt paid off: ${escapeHtml(debt.name)}">🎉 Debt Paid Off!</button>` : ''}
                           <button class="btn-delete" data-debt-action="delete" data-debt-id="${debt.id}" aria-label="Delete ${escapeHtml(debt.name)}">Delete</button>`
                    }
                </div>
            `;
            card.innerHTML = cardHTML;
            card.querySelectorAll('[data-progress-width]').forEach(el =>
                el.style.setProperty('--progress-width', el.dataset.progressWidth + '%'));
        }

        debtsList.appendChild(card);

        // Render break-even badge for credit-card debts
        if (debt.debtType !== 'fixedAmount' && app.editingDebtId !== debt.id) {
            renderBreakEvenBadge(app, debt, card);
        }
        }
    }

    if (filteredDebts.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-state';
        if (app.debts.length === 0) {
            emptyDiv.innerHTML = `<div class="empty-state__icon">💳</div>
                <h3 class="empty-state__heading">No debts tracked yet</h3>
                <p class="empty-state__body">Add a debt to start calculating your payoff plan and see how quickly you can become debt-free.</p>
                <button class="btn btn-primary empty-state__cta" id="debtEmptyStateCta">Add Your First Debt</button>`;
        } else {
            emptyDiv.innerHTML = `<div class="empty-state__icon">🔍</div>
                <h3 class="empty-state__heading">No debts match your filters</h3>
                <p class="empty-state__body">Try adjusting the filters above to see more debts.</p>`;
        }
        debtsList.appendChild(emptyDiv);
        document.getElementById('debtEmptyStateCta')?.addEventListener('click', () => {
            const toggle = document.getElementById('debtFormToggle');
            if (toggle) toggle.click();
        });
    }

    function _updateDebtBulkBar() {
        const checked = debtsList.querySelectorAll('.debt-row-select:checked');
        const n = checked.length;
        const bar = document.getElementById('debtBulkBar');
        if (bar) bar.classList.toggle('debt-bulk-bar--visible', n > 0);
        const countEl = document.getElementById('debtBulkCount');
        if (countEl) countEl.textContent = n > 0 ? `${n} debt${n !== 1 ? 's' : ''} selected` : '';
    }
    debtsList.querySelectorAll('.debt-row-select').forEach(cb => { cb.onchange = _updateDebtBulkBar; });

    document.getElementById('debtBulkArchiveBtn')?.addEventListener('click', async () => {
        const ids = Array.from(debtsList.querySelectorAll('.debt-row-select:checked'))
            .map(cb => parseInt(cb.dataset.debtSelect, 10));
        if (!ids.length) return;
        const ok = await showDeleteConfirmModal(`Archive ${ids.length} debt${ids.length !== 1 ? 's' : ''}?`);
        if (!ok) return;
        for (const id of ids) {
            const d = app.debts.find(x => x.id === id);
            if (d) { d.archived = true; if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/debts/${id}`, d); }
        }
        app.saveToStorage();
        renderDebtsList(app);
    });

    document.getElementById('debtBulkExportBtn')?.addEventListener('click', () => {
        const ids = Array.from(debtsList.querySelectorAll('.debt-row-select:checked'))
            .map(cb => parseInt(cb.dataset.debtSelect, 10));
        if (!ids.length) return;
        const rows = app.debts.filter(d => ids.includes(d.id)).map(d => [
            JSON.stringify(d.name || ''), JSON.stringify(d.debtType || ''),
            d.accountBalance ?? d.fixedAmount ?? 0, d.interestRate ?? 0,
            d.minimumPayment ?? 0, d.dueDate ?? '', JSON.stringify(d.category || '')
        ].join(','));
        const csv = ['Name,Type,Balance,Rate,MinPayment,DueDate,Category', ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `debts-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    });

    document.getElementById('debtBulkDeleteBtn')?.addEventListener('click', async () => {
        const ids = Array.from(debtsList.querySelectorAll('.debt-row-select:checked'))
            .map(cb => parseInt(cb.dataset.debtSelect, 10));
        if (!ids.length) return;
        const ok = await showDeleteConfirmModal(`Delete ${ids.length} debt${ids.length !== 1 ? 's' : ''}? This cannot be undone.`);
        if (!ok) return;
        if (app._storageBackendKind === 'postgres') for (const id of ids) pgDelete(app, `/api/debts/${id}`);
        app.debts = app.debts.filter(d => !ids.includes(d.id));
        app.saveToStorage();
        renderDebtsList(app);
        app.refreshCurrentPageData?.();
    });

    debtsList.onclick = (event) => {
        // D-03: Break-even shortcut button in the debt actions row
        const shortcutEl = event.target.closest('[data-be-shortcut]');
        if (shortcutEl) {
            const id = parseInt(shortcutEl.getAttribute('data-be-shortcut'), 10);
            const debt = app.debts.find(d => d.id === id);
            const card = shortcutEl.closest('.debt-card');
            if (debt && card) {
                const s = card.querySelector('.break-even-section');
                if (s) s.dataset.revealed = 'true';
                renderBreakEvenBadge(app, debt, card);
                card.querySelector('.break-even-section')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
            return;
        }

        // Break-even "Show payoff estimate" inline link
        const showEl = event.target.closest('[data-be-show]');
        if (showEl) {
            const id = parseInt(showEl.getAttribute('data-be-show'), 10);
            const debt = app.debts.find(d => d.id === id);
            const card = showEl.closest('.debt-card');
            if (debt && card) {
                const s = card.querySelector('.break-even-section');
                if (s) s.dataset.revealed = 'true';
                renderBreakEvenBadge(app, debt, card);
                card.querySelector('.break-even-section')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
            return;
        }

        // Break-even toggle (min type or pct)
        const toggleEl = event.target.closest('.be-min-type, .be-min-pct');
        if (toggleEl) return; // handled by change event below

        // Accelerate button
        const accEl = event.target.closest('[data-be-accelerate]');
        if (accEl) {
            const id = parseInt(accEl.getAttribute('data-be-accelerate'), 10);
            app.showAccelerateModal(id);
            return;
        }

        const actionEl = event.target.closest('[data-debt-action]');
        if (!actionEl) return;
        const action = actionEl.getAttribute('data-debt-action');
        const id = parseInt(actionEl.getAttribute('data-debt-id'), 10);

        if (action === 'cancel-inline') {
            app.cancelInlineEdit();
            return;
        }

        if (Number.isNaN(id)) return;
        if (action === 'save-inline') app.saveInlineEdit(id);
        if (action === 'edit') app.startEdit(id);
        if (action === 'update-balance') app.showUpdateBalanceModal(id);
        if (action === 'history') app.showBalanceHistoryModal({ kind: 'debt', id });
        if (action === 'delete') app.deleteDebt(id);
        if (action === 'archive') app.archiveDebt(id);
        if (action === 'unarchive') app.unarchiveDebt(id);
        if (action === 'celebrate') openDebtPaidOffModal(app, id);
    };

    debtsList.onchange = (event) => {
        const toggleEl = event.target.closest('.be-min-type, .be-min-pct');
        if (!toggleEl) return;
        const card = toggleEl.closest('.debt-card');
        if (!card) return;
        const debtId = parseInt(card.querySelector('[data-debt-action="delete"]')?.getAttribute('data-debt-id'), 10);
        const debt = app.debts.find(d => d.id === debtId);
        if (debt) renderBreakEvenBadge(app, debt, card);
    };
}

export function startEdit(app, debtId) {
    app.editingDebtId = debtId;
    app.updateUI();
}

export function cancelInlineEdit(app) {
    app.editingDebtId = null;
    app.updateUI();
}

export async function saveInlineEdit(app, debtId) {
    const debt = app.debts.find(d => d.id === debtId);
    if (!debt) return;

    try {
        const nameEl = document.getElementById(`inline-name-${debtId}`);
        if (nameEl) debt.name = normalizeText(nameEl.value, 80);

        const categoryEl = document.getElementById(`inline-category-${debtId}`);
        if (categoryEl) debt.category = normalizeText(categoryEl.value, 40);

        const accountEl = document.getElementById(`inline-account-${debtId}`);
        if (accountEl) debt.accountId = accountEl.value ? parseInt(accountEl.value) : null;

        const personsEl = document.getElementById(`inline-persons-${debtId}`);
        if (personsEl) {
            debt.personIds = Array.from(personsEl.selectedOptions).map(o => parseInt(o.value, 10)).filter(Number.isFinite);
            debt.ownershipSplit = sanitizeOwnershipSplit(readOwnershipSplit(document.getElementById(`inline-ownership-${debtId}`)), debt.personIds);
        }

        if (debt.debtType === 'fixedAmount') {
            const fixedAmtEl = document.getElementById(`inline-fixed-amount-${debtId}`);
            const startEl = document.getElementById(`inline-start-date-${debtId}`);
            const endEl = document.getElementById(`inline-end-date-${debtId}`);
            const priorityEl = document.getElementById(`inline-priority-${debtId}`);

            if (fixedAmtEl) debt.fixedAmount = sanitizeFiniteNumber(fixedAmtEl.value, 0, { min: 0 });
            if (startEl) debt.fixedStartDate = sanitizeDateISO(startEl.value);
            if (endEl) debt.fixedEndDate = sanitizeDateISO(endEl.value);
            if (priorityEl) debt.priority = sanitizeInteger(priorityEl.value, null, { min: 1, max: 100 });
        } else {
            const balEl = document.getElementById(`inline-balance-${debtId}`);
            const intEl = document.getElementById(`inline-interest-${debtId}`);
            const minEl = document.getElementById(`inline-min-${debtId}`);
            const dueEl = document.getElementById(`inline-due-${debtId}`);
            const priorityEl = document.getElementById(`inline-priority-${debtId}`);
            const startDateEl = document.getElementById(`inline-start-date-cc-${debtId}`);

            const limitEl = document.getElementById(`inline-credit-limit-${debtId}`);

            if (balEl) debt.accountBalance = sanitizeFiniteNumber(balEl.value, 0, { min: 0 });
            if (intEl) debt.interestRate = sanitizeFiniteNumber(intEl.value, 0, { min: 0, max: 100 });
            if (minEl) debt.minimumPayment = sanitizeFiniteNumber(minEl.value, 0, { min: 0 });
            if (dueEl) debt.dueDate = sanitizeInteger(dueEl.value, null, { min: 1, max: 31 });
            if (priorityEl) debt.priority = sanitizeInteger(priorityEl.value, null, { min: 1, max: 100 });
            if (startDateEl) debt.debtStartDate = sanitizeDateISO(startDateEl.value);
            if (limitEl) debt.creditLimit = limitEl.value ? sanitizeFiniteNumber(limitEl.value, null, { min: 0 }) : null;
        }

        const notesEl = document.getElementById(`inline-notes-${debtId}`);
        if (notesEl) debt.notes = normalizeText(notesEl.value, 500);

        const nextDueEl = document.getElementById(`inline-next-due-${debtId}`);
        if (nextDueEl) debt.nextPaymentDue = sanitizeDateISO(nextDueEl.value);

        if (!debt.name) {
            await showAlertModal('Please enter a name for the debt.');
            return;
        }

        debt.updatedAt = todayISO();
        app.saveToStorage();
        if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/debts/${debt.id}`, debt);
        await recordBalanceHistory(app, { kind: 'debt', id: debt.id });
        app.editingDebtId = null;
        app.renderDebtsList();
        app.updateUI();
    } catch (err) {
        console.error('saveInlineEdit error', err);
        showAlertModal('Error saving debt: ' + (err && err.message ? err.message : String(err)));
    }
}
