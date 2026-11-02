// Reports page: income/expense breakdown and money flow charts

import {
    formatCurrency,
    escapeHtml,
    getReportDate,
    renderChartDataTable,
    formatMonthLong
} from './utils.js';
import { t, plural, categoryLabel, accountTypeLabel, getIntlLocale } from './i18n.js';
import { getLedgerTransactionsForMonth } from './ledgerTransactions.js';
import { ACCOUNT_TYPE_ICONS } from './accounts.js';

export function computeMonthCashFlowTotals(app, year, month) {
    const monthTxs = getLedgerTransactionsForMonth(app, year, month);

    let income = 0;
    let bills = 0;
    let expenses = 0;
    let recurring = 0;
    let debtMin = 0;
    let savings = 0;

    for (const tx of monthTxs) {
        if (tx.type === 'income' || tx.type === 'bonus' || tx.type === 'interest') {
            income += tx.amount;
            continue;
        }
        if (tx.type === 'bill') {
            bills += Math.abs(tx.amount || 0);
            continue;
        }
        if (tx.type === 'expense') {
            expenses += Math.abs(tx.amount || 0);
            continue;
        }
        if (tx.type === 'recurring') {
            if (tx.amount >= 0) {
                income += tx.amount;
            } else {
                recurring += Math.abs(tx.amount);
            }
            continue;
        }
        if (tx.type === 'debt') {
            debtMin += Math.abs(tx.amount || 0);
            continue;
        }
        if (tx.type === 'savings') {
            savings += Math.abs(tx.amount || 0);
        }
    }

    const outflow = bills + expenses + recurring + debtMin + savings;
    const net = income - outflow;

    return { income, bills, expenses, recurring, debtMin, savings, outflow, net };
}

export function getCashFlowTrendSeries(app, months) {
    const anchor = getReportDate(app);
    const anchorYear = anchor.getFullYear();
    const anchorMonth = anchor.getMonth();

    const series = [];
    for (let i = months - 1; i >= 0; i--) {
        const d = new Date(anchorYear, anchorMonth - i, 1);
        const year = d.getFullYear();
        const month = d.getMonth();
        const totals = computeMonthCashFlowTotals(app, year, month);
        const label = d.toLocaleDateString(getIntlLocale(), { month: 'short', year: '2-digit' });
        series.push({ year, month, label, income: totals.income, outflow: totals.outflow, net: totals.net });
    }
    return series;
}

