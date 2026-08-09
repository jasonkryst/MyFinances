# Cash Flow Trend Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a multi-month (3M/6M/12M) Income-vs-Outflow trend chart with a Net line overlay to the Reports → Money Flow tab, closing out GitHub issue #76.

**Architecture:** Extract the existing single-month income/outflow total calculation in `reportsCashFlow.js` into a reusable per-month helper, build a new multi-month series function on top of it, and render that series as a new mixed bar+line Chart.js widget below the existing single-month Money Flow chart. Range selection follows the exact button pattern already used by the Net Worth trend (`reportsNetWorth.js`).

**Tech Stack:** Vanilla ES6 modules, Chart.js 4.4.3 (CDN, already loaded), Playwright/pytest for tests. No build step — this repo ships raw `src/*.js` files loaded directly by `index.html`.

## Global Constraints

- No build step: every file edited here is loaded as-is by the browser. Don't introduce bundlers, transpilation, or new dependencies.
- Strict CSP (`index.html`): no inline `<script>`/`style="..."`, no `eval`. All HTML in this plan is static template strings assigned to `.innerHTML` using existing CSS classes — no new inline styles.
- Chart.js is already on the page as a global `Chart` (loaded via `<script>` before the ES module entry point) — don't `import` it.
- Tests assume the app is served at `http://localhost:5500/`. Start it first: `python -m http.server 5500` (run in a separate terminal/background — leave it running for every test step in this plan).
- `APP_VERSION` (`src/utils.js`) and `CHANGELOG.md`'s latest heading must always match (enforced by `tests/features/test_versioning.py`) — the version bump task must land in the same commit range as the feature, per existing convention in this repo.
- No new persisted data fields are introduced (the selected trend range is session-only state, matching `app._netWorthRangeMonths`), so no `sanitizeX()` changes are needed.

---

### Task 1: Multi-month cash flow data layer

**Files:**
- Modify: `src/reportsCashFlow.js:1-58` (add `computeMonthCashFlowTotals`, add `getCashFlowTrendSeries`, refactor `renderReportsIncomeExp` to use the new helper)
- Modify: `src/app.js:78-84` (import), `src/app.js:158` (state var — used by Task 2, harmless to add now), `src/app.js:817-819` (delegate method)
- Test: `tests/features/test_cash_flow_trend.py` (new file)

**Interfaces:**
- Produces: `computeMonthCashFlowTotals(app, year, month)` → `{ income, bills, expenses, recurring, debtMin, savings, outflow, net }` (all numbers).
- Produces: `getCashFlowTrendSeries(app, months)` → array of `{ year, month, label, income, outflow, net }`, **oldest month first**, ending at `getReportDate(app)` (i.e. respects `app._reportMonthOffset`). `month` is a 0-indexed JS month (0 = January).
- Produces: `app.getCashFlowTrendSeries(months)` — thin delegate for browser-console/test access, same signature as above minus `app`.
- Consumes: `getLedgerTransactionsForMonth(app, year, month)` (already imported in `reportsCashFlow.js`), `getReportDate(app)` (already imported).

- [ ] **Step 1: Write the failing tests**

Create `tests/features/test_cash_flow_trend.py`:

