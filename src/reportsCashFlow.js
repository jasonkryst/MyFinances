// Reports page: income/expense breakdown and money flow charts

import {
    formatCurrency,
    escapeHtml,
    getReportDate
} from './utils.js';
import { getLedgerTransactionsForMonth } from './ledgerTransactions.js';
import { ACCOUNT_TYPE_ICONS } from './accounts.js';

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
    let totalSavings = 0;

    for (const tx of monthTxs) {
        if (tx.type === 'income' || tx.type === 'bonus' || tx.type === 'interest') {
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
            continue;
        }
        if (tx.type === 'savings') {
            totalSavings += Math.abs(tx.amount || 0);
        }
    }

    const totalOutflow = totalBills + totalExpenses + totalRecurring + totalDebtMin + totalSavings;
    const net = totalIncome - totalOutflow;
    const netCls = net >= 0 ? 'rpt-net--pos' : 'rpt-net--neg';

    const monthLabel = rptDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const stats = [
        { label: `Income (${monthLabel})`, value: totalIncome, cls: 'rpt-stat--income' },
        { label: 'Bills', value: totalBills, cls: 'rpt-stat--bills' },
        { label: 'Expense Budgets', value: totalExpenses, cls: 'rpt-stat--exp' },
        { label: 'Recurring Costs', value: totalRecurring, cls: 'rpt-stat--recurring' },
        { label: 'Savings Contributions', value: totalSavings, cls: 'rpt-stat--savings' },
        { label: 'Debt Minimums', value: totalDebtMin, cls: 'rpt-stat--debt' },
        { label: 'Net Remaining', value: net, cls: netCls }
    ];
    const statsHTML = stats.map(s => `<div class="rpt-stat ${s.cls}"><span class="rpt-stat-label">${s.label}</span><span class="rpt-stat-value">${formatCurrency(s.value)}</span></div>`).join('');

    const incomeBySource = {};
    for (const tx of monthTxs) {
        if (tx.type === 'income' || tx.type === 'bonus' || tx.type === 'interest') {
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

    const savingsCats = {};
    for (const tx of monthTxs) {
        if (tx.type !== 'savings') continue;
        const cat = tx.name || 'Savings';
        savingsCats[cat] = (savingsCats[cat] || 0) + Math.abs(tx.amount || 0);
    }
    for (const [cat, amt] of Object.entries(savingsCats)) {
        outflowLabels.push(`💰 ${escapeHtml(cat)}`);
        outflowData.push(amt);
        outflowColors.push('#10b981');
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
        const typeIcon = ACCOUNT_TYPE_ICONS;
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
        <p class="rpt-chart-sub">Cumulative income, outflow, and net balance day by day through the month. Vertical dashed line = today. Includes recurring transactions.</p>
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
