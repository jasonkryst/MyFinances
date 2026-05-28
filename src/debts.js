// Debt management and calculations

export function renderDebtsList(app) {
    // ...existing code from app.js renderDebtsList, refactored to use app instead of this...
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
                        <span class="debt-overview-cat-name">${cat}</span>
                        <span class="debt-overview-cat-count">${v.count} debt${v.count !== 1 ? 's' : ''}</span>
                        <span class="debt-overview-cat-min">${app.formatCurrency(v.minTotal)}/mo</span>
                        <span class="debt-overview-cat-total">${app.formatCurrency(v.total)}</span>
                    </div>`).join('');
            const interestHTML = totalInterest !== null
                ? `<div class="debt-overview-stat">
                        <span class="debt-overview-stat-label">Total Interest (projected)</span>
                        <span class="debt-overview-stat-value debt-overview-stat-value--interest">${app.formatCurrency(totalInterest)}</span>
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
                            <span class="debt-overview-stat-value">${app.formatCurrency(totalDebt)}</span>
                        </div>
                        <div class="debt-overview-stat">
                            <span class="debt-overview-stat-label">Monthly Minimums</span>
                            <span class="debt-overview-stat-value">${app.formatCurrency(totalMin)}</span>
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
        if (app.editingDebtId === debt.id) {
            let editHTML = `
                <div class="debt-info">
                    <div class="debt-name"><input id="inline-name-${debt.id}" type="text" value="${debt.name}"></div>
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
                        <div class="debt-detail"><strong>Priority:</strong> <input id="inline-priority-${debt.id}" type="number" min="1" max="100" value="${debt.priority || ''}"></div>`;
            }
            // ...existing code for editHTML...
        }
        // ...existing code for rendering debt cards...
    }
    // ...existing code for finishing renderDebtsList...
}

export function addDebt(app) {
    // Move addDebt logic here
}