```python
#!/usr/bin/env python3
"""
Cash Flow Trend chart tests (GitHub issue #76).

getCashFlowTrendSeries(app, months) computes income/outflow/net per month,
oldest-first, ending at the currently-viewed report month
(getReportDate(app), which respects app._reportMonthOffset). These tests
exercise the data layer directly via window.app.getCashFlowTrendSeries
before any DOM rendering exists (Task 1), then the rendered widget once
renderReportsCashFlowTrend is wired in (Task 2).
"""

import pytest


@pytest.mark.feature
def test_cash_flow_trend_series_multi_month_totals(app_page):
    """getCashFlowTrendSeries(3) should return correct income/outflow/net
    per month, oldest-first, for three distinct one-time expenses landing
    in three consecutive months ending at the current report month."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth();
        const fmtMonth = (year, month) => `${year}-${String(month + 1).padStart(2, '0')}-05`;
        const d2 = new Date(y, m - 2, 1);
        const d1 = new Date(y, m - 1, 1);

        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        app.incomes = []; app.bills = []; app.debts = []; app.recurringTemplates = [];
        app.emergencyFunds = []; app.sinkingFunds = []; app.monthlySnapshots = [];
        app.expenses = [
            { id: 1, name: 'Groceries', budgetAmount: 100, date: fmtMonth(d2.getFullYear(), d2.getMonth()), category: 'Food', accountId: 1 },
            { id: 2, name: 'Groceries', budgetAmount: 200, date: fmtMonth(d1.getFullYear(), d1.getMonth()), category: 'Food', accountId: 1 },
            { id: 3, name: 'Groceries', budgetAmount: 300, date: fmtMonth(y, m), category: 'Food', accountId: 1 }
        ];
        app._reportMonthOffset = 0;
    }""")

    series = page.evaluate("() => window.app.getCashFlowTrendSeries(3)")
    assert len(series) == 3
    assert [round(mo['outflow'], 2) for mo in series] == [100, 200, 300]
    assert [round(mo['income'], 2) for mo in series] == [0, 0, 0]
    assert [round(mo['net'], 2) for mo in series] == [-100, -200, -300]


@pytest.mark.feature
def test_cash_flow_trend_series_respects_report_month_offset_year_boundary(app_page):
    """Walking the report month forward across a Dec->Jan year boundary
    should shift the 3-month trend window correctly, with no off-by-one
    on month index or year."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = []; app.debts = []; app.bills = []; app.expenses = [];
        app.incomes = []; app.recurringTemplates = []; app.emergencyFunds = [];
        app.sinkingFunds = []; app.monthlySnapshots = [];
        app._reportMonthOffset = 0;
        app.switchPage('reports');

        const now = new Date();
        window.__stepsToJan = (12 - now.getMonth()) % 12;
        if (window.__stepsToJan === 0) window.__stepsToJan = 12;
    }""")

    steps = page.evaluate('() => window.__stepsToJan')
    for _ in range(steps):
        page.click('#rptNextMonth')
        page.wait_for_timeout(150)

    series = page.evaluate("() => window.app.getCashFlowTrendSeries(3)")
    # series[2] is the anchor (report) month, which is now January.
    assert series[2]['month'] == 0
    # series[1] is the month before it: December of the prior year.
    assert series[1]['month'] == 11
    assert series[1]['year'] == series[2]['year'] - 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/features/test_cash_flow_trend.py -v`
Expected: both tests FAIL/ERROR — `window.app.getCashFlowTrendSeries` is not a function yet.

- [ ] **Step 3: Extract `computeMonthCashFlowTotals` and add `getCashFlowTrendSeries`**

In `src/reportsCashFlow.js`, replace the body of `renderReportsIncomeExp` from its start through the `net`/`netCls` computation with a call to a new extracted helper, and add the new multi-month function. Full replacement for lines 1-73:

```js
// Reports page: income/expense breakdown and money flow charts

import {
    formatCurrency,
    escapeHtml,
    getReportDate,
    renderChartDataTable
} from './utils.js';
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
        const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
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
```

This replaces the original inline totals loop (which computed the same six
`total*` variables plus `totalOutflow`/`net`/`netCls`) with calls into the
new helper. Everything from `const monthLabel = rptDate.toLocaleDateString(...)`
onward in the original file (line 62 onward) is unchanged — leave it as-is,
it already reads `totalIncome`, `totalBills`, etc., which still exist as
`const`s with the same names.

Note the import list also gained `renderChartDataTable` — it isn't used yet
in this task, but Task 2's `renderReportsCashFlowTrend` needs it and this
keeps the import edit co-located with the rest of this file's changes.

- [ ] **Step 4: Add the app.js delegate method**

