// Strategy/payment-plan feature module — payment schedule table

import {
    formatCurrency,
    escapeHtml
} from './utils.js';
import { recalculatePaymentPlan } from './strategyPlanCalculation.js';

/**
 * Build the monthly payment schedule table (tabular view tab).
 */
export function displayPaymentSchedule(app) {
    if (!app.lastPaymentPlan || app.lastPaymentPlan.length === 0) return;

    // Get unique debt names from the payment plan
    const debtNames = [];
    const debtNameSet = new Set();
    for (const monthData of app.lastPaymentPlan) {
        for (const payment of monthData.payments) {
            if (!debtNameSet.has(payment.debtName)) {
                debtNames.push(payment.debtName);
                debtNameSet.add(payment.debtName);
            }
        }
    }

    // Sort columns by payoff order
    const lastPaymentMonthIndex = {};
    for (const name of debtNames) lastPaymentMonthIndex[name] = -1;
    for (let mi = 0; mi < app.lastPaymentPlan.length; mi++) {
        for (const payment of app.lastPaymentPlan[mi].payments) {
            if (payment.payment > 0) {
                lastPaymentMonthIndex[payment.debtName] = mi;
            }
        }
    }
    debtNames.sort((a, b) => lastPaymentMonthIndex[a] - lastPaymentMonthIndex[b]);

    // Build header
    const thead = document.getElementById('paymentTableHead');
    thead.innerHTML = '';
    const headerRow = document.createElement('tr');
    headerRow.innerHTML = '<th>Month</th>';
    for (const debtName of debtNames) {
        headerRow.innerHTML += `<th>${escapeHtml(debtName)}</th>`;
    }
    headerRow.innerHTML += '<th>Stimulus ($)</th>';
    headerRow.innerHTML += '<th>Total Paid</th>';
    thead.appendChild(headerRow);

    // Build body with one row per month
    const tableBody = document.getElementById('paymentTableBody');
    tableBody.innerHTML = '';

    // Ensure perMonthStimulus array is at least as long as the plan
    if (!app.perMonthStimulus) app.perMonthStimulus = [];

    for (let mi = 0; mi < app.lastPaymentPlan.length; mi++) {
        const monthData = app.lastPaymentPlan[mi];
        const monthName = DebtCalculator.getMonthName(monthData.month - 1);

        const monthPaymentMap = {};
        const monthOverageMap = {};
        let monthTotal = 0;
        let monthTotalOverage = 0;
        let monthStimulusTotal = 0;

        for (const payment of monthData.payments) {
            monthPaymentMap[payment.debtName] = payment.payment;

            const originalDebt = app.debts.find(d => d.name === payment.debtName);
            const minimumPayment = originalDebt ? originalDebt.minimumPayment : 0;
            const overage = Math.max(0, payment.payment - minimumPayment);

            monthOverageMap[payment.debtName] = overage;
            monthTotal += payment.payment;
            monthTotalOverage += overage;
        }

        if (monthData.stimulusApplied) {
            for (const debtName of debtNames) {
                monthStimulusTotal += monthData.stimulusApplied[debtName] || 0;
            }
        }

        const editableStimulusVal = app.perMonthStimulus[mi] !== undefined ? app.perMonthStimulus[mi] : monthStimulusTotal;

        const row = document.createElement('tr');
        row.innerHTML = `<td><strong>${monthName}</strong></td>`;

        for (const debtName of debtNames) {
            const payment = monthPaymentMap[debtName] || 0;
            const overage = monthOverageMap[debtName] || 0;
            let paymentStr = '-';
            if (payment > 0) {
                paymentStr = formatCurrency(payment);
                if (overage > 0) {
                    paymentStr += `<br><small>(+${formatCurrency(overage)})</small>`;
                }
                if (monthData.stimulusApplied && monthData.stimulusApplied[debtName]) {
                    paymentStr += `<br><span class="stimulus-badge">(Stimulus: ${formatCurrency(monthData.stimulusApplied[debtName])})</span>`;
                }
            }
            row.innerHTML += `<td class="amount">${paymentStr}</td>`;
        }

        const stimulusInputId = `stimulus-input-${mi}`;
        const stimDisplayNumber = Number(editableStimulusVal);
        const stimDisplayStr = !isFinite(stimDisplayNumber) ? '0.00' : stimDisplayNumber.toFixed(2);
        const stimulusDisplay = `<input id="${stimulusInputId}" type="number" step="0.01" min="0" value="${stimDisplayStr}" class="stimulus-value-input">`;
        row.innerHTML += `<td class="amount stimulus-amount">${stimulusDisplay}</td>`;

        let totalPaidStr = formatCurrency(monthTotal);
        if (monthTotalOverage > 0) {
            totalPaidStr += `<br><small>(+${formatCurrency(monthTotalOverage)})</small>`;
        }
        row.innerHTML += `<td class="amount amount-total">${totalPaidStr}</td>`;

        tableBody.appendChild(row);

        const stimInput = document.getElementById(`stimulus-input-${mi}`);
        if (stimInput) {
            stimInput.addEventListener('change', (e) => {
                const v = parseFloat(e.target.value);
                app.perMonthStimulus[mi] = isNaN(v) ? 0 : v;
                app.saveToStorage();
                const monthlyPayment = parseFloat(document.getElementById('monthlyPayment').value);
                const strategy = document.getElementById('paymentStrategy').value;
                if (monthlyPayment && !isNaN(monthlyPayment) && monthlyPayment > 0) {
                    recalculatePaymentPlan(app, {
                        monthlyPayment, strategy, stimulus: app.perMonthStimulus,
                        onSuccess: () => app.displayPaymentPlan(),
                        onError: (err) => console.error('Error recalculating after stimulus change', err)
                    });
                }
            });
        }
    }
}
