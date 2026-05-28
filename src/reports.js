// Reports page logic: month navigation, calendar, charts

import {
    getIncomePaydaysInMonth,
    getBillsByDayForMonth,
    getExpensesByDayForMonth,
    getBonusesByDayForMonth,
    formatCurrency
} from './utils.js';

export function incomeDaysInMonth(app, inc, year, month) {
    return getIncomePaydaysInMonth(inc, year, month).map(d => d.getDate());
}

export function getReportDate(app) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + app._reportMonthOffset, 1);
}

export function prevReportMonth(app) {
    app._reportMonthOffset--;
    updateReportMonthNav(app);
    renderReportsPage(app);
}

export function nextReportMonth(app) {
    app._reportMonthOffset++;
    updateReportMonthNav(app);
    renderReportsPage(app);
}

export function updateReportMonthNav(app) {
    const d = getReportDate(app);
    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const el = document.getElementById('rptMonthLabel');
    if (el) el.textContent = label;

    const prevBtn = document.getElementById('rptPrevMonth');
    if (prevBtn) prevBtn.disabled = app._reportMonthOffset <= -24;
}

export function renderReportsPage(app) {
    updateReportMonthNav(app);

    ['_rptIncomeChart', '_rptBillsChart', '_rptExpChart', '_rptMoneyFlowChart', '_rptOutflowChart']
        .forEach(k => {
            if (app[k]) {
                app[k].destroy();
                app[k] = null;
            }
        });

    renderReportsCalendar(app);
    renderReportsIncomeExp(app);
    renderReportsMoneyFlow(app);
}

