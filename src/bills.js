// Bills and expenses
import { formatCurrency, getDayOrdinal, computeMonthlyIncomeForMonth, normalizeText, sanitizeFiniteNumber, sanitizeInteger, sanitizeDateISO, escapeHtml } from './utils.js';


// Render the full Budget page: bill cards, expense cards, cashflow summary.
export function renderBudgetPage(app) {
    if (app._cashflowDonutChart) { app._cashflowDonutChart.destroy(); app._cashflowDonutChart = null; }
    if (app._cashflowBarChart)   { app._cashflowBarChart.destroy();   app._cashflowBarChart   = null; }
    renderBillList(app);
    renderExpenseList(app);
    renderCashFlowSummary(app);
}

export function renderBillList(app) {
    const container = document.getElementById('billList');
    if (!container) return;
    const BILL_CATS = ['Utilities','Internet / Phone','Insurance','Subscription','Rent / Mortgage','Transport','Other'];
    if (app.bills.length === 0) {
        container.innerHTML = `<p class="empty-budget-msg">No bills added yet.</p>`;
        return;
    }

    const cards = app.bills.map(bill => {
        if (app.editingBillId === bill.id) {
            return `<div class="budget-card budget-card--editing">
                <div class="budget-edit-grid">
                    <div class="form-group" style="margin:0"><label style="font-size:0.8rem;font-weight:600">Name</label>
                        <input type="text" id="be-name-${bill.id}" value="${escapeHtml(bill.name)}" class="form-control"></div>
                    <div class="form-group" style="margin:0"><label style="font-size:0.8rem;font-weight:600">Amount ($)</label>
                        <input type="number" id="be-amount-${bill.id}" value="${bill.amount}" step="0.01" min="0" class="form-control"></div>
                    <div class="form-group" style="margin:0"><label style="font-size:0.8rem;font-weight:600">Due Day</label>
                        <input type="number" id="be-dueday-${bill.id}" value="${bill.dueDay || ''}" min="1" max="31" class="form-control" placeholder="—"></div>
                    <div class="form-group" style="margin:0"><label style="font-size:0.8rem;font-weight:600">Category</label>
                        <select id="be-cat-${bill.id}" class="form-control">
                            ${BILL_CATS.map(c => `<option value="${c}" ${bill.category===c?'selected':''}>${c}</option>`).join('')}
                        </select></div>
                    <div class="form-group" style="margin:0"><label style="font-size:0.8rem;font-weight:600">Account</label>
                        <select id="be-acct-${bill.id}" class="form-control">
                            <option value="">— No account —</option>
                            ${app.accounts.map(a => `<option value="${a.id}" ${bill.accountId===a.id?'selected':''}>${escapeHtml(a.name)}</option>`).join('')}
                        </select></div>
                </div>
                <div class="budget-edit-actions">
                    <button class="btn btn-primary btn-small" data-bill-action="save" data-bill-id="${bill.id}">Save</button>
                    <button class="btn btn-secondary btn-small" data-bill-action="cancel">Cancel</button>
                </div>
            </div>`;
        }
        const dueTxt = bill.dueDay ? `Due: ${getDayOrdinal(bill.dueDay)}` : 'No due day set';
        return `<div class="budget-card">
            <div class="budget-card-info">
                <span class="budget-card-name">${escapeHtml(bill.name)}</span>
                <span class="budget-card-amount">${formatCurrency(bill.amount)}<span class="budget-card-period">/mo</span></span>
                <span class="budget-card-meta">${escapeHtml(bill.category)} &bull; ${escapeHtml(dueTxt)}</span>
            </div>
            <div class="budget-card-actions">
                <button class="btn-edit" data-bill-action="edit" data-bill-id="${bill.id}">Edit</button>
                <button class="btn btn-danger btn-small" data-bill-action="delete" data-bill-id="${bill.id}">Delete</button>
            </div>
        </div>`;
    }).join('');

    const catMap = {};
    for (const bill of app.bills) {
        const cat = bill.category || 'Other';
        if (!catMap[cat]) catMap[cat] = { count: 0, total: 0 };
        catMap[cat].count++;
        catMap[cat].total += bill.amount;
    }
    const totalBills = app.bills.reduce((s, b) => s + b.amount, 0);
    const catRows = Object.entries(catMap)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([cat, v]) => `
            <div class="budget-cat-row">
                <span class="budget-cat-name">${escapeHtml(cat)}</span>
                <span class="budget-cat-count">${v.count} item${v.count !== 1 ? 's' : ''}</span>
                <span class="budget-cat-amount">${formatCurrency(v.total)}/mo</span>
            </div>`).join('');

    const summaryHTML = `
        <div class="budget-cat-summary">
            <div class="budget-cat-summary-header">
                <span>Bills by Category</span>
                <span class="budget-cat-summary-total">${formatCurrency(totalBills)}/mo total</span>
            </div>
            ${catRows}
        </div>`;

    container.innerHTML = cards + summaryHTML;
    container.onclick = (event) => {
        const actionEl = event.target.closest('[data-bill-action]');
        if (!actionEl) return;
        const action = actionEl.getAttribute('data-bill-action');
        const id = parseInt(actionEl.getAttribute('data-bill-id'), 10);
        if (action === 'cancel') {
            app.cancelEditBill();
            return;
        }
        if (Number.isNaN(id)) return;
        if (action === 'save') app.saveEditBill(id);
        if (action === 'edit') app.startEditBill(id);
        if (action === 'delete') app.deleteBill(id);
    };
}

