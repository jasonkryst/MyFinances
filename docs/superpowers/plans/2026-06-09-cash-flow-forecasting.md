# Cash Flow Forecasting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "🔮 Forecast" tab to the Reports page that projects account balances forward (1/2/3/6/12 months), surfaces the lowest/highest projected balances, warns when a balance is projected to go negative, and flags months with unusually high outflow ("notable months") with their top spending drivers.

**Architecture:** A new exported function `getAccountForecastSeries(app, accountId, monthsAhead)` in `src/ledger.js` reuses the existing `getLedgerTransactionsForMonth` projection engine to build a month-by-month running balance for one account. A new module `src/forecast.js` aggregates these series (per-account or summed across all asset-type accounts as "Total Cash Position"), derives stats (lowest/highest/negative-balance/notable months), and renders the tab's controls, summary cards, Chart.js line chart, and table. The tab is wired into the existing Reports page tab system (`index.html`, `src/reports.js`, `src/ui.js`) and its three user settings (horizon, account, notable threshold) persist via a new `forecastSettings` block in `src/storage.js`, mirroring the existing `ledgerSettings` pattern.

**Tech Stack:** Vanilla ES modules, Chart.js v3+ (global `Chart`, loaded via `<script>` tag), localStorage, Playwright + pytest for browser tests.

---

## File Structure

- **Modify `src/ledger.js`** — add exported `getAccountForecastSeries(app, accountId, monthsAhead)` after `getLedgerTransactionsForMonth` (after line 300).
- **Create `src/forecast.js`** — new module: `getForecastAssetAccounts(app)` (exported), internal helpers `computeForecastSeries`, `computeForecastStats`, `getOutflowDrivers`, `findNotableMonths`, `renderForecastChart`, and exported `renderCashFlowForecast(app)`.
- **Modify `src/reports.js`** — import `renderCashFlowForecast`, add `_rptForecastChart` to the chart-cleanup list, call `renderCashFlowForecast(app)` from `renderReportsPage`.
- **Modify `src/ui.js`** — add a delegated click handler for `[data-forecast-range]` horizon buttons (mirrors the existing `[data-networth-range]` handler).
- **Modify `src/storage.js`** — add `sanitizeForecastSettings`, and wire `forecastSettings` through `sanitizeParsedState`, `saveToStorage`, `loadFromStorage`, `exportAllJSON`, both branches of `importAllJSON`, and `clearAllData`.
- **Modify `src/app.js`** — initialize `_forecastRangeMonths`, `_forecastAccountId`, `_forecastNotableThresholdPct` defaults in the constructor.
- **Modify `index.html`** — add a `🔮 Forecast` tab button and `#rptPanel-forecast` panel containing `#reportsCashFlowForecast`.
- **Modify `styles.css`** — add `.cf-controls`, `.cf-control-group`, `.cf-control-label`, `.cf-threshold-input`, `.cf-control-suffix`, `.cf-warning-banner`, `.cf-row--negative`, `.cf-notable-row`.
- **Create `tests/features/test_forecast.py`** — feature tests for the Forecast tab.
- **Modify `tests/security/test_xss.py`** — add an XSS check for the Forecast table's "driven by" driver names.
- **Modify `tests/integration/test_smoke.py`** — add a Forecast-tab smoke step.

---

## Task 1: Data Layer, Forecast Module, and Base Rendering

**Files:**
- Modify: `src/ledger.js` (after line 300)
- Create: `src/forecast.js`
- Modify: `src/reports.js:1-57`
- Modify: `index.html:630-662`
- Modify: `styles.css` (after line 4101)
- Test: `tests/features/test_forecast.py` (new)

- [x] **Step 1: Write the failing tests**

Create `tests/features/test_forecast.py`:

