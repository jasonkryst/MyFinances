// Strategy/payment-plan feature module

import {
    getBillsByDayForMonth,
    getIncomeEventsByMonthForRange,
    formatCurrency,
    getDayOrdinal,
    computeMonthlyIncomeForMonth,
    computeMonthlyBonusesForMonth,
    computeInterestPaidToDate,
    escapeHtml
} from './utils.js';

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

    try {
        const stimulus = app.perMonthStimulus && app.perMonthStimulus.length > 0
            ? app.perMonthStimulus
            : 0;
        const result = DebtCalculator.calculatePaymentPlan(app.debts, monthlyPayment, strategy, stimulus);
        app.lastPaymentPlan = result.paymentPlan;
        app.lastSummary = DebtCalculator.generateSummary(result.workingDebts, result.paymentPlan);

        const resultsSection = document.getElementById('resultsSection');
        if (resultsSection) {
            resultsSection.style.display = 'block';
        }

        app.displayPaymentPlan();
        app.saveToStorage();
    } catch (err) {
        alert(err && err.message ? err.message : 'Unable to calculate payment plan.');
    }
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
                <span class="target-result-payment">${formatCurrency(monthlyPayment)}<span style="font-size:0.5em;font-weight:500;"> / month</span></span>
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
            <p style="margin:0;font-size:0.88rem;">This target date may be unreachable. Try a later date.</p>
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
        <span class="target-result-payment">${formatCurrency(requiredPayment)}<span style="font-size:0.5em;font-weight:500;"> / month</span></span>
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
            try {
                const result = DebtCalculator.calculatePaymentPlan(app.debts, requiredPayment, strategy, 0);
                app.lastPaymentPlan = result.paymentPlan;
                app.lastSummary = DebtCalculator.generateSummary(result.workingDebts, result.paymentPlan);
                app.displayPaymentPlan();
                app.switchPage('strategy');
            } catch (err) {
                console.error('Error recalculating plan:', err);
            }
        });
    }
}

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

/**
 * Render the payment calendar for a given page (1 month per page).
 */
