// Strategy/payment-plan feature module

import {
    formatCurrency,
    formatShortDate,
    formatLongDate,
    escapeHtml,
    computeMonthlyIncomeForMonth,
    computeMonthlyBonusesForMonth
} from './utils.js';
import { t, plural } from './i18n.js';

function computeDebtFingerprint(debts) {
    return (debts || [])
        .filter(d => !d.archived)
        .sort((a, b) => a.id - b.id)
        .map(d => `${d.id}|${d.accountBalance}|${d.interestRate}|${d.minimumPayment}`)
        .join(',');
}

function isPlanStale(app) {
    if (!app.lastPaymentPlan || !app._planFingerprint) return false;
    return computeDebtFingerprint(app.debts) !== app._planFingerprint;
}

function wirePlanStaleBanner(app) {
    const staleWarning = document.getElementById('planStaleWarning');
    if (!staleWarning) return;
    staleWarning.hidden = !isPlanStale(app);
    const staleBtn = document.getElementById('planStaleRecalcBtn');
    if (staleBtn && !staleBtn._wired) {
        staleBtn._wired = true;
        staleBtn.addEventListener('click', () => app.calculatePaymentPlanFromInputs());
    }
}

const PLAN_STRATEGY_KEYS = {
    avalanche: 'strategy.avalanche',
    snowball: 'strategy.snowball',
    'priority-lowest': 'strategy.priorityLowest',
    'priority-highest': 'strategy.priorityHighest'
};

// Stored strategy ids stay as-is; this translates them at render time.
export function strategyLabel(strategy) {
    const key = PLAN_STRATEGY_KEYS[strategy];
    return key ? t(key) : String(strategy ?? '');
}

/**
 * Render the full Results page after a calculation.
 */
export function displayPaymentPlan(app) {
    if (!app.lastPaymentPlan || !app.lastSummary) {
        console.error('displayPaymentPlan: missing data!');
        return;
    }
    wirePlanStaleBanner(app);

    // Update summary
    document.getElementById('totalDebtValue').textContent =
        formatCurrency(app.lastSummary.totalDebt);
    document.getElementById('totalInterestValue').textContent =
        formatCurrency(app.lastSummary.totalInterest);
    document.getElementById('timeToPayOffValue').textContent =
        plural('strategy.timeToPayOffValue', app.lastSummary.monthsToPayOff, { date: formatLongDate(app.lastSummary.payOffDate) });

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

export function suggestMonthlyPayment(app) {
    const now = new Date();
    const { monthlyTotal } = computeMonthlyIncomeForMonth(app.incomes, app.bonuses, now.getFullYear(), now.getMonth());
    const totalDebtMin = (app.debts || []).reduce((s, d) => s + (d.minimumPayment || 0), 0);
    const totalBills = (app.bills || []).reduce((s, b) => s + (b.amount || 0), 0);
    const totalExpenses = (app.expenses || []).reduce((s, e) => s + (e.budgetAmount || 0), 0);
    const suggested = Math.max(0, monthlyTotal - totalBills - totalExpenses - totalDebtMin);
    const input = document.getElementById('monthlyPayment');
    if (input) {
        input.value = suggested > 0 ? suggested.toFixed(2) : '';
        input.dispatchEvent(new Event('input'));
    }
}

export function renderStrategyIncomeWidget(app) {
    wirePlanStaleBanner(app);
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
            ${escapeHtml(t(isWarn ? 'strategy.ratioWarn' : 'strategy.ratioOk', { pct: pct.toFixed(1) }))}
        </div>`;
    }

    const totalBills = (app.bills || []).reduce((s, b) => s + b.amount, 0);
    const totalExpenses = (app.expenses || []).reduce((s, e) => s + e.budgetAmount, 0);
    const bonusThisMonth = computeMonthlyBonusesForMonth(app.bonuses, now.getFullYear(), now.getMonth());
    const netAfterAll = monthlyTotal - totalDebtMin - totalBills - totalExpenses;

    let netHtml = '';
    if (totalBills > 0 || totalExpenses > 0) {
        const netClass = netAfterAll >= 0 ? 'strategy-net--positive' : 'strategy-net--negative';
        const breakdown = t(bonusThisMonth > 0 ? 'strategy.netBreakdownBonus' : 'strategy.netBreakdown', {
            bills: formatCurrency(totalBills), expenses: formatCurrency(totalExpenses),
            mins: formatCurrency(totalDebtMin), bonus: formatCurrency(bonusThisMonth)
        });
        netHtml = `<div class="strategy-net ${netClass}">
            ${escapeHtml(t('strategy.netAfter', { amount: formatCurrency(netAfterAll) }))}
            <span class="strategy-net-breakdown">${escapeHtml(breakdown)}</span>
        </div>`;
    }

    const bonusChip = bonusThisMonth > 0
        ? `<span class="strategy-bonus-chip">${escapeHtml(t('strategy.bonusChip', { amount: formatCurrency(bonusThisMonth) }))}</span>` : '';

    widget.classList.add('visible'); widget.classList.remove('hidden');
    widget.innerHTML = `
        💰 ${escapeHtml(t('strategy.incomeExpected', { amount: formatCurrency(monthlyTotal) }))} ${bonusChip}
        ${ratioHtml}
        ${netHtml}`;
}

/**
 * Render the read-only Plan History table — one row per previously submitted
 * "Calculate Payment Plan" run, newest first. Purely informational; entries
 * are not editable or reapplyable from this view.
 */
export function renderPlanHistory(app) {
    const body = document.getElementById('planHistoryBody');
    const empty = document.getElementById('planHistoryEmpty');
    const table = document.getElementById('planHistoryTable');
    if (!body) return;

    const entries = (app.planHistory || []).slice().reverse();

    if (entries.length === 0) {
        body.innerHTML = '';
        if (table) table.classList.add('hidden');
        if (empty) empty.classList.remove('hidden');
        return;
    }

    if (table) table.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');

    body.innerHTML = entries.map(entry => `
        <tr>
            <td>${escapeHtml(formatShortDate(entry.createdAt))}</td>
            <td>${formatCurrency(entry.monthlyPayment)}</td>
            <td>${escapeHtml(strategyLabel(entry.strategy))}</td>
            <td>${formatCurrency(entry.totalInterest)}</td>
            <td>${escapeHtml(plural('strategy.months', entry.monthsToPayOff))}</td>
            <td>${entry.payoffDate ? escapeHtml(formatShortDate(entry.payoffDate)) : '—'}</td>
        </tr>
    `).join('');
}
