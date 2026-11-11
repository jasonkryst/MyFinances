// Payment plan calculation: DOM-input-driven entry points plus a shared recalculate core.

import { formatCurrency, formatLongDate, escapeHtml } from './utils.js';
import { t, plural } from './i18n.js';
import { showAlertModal } from './ui.js';
import { pgCreate, pgDelete } from './postgresSync.js';

function computeDebtFingerprint(debts) {
    return (debts || [])
        .filter(d => !d.archived)
        .sort((a, b) => a.id - b.id)
        .map(d => `${d.id}|${d.accountBalance}|${d.interestRate}|${d.minimumPayment}`)
        .join(',');
}

// Plan History keeps only the most recent submissions -- older entries are
// trimmed (and, on the Postgres backend, deleted server-side) past this cap.
export const PLAN_HISTORY_CAP = 20;

// Append a Plan History entry for a just-submitted "Calculate Payment Plan"
// run (issue #162). Only called from the main Calculate flow, not the
// Target Payoff Date back-calculator, so history reflects deliberate plan
// submissions rather than every exploratory calculation.
export async function recordPlanHistoryEntry(app, monthlyPayment, strategy) {
    if (!app.lastSummary) return;

    const entry = {
        id: Date.now(),
        monthlyPayment,
        strategy,
        totalInterest: app.lastSummary.totalInterest,
        monthsToPayOff: app.lastSummary.monthsToPayOff,
        payoffDate: app.lastSummary.payOffDate ? app.lastSummary.payOffDate.toISOString() : null,
        totalDebt: app.lastSummary.totalDebt,
        createdAt: new Date().toISOString()
    };

    // Only a saved entry joins the history (#460); a failed save already
    // showed the sync-error banner, and the plan itself still renders.
    if (!(await pgCreate(app, 'planHistory', '/api/plan-history', entry))) return;

    const overflow = app.planHistory.length - PLAN_HISTORY_CAP;
    if (overflow > 0) {
        const trimmed = app.planHistory.splice(0, overflow);
        trimmed.forEach(t => pgDelete(app, `/api/plan-history/${t.id}`));
    }
}

// Silently restore and display the last-submitted plan on load (issue #162)
// so the user sees their previous results without re-clicking Calculate.
// Guarded by the caller to only run once per load (before any plan exists).
export function restoreLastPlan(app) {
    if (app.lastPaymentPlan) return;
    if (!app._savedMonthlyPayment || !app._savedStrategy) return;
    const activeDebtsForRestore = app.debts.filter(d => !d.archived);
    if (!activeDebtsForRestore.length) return;

    const stimulus = app.perMonthStimulus && app.perMonthStimulus.length > 0
        ? app.perMonthStimulus
        : 0;

    recalculatePaymentPlan(app, {
        monthlyPayment: app._savedMonthlyPayment,
        strategy: app._savedStrategy,
        stimulus,
        onSuccess: () => {
            const resultsSection = document.getElementById('resultsSection');
            if (resultsSection) {
                resultsSection.classList.add('visible'); resultsSection.classList.remove('hidden');
            }
            app.displayPaymentPlan();
        },
        onError: () => { /* saved values no longer produce a valid plan (e.g. debts changed) -- leave Results hidden */ }
    });
}

export function recalculatePaymentPlan(app, { monthlyPayment, strategy, stimulus, onSuccess, onError } = {}) {
    try {
        const activeDebts = app.debts.filter(d => !d.archived);
        const result = DebtCalculator.calculatePaymentPlan(activeDebts, monthlyPayment, strategy, stimulus);
        app.lastPaymentPlan = result.paymentPlan;
        app.lastSummary = DebtCalculator.generateSummary(result.workingDebts, result.paymentPlan);
        app._planFingerprint = computeDebtFingerprint(app.debts);
        if (onSuccess) onSuccess();
    } catch (err) {
        if (onError) onError(err);
    }
}

/**
 * Run the main payment-plan calculation from the Plan section inputs.
 * Stores results and reveals the Results panel when successful.
 */