export function renderCalendarView(app, page = 0) {
    const container = document.getElementById('calendarView');
    if (!container || !app.lastPaymentPlan || app.lastPaymentPlan.length === 0) return;
    container.innerHTML = '';

    const MONTHS_PER_PAGE = 1;

    const debtColors = {};
    const palette = [
        '#2563eb', '#dc2626', '#d97706', '#7c3aed',
        '#db2777', '#0891b2', '#65a30d', '#ea580c', '#6366f1'
    ];
    let colorIdx = 0;
    for (const debt of app.debts) {
        debtColors[debt.name] = palette[colorIdx++ % palette.length];
    }

    const planStart = app.lastPaymentPlan[0].date;
    const planEnd = app.lastPaymentPlan[app.lastPaymentPlan.length - 1].date;
    const incomeByMonth = getIncomeEventsByMonthForRange(app.incomes || [], planStart, planEnd);

    const monthMap = new Map();
    for (const monthData of app.lastPaymentPlan) {
        const d = monthData.date;
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        if (!monthMap.has(key)) {
            monthMap.set(key, { year: d.getFullYear(), month: d.getMonth(), payments: [] });
        }
        for (const payment of monthData.payments) {
            if (payment.payment <= 0) continue;
            const orig = app.debts.find(dbt => dbt.name === payment.debtName);
            const dueDay = orig?.dueDate || 1;
            monthMap.get(key).payments.push({
                name: payment.debtName,
                payment: payment.payment,
                dueDay,
                color: debtColors[payment.debtName] || '#2563eb'
            });
        }
    }

    const allMonths = [...monthMap.values()];
    const totalPages = Math.ceil(allMonths.length / MONTHS_PER_PAGE);
    page = Math.max(0, Math.min(page, totalPages - 1));
    const pageMonths = allMonths.slice(page * MONTHS_PER_PAGE, page * MONTHS_PER_PAGE + MONTHS_PER_PAGE);

    const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const hasIncome = (app.incomes || []).length > 0;
    const hasBills = (app.bills || []).some(b => b.dueDay);
    const legendDiv = document.createElement('div');
    legendDiv.className = 'cal-legend';
    legendDiv.innerHTML = `
        <span class="cal-legend-item"><span class="cal-legend-swatch" style="background:#2563eb;"></span>Debt payment</span>
        ${hasIncome ? `<span class="cal-legend-item"><span class="cal-legend-swatch cal-legend-swatch--income"></span>Payday</span>` : ''}
        ${hasBills ? `<span class="cal-legend-item"><span class="cal-legend-swatch cal-legend-swatch--bill"></span>Bill due</span>` : ''}
        <span class="cal-legend-item"><span class="cal-legend-swatch cal-legend-swatch--today"></span>Today</span>
    `;
    container.appendChild(legendDiv);

    const paginationTop = document.createElement('div');
    paginationTop.className = 'cal-pagination';
    paginationTop.innerHTML = `
        <button class="btn btn-secondary cal-prev" ${page === 0 ? 'disabled' : ''}>&#8592; Prev</button>
        <span class="cal-page-label">${page * MONTHS_PER_PAGE + 1}–${Math.min((page + 1) * MONTHS_PER_PAGE, allMonths.length)} of ${allMonths.length} months</span>
        <button class="btn btn-secondary cal-next" ${page >= totalPages - 1 ? 'disabled' : ''}>Next &#8594;</button>
    `;
    container.appendChild(paginationTop);

    const monthsRow = document.createElement('div');
    monthsRow.className = 'cal-months-row';

    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth();
    const todayDay = today.getDate();

    for (const { year, month, payments } of pageMonths) {
        const monthLabel = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

        const dayPayments = {};
        for (const p of payments) {
            if (!dayPayments[p.dueDay]) dayPayments[p.dueDay] = [];
            dayPayments[p.dueDay].push(p);
        }

        const monthKey = `${year}-${month}`;
        const incomeEvents = incomeByMonth.get(monthKey) || [];
        const dayIncome = {};
        for (const inc of incomeEvents) {
            if (!dayIncome[inc.day]) dayIncome[inc.day] = [];
            dayIncome[inc.day].push(inc);
        }

        const dayBills = getBillsByDayForMonth(app.bills, year, month);

        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        let gridHTML = `<div class="cal-day-labels">`;
        for (const dl of DAY_LABELS) gridHTML += `<div class="cal-day-label">${dl}</div>`;
        gridHTML += `</div><div class="cal-grid">`;

        for (let i = 0; i < firstDay; i++) {
            gridHTML += `<div class="cal-cell cal-empty"></div>`;
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const events = dayPayments[day] || [];
            const incomes = dayIncome[day] || [];
            const bills = dayBills[day] || [];
            const hasEvents = events.length > 0 || incomes.length > 0 || bills.length > 0;
            const isToday = (year === todayYear && month === todayMonth && day === todayDay);

            gridHTML += `<div class="cal-cell${hasEvents ? ' cal-has-events' : ''}${isToday ? ' cal-today' : ''}">
                <span class="cal-day-num">${day}</span>`;

            for (const ev of events) {
                gridHTML += `<div class="cal-event" style="background:${ev.color};" title="${escapeHtml(ev.name)}: ${formatCurrency(ev.payment)}">
                    <span class="cal-event-name">${escapeHtml(ev.name)}</span>
                    <span class="cal-event-amount">${formatCurrency(ev.payment)}</span>
                </div>`;
            }

            for (const inc of incomes) {
                gridHTML += `<div class="cal-income-event" title="💰 ${escapeHtml(inc.name)}: ${formatCurrency(inc.amount)}">
                    <span class="cal-income-name">💰 ${escapeHtml(inc.name)}</span>
                    <span class="cal-income-amount">${formatCurrency(inc.amount)}</span>
                </div>`;
            }

            for (const bill of bills) {
                gridHTML += `<div class="cal-bill-event" title="🧾 ${escapeHtml(bill.name)}: ${formatCurrency(bill.amount)}">
                    <span class="cal-bill-name">🧾 ${escapeHtml(bill.name)}</span>
                    <span class="cal-bill-amount">${formatCurrency(bill.amount)}</span>
                </div>`;
            }

            gridHTML += `</div>`;
        }
        gridHTML += `</div>`;

        const monthBlock = document.createElement('div');
        monthBlock.className = 'cal-month';
        monthBlock.innerHTML = `<h4 class="cal-month-title">${monthLabel}</h4>${gridHTML}`;
        monthsRow.appendChild(monthBlock);
    }

    container.appendChild(monthsRow);

    const paginationBottom = paginationTop.cloneNode(true);
    container.appendChild(paginationBottom);

    container.querySelectorAll('.cal-prev').forEach(btn => {
        btn.addEventListener('click', () => app.renderCalendarView(page - 1));
    });
    container.querySelectorAll('.cal-next').forEach(btn => {
        btn.addEventListener('click', () => app.renderCalendarView(page + 1));
    });
}

