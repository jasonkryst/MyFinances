// Payment plan calculation: DOM-input-driven entry points plus a shared recalculate core.

import { formatCurrency, escapeHtml } from './utils.js';

export function recalculatePaymentPlan(app, { monthlyPayment, strategy, stimulus, onSuccess, onError } = {}) {
    try {
        const result = DebtCalculator.calculatePaymentPlan(app.debts, monthlyPayment, strategy, stimulus);
        app.lastPaymentPlan = result.paymentPlan;
        app.lastSummary = DebtCalculator.generateSummary(result.workingDebts, result.paymentPlan);
        if (onSuccess) onSuccess();
    } catch (err) {
        if (onError) onError(err);
    }
}

/**
 * Run the main payment-plan calculation from the Plan section inputs.
 * Stores results and reveals the Results panel when successful.
 */
export function calculatePaymentPlanFromInputs(app) {
    const monthlyPayment = parseFloat(document.getElementById('monthlyPayment').value);
    const strategy = document.getElementById('paymentStrategy').value;

    if (!monthlyPayment || isNaN(monthlyPayment) || monthlyPayment <= 0) {
        alert('Please enter a valid monthly payment amount greater than 0.');
        return;
    }

    if (!app.debts || app.debts.length === 0) {
        alert('Please add at least one debt before calculating.');
        return;
    }

    const stimulus = app.perMonthStimulus && app.perMonthStimulus.length > 0
        ? app.perMonthStimulus
        : 0;
    recalculatePaymentPlan(app, {
        monthlyPayment, strategy, stimulus,
        onSuccess: () => {
            const resultsSection = document.getElementById('resultsSection');
            if (resultsSection) {
                resultsSection.classList.add('visible'); resultsSection.classList.remove('hidden');
            }
            app.displayPaymentPlan();
            app.saveToStorage();
        },
        onError: (err) => {
            alert(err && err.message ? err.message : 'Unable to calculate payment plan.');
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

    // If no date provided, just calculate plan with current payment and show results
    if (!dateVal) {
        if (app.debts.filter(d => d.debtType !== 'fixedAmount').length === 0) {
            resultEl.innerHTML = `<div class="target-result target-result--error"><div class="target-result-headline">No interest-bearing debts to calculate for.</div></div>`;
            return;
        }

        try {
            const r = DebtCalculator.calculatePaymentPlan(app.debts, monthlyPayment, strategy, 0);
            const summary = DebtCalculator.generateSummary(r.workingDebts, r.paymentPlan);

            // Store for the full plan display
            app.lastPaymentPlan = r.paymentPlan;
            app.lastSummary = summary;

            const actualMonths = r.paymentPlan.length;
            const payoffDateStr = summary ? DebtCalculator.formatDate(summary.payOffDate) : '—';
            const interestStr = summary ? formatCurrency(summary.totalInterest) : '—';

            resultEl.innerHTML = `<div class="target-result">
                <div class="target-result-headline">✅ Payment Plan</div>
                <span class="target-result-payment">${formatCurrency(monthlyPayment)}<span class="result-payment"> / month</span></span>
                <div class="target-result-meta">
                    <span>📅 Payoff by <strong>${payoffDateStr}</strong></span>
                    <span>⏱ ${actualMonths} month${actualMonths !== 1 ? 's' : ''}</span>
                    <span>💸 Total interest: <strong>${interestStr}</strong></span>
                </div>
            </div>`;

            // Display the full payment plan tabs and switch to the Plan page
            app.displayPaymentPlan();
            app.switchPage('strategy');
        } catch (e) {
            console.error('calculateRequiredPayment: ERROR', e);
            resultEl.innerHTML = `<div class="target-result target-result--error"><div class="target-result-headline">Error calculating payment plan: ${escapeHtml(e && e.message ? e.message : String(e))}</div></div>`;
        }
        return;
    }

    const targetDate = new Date(dateVal + 'T12:00:00');
    const today = new Date();
    if (targetDate <= today) {
        resultEl.innerHTML = `<div class="target-result target-result--error"><div class="target-result-headline">Target date must be in the future.</div></div>`;
        return;
    }

    if (app.debts.filter(d => d.debtType !== 'fixedAmount').length === 0) {
        console.warn('No interest-bearing debts found');
        resultEl.innerHTML = `<div class="target-result target-result--error"><div class="target-result-headline">No interest-bearing debts to calculate for.</div></div>`;
        return;
    }

    // How many months until target date?
    const targetMonths = (targetDate.getFullYear() - today.getFullYear()) * 12
        + (targetDate.getMonth() - today.getMonth());

    if (targetMonths < 1) {
        resultEl.innerHTML = `<div class="target-result target-result--error"><div class="target-result-headline">Target date must be at least one month away.</div></div>`;
        return;
    }

    // Minimum required payment (sum of minimums)
    const totalMinimum = app.debts.reduce((s, d) => s + (d.minimumPayment || 0), 0);

    // Binary search: find the smallest payment that pays off all debts within targetMonths
    let lo = totalMinimum;
    let hi = app.debts.reduce((s, d) => s + (d.accountBalance || 0), 0) * 2 + 10000;
    let found = null;

    for (let iter = 0; iter < 60; iter++) {
        const mid = (lo + hi) / 2;
        try {
            const r = DebtCalculator.calculatePaymentPlan(app.debts, mid, strategy, 0);
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
            <div class="target-result-headline">❌ Unable to calculate</div>
            <p class="margin-bottom-6">This target date may be unreachable. Try a later date.</p>
        </div>`;
        return;
    }

    // Round up to nearest dollar for a clean "safe" number
    const requiredPayment = Math.ceil(found);

    // Run once more at the clean number to get summary stats
    let summary;
    let actualMonths;
    try {
        const r = DebtCalculator.calculatePaymentPlan(app.debts, requiredPayment, strategy, 0);
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
        ? `⚠️ You need to pay ${formatCurrency(extraNeeded)} more/month`
        : '✅ Your current payment covers this goal';

    const payoffDateStr = summary ? DebtCalculator.formatDate(summary.payOffDate) : dateVal;
    const interestStr = summary ? formatCurrency(summary.totalInterest) : '—';

    resultEl.innerHTML = `<div class="target-result ${panelClass}">
        <div class="target-result-headline">${headline}</div>
        <span class="target-result-payment">${formatCurrency(requiredPayment)}<span class="result-payment"> / month</span></span>
        <div class="target-result-meta">
            <span>📅 Payoff by <strong>${payoffDateStr}</strong></span>
            <span>⏱ ${actualMonths} month${actualMonths !== 1 ? 's' : ''}</span>
            <span>💸 Total interest: <strong>${interestStr}</strong></span>
        </div>
        ${isHigher ? `<div class="target-result-action">
            <button class="btn btn-primary btn-small" id="applyTargetPayment">Use this amount ↗</button>
        </div>` : ''}
    </div>`;

    if (isHigher) {
        document.getElementById('applyTargetPayment').addEventListener('click', () => {
            document.getElementById('monthlyPayment').value = requiredPayment;
            document.getElementById('paymentStrategy').value = strategy;
            app.saveToStorage();

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
