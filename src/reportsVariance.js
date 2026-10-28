// Reports page logic: month-to-month (or range-to-range) variance comparison

import { formatCurrency, getReportDate, getReportRangeMonths, reportRangeMonthsList, getPriorEquivalentRangeEnd, formatReportRangeLabel } from './utils.js';
import { getLedgerTransactionsForMonth } from './ledgerTransactions.js';
import { renderBudgetVsActualHtml } from './categoryBudgets.js';

// Classifies one month's ledger transactions into the five variance buckets.
function _classifyMonthTotals(txs) {
    let income = 0, expenses = 0, recurring = 0, debtMin = 0, savings = 0;
    for (const tx of txs) {
        if (tx.type === 'income' || tx.type === 'bonus' || tx.type === 'interest') {
            income += tx.amount;
        } else if (tx.type === 'expense') {
            expenses += Math.abs(tx.amount || 0);
        } else if (tx.type === 'recurring' && tx.amount < 0) {
            recurring += Math.abs(tx.amount);
        } else if (tx.type === 'recurring' && tx.amount >= 0) {
            income += tx.amount;
        } else if (tx.type === 'debt') {
            debtMin += Math.abs(tx.amount || 0);
        } else if (tx.type === 'savings') {
            savings += Math.abs(tx.amount || 0);
        }
    }
    return { income, expenses, recurring, debtMin, savings };
}

// Sums classified totals across every month in the rangeMonths-month range
// ending at (year, month) inclusive (issue #329; rangeMonths=1 reduces to
// the original single-month behavior).
function _sumRangeTotals(app, year, month, rangeMonths) {
    const totals = { income: 0, expenses: 0, recurring: 0, debtMin: 0, savings: 0 };
    for (const { year: y, month: m } of reportRangeMonthsList(year, month, rangeMonths)) {
        const monthTotals = _classifyMonthTotals(getLedgerTransactionsForMonth(app, y, m));
        totals.income += monthTotals.income;
        totals.expenses += monthTotals.expenses;
        totals.recurring += monthTotals.recurring;
        totals.debtMin += monthTotals.debtMin;
        totals.savings += monthTotals.savings;
    }
    return totals;
}