export async function calculatePaymentPlanFromInputs(app) {
    const monthlyPayment = parseFloat(document.getElementById('monthlyPayment').value);
    const strategy = document.getElementById('paymentStrategy').value;

    if (!monthlyPayment || isNaN(monthlyPayment) || monthlyPayment <= 0) {
        await showAlertModal(t('strategy.alertInvalidPayment'));
        return;
    }

    const activeDebts = app.debts.filter(d => !d.archived);
    if (!activeDebts.length) {
        await showAlertModal(t('strategy.alertNoDebts'));
        return;
    }

    const stimulus = app.perMonthStimulus && app.perMonthStimulus.length > 0
        ? app.perMonthStimulus
        : 0;
    recalculatePaymentPlan(app, {
        monthlyPayment, strategy, stimulus,
        onSuccess: async () => {
            const resultsSection = document.getElementById('resultsSection');
            if (resultsSection) {
                resultsSection.classList.add('visible'); resultsSection.classList.remove('hidden');
            }
            app.displayPaymentPlan();
            await recordPlanHistoryEntry(app, monthlyPayment, strategy);
            app.renderPlanHistory();
            app.saveToStorage(['monthlyPayment', 'strategy']);
        },
        onError: (err) => {
            showAlertModal(err && err.message ? err.message : t('strategy.alertCalcFailed'));
        }
    });
}

/**
 * Use binary search to find the minimum monthly payment needed to pay off all
 * interest-bearing debts by the user's chosen target date.
 */