```python
#!/usr/bin/env python3
"""
Cash Flow Forecasting Tests
Tests the Forecast tab on the Reports page: tab/panel wiring, empty state,
controls, summary stats, chart, table, negative-balance warning, notable
months, account selection, and horizon switching.
"""

import pytest

BASE_URL = "http://localhost:5500/"


@pytest.mark.feature
def test_forecast_tab_exists(app_page):
    """Forecast tab button and panel exist in the Reports page tab bar."""
    page = app_page

    page.click('button[data-page="reports"]')
    page.wait_for_timeout(300)

    tab = page.query_selector('[data-rptab="forecast"]')
    assert tab, "Forecast tab button not found"

    tab.click()
    page.wait_for_timeout(300)

    panel = page.query_selector('#rptPanel-forecast')
    assert panel and panel.evaluate('(el) => el.offsetParent !== null'), \
        "Forecast panel should be visible after clicking its tab"


@pytest.mark.feature
def test_forecast_empty_state_with_no_accounts(app_page):
    """Forecast tab shows an empty state when there are no asset-type accounts."""
    page = app_page

    page.evaluate("""() => {
        window.app.accounts = [];
        window.app.switchPage('reports');
    }""")
    page.wait_for_timeout(300)

    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(300)

    section_text = page.query_selector('#reportsCashFlowForecast').text_content()
    assert 'Go to Accounts' in section_text, \
        "Expected empty-state message directing to Accounts page"


@pytest.mark.feature
def test_forecast_default_render_with_account(app_page):
    """Default 1-month/Total view renders controls, chart, summary, and one table row."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 9001, name: 'Checking', type: 'Checking', startingBalance: 5000 }];
        app.incomes = [{ id: 1, name: 'Salary', amount: 3000, firstPayDate: '2026-01-01', frequency: 'monthly' }];
        app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('reports');
    }""")
    page.wait_for_timeout(300)

    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(300)

    section = page.query_selector('#reportsCashFlowForecast')
    assert section.query_selector('.cf-controls'), "Forecast controls not rendered"
    assert section.query_selector('#cfForecastChart'), "Forecast chart canvas not rendered"

    rows = section.query_selector_all('.nw-history-table tbody tr')
    assert len(rows) == 1, f"Expected 1 table row for default 1-month horizon, got {len(rows)}"

    section_text = section.text_content()
    assert '$5,000.00' in section_text, "Expected current balance ($5,000.00) in summary"
    assert '$8,000.00' in section_text, "Expected projected balance ($5,000 + $3,000 income) in summary/table"


@pytest.mark.feature
def test_forecast_account_dropdown_excludes_liabilities(app_page):
    """Account dropdown lists Total Cash Position and asset accounts, excluding Credit Card/Loan."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [
            { id: 9001, name: 'Checking', type: 'Checking', startingBalance: 5000 },
            { id: 9002, name: 'Visa', type: 'Credit Card', startingBalance: -1000 }
        ];
        app.incomes = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('reports');
    }""")
    page.wait_for_timeout(300)

    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(300)

    options = page.query_selector_all('#forecastAccountSelect option')
    option_texts = [o.text_content() for o in options]
    assert 'Total Cash Position' in option_texts
    assert 'Checking' in option_texts
    assert 'Visa' not in option_texts


@pytest.mark.feature
def test_forecast_account_selector_switches_view(app_page):
    """Selecting a specific account updates the Current Balance stat."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [
            { id: 9001, name: 'Checking', type: 'Checking', startingBalance: 5000 },
            { id: 9002, name: 'Savings', type: 'Savings', startingBalance: 2000 }
        ];
        app.incomes = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('reports');
    }""")
    page.wait_for_timeout(300)

    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(300)

    section_text = page.query_selector('#reportsCashFlowForecast').text_content()
    assert '$7,000.00' in section_text, "Total Cash Position should sum both accounts (5000 + 2000)"

    page.select_option('#forecastAccountSelect', label='Checking')
    page.wait_for_timeout(300)

    section_text = page.query_selector('#reportsCashFlowForecast').text_content()
    assert '$5,000.00' in section_text, "Selecting Checking should show its balance alone"
    assert '$7,000.00' not in section_text, "Total should no longer be shown after selecting an account"


@pytest.mark.feature
def test_forecast_negative_balance_warning(app_page):
    """A projected negative balance shows a warning banner and highlights the table row."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 9001, name: 'Checking', type: 'Checking', startingBalance: 100 }];
        app.bills = [{ id: 10, name: 'Rent', amount: 500, dueDay: 1, category: 'Housing', accountId: 9001 }];
        app.incomes = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('reports');
    }""")
    page.wait_for_timeout(300)

    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(300)

    section = page.query_selector('#reportsCashFlowForecast')
    section_text = section.text_content()
    assert 'Projected to go negative' in section_text
    assert '-$400.00' in section_text, "Expected projected balance of -$400.00 (100 - 500)"
    assert section.query_selector('.cf-row--negative'), "Expected a negative-balance row in the table"


@pytest.mark.feature
def test_forecast_notable_month_shows_drivers(app_page):
    """A month with unusually high outflow is flagged with its top spending drivers."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        const targetMonths = now.getMonth() + 3;
        const year = now.getFullYear() + Math.floor(targetMonths / 12);
        const month = targetMonths % 12;
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-15`;

        app.accounts = [{ id: 9001, name: 'Checking', type: 'Checking', startingBalance: 10000 }];
        app.bills = [{ id: 10, name: 'Subscription', amount: 100, dueDay: 1, category: 'Other', accountId: 9001 }];
        app.expenses = [{ id: 20, name: 'Property Tax', amount: 1200, date: dateStr, category: 'Other', accountId: 9001 }];
        app.incomes = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app._forecastRangeMonths = 6;
        app._forecastAccountId = 'total';
        app._forecastNotableThresholdPct = 130;
        app.switchPage('reports');
    }""")
    page.wait_for_timeout(300)

    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(300)

    section_text = page.query_selector('#reportsCashFlowForecast').text_content()
    assert 'Driven by' in section_text, "Expected a notable-month driver row"
    assert 'Property Tax' in section_text, "Expected Property Tax listed as a driver"
    assert '$1,200.00' in section_text, "Expected Property Tax amount in drivers"
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/features/test_forecast.py -v`
Expected: All 7 tests FAIL (no `[data-rptab="forecast"]`, no `#reportsCashFlowForecast`, etc.)

- [x] **Step 3: Add `getAccountForecastSeries` to `src/ledger.js`**

Insert after line 300 (the closing brace of `getLedgerTransactionsForMonth`, just before the `// Gather all transactions for the ledger` comment on line 302):

```js

// Project a single account's balance forward `monthsAhead` months from the
// current calendar month. Index 0 is "Now" (the account's starting balance);
// indices 1..monthsAhead are consecutive future months with a cumulative
// running balance.
export function getAccountForecastSeries(app, accountId, monthsAhead) {
    const account = (app.accounts || []).find(a => a.id === accountId);
    const startingBalance = account ? (account.startingBalance || 0) : 0;

    const series = [{
        label: 'Now',
        income: 0,
        outflow: 0,
        net: 0,
        balance: Math.round(startingBalance * 100) / 100
    }];

    const now = new Date();
    let balance = startingBalance;

    for (let i = 1; i <= monthsAhead; i++) {
        const totalMonths = now.getMonth() + i;
        const year = now.getFullYear() + Math.floor(totalMonths / 12);
        const month = totalMonths % 12;

        const txs = getLedgerTransactionsForMonth(app, year, month, accountId);
        let income = 0;
        let outflow = 0;
        for (const tx of txs) {
            if (tx.amount >= 0) income += tx.amount;
            else outflow += Math.abs(tx.amount);
        }
        const net = income - outflow;
        balance += net;

        const label = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

        series.push({
            year,
            month,
            label,
            income: Math.round(income * 100) / 100,
            outflow: Math.round(outflow * 100) / 100,
            net: Math.round(net * 100) / 100,
            balance: Math.round(balance * 100) / 100
        });
    }

    return series;
}
```

- [x] **Step 4: Add the Forecast tab button and panel to `index.html`**

In `index.html`, the tab bar currently ends with (around line 636):

```html
                    <button class="rpt-tab-btn" data-rptab="networth" aria-selected="false">📉 Net Worth</button>
                </div>
```

Change to:

```html
                    <button class="rpt-tab-btn" data-rptab="networth" aria-selected="false">📉 Net Worth</button>
                    <button class="rpt-tab-btn" data-rptab="forecast" aria-selected="false">🔮 Forecast</button>
                </div>
```

The Net Worth panel currently ends the panel list (around lines 659-662):

```html
                <div class="rpt-tab-panel" id="rptPanel-networth">
                    <div id="reportsNetWorth"></div>
                </div>
            </section>
```

Change to:

```html
                <div class="rpt-tab-panel" id="rptPanel-networth">
                    <div id="reportsNetWorth"></div>
                </div>

                <div class="rpt-tab-panel" id="rptPanel-forecast">
                    <div id="reportsCashFlowForecast"></div>
                </div>
            </section>
```

- [x] **Step 5: Create `src/forecast.js`**

```js
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
```

- [x] **Step 6: Wire `renderCashFlowForecast` into `src/reports.js`**

Modify the import block at the top of `src/reports.js` (currently lines 3-8):

```js
import {
    getIncomePaydaysInMonth,
    formatCurrency,
    escapeHtml
} from './utils.js';
import { getLedgerTransactionsForMonth } from './ledger.js';
```

Change to:

```js
import {
    getIncomePaydaysInMonth,
    formatCurrency,
    escapeHtml
} from './utils.js';
import { getLedgerTransactionsForMonth } from './ledger.js';
import { renderCashFlowForecast } from './forecast.js';
```

Modify `renderReportsPage` (currently lines 41-57):

```js
export function renderReportsPage(app) {
    updateReportMonthNav(app);

    ['_rptIncomeChart', '_rptBillsChart', '_rptExpChart', '_rptMoneyFlowChart', '_rptOutflowChart', '_rptNetWorthTrendChart', '_rptNetWorthCompositionChart']
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
    renderReportsNetWorth(app);
}
```

Change to:

```js
export function renderReportsPage(app) {
    updateReportMonthNav(app);

    ['_rptIncomeChart', '_rptBillsChart', '_rptExpChart', '_rptMoneyFlowChart', '_rptOutflowChart', '_rptNetWorthTrendChart', '_rptNetWorthCompositionChart', '_rptForecastChart']
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
    renderReportsNetWorth(app);
    renderCashFlowForecast(app);
}
```

- [x] **Step 7: Add CSS to `styles.css`**

Insert after line 4101 (`.nw-history-table tr:last-child td { border-bottom: none; }`), before the `@media (max-width: 640px)` block:

```css

/* Cash Flow Forecast controls */
.cf-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
    margin-bottom: 14px;
}

.cf-control-group {
    display: flex;
    align-items: center;
    gap: 8px;
}

.cf-control-label {
    font-size: 0.82rem;
    color: var(--text-muted);
    font-weight: 600;
}

.cf-threshold-input {
    width: 70px;
    padding: 5px 8px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--card-bg);
    color: var(--text-primary);
}

.cf-control-suffix {
    font-size: 0.82rem;
    color: var(--text-muted);
}

/* Negative-balance warning banner */
.cf-warning-banner {
    background: rgba(220, 38, 38, 0.08);
    border: 1px solid #dc2626;
    color: #dc2626;
    border-radius: 8px;
    padding: 10px 14px;
    margin-bottom: 14px;
    font-size: 0.9rem;
}

body.dark-mode .cf-warning-banner {
    color: #f87171;
    border-color: #f87171;
    background: rgba(248, 113, 113, 0.08);
}

/* Forecast table row highlighting */
.cf-row--negative td {
    background: rgba(220, 38, 38, 0.06);
}

body.dark-mode .cf-row--negative td {
    background: rgba(248, 113, 113, 0.08);
}

.cf-notable-row td {
    font-size: 0.78rem;
    color: var(--text-muted);
    font-style: italic;
    text-align: left;
    padding-top: 2px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border-color);
}
```

- [x] **Step 8: Run the tests to verify they pass**

Run: `pytest tests/features/test_forecast.py -v`
Expected: All 7 tests PASS

- [x] **Step 9: Commit**

```bash
git add src/ledger.js src/forecast.js src/reports.js index.html styles.css tests/features/test_forecast.py
git commit -m "feat: add Cash Flow Forecast tab to Reports page"
```

---

## Task 2: Wire Up Horizon Buttons

**Files:**
- Modify: `src/ui.js:316-333`
- Test: `tests/features/test_forecast.py` (append)

- [x] **Step 1: Write the failing test**

Append to `tests/features/test_forecast.py`:

```python


@pytest.mark.feature
def test_forecast_horizon_button_changes_table_rows(app_page):
    """Clicking a horizon button changes the number of table rows."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 9001, name: 'Checking', type: 'Checking', startingBalance: 5000 }];
        app.incomes = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('reports');
    }""")
    page.wait_for_timeout(300)

    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(300)

    rows = page.query_selector_all('#reportsCashFlowForecast .nw-history-table tbody tr')
    assert len(rows) == 1, f"Expected 1 row for default 1-month horizon, got {len(rows)}"

    page.click('[data-forecast-range="6"]')
    page.wait_for_timeout(300)

    rows = page.query_selector_all('#reportsCashFlowForecast .nw-history-table tbody tr')
    assert len(rows) == 6, f"Expected 6 rows after selecting 6-month horizon, got {len(rows)}"

    active_btn = page.query_selector('[data-forecast-range="6"].active')
    assert active_btn, "6-month horizon button should be marked active"
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pytest tests/features/test_forecast.py::test_forecast_horizon_button_changes_table_rows -v`
Expected: FAIL — clicking `[data-forecast-range="6"]` does nothing yet, table stays at 1 row.

- [x] **Step 3: Add the delegated click handler to `src/ui.js`**

The existing `data-networth-range` handler is inside a `document.addEventListener('click', ...)` block (currently lines 316-333):

```js
    document.addEventListener('click', event => {
        const rangeBtn = event.target.closest('[data-networth-range]');
        if (rangeBtn) {
            const nextRange = parseInt(rangeBtn.getAttribute('data-networth-range'), 10);
            if ([3, 6, 12].includes(nextRange)) {
                app._netWorthRangeMonths = nextRange;
                app.renderReportsPage();
            }
            return;
        }

        const captureBtn = event.target.closest('#captureSnapshotBtn');
        if (captureBtn) {
            app.captureNetWorthSnapshot({ source: 'manual' });
            app.renderReportsPage();
            app.renderNetWorthWidget();
        }
    });
```

Change to:

```js
    document.addEventListener('click', event => {
        const rangeBtn = event.target.closest('[data-networth-range]');
        if (rangeBtn) {
            const nextRange = parseInt(rangeBtn.getAttribute('data-networth-range'), 10);
            if ([3, 6, 12].includes(nextRange)) {
                app._netWorthRangeMonths = nextRange;
                app.renderReportsPage();
            }
            return;
        }

        const forecastRangeBtn = event.target.closest('[data-forecast-range]');
        if (forecastRangeBtn) {
            const nextRange = parseInt(forecastRangeBtn.getAttribute('data-forecast-range'), 10);
            if ([1, 2, 3, 6, 12].includes(nextRange)) {
                app._forecastRangeMonths = nextRange;
                app.saveToStorage();
                app.renderReportsPage();
            }
            return;
        }

        const captureBtn = event.target.closest('#captureSnapshotBtn');
        if (captureBtn) {
            app.captureNetWorthSnapshot({ source: 'manual' });
            app.renderReportsPage();
            app.renderNetWorthWidget();
        }
    });
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pytest tests/features/test_forecast.py::test_forecast_horizon_button_changes_table_rows -v`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/ui.js tests/features/test_forecast.py
git commit -m "feat: wire up Cash Flow Forecast horizon buttons"
```

---

## Task 3: Persist Forecast Settings

**Files:**
- Modify: `src/storage.js` (sanitizeParsedState ~line 175, saveToStorage ~line 204, loadFromStorage ~line 237, exportAllJSON ~line 270, importAllJSON ~lines 468/507/543, clearAllData ~line 573)
- Modify: `src/app.js` (constructor, ~line 122)
- Test: `tests/features/test_forecast.py` (append)

- [x] **Step 1: Write the failing tests**

Append to `tests/features/test_forecast.py`:

```python


@pytest.mark.feature
def test_forecast_settings_persist_after_reload(app_page):
    """Forecast horizon and notable threshold settings persist across a page reload."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 9001, name: 'Checking', type: 'Checking', startingBalance: 5000 }];
        app.incomes = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.saveToStorage();
        app.switchPage('reports');
    }""")
    page.wait_for_timeout(300)

    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(300)

    page.click('[data-forecast-range="3"]')
    page.wait_for_timeout(300)

    page.fill('#forecastThresholdInput', '200')
    page.dispatch_event('#forecastThresholdInput', 'change')
    page.wait_for_timeout(300)

    page.reload(wait_until="networkidle")
    page.wait_for_timeout(500)

    page.click('button[data-page="reports"]')
    page.wait_for_timeout(300)
    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(300)

    active_btn = page.query_selector('[data-forecast-range="3"].active')
    assert active_btn, "3-month horizon should remain selected after reload"

    threshold_value = page.input_value('#forecastThresholdInput')
    assert threshold_value == '200', f"Expected threshold 200 to persist, got {threshold_value}"


@pytest.mark.feature
def test_forecast_settings_export_import_roundtrip(app_page):
    """forecastSettings round-trips through importAllJSON."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 9001, name: 'Checking', type: 'Checking', startingBalance: 5000 }];
        app.incomes = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app._forecastRangeMonths = 12;
        app._forecastAccountId = 'total';
        app._forecastNotableThresholdPct = 250;
        app.saveToStorage();
    }""")
    page.wait_for_timeout(300)

    result = page.evaluate("""async () => {
        const app = window.app;
        const payload = {
            version: '3.0',
            accounts: app.accounts,
            debts: [],
            incomes: [{ id: 1, name: 'Salary', amount: 1000, firstPayDate: '2026-01-01', frequency: 'monthly' }],
            bonuses: [], bills: [], expenses: [],
            recurringTemplates: [], emergencyFunds: [], sinkingFunds: [],
            forecastSettings: { rangeMonths: 3, accountId: 'total', notableThresholdPct: 175 }
        };
        const file = new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' });

        return new Promise(resolve => {
            app.importAllJSON(file);
            setTimeout(() => {
                resolve({
                    rangeMonths: app._forecastRangeMonths,
                    accountId: app._forecastAccountId,
                    notableThresholdPct: app._forecastNotableThresholdPct
                });
            }, 300);
        });
    }""")

    assert result['rangeMonths'] == 3
    assert result['accountId'] == 'total'
    assert result['notableThresholdPct'] == 175
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/features/test_forecast.py::test_forecast_settings_persist_after_reload tests/features/test_forecast.py::test_forecast_settings_export_import_roundtrip -v`
Expected: Both FAIL — `app._forecastRangeMonths` etc. are not saved/loaded/imported yet (the controls still work in-memory from Task 1/2, but values reset to defaults on reload since nothing reads/writes localStorage for them).

- [x] **Step 3: Add `sanitizeForecastSettings` and wire it into `sanitizeParsedState`**

In `src/storage.js`, add a new function just before `sanitizeParsedState` (currently at line 175):

```js
function sanitizeForecastSettings(record) {
    const rawRange = sanitizeInteger(record?.rangeMonths, 1);
    return {
        rangeMonths: [1, 2, 3, 6, 12].includes(rawRange) ? rawRange : 1,
        accountId: record?.accountId === 'total' ? 'total' : (normalizeText(record?.accountId, 30) || 'total'),
        notableThresholdPct: sanitizeFiniteNumber(record?.notableThresholdPct, 130, { min: 100, max: 500 })
    };
}

function sanitizeParsedState(parsed = {}) {
```

Then, inside `sanitizeParsedState`'s returned object, the `ledgerSettings` block currently ends the object (lines 193-199):

```js
        ledgerSettings: {
            accountFilter: normalizeText(parsed?.ledgerSettings?.accountFilter, 20) || 'all',
            dateRange: normalizeText(parsed?.ledgerSettings?.dateRange, 20) || 'all',
            sortKey: normalizeText(parsed?.ledgerSettings?.sortKey, 20) || 'date',
            sortDir: parsed?.ledgerSettings?.sortDir === 'asc' ? 'asc' : 'desc'
        }
    };
}
```

Change to:

```js
        ledgerSettings: {
            accountFilter: normalizeText(parsed?.ledgerSettings?.accountFilter, 20) || 'all',
            dateRange: normalizeText(parsed?.ledgerSettings?.dateRange, 20) || 'all',
            sortKey: normalizeText(parsed?.ledgerSettings?.sortKey, 20) || 'date',
            sortDir: parsed?.ledgerSettings?.sortDir === 'asc' ? 'asc' : 'desc'
        },
        forecastSettings: sanitizeForecastSettings(parsed?.forecastSettings)
    };
}
```

- [x] **Step 4: Wire `forecastSettings` into `saveToStorage` and `loadFromStorage`**

In `saveToStorage` (currently lines 204-234), the `ledgerSettings` block is:

```js
            ledgerSettings: {
                accountFilter: app._ledgerAccountFilter || 'all',
                dateRange: app._ledgerDateRange || 'all',
                sortKey: app._ledgerSortKey || 'date',
                sortDir: app._ledgerSortDir || 'desc'
            },
            timestamp: new Date().toISOString()
```

Change to:

```js
            ledgerSettings: {
                accountFilter: app._ledgerAccountFilter || 'all',
                dateRange: app._ledgerDateRange || 'all',
                sortKey: app._ledgerSortKey || 'date',
                sortDir: app._ledgerSortDir || 'desc'
            },
            forecastSettings: {
                rangeMonths: app._forecastRangeMonths || 1,
                accountId: app._forecastAccountId || 'total',
                notableThresholdPct: app._forecastNotableThresholdPct || 130
            },
            timestamp: new Date().toISOString()
```

In `loadFromStorage` (currently lines 237-267), the ledger-settings restoration is:

```js
            // Restore ledger settings if present
            app._ledgerAccountFilter = clean.ledgerSettings.accountFilter;
            app._ledgerDateRange = clean.ledgerSettings.dateRange;
            app._ledgerSortKey = clean.ledgerSettings.sortKey;
            app._ledgerSortDir = clean.ledgerSettings.sortDir;
        }
```

Change to:

```js
            // Restore ledger settings if present
            app._ledgerAccountFilter = clean.ledgerSettings.accountFilter;
            app._ledgerDateRange = clean.ledgerSettings.dateRange;
            app._ledgerSortKey = clean.ledgerSettings.sortKey;
            app._ledgerSortDir = clean.ledgerSettings.sortDir;
            // Restore forecast settings if present
            app._forecastRangeMonths = clean.forecastSettings.rangeMonths;
            app._forecastAccountId = clean.forecastSettings.accountId;
            app._forecastNotableThresholdPct = clean.forecastSettings.notableThresholdPct;
        }
```

- [x] **Step 5: Wire `forecastSettings` into `exportAllJSON`**

In `exportAllJSON` (currently lines 270-302), the `ledgerSettings` block ends the payload:

```js
        ledgerSettings: {
            accountFilter: app._ledgerAccountFilter || 'all',
            dateRange: app._ledgerDateRange || 'all',
            sortKey: app._ledgerSortKey || 'date',
            sortDir: app._ledgerSortDir || 'desc'
        }
    };
```

Change to:

```js
        ledgerSettings: {
            accountFilter: app._ledgerAccountFilter || 'all',
            dateRange: app._ledgerDateRange || 'all',
            sortKey: app._ledgerSortKey || 'date',
            sortDir: app._ledgerSortDir || 'desc'
        },
        forecastSettings: {
            rangeMonths: app._forecastRangeMonths || 1,
            accountId: app._forecastAccountId || 'total',
            notableThresholdPct: app._forecastNotableThresholdPct || 130
        }
    };
```

- [x] **Step 6: Wire `forecastSettings` into `importAllJSON`**

In `importAllJSON`, after the line `const incomingLedgerSettings = clean.ledgerSettings;` (currently line 468):

```js
        const incomingLedgerSettings = clean.ledgerSettings;
```

Change to:

```js
        const incomingLedgerSettings = clean.ledgerSettings;
        const incomingForecastSettings = clean.forecastSettings;
```

Then both the "replace" branch (currently lines 507-512) and the "merge" branch (currently lines 543-548) have an identical block:

```js
            if (incomingLedgerSettings) {
                app._ledgerAccountFilter = incomingLedgerSettings.accountFilter || 'all';
                app._ledgerDateRange = incomingLedgerSettings.dateRange || 'all';
                app._ledgerSortKey = incomingLedgerSettings.sortKey || 'date';
                app._ledgerSortDir = incomingLedgerSettings.sortDir || 'desc';
            }
```

Replace **both** occurrences with:

```js
            if (incomingLedgerSettings) {
                app._ledgerAccountFilter = incomingLedgerSettings.accountFilter || 'all';
                app._ledgerDateRange = incomingLedgerSettings.dateRange || 'all';
                app._ledgerSortKey = incomingLedgerSettings.sortKey || 'date';
                app._ledgerSortDir = incomingLedgerSettings.sortDir || 'desc';
            }
            if (incomingForecastSettings) {
                app._forecastRangeMonths = incomingForecastSettings.rangeMonths || 1;
                app._forecastAccountId = incomingForecastSettings.accountId || 'total';
                app._forecastNotableThresholdPct = incomingForecastSettings.notableThresholdPct || 130;
            }
```

- [x] **Step 7: Reset forecast settings in `clearAllData`**

In `clearAllData` (currently lines 573-621), the ledger-settings reset is:

```js
    app._ledgerAccountFilter = 'all';
    app._ledgerDateRange = 'all';
    app._ledgerSortKey = 'date';
    app._ledgerSortDir = 'desc';
    app._ledgerPage = 1;
    app._ledgerPageSize = 25;
```

Change to:

```js
    app._ledgerAccountFilter = 'all';
    app._ledgerDateRange = 'all';
    app._ledgerSortKey = 'date';
    app._ledgerSortDir = 'desc';
    app._ledgerPage = 1;
    app._ledgerPageSize = 25;

    app._forecastRangeMonths = 1;
    app._forecastAccountId = 'total';
    app._forecastNotableThresholdPct = 130;
```

- [x] **Step 8: Add constructor defaults in `src/app.js`**

In the constructor (currently around line 122):

```js
        this.storageKey = 'debtTrackerData';
    this._netWorthRangeMonths = 6;

        this.initializeEventListeners();
```

Change to:

```js
        this.storageKey = 'debtTrackerData';
    this._netWorthRangeMonths = 6;
    this._forecastRangeMonths = 1;
    this._forecastAccountId = 'total';
    this._forecastNotableThresholdPct = 130;

        this.initializeEventListeners();
```

- [x] **Step 9: Run the tests to verify they pass**

Run: `pytest tests/features/test_forecast.py::test_forecast_settings_persist_after_reload tests/features/test_forecast.py::test_forecast_settings_export_import_roundtrip -v`
Expected: Both PASS

- [x] **Step 10: Run the full Forecast test file**

Run: `pytest tests/features/test_forecast.py -v`
Expected: All 10 tests PASS

- [x] **Step 11: Commit**

```bash
git add src/storage.js src/app.js tests/features/test_forecast.py
git commit -m "feat: persist Cash Flow Forecast settings"
```

---

## Task 4: Security and Smoke Test Coverage

**Files:**
- Modify: `tests/security/test_xss.py`
- Modify: `tests/integration/test_smoke.py`

- [x] **Step 1: Write the failing XSS test**

Append to `tests/security/test_xss.py`:

```python


@pytest.mark.security
async def test_xss_in_forecast_driver_name(async_app_page):
    """Test that a malicious expense name is escaped (not rendered as HTML) in
    the Cash Flow Forecast 'Driven by' note row."""
    page = async_app_page

    await page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        const targetMonths = now.getMonth() + 2;
        const year = now.getFullYear() + Math.floor(targetMonths / 12);
        const month = targetMonths % 12;
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-15`;

        app.accounts = [{ id: 9001, name: 'Checking', type: 'Checking', startingBalance: 10000 }];
        app.bills = [{ id: 10, name: 'Subscription', amount: 10, dueDay: 1, category: 'Other', accountId: 9001 }];
        app.expenses = [{
            id: 20,
            name: '<img src=x onerror="window.__xss=true">',
            amount: 1200, date: dateStr, category: 'Other', accountId: 9001
        }];
        app.incomes = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app._forecastRangeMonths = 2;
        app._forecastAccountId = 'total';
        app._forecastNotableThresholdPct = 130;
        app.switchPage('reports');
    }""")
    await page.wait_for_timeout(300)

    forecast_tab = await page.query_selector('[data-rptab="forecast"]')
    await forecast_tab.click()
    await page.wait_for_timeout(300)

    img_in_table = await page.query_selector('#reportsCashFlowForecast .nw-history-table img')
    assert img_in_table is None, "Malicious expense name was rendered as an HTML element (XSS)!"

    xss_triggered = await page.evaluate('() => window.__xss === true')
    assert not xss_triggered, "XSS payload executed via unescaped expense name!"