export function renderReportsIncomeExp(app) {
    const container = document.getElementById('reportsIncomeExp');
    if (!container) return;

    const rptDate = getReportDate(app);
    const rptYear = rptDate.getFullYear();
    const rptMonth = rptDate.getMonth();

    const monthTxs = getLedgerTransactionsForMonth(app, rptYear, rptMonth);
    const totals = computeMonthCashFlowTotals(app, rptYear, rptMonth);
    const totalIncome = totals.income;
    const totalBills = totals.bills;
    const totalExpenses = totals.expenses;
    const totalRecurring = totals.recurring;
    const totalDebtMin = totals.debtMin;
    const totalSavings = totals.savings;
    const totalOutflow = totals.outflow;
    const net = totals.net;
    const netCls = net >= 0 ? 'rpt-net--pos' : 'rpt-net--neg';

    const monthLabel = formatMonthLong(rptDate);

    const stats = [
        { label: t('reports.statIncomeMonth', { month: monthLabel }), value: totalIncome, cls: 'rpt-stat--income' },
        { label: t('reports.statBills'), value: totalBills, cls: 'rpt-stat--bills' },
        { label: t('reports.statExpenseBudgets'), value: totalExpenses, cls: 'rpt-stat--exp' },
        { label: t('reports.statRecurringCosts'), value: totalRecurring, cls: 'rpt-stat--recurring' },
        { label: t('reports.statSavingsContrib'), value: totalSavings, cls: 'rpt-stat--savings' },
        { label: t('reports.statDebtMinimums'), value: totalDebtMin, cls: 'rpt-stat--debt' },
        { label: t('reports.statNetRemaining'), value: net, cls: netCls }
    ];
    const statsHTML = stats.map(s => `<div class="rpt-stat ${s.cls}"><span class="rpt-stat-label">${escapeHtml(s.label)}</span><span class="rpt-stat-value">${formatCurrency(s.value)}</span></div>`).join('');

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
        outflowLabels.push(`🧾 ${escapeHtml(categoryLabel(cat))}`);
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
        outflowLabels.push(`💸 ${escapeHtml(categoryLabel(cat))}`);
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
        outflowLabels.push(`🔄 ${escapeHtml(categoryLabel(cat))}`);
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
        const cat = tx.name || t('reports.sankeySavings');
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
        ${!hasData ? `<p class="rpt-empty-msg">${escapeHtml(t('reports.ieEmpty'))}</p>` : `
        <div class="rpt-charts-row">
            <div class="rpt-chart-card">
                <h4 class="rpt-chart-title">💰 ${escapeHtml(t('reports.ieIncomeTitle'))}</h4>
                <p class="rpt-chart-sub">${escapeHtml(t('reports.ieIncomeSub'))}</p>
                <div class="rpt-chart-canvas-wrap"><canvas id="rptIncomeChart"></canvas></div>
            </div>
            <div class="rpt-chart-card">
                <h4 class="rpt-chart-title">📤 ${escapeHtml(t('reports.ieOutflowTitle'))}</h4>
                <p class="rpt-chart-sub">${escapeHtml(t('reports.ieOutflowSub'))}</p>
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
            renderChartDataTable('rptIncomeChart', {
                caption: t('reports.ieIncomeCaption'),
                columns: [t('reports.colSource'), t('reports.colAmount')],
                rows: incomeLabels.map((label, i) => [label, fmt(incomeData[i])])
            });
        }
    }

    const outflowCvs = document.getElementById('rptOutflowChart');
    if (outflowCvs) {
        if (outflowData.length > 0) {
            if (app._rptOutflowChart) {
                app._rptOutflowChart.destroy();
                app._rptOutflowChart = null;
            }
            app._rptOutflowChart = new Chart(outflowCvs, {
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
        renderChartDataTable('rptOutflowChart', {
            caption: t('reports.ieOutflowCaption'),
            columns: [t('reports.colCategory'), t('reports.colAmount')],
            rows: outflowLabels.map((label, i) => [label, fmt(outflowData[i])])
        });
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
    const monthLabel = formatMonthLong(rptDate);

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
            return `<div class="acct-mf-row"><span class="acct-mf-icon">${typeIcon[a.type] || '🗂️'}</span><span class="acct-mf-name">${escapeHtml(a.name)}</span><span class="acct-mf-type" data-label="${escapeHtml(t('reports.colType'))}">${escapeHtml(accountTypeLabel(a.type))}</span><span class="acct-mf-start" data-label="${escapeHtml(t('reports.colStarting'))}">${formatCurrency(a.startingBalance)}</span><span class="acct-mf-proj" data-label="${escapeHtml(t('reports.colProjectedBal'))}">${formatCurrency(proj)}</span><span class="acct-mf-diff ${diffClass}" data-label="${escapeHtml(t('reports.colChange'))}">${diffSign}${formatCurrency(diff)}</span></div>`;
        }).join('');

        acctSectionHTML = `
            <div class="acct-mf-section">
                <h4 class="acct-mf-title">🏦 ${escapeHtml(t('reports.acctBalTitle', { month: monthLabel }))}</h4>
                <p class="rpt-chart-sub">${escapeHtml(t('reports.acctBalSub'))}</p>
                <div class="acct-mf-header"><span></span><span>${escapeHtml(t('reports.colAccount'))}</span><span>${escapeHtml(t('reports.colType'))}</span><span>${escapeHtml(t('reports.colStarting'))}</span><span>${escapeHtml(t('reports.colProjectedBal'))}</span><span>${escapeHtml(t('reports.colChange'))}</span></div>
                ${acctRows}
            </div>`;
    }

    container.innerHTML = `
        <h3 class="rpt-section-title">💰 ${escapeHtml(t('reports.sankeyTitle', { month: monthLabel }))}</h3>
        <p class="rpt-chart-sub">${escapeHtml(t('reports.mfSub'))}</p>
        ${!hasAnyData ? `<p class="rpt-empty-msg">${escapeHtml(t('reports.mfEmpty'))}</p>` : '<div class="rpt-moneyflow-wrap"><canvas id="rptMoneyFlowChart"></canvas></div>'}
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
                { label: t('reports.mfCumIncome'), data: cumInData, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)', fill: true, tension: 0.3, pointRadius: 3, borderWidth: 2 },
                { label: t('reports.mfCumOutflow'), data: cumOutData, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.06)', fill: true, tension: 0.3, pointRadius: 3, borderWidth: 2 },
                { label: t('reports.mfNetBalance'), data: netData, borderColor: '#2563eb', backgroundColor: 'transparent', fill: false, tension: 0.3, pointRadius: 3, borderWidth: 2.5, borderDash: [] }
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
                x: { title: { display: true, text: t('reports.mfDayOf', { month: monthLabel }), color: labelColor, font: { size: 11 } }, ticks: { color: labelColor, maxTicksLimit: 16 }, grid: { color: gridColor } },
                y: { title: { display: true, text: t('reports.mfAmountAxis'), color: labelColor, font: { size: 11 } }, ticks: { color: labelColor, callback: v => fmt(v) }, grid: { color: gridColor } }
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
    renderChartDataTable('rptMoneyFlowChart', {
        caption: t('reports.mfCaption'),
        columns: [t('reports.colDay'), t('reports.mfCumIncome'), t('reports.mfCumOutflow'), t('reports.mfNetBalance')],
        rows: labels.map((d, i) => [d, fmt(cumInData[i]), fmt(cumOutData[i]), fmt(netData[i])])
    });
}

export function renderReportsCashFlowTrend(app) {
    const container = document.getElementById('reportsCashFlowTrend');
    if (!container) return;

    const horizon = [1, 3, 6, 12].includes(app._cashFlowTrendRangeMonths) ? app._cashFlowTrendRangeMonths : 6;
    app._cashFlowTrendRangeMonths = horizon;

    const series = getCashFlowTrendSeries(app, horizon);
    const hasData = series.some(m => m.income !== 0 || m.outflow !== 0);

    const rangeButtonsHTML = `
        <div class="nw-range-buttons" role="group" aria-label="${escapeHtml(t('reports.cftRangeAria'))}">
            <button class="nw-range-btn ${horizon === 1 ? 'active' : ''}" data-cashflow-range="1" type="button" aria-pressed="${horizon === 1 ? 'true' : 'false'}" aria-label="${escapeHtml(plural('reports.cftNextAria', 1))}">1M</button>
            <button class="nw-range-btn ${horizon === 3 ? 'active' : ''}" data-cashflow-range="3" type="button" aria-pressed="${horizon === 3 ? 'true' : 'false'}" aria-label="${escapeHtml(plural('reports.cftNextAria', 3))}">3M</button>
            <button class="nw-range-btn ${horizon === 6 ? 'active' : ''}" data-cashflow-range="6" type="button" aria-pressed="${horizon === 6 ? 'true' : 'false'}" aria-label="${escapeHtml(plural('reports.cftNextAria', 6))}">6M</button>
            <button class="nw-range-btn ${horizon === 12 ? 'active' : ''}" data-cashflow-range="12" type="button" aria-pressed="${horizon === 12 ? 'true' : 'false'}" aria-label="${escapeHtml(plural('reports.cftNextAria', 12))}">12M</button>
        </div>`;

    if (!hasData) {
        container.innerHTML = `
            <div class="nw-report-header">
                <h3>📈 ${escapeHtml(t('reports.cftTitle'))}</h3>
                ${rangeButtonsHTML}
            </div>
            <p class="rpt-empty-msg">${escapeHtml(t('reports.cftEmpty'))}</p>`;
        return;
    }

    const avgIncome = series.reduce((sum, m) => sum + m.income, 0) / series.length;
    const avgOutflow = series.reduce((sum, m) => sum + m.outflow, 0) / series.length;
    const avgNet = series.reduce((sum, m) => sum + m.net, 0) / series.length;
    const avgNetCls = avgNet >= 0 ? 'rpt-net--pos' : 'rpt-net--neg';
    const horizonLabel = plural('reports.monthsCount', horizon);

    container.innerHTML = `
        <div class="nw-report-header">
            <h3>📈 ${escapeHtml(t('reports.cftTitle'))}</h3>
            ${rangeButtonsHTML}
        </div>
        <p class="rpt-chart-sub">${escapeHtml(t('reports.cftSub', { range: horizonLabel }))}</p>
        <div class="rpt-stats-strip">
            <div class="rpt-stat rpt-stat--income"><span class="rpt-stat-label">${escapeHtml(t('reports.cftAvgIncome'))}</span><span class="rpt-stat-value">${formatCurrency(avgIncome)}</span></div>
            <div class="rpt-stat rpt-stat--debt"><span class="rpt-stat-label">${escapeHtml(t('reports.cftAvgOutflow'))}</span><span class="rpt-stat-value">${formatCurrency(avgOutflow)}</span></div>
            <div class="rpt-stat ${avgNetCls}"><span class="rpt-stat-label">${escapeHtml(t('reports.cftAvgNet'))}</span><span class="rpt-stat-value">${formatCurrency(avgNet)}</span></div>
        </div>
        <div class="rpt-chart-canvas-wrap"><canvas id="rptCashFlowTrendChart"></canvas></div>`;

    const cvs = document.getElementById('rptCashFlowTrendChart');
    if (!cvs) return;
    if (app._rptCashFlowTrendChart) {
        app._rptCashFlowTrendChart.destroy();
        app._rptCashFlowTrendChart = null;
    }

    const fmt = v => formatCurrency(v);
    const isDark = document.body.classList.contains('dark-mode');
    const gridColor = isDark ? '#374151' : '#e5e7eb';
    const labelColor = isDark ? '#d1d5db' : '#374151';
    const labels = series.map(m => m.label);

    app._rptCashFlowTrendChart = new Chart(cvs, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { type: 'bar', label: t('reports.statIncome'), data: series.map(m => m.income), backgroundColor: '#10b981', borderRadius: 4, order: 2 },
                { type: 'bar', label: t('reports.cftOutflow'), data: series.map(m => m.outflow), backgroundColor: '#ef4444', borderRadius: 4, order: 2 },
                { type: 'line', label: t('reports.cftNet'), data: series.map(m => m.net), borderColor: '#2563eb', backgroundColor: 'transparent', tension: 0.3, pointRadius: 3, borderWidth: 2.5, order: 1 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', labels: { color: labelColor, usePointStyle: true, padding: 14, font: { size: 12 } } },
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` } }
            },
            scales: {
                x: { ticks: { color: labelColor }, grid: { display: false } },
                y: { ticks: { color: labelColor, callback: v => fmt(v) }, grid: { color: gridColor } }
            }
        }
    });

    renderChartDataTable('rptCashFlowTrendChart', {
        caption: t('reports.cftCaption', { range: horizonLabel }),
        columns: [t('reports.colMonth'), t('reports.statIncome'), t('reports.cftOutflow'), t('reports.cftNet')],
        rows: series.map(m => [m.label, fmt(m.income), fmt(m.outflow), fmt(m.net)])
    });
}