export function calculateRequiredPayment(app) {
    const resultEl = document.getElementById('targetPayoffResult');

    if (!resultEl) {
        console.error('targetPayoffResult element not found!');
        return;
    }

    const dateVal = document.getElementById('targetPayoffDate').value;
    const strategy = document.getElementById('targetPayoffStrategy').value;
    const monthlyPayment = parseFloat(document.getElementById('monthlyPayment').value) || 0;
    const activeDebts = app.debts.filter(d => !d.archived);

    // If no date provided, just calculate plan with current payment and show results
    if (!dateVal) {
        if (activeDebts.filter(d => d.debtType !== 'fixedAmount').length === 0) {
            resultEl.innerHTML = `<div class="target-result target-result--error"><div class="target-result-headline">${escapeHtml(t('strategy.noInterestDebts'))}</div></div>`;
            return;
        }

        try {
            const r = DebtCalculator.calculatePaymentPlan(activeDebts, monthlyPayment, strategy, 0);
            const summary = DebtCalculator.generateSummary(r.workingDebts, r.paymentPlan);

            // Store for the full plan display
            app.lastPaymentPlan = r.paymentPlan;
            app.lastSummary = summary;
            app._planFingerprint = computeDebtFingerprint(app.debts);

            const actualMonths = r.paymentPlan.length;
            const payoffDateStr = summary ? formatLongDate(summary.payOffDate) : '—';
            const interestStr = summary ? formatCurrency(summary.totalInterest) : '—';

            resultEl.innerHTML = `<div class="target-result">
                <div class="target-result-headline">✅ ${escapeHtml(t('strategy.title'))}</div>
                <span class="target-result-payment">${formatCurrency(monthlyPayment)}<span class="result-payment"> ${escapeHtml(t('strategy.perMonth'))}</span></span>
                <div class="target-result-meta">
                    <span>📅 ${escapeHtml(t('strategy.payoffBy', { date: payoffDateStr }))}</span>
                    <span>⏱ ${escapeHtml(plural('strategy.months', actualMonths))}</span>
                    <span>💸 ${escapeHtml(t('strategy.totalInterestIs', { amount: interestStr }))}</span>
                </div>
            </div>`;

            // Display the full payment plan tabs and switch to the Plan page
            app.displayPaymentPlan();
            app.switchPage('strategy');
        } catch (e) {
            console.error('calculateRequiredPayment: ERROR', e);
            resultEl.innerHTML = `<div class="target-result target-result--error"><div class="target-result-headline">${escapeHtml(t('strategy.errorCalculating', { message: e && e.message ? e.message : String(e) }))}</div></div>`;
        }
        return;
    }

    const targetDate = new Date(dateVal + 'T12:00:00');
    const today = new Date();
    if (targetDate <= today) {
        resultEl.innerHTML = `<div class="target-result target-result--error"><div class="target-result-headline">${escapeHtml(t('strategy.targetFuture'))}</div></div>`;
        return;
    }

    if (activeDebts.filter(d => d.debtType !== 'fixedAmount').length === 0) {
        console.warn('No interest-bearing debts found');
        resultEl.innerHTML = `<div class="target-result target-result--error"><div class="target-result-headline">${escapeHtml(t('strategy.noInterestDebts'))}</div></div>`;
        return;
    }

    // How many months until target date?
    const targetMonths = (targetDate.getFullYear() - today.getFullYear()) * 12
        + (targetDate.getMonth() - today.getMonth());

    if (targetMonths < 1) {
        resultEl.innerHTML = `<div class="target-result target-result--error"><div class="target-result-headline">${escapeHtml(t('strategy.targetOneMonth'))}</div></div>`;
        return;
    }

    // Minimum required payment (sum of minimums)
    const totalMinimum = activeDebts.reduce((s, d) => s + (d.minimumPayment || 0), 0);

    // Binary search: find the smallest payment that pays off all debts within targetMonths
    let lo = totalMinimum;
    let hi = activeDebts.reduce((s, d) => s + (d.accountBalance || 0), 0) * 2 + 10000;
    let found = null;

    for (let iter = 0; iter < 60; iter++) {
        const mid = (lo + hi) / 2;
        try {
            const r = DebtCalculator.calculatePaymentPlan(activeDebts, mid, strategy, 0);
            if (r.paymentPlan.length <= targetMonths) {
                found = mid;
                hi = mid;
            } else {
                lo = mid;
            }
        } catch (e) {
            lo = mid;
        }
    }

    if (!found) {
        resultEl.innerHTML = `<div class="target-result target-result--error">
            <div class="target-result-headline">❌ ${escapeHtml(t('strategy.unableToCalculate'))}</div>
            <p class="margin-bottom-6">${escapeHtml(t('strategy.targetUnreachable'))}</p>
        </div>`;
        return;
    }

    // Round up to nearest dollar for a clean "safe" number
    const requiredPayment = Math.ceil(found);

    // Run once more at the clean number to get summary stats
    let summary;
    let actualMonths;
    try {
        const r = DebtCalculator.calculatePaymentPlan(activeDebts, requiredPayment, strategy, 0);
        summary = DebtCalculator.generateSummary(r.workingDebts, r.paymentPlan);
        actualMonths = r.paymentPlan.length;
    } catch (e) {
        summary = null;
        actualMonths = targetMonths;
    }

    const currentPayment = parseFloat(document.getElementById('monthlyPayment').value) || 0;
    const extraNeeded = requiredPayment - currentPayment;
    const isHigher = requiredPayment > currentPayment + 0.5;
    const panelClass = isHigher ? 'target-result--warn' : 'target-result';
    const headline = isHigher
        ? `⚠️ ${escapeHtml(t('strategy.needMore', { amount: formatCurrency(extraNeeded) }))}`
        : `✅ ${escapeHtml(t('strategy.currentCovers'))}`;

    // Fallback formats the parsed target date, never the raw <input> text
    // (CodeQL js/xss-through-dom, #380), and is escaped like any other value.
    const payoffDateStr = formatLongDate(summary ? summary.payOffDate : targetDate);
    const interestStr = summary ? formatCurrency(summary.totalInterest) : '—';

    resultEl.innerHTML = `<div class="target-result ${panelClass}">
        <div class="target-result-headline">${headline}</div>
        <span class="target-result-payment">${formatCurrency(requiredPayment)}<span class="result-payment"> ${escapeHtml(t('strategy.perMonth'))}</span></span>
        <div class="target-result-meta">
            <span>📅 ${escapeHtml(t('strategy.payoffBy', { date: payoffDateStr }))}</span>
            <span>⏱ ${escapeHtml(plural('strategy.months', actualMonths))}</span>
            <span>💸 ${escapeHtml(t('strategy.totalInterestIs', { amount: interestStr }))}</span>
        </div>
        ${isHigher ? `<div class="target-result-action">
            <button class="btn btn-primary btn-small" id="applyTargetPayment">${escapeHtml(t('strategy.useAmount'))} ↗</button>
        </div>` : ''}
    </div>`;

    if (isHigher) {
        document.getElementById('applyTargetPayment').addEventListener('click', () => {
            document.getElementById('monthlyPayment').value = requiredPayment;
            document.getElementById('paymentStrategy').value = strategy;
            app.saveToStorage(['monthlyPayment', 'strategy']);

            // Recalculate and display the full plan
            recalculatePaymentPlan(app, {
                monthlyPayment: requiredPayment, strategy, stimulus: 0,
                onSuccess: () => {
                    app.displayPaymentPlan();
                    app.switchPage('strategy');
                },
                onError: (err) => console.error('Error recalculating plan:', err)
            });
        });
    }
}
