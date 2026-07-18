// Net worth snapshots: capture, series aggregation, dashboard widget, and reports-page timeline

import { formatCurrency, renderChartDataTable } from './utils.js';
import { getLedgerTransactionsForMonth } from './ledgerTransactions.js';

function toMonthKey(value) {
    return String(value || '').slice(0, 7);
}

export function getSnapshotSeries(app, months = 12) {
    const snapshots = Array.isArray(app.monthlySnapshots) ? [...app.monthlySnapshots] : [];
    snapshots.sort((a, b) => a.date.localeCompare(b.date));
    const filtered = snapshots.filter(s => Number.isFinite(s.netWorth));
    return filtered.slice(Math.max(0, filtered.length - months));
}

function computeSnapshotMetrics(app, snapshotDate = new Date()) {
    const year = snapshotDate.getFullYear();
    const month = snapshotDate.getMonth();

    let totalAssets = 0;
    for (const account of app.accounts || []) {
        const projected = app.computeAccountBalance(account.id, year, month);
        if (projected > 0) totalAssets += projected;
    }

    let totalLiabilities = 0;
    for (const debt of app.debts || []) {
        if (debt.debtType === 'fixedAmount') {
            totalLiabilities += Math.max(0, Number(debt.fixedAmount) || 0);
            continue;
        }
        totalLiabilities += Math.max(0, Number(debt.accountBalance) || 0);
    }

    const txs = getLedgerTransactionsForMonth(app, year, month);
    let debtPaymentMade = 0;
    let incomeReceived = 0;
    for (const tx of txs) {
        if (tx.type === 'debt') {
            debtPaymentMade += Math.abs(tx.amount || 0);
            continue;
        }
        if (tx.type === 'income' || tx.type === 'bonus' || tx.type === 'interest' || (tx.type === 'recurring' && tx.amount > 0)) {
            incomeReceived += Math.abs(tx.amount || 0);
        }
    }

    return {
        totalAssets: parseFloat(totalAssets.toFixed(2)),
        totalLiabilities: parseFloat(totalLiabilities.toFixed(2)),
        netWorth: parseFloat((totalAssets - totalLiabilities).toFixed(2)),
        debtPaymentMade: parseFloat(debtPaymentMade.toFixed(2)),
        incomeReceived: parseFloat(incomeReceived.toFixed(2))
    };
}

export function captureNetWorthSnapshot(app, options = {}) {
    const now = options.date ? new Date(options.date) : new Date();
    if (Number.isNaN(now.getTime())) return null;

    const beforeSeries = getSnapshotSeries(app, 240);
    const previousLatest = beforeSeries.length > 0 ? beforeSeries[beforeSeries.length - 1] : null;
    const baseline = beforeSeries.length > 0 ? beforeSeries[0].netWorth : null;

    const metrics = computeSnapshotMetrics(app, now);
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const snapshot = {
        date: now.toISOString().slice(0, 10),
        ...metrics,
        source: options.source === 'manual' ? 'manual' : 'auto'
    };

    if (!Array.isArray(app.monthlySnapshots)) app.monthlySnapshots = [];
    const existingIndex = app.monthlySnapshots.findIndex(s => toMonthKey(s?.date) === monthKey);
    if (existingIndex >= 0) {
        app.monthlySnapshots[existingIndex] = snapshot;
    } else {
        app.monthlySnapshots.push(snapshot);
    }
    app.monthlySnapshots.sort((a, b) => a.date.localeCompare(b.date));
    app.saveToStorage();

    if (!options.skipMilestone && baseline !== null) {
        const gainNow = snapshot.netWorth - baseline;
        const gainPrev = previousLatest ? (previousLatest.netWorth - baseline) : 0;
        if (!Array.isArray(app.netWorthMilestonesAwarded)) app.netWorthMilestonesAwarded = [];
        for (let threshold = 5000; threshold <= gainNow; threshold += 5000) {
            const alreadyAwarded = app.netWorthMilestonesAwarded.includes(threshold);
            if (alreadyAwarded || gainPrev >= threshold) continue;
            app.netWorthMilestonesAwarded.push(threshold);
            app.showNetWorthMilestone(`Net worth milestone reached: +${formatCurrency(threshold)} from your first snapshot`);
            app.saveToStorage();
        }
    }

    if (options.source === 'manual' && !options.silent) {
        app.showNetWorthMilestone(`Snapshot captured: net worth ${formatCurrency(snapshot.netWorth)}`);
    }

    return snapshot;
}