/**
 * Render strategy interest comparison panel.
 */
export function displayInterestComparison(app, currentStrategy, monthlyPayment) {
    const container = document.getElementById('interestComparison');
    if (!container || !monthlyPayment || isNaN(monthlyPayment)) { if (container) container.innerHTML = ''; return; }

    const strategies = [
        { key: 'avalanche', label: 'Avalanche' },
        { key: 'snowball', label: 'Snowball' },
        { key: 'priority-lowest', label: 'Priority Lowest' },
        { key: 'priority-highest', label: 'Priority Highest' }
    ];

    const stimulus = app.perMonthStimulus && app.perMonthStimulus.length > 0 ? app.perMonthStimulus : 0;
    const results = [];
    for (const s of strategies) {
        try {
            const r = DebtCalculator.calculatePaymentPlan(app.debts, monthlyPayment, s.key, stimulus);
            const sm = DebtCalculator.generateSummary(r.workingDebts, r.paymentPlan);
            results.push({ ...s, totalInterest: sm.totalInterest, months: sm.monthsToPayOff, isCurrent: s.key === currentStrategy });
        } catch (e) {
            // Skip invalid configurations.
        }
    }
    if (results.length < 2) { container.innerHTML = ''; return; }

    results.sort((a, b) => a.totalInterest - b.totalInterest);
    const best = results[0];
    const current = results.find(r => r.isCurrent) || best;
    const interestSaved = current.totalInterest - best.totalInterest;
    const monthsSaved = current.months - best.months;

    let html = `<div class="interest-comparison"><h4>📊 Strategy Comparison</h4>`;
    if (interestSaved > 0.5) {
        html += `<div class="comparison-banner">Switching to <strong>${best.label}</strong> saves <strong>${formatCurrency(interestSaved)}</strong> in interest`;
        if (monthsSaved > 0) html += ` and pays off <strong>${monthsSaved} month${monthsSaved !== 1 ? 's' : ''} sooner</strong>`;
        html += '.</div>';
    } else {
        html += '<div class="comparison-banner comparison-banner--good">✅ You\'re already using the most interest-efficient strategy!</div>';
    }
    html += `<div class="table-wrapper"><table class="comparison-table">
        <thead><tr><th>Strategy</th><th>Total Interest</th><th>Months</th><th>Extra Cost vs. Best</th></tr></thead><tbody>`;
    for (const r of results) {
        const diff = r.totalInterest - best.totalInterest;
        html += `<tr class="${r.isCurrent ? 'comparison-current' : ''}">
            <td>${r.label}
                ${r.isCurrent ? '<span class="strat-badge strat-badge--current">Current</span>' : ''}
                ${r.key === best.key ? '<span class="strat-badge strat-badge--best">Best</span>' : ''}
            </td>
            <td>${formatCurrency(r.totalInterest)}</td>
            <td>${r.months} mo</td>
            <td>${diff > 0.5 ? `<span class="diff-cost">+${formatCurrency(diff)}</span>` : '<span class="diff-best">—</span>'}</td>
        </tr>`;
    }
    html += '</tbody></table></div></div>';
    container.innerHTML = html;
}

/**
 * Render What-If simulator panel.
 */
