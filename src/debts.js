// Debt management and calculations
import { formatCurrency, getDayOrdinal, computeInterestPaidToDate, normalizeText, sanitizeFiniteNumber, sanitizeInteger, sanitizeDateISO, escapeHtml } from './utils.js';

function recalculateIfConfigured(app) {
    try {
        const monthlyPayment = parseFloat(document.getElementById('monthlyPayment').value);
        const strategy = document.getElementById('paymentStrategy').value;
        if (monthlyPayment && !isNaN(monthlyPayment) && monthlyPayment > 0) {
            const result = DebtCalculator.calculatePaymentPlan(
                app.debts,
                monthlyPayment,
                strategy,
                app.perMonthStimulus && app.perMonthStimulus.length > 0 ? app.perMonthStimulus : 0
            );
            app.lastPaymentPlan = result.paymentPlan;
            app.lastSummary = DebtCalculator.generateSummary(result.workingDebts, result.paymentPlan);
        }
    } catch (err) {
        console.error('Error recalculating plan after debt change', err);
    }
}

export function addDebt(app) {
    const debtType = document.getElementById('debtType').value;
    const name = normalizeText(document.getElementById('debtName').value, 80);
    const category = normalizeText(document.getElementById('debtCategory').value, 40);
    const priority = sanitizeInteger(document.getElementById('priority').value, null, { min: 1, max: 100 });
    const accountIdValue = document.getElementById('debtAccount').value;
    const accountId = accountIdValue ? parseInt(accountIdValue) : null;

    if (!name) {
        alert('Please enter a debt name.');
        return;
    }

    const debt = {
        id: Date.now(),
        name,
        category,
        priority,
        debtType,
        accountId
    };

    if (debtType === 'fixedAmount') {
        const fixedAmount = sanitizeFiniteNumber(document.getElementById('fixedAmount').value, NaN, { min: 0.01 });
        const fixedStartDate = sanitizeDateISO(document.getElementById('fixedStartDate').value);
        const fixedEndDate = sanitizeDateISO(document.getElementById('fixedEndDate').value);

        if (isNaN(fixedAmount) || fixedAmount <= 0 || !fixedStartDate || !fixedEndDate) {
            alert('Please fill in all required fixed-amount debt fields.');
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
            alert('Please fill in all required credit card debt fields.');
            return;
        }

        debt.accountBalance = accountBalance;
        debt.originalBalance = accountBalance;
        debt.interestRate = interestRate;
        debt.minimumPayment = minimumPayment;
        debt.originalMinimumPayment = minimumPayment;
        debt.dueDate = dueDate;
        debt.debtStartDate = debtStartDate;
    }

    app.debts.push(debt);
    app.saveToStorage();
    recalculateIfConfigured(app);
    app.updateUI();
    app.cancelEdit();
}

