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
    // ...existing code for rendering income cards and summary...
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
    renderIncomeList(app);
    document.getElementById('incomeForm').reset();
}

// Delete an income source
export function deleteIncome(app, incomeId) {
    app.incomes = app.incomes.filter(i => i.id !== incomeId);
    app.saveToStorage();
    renderIncomeList(app);
    app.renderStrategyIncomeWidget();
}

// Enter inline-edit mode for an income card
export function startEditIncome(app, incomeId) {
    app.editingIncomeId = incomeId;
    renderIncomeList(app);
    setTimeout(() => {
        const el = document.getElementById(`ie-name-${incomeId}`);
        if (el) el.focus();
    }, 0);
}

// Cancel inline-edit without saving
export function cancelEditIncome(app) {
    app.editingIncomeId = null;
    renderIncomeList(app);
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
    renderIncomeList(app);
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
    renderBonusList(app);
    app.renderStrategyIncomeWidget();
    document.getElementById('bonusForm').reset();
}

export function deleteBonus(app, bonusId) {
    app.bonuses = app.bonuses.filter(b => b.id !== bonusId);
    app.saveToStorage();
    renderBonusList(app);
    app.renderStrategyIncomeWidget();
}

export function startEditBonus(app, bonusId) {
    app.editingBonusId = bonusId;
    renderBonusList(app);
    setTimeout(() => {
        const el = document.getElementById(`be-name-${bonusId}`);
        if (el) el.focus();
    }, 0);
}

export function cancelEditBonus(app) {
    app.editingBonusId = null;
    renderBonusList(app);
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
    renderBonusList(app);
    app.renderStrategyIncomeWidget();
}

export function renderBonusList(app) {
    const container = document.getElementById('bonusList');
    if (!container) return;
    if (!app.bonuses || app.bonuses.length === 0) {
        container.innerHTML = '';
        return;
    }
    // ...existing code for rendering bonus cards...
}