export function displayWhatIfSimulator(app, basePayment, strategy) {
    const container = document.getElementById('whatIfSimulator');
    if (!container || !app.lastSummary) { if (container) container.innerHTML = ''; return; }
    const baseSummary = app.lastSummary;
    const stimulus = app.perMonthStimulus && app.perMonthStimulus.length > 0 ? app.perMonthStimulus : 0;

    const sliderMax = Math.min(1000, Math.max(200, Math.round(basePayment)));

    container.innerHTML = `<div class="whatif-panel">
        <h4>🔧 What-If Simulator</h4>
        <p class="whatif-desc">Drag the slider to see how paying extra each month changes your payoff.</p>
        <div class="whatif-slider-row">
            <span class="whatif-slider-label">Extra/mo: <strong id="whatifExtraAmt">${formatCurrency(0)}</strong></span>
            <input type="range" id="whatifSlider" min="0" max="${sliderMax}" step="10" value="0">
            <span class="whatif-slider-cap">+${formatCurrency(sliderMax)}</span>
        </div>
        <div id="whatifResult"><p class="whatif-hint">Move the slider to simulate a higher payment.</p></div>
    </div>`;

    const slider = document.getElementById('whatifSlider');
    const extraAmtEl = document.getElementById('whatifExtraAmt');
    const resultDiv = document.getElementById('whatifResult');

    slider.addEventListener('input', () => {
        const extra = parseInt(slider.value, 10);
        extraAmtEl.textContent = formatCurrency(extra);
        if (extra === 0) {
            resultDiv.innerHTML = '<p class="whatif-hint">Move the slider to simulate a higher payment.</p>';
            return;
        }
        try {
            const r = DebtCalculator.calculatePaymentPlan(app.debts, basePayment + extra, strategy, stimulus);
            const s = DebtCalculator.generateSummary(r.workingDebts, r.paymentPlan);
            const monthsSaved = Math.max(0, baseSummary.monthsToPayOff - s.monthsToPayOff);
            const interestSaved = Math.max(0, baseSummary.totalInterest - s.totalInterest);
            resultDiv.innerHTML = `<div class="whatif-metrics">
                <div class="whatif-metric">
                    <div class="whatif-metric-label">New Payoff Date</div>
                    <div class="whatif-metric-val">${DebtCalculator.formatDate(s.payOffDate)}</div>
                </div>
                <div class="whatif-metric whatif-metric--good">
                    <div class="whatif-metric-label">Months Saved</div>
                    <div class="whatif-metric-val">${monthsSaved}</div>
                </div>
                <div class="whatif-metric whatif-metric--good">
                    <div class="whatif-metric-label">Interest Saved</div>
                    <div class="whatif-metric-val">${formatCurrency(interestSaved)}</div>
                </div>
                <div class="whatif-metric">
                    <div class="whatif-metric-label">New Total Interest</div>
                    <div class="whatif-metric-val">${formatCurrency(s.totalInterest)}</div>
                </div>
            </div>`;
        } catch (e) {
            resultDiv.innerHTML = `<p class="error-message">${escapeHtml(e && e.message ? e.message : String(e))}</p>`;
        }
    });
}

