// Reports page logic: month navigation, calendar, charts

import {
    getIncomePaydaysInMonth,
    formatCurrency,
    escapeHtml
} from './utils.js';
import { getLedgerTransactionsForMonth } from './ledger.js';

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
    renderReportsVariance(app);
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

    const monthTxs = getLedgerTransactionsForMonth(app, year, month);
    const dayIncome = {};
    const dayBills = {};
    const dayExpenses = {};
    const dayDebts = {};
    const dayBonuses = {};
    const dayRecurring = {};

    const palette = ['#2563eb', '#dc2626', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#ea580c', '#6366f1'];
    const debtColorByName = {};
    let ci = 0;

    for (const tx of monthTxs) {
        const day = new Date(tx.date).getDate();
        if (tx.type === 'income') {
            if (!dayIncome[day]) dayIncome[day] = [];
            dayIncome[day].push(tx);
            continue;
        }
        if (tx.type === 'bonus') {
            if (!dayBonuses[day]) dayBonuses[day] = [];
            dayBonuses[day].push(tx);
            continue;
        }
        if (tx.type === 'bill') {
            if (!dayBills[day]) dayBills[day] = [];
            dayBills[day].push(tx);
            continue;
        }
        if (tx.type === 'expense') {
            if (!dayExpenses[day]) dayExpenses[day] = [];
            dayExpenses[day].push(tx);
            continue;
        }
        if (tx.type === 'recurring') {
            if (!dayRecurring[day]) dayRecurring[day] = [];
            dayRecurring[day].push(tx);
            continue;
        }
        if (tx.type === 'debt') {
            if (!dayDebts[day]) dayDebts[day] = [];
            if (!debtColorByName[tx.name]) {
                debtColorByName[tx.name] = palette[ci++ % palette.length];
            }
            dayDebts[day].push({ ...tx, _color: debtColorByName[tx.name] });
        }
    }

    const legendItems = [
        '<span class="rpt-cal-legend-item"><span class="rpt-cal-swatch rpt-cal-swatch--income"></span>Payday</span>',
        '<span class="rpt-cal-legend-item"><span class="rpt-cal-swatch rpt-cal-swatch--bill"></span>Bill due</span>',
        '<span class="rpt-cal-legend-item"><span class="rpt-cal-swatch rpt-cal-swatch--expense"></span>Expense</span>',
        '<span class="rpt-cal-legend-item"><span class="rpt-cal-swatch rpt-cal-swatch--recurring"></span>Recurring</span>',
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
        const recurring = dayRecurring[day] || [];
        const debts = dayDebts[day] || [];
        const bonuses = dayBonuses[day] || [];
        const hasEvts = incomes.length || bills.length || expenses.length || recurring.length || debts.length || bonuses.length;
        const isToday = day === today;

        gridHTML += `<div class="rpt-cal-cell${hasEvts ? ' rpt-cal-has-events' : ''}${isToday ? ' rpt-cal-today' : ''}"><span class="rpt-cal-day-num">${day}</span>`;

        for (const inc of incomes) {
            gridHTML += `<div class="rpt-cal-evt rpt-cal-evt--income" title="💰 ${escapeHtml(inc.name)}: ${formatCurrency(inc.amount)}"><span class="rpt-cal-evt-name">💰 ${escapeHtml(inc.name)}</span><span class="rpt-cal-evt-amt">${formatCurrency(inc.amount)}</span></div>`;
        }
        for (const bill of bills) {
            const amount = Math.abs(bill.amount || 0);
            gridHTML += `<div class="rpt-cal-evt rpt-cal-evt--bill" title="🧾 ${escapeHtml(bill.name)}: ${formatCurrency(amount)}"><span class="rpt-cal-evt-name">🧾 ${escapeHtml(bill.name)}</span><span class="rpt-cal-evt-amt">${formatCurrency(amount)}</span></div>`;
        }
        for (const exp of expenses) {
            const amount = Math.abs(exp.amount || 0);
            gridHTML += `<div class="rpt-cal-evt rpt-cal-evt--expense" title="🛒 ${escapeHtml(exp.name)}: ${formatCurrency(amount)}"><span class="rpt-cal-evt-name">🛒 ${escapeHtml(exp.name)}</span><span class="rpt-cal-evt-amt">${formatCurrency(amount)}</span></div>`;
        }
        for (const rec of recurring) {
            const amount = Math.abs(rec.amount || 0);
            gridHTML += `<div class="rpt-cal-evt rpt-cal-evt--recurring" title="🔄 ${escapeHtml(rec.name)}: ${formatCurrency(amount)}"><span class="rpt-cal-evt-name">🔄 ${escapeHtml(rec.name)}</span><span class="rpt-cal-evt-amt">${formatCurrency(amount)}</span></div>`;
        }
        for (const debt of debts) {
            const amount = Math.abs(debt.amount || 0);
            gridHTML += `<div class="rpt-cal-evt" style="background:${debt._color}" title="💳 ${escapeHtml(debt.name)}: min ${formatCurrency(amount)}"><span class="rpt-cal-evt-name">💳 ${escapeHtml(debt.name)}</span><span class="rpt-cal-evt-amt">${formatCurrency(amount)}</span></div>`;
        }
        for (const b of bonuses) {
            gridHTML += `<div class="rpt-cal-evt rpt-cal-evt--bonus" title="🎁 ${escapeHtml(b.name)}: ${formatCurrency(b.amount)}"><span class="rpt-cal-evt-name">🎁 ${escapeHtml(b.name)}</span><span class="rpt-cal-evt-amt">${formatCurrency(b.amount)}</span></div>`;
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

    const monthTxs = getLedgerTransactionsForMonth(app, rptYear, rptMonth);

    let totalIncome = 0;
    let totalBills = 0;
    let totalExpenses = 0;
    let totalRecurring = 0;
    let totalDebtMin = 0;

    for (const tx of monthTxs) {
        if (tx.type === 'income' || tx.type === 'bonus') {
            totalIncome += tx.amount;
            continue;
        }
        if (tx.type === 'bill') {
            totalBills += Math.abs(tx.amount || 0);
            continue;
        }
        if (tx.type === 'expense') {
            totalExpenses += Math.abs(tx.amount || 0);
            continue;
        }
        if (tx.type === 'recurring') {
            if (tx.amount >= 0) {
                totalIncome += tx.amount;
            } else {
                totalRecurring += Math.abs(tx.amount);
            }
            continue;
        }
        if (tx.type === 'debt') {
            totalDebtMin += Math.abs(tx.amount || 0);
        }
    }

    const totalOutflow = totalBills + totalExpenses + totalRecurring + totalDebtMin;
    const net = totalIncome - totalOutflow;
    const netCls = net >= 0 ? 'rpt-net--pos' : 'rpt-net--neg';

    const monthLabel = rptDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const stats = [
        { label: `Income (${monthLabel})`, value: totalIncome, cls: 'rpt-stat--income' },
        { label: 'Bills', value: totalBills, cls: 'rpt-stat--bills' },
        { label: 'Expense Budgets', value: totalExpenses, cls: 'rpt-stat--exp' },
        { label: 'Recurring Costs', value: totalRecurring, cls: 'rpt-stat--recurring' },
        { label: 'Debt Minimums', value: totalDebtMin, cls: 'rpt-stat--debt' },
        { label: 'Net Remaining', value: net, cls: netCls }
    ];
    const statsHTML = stats.map(s => `<div class="rpt-stat ${s.cls}"><span class="rpt-stat-label">${s.label}</span><span class="rpt-stat-value">${formatCurrency(s.value)}</span></div>`).join('');

    const incomeBySource = {};
    for (const tx of monthTxs) {
        if (tx.type === 'income' || tx.type === 'bonus') {
            incomeBySource[tx.name] = (incomeBySource[tx.name] || 0) + tx.amount;
        }
    }
    const incomeLabels = Object.keys(incomeBySource);
    const incomeData = incomeLabels.map(label => incomeBySource[label]);

    const outflowLabels = [];
    const outflowData = [];
    const outflowColors = [];

    const billCats = {};
    for (const tx of monthTxs) {
        if (tx.type !== 'bill') continue;
        const cat = tx.category || 'Other';
        billCats[cat] = (billCats[cat] || 0) + Math.abs(tx.amount || 0);
    }
    for (const [cat, amt] of Object.entries(billCats)) {
        outflowLabels.push(`🧾 ${escapeHtml(cat)}`);
        outflowData.push(amt);
        outflowColors.push('#f59e0b');
    }

    const expCats = {};
    for (const tx of monthTxs) {
        if (tx.type !== 'expense') continue;
        const cat = tx.category || 'Other';
        expCats[cat] = (expCats[cat] || 0) + Math.abs(tx.amount || 0);
    }
    for (const [cat, amt] of Object.entries(expCats)) {
        outflowLabels.push(`💸 ${escapeHtml(cat)}`);
        outflowData.push(amt);
        outflowColors.push('#8b5cf6');
    }

    const recCats = {};
    for (const tx of monthTxs) {
        if (tx.type !== 'recurring' || tx.amount >= 0) continue;
        const cat = tx.category || 'Other';
        recCats[cat] = (recCats[cat] || 0) + Math.abs(tx.amount);
    }
    for (const [cat, amt] of Object.entries(recCats)) {
        outflowLabels.push(`🔄 ${escapeHtml(cat)}`);
        outflowData.push(amt);
        outflowColors.push('#06b6d4');
    }

    const debtByName = {};
    for (const tx of monthTxs) {
        if (tx.type !== 'debt') continue;
        debtByName[tx.name] = (debtByName[tx.name] || 0) + Math.abs(tx.amount || 0);
    }
    for (const [name, amt] of Object.entries(debtByName)) {
        outflowLabels.push(`💳 ${escapeHtml(name)}`);
        outflowData.push(amt);
        outflowColors.push('#ef4444');
    }

    const hasData = incomeData.length > 0 || outflowData.length > 0;

    container.innerHTML = `
        <div class="rpt-stats-strip">${statsHTML}</div>
        ${!hasData ? '<p class="rpt-empty-msg">Add income sources, bills, expenses, recurring items, or debts to see charts.</p>' : `
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

    const monthTxs = getLedgerTransactionsForMonth(app, year, month);
    for (const tx of monthTxs) {
        const day = new Date(tx.date).getDate();
        if (tx.amount >= 0) {
            dailyIn[day] += tx.amount;
        } else {
            dailyOut[day] += Math.abs(tx.amount);
        }
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
            return `<div class="acct-mf-row"><span class="acct-mf-icon">${typeIcon[a.type] || '🗂️'}</span><span class="acct-mf-name">${escapeHtml(a.name)}</span><span class="acct-mf-type">${escapeHtml(a.type)}</span><span class="acct-mf-start">${formatCurrency(a.startingBalance)}</span><span class="acct-mf-proj">${formatCurrency(proj)}</span><span class="acct-mf-diff ${diffClass}">${diffSign}${formatCurrency(diff)}</span></div>`;
        }).join('');

        acctSectionHTML = `
            <div class="acct-mf-section">
                <h4 class="acct-mf-title">🏦 Account Balances — ${monthLabel}</h4>
                <p class="rpt-chart-sub">Starting balance vs. projected end-of-month after all linked income, debts, bills, expenses, and recurring items.</p>
                <div class="acct-mf-header"><span></span><span>Account</span><span>Type</span><span>Starting</span><span>Projected</span><span>Change</span></div>
                ${acctRows}
            </div>`;
    }

    container.innerHTML = `
        <h3 class="rpt-section-title">💰 Money Flow — ${monthLabel}</h3>
        <p class="rpt-chart-sub" style="margin:0 0 16px">Cumulative income, outflow, and net balance day by day through the month. Vertical dashed line = today. Includes recurring transactions.</p>
        ${!hasAnyData ? '<p class="rpt-empty-msg">Add income, bills, debts, bonuses, expenses, or recurring items to see the money flow chart.</p>' : '<div class="rpt-moneyflow-wrap"><canvas id="rptMoneyFlowChart"></canvas></div>'}
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

export function renderReportsVariance(app) {
    const container = document.getElementById('reportsVariance');
    if (!container) return;

    const rptDate = getReportDate(app);
    const rptYear = rptDate.getFullYear();
    const rptMonth = rptDate.getMonth();

    // Get current month and previous month transactions
    const currMonthTxs = getLedgerTransactionsForMonth(app, rptYear, rptMonth);
    const prevMonthDate = rptMonth === 0 ? new Date(rptYear - 1, 11, 1) : new Date(rptYear, rptMonth - 1, 1);
    const prevMonthTxs = getLedgerTransactionsForMonth(app, prevMonthDate.getFullYear(), prevMonthDate.getMonth());

    // Calculate totals for current month
    let currIncome = 0, currExpenses = 0, currRecurring = 0, currDebtMin = 0;
    for (const tx of currMonthTxs) {
        if (tx.type === 'income' || tx.type === 'bonus') {
            currIncome += tx.amount;
        } else if (tx.type === 'expense') {
            currExpenses += Math.abs(tx.amount || 0);
        } else if (tx.type === 'recurring' && tx.amount < 0) {
            currRecurring += Math.abs(tx.amount);
        } else if (tx.type === 'recurring' && tx.amount >= 0) {
            currIncome += tx.amount;
        } else if (tx.type === 'debt') {
            currDebtMin += Math.abs(tx.amount || 0);
        }
    }

    // Calculate totals for previous month
    let prevIncome = 0, prevExpenses = 0, prevRecurring = 0, prevDebtMin = 0;
    for (const tx of prevMonthTxs) {
        if (tx.type === 'income' || tx.type === 'bonus') {
            prevIncome += tx.amount;
        } else if (tx.type === 'expense') {
            prevExpenses += Math.abs(tx.amount || 0);
        } else if (tx.type === 'recurring' && tx.amount < 0) {
            prevRecurring += Math.abs(tx.amount);
        } else if (tx.type === 'recurring' && tx.amount >= 0) {
            prevIncome += tx.amount;
        } else if (tx.type === 'debt') {
            prevDebtMin += Math.abs(tx.amount || 0);
        }
    }

    // Calculate deltas
    const deltaIncome = currIncome - prevIncome;
    const deltaExpenses = currExpenses - prevExpenses;
    const deltaRecurring = currRecurring - prevRecurring;
    const deltaDebtMin = currDebtMin - prevDebtMin;

    // Format dates
    const currLabel = rptDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const prevLabel = prevMonthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

    // Helper function to create delta badge
    const deltaBadge = (delta, isExpense = false) => {
        // Flip logic for expenses: positive change is bad (more spending)
        const direction = isExpense ? (delta > 0 ? 'neg' : 'pos') : (delta > 0 ? 'pos' : 'neg');
        const sign = delta > 0 ? '+' : '';
        const icon = delta > 0 ? (isExpense ? '📈' : '📈') : '📉';
        return `<span class="var-delta var-delta--${direction}">${icon} ${sign}${formatCurrency(Math.abs(delta))}</span>`;
    };

    // Create variance rows
    const rows = [
        {
            label: '💰 Income',
            current: currIncome,
            previous: prevIncome,
            delta: deltaIncome,
            isExpense: false
        },
        {
            label: '💸 Expenses',
            current: currExpenses,
            previous: prevExpenses,
            delta: deltaExpenses,
            isExpense: true
        },
        {
            label: '🔄 Recurring Costs',
            current: currRecurring,
            previous: prevRecurring,
            delta: deltaRecurring,
            isExpense: true
        },
        {
            label: '💳 Debt Minimums',
            current: currDebtMin,
            previous: prevDebtMin,
            delta: deltaDebtMin,
            isExpense: true
        }
    ];

    const rowsHTML = rows.map(r => `
        <div class="var-row">
            <span class="var-label">${r.label}</span>
            <span class="var-prev">
                <span class="var-small-label">${prevLabel}</span>
                <span class="var-value">${formatCurrency(r.previous)}</span>
            </span>
            <span class="var-curr">
                <span class="var-small-label">${currLabel}</span>
                <span class="var-value">${formatCurrency(r.current)}</span>
            </span>
            <span class="var-delta-cell">
                ${deltaBadge(r.delta, r.isExpense)}
            </span>
        </div>
    `).join('');

    const totalDelta = (currIncome - currExpenses - currRecurring - currDebtMin) - (prevIncome - prevExpenses - prevRecurring - prevDebtMin);
    const totalDeltaClass = totalDelta >= 0 ? 'pos' : 'neg';

    container.innerHTML = `
        <div class="var-container">
            <h3 class="var-title">Month-to-Month Comparison</h3>
            <p class="var-subtitle">Changes from ${prevLabel} to ${currLabel}</p>
            <div class="var-table">
                <div class="var-header">
                    <span class="var-label-col">Category</span>
                    <span class="var-period-col">${prevLabel}</span>
                    <span class="var-period-col">${currLabel}</span>
                    <span class="var-delta-col">Change</span>
                </div>
                ${rowsHTML}
            </div>
            <div class="var-summary">
                <div class="var-summary-row">
                    <span class="var-summary-label">Net Available (Income - All Outflows)</span>
                    <span class="var-summary-prev">${formatCurrency(prevIncome - prevExpenses - prevRecurring - prevDebtMin)}</span>
                    <span class="var-summary-curr">${formatCurrency(currIncome - currExpenses - currRecurring - currDebtMin)}</span>
                    <span class="var-summary-delta var-delta--${totalDeltaClass}">
                        ${totalDelta > 0 ? '📈' : '📉'} ${totalDelta >= 0 ? '+' : ''}${formatCurrency(totalDelta)}
                    </span>
                </div>
            </div>
        </div>
    `;
}
