// Bills and expenses


// Render the full Budget page: bill cards, expense cards, cashflow summary.
export function renderBudgetPage(app) {
    if (app._cashflowDonutChart) { app._cashflowDonutChart.destroy(); app._cashflowDonutChart = null; }
    if (app._cashflowBarChart)   { app._cashflowBarChart.destroy();   app._cashflowBarChart   = null; }
    app._renderBillList();
    app._renderExpenseList();
    app._renderCashFlowSummary();
}

// Add a new bill from the billForm inputs.
export function addBill(app) {
    const name = document.getElementById('billName').value.trim();
    const amount = parseFloat(document.getElementById('billAmount').value);
    const dueDay = parseInt(document.getElementById('billDueDay').value) || null;
    const category = document.getElementById('billCategory').value;
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
    const name      = document.getElementById(`be-name-${id}`).value.trim();
    const amount    = parseFloat(document.getElementById(`be-amount-${id}`).value);
    const dueDay    = parseInt(document.getElementById(`be-dueday-${id}`).value) || null;
    const category  = document.getElementById(`be-cat-${id}`).value;
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
    const name = document.getElementById('expenseName').value.trim();
    const budgetAmount = parseFloat(document.getElementById('expenseBudget').value);
    const category = document.getElementById('expenseCategory').value;
    const accountId = parseInt(document.getElementById('expenseAccount')?.value) || null;
    if (!name || isNaN(budgetAmount) || budgetAmount < 0) {
        alert('Please enter a valid expense name and budget amount.');
        return;
    }
    app.expenses.push({ id: Date.now(), name, budgetAmount, category, accountId });
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
    const name         = document.getElementById(`ee-name-${id}`).value.trim();
    const budgetAmount = parseFloat(document.getElementById(`ee-amount-${id}`).value);
    const category     = document.getElementById(`ee-cat-${id}`).value;
    const acctEl       = document.getElementById(`ee-acct-${id}`);
    const accountId    = acctEl?.value ? parseInt(acctEl.value) : null;
    if (!name || isNaN(budgetAmount) || budgetAmount < 0) { alert('Invalid expense data.'); return; }
    app.expenses[idx] = { ...app.expenses[idx], name, budgetAmount, category, accountId };
    app.editingExpenseId = null;
    app.saveToStorage();
    renderBudgetPage(app);
}

// Cancel expense edit.
export function cancelEditExpense(app) {
    app.editingExpenseId = null;
    renderBudgetPage(app);
}
