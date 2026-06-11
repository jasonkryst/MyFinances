// Cash Flow Forecasting: project account balances forward and surface
// notable months, negative-balance warnings, and lowest/highest points.

import { formatCurrency, escapeHtml, sanitizeFiniteNumber } from './utils.js';
import { getAccountForecastSeries, getLedgerTransactionsForMonth } from './ledger.js';

const LIABILITY_TYPES = ['Credit Card', 'Loan'];
const HORIZON_OPTIONS = [1, 2, 3, 6, 12];

export function getForecastAssetAccounts(app) {
    return (app.accounts || []).filter(acct => !LIABILITY_TYPES.includes(acct.type));
}

function computeForecastSeries(app, accountSetting, monthsAhead) {
    const assetAccounts = getForecastAssetAccounts(app);

    if (accountSetting === 'total') {
        let combined = null;
        for (const acct of assetAccounts) {
            const series = getAccountForecastSeries(app, acct.id, monthsAhead);
            if (!combined) {
                combined = series.map(entry => ({ ...entry }));
            } else {
                for (let i = 0; i < combined.length; i++) {
                    combined[i].income += series[i].income;
                    combined[i].outflow += series[i].outflow;
                    combined[i].net += series[i].net;
                    combined[i].balance += series[i].balance;
                }
            }
        }
        for (const entry of combined) {
            entry.income = Math.round(entry.income * 100) / 100;
            entry.outflow = Math.round(entry.outflow * 100) / 100;
            entry.net = Math.round(entry.net * 100) / 100;
            entry.balance = Math.round(entry.balance * 100) / 100;
        }
        return combined;
    }

    const acct = assetAccounts.find(a => String(a.id) === String(accountSetting));
    return getAccountForecastSeries(app, acct.id, monthsAhead);
}

function computeForecastStats(series) {
    const projected = series.slice(1);
    let lowest = projected[0];
    let highest = projected[0];
    for (const entry of projected) {
        if (entry.balance < lowest.balance) lowest = entry;
        if (entry.balance > highest.balance) highest = entry;
    }
    const negativeMonth = projected.find(entry => entry.balance < 0) || null;
    return { current: series[0].balance, lowest, highest, negativeMonth, projected };
}

function getOutflowDrivers(app, accountSetting, year, month) {
    const assetAccounts = getForecastAssetAccounts(app);
    let txs;
    if (accountSetting === 'total') {
        txs = [];
        for (const acct of assetAccounts) {
            txs.push(...getLedgerTransactionsForMonth(app, year, month, acct.id));
        }
    } else {
        const acct = assetAccounts.find(a => String(a.id) === String(accountSetting));
        txs = getLedgerTransactionsForMonth(app, year, month, acct.id);
    }
    return txs
        .filter(tx => tx.amount < 0)
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
        .slice(0, 3)
        .map(tx => ({ name: tx.name, amount: Math.abs(tx.amount) }));
}

function findNotableMonths(app, accountSetting, projected, thresholdPct) {
    const notable = new Map();
    if (projected.length === 0) return notable;

    const avgOutflow = projected.reduce((sum, e) => sum + e.outflow, 0) / projected.length;
    if (avgOutflow <= 0) return notable;

    const threshold = (thresholdPct / 100) * avgOutflow;
    for (const entry of projected) {
        if (entry.outflow > threshold) {
            notable.set(`${entry.year}-${entry.month}`, getOutflowDrivers(app, accountSetting, entry.year, entry.month));
        }
    }
    return notable;
}