export function renderExpenseList(app) {
    const container = document.getElementById('expenseList');
    if (!container) return;
    const EXP_CATS = ['Food & Groceries','Dining Out','Health & Fitness','Entertainment','Clothing','Personal Care','Education','Childcare','Other'];
    if (app.expenses.length === 0) {
        container.innerHTML = `<p class="empty-budget-msg">No expense budgets added yet.</p>`;
        return;
    }

    const cards = app.expenses.map(exp => {
        if (app.editingExpenseId === exp.id) {
            return `<div class="budget-card budget-card--editing">
                <div class="budget-edit-grid">
                    <div class="form-group" style="margin:0"><label style="font-size:0.8rem;font-weight:600">Name</label>
                        <input type="text" id="ee-name-${exp.id}" value="${escapeHtml(exp.name)}" class="form-control"></div>
                    <div class="form-group" style="margin:0"><label style="font-size:0.8rem;font-weight:600">Cost</label>
                        <input type="number" id="ee-amount-${exp.id}" value="${exp.budgetAmount}" step="0.01" min="0" class="form-control"></div>
                    <div class="form-group" style="margin:0"><label style="font-size:0.8rem;font-weight:600">Date</label>
                        <input type="date" id="ee-date-${exp.id}" value="${exp.date instanceof Date ? exp.date.toISOString().split('T')[0] : (exp.date ? new Date(exp.date).toISOString().split('T')[0] : '')}" class="form-control"></div>
                    <div class="form-group" style="margin:0"><label style="font-size:0.8rem;font-weight:600">Category</label>
                        <select id="ee-cat-${exp.id}" class="form-control">
                            ${EXP_CATS.map(c => `<option value="${c}" ${exp.category===c?'selected':''}>${c}</option>`).join('')}
                        </select></div>
                    <div class="form-group" style="margin:0"><label style="font-size:0.8rem;font-weight:600">Account</label>
                        <select id="ee-acct-${exp.id}" class="form-control">
                            <option value="">— No account —</option>
                            ${app.accounts.map(a => `<option value="${a.id}" ${exp.accountId===a.id?'selected':''}>${escapeHtml(a.name)}</option>`).join('')}
                        </select></div>
                </div>
                <div class="budget-edit-actions">
                    <button class="btn btn-primary btn-small" data-expense-action="save" data-expense-id="${exp.id}">Save</button>
                    <button class="btn btn-secondary btn-small" data-expense-action="cancel">Cancel</button>
                </div>
            </div>`;
        }
        return `<div class="budget-card">
            <div class="budget-card-info">
                <span class="budget-card-name">${escapeHtml(exp.name)}</span>
                <span class="budget-card-amount">${formatCurrency(exp.budgetAmount)}</span>
                <span class="budget-card-meta">${escapeHtml(exp.category)} • ${escapeHtml(exp.date instanceof Date ? exp.date.toLocaleDateString() : new Date(exp.date).toLocaleDateString())}</span>
            </div>
            <div class="budget-card-actions">
                <button class="btn-edit" data-expense-action="edit" data-expense-id="${exp.id}">Edit</button>
                <button class="btn btn-danger btn-small" data-expense-action="delete" data-expense-id="${exp.id}">Delete</button>
            </div>
        </div>`;
    }).join('');

    const catMap = {};
    for (const exp of app.expenses) {
        const cat = exp.category || 'Other';
        if (!catMap[cat]) catMap[cat] = { count: 0, total: 0 };
        catMap[cat].count++;
        catMap[cat].total += exp.budgetAmount;
    }
    const totalExp = app.expenses.reduce((s, e) => s + e.budgetAmount, 0);
    const catRows = Object.entries(catMap)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([cat, v]) => `
            <div class="budget-cat-row budget-cat-row--expense">
                <span class="budget-cat-name">${escapeHtml(cat)}</span>
                <span class="budget-cat-count">${v.count} item${v.count !== 1 ? 's' : ''}</span>
                <span class="budget-cat-amount">${formatCurrency(v.total)}/mo</span>
            </div>`).join('');

    const summaryHTML = `
        <div class="budget-cat-summary budget-cat-summary--expense">
            <div class="budget-cat-summary-header">
                <span>Expenses by Category</span>
                <span class="budget-cat-summary-total">${formatCurrency(totalExp)}/mo total</span>
            </div>
            ${catRows}
        </div>`;

    container.innerHTML = cards + summaryHTML;
    container.onclick = (event) => {
        const actionEl = event.target.closest('[data-expense-action]');
        if (!actionEl) return;
        const action = actionEl.getAttribute('data-expense-action');
        const id = parseInt(actionEl.getAttribute('data-expense-id'), 10);
        if (action === 'cancel') {
            app.cancelEditExpense();
            return;
        }
        if (Number.isNaN(id)) return;
        if (action === 'save') app.saveEditExpense(id);
        if (action === 'edit') app.startEditExpense(id);
        if (action === 'delete') app.deleteExpense(id);
    };
}