In `src/app.js`, add an import near the existing `reportsNetWorth.js`/`reportsSummary.js` imports (after line 84's closing `} from './reportsSummary.js';`):

```js
import {
    getCashFlowTrendSeries as getCashFlowTrendSeriesFeature
} from './reportsCashFlow.js';
```

Then add the delegate method in the class body, right after the existing `computeReportsSummaryMetrics` method (`src/app.js:817-819`):

```js
    computeReportsSummaryMetrics(rangeType, baseDate) {
        return computeReportsSummaryMetricsFeature(this, rangeType, baseDate);
    }

    getCashFlowTrendSeries(months) {
        return getCashFlowTrendSeriesFeature(this, months);
    }
```

Also add the (currently-unused-until-Task-2) range state var right after
the existing `_netWorthRangeMonths` line (`src/app.js:158`):

```js
    this._netWorthRangeMonths = 6;
    this._cashFlowTrendRangeMonths = 6;
    this._forecastRangeMonths = 1;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/features/test_cash_flow_trend.py -v`
Expected: both tests PASS.

- [ ] **Step 6: Regression-check the existing Income vs Expenses report**

Run: `pytest tests/features/test_reports.py -v`
Expected: all existing tests still PASS — this confirms the
`renderReportsIncomeExp` refactor in Step 3 didn't change its behavior.

- [ ] **Step 7: Commit**

```bash
git add src/reportsCashFlow.js src/app.js tests/features/test_cash_flow_trend.py
git commit -m "feat: add multi-month cash flow trend data layer (#76)"
```

---

### Task 2: Cash Flow Trend widget (render + range switching)

**Files:**
- Modify: `index.html:750-753` (new container)
- Modify: `src/reportsCashFlow.js` (add `renderReportsCashFlowTrend`)
- Modify: `src/reports.js:10,39,49` (import, destroy-list, call)
- Modify: `src/ui.js:347-357` (range button click handling)
- Test: `tests/features/test_cash_flow_trend.py` (append tests)

**Interfaces:**
- Consumes: `getCashFlowTrendSeries(app, months)` and `computeMonthCashFlowTotals` (Task 1), `app._cashFlowTrendRangeMonths` (Task 1), `formatCurrency`/`renderChartDataTable` from `utils.js`.
- Produces: `renderReportsCashFlowTrend(app)` — renders into `#reportsCashFlowTrend`; DOM: `<canvas id="rptCashFlowTrendChart">`, range buttons `[data-cashflow-range="3|6|12"]`; chart instance cached on `app._rptCashFlowTrendChart`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/features/test_cash_flow_trend.py`:

```python
@pytest.mark.feature
def test_cash_flow_trend_empty_state(app_page):
    """With no income/expense/bill/debt/recurring data at all, the trend
    section should show its empty-state message and render no canvas."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = []; app.debts = []; app.bills = []; app.expenses = [];
        app.incomes = []; app.recurringTemplates = []; app.emergencyFunds = [];
        app.sinkingFunds = []; app.monthlySnapshots = [];
        app._reportMonthOffset = 0;
        app.switchPage('reports');
    }""")
    page.click('[data-rptab="moneyflow"]')
    page.wait_for_timeout(300)

    trend_text = page.query_selector('#reportsCashFlowTrend').text_content()
    assert 'Add income, bills, debts' in trend_text, \
        f"Expected empty cash flow trend state, got: {trend_text}"

    assert page.query_selector('#rptCashFlowTrendChart') is None
    assert page.console_errors == []


@pytest.mark.feature
def test_cash_flow_trend_range_switch(app_page):
    """Clicking the 3M/6M/12M range buttons updates
    app._cashFlowTrendRangeMonths, moves the 'active' class, and the
    resulting series length matches the selected range."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        app.incomes = [{ id: 1, name: 'Salary', amount: 3000, accountId: 1, frequency: 'monthly', firstPayDate: `${y}-${m}-01` }];
        app.debts = []; app.bills = []; app.expenses = []; app.recurringTemplates = [];
        app.emergencyFunds = []; app.sinkingFunds = []; app.monthlySnapshots = [];
        app._reportMonthOffset = 0;
        app.switchPage('reports');
    }""")
    page.click('[data-rptab="moneyflow"]')
    page.wait_for_timeout(300)

    assert page.evaluate("() => window.app._cashFlowTrendRangeMonths") == 6

    page.click('[data-cashflow-range="12"]')
    page.wait_for_timeout(300)

    assert page.evaluate("() => window.app._cashFlowTrendRangeMonths") == 12
    active_btn = page.query_selector('[data-cashflow-range="12"]')
    assert 'active' in active_btn.get_attribute('class')

    series = page.evaluate("() => window.app.getCashFlowTrendSeries(window.app._cashFlowTrendRangeMonths)")
    assert len(series) == 12