export function renderStrategyIncomeWidget(app) {
    const widget = document.getElementById('strategyIncomeWidget');
    if (!widget) return;
    if (app.incomes.length === 0) { widget.style.display = 'none'; return; }

    const fmt = (value) => {
        if (typeof formatCurrency === 'function') {
            return formatCurrency(value);
        }
        const numeric = Number(value) || 0;
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD'
        }).format(numeric);
    };

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
            ? ` · Bonuses: ${fmt(bonusThisMonth)}` : '';
        netHtml = `<div class="strategy-net ${netClass}">
            Net after all obligations:
            <strong>${fmt(netAfterAll)}</strong>
            <span class="strategy-net-breakdown">(Bills: ${fmt(totalBills)} · Expenses: ${fmt(totalExpenses)} · Debt mins: ${fmt(totalDebtMin)}${bonusBit})</span>
        </div>`;
    }

    const bonusChip = bonusThisMonth > 0
        ? `<span class="strategy-bonus-chip">+${fmt(bonusThisMonth)} bonus this month</span>` : '';

    widget.style.display = 'block';
    widget.innerHTML = `
        💰 Expected income this month: <strong>${fmt(monthlyTotal)}</strong> ${bonusChip}
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
        return (aVal - bVal) * dir;
    });

    for (const summary of rows) {
        const dueDateStr = summary.dueDate
            ? `<div style="font-size:0.78em;color:#6b7280;margin-top:2px;">Due: ${getDayOrdinal(summary.dueDate)} of month</div>`
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
                    <div class="summary-progress-fill${progressPct >= 100 ? ' summary-progress-fill--complete' : ''}" style="width:${progressPct}%"></div>
                </div>
                <div class="summary-progress-label">${progressPct}% paid off</div>
            </div>`;

        const row = document.createElement('tr');
        const iptdCell = summary.interestToDate !== null
            ? `<span class="iptd-value">${formatCurrency(summary.interestToDate)}</span>
               ${summary.debtStartDate ? `<div class="iptd-sub">since ${new Date(summary.debtStartDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</div>` : ''}`
            : '<span style="color:#9ca3af;font-size:0.8em;">No start date</span>';
        row.innerHTML = `
            <td>${escapeHtml(summary.name)}${dueDateStr}${progressBar}</td>
            <td class="min-due">${formatCurrency(summary.minDue)}</td>
            <td class="interest-rate">${summary.interestRate.toFixed(2)}%</td>
            <td class="amount">${formatCurrency(summary.totalPaid)}</td>
            <td class="principal">${formatCurrency(summary.principalPaid)}</td>
            <td class="interest">${formatCurrency(summary.interestPaid)}</td>
            <td>${iptdCell}</td>
            <td>${summary.payoffDate || '-'}</td>
            <td><button class="btn btn-small btn-secondary" data-amortization="${escapeHtml(summary.name)}">View</button></td>
        `;
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
        return {
            name,
            ...summary,
            payoffDate: summary.isFixedAmount ? (summary.lastPaymentDate || null) : summary.payoffDate,
            interestToDate: iptd ? iptd.interestPaid : null,
            debtStartDate: origDebt.debtStartDate || null,
            order: debtOrderMap[name]
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
    let html = '<div class="table-wrapper"><table style="min-width:600px"><thead><tr><th>Month</th><th>Payment</th><th>Principal</th><th>Interest</th><th>Balance</th></tr></thead><tbody>';
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
    modal.style.display = 'flex';
    document.getElementById('closeAmortization').onclick = () => {
        modal.style.display = 'none';
    };
    modal.onclick = (e) => {
        if (e.target === modal) modal.style.display = 'none';
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
                    paymentStr += `<br><span style='color:#059669;font-size:0.9em;'>(Stimulus: ${formatCurrency(monthData.stimulusApplied[debtName])})</span>`;
                }
            }
            row.innerHTML += `<td class="amount">${paymentStr}</td>`;
        }

        const stimulusInputId = `stimulus-input-${mi}`;
        const stimDisplayNumber = Number(editableStimulusVal);
        const stimDisplayStr = !isFinite(stimDisplayNumber) ? '0.00' : stimDisplayNumber.toFixed(2);
        const stimulusDisplay = `<input id="${stimulusInputId}" type="number" step="0.01" min="0" value="${stimDisplayStr}" style="width:100px;">`;
        row.innerHTML += `<td class="amount" style="color:#059669;font-weight:600;">${stimulusDisplay}</td>`;

        let totalPaidStr = formatCurrency(monthTotal);
        if (monthTotalOverage > 0) {
            totalPaidStr += `<br><small>(+${formatCurrency(monthTotalOverage)})</small>`;
        }
        row.innerHTML += `<td class="amount" style="font-weight: bold; border-left: 2px solid var(--border-color);">${totalPaidStr}</td>`;

        tableBody.appendChild(row);

        const stimInput = document.getElementById(`stimulus-input-${mi}`);
        if (stimInput) {
            stimInput.addEventListener('change', (e) => {
                const v = parseFloat(e.target.value);
                app.perMonthStimulus[mi] = isNaN(v) ? 0 : v;
                app.saveToStorage();
                try {
                    const monthlyPayment = parseFloat(document.getElementById('monthlyPayment').value);
                    const strategy = document.getElementById('paymentStrategy').value;
                    if (monthlyPayment && !isNaN(monthlyPayment) && monthlyPayment > 0) {
                        const result = DebtCalculator.calculatePaymentPlan(app.debts, monthlyPayment, strategy, app.perMonthStimulus);
                        app.lastPaymentPlan = result.paymentPlan;
                        app.lastSummary = DebtCalculator.generateSummary(result.workingDebts, result.paymentPlan);
                        app.displayPaymentPlan();
                    }
                } catch (err) {
                    console.error('Error recalculating after stimulus change', err);
                }
            });
        }
    }
}
