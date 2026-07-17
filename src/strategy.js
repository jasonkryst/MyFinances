// Strategy/payment-plan feature module

import {
    formatCurrency,
    computeMonthlyIncomeForMonth,
    computeMonthlyBonusesForMonth
} from './utils.js';

/**
 * Render the full Results page after a calculation.
 */
export function displayPaymentPlan(app) {
    if (!app.lastPaymentPlan || !app.lastSummary) {
        console.error('displayPaymentPlan: missing data!');
        return;
    }

    // Update summary
    document.getElementById('totalDebtValue').textContent =
        formatCurrency(app.lastSummary.totalDebt);
    document.getElementById('totalInterestValue').textContent =
        formatCurrency(app.lastSummary.totalInterest);
    document.getElementById('timeToPayOffValue').textContent =
        `${app.lastSummary.monthsToPayOff} months (${DebtCalculator.formatDate(app.lastSummary.payOffDate)})`;

    // Monthly interest cost: sum of all interest charges in month 1
    let monthlyInterestCost = 0;
    if (app.lastPaymentPlan.length > 0) {
        for (const payment of app.lastPaymentPlan[0].payments) {
            monthlyInterestCost += payment.interest || 0;
        }
    }
    const micEl = document.getElementById('monthlyInterestCostValue');
    if (micEl) micEl.textContent = formatCurrency(monthlyInterestCost);

    // Build debt summary table
    app.displayDebtSummary();

    // Strategy comparison + what-if simulator
    const monthlyPayment = parseFloat(document.getElementById('monthlyPayment').value);
    const strategy = document.getElementById('paymentStrategy').value;
    app.displayInterestComparison(strategy, monthlyPayment);
    app.displayWhatIfSimulator(monthlyPayment, strategy);

    // Build payment schedule table
    app.displayPaymentSchedule();
}

export function renderStrategyIncomeWidget(app) {
    const widget = document.getElementById('strategyIncomeWidget');
    if (!widget) return;
    if (app.incomes.length === 0) { widget.classList.add('hidden'); widget.classList.remove('visible'); return; }

    const now = new Date();
    const { monthlyTotal } = computeMonthlyIncomeForMonth(app.incomes, app.bonuses, now.getFullYear(), now.getMonth());
    const totalDebtMin = app.debts.reduce((s, d) => s + (d.minimumPayment || 0), 0);
    const pct = monthlyTotal > 0 ? (totalDebtMin / monthlyTotal * 100) : 0;
    const isWarn = pct > 40;

    let ratioHtml = '';
    if (totalDebtMin > 0 && monthlyTotal > 0) {
        ratioHtml = `<div class="strategy-income-ratio${isWarn ? ' strategy-income-ratio--warn' : ''}">
            Your planned payment is <strong>${pct.toFixed(1)}%</strong> of your expected monthly income
            ${isWarn ? ' — that\'s a high debt-to-income ratio (>40%).' : '.'}
        </div>`;
    }

    const totalBills = (app.bills || []).reduce((s, b) => s + b.amount, 0);
    const totalExpenses = (app.expenses || []).reduce((s, e) => s + e.budgetAmount, 0);
    const bonusThisMonth = computeMonthlyBonusesForMonth(app.bonuses, now.getFullYear(), now.getMonth());
    const netAfterAll = monthlyTotal - totalDebtMin - totalBills - totalExpenses;

    let netHtml = '';
    if (totalBills > 0 || totalExpenses > 0) {
        const netClass = netAfterAll >= 0 ? 'strategy-net--positive' : 'strategy-net--negative';
        const bonusBit = bonusThisMonth > 0
            ? ` · Bonuses: ${formatCurrency(bonusThisMonth)}` : '';
        netHtml = `<div class="strategy-net ${netClass}">
            Net after all obligations:
            <strong>${formatCurrency(netAfterAll)}</strong>
            <span class="strategy-net-breakdown">(Bills: ${formatCurrency(totalBills)} · Expenses: ${formatCurrency(totalExpenses)} · Debt mins: ${formatCurrency(totalDebtMin)}${bonusBit})</span>
        </div>`;
    }

    const bonusChip = bonusThisMonth > 0
        ? `<span class="strategy-bonus-chip">+${formatCurrency(bonusThisMonth)} bonus this month</span>` : '';

    widget.classList.add('visible'); widget.classList.remove('hidden');
    widget.innerHTML = `
        💰 Expected income this month: <strong>${formatCurrency(monthlyTotal)}</strong> ${bonusChip}
        ${ratioHtml}
        ${netHtml}`;
}