@pytest.mark.feature
def test_cash_flow_trend_far_future_month_renders_empty_state(app_page):
    """Navigating the report month offset far into the future (no
    underlying data) should render the trend section's empty state
    instead of crashing or showing stale numbers."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = []; app.debts = []; app.bills = []; app.expenses = [];
        app.incomes = []; app.recurringTemplates = []; app.emergencyFunds = [];
        app.sinkingFunds = []; app.monthlySnapshots = [];
        app._reportMonthOffset = 24;
        app.switchPage('reports');
    }""")
    page.click('[data-rptab="moneyflow"]')
    page.wait_for_timeout(300)

    trend_text = page.query_selector('#reportsCashFlowTrend').text_content()
    assert 'Add income, bills, debts' in trend_text
    assert page.console_errors == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/features/test_cash_flow_trend.py -v`
Expected: the three new tests FAIL — `#reportsCashFlowTrend` doesn't exist
in the DOM yet, `[data-cashflow-range]` buttons don't exist.

- [ ] **Step 3: Add the container to index.html**

In `index.html`, change (around line 750-753):

```html
                <!-- ── Money Flow panel ────────────────────────────────── -->
                <div class="rpt-tab-panel" id="rptPanel-moneyflow">
                    <div id="reportsMoneyFlow"></div>
                </div>
```

to:

```html
                <!-- ── Money Flow panel ────────────────────────────────── -->
                <div class="rpt-tab-panel" id="rptPanel-moneyflow">
                    <div id="reportsMoneyFlow"></div>
                    <div id="reportsCashFlowTrend"></div>
                </div>
```

- [ ] **Step 4: Add `renderReportsCashFlowTrend` to reportsCashFlow.js**

Append this new exported function to the end of `src/reportsCashFlow.js`
(after the existing `renderReportsMoneyFlow` function):

