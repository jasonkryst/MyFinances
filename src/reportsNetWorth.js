// Net worth snapshots: capture, series aggregation, dashboard widget, and reports-page timeline

import { formatCurrency, computeMonthlyIncomeForMonth, renderChartDataTable, escapeHtml } from './utils.js';
import { getLedgerTransactionsForMonth } from './ledgerTransactions.js';
import { pgPut } from './postgresSync.js';

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

// Projects net worth forward `horizonMonths` from today (issue #335).
// Starts from the latest snapshot (or a freshly computed one if none exist)
// and adds, per month:
//   assets   += monthlyIncome - nonDebtExpenses - cashPaidToDebtThisMonth
//   liabilities = total remaining debt balance that month
// Debt principal paid is a dollar-for-dollar transfer from assets to a
// reduced liability (no net-worth effect by itself — only interest and
// true expenses move net worth), so this avoids double-counting it.
// When app.lastPaymentPlan exists, liabilities/cashPaidToDebt come from its
// real per-debt balance/payment schedule (true compounding); once the plan
// ends (or none exists), falls back to the simplified model the issue
// describes: net worth grows by a flat (income - expenses) delta per month,
// with no further debt-payoff compounding.
export function computeNetWorthProjection(app, horizonMonths) {
    const now = new Date();
    const year = now.getFullYear(), month = now.getMonth();

    const latestSnapshot = getSnapshotSeries(app, 1)[0];
    const current = latestSnapshot || computeSnapshotMetrics(app, now);

    const { monthlyTotal: monthlyIncome } = computeMonthlyIncomeForMonth(app.incomes, app.bonuses, year, month);
    const txs = getLedgerTransactionsForMonth(app, year, month);
    let nonDebtExpenses = 0, debtPayments = 0;
    for (const tx of txs) {
        if ((tx.amount || 0) >= 0) continue;
        if (tx.type === 'debt') debtPayments += Math.abs(tx.amount);
        else nonDebtExpenses += Math.abs(tx.amount);
    }

    const plan = Array.isArray(app.lastPaymentPlan) ? app.lastPaymentPlan : [];
    const points = [];
    let assets = current.totalAssets;
    let flatNetWorth = current.netWorth;

    for (let i = 1; i <= horizonMonths; i++) {
        const planMonth = plan[i - 1];
        let netWorth, liabilities;
        if (planMonth) {
            const liabilitiesThisMonth = planMonth.payments.reduce((s, p) => s + Math.max(0, p.balance || 0), 0);
            const cashPaidThisMonth = planMonth.payments.reduce((s, p) => s + (p.payment || 0), 0);
            assets += monthlyIncome - nonDebtExpenses - cashPaidThisMonth;
            liabilities = liabilitiesThisMonth;
            netWorth = assets - liabilities;
        } else {
            // No plan, or past the end of a plan that's already fully run —
            // simplified flat model; liabilities aren't tracked separately.
            flatNetWorth += monthlyIncome - nonDebtExpenses - debtPayments;
            netWorth = flatNetWorth;
            liabilities = null;
        }
        const d = new Date(year, month + i, 1);
        points.push({
            year: d.getFullYear(), month: d.getMonth(),
            label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
            netWorth: parseFloat(netWorth.toFixed(2)),
            liabilities: liabilities !== null ? parseFloat(liabilities.toFixed(2)) : null,
            isYearEnd: (i % 12) === 0
        });
    }
    return points;
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
    if (app._storageBackendKind === 'postgres') pgPut(app, `/api/net-worth-snapshots/${snapshot.date}`, snapshot);

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

    const projectionYears = [1, 3, 5].includes(app._netWorthProjectionYears) ? app._netWorthProjectionYears : 3;
    app._netWorthProjectionYears = projectionYears;

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

    const projection = computeNetWorthProjection(app, projectionYears * 12);
    const yearEndMilestones = projection.filter(p => p.isYearEnd);
    const milestonesHtml = yearEndMilestones.length > 0
        ? `<div class="nw-projection-milestones-list">${yearEndMilestones.map((m, i) =>
            `<div class="nw-projection-milestone-item"><span class="nw-projection-milestone-label">Year ${i + 1} (${escapeHtml(m.label)})</span><span class="nw-projection-milestone-value">${formatCurrency(m.netWorth)}</span></div>`
          ).join('')}</div>`
        : '';

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
                <div class="nw-range-buttons" role="group" aria-label="Net worth projection horizon">
                    <button class="nw-range-btn ${projectionYears === 1 ? 'active' : ''}" data-networth-projection="1" type="button">Project 1Y</button>
                    <button class="nw-range-btn ${projectionYears === 3 ? 'active' : ''}" data-networth-projection="3" type="button">Project 3Y</button>
                    <button class="nw-range-btn ${projectionYears === 5 ? 'active' : ''}" data-networth-projection="5" type="button">Project 5Y</button>
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
                <p class="rpt-chart-sub">Net worth growth and falling liabilities across snapshots, with a ${projectionYears}-year dashed forward projection</p>
                <div class="rpt-chart-canvas-wrap"><canvas id="rptNetWorthTrendChart"></canvas></div>
                ${milestonesHtml}
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

    // Forward projection (issue #335): a dashed continuation of the Net Worth
    // line. The projected dataset is null everywhere except the last
    // historical point (so it visually connects) and the projected months
    // themselves, so Chart.js draws a single unbroken dashed segment rather
    // than a gap. `projection` itself was already computed above (also used
    // for the milestones list).
    const projectedLabels = projection.map(p => p.label);
    const allLabels = [...labels, ...projectedLabels];
    const netWorthHistorical = [...netWorthData, ...projection.map(() => null)];
    const netWorthProjected = [
        ...labels.map(() => null).slice(0, -1), netWorthData[netWorthData.length - 1],
        ...projection.map(p => p.netWorth)
    ];

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
        if (app._rptNetWorthTrendChart) { app._rptNetWorthTrendChart.destroy(); app._rptNetWorthTrendChart = null; }
        app._rptNetWorthTrendChart = new Chart(trendCanvas, {
            type: 'line',
            data: {
                labels: allLabels,
                datasets: [
                    {
                        label: 'Net Worth',
                        data: netWorthHistorical,
                        borderColor: '#2563eb',
                        backgroundColor: 'rgba(37,99,235,0.12)',
                        tension: 0.32,
                        fill: true,
                        pointRadius: 3,
                        borderWidth: 2.2,
                        spanGaps: false
                    },
                    {
                        label: 'Liabilities',
                        data: [...debtData, ...projection.map(() => null)],
                        borderColor: '#dc2626',
                        backgroundColor: 'rgba(220,38,38,0.08)',
                        tension: 0.32,
                        fill: false,
                        pointRadius: 3,
                        borderWidth: 2.2
                    },
                    {
                        label: 'Net Worth (projected)',
                        data: netWorthProjected,
                        borderColor: '#2563eb',
                        backgroundColor: 'transparent',
                        borderDash: [6, 4],
                        tension: 0.32,
                        fill: false,
                        pointRadius: 2,
                        borderWidth: 2,
                        spanGaps: true
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
            caption: `Net worth trend over time, with a ${projectionYears}-year forward projection`,
            columns: ['Month', 'Net Worth', 'Liabilities', 'Projected'],
            rows: [
                ...labels.map((label, idx) => [label, formatCurrency(netWorthData[idx]), formatCurrency(debtData[idx]), 'No']),
                ...projection.map(p => [p.label, formatCurrency(p.netWorth), p.liabilities !== null ? formatCurrency(p.liabilities) : '—', 'Yes'])
            ]
        });
    }

    const compCanvas = document.getElementById('rptNetWorthCompositionChart');
    if (compCanvas) {
        if (app._rptNetWorthCompositionChart) { app._rptNetWorthCompositionChart.destroy(); app._rptNetWorthCompositionChart = null; }
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
        renderChartDataTable('rptNetWorthCompositionChart', {
            caption: 'Asset growth and debt reduction by month',
            columns: ['Month', 'Asset Growth', 'Debt Reduction'],
            rows: compLabels.map((label, i) => [label, formatCurrency(growthData[i]), formatCurrency(reductionData[i])])
        });
    }
}
