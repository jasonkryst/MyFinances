// Bonus advisor: compares putting a one-time bonus toward debt payoff
// (cash flow) vs. leaving it to grow in a savings account (long-term
// savings). Reuses the existing debt payoff engine and account-interest
// helper rather than introducing new calculation logic.

import { dailyCompoundInterest, formatCurrency, escapeHtml, sanitizeFiniteNumber } from './utils.js';

/**
 * Pure calculation — no DOM/app access.
 * @param {object} params
 * @param {number} params.bonusAmount
 * @param {object[]} params.debts
 * @param {number} params.monthlyPayment
 * @param {string} params.strategy
 * @param {number} params.accountRate - annual APY percent, 0 if none available
 * @returns {{ cashFlow: object, savings: object }}
 */
export function calculateBonusAdvice({ bonusAmount, debts, monthlyPayment, strategy, accountRate }) {
    return {
        cashFlow: calculateCashFlowAdvice(bonusAmount, debts, monthlyPayment, strategy),
        savings: calculateSavingsAdvice(bonusAmount, accountRate)
    };
}

function calculateCashFlowAdvice(bonusAmount, debts, monthlyPayment, strategy) {
    const hasDebts = Array.isArray(debts) && debts.length > 0;
    const hasInterestBearingDebt = hasDebts && debts.some(d => d.debtType !== 'fixedAmount');

    if (!hasDebts) {
        return { applicable: false, reason: 'Add a debt first to see the cash flow impact.' };
    }
    if (!hasInterestBearingDebt) {
        return { applicable: false, reason: 'All current debts are fixed-amount and never receive extra payments.' };
    }
    if (!(bonusAmount > 0)) {
        return { applicable: false, reason: 'Enter a bonus amount to see the cash flow impact.' };
    }

    try {
        const baseline = DebtCalculator.calculatePaymentPlan(debts, monthlyPayment, strategy, 0);
        const withBonus = DebtCalculator.calculatePaymentPlan(debts, monthlyPayment, strategy, [bonusAmount]);
        const baselineSummary = DebtCalculator.generateSummary(baseline.workingDebts, baseline.paymentPlan);
        const withBonusSummary = DebtCalculator.generateSummary(withBonus.workingDebts, withBonus.paymentPlan);

        const interestSaved = Math.max(0, parseFloat((baselineSummary.totalInterest - withBonusSummary.totalInterest).toFixed(2)));
        const monthsSaved = Math.max(0, baseline.paymentPlan.length - withBonus.paymentPlan.length);

        let freedMonthly = 0;
        for (const debt of withBonus.workingDebts) {
            const baselineDebt = baseline.workingDebts.find(d => d.id === debt.id);
            if (baselineDebt && debt.paidOffMonth && baselineDebt.paidOffMonth
                && debt.paidOffMonth < baselineDebt.paidOffMonth) {
                freedMonthly += debt.minimumPayment || 0;
            }
        }

        return {
            applicable: true,
            interestSaved,
            monthsSaved,
            freedMonthly: parseFloat(freedMonthly.toFixed(2))
        };
    } catch (err) {
        return { applicable: false, reason: 'Unable to calculate a payment plan for your current debts.' };
    }
}

function calculateSavingsAdvice(bonusAmount, accountRate) {
    const rate = accountRate > 0 ? accountRate : 0;
    return {
        applicable: true,
        rate,
        growth1yr: parseFloat(dailyCompoundInterest(bonusAmount || 0, rate, 365).toFixed(2)),
        growth5yr: parseFloat(dailyCompoundInterest(bonusAmount || 0, rate, 365 * 5).toFixed(2))
    };
}

/**
 * Read the live bonus form + Plan page settings, compute advice, and render
 * the result panel. DOM-input-driven entry point, called from the "What
 * should I do with this?" button in the bonus form.
 */
export function showBonusAdvice(app) {
    const resultEl = document.getElementById('bonusAdviceResult');
    if (!resultEl) return;

    const rawAmount = document.getElementById('bonusAmount')?.value;
    const bonusAmount = sanitizeFiniteNumber(rawAmount, NaN, { min: 0.01 });
    if (!rawAmount || isNaN(Number(rawAmount)) || Number(rawAmount) <= 0) {
        alert('Please enter a valid amount before requesting advice.');
        return;
    }

    const accountId = parseInt(document.getElementById('bonusAccount')?.value) || null;
    const advice = calculateBonusAdvice({
        bonusAmount,
        debts: app.debts || [],
        monthlyPayment: getConfiguredMonthlyPayment(app),
        strategy: document.getElementById('paymentStrategy')?.value || 'avalanche',
        accountRate: getAccountRate(app, accountId)
    });

    resultEl.innerHTML = renderAdviceHtml(advice);
}

function getConfiguredMonthlyPayment(app) {
    const totalMinimum = (app.debts || []).reduce((s, d) => s + (d.minimumPayment || 0), 0);
    const configured = parseFloat(document.getElementById('monthlyPayment')?.value);
    return (configured && configured >= totalMinimum) ? configured : totalMinimum;
}

function getAccountRate(app, accountId) {
    const accounts = app.accounts || [];
    if (accountId) {
        const linked = accounts.find(a => a.id === accountId);
        if (linked && linked.interestRate > 0) return linked.interestRate;
    }
    return accounts.reduce((max, a) => Math.max(max, a.interestRate || 0), 0);
}

function renderAdviceHtml(advice) {
    const cf = advice.cashFlow;
    const sv = advice.savings;

    const cashFlowBody = cf.applicable
        ? `<div class="bonus-advice-stat"><strong>${formatCurrency(cf.interestSaved)}</strong> interest saved</div>
           <div class="bonus-advice-stat">${cf.monthsSaved} month${cf.monthsSaved === 1 ? '' : 's'} sooner payoff</div>
           <div class="bonus-advice-stat">${formatCurrency(cf.freedMonthly)}/mo freed up sooner</div>`
        : `<div class="bonus-advice-na">N/A — ${escapeHtml(cf.reason)}</div>`;

    const savingsBody = sv.rate > 0
        ? `<div class="bonus-advice-stat">${formatCurrency(sv.growth1yr)} in 1 year</div>
           <div class="bonus-advice-stat">${formatCurrency(sv.growth5yr)} in 5 years</div>
           <div class="bonus-advice-stat">at ${sv.rate.toFixed(2)}% APY</div>`
        : `<div class="bonus-advice-na">No interest-bearing account linked — link this bonus to an account with an APY to see growth projections.</div>`;

    return `
        <div class="bonus-advice">
            <div class="bonus-advice-card">
                <h5 class="bonus-advice-title">💳 Cash Flow — pay down debt</h5>
                ${cashFlowBody}
            </div>
            <div class="bonus-advice-card">
                <h5 class="bonus-advice-title">🏦 Savings — grow long-term</h5>
                ${savingsBody}
            </div>
        </div>`;
}