export function deleteDebt(app, debtId) {
    const confirmed = confirm('Delete this debt?');
    if (!confirmed) return;

    app.debts = app.debts.filter(d => d.id !== debtId);
    if (app.editingDebtId === debtId) app.editingDebtId = null;

    app.saveToStorage();
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
    document.getElementById('confirmUpdateBalance').onclick = () => {
        const newBal = parseFloat(balInput.value);
        if (isNaN(newBal) || newBal < 0) { alert('Please enter a valid balance (0 or more).'); return; }
        const newMin = parseFloat(minInput.value);
        if (isNaN(newMin) || newMin < 0) { alert('Please enter a valid minimum payment (0 or more).'); return; }
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

export function updateDebtBalance(app, debtId, newBalance, newMinPayment) {
    const idx = app.debts.findIndex(d => Number(d.id) === Number(debtId));
    if (idx === -1) return;

    if (!app.debts[idx].originalBalance) {
        app.debts[idx].originalBalance = app.debts[idx].accountBalance;
    }
    app.debts[idx].accountBalance = newBalance;

    if (newMinPayment !== undefined) {
        if (app.debts[idx].originalMinimumPayment === undefined) {
            app.debts[idx].originalMinimumPayment = app.debts[idx].minimumPayment ?? 0;
        }
        app.debts[idx].minimumPayment = newMinPayment;
    }
    app.saveToStorage();
    recalculateIfConfigured(app);
    app.renderDebtsList();
}

export function saveEdit(app) {
    if (!app.editingDebtId) return;

    const name = normalizeText(document.getElementById('debtName').value, 80);
    const accountBalance = sanitizeFiniteNumber(document.getElementById('accountBalance').value, NaN, { min: 0 });
    const interestRate = sanitizeFiniteNumber(document.getElementById('interestRate').value, NaN, { min: 0, max: 100 });
    const priority = sanitizeInteger(document.getElementById('priority').value, null, { min: 1, max: 100 });
    const minimumPayment = sanitizeFiniteNumber(document.getElementById('minimumPayment').value, NaN, { min: 0 });
    const dueDate = sanitizeInteger(document.getElementById('dueDate').value, NaN, { min: 1, max: 31 });

    if (!name || isNaN(accountBalance) || isNaN(interestRate) || isNaN(minimumPayment) || isNaN(dueDate)) {
        alert('Please fill in all required fields');
        return;
    }

    const idx = app.debts.findIndex(d => d.id === app.editingDebtId);
    if (idx === -1) return;

    app.debts[idx] = {
        ...app.debts[idx],
        name,
        accountBalance,
        interestRate,
        priority,
        minimumPayment,
        dueDate
    };

    app.saveToStorage();
    app.updateUI();
    try {
        const monthlyPayment = parseFloat(document.getElementById('monthlyPayment').value);
        const strategy = document.getElementById('paymentStrategy').value;
        if (monthlyPayment && !isNaN(monthlyPayment) && monthlyPayment > 0) {
            const result = DebtCalculator.calculatePaymentPlan(
                app.debts,
                monthlyPayment,
                strategy,
                app.perMonthStimulus && app.perMonthStimulus.length > 0 ? app.perMonthStimulus : 0
            );
            app.lastPaymentPlan = result.paymentPlan;
            app.lastSummary = DebtCalculator.generateSummary(result.workingDebts, result.paymentPlan);
        }
    } catch (err) {
        console.error('Error recalculating after saveEdit', err);
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

/**
 * Render the Debts page list.
 */
export function renderDebtsList(app) {
    const categorySummary = document.getElementById('categorySummary');
    if (categorySummary) {
        if (app.debts.length === 0) {
            categorySummary.innerHTML = '';
        } else {
            const totalDebt = app.debts.reduce((s, d) => {
                return s + (d.debtType === 'fixedAmount' ? (d.fixedAmount || 0) : (d.accountBalance || 0));
            }, 0);
            const totalMin = app.debts.reduce((s, d) => s + (d.minimumPayment || 0), 0);
            const totalInterest = app.lastSummary ? app.lastSummary.totalInterest : null;

            const catMap = {};
            for (const d of app.debts) {
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
                        <span class="debt-overview-cat-count">${v.count} debt${v.count !== 1 ? 's' : ''}</span>
                        <span class="debt-overview-cat-min">${formatCurrency(v.minTotal)}/mo</span>
                        <span class="debt-overview-cat-total">${formatCurrency(v.total)}</span>
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

    const categoryFilter = document.getElementById('categoryFilter');
    if (categoryFilter) {
        const categories = Array.from(new Set(app.debts.map(d => d.category).filter(Boolean)));
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

    let filteredDebts = app.debts;
    if (categoryFilter && categoryFilter.value) {
        filteredDebts = app.debts.filter(d => d.category === categoryFilter.value);
    }

    for (const debt of filteredDebts) {
        const card = document.createElement('div');
        card.className = 'debt-card';

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
                        <div class="debt-detail"><strong>Date Opened:</strong> <input id="inline-start-date-cc-${debt.id}" type="date" value="${debt.debtStartDate || ''}"></div>`;
            }

            editHTML += `
                        <div class="debt-detail"><strong>Category:</strong> <input id="inline-category-${debt.id}" type="text" value="${escapeHtml(debt.category || '')}"></div>
                        <div class="debt-detail"><strong>Account:</strong>
                            <select id="inline-account-${debt.id}">
                                <option value="">— No account —</option>
                                ${app.accounts.map(a => `<option value="${a.id}" ${debt.accountId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                </div>
                <div class="debt-actions">
                    <button class="btn btn-success btn-save" data-debt-action="save-inline" data-debt-id="${debt.id}">Save</button>
                    <button class="btn btn-secondary btn-cancel" data-debt-action="cancel-inline">Cancel</button>
                </div>
            `;
            card.innerHTML = editHTML;
        } else {
            let cardHTML = `
                <div class="debt-info">
                    <div class="debt-name">${escapeHtml(debt.name)}`;
            if (debt.debtType === 'fixedAmount') {
                cardHTML += ` <span class="debt-type-badge">Fixed Amount</span>`;
            }
            cardHTML += `</div>
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
                const dailyRate = (debt.interestRate || 0) / 100 / 365;
                const monthlyInterest = debt.accountBalance * (Math.pow(1 + dailyRate, 30) - 1);
                const negAmortRisk = debt.minimumPayment <= monthlyInterest && debt.minimumPayment > 0;
                const origBal = debt.originalBalance || debt.accountBalance;
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
                        ${debt.debtStartDate ? `
                        <div class="debt-detail">
                            <strong>Opened:</strong> ${new Date(debt.debtStartDate + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                        </div>` : ''}
                        ${iptd ? `
                        <div class="debt-detail iptd-detail">
                            <strong>Est. interest paid to date:</strong>
                            <span class="iptd-value">${formatCurrency(iptd.interestPaid)}</span>
                            <span class="iptd-sub">over ${iptd.days} days since ${iptd.start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
                        </div>` : ''}
                        ${payoffDetailHTML}
                        ${debt.priority ? `
                            <div class="debt-detail">
                                <strong>Priority:</strong> ${debt.priority}/100
                            </div>
                        ` : ''}`;
                cardHTML += `</div>
                    <div class="debt-progress-wrap">
                        <div class="debt-progress-label"><span>Payoff progress</span><span>${progressPct}%</span></div>
                        <div class="debt-progress-bar"><div class="debt-progress-fill${progressPct >= 100 ? ' debt-progress-fill--complete' : ''}" data-progress-width="${progressPct}"></div></div>
                    </div>`;
            }

            cardHTML += `
                        ${debt.category ? `
                            <div class="debt-detail">
                                <strong>Category:</strong> ${escapeHtml(debt.category)}
                            </div>
                        ` : ''}
                </div>
                <div class="debt-actions">
                    <button class="btn-edit" data-debt-action="edit" data-debt-id="${debt.id}">Edit</button>
                    ${debt.debtType !== 'fixedAmount' ? `<button class="btn btn-secondary btn-small" data-debt-action="update-balance" data-debt-id="${debt.id}">Update Balance</button>` : ''}
                    <button class="btn-delete" data-debt-action="delete" data-debt-id="${debt.id}">Delete</button>
                </div>
            `;
            card.innerHTML = cardHTML;
            card.querySelectorAll('[data-progress-width]').forEach(el =>
                el.style.setProperty('--progress-width', el.dataset.progressWidth + '%'));
        }

        debtsList.appendChild(card);
    }

    debtsList.onclick = (event) => {
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
        if (action === 'delete') app.deleteDebt(id);
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

export function saveInlineEdit(app, debtId) {
    const debt = app.debts.find(d => d.id === debtId);
    if (!debt) return;

    try {
        const nameEl = document.getElementById(`inline-name-${debtId}`);
        if (nameEl) debt.name = normalizeText(nameEl.value, 80);

        const categoryEl = document.getElementById(`inline-category-${debtId}`);
        if (categoryEl) debt.category = normalizeText(categoryEl.value, 40);

        const accountEl = document.getElementById(`inline-account-${debtId}`);
        if (accountEl) debt.accountId = accountEl.value ? parseInt(accountEl.value) : null;

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

            if (balEl) debt.accountBalance = sanitizeFiniteNumber(balEl.value, 0, { min: 0 });
            if (intEl) debt.interestRate = sanitizeFiniteNumber(intEl.value, 0, { min: 0, max: 100 });
            if (minEl) debt.minimumPayment = sanitizeFiniteNumber(minEl.value, 0, { min: 0 });
            if (dueEl) debt.dueDate = sanitizeInteger(dueEl.value, null, { min: 1, max: 31 });
            if (priorityEl) debt.priority = sanitizeInteger(priorityEl.value, null, { min: 1, max: 100 });
            if (startDateEl) debt.debtStartDate = sanitizeDateISO(startDateEl.value);
        }

        if (!debt.name) {
            alert('Please enter a name for the debt.');
            return;
        }

        app.saveToStorage();
        app.editingDebtId = null;
        app.renderDebtsList();
        app.updateUI();
    } catch (err) {
        console.error('saveInlineEdit error', err);
        alert('Error saving debt: ' + (err && err.message ? err.message : String(err)));
    }
}