function renderForecastChart(app, series, stats) {
    const canvas = document.getElementById('cfForecastChart');
    if (!canvas) return;

    const isDark = document.body.classList.contains('dark-mode');
    const gridColor = isDark ? '#374151' : '#e5e7eb';
    const labelColor = isDark ? '#d1d5db' : '#374151';

    const labels = series.map(entry => entry.label);
    const balances = series.map(entry => entry.balance);

    const lowestIndex = series.indexOf(stats.lowest);
    const highestIndex = series.indexOf(stats.highest);
    const showExtremes = lowestIndex !== highestIndex;

    const pointBackgroundColors = series.map((entry, idx) => {
        if (showExtremes && idx === lowestIndex) return '#dc2626';
        if (showExtremes && idx === highestIndex) return '#16a34a';
        return '#2563eb';
    });
    const pointRadii = series.map((entry, idx) =>
        showExtremes && (idx === lowestIndex || idx === highestIndex) ? 6 : 3
    );

    app._rptForecastChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Projected Balance',
                data: balances,
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                pointBackgroundColor: pointBackgroundColors,
                pointRadius: pointRadii,
                fill: true,
                tension: 0.2,
                segment: {
                    borderColor: ctx => (ctx.p1.parsed.y < 0 ? '#dc2626' : '#2563eb')
                }
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: labelColor } },
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}` } }
            },
            scales: {
                x: { ticks: { color: labelColor }, grid: { color: gridColor } },
                y: { ticks: { color: labelColor, callback: v => formatCurrency(v) }, grid: { color: gridColor } }
            }
        }
    });
}

export function renderCashFlowForecast(app) {
    const container = document.getElementById('reportsCashFlowForecast');
    if (!container) return;

    if (app._rptForecastChart) {
        app._rptForecastChart.destroy();
        app._rptForecastChart = null;
    }

    const assetAccounts = getForecastAssetAccounts(app);

    if (assetAccounts.length === 0) {
        container.innerHTML = `
            <div class="health-empty-state">
                <span class="health-empty-value">No forecast available</span>
                <span class="health-empty-sub">
                    Add a Checking, Savings, Cash, or Investment account to see your cash flow forecast.
                    <a href="#" data-forecast-nav="accounts" class="health-link">Go to Accounts</a>
                </span>
            </div>
        `;
        const navLink = container.querySelector('[data-forecast-nav]');
        if (navLink) {
            navLink.addEventListener('click', e => {
                e.preventDefault();
                app.switchPage('accounts');
            });
        }
        return;
    }

    const rangeMonths = HORIZON_OPTIONS.includes(app._forecastRangeMonths) ? app._forecastRangeMonths : 1;
    app._forecastRangeMonths = rangeMonths;

    let accountId = app._forecastAccountId;
    if (accountId !== 'total' && !assetAccounts.some(a => String(a.id) === String(accountId))) {
        accountId = 'total';
    }
    app._forecastAccountId = accountId;

    const thresholdPct = sanitizeFiniteNumber(app._forecastNotableThresholdPct, 130, { min: 100, max: 500 });
    app._forecastNotableThresholdPct = thresholdPct;

    const series = computeForecastSeries(app, accountId, rangeMonths);
    const stats = computeForecastStats(series);
    const notableMonths = findNotableMonths(app, accountId, stats.projected, thresholdPct);

    const horizonButtonsHtml = HORIZON_OPTIONS.map(months => `
        <button class="nw-range-btn ${months === rangeMonths ? 'active' : ''}" data-forecast-range="${months}" type="button">${months}M</button>
    `).join('');

    const accountOptionsHtml = [`<option value="total" ${accountId === 'total' ? 'selected' : ''}>Total Cash Position</option>`]
        .concat(assetAccounts.map(acct =>
            `<option value="${acct.id}" ${String(accountId) === String(acct.id) ? 'selected' : ''}>${escapeHtml(acct.name)}</option>`
        ))
        .join('');

    const warningHtml = stats.negativeMonth
        ? `<div class="cf-warning-banner">⚠️ Projected to go negative in <strong>${escapeHtml(stats.negativeMonth.label)}</strong>: ${formatCurrency(stats.negativeMonth.balance)}</div>`
        : '';

    const summaryHtml = `
        <div class="nw-report-summary">
            <div class="nw-report-stat">
                <span>Current Balance</span>
                <strong>${formatCurrency(stats.current)}</strong>
            </div>
            <div class="nw-report-stat">
                <span>Lowest Projected (${escapeHtml(stats.lowest.label)})</span>
                <strong class="${stats.lowest.balance < 0 ? 'acct-balance--neg' : 'acct-balance--pos'}">${formatCurrency(stats.lowest.balance)}</strong>
            </div>
            <div class="nw-report-stat">
                <span>Highest Projected (${escapeHtml(stats.highest.label)})</span>
                <strong class="acct-balance--pos">${formatCurrency(stats.highest.balance)}</strong>
            </div>
        </div>
    `;

    let rowsHtml = '';
    for (const entry of stats.projected) {
        const negative = entry.balance < 0;
        rowsHtml += `
            <tr class="${negative ? 'cf-row--negative' : ''}">
                <td>${escapeHtml(entry.label)}</td>
                <td>${formatCurrency(entry.income)}</td>
                <td>${formatCurrency(entry.outflow)}</td>
                <td class="${entry.net >= 0 ? 'acct-balance--pos' : 'acct-balance--neg'}">${formatCurrency(entry.net)}</td>
                <td class="${negative ? 'acct-balance--neg' : 'acct-balance--pos'}">${formatCurrency(entry.balance)}</td>
            </tr>
        `;
        const drivers = notableMonths.get(`${entry.year}-${entry.month}`);
        if (drivers && drivers.length > 0) {
            const driversText = drivers.map(d => `${escapeHtml(d.name)} (${formatCurrency(d.amount)})`).join(', ');
            rowsHtml += `
                <tr class="cf-notable-row${negative ? ' cf-row--negative' : ''}">
                    <td colspan="5">⚠️ Driven by: ${driversText}</td>
                </tr>
            `;
        }
    }

    container.innerHTML = `
        <div class="cf-controls">
            <div class="cf-control-group">
                <span class="cf-control-label">Horizon</span>
                <div class="nw-range-buttons" role="group" aria-label="Forecast horizon">
                    ${horizonButtonsHtml}
                </div>
            </div>
            <div class="cf-control-group">
                <label for="forecastAccountSelect" class="cf-control-label">Account</label>
                <select id="forecastAccountSelect" class="cf-account-select select-styled">
                    ${accountOptionsHtml}
                </select>
            </div>
            <div class="cf-control-group">
                <label for="forecastThresholdInput" class="cf-control-label">Flag months with outflow above</label>
                <input type="number" id="forecastThresholdInput" class="cf-threshold-input"
                       value="${thresholdPct}" min="100" max="500" step="5">
                <span class="cf-control-suffix">% of average</span>
            </div>
        </div>
        ${warningHtml}
        ${summaryHtml}
        <div class="rpt-chart-card">
            <div class="rpt-chart-canvas-wrap">
                <canvas id="cfForecastChart"></canvas>
            </div>
        </div>
        <div class="nw-history-table-wrap">
            <table class="nw-history-table">
                <thead>
                    <tr><th>Month</th><th>Income</th><th>Outflow</th><th>Net</th><th>Ending Balance</th></tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        </div>
    `;

    const accountSelect = document.getElementById('forecastAccountSelect');
    if (accountSelect) {
        accountSelect.onchange = () => {
            app._forecastAccountId = accountSelect.value;
            app.saveToStorage();
            renderCashFlowForecast(app);
        };
    }

    const thresholdInput = document.getElementById('forecastThresholdInput');
    if (thresholdInput) {
        thresholdInput.onchange = () => {
            app._forecastNotableThresholdPct = sanitizeFiniteNumber(thresholdInput.value, 130, { min: 100, max: 500 });
            app.saveToStorage();
            renderCashFlowForecast(app);
        };
    }

    renderForecastChart(app, series, stats);
}
