// Strategy/payment-plan feature module

import {
    formatCurrency,
    getDayOrdinal,
    computeMonthlyIncomeForMonth,
    computeMonthlyBonusesForMonth,
    computeInterestPaidToDate,
    escapeHtml,
    formatMonthYear
} from './utils.js';
import { computeBreakEven } from './breakEven.js';
import { recalculatePaymentPlan } from './strategyPlanCalculation.js';

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

export function renderDebtSummaryTable(app) {
    const summaryBody = document.getElementById('debtSummaryTableBody');
    summaryBody.innerHTML = '';

    const { col, dir } = app._debtSummarySort;

    // Update header sort icons
    document.querySelectorAll('#debtSummaryTable th[data-sort]').forEach(th => {
        const icon = th.querySelector('.sort-icon');
        if (!icon) return;
        if (th.getAttribute('data-sort') === col) {
            icon.textContent = dir === 1 ? '↑' : '↓';
            th.classList.add('sort-active');
        } else {
            icon.textContent = '↕';
            th.classList.remove('sort-active');
        }
    });

    const rows = [...app._debtSummaryRows].sort((a, b) => {
        let aVal = a[col];
        let bVal = b[col];
        // Treat dates as comparable strings (ISO-like format should sort correctly), nulls last
        if (col === 'payoffDate' || col === 'interestToDate') {
            if (!aVal && !bVal) return 0;
            if (!aVal) return 1;
            if (!bVal) return -1;
            if (col === 'payoffDate') return aVal.localeCompare(bVal) * dir;
            return (aVal - bVal) * dir;
        }
        if (col === 'name') return aVal.localeCompare(bVal) * dir;
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        return (aVal - bVal) * dir;
    });

    for (const summary of rows) {
        const dueDateStr = summary.dueDate
            ? `<div class="text-sm-muted margin-top-2">Due: ${getDayOrdinal(summary.dueDate)} of month</div>`
            : '';

        // Progress bar: based on originalBalance vs current accountBalance
        const origDebt = app.debts.find(d => d.name === summary.name);
        let progressPct = 0;
        if (summary.isFixedAmount && origDebt) {
            const start = new Date(origDebt.fixedStartDate);
            const end = new Date(origDebt.fixedEndDate);
            const now = new Date();
            const total = end - start;
            const elapsed = Math.max(0, Math.min(now - start, total));
            progressPct = total > 0 ? Math.round(elapsed / total * 100) : 0;
        } else if (origDebt) {
            const origBal = origDebt.originalBalance || origDebt.accountBalance || 0;
            const currBal = origDebt.accountBalance || 0;
            progressPct = origBal > 0 ? Math.min(100, Math.round((origBal - currBal) / origBal * 100)) : 0;
        }
        const progressBar = `
            <div class="summary-progress-wrap">
                <div class="summary-progress-bar">
                    <div class="summary-progress-fill${progressPct >= 100 ? ' summary-progress-fill--complete' : ''}" data-progress-width="${progressPct}"></div>
                </div>
                <div class="summary-progress-label">${progressPct}% paid off</div>
            </div>`;

        const row = document.createElement('tr');
        const iptdCell = summary.interestToDate !== null
            ? `<span class="iptd-value">${formatCurrency(summary.interestToDate)}</span>
               ${summary.debtStartDate ? `<div class="iptd-sub">since ${formatMonthYear(summary.debtStartDate)}</div>` : ''}`
            : '<span class="text-pale">No start date</span>';
        const iSavedCell = summary.interestSaved != null
            ? (summary.interestSaved > 0
                ? `<span class="be-col-saved">${formatCurrency(summary.interestSaved)}</span>`
                : `<span class="be-col-zero">$0.00</span>`)
            : '—';
        const mSavedCell = summary.monthsSaved != null
            ? (summary.monthsSaved > 0
                ? `<span class="be-col-saved">${summary.monthsSaved} mo</span>`
                : `<span class="be-col-zero">0</span>`)
            : '—';
        row.innerHTML = `
            <td>${escapeHtml(summary.name)}${dueDateStr}${progressBar}</td>
            <td class="min-due">${formatCurrency(summary.minDue)}</td>
            <td class="interest-rate">${summary.interestRate.toFixed(2)}%</td>
            <td class="amount">${formatCurrency(summary.totalPaid)}</td>
            <td class="principal">${formatCurrency(summary.principalPaid)}</td>
            <td class="interest">${formatCurrency(summary.interestPaid)}</td>
            <td>${iptdCell}</td>
            <td>${summary.payoffDate || '-'}</td>
            <td>${iSavedCell}</td>
            <td>${mSavedCell}</td>
            <td><button class="btn btn-small btn-secondary" data-amortization="${escapeHtml(summary.name)}">View</button></td>
        `;
        row.querySelectorAll('[data-progress-width]').forEach(el =>
            el.style.setProperty('--progress-width', el.dataset.progressWidth + '%'));
        summaryBody.appendChild(row);
        // Milestone: show confetti if debt was just paid off this render
        if (summary.payoffDate) {
            const today = new Date();
            const payoff = new Date(summary.payoffDate);
            if (
                payoff.getFullYear() === today.getFullYear() &&
                payoff.getMonth() === today.getMonth() &&
                payoff.getDate() === today.getDate()
            ) {
                app.showMilestone(summary.name);
            }
        }
    }

    // Add event listeners for amortization buttons
    document.querySelectorAll('[data-amortization]').forEach(btn => {
        btn.addEventListener('click', () => {
            const debtName = btn.getAttribute('data-amortization');
            app.showAmortizationModal(debtName);
        });
    });
}