export function renderNetWorthWidget(app) {
    const container = document.getElementById('netWorthWidget');
    if (!container) return;

    const snapshots = getSnapshotSeries(app, 24);
    if (snapshots.length === 0) {
        container.innerHTML = '<p class="nw-widget-empty">No snapshots yet. Capture your first net worth snapshot from Reports.</p>';
        return;
    }

    const latest = snapshots[snapshots.length - 1];
    const prev = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;
    const change = prev ? latest.netWorth - prev.netWorth : 0;
    const changeClass = change >= 0 ? 'nw-change--up' : 'nw-change--down';
    const changeLabel = prev ? `${change >= 0 ? '+' : '-'}${formatCurrency(Math.abs(change))} vs last snapshot` : 'No prior snapshot yet';

    container.innerHTML = `
        <div class="nw-widget-card">
            <div class="nw-widget-head">
                <h3>Net Worth</h3>
                <span class="nw-widget-date">${latest.date}</span>
            </div>
            <div class="nw-widget-main">${formatCurrency(latest.netWorth)}</div>
            <div class="nw-widget-change ${changeClass}">${changeLabel}</div>
            <div class="nw-widget-breakdown">
                <span>Assets: <strong>${formatCurrency(latest.totalAssets)}</strong></span>
                <span>Liabilities: <strong>${formatCurrency(latest.totalLiabilities)}</strong></span>
            </div>
        </div>`;
}