```js
export function renderReportsCashFlowTrend(app) {
    const container = document.getElementById('reportsCashFlowTrend');
    if (!container) return;

    const horizon = [3, 6, 12].includes(app._cashFlowTrendRangeMonths) ? app._cashFlowTrendRangeMonths : 6;
    app._cashFlowTrendRangeMonths = horizon;

    const series = getCashFlowTrendSeries(app, horizon);
    const hasData = series.some(m => m.income !== 0 || m.outflow !== 0);

    const rangeButtonsHTML = `
        <div class="nw-range-buttons" role="group" aria-label="Cash flow trend range">
            <button class="nw-range-btn ${horizon === 3 ? 'active' : ''}" data-cashflow-range="3" type="button">3M</button>
            <button class="nw-range-btn ${horizon === 6 ? 'active' : ''}" data-cashflow-range="6" type="button">6M</button>
            <button class="nw-range-btn ${horizon === 12 ? 'active' : ''}" data-cashflow-range="12" type="button">12M</button>
        </div>`;

    if (!hasData) {
        container.innerHTML = `
            <div class="nw-report-header">
                <h3>📈 Cash Flow Trend</h3>
                ${rangeButtonsHTML}
            </div>
            <p class="rpt-empty-msg">Add income, bills, debts, bonuses, expenses, or recurring items to see the cash flow trend.</p>`;
        return;
    }

    const avgIncome = series.reduce((sum, m) => sum + m.income, 0) / series.length;
    const avgOutflow = series.reduce((sum, m) => sum + m.outflow, 0) / series.length;
    const avgNet = series.reduce((sum, m) => sum + m.net, 0) / series.length;
    const avgNetCls = avgNet >= 0 ? 'rpt-net--pos' : 'rpt-net--neg';

    container.innerHTML = `
        <div class="nw-report-header">
            <h3>📈 Cash Flow Trend</h3>
            ${rangeButtonsHTML}
        </div>
        <p class="rpt-chart-sub">Income vs. outflow per month over the last ${horizon} months, with net balance overlaid.</p>
        <div class="rpt-stats-strip">
            <div class="rpt-stat rpt-stat--income"><span class="rpt-stat-label">Avg Monthly Income</span><span class="rpt-stat-value">${formatCurrency(avgIncome)}</span></div>
            <div class="rpt-stat rpt-stat--debt"><span class="rpt-stat-label">Avg Monthly Outflow</span><span class="rpt-stat-value">${formatCurrency(avgOutflow)}</span></div>
            <div class="rpt-stat ${avgNetCls}"><span class="rpt-stat-label">Avg Monthly Net</span><span class="rpt-stat-value">${formatCurrency(avgNet)}</span></div>
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
                { type: 'bar', label: 'Income', data: series.map(m => m.income), backgroundColor: '#10b981', borderRadius: 4, order: 2 },
                { type: 'bar', label: 'Outflow', data: series.map(m => m.outflow), backgroundColor: '#ef4444', borderRadius: 4, order: 2 },
                { type: 'line', label: 'Net', data: series.map(m => m.net), borderColor: '#2563eb', backgroundColor: 'transparent', tension: 0.3, pointRadius: 3, borderWidth: 2.5, order: 1 }
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
        caption: `Cash flow trend — income, outflow, and net per month over the last ${horizon} months`,
        columns: ['Month', 'Income', 'Outflow', 'Net'],
        rows: series.map(m => [m.label, fmt(m.income), fmt(m.outflow), fmt(m.net)])
    });
}
```

- [ ] **Step 5: Wire it into reports.js**

In `src/reports.js`, change the import on line 10 from:

```js
import { renderReportsIncomeExp, renderReportsMoneyFlow } from './reportsCashFlow.js';
```

to:

```js
import { renderReportsIncomeExp, renderReportsMoneyFlow, renderReportsCashFlowTrend } from './reportsCashFlow.js';
```

Change the chart-destroy list on line 39 from:

```js
    ['_rptIncomeChart', '_rptBillsChart', '_rptExpChart', '_rptMoneyFlowChart', '_rptOutflowChart', '_rptNetWorthTrendChart', '_rptNetWorthCompositionChart', '_rptForecastChart', '_rptSpendingPieChart', '_rptSpendingBarChart']
```

to:

```js
    ['_rptIncomeChart', '_rptBillsChart', '_rptExpChart', '_rptMoneyFlowChart', '_rptOutflowChart', '_rptCashFlowTrendChart', '_rptNetWorthTrendChart', '_rptNetWorthCompositionChart', '_rptForecastChart', '_rptSpendingPieChart', '_rptSpendingBarChart']
```

Change lines 48-49 from:

```js
    renderReportsIncomeExp(app);
    renderReportsMoneyFlow(app);
```

to:

```js
    renderReportsIncomeExp(app);
    renderReportsMoneyFlow(app);
    renderReportsCashFlowTrend(app);
```

- [ ] **Step 6: Wire the range buttons in ui.js**

In `src/ui.js`, insert a new `data-cashflow-range` branch right after the
existing `data-networth-range` branch and its blank line (between line 356's
closing `}` and line 358's `const forecastRangeBtn = ...`):

```js
        const rangeBtn = event.target.closest('[data-networth-range]');
        if (rangeBtn) {
            const nextRange = parseInt(rangeBtn.getAttribute('data-networth-range'), 10);
            if ([3, 6, 12].includes(nextRange)) {
                app._netWorthRangeMonths = nextRange;
                app.renderReportsPage();
            }
            return;
        }

        const cashFlowRangeBtn = event.target.closest('[data-cashflow-range]');
        if (cashFlowRangeBtn) {
            const nextRange = parseInt(cashFlowRangeBtn.getAttribute('data-cashflow-range'), 10);
            if ([3, 6, 12].includes(nextRange)) {
                app._cashFlowTrendRangeMonths = nextRange;
                app.renderReportsPage();
            }
            return;
        }

        const forecastRangeBtn = event.target.closest('[data-forecast-range]');
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pytest tests/features/test_cash_flow_trend.py -v`
Expected: all 5 tests PASS.

- [ ] **Step 8: Full regression check**

Run: `pytest tests/features/test_reports.py tests/features/test_reports_nav_groups.py tests/ui/ -v`
Expected: all PASS — confirms the new container/range-button click handling
didn't break the Net Worth range buttons, the Forecast range buttons, or
any other Reports-page or general UI behavior.

- [ ] **Step 9: Manual smoke check in the browser**

Start the server if it isn't already running (`python -m http.server 5500`),
open `http://localhost:5500/`, add a couple of income/expense/bill entries
spanning a few months (or use existing seed data), navigate to
Reports → Money Flow, and confirm: the new "Cash Flow Trend" section
appears below the existing single-month chart, the 3M/6M/12M buttons switch
the chart's data and highlight correctly, and dark mode (toggle via
Settings) renders the chart with readable label/grid colors.