export function renderReportsVariance(app) {
    const container = document.getElementById('reportsVariance');
    if (!container) return;

    const rptDate = getReportDate(app);
    const rptYear = rptDate.getFullYear();
    const rptMonth = rptDate.getMonth();
    const rangeMonths = getReportRangeMonths(app);

    const curr = _sumRangeTotals(app, rptYear, rptMonth, rangeMonths);
    const priorEnd = getPriorEquivalentRangeEnd(rptYear, rptMonth, rangeMonths);
    const prev = _sumRangeTotals(app, priorEnd.year, priorEnd.month, rangeMonths);
    const { income: currIncome, expenses: currExpenses, recurring: currRecurring, debtMin: currDebtMin, savings: currSavings } = curr;
    const { income: prevIncome, expenses: prevExpenses, recurring: prevRecurring, debtMin: prevDebtMin, savings: prevSavings } = prev;

    // Calculate deltas
    const deltaIncome = currIncome - prevIncome;
    const deltaExpenses = currExpenses - prevExpenses;
    const deltaRecurring = currRecurring - prevRecurring;
    const deltaDebtMin = currDebtMin - prevDebtMin;
    const deltaSavings = currSavings - prevSavings;

    // Format labels (single month, or an N-month range ending at rptMonth/priorEnd)
    const currLabel = formatReportRangeLabel(rptYear, rptMonth, rangeMonths);
    const prevLabel = formatReportRangeLabel(priorEnd.year, priorEnd.month, rangeMonths);

    // Helper function to create delta badge
    const deltaBadge = (delta, isExpense = false) => {
        // Flip logic for expenses: positive change is bad (more spending)
        const direction = isExpense ? (delta > 0 ? 'neg' : 'pos') : (delta > 0 ? 'pos' : 'neg');
        const sign = delta > 0 ? '+' : '';
        const icon = delta > 0 ? (isExpense ? '📈' : '📈') : '📉';
        return `<span class="var-delta var-delta--${direction}">${icon} ${sign}${formatCurrency(Math.abs(delta))}</span>`;
    };

    // Create variance rows
    const rows = [
        {
            label: '💰 Income',
            current: currIncome,
            previous: prevIncome,
            delta: deltaIncome,
            isExpense: false
        },
        {
            label: '💸 Expenses',
            current: currExpenses,
            previous: prevExpenses,
            delta: deltaExpenses,
            isExpense: true
        },
        {
            label: '🔄 Recurring Costs',
            current: currRecurring,
            previous: prevRecurring,
            delta: deltaRecurring,
            isExpense: true
        },
        {
            label: '💳 Debt Minimums',
            current: currDebtMin,
            previous: prevDebtMin,
            delta: deltaDebtMin,
            isExpense: true
        },
        {
            label: '💰 Savings Contributions',
            current: currSavings,
            previous: prevSavings,
            delta: deltaSavings,
            isExpense: true
        }
    ];

    const rowsHTML = rows.map(r => `
        <div class="var-row">
            <span class="var-label">${r.label}</span>
            <span class="var-prev">
                <span class="var-small-label">${prevLabel}</span>
                <span class="var-value">${formatCurrency(r.previous)}</span>
            </span>
            <span class="var-curr">
                <span class="var-small-label">${currLabel}</span>
                <span class="var-value">${formatCurrency(r.current)}</span>
            </span>
            <span class="var-delta-cell">
                ${deltaBadge(r.delta, r.isExpense)}
            </span>
        </div>
    `).join('');

    const totalDelta = (currIncome - currExpenses - currRecurring - currDebtMin) - (prevIncome - prevExpenses - prevRecurring - prevDebtMin);
    const totalDeltaClass = totalDelta >= 0 ? 'pos' : 'neg';

    container.innerHTML = `
        <div class="var-container">
            <div class="var-header-row">
                <div>
                    <h3 class="var-title">${rangeMonths > 1 ? 'Period-to-Period Comparison' : 'Month-to-Month Comparison'}</h3>
                    <p class="var-subtitle">Changes from ${prevLabel} to ${currLabel}</p>
                </div>
                <label class="var-range-toggle-label" for="varianceRangeMonths">Range:
                    <select id="varianceRangeMonths" class="select-styled">
                        <option value="1"${rangeMonths === 1 ? ' selected' : ''}>Single Month</option>
                        <option value="3"${rangeMonths === 3 ? ' selected' : ''}>Quarter (3 mo)</option>
                        <option value="6"${rangeMonths === 6 ? ' selected' : ''}>Half Year (6 mo)</option>
                        <option value="12"${rangeMonths === 12 ? ' selected' : ''}>Year (12 mo)</option>
                    </select>
                </label>
            </div>
            <div class="var-table">
                <div class="var-header">
                    <span class="var-label-col">Category</span>
                    <span class="var-period-col">${prevLabel}</span>
                    <span class="var-period-col">${currLabel}</span>
                    <span class="var-delta-col">Change</span>
                </div>
                ${rowsHTML}
            </div>
            <div class="var-summary">
                <div class="var-summary-row">
                    <span class="var-summary-label">Net Available (Income - All Outflows)</span>
                    <span class="var-summary-prev">${formatCurrency(prevIncome - prevExpenses - prevRecurring - prevDebtMin)}</span>
                    <span class="var-summary-curr">${formatCurrency(currIncome - currExpenses - currRecurring - currDebtMin)}</span>
                    <span class="var-summary-delta var-delta--${totalDeltaClass}">
                        ${totalDelta > 0 ? '📈' : '📉'} ${totalDelta >= 0 ? '+' : ''}${formatCurrency(totalDelta)}
                    </span>
                </div>
            </div>
            ${renderBudgetVsActualHtml(app, rptYear, rptMonth, rangeMonths)}
        </div>
    `;

    const rangeSelect = document.getElementById('varianceRangeMonths');
    if (rangeSelect) {
        rangeSelect.onchange = () => {
            app._reportRangeMonths = parseInt(rangeSelect.value, 10) || 1;
            renderReportsVariance(app);
        };
    }
}