export function renderReportsNetWorth(app) {
    const container = document.getElementById('reportsNetWorth');
    if (!container) return;

    const horizon = [3, 6, 12].includes(app._netWorthRangeMonths) ? app._netWorthRangeMonths : 6;
    app._netWorthRangeMonths = horizon;
    const series = getSnapshotSeries(app, horizon);

    if (series.length === 0) {
        container.innerHTML = `
            <div class="nw-report-header">
                <h3>Net Worth Timeline</h3>
                <button class="btn btn-primary" id="captureSnapshotBtn" type="button">Capture Snapshot Now</button>
            </div>
            <p class="rpt-empty-msg">No net worth snapshots yet. Capture one to start your trend line.</p>`;
        return;
    }

    const latest = series[series.length - 1];
    const first = series[0];
    const debtDrop = Math.max(0, first.totalLiabilities - latest.totalLiabilities);
    const assetGrowth = latest.totalAssets - first.totalAssets;
    const netChange = latest.netWorth - first.netWorth;
    const historyRows = [...series]
        .reverse()
        .map(snapshot => {
            const displayDate = new Date(`${snapshot.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
            return `
                <tr>
                    <td>${displayDate}</td>
                    <td>${formatCurrency(snapshot.totalAssets || 0)}</td>
                    <td>${formatCurrency(snapshot.totalLiabilities || 0)}</td>
                    <td>${formatCurrency(snapshot.netWorth || 0)}</td>
                    <td>${formatCurrency(snapshot.incomeReceived || 0)}</td>
                    <td>${formatCurrency(snapshot.debtPaymentMade || 0)}</td>
                </tr>`;
        })
        .join('');

    container.innerHTML = `
        <div class="nw-report-header">
            <h3>Net Worth Timeline</h3>
            <div class="nw-report-actions">
                <div class="nw-range-buttons" role="group" aria-label="Net worth range">
                    <button class="nw-range-btn ${horizon === 3 ? 'active' : ''}" data-networth-range="3" type="button">3M</button>
                    <button class="nw-range-btn ${horizon === 6 ? 'active' : ''}" data-networth-range="6" type="button">6M</button>
                    <button class="nw-range-btn ${horizon === 12 ? 'active' : ''}" data-networth-range="12" type="button">12M</button>
                </div>
                <button class="btn btn-primary" id="captureSnapshotBtn" type="button">Capture Snapshot Now</button>
            </div>
        </div>
        <div class="nw-report-summary">
            <div class="nw-report-stat"><span>Current Net Worth</span><strong>${formatCurrency(latest.netWorth)}</strong></div>
            <div class="nw-report-stat"><span>Net Change (${horizon}M)</span><strong class="${netChange >= 0 ? 'nw-change--up' : 'nw-change--down'}">${netChange >= 0 ? '+' : '-'}${formatCurrency(Math.abs(netChange))}</strong></div>
            <div class="nw-report-stat"><span>Asset Growth</span><strong class="${assetGrowth >= 0 ? 'nw-change--up' : 'nw-change--down'}">${assetGrowth >= 0 ? '+' : '-'}${formatCurrency(Math.abs(assetGrowth))}</strong></div>
            <div class="nw-report-stat"><span>Debt Reduction</span><strong>${formatCurrency(debtDrop)}</strong></div>
        </div>
        <div class="rpt-charts-row">
            <div class="rpt-chart-card">
                <h4 class="rpt-chart-title">Net Worth vs Debt Payoff</h4>
                <p class="rpt-chart-sub">Net worth growth and falling liabilities across snapshots</p>
                <div class="rpt-chart-canvas-wrap"><canvas id="rptNetWorthTrendChart"></canvas></div>
            </div>
            <div class="rpt-chart-card">
                <h4 class="rpt-chart-title">Asset Growth vs Debt Reduction</h4>
                <p class="rpt-chart-sub">Monthly change composition</p>
                <div class="rpt-chart-canvas-wrap"><canvas id="rptNetWorthCompositionChart"></canvas></div>
            </div>
        </div>
        <div class="nw-history-card">
            <h4 class="rpt-chart-title">Snapshot History</h4>
            <p class="rpt-chart-sub">Quick audit table for each recorded month.</p>
            <div class="nw-history-table-wrap">
                <table class="nw-history-table" id="netWorthHistoryTable">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Assets</th>
                            <th>Liabilities</th>
                            <th>Net Worth</th>
                            <th>Income</th>
                            <th>Debt Paid</th>
                        </tr>
                    </thead>
                    <tbody>${historyRows}</tbody>
                </table>
            </div>
        </div>`;

    const labels = series.map(s => new Date(`${s.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
    const netWorthData = series.map(s => s.netWorth);
    const debtData = series.map(s => s.totalLiabilities);

    const compLabels = [];
    const growthData = [];
    const reductionData = [];
    for (let idx = 1; idx < series.length; idx++) {
        compLabels.push(labels[idx]);
        growthData.push(parseFloat((series[idx].totalAssets - series[idx - 1].totalAssets).toFixed(2)));
        reductionData.push(parseFloat((series[idx - 1].totalLiabilities - series[idx].totalLiabilities).toFixed(2)));
    }

    const isDark = document.body.classList.contains('dark-mode');
    const gridColor = isDark ? '#374151' : '#e5e7eb';
    const labelColor = isDark ? '#d1d5db' : '#374151';

    const trendCanvas = document.getElementById('rptNetWorthTrendChart');
    if (trendCanvas) {
        app._rptNetWorthTrendChart = new Chart(trendCanvas, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Net Worth',
                        data: netWorthData,
                        borderColor: '#2563eb',
                        backgroundColor: 'rgba(37,99,235,0.12)',
                        tension: 0.32,
                        fill: true,
                        pointRadius: 3,
                        borderWidth: 2.2
                    },
                    {
                        label: 'Liabilities',
                        data: debtData,
                        borderColor: '#dc2626',
                        backgroundColor: 'rgba(220,38,38,0.08)',
                        tension: 0.32,
                        fill: false,
                        pointRadius: 3,
                        borderWidth: 2.2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top', labels: { color: labelColor, usePointStyle: true } },
                    tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}` } }
                },
                scales: {
                    y: { ticks: { color: labelColor, callback: v => formatCurrency(v) }, grid: { color: gridColor } },
                    x: { ticks: { color: labelColor }, grid: { color: gridColor } }
                }
            }
        });

        renderChartDataTable('rptNetWorthTrendChart', {
            caption: 'Net worth trend over time',
            columns: ['Month', 'Net Worth', 'Liabilities'],
            rows: labels.map((label, idx) => [label, formatCurrency(netWorthData[idx]), formatCurrency(debtData[idx])])
        });
    }

    const compCanvas = document.getElementById('rptNetWorthCompositionChart');
    if (compCanvas) {
        app._rptNetWorthCompositionChart = new Chart(compCanvas, {
            type: 'bar',
            data: {
                labels: compLabels,
                datasets: [
                    { label: 'Asset Growth', data: growthData, backgroundColor: '#10b981', borderRadius: 5 },
                    { label: 'Debt Reduction', data: reductionData, backgroundColor: '#f59e0b', borderRadius: 5 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top', labels: { color: labelColor, usePointStyle: true } },
                    tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}` } }
                },
                scales: {
                    y: { ticks: { color: labelColor, callback: v => formatCurrency(v) }, grid: { color: gridColor } },
                    x: { ticks: { color: labelColor }, grid: { color: gridColor } }
                }
            }
        });
    }
}