- [ ] **Step 10: Commit**

```bash
git add index.html src/reportsCashFlow.js src/reports.js src/ui.js tests/features/test_cash_flow_trend.py
git commit -m "feat: render cash flow trend chart with 3M/6M/12M range switching (#76)"
```

---

### Task 3: Version bump and changelog

**Files:**
- Modify: `src/utils.js:4`
- Modify: `CHANGELOG.md` (top of file)
- Test: `tests/features/test_versioning.py` (existing — no changes needed)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by other tasks — this is the final documentation step.

- [ ] **Step 1: Confirm the versioning test currently passes against the unmodified files**

Run: `pytest tests/features/test_versioning.py -v`
Expected: PASS (both files already match at `4.13.0` before this task's edits).

- [ ] **Step 2: Bump APP_VERSION**

In `src/utils.js`, change line 4 from:

```js
export const APP_VERSION = '4.13.0';
```

to:

```js
export const APP_VERSION = '4.14.0';
```

- [ ] **Step 3: Add the changelog entry**

In `CHANGELOG.md`, insert a new entry directly above the existing
`## [4.13.0] — 2026-08-06` heading:

```markdown
## [4.14.0] — 2026-08-09

### Added
- **Cash Flow Trend chart** — new multi-month (3M/6M/12M) view on the Reports → Money Flow tab, showing Income vs. Outflow per month as bars with a Net balance line overlaid, alongside the existing single-month Money Flow chart. Reuses the ledger-derived per-month totals that already power the Income vs Expenses report, so the two stay consistent. (#76)

---
```

- [ ] **Step 4: Run the versioning test to verify it still passes**

Run: `pytest tests/features/test_versioning.py -v`
Expected: PASS — `APP_VERSION` (`4.14.0`) now matches `CHANGELOG.md`'s new
latest heading (`4.14.0`).

- [ ] **Step 5: Full test suite run**

Run: `pytest tests/ -v -m "not slow"`
Expected: all PASS (this is the final full-suite gate before considering
the feature done).

- [ ] **Step 6: Commit**

```bash
git add src/utils.js CHANGELOG.md
git commit -m "chore: bump version to 4.14.0 for cash flow trend chart (#76)"
```

---

## Self-Review Notes

- **Spec coverage:** Data layer (spec §"Multi-month series") → Task 1. Render
  function, container placement, range buttons, wiring in `app.js`/`ui.js`/
  `reports.js` (spec §"Render function", §"Wiring") → Task 2. Empty state and
  far-future/year-boundary edge cases (spec §"Error handling / edge cases")
  → covered by tests in Task 1 (year boundary) and Task 2 (empty state,
  far-future). Version bump + changelog (spec §"Documentation") → Task 3.
  No spec section is without a corresponding task.
- **Placeholder scan:** no TBDs; every step has literal code or an exact
  runnable command.
- **Type/name consistency:** `computeMonthCashFlowTotals` and
  `getCashFlowTrendSeries` are defined once in Task 1 and consumed with the
  same names/signatures in Task 2 (`renderReportsCashFlowTrend` calls
  `getCashFlowTrendSeries(app, horizon)`) and in the app.js delegate
  (`getCashFlowTrendSeriesFeature`). `app._cashFlowTrendRangeMonths` is
  declared in Task 1, read/written in Task 2's render function and click
  handler — same name throughout.