/**
 * Build debt summary rows and render the summary table.
 */
export function displayDebtSummary(app) {
    // Get debt names in the order they appear in the payment plan (payment priority order)
    const debtOrderMap = {};
    const debtSummaryMap = {};
    let orderIndex = 0;

    // Map debtName to original debt object for min due and interest rate
    const originalDebts = {};
    for (const debt of app.debts) {
        originalDebts[debt.name] = debt;
    }

    for (const monthData of app.lastPaymentPlan) {
        for (const payment of monthData.payments) {
            if (!debtSummaryMap[payment.debtName]) {
                debtOrderMap[payment.debtName] = orderIndex++;
                const orig = originalDebts[payment.debtName] || {};
                debtSummaryMap[payment.debtName] = {
                    minDue: orig.minimumPayment || 0,
                    interestRate: orig.interestRate || 0,
                    dueDate: orig.dueDate || null,
                    isFixedAmount: orig.debtType === 'fixedAmount',
                    totalPaid: 0,
                    principalPaid: 0,
                    interestPaid: 0,
                    payoffDate: null,
                    lastPaymentDate: null
                };
            }

            debtSummaryMap[payment.debtName].totalPaid += payment.payment;
            debtSummaryMap[payment.debtName].principalPaid += payment.principal;
            debtSummaryMap[payment.debtName].interestPaid += payment.interest;

            // Build a date using the debt's due day if available, else the 1st of the month
            const summaryEntry = debtSummaryMap[payment.debtName];
            const dueDay = summaryEntry.dueDate;
            const payoffDateWithDueDay = (date) => {
                if (dueDay) {
                    const d = new Date(date.getFullYear(), date.getMonth(), dueDay);
                    return DebtCalculator.formatDate(d);
                }
                return DebtCalculator.formatDate(date);
            };

            // Track last payment date for fixed-amount debts (used as completion date)
            if (summaryEntry.isFixedAmount) {
                summaryEntry.lastPaymentDate = payoffDateWithDueDay(monthData.date);
            }

            if (payment.paidOff) {
                summaryEntry.payoffDate = payoffDateWithDueDay(monthData.date);
            }
        }
    }

    // Store rows as array for sorting: [name, summaryObj, orderIndex]
    app._debtSummaryRows = Object.entries(debtSummaryMap).map(([name, summary]) => {
        const origDebt = originalDebts[name] || {};
        const iptd = computeInterestPaidToDate(origDebt);

        let interestSaved = null;
        let monthsSaved = null;
        if (!summary.isFixedAmount && origDebt.accountBalance > 0) {
            const planPayment = app.lastPaymentPlan?.[0]?.payments?.find(p => p.debtName === name)?.payment || origDebt.minimumPayment;
            const be = computeBreakEven(origDebt, { minType: 'fixed', planPayment });
            if (be) {
                interestSaved = be.interestSaved;
                monthsSaved = be.monthsSaved;
            }
        }

        return {
            name,
            ...summary,
            payoffDate: summary.isFixedAmount ? (summary.lastPaymentDate || null) : summary.payoffDate,
            interestToDate: iptd ? iptd.interestPaid : null,
            debtStartDate: origDebt.debtStartDate || null,
            order: debtOrderMap[name],
            interestSaved,
            monthsSaved,
        };
    });
    app._debtSummarySort = app._debtSummarySort || { col: 'order', dir: 1 };

    renderDebtSummaryTable(app);

    // Wire up column header sort clicks (once)
    const table = document.getElementById('debtSummaryTable');
    table.querySelectorAll('th[data-sort]').forEach(th => {
        th.onclick = () => {
            const col = th.getAttribute('data-sort');
            if (app._debtSummarySort.col === col) {
                app._debtSummarySort.dir *= -1;
            } else {
                app._debtSummarySort.col = col;
                app._debtSummarySort.dir = 1;
            }
            renderDebtSummaryTable(app);
        };
    });
}

export function showAmortizationModal(app, debtName) {
    const modal = document.getElementById('amortizationModal');
    const title = document.getElementById('amortizationTitle');
    const wrapper = document.getElementById('amortizationTableWrapper');
    if (!modal || !title || !wrapper) return;
    title.textContent = `Amortization Schedule: ${debtName}`;
    let html = '<div class="table-wrapper"><table class="table-full-width"><thead><tr><th>Month</th><th>Payment</th><th>Principal</th><th>Interest</th><th>Balance</th></tr></thead><tbody>';
    if (app.lastPaymentPlan) {
        for (let mi = 0; mi < app.lastPaymentPlan.length; mi++) {
            const monthData = app.lastPaymentPlan[mi];
            const payment = monthData.payments.find(p => p.debtName === debtName);
            if (payment) {
                html += `<tr><td>${DebtCalculator.getMonthName(monthData.month - 1)}</td><td>${formatCurrency(payment.payment)}</td><td>${formatCurrency(payment.principal)}</td><td>${formatCurrency(payment.interest)}</td><td>${formatCurrency(payment.balance)}</td></tr>`;
            }
        }
    }
    html += '</tbody></table></div>';
    wrapper.innerHTML = html;
    modal.classList.remove('hidden');
    modal.classList.add('flex-visible');
    document.getElementById('closeAmortization').onclick = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex-visible');
    };
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex-visible');
        }
    };
}

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
