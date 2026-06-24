import { computeMonthlyIncomeForMonth, formatCurrency, escapeHtml, renderChartDataTable } from './utils.js';

function dtiStatus(ratio) {
    if (ratio < 0.28) return { cls: 'health-status--green', label: 'Healthy' };
    if (ratio < 0.40) return { cls: 'health-status--yellow', label: 'Moderate' };
    return { cls: 'health-status--red', label: 'High Risk' };
}

function savingsStatus(ratio) {
    if (ratio >= 0.20) return { cls: 'health-status--green', label: 'Strong' };
    if (ratio >= 0.10) return { cls: 'health-status--yellow', label: 'Moderate' };
    return { cls: 'health-status--red', label: 'Low' };
}

function emergencyStatus(months) {
    if (months >= 6) return { cls: 'health-status--green', label: '6+ months — Excellent' };
    if (months >= 3) return { cls: 'health-status--green', label: '3–6 months — Good' };
    if (months >= 1) return { cls: 'health-status--yellow', label: '1–3 months — Building' };
    return { cls: 'health-status--red', label: 'Under 1 month — Critical' };
}

function timelineStatus(months) {
    if (months <= 24) return { cls: 'health-status--green', label: 'On Track' };
    if (months <= 60) return { cls: 'health-status--yellow', label: 'Long Journey' };
    return { cls: 'health-status--red', label: 'Extended' };
}

function cashFlowStatus(net) {
    if (net > 0) return { cls: 'health-status--green', label: 'Surplus' };
    if (net === 0) return { cls: 'health-status--yellow', label: 'Break Even' };
    return { cls: 'health-status--red', label: 'Deficit' };
}

function budgetCategoryStatusCls(pct, category) {
    const isHousing = /rent|mortgage|housing/i.test(category);
    if (isHousing) {
        if (pct < 0.28) return 'health-status--green';
        if (pct < 0.36) return 'health-status--yellow';
        return 'health-status--red';
    }
    if (pct < 0.10) return 'health-status--green';
    if (pct < 0.15) return 'health-status--yellow';
    return 'health-status--red';
}

function statusFillCls(statusCls) {
    if (statusCls === 'health-status--green') return 'health-fill--green';
    if (statusCls === 'health-status--yellow') return 'health-fill--yellow';
    return 'health-fill--red';
}

function gaugeColor(statusCls) {
    if (statusCls === 'health-status--green') return '#16a34a';
    if (statusCls === 'health-status--yellow') return '#d97706';
    return '#dc2626';
}