export function renderCashFlowSummary(app) {
    const el = document.getElementById('cashFlowSummary');
    if (!el) return;

    const now = new Date();
    const { monthlyTotal: monthlyIncome } = computeMonthlyIncomeForMonth(app.incomes, app.bonuses, now.getFullYear(), now.getMonth());
    const totalBills = app.bills.reduce((s, b) => s + b.amount, 0);
    const totalExpenses = app.expenses.reduce((s, e) => s + e.budgetAmount, 0);
    const totalDebtMin = app.debts.reduce((s, d) => s + (d.minimumPayment || 0), 0);
    const totalOutflow = totalBills + totalExpenses + totalDebtMin;
    const net = monthlyIncome - totalOutflow;
    const netClass = net >= 0 ? 'cashflow-net--positive' : 'cashflow-net--negative';

    if (monthlyIncome === 0 && totalOutflow === 0) { el.style.display = 'none'; return; }
    el.style.display = 'block';

    const row = (label, value, cls = '') =>
        `<div class="cashflow-row ${cls}"><span class="cashflow-label">${escapeHtml(label)}</span><span class="cashflow-value">${formatCurrency(value)}</span></div>`;

    const subRow = (label, value, cls = '') =>
        `<div class="cashflow-subrow ${cls}"><span class="cashflow-sublabel">${escapeHtml(label)}</span><span class="cashflow-subvalue">${formatCurrency(value)}</span></div>`;

    let billCatRows = '';
    if (totalBills > 0) {
        const billCats = {};
        for (const b of app.bills) {
            const cat = b.category || 'Other';
            billCats[cat] = (billCats[cat] || 0) + b.amount;
        }
        billCatRows = Object.entries(billCats)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, amt]) => subRow(cat, amt, 'cashflow-subrow--bill'))
            .join('');
    }

    let expCatRows = '';
    if (totalExpenses > 0) {
        const expCats = {};
        for (const e of app.expenses) {
            const cat = e.category || 'Other';
            expCats[cat] = (expCats[cat] || 0) + e.budgetAmount;
        }
        expCatRows = Object.entries(expCats)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, amt]) => subRow(cat, amt, 'cashflow-subrow--expense'))
            .join('');
    }

    let debtSubRows = '';
    if (totalDebtMin > 0) {
        debtSubRows = app.debts
            .filter(d => (d.minimumPayment || 0) > 0)
            .sort((a, b) => (b.minimumPayment || 0) - (a.minimumPayment || 0))
            .map(d => subRow(d.name, d.minimumPayment, 'cashflow-subrow--debt'))
            .join('');
    }

    el.innerHTML = `
        <div class="cashflow-tab-bar">
            <button class="cashflow-tab cashflow-tab--active" data-tab="summary">📋 Summary</button>
            <button class="cashflow-tab" data-tab="charts">📊 Charts</button>
        </div>

        <div class="cashflow-tab-panel cashflow-tab-panel--active" id="cashflowPanelSummary">
            <h4>📈 Monthly Cash Flow</h4>
            <div class="cashflow-grid">
                <div class="cashflow-inflow">
                    <div class="cashflow-section-title">Income</div>
                    ${row('Expected this month', monthlyIncome, 'cashflow-row--income')}
                </div>
                <div class="cashflow-outflow">
                    <div class="cashflow-section-title">Outflows</div>
                    ${totalDebtMin > 0 ? row('Debt minimums', totalDebtMin, 'cashflow-row--debt') + debtSubRows : ''}
                    ${totalBills > 0 ? row('Bills', totalBills, 'cashflow-row--bills') + billCatRows : ''}
                    ${totalExpenses > 0 ? row('Budgeted expenses', totalExpenses, 'cashflow-row--expenses') + expCatRows : ''}
                    ${row('Total outflow', totalOutflow, 'cashflow-row--total')}
                </div>
            </div>
            <div class="cashflow-net ${netClass}">
                <span>Net remaining</span>
                <span>${formatCurrency(net)}</span>
            </div>
        </div>

        <div class="cashflow-tab-panel" id="cashflowPanelCharts">
            <div class="cashflow-charts-top">
                <div class="cashflow-chart-wrap cashflow-chart-wrap--donut">
                    <h5 class="cashflow-chart-title">Where Does My Money Go?</h5>
                    <p class="cashflow-chart-sub">Monthly income allocation</p>
                    <canvas id="cashflowDonutChart"></canvas>
                </div>
            </div>
            <div class="cashflow-charts-bottom">
                <div class="cashflow-chart-wrap cashflow-chart-wrap--bar">
                    <h5 class="cashflow-chart-title">Outflow Breakdown</h5>
                    <p class="cashflow-chart-sub">Amount per category / debt</p>
                    <div class="cashflow-bar-container">
                        <canvas id="cashflowBarChart"></canvas>
                    </div>
                </div>
            </div>
        </div>`;

    el.querySelectorAll('.cashflow-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            el.querySelectorAll('.cashflow-tab').forEach(b => b.classList.remove('cashflow-tab--active'));
            el.querySelectorAll('.cashflow-tab-panel').forEach(p => p.classList.remove('cashflow-tab-panel--active'));
            btn.classList.add('cashflow-tab--active');
            el.querySelector(`#cashflowPanel${btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1)}`).classList.add('cashflow-tab-panel--active');
            if (btn.dataset.tab === 'charts') {
                renderCashFlowCharts(app, monthlyIncome, totalDebtMin, totalBills, totalExpenses, net);
            }
        });
    });
}