```

- [x] **Step 2: Run the test to verify it fails or passes**

Run: `pytest tests/security/test_xss.py::test_xss_in_forecast_driver_name -v`
Expected: PASS — `escapeHtml()` is already applied to driver names in `src/forecast.js` (Task 1, Step 5), so this test should pass immediately and serves as a regression guard.

- [x] **Step 3: Add a Forecast-tab step to the smoke test**

In `tests/integration/test_smoke.py`, `test_smoke_full_workflow` currently has (around lines 69-73):

```python
    # 6. Navigate to reports
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(500)
    reports_section = page.query_selector('#reportsSection')
    assert reports_section, "Reports section not found"
```

Change to:

```python
    # 6. Navigate to reports
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(500)
    reports_section = page.query_selector('#reportsSection')
    assert reports_section, "Reports section not found"

    # 6b. Check Cash Flow Forecast tab renders
    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(500)
    forecast_panel = page.query_selector('#reportsCashFlowForecast')
    assert forecast_panel and forecast_panel.evaluate('(el) => el.innerHTML.length > 0'), \
        "Forecast tab should render content"
```

- [x] **Step 4: Run the full security and smoke suites**

Run: `pytest tests/security/test_xss.py tests/integration/test_smoke.py -v`
Expected: All PASS

- [x] **Step 5: Run the entire test suite**

Run: `pytest -v`
Expected: All tests PASS, no console errors

- [x] **Step 6: Commit**

```bash
git add tests/security/test_xss.py tests/integration/test_smoke.py
git commit -m "test: add XSS and smoke coverage for Cash Flow Forecast"
```

---

## Self-Review

**Spec coverage:**
- Goal (project balances forward, lowest/highest, negative warning, notable months) — Task 1 (`getAccountForecastSeries`, `computeForecastStats`, `findNotableMonths`).
- Out of scope (scenario comparison) — not implemented, correctly excluded.
- `getAccountForecastSeries(app, accountId, monthsAhead)` signature and return shape — Task 1, Step 3, matches spec exactly (`label`, `income`, `outflow`, `net`, `balance`, plus `year`/`month` for projected entries).
- "Total Cash Position" (sum across non-Credit-Card/Loan accounts) — `getForecastAssetAccounts` + `computeForecastSeries`'s `'total'` branch, Task 1.
- Derived stats (current/lowest/highest/negative/notable, `notableThresholdPct` default 130) — `computeForecastStats`/`findNotableMonths`, Task 1.
- New tab `🔮 Forecast`, `data-rptab="forecast"`, `#rptPanel-forecast`, `#reportsCashFlowForecast` — Task 1, Step 4.
- `src/forecast.js` exports `renderCashFlowForecast(app)`, called from `renderReportsPage`, `_rptForecastChart` in cleanup list — Task 1, Step 6.
- Controls row (horizon buttons, account selector, threshold input) with persistence — Task 1 (rendering + `onchange` handlers), Task 2 (horizon buttons), Task 3 (persistence).
- Negative-balance warning banner — Task 1 (`cf-warning-banner`), tested in `test_forecast_negative_balance_warning`.
- Summary stat row (current/lowest/highest) — Task 1 (`nw-report-summary`/`nw-report-stat`).
- Chart (segment coloring, lowest/highest point styling, currency y-axis) — `renderForecastChart`, Task 1.
- Table (Month/Income/Outflow/Net/Ending Balance, negative row highlight, notable driver rows) — Task 1.
- Empty state — Task 1, `test_forecast_empty_state_with_no_accounts`.
- Persistence (`forecastSettings` in sanitize/save/load/export/import/clear) — Task 3.
- Testing plan items (default render, horizon switching, account dropdown, negative warning, summary stats, notable months + custom threshold, empty state, settings round-trip, XSS, smoke) — covered across Tasks 1-4.

**Placeholder scan:** No "TBD"/"TODO"/"implement later" markers; every step contains complete, runnable code.

**Type/signature consistency:**
- `getAccountForecastSeries(app, accountId, monthsAhead)` — defined in Task 1 Step 3, called identically in `forecast.js`'s `computeForecastSeries`.
- `app._forecastRangeMonths` / `app._forecastAccountId` / `app._forecastNotableThresholdPct` — same names used in `forecast.js` (Task 1), `ui.js` (Task 2), `storage.js` and `app.js` (Task 3).
- `forecastSettings: { rangeMonths, accountId, notableThresholdPct }` — identical field names across `sanitizeForecastSettings`, `saveToStorage`, `loadFromStorage`, `exportAllJSON`, `importAllJSON`.
- `getForecastAssetAccounts(app)` — defined once in `forecast.js`, used by `computeForecastSeries` and `getOutflowDrivers`.