export function renderHealthDashboard(app) {
    const section = document.getElementById('healthSection');
    if (!section) return;

    if (app._healthDtiChart)     { app._healthDtiChart.destroy();     app._healthDtiChart = null; }
    if (app._healthSavingsChart) { app._healthSavingsChart.destroy(); app._healthSavingsChart = null; }

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    // ── Shared data ────────────────────────────────────────────────────────────
    const { monthlyTotal: monthlyIncome } = computeMonthlyIncomeForMonth(app.incomes, app.bonuses, year, month);
    const totalBills    = (app.bills    || []).reduce((s, b) => s + (b.amount        || 0), 0);
    const totalExpenses = (app.expenses || []).reduce((s, e) => s + (e.budgetAmount  || 0), 0);
    const totalDebtMin  = (app.debts    || []).reduce((s, d) => s + (d.minimumPayment || 0), 0);
    const totalOutflow  = totalBills + totalExpenses + totalDebtMin;
    const net           = monthlyIncome - totalOutflow;

    // ── DTI ────────────────────────────────────────────────────────────────────
    const dtiRatio = monthlyIncome > 0 ? totalDebtMin / monthlyIncome : 0;
    const dtiPct   = Math.min(dtiRatio * 100, 100);
    const dtiSt    = dtiStatus(dtiRatio);

    // ── Savings Rate ───────────────────────────────────────────────────────────
    const totalSavingsContrib =
        (app.emergencyFunds || []).reduce((s, f) => s + (f.monthlyContribution || 0), 0) +
        (app.sinkingFunds   || []).reduce((s, f) => s + (f.monthlyAllocation   || 0), 0);
    const savingsRatio = monthlyIncome > 0 ? totalSavingsContrib / monthlyIncome : 0;
    const savingsPct   = Math.min(savingsRatio * 100, 100);
    const savingsSt    = savingsStatus(savingsRatio);

    // ── Emergency Fund Coverage ────────────────────────────────────────────────
    const emergencyFunds = app.emergencyFunds || [];

    // ── Debt Payoff Timeline ───────────────────────────────────────────────────
    const hasDebts = (app.debts || []).length > 0;
    let debtTimeline = null;
    if (hasDebts) {
        if (app.lastSummary && typeof app.lastSummary.monthsToPayOff === 'number') {
            debtTimeline = app.lastSummary;
        } else {
            try {
                const payment = Math.max(totalDebtMin, 1);
                const result  = DebtCalculator.calculatePaymentPlan(app.debts, payment, 'avalanche');
                debtTimeline  = DebtCalculator.generateSummary(result.workingDebts, result.paymentPlan);
            } catch (_) { /* silent */ }
        }
    }
    const timelineMonths = debtTimeline ? debtTimeline.monthsToPayOff : 0;
    const timelineYears  = (timelineMonths / 12).toFixed(1);
    const timelineSt     = timelineStatus(timelineMonths);
    const payoffDate     = debtTimeline ? debtTimeline.payOffDate : null;

    const totalDebtBalance  = (app.debts || []).reduce((s, d) =>
        s + (d.debtType === 'fixedAmount' ? (d.fixedAmount || 0) : (d.accountBalance || 0)), 0);
    const totalDebtOriginal = (app.debts || []).reduce((s, d) =>
        s + (d.originalBalance || d.accountBalance || d.fixedAmount || 0), 0);
    const debtProgress = totalDebtOriginal > 0
        ? Math.round(((totalDebtOriginal - totalDebtBalance) / totalDebtOriginal) * 100)
        : 0;

    // ── Monthly Cash Flow ──────────────────────────────────────────────────────
    const cashFlowSt = cashFlowStatus(net);

    // ── Budget Allocation ──────────────────────────────────────────────────────
    const billCatMap = {};
    for (const b of (app.bills || [])) {
        const cat = b.category || 'Other';
        billCatMap[cat] = (billCatMap[cat] || 0) + (b.amount || 0);
    }
    const expCatMap = {};
    for (const e of (app.expenses || [])) {
        const cat = e.category || 'Other';
        expCatMap[cat] = (expCatMap[cat] || 0) + (e.budgetAmount || 0);
    }
    const allCats = new Set([...Object.keys(billCatMap), ...Object.keys(expCatMap)]);
    const budgetCategories = [];
    for (const cat of allCats) {
        const total = (billCatMap[cat] || 0) + (expCatMap[cat] || 0);
        const pct   = monthlyIncome > 0 ? total / monthlyIncome : 0;
        budgetCategories.push({ cat, total, pct });
    }
    budgetCategories.sort((a, b) => b.total - a.total);
    if (totalDebtMin > 0) {
        budgetCategories.unshift({
            cat: 'Debt Payments', total: totalDebtMin,
            pct: monthlyIncome > 0 ? totalDebtMin / monthlyIncome : 0,
            isDebt: true
        });
    }

    const gaugeGray = document.body.classList.contains('dark-mode') ? '#334155' : '#e2e8f0';

    // ── HTML ───────────────────────────────────────────────────────────────────
    section.innerHTML = `
        <div class="health-header">
            <div class="page-header-row">
                <h2>Financial Health</h2>
                <button type="button" class="page-print-btn" id="healthPrintBtn" title="Print this page" aria-label="Print the Health page">🖨️ Print</button>
            </div>
            <p class="health-subtitle">A one-glance assessment of your financial well-being for ${now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}.</p>
        </div>
        <div class="health-metrics-grid">

            <!-- Debt-to-Income Ratio -->
            <div class="health-metric-card">
                <div class="health-card-header">
                    <span class="health-card-title">Debt-to-Income Ratio</span>
                    <span class="health-badge ${dtiSt.cls}">${dtiSt.label}</span>
                </div>
                <p class="health-card-desc">Monthly debt payments as a % of income. Under 28% is ideal; above 40% is a warning sign.</p>
                <div class="health-gauge-wrap">
                    <canvas id="healthDtiGauge" class="health-gauge-canvas"></canvas>
                    <div class="health-gauge-center">
                        <span class="health-gauge-value">${dtiPct.toFixed(1)}%</span>
                        <span class="health-gauge-label">DTI</span>
                    </div>
                </div>
                <div class="health-metric-detail">
                    <span>${formatCurrency(totalDebtMin)}/mo debt</span>
                    <span>${formatCurrency(monthlyIncome)}/mo income</span>
                </div>
                <a class="health-link" data-health-nav="liabilities">Manage debts &rarr;</a>
            </div>

            <!-- Savings Rate -->
            <div class="health-metric-card">
                <div class="health-card-header">
                    <span class="health-card-title">Savings Rate</span>
                    <span class="health-badge ${savingsSt.cls}">${savingsSt.label}</span>
                </div>
                <p class="health-card-desc">Emergency + sinking fund contributions as a % of income. 20%+ is excellent.</p>
                <div class="health-gauge-wrap">
                    <canvas id="healthSavingsGauge" class="health-gauge-canvas"></canvas>
                    <div class="health-gauge-center">
                        <span class="health-gauge-value">${savingsPct.toFixed(1)}%</span>
                        <span class="health-gauge-label">Saved</span>
                    </div>
                </div>
                <div class="health-metric-detail">
                    <span>${formatCurrency(totalSavingsContrib)}/mo saved</span>
                    <span>${formatCurrency(monthlyIncome)}/mo income</span>
                </div>
                <a class="health-link" data-health-nav="savings">Manage savings &rarr;</a>
            </div>

            <!-- Emergency Fund Coverage -->
            <div class="health-metric-card">
                <div class="health-card-header">
                    <span class="health-card-title">Emergency Fund Coverage</span>
                </div>
                <p class="health-card-desc">Months of expenses covered per emergency fund. 3–6 months is recommended.</p>
                ${emergencyFunds.length === 0 ? `
                    <div class="health-empty-state">
                        <span class="health-empty-value">0 months</span>
                        <span class="health-empty-sub">No emergency funds set up yet</span>
                    </div>
                    <a class="health-link" data-health-nav="savings">Set up emergency fund &rarr;</a>
                ` : emergencyFunds.map(fund => {
                    const coverageMonths = totalOutflow > 0 ? fund.currentAmount / totalOutflow : 0;
                    const coveragePct    = Math.min((coverageMonths / 6) * 100, 100);
                    const st             = emergencyStatus(coverageMonths);
                    const acctName       = (app.accounts || []).find(a => a.id === fund.accountId)?.name || 'Unknown';
                    return `
                        <div class="health-ef-row">
                            <div class="health-ef-header">
                                <span class="health-ef-name">${escapeHtml(acctName)}</span>
                                <span class="health-badge ${st.cls}">${coverageMonths.toFixed(1)} mo</span>
                            </div>
                            <div class="progress-bar health-compact-bar">
                                <div class="progress-fill ${statusFillCls(st.cls)}" data-progress-width="${Math.round(coveragePct)}"></div>
                            </div>
                            <div class="health-ef-detail">${escapeHtml(st.label)}</div>
                        </div>`;
                }).join('')}
                ${emergencyFunds.length > 0 ? `<a class="health-link" data-health-nav="savings">Manage emergency funds &rarr;</a>` : ''}
            </div>

            <!-- Debt Payoff Timeline -->
            <div class="health-metric-card">
                <div class="health-card-header">
                    <span class="health-card-title">Debt Payoff Timeline</span>
                    ${hasDebts && debtTimeline ? `<span class="health-badge ${timelineSt.cls}">${timelineSt.label}</span>` : ''}
                </div>
                <p class="health-card-desc">Estimated years until debt-free at current minimum payments (avalanche strategy).</p>
                ${!hasDebts ? `
                    <div class="health-empty-state">
                        <span class="health-empty-value health-empty--green">Debt Free!</span>
                    </div>
                ` : debtTimeline ? `
                    <div class="health-timeline-hero">
                        <span class="health-timeline-value">${timelineYears}</span>
                        <span class="health-timeline-unit">years</span>
                    </div>
                    ${payoffDate ? `<div class="health-timeline-date">Estimated payoff: ${escapeHtml(payoffDate)}</div>` : ''}
                    <div class="health-progress-label">
                        <span>Original debt paid off</span>
                        <span>${debtProgress}%</span>
                    </div>
                    <div class="progress-bar health-compact-bar">
                        <div class="progress-fill ${statusFillCls(timelineSt.cls)}" data-progress-width="${debtProgress}"></div>
                    </div>
                    <div class="health-metric-detail">
                        <span>Balance: ${formatCurrency(totalDebtBalance)}</span>
                        <span>${timelineMonths} months remaining</span>
                    </div>
                ` : `
                    <div class="health-empty-state">
                        <span class="health-empty-sub">Unable to calculate — check debt data</span>
                    </div>
                `}
                <a class="health-link" data-health-nav="strategy">Go to Plan &rarr;</a>
            </div>

            <!-- Monthly Cash Flow -->
            <div class="health-metric-card">
                <div class="health-card-header">
                    <span class="health-card-title">Monthly Cash Flow</span>
                    <span class="health-badge ${cashFlowSt.cls}">${cashFlowSt.label}</span>
                </div>
                <p class="health-card-desc">Income versus all monthly outflows. Positive means money available after all obligations.</p>
                <div class="health-cashflow-hero ${net >= 0 ? 'health-cashflow-hero--positive' : 'health-cashflow-hero--negative'}">
                    ${net >= 0 ? '+' : ''}${formatCurrency(net)}
                </div>
                <div class="health-cashflow-rows">
                    <div class="health-cashflow-row">
                        <span>Income</span>
                        <span class="health-cf-income">${formatCurrency(monthlyIncome)}</span>
                    </div>
                    ${totalDebtMin > 0 ? `<div class="health-cashflow-row">
                        <span>Debt payments</span>
                        <span class="health-cf-out">&minus;${formatCurrency(totalDebtMin)}</span>
                    </div>` : ''}
                    ${totalBills > 0 ? `<div class="health-cashflow-row">
                        <span>Bills</span>
                        <span class="health-cf-out">&minus;${formatCurrency(totalBills)}</span>
                    </div>` : ''}
                    ${totalExpenses > 0 ? `<div class="health-cashflow-row">
                        <span>Expenses</span>
                        <span class="health-cf-out">&minus;${formatCurrency(totalExpenses)}</span>
                    </div>` : ''}
                    <div class="health-cashflow-row health-cashflow-row--total">
                        <span>Net remaining</span>
                        <span class="${net >= 0 ? 'health-cf-income' : 'health-cf-deficit'}">${formatCurrency(net)}</span>
                    </div>
                </div>
                <a class="health-link" data-health-nav="liabilities">View budget &rarr;</a>
            </div>

            <!-- Budget Allocation -->
            <div class="health-metric-card">
                <div class="health-card-header">
                    <span class="health-card-title">Budget Allocation</span>
                </div>
                <p class="health-card-desc">Monthly spending by category as a % of income. Housing should stay under 28–36%.</p>
                ${monthlyIncome === 0 || budgetCategories.length === 0 ? `
                    <div class="health-empty-state">
                        <span class="health-empty-sub">Add income and expenses to see allocation</span>
                    </div>
                ` : budgetCategories.map(({ cat, total, pct, isDebt }) => {
                    const barPct   = Math.min(pct * 100, 100);
                    const stCls    = isDebt
                        ? (pct < 0.15 ? 'health-status--green' : pct < 0.20 ? 'health-status--yellow' : 'health-status--red')
                        : budgetCategoryStatusCls(pct, cat);
                    return `
                        <div class="health-budget-row">
                            <div class="health-budget-cat-hd">
                                <span class="health-budget-cat-name">${escapeHtml(cat)}</span>
                                <span class="health-badge health-badge--sm ${stCls}">${(pct * 100).toFixed(1)}%</span>
                            </div>
                            <div class="progress-bar health-compact-bar">
                                <div class="progress-fill ${statusFillCls(stCls)}" data-progress-width="${Math.round(barPct)}"></div>
                            </div>
                            <div class="health-budget-cat-amt">${formatCurrency(total)}/mo</div>
                        </div>`;
                }).join('')}
                ${budgetCategories.length > 0 ? `<a class="health-link" data-health-nav="liabilities">Edit budget &rarr;</a>` : ''}
            </div>

        </div>
    `;

    section.querySelectorAll('[data-progress-width]').forEach(el =>
        el.style.setProperty('--progress-width', el.dataset.progressWidth + '%'));

    renderGauge(app, '_healthDtiChart',     'healthDtiGauge',     dtiPct,     dtiSt.cls,     gaugeGray);
    renderGauge(app, '_healthSavingsChart', 'healthSavingsGauge', savingsPct, savingsSt.cls, gaugeGray);

    renderChartDataTable('healthDtiGauge', {
        caption: 'Debt-to-Income Ratio',
        columns: ['Metric', 'Value'],
        rows: [
            ['Debt-to-Income Ratio', `${dtiPct.toFixed(1)}%`],
            ['Monthly debt payments', formatCurrency(totalDebtMin)],
            ['Monthly income', formatCurrency(monthlyIncome)]
        ]
    });
    renderChartDataTable('healthSavingsGauge', {
        caption: 'Savings Rate',
        columns: ['Metric', 'Value'],
        rows: [
            ['Savings Rate', `${savingsPct.toFixed(1)}%`],
            ['Monthly amount saved', formatCurrency(totalSavingsContrib)],
            ['Monthly income', formatCurrency(monthlyIncome)]
        ]
    });

    section.querySelectorAll('[data-health-nav]').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            app.switchPage(link.dataset.healthNav);
        });
    });

    const healthPrintBtn = document.getElementById('healthPrintBtn');
    if (healthPrintBtn) {
        healthPrintBtn.addEventListener('click', () => window.print());
    }
}

function renderGauge(app, chartKey, canvasId, pct, statusCls, bgColor) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (app[chartKey]) { app[chartKey].destroy(); app[chartKey] = null; }
    const color = gaugeColor(statusCls);
    app[chartKey] = new Chart(canvas, {
        type: 'doughnut',
        data: {
            datasets: [{
                data: [Math.max(pct, 0), Math.max(100 - pct, 0)],
                backgroundColor: [color, bgColor],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            cutout: '72%',
            circumference: 270,
            rotation: 135,
            plugins: {
                legend:  { display: false },
                tooltip: { enabled: false }
            }
        }
    });
}