export function renderCashFlowCharts(app, monthlyIncome, totalDebtMin, totalBills, totalExpenses, net) {
    const donutCanvas = document.getElementById('cashflowDonutChart');
    if (donutCanvas) {
        if (app._cashflowDonutChart) { app._cashflowDonutChart.destroy(); app._cashflowDonutChart = null; }
        const donutData = [];
        const donutLabels = [];
        const donutColors = [];
        if (totalDebtMin > 0) { donutData.push(totalDebtMin); donutLabels.push('Debt Minimums'); donutColors.push('#ef4444'); }
        if (totalBills > 0)   { donutData.push(totalBills);   donutLabels.push('Bills');          donutColors.push('#f59e0b'); }
        if (totalExpenses > 0){ donutData.push(totalExpenses);donutLabels.push('Expenses');        donutColors.push('#8b5cf6'); }
        if (net > 0)          { donutData.push(net);          donutLabels.push('Net Remaining');   donutColors.push('#10b981'); }
        else if (donutData.length === 0) return;

        app._cashflowDonutChart = new Chart(donutCanvas, {
            type: 'doughnut',
            data: { labels: donutLabels, datasets: [{ data: donutData, backgroundColor: donutColors, borderWidth: 2, borderColor: '#fff' }] },
            options: {
                responsive: true, maintainAspectRatio: true,
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14, font: { size: 12 } } },
                    tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${formatCurrency(ctx.parsed)}` } }
                }
            }
        });
    }

    const barCanvas = document.getElementById('cashflowBarChart');
    if (barCanvas) {
        if (app._cashflowBarChart) { app._cashflowBarChart.destroy(); app._cashflowBarChart = null; }

        const labels = [];
        const values = [];
        const colors = [];

        app.debts.filter(d => (d.minimumPayment || 0) > 0)
            .sort((a, b) => (b.minimumPayment || 0) - (a.minimumPayment || 0))
            .forEach(d => { labels.push(d.name); values.push(d.minimumPayment); colors.push('#ef4444'); });

        const billCats = {};
        for (const b of app.bills) { const c = b.category || 'Other'; billCats[c] = (billCats[c] || 0) + b.amount; }
        Object.entries(billCats).sort((a, b) => b[1] - a[1])
            .forEach(([cat, amt]) => { labels.push(cat); values.push(amt); colors.push('#f59e0b'); });

        const expCats = {};
        for (const e of app.expenses) { const c = e.category || 'Other'; expCats[c] = (expCats[c] || 0) + e.budgetAmount; }
        Object.entries(expCats).sort((a, b) => b[1] - a[1])
            .forEach(([cat, amt]) => { labels.push(cat); values.push(amt); colors.push('#8b5cf6'); });

        if (labels.length === 0) return;

        app._cashflowBarChart = new Chart(barCanvas, {
            type: 'bar',
            data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 4, borderSkipped: false }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: ctx => ` ${formatCurrency(ctx.parsed.y)}/mo` } }
                },
                scales: {
                    x: { ticks: { font: { size: 11 }, maxRotation: 35, minRotation: 20 } },
                    y: { ticks: { callback: v => formatCurrency(v) }, grid: { color: 'rgba(0,0,0,0.06)' }, beginAtZero: true }
                }
            }
        });
    }
}

// Add a new bill from the billForm inputs.
export function addBill(app) {
    const name = normalizeText(document.getElementById('billName').value, 80);
    const amount = sanitizeFiniteNumber(document.getElementById('billAmount').value, NaN, { min: 0 });
    const dueDay = sanitizeInteger(document.getElementById('billDueDay').value, null, { min: 1, max: 31 });
    const category = normalizeText(document.getElementById('billCategory').value, 40);
    const accountId = parseInt(document.getElementById('billAccount')?.value) || null;
    if (!name || isNaN(amount) || amount < 0) {
        alert('Please enter a valid bill name and amount.');
        return;
    }
    app.bills.push({ id: Date.now(), name, amount, dueDay, category, accountId });
    app.saveToStorage();
    document.getElementById('billForm').reset();
    // Collapse the form after adding
    const billBody = document.getElementById('billFormBody');
    const billToggle = document.getElementById('billFormToggle');
    if (billBody) billBody.hidden = true;
    if (billToggle) { billToggle.setAttribute('aria-expanded', 'false'); billToggle.classList.remove('budget-form-toggle--open'); }
    renderBudgetPage(app);
}

// Delete a bill by id.
export function deleteBill(app, id) {
    app.bills = app.bills.filter(b => b.id !== id);
    app.saveToStorage();
    renderBudgetPage(app);
}

// Enter inline edit mode for a bill.
export function startEditBill(app, id) {
    app.editingBillId = id;
    renderBudgetPage(app);
}

// Save inline bill edits.
export function saveEditBill(app, id) {
    const idx = app.bills.findIndex(b => b.id === id);
    if (idx === -1) return;
    const name      = normalizeText(document.getElementById(`be-name-${id}`).value, 80);
    const amount    = sanitizeFiniteNumber(document.getElementById(`be-amount-${id}`).value, NaN, { min: 0 });
    const dueDay    = sanitizeInteger(document.getElementById(`be-dueday-${id}`).value, null, { min: 1, max: 31 });
    const category  = normalizeText(document.getElementById(`be-cat-${id}`).value, 40);
    const acctEl    = document.getElementById(`be-acct-${id}`);
    const accountId = acctEl?.value ? parseInt(acctEl.value) : null;
    if (!name || isNaN(amount) || amount < 0) { alert('Invalid bill data.'); return; }
    app.bills[idx] = { ...app.bills[idx], name, amount, dueDay, category, accountId };
    app.editingBillId = null;
    app.saveToStorage();
    renderBudgetPage(app);
}

// Cancel bill edit.
export function cancelEditBill(app) {
    app.editingBillId = null;
    renderBudgetPage(app);
}

// Add a new expense budget from the expenseForm inputs.
export function addExpense(app) {
    const name = normalizeText(document.getElementById('expenseName').value, 80);
    const budgetAmount = sanitizeFiniteNumber(document.getElementById('expenseBudget').value, NaN, { min: 0 });
    const dateStr = sanitizeDateISO(document.getElementById('expenseDate').value);
    const category = normalizeText(document.getElementById('expenseCategory').value, 40);
    const accountId = parseInt(document.getElementById('expenseAccount')?.value) || null;
    if (!name || isNaN(budgetAmount) || budgetAmount < 0 || !dateStr) {
        alert('Please enter a valid expense name, amount, and date.');
        return;
    }
    const date = new Date(dateStr + 'T00:00:00');
    app.expenses.push({ id: Date.now(), name, budgetAmount, date, category, accountId });
    app.saveToStorage();
    document.getElementById('expenseForm').reset();
    // Collapse the form after adding
    const expBody = document.getElementById('expenseFormBody');
    const expToggle = document.getElementById('expenseFormToggle');
    if (expBody) expBody.hidden = true;
    if (expToggle) { expToggle.setAttribute('aria-expanded', 'false'); expToggle.classList.remove('budget-form-toggle--open'); }
    renderBudgetPage(app);
}

// Delete an expense by id.
export function deleteExpense(app, id) {
    app.expenses = app.expenses.filter(e => e.id !== id);
    app.saveToStorage();
    renderBudgetPage(app);
}

// Enter inline edit mode for an expense.
export function startEditExpense(app, id) {
    app.editingExpenseId = id;
    renderBudgetPage(app);
}

// Save inline expense edits.
export function saveEditExpense(app, id) {
    const idx = app.expenses.findIndex(e => e.id === id);
    if (idx === -1) return;
    const name         = normalizeText(document.getElementById(`ee-name-${id}`).value, 80);
    const budgetAmount = sanitizeFiniteNumber(document.getElementById(`ee-amount-${id}`).value, NaN, { min: 0 });
    const dateStr      = sanitizeDateISO(document.getElementById(`ee-date-${id}`).value);
    const category     = normalizeText(document.getElementById(`ee-cat-${id}`).value, 40);
    const acctEl       = document.getElementById(`ee-acct-${id}`);
    const accountId    = acctEl?.value ? parseInt(acctEl.value) : null;
    if (!name || isNaN(budgetAmount) || budgetAmount < 0 || !dateStr) { alert('Invalid expense data.'); return; }
    const date = new Date(dateStr + 'T00:00:00');
    app.expenses[idx] = { ...app.expenses[idx], name, budgetAmount, date, category, accountId };
    app.editingExpenseId = null;
    app.saveToStorage();
    renderBudgetPage(app);
}

// Cancel expense edit.
export function cancelEditExpense(app) {
    app.editingExpenseId = null;
    renderBudgetPage(app);
}