export function renderReportsCalendar(app) {
    const container = document.getElementById('reportsCalendar');
    if (!container) return;
    container.innerHTML = '';

    const rptDate = getReportDate(app);
    const year = rptDate.getFullYear();
    const month = rptDate.getMonth();
    const now = new Date();
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
    const today = isCurrentMonth ? now.getDate() : -1;

    const monthLabel = rptDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const dayIncome = {};
    for (const inc of (app.incomes || [])) {
        for (const d of incomeDaysInMonth(app, inc, year, month)) {
            if (!dayIncome[d]) dayIncome[d] = [];
            dayIncome[d].push(inc);
        }
    }

    const dayBills = getBillsByDayForMonth(app.bills, year, month);

    const dayExpenses = getExpensesByDayForMonth(app.expenses, year, month);

    const dayDebts = {};
    const palette = ['#2563eb', '#dc2626', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#ea580c', '#6366f1'];
    let ci = 0;
    for (const debt of (app.debts || [])) {
        const daysInM = new Date(year, month + 1, 0).getDate();
        const d = Math.min(debt.dueDate || 1, daysInM);
        if (!dayDebts[d]) dayDebts[d] = [];
        dayDebts[d].push({ ...debt, _color: palette[ci++ % palette.length] });
    }

    const dayBonuses = getBonusesByDayForMonth(app.bonuses, year, month);

    const legendItems = [
        '<span class="rpt-cal-legend-item"><span class="rpt-cal-swatch rpt-cal-swatch--income"></span>Payday</span>',
        '<span class="rpt-cal-legend-item"><span class="rpt-cal-swatch rpt-cal-swatch--bill"></span>Bill due</span>',
        '<span class="rpt-cal-legend-item"><span class="rpt-cal-swatch rpt-cal-swatch--expense"></span>Expense</span>',
        '<span class="rpt-cal-legend-item"><span class="rpt-cal-swatch" style="background:#2563eb;"></span>Debt payment</span>',
        '<span class="rpt-cal-legend-item"><span class="rpt-cal-swatch rpt-cal-swatch--bonus"></span>Bonus/Windfall</span>',
        isCurrentMonth ? '<span class="rpt-cal-legend-item"><span class="rpt-cal-swatch rpt-cal-swatch--today"></span>Today</span>' : ''
    ].filter(Boolean);

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let gridHTML = '<div class="rpt-cal-day-labels">';
    for (const dl of DAY_LABELS) gridHTML += `<div class="rpt-cal-day-label">${dl}</div>`;
    gridHTML += '</div><div class="rpt-cal-grid">';

    for (let i = 0; i < firstDay; i++) {
        gridHTML += '<div class="rpt-cal-cell rpt-cal-empty"></div>';
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const incomes = dayIncome[day] || [];
        const bills = dayBills[day] || [];
        const expenses = dayExpenses[day] || [];
        const debts = dayDebts[day] || [];
        const bonuses = dayBonuses[day] || [];
        const hasEvts = incomes.length || bills.length || expenses.length || debts.length || bonuses.length;
        const isToday = day === today;

        gridHTML += `<div class="rpt-cal-cell${hasEvts ? ' rpt-cal-has-events' : ''}${isToday ? ' rpt-cal-today' : ''}"><span class="rpt-cal-day-num">${day}</span>`;

        for (const inc of incomes) {
            gridHTML += `<div class="rpt-cal-evt rpt-cal-evt--income" title="💰 ${inc.name}: ${formatCurrency(inc.amount)}"><span class="rpt-cal-evt-name">💰 ${inc.name}</span><span class="rpt-cal-evt-amt">${formatCurrency(inc.amount)}</span></div>`;
        }
        for (const bill of bills) {
            gridHTML += `<div class="rpt-cal-evt rpt-cal-evt--bill" title="🧾 ${bill.name}: ${formatCurrency(bill.amount)}"><span class="rpt-cal-evt-name">🧾 ${bill.name}</span><span class="rpt-cal-evt-amt">${formatCurrency(bill.amount)}</span></div>`;
        }
        for (const exp of expenses) {
            gridHTML += `<div class="rpt-cal-evt rpt-cal-evt--expense" title="🛒 ${exp.name}: ${formatCurrency(exp.budgetAmount)}"><span class="rpt-cal-evt-name">🛒 ${exp.name}</span><span class="rpt-cal-evt-amt">${formatCurrency(exp.budgetAmount)}</span></div>`;
        }
        for (const debt of debts) {
            gridHTML += `<div class="rpt-cal-evt" style="background:${debt._color}" title="💳 ${debt.name}: min ${formatCurrency(debt.minimumPayment)}"><span class="rpt-cal-evt-name">💳 ${debt.name}</span><span class="rpt-cal-evt-amt">${formatCurrency(debt.minimumPayment)}</span></div>`;
        }
        for (const b of bonuses) {
            gridHTML += `<div class="rpt-cal-evt rpt-cal-evt--bonus" title="🎁 ${b.name}: ${formatCurrency(b.amount)}"><span class="rpt-cal-evt-name">🎁 ${b.name}</span><span class="rpt-cal-evt-amt">${formatCurrency(b.amount)}</span></div>`;
        }

        gridHTML += '</div>';
    }

    gridHTML += '</div>';

    container.innerHTML = `<h3 class="rpt-cal-month-title">${monthLabel}</h3><div class="rpt-cal-legend">${legendItems.join('')}</div>${gridHTML}`;
}

export function renderReportsIncomeExp(app) {
    const container = document.getElementById('reportsIncomeExp');
    if (!container) return;

    const rptDate = getReportDate(app);
    const rptYear = rptDate.getFullYear();
    const rptMonth = rptDate.getMonth();

    let totalIncome = 0;
    for (const inc of (app.incomes || [])) {
        totalIncome += inc.amount * incomeDaysInMonth(app, inc, rptYear, rptMonth).length;
    }
    for (const b of (app.bonuses || [])) {
        if (!b.date) continue;
        const bd = new Date(b.date + 'T12:00:00');
        if (bd.getFullYear() === rptYear && bd.getMonth() === rptMonth) totalIncome += b.amount;
    }

    const totalBills = (app.bills || []).reduce((s, b) => s + b.amount, 0);
    const totalExpenses = (app.expenses || []).reduce((s, e) => s + e.budgetAmount, 0);
    const totalDebtMin = (app.debts || []).reduce((s, d) => s + (d.minimumPayment || 0), 0);
    const totalOutflow = totalBills + totalExpenses + totalDebtMin;
    const net = totalIncome - totalOutflow;
    const netCls = net >= 0 ? 'rpt-net--pos' : 'rpt-net--neg';

    const monthLabel = rptDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const stats = [
        { label: `Income (${monthLabel})`, value: totalIncome, cls: 'rpt-stat--income' },
        { label: 'Bills', value: totalBills, cls: 'rpt-stat--bills' },
        { label: 'Expense Budgets', value: totalExpenses, cls: 'rpt-stat--exp' },
        { label: 'Debt Minimums', value: totalDebtMin, cls: 'rpt-stat--debt' },
        { label: 'Net Remaining', value: net, cls: netCls }
    ];
    const statsHTML = stats.map(s => `<div class="rpt-stat ${s.cls}"><span class="rpt-stat-label">${s.label}</span><span class="rpt-stat-value">${formatCurrency(s.value)}</span></div>`).join('');

    const incomeLabels = [];
    const incomeData = [];
    for (const inc of (app.incomes || [])) {
        const count = incomeDaysInMonth(app, inc, rptYear, rptMonth).length;
        if (count > 0) {
            incomeLabels.push(inc.name);
            incomeData.push(inc.amount * count);
        }
    }
    for (const b of (app.bonuses || [])) {
        if (!b.date) continue;
        const bd = new Date(b.date + 'T12:00:00');
        if (bd.getFullYear() === rptYear && bd.getMonth() === rptMonth) {
            incomeLabels.push(b.name);
            incomeData.push(b.amount);
        }
    }

    const outflowLabels = [];
    const outflowData = [];
    const outflowColors = [];

    const billCats = {};
    for (const b of (app.bills || [])) billCats[b.category || 'Other'] = (billCats[b.category || 'Other'] || 0) + b.amount;
    for (const [cat, amt] of Object.entries(billCats)) {
        outflowLabels.push(`🧾 ${cat}`);
        outflowData.push(amt);
        outflowColors.push('#f59e0b');
    }

    const expCats = {};
    for (const e of (app.expenses || [])) expCats[e.category || 'Other'] = (expCats[e.category || 'Other'] || 0) + e.budgetAmount;
    for (const [cat, amt] of Object.entries(expCats)) {
        outflowLabels.push(`💸 ${cat}`);
        outflowData.push(amt);
        outflowColors.push('#8b5cf6');
    }

    for (const d of (app.debts || [])) {
        if ((d.minimumPayment || 0) > 0) {
            outflowLabels.push(`💳 ${d.name}`);
            outflowData.push(d.minimumPayment);
            outflowColors.push('#ef4444');
        }
    }

    const hasData = incomeData.length > 0 || outflowData.length > 0;

    container.innerHTML = `
        <div class="rpt-stats-strip">${statsHTML}</div>
        ${!hasData ? '<p class="rpt-empty-msg">Add income sources, bills, expenses, or debts to see charts.</p>' : `
        <div class="rpt-charts-row">
            <div class="rpt-chart-card">
                <h4 class="rpt-chart-title">💰 Income This Month</h4>
                <p class="rpt-chart-sub">By source</p>
                <div class="rpt-chart-canvas-wrap"><canvas id="rptIncomeChart"></canvas></div>
            </div>
            <div class="rpt-chart-card">
                <h4 class="rpt-chart-title">📤 Outflow This Month</h4>
                <p class="rpt-chart-sub">Bills, expenses &amp; debt minimums by category</p>
                <div class="rpt-chart-canvas-wrap"><canvas id="rptOutflowChart"></canvas></div>
            </div>
        </div>`}`;

    if (!hasData) return;

    const fmt = v => formatCurrency(v);
    const isDark = document.body.classList.contains('dark-mode');
    const labelColor = isDark ? '#d1d5db' : '#374151';
    const incomeColors = ['#10b981', '#34d399', '#6ee7b7', '#a7f3d0', '#059669', '#047857', '#065f46'];

    if (incomeData.length > 0) {
        const cvs = document.getElementById('rptIncomeChart');
        if (cvs) {
            if (app._rptIncomeChart) {
                app._rptIncomeChart.destroy();
                app._rptIncomeChart = null;
            }
            app._rptIncomeChart = new Chart(cvs, {
                type: 'doughnut',
                data: {
                    labels: incomeLabels,
                    datasets: [{ data: incomeData, backgroundColor: incomeColors, borderColor: isDark ? '#1f2937' : '#fff', borderWidth: 2 }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { color: labelColor, usePointStyle: true, padding: 10, font: { size: 11 } } },
                        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmt(ctx.parsed)}` } }
                    }
                }
            });
        }
    }

    if (outflowData.length > 0) {
        const cvs = document.getElementById('rptOutflowChart');
        if (cvs) {
            if (app._rptOutflowChart) {
                app._rptOutflowChart.destroy();
                app._rptOutflowChart = null;
            }
            app._rptOutflowChart = new Chart(cvs, {
                type: 'bar',
                data: { labels: outflowLabels, datasets: [{ data: outflowData, backgroundColor: outflowColors, borderRadius: 4 }] },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { label: ctx => fmt(ctx.parsed.x) } }
                    },
                    scales: {
                        x: { ticks: { color: labelColor, callback: v => fmt(v) }, grid: { color: isDark ? '#374151' : '#e5e7eb' } },
                        y: { ticks: { color: labelColor }, grid: { display: false } }
                    }
                }
            });
        }
    }
}

export function renderReportsMoneyFlow(app) {
    const container = document.getElementById('reportsMoneyFlow');
    if (!container) return;

    const rptDate = getReportDate(app);
    const year = rptDate.getFullYear();
    const month = rptDate.getMonth();
    const now = new Date();
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayDay = isCurrentMonth ? now.getDate() : null;
    const monthLabel = rptDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const dailyIn = new Array(daysInMonth + 1).fill(0);
    const dailyOut = new Array(daysInMonth + 1).fill(0);

    for (const inc of (app.incomes || [])) {
        for (const d of incomeDaysInMonth(app, inc, year, month)) {
            dailyIn[d] += inc.amount;
        }
    }

    for (const b of (app.bonuses || [])) {
        if (!b.date) continue;
        const bd = new Date(b.date + 'T12:00:00');
        if (bd.getFullYear() === year && bd.getMonth() === month) {
            dailyIn[bd.getDate()] += b.amount;
        }
    }

    for (const bill of (app.bills || [])) {
        const d = Math.min(bill.dueDay || 1, daysInMonth);
        dailyOut[d] += bill.amount;
    }

    for (const debt of (app.debts || [])) {
        const d = Math.min(debt.dueDate || 1, daysInMonth);
        dailyOut[d] += debt.minimumPayment || 0;
    }

    const labels = [];
    const cumInData = [];
    const cumOutData = [];
    const netData = [];
    let cumIn = 0;
    let cumOut = 0;
    for (let d = 1; d <= daysInMonth; d++) {
        cumIn += dailyIn[d];
        cumOut += dailyOut[d];
        labels.push(d);
        cumInData.push(parseFloat(cumIn.toFixed(2)));
        cumOutData.push(parseFloat(cumOut.toFixed(2)));
        netData.push(parseFloat((cumIn - cumOut).toFixed(2)));
    }

    const hasAnyData = cumIn > 0 || cumOut > 0;

    let acctSectionHTML = '';
    if (app.accounts && app.accounts.length > 0) {
        const typeIcon = { Checking: '🏦', Savings: '💰', Cash: '💵', Investment: '📈', 'Credit Card': '💳', Loan: '🏠', Other: '🗂️' };
        const acctRows = app.accounts.map(a => {
            const proj = app.computeAccountBalance(a.id, year, month);
            const diff = proj - a.startingBalance;
            const diffClass = diff >= 0 ? 'acct-mf-diff--pos' : 'acct-mf-diff--neg';
            const diffSign = diff >= 0 ? '+' : '';
            return `<div class="acct-mf-row"><span class="acct-mf-icon">${typeIcon[a.type] || '🗂️'}</span><span class="acct-mf-name">${a.name}</span><span class="acct-mf-type">${a.type}</span><span class="acct-mf-start">${formatCurrency(a.startingBalance)}</span><span class="acct-mf-proj">${formatCurrency(proj)}</span><span class="acct-mf-diff ${diffClass}">${diffSign}${formatCurrency(diff)}</span></div>`;
        }).join('');

        acctSectionHTML = `
            <div class="acct-mf-section">
                <h4 class="acct-mf-title">🏦 Account Balances — ${monthLabel}</h4>
                <p class="rpt-chart-sub">Starting balance vs. projected end-of-month after all linked income, debts, bills and expenses.</p>
                <div class="acct-mf-header"><span></span><span>Account</span><span>Type</span><span>Starting</span><span>Projected</span><span>Change</span></div>
                ${acctRows}
            </div>`;
    }

    container.innerHTML = `
        <h3 class="rpt-section-title">💰 Money Flow — ${monthLabel}</h3>
        <p class="rpt-chart-sub" style="margin:0 0 16px">Cumulative income, outflow, and net balance day by day through the month. Vertical dashed line = today.</p>
        ${!hasAnyData ? '<p class="rpt-empty-msg">Add income sources, bills, or debts to see the money flow chart.</p>' : '<div class="rpt-moneyflow-wrap"><canvas id="rptMoneyFlowChart"></canvas></div>'}
        ${acctSectionHTML}`;

    if (!hasAnyData) return;

    const cvs = document.getElementById('rptMoneyFlowChart');
    if (!cvs) return;
    if (app._rptMoneyFlowChart) {
        app._rptMoneyFlowChart.destroy();
        app._rptMoneyFlowChart = null;
    }

    const fmt = v => formatCurrency(v);
    const isDark = document.body.classList.contains('dark-mode');
    const gridColor = isDark ? '#374151' : '#e5e7eb';
    const labelColor = isDark ? '#d1d5db' : '#374151';

    app._rptMoneyFlowChart = new Chart(cvs, {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Cumulative Income', data: cumInData, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)', fill: true, tension: 0.3, pointRadius: 3, borderWidth: 2 },
                { label: 'Cumulative Outflow', data: cumOutData, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.06)', fill: true, tension: 0.3, pointRadius: 3, borderWidth: 2 },
                { label: 'Net Balance', data: netData, borderColor: '#2563eb', backgroundColor: 'transparent', fill: false, tension: 0.3, pointRadius: 3, borderWidth: 2.5, borderDash: [] }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', labels: { color: labelColor, usePointStyle: true, padding: 14, font: { size: 12 } } },
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` } },
                annotation: undefined
            },
            scales: {
                x: { title: { display: true, text: `Day of ${monthLabel}`, color: labelColor, font: { size: 11 } }, ticks: { color: labelColor, maxTicksLimit: 16 }, grid: { color: gridColor } },
                y: { title: { display: true, text: 'Amount ($)', color: labelColor, font: { size: 11 } }, ticks: { color: labelColor, callback: v => fmt(v) }, grid: { color: gridColor } }
            }
        },
        plugins: [{
            id: 'todayLine',
            afterDraw(chart) {
                if (!todayDay) return;
                const todayIdx = todayDay - 1;
                if (todayIdx < 0 || todayIdx >= chart.data.labels.length) return;
                const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
                const xPos = x.getPixelForValue(todayIdx);
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(xPos, top);
                ctx.lineTo(xPos, bottom);
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = isDark ? 'rgba(251,191,36,0.7)' : 'rgba(37,99,235,0.45)';
                ctx.setLineDash([5, 4]);
                ctx.stroke();
                ctx.restore();
            }
        }]
    });
}
