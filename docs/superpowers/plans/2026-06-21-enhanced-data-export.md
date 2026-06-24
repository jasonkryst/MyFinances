# Enhanced Data Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add print-to-PDF Reports support, a printable Monthly/Yearly Summary Report tab, per-chart PNG export buttons (all 17 Chart.js canvases), and a custom-column CSV export for the Ledger — with zero new dependencies.

**Architecture:** Pure client-side, vanilla-JS additions following the existing `appFn(app, ...)` module pattern. A `@media print` stylesheet plus a "Print / Save as PDF" button drives both the print-friendly Reports view and PDF generation (no PDF library). `Chart.js`'s built-in `toBase64Image()` drives PNG export (no image library). CSV export reuses the existing `csvField()` quoting helper in `storage.js`.

**Tech Stack:** Vanilla ES6+ JS, Chart.js 4.4.3 (already loaded), `localStorage`, Playwright + pytest for tests.

## Global Constraints

- No new runtime dependencies, no new CSP origins (`script-src 'self' https://cdn.jsdelivr.net`, `style-src 'self'`).
- No inline `<script>`, no inline `style="..."` attributes — dynamic styling via CSS classes/custom-properties only.
- Every feature-module function takes `app` as its first argument; `DebtTrackerApp` (`app.js`) gets a one-line delegating method for each new public function, per `CLAUDE.md`.
- All user-supplied data rendered via `innerHTML` must go through `escapeHtml()`.
- `app.settings` is a flat `{ key, value }` array (`src/settings.js`); values must be `boolean`, `number`, or a `string` ≤200 chars per the existing generic `sanitizeSetting()` in `storage.js` — reuse `getSetting`/`setSetting`, do not invent a new persisted top-level field.
- Tests are Playwright (`tests/ui`, `tests/integration`) and Playwright-backed pytest (`tests/features`, `tests/security`, `tests/a11y`) driven against `http://localhost:5500/` — there is no separate JS unit-test runner. Start the server (`python -m http.server 5500`) before running tests.
- Run the full relevant test file after each task; do not move on with red tests.

---

### Task 1: Chart PNG export helper + wire into `charts.js`

**Files:**
- Modify: `src/utils.js` (add `addChartImageExportButton`)
- Modify: `styles.css` (add `.chart-export-toolbar` / `.chart-export-btn`, and the print-hide rule for them — print rule lands in Task 8, just leave a class hook here)
- Modify: `src/charts.js:48-76` (balanceChart), `:78-105` (pieChart), `:148-170` (progressChart), `:242-303` (debtDistributionChart), `:305-...` (debtToIncomeChart)
- Test: `tests/ui/test_charts.py`

**Interfaces:**
- Produces: `addChartImageExportButton(canvasId: string, chart: Chart, filename: string): void` exported from `src/utils.js`. Call once, immediately after each `new Chart(...)` assignment, passing the same `canvasId` used for the canvas element and a short kebab-case `filename` (no extension/date — the helper appends `-YYYY-MM-DD.png`).

- [ ] **Step 1: Write the failing test**

Add to `tests/ui/test_charts.py` (create the assertions at the end of the file; check existing imports first and reuse them):

```python
@pytest.mark.ui
def test_balance_chart_has_png_export_button(app_page, debt_data):
    """The debt balance chart on the Liabilities page shows a PNG export
    button that triggers a download when clicked."""
    page = app_page
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.click('#debtFormToggle')
    page.fill('#debtName', debt_data["name"])
    page.select_option('#debtType', debt_data["type"])
    page.fill('#accountBalance', debt_data["balance"])
    page.fill('#interestRate', debt_data["interest_rate"])
    page.fill('#minimumPayment', debt_data["min_payment"])
    page.fill('#dueDate', '15')
    page.click('#debtFormSubmit')
    page.wait_for_selector(f'text={debt_data["name"]}', timeout=10000)

    btn = page.query_selector('#balanceChart-export-btn')
    assert btn, "Expected a PNG export button next to the balance chart"
    assert btn.get_attribute('aria-label')

    with page.expect_download() as download_info:
        btn.click()
    download = download_info.value
    assert download.suggested_filename.endswith('.png')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/ui/test_charts.py::test_balance_chart_has_png_export_button -v`
Expected: FAIL — `#balanceChart-export-btn` not found.

- [ ] **Step 3: Implement `addChartImageExportButton` in `src/utils.js`**

Add near `renderChartDataTable` (after its closing brace, around line 91):

```javascript
// Insert a small "download as PNG" button above a Chart.js canvas. Idempotent
// across re-renders: removes any toolbar it previously inserted for this canvas.
export function addChartImageExportButton(canvasId, chart, filename) {
    const canvas = document.getElementById(canvasId);
    const host = canvas ? canvas.parentElement : null;
    if (!host || !chart) return;

    const btnId = `${canvasId}-export-btn`;
    const existingBtn = document.getElementById(btnId);
    if (existingBtn) {
        const toolbar = existingBtn.closest('.chart-export-toolbar');
        if (toolbar) toolbar.remove();
    }

    host.insertAdjacentHTML('afterbegin', `
        <div class="chart-export-toolbar">
            <button type="button" class="chart-export-btn" id="${btnId}" aria-label="Download chart as PNG image">⬇️ PNG</button>
        </div>
    `);

    document.getElementById(btnId).addEventListener('click', () => {
        const url = chart.toBase64Image('image/png', 1);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}-${new Date().toISOString().split('T')[0]}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });
}
```

Add to `styles.css` (end of file, new section):

```css
/* ── Chart PNG export ───────────────────────────────────────────────────── */
.chart-export-toolbar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 6px;
}
.chart-export-btn {
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 0.78rem;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.2s ease;
}
.chart-export-btn:hover {
    color: var(--text-color);
    border-color: var(--primary-color);
}
```

In `src/charts.js`, add one call after each chart is created:

```javascript
// after: app.balanceChart = new Chart(ctx, { ... });
addChartImageExportButton('balanceChart', app.balanceChart, 'debt-balance-chart');
```
```javascript
// after: app.pieChart = new Chart(canvas.getContext('2d'), { ... });
addChartImageExportButton('pieChart', app.pieChart, 'principal-vs-interest-chart');
```
```javascript
// after: app.progressChart = new Chart(ctx, { ... });
addChartImageExportButton('progressChart', app.progressChart, 'payoff-progress-chart');
```
```javascript
// after: app.debtDistributionChart = new Chart(canvas.getContext('2d'), { ... });
addChartImageExportButton('debtDistributionChart', app.debtDistributionChart, 'debt-distribution-chart');
```
```javascript
// after: app.debtToIncomeChart = new Chart(canvas.getContext('2d'), { ... });
addChartImageExportButton('debtToIncomeChart', app.debtToIncomeChart, 'debt-to-income-chart');
```

Add the import at the top of `src/charts.js` (extend the existing `from './utils.js'` import, or add a new one if `charts.js` doesn't already import from `utils.js` — check first):

```javascript
import { addChartImageExportButton } from './utils.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/ui/test_charts.py::test_balance_chart_has_png_export_button -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils.js src/charts.js styles.css tests/ui/test_charts.py
git commit -m "feat: add PNG export button to debt charts (charts.js)"
```

---

### Task 2: Wire chart PNG export into `bills.js`

**Files:**
- Modify: `src/bills.js:312-380` (`renderCashFlowCharts` — `cashflowDonutChart`, `cashflowBarChart`)
- Test: `tests/ui/test_charts.py`

**Interfaces:**
- Consumes: `addChartImageExportButton(canvasId, chart, filename)` from Task 1.

- [ ] **Step 1: Write the failing test**

```python
@pytest.mark.ui
def test_cashflow_donut_chart_has_png_export_button(app_page, income_data, debt_data):
    """The Budget page's cash flow donut chart has a PNG export button."""
    page = app_page
    page.click('button[data-page="income"]')
    page.fill('#incomeName', income_data["name"])
    page.fill('#incomeAmount', income_data["amount"])
    page.fill('#incomeFirstDate', income_data["first_date"])
    page.select_option('#incomeFrequency', income_data["frequency"])
    page.click('button:has-text("Add Income")')
    page.wait_for_selector(f'text={income_data["name"]}', timeout=10000)

    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="budget"]')
    page.wait_for_timeout(300)
    charts_tab = page.query_selector('.cashflow-tab[data-tab="charts"]')
    if charts_tab:
        charts_tab.click()
        page.wait_for_timeout(300)

    btn = page.query_selector('#cashflowDonutChart-export-btn')
    assert btn, "Expected a PNG export button next to the cash flow donut chart"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/ui/test_charts.py::test_cashflow_donut_chart_has_png_export_button -v`
Expected: FAIL — button not found.

- [ ] **Step 3: Implement**

In `src/bills.js`, add the import:

```javascript
import { addChartImageExportButton } from './utils.js';
```

After the `app._cashflowDonutChart = new Chart(donutCanvas, { ... });` block (inside the `if (donutCanvas) { ... }` block, right after the closing `});` of `new Chart`):

```javascript
addChartImageExportButton('cashflowDonutChart', app._cashflowDonutChart, 'cashflow-breakdown-chart');
```

After the `app._cashflowBarChart = new Chart(barCanvas, { ... });` block (inside its `if (barCanvas) { ... }` block):

```javascript
addChartImageExportButton('cashflowBarChart', app._cashflowBarChart, 'cashflow-by-category-chart');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/ui/test_charts.py::test_cashflow_donut_chart_has_png_export_button -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bills.js tests/ui/test_charts.py
git commit -m "feat: add PNG export button to cash flow charts (bills.js)"
```

---

### Task 3: Wire chart PNG export into `reports.js`

**Files:**
- Modify: `src/reports.js` — `rptIncomeChart`, `rptOutflowChart` (in `renderReportsIncomeExp`, ~lines 740-790), `rptMoneyFlowChart` (in `renderReportsMoneyFlow`, ~line 876), `rptNetWorthTrendChart` (~line 301, already has `renderChartDataTable` — add the button call right after it), `rptNetWorthCompositionChart` (~line 351)
- Test: `tests/ui/test_charts.py`

**Interfaces:**
- Consumes: `addChartImageExportButton(canvasId, chart, filename)` from Task 1.

- [ ] **Step 1: Write the failing test**

```python
@pytest.mark.ui
def test_reports_income_chart_has_png_export_button(app_page, income_data):
    """The Reports > Income vs Expenses panel's income chart has a PNG export button."""
    page = app_page
    page.click('button[data-page="income"]')
    page.fill('#incomeName', income_data["name"])
    page.fill('#incomeAmount', income_data["amount"])
    page.fill('#incomeFirstDate', income_data["first_date"])
    page.select_option('#incomeFrequency', income_data["frequency"])
    page.click('button:has-text("Add Income")')
    page.wait_for_selector(f'text={income_data["name"]}', timeout=10000)

    page.click('button[data-page="reports"]')
    page.click('[data-rptab="incomeexp"]')
    page.wait_for_timeout(300)

    btn = page.query_selector('#rptIncomeChart-export-btn')
    assert btn, "Expected a PNG export button next to the Reports income chart"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/ui/test_charts.py::test_reports_income_chart_has_png_export_button -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add to the existing `src/reports.js` import from `./utils.js` (line 3-8):

```javascript
import {
    getIncomePaydaysInMonth,
    formatCurrency,
    escapeHtml,
    renderChartDataTable,
    addChartImageExportButton
} from './utils.js';
```

After `app._rptIncomeChart = new Chart(cvs, { ... });` (inside its `if (cvs) { ... }` block in `renderReportsIncomeExp`):

```javascript
addChartImageExportButton('rptIncomeChart', app._rptIncomeChart, 'income-by-source-chart');
```

After `app._rptOutflowChart = new Chart(cvs, { ... });` (the second `if (cvs) { ... }` block, same function):

```javascript
addChartImageExportButton('rptOutflowChart', app._rptOutflowChart, 'outflow-by-category-chart');
```

After the `new Chart(cvs, { ... plugins: [{ id: 'todayLine', ... }] });` assignment to `app._rptMoneyFlowChart` in `renderReportsMoneyFlow`:

```javascript
addChartImageExportButton('rptMoneyFlowChart', app._rptMoneyFlowChart, 'money-flow-chart');
```

Right after the existing `renderChartDataTable('rptNetWorthTrendChart', { ... });` call in `renderReportsNetWorth`:

```javascript
addChartImageExportButton('rptNetWorthTrendChart', app._rptNetWorthTrendChart, 'net-worth-trend-chart');
```

After `app._rptNetWorthCompositionChart = new Chart(compCanvas, { ... });` (same function, the second chart block):

```javascript
addChartImageExportButton('rptNetWorthCompositionChart', app._rptNetWorthCompositionChart, 'net-worth-composition-chart');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/ui/test_charts.py::test_reports_income_chart_has_png_export_button -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/reports.js tests/ui/test_charts.py
git commit -m "feat: add PNG export button to Reports page charts"
```

---

### Task 4: Wire chart PNG export into `spending.js`, `forecast.js`, `health.js`

**Files:**
- Modify: `src/spending.js:180-243` (`rptSpendingPieChart`, `rptSpendingBarChart`)
- Modify: `src/forecast.js:137-196` (`cfForecastChart`)
- Modify: `src/health.js:371-380` (`renderGauge` — covers both `healthDtiGauge` and `healthSavingsGauge` via one shared helper)
- Test: `tests/ui/test_charts.py`

**Interfaces:**
- Consumes: `addChartImageExportButton(canvasId, chart, filename)` from Task 1.

- [ ] **Step 1: Write the failing test**

```python
@pytest.mark.ui
def test_health_dti_gauge_has_png_export_button(app_page, health_data):
    """The Health dashboard's Debt-to-Income gauge has a PNG export button."""
    page = app_page
    page.evaluate("""(data) => {
        const app = window.app;
        app.incomes = [data.income];
        app.debts = [data.debt];
        app.bills = [data.bill];
        app.accounts = [];
        app.switchPage('health');
    }""", health_data)
    page.wait_for_timeout(300)

    btn = page.query_selector('#healthDtiGauge-export-btn')
    assert btn, "Expected a PNG export button next to the DTI gauge"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/ui/test_charts.py::test_health_dti_gauge_has_png_export_button -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/spending.js`, add `addChartImageExportButton` to the existing `utils.js` import. After `app._rptSpendingPieChart = new Chart(pieCvs, { ... });`:

```javascript
addChartImageExportButton('rptSpendingPieChart', app._rptSpendingPieChart, 'spending-by-category-chart');
```

After `app._rptSpendingBarChart = new Chart(barCvs, { ... });`:

```javascript
addChartImageExportButton('rptSpendingBarChart', app._rptSpendingBarChart, 'spending-trend-chart');
```

In `src/forecast.js`, add `addChartImageExportButton` to the existing `utils.js` import. Right after the existing `renderChartDataTable('cfForecastChart', { ... });` call:

```javascript
addChartImageExportButton('cfForecastChart', app._rptForecastChart, 'cash-flow-forecast-chart');
```

In `src/health.js`, add `addChartImageExportButton` to the existing `utils.js` import. In `renderGauge(app, chartKey, canvasId, pct, statusCls, bgColor)`, after `app[chartKey] = new Chart(canvas, { ... });`:

```javascript
addChartImageExportButton(canvasId, app[chartKey], canvasId);
```

(Using `canvasId` itself as the filename is fine here — `healthDtiGauge` / `healthSavingsGauge` are already descriptive.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/ui/test_charts.py::test_health_dti_gauge_has_png_export_button -v`
Expected: PASS

- [ ] **Step 5: Run the full chart test file**

Run: `pytest tests/ui/test_charts.py -v`
Expected: All PASS (including the 3 tests added in Tasks 1-4).

- [ ] **Step 6: Commit**

```bash
git add src/spending.js src/forecast.js src/health.js tests/ui/test_charts.py
git commit -m "feat: add PNG export button to spending, forecast, and health charts"
```

---

### Task 5: Print stylesheet + "Print / Save as PDF" button on Reports page

**Files:**
- Modify: `styles.css` (new `@media print` block)
- Modify: `index.html:648-652` (add `#rptPrintBtn` to `.rpt-month-nav`)
- Modify: `src/ui.js:310-318` (wire the click handler)
- Test: `tests/ui/test_reports_actions.py`

**Interfaces:**
- Produces: clicking `#rptPrintBtn` calls `window.print()`.

- [ ] **Step 1: Write the failing test**

Add to `tests/ui/test_reports_actions.py`:

```python
@pytest.mark.ui
def test_reports_print_button_calls_window_print(app_page):
    """The Reports page Print button invokes window.print()."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    page.evaluate("() => { window.__printCalled = false; window.print = () => { window.__printCalled = true; }; }")
    page.click('#rptPrintBtn')
    page.wait_for_timeout(100)

    assert page.evaluate('() => window.__printCalled') is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/ui/test_reports_actions.py::test_reports_print_button_calls_window_print -v`
Expected: FAIL — `#rptPrintBtn` not found.

- [ ] **Step 3: Implement**

In `index.html`, update the month-nav block (lines 648-652):

```html
<!-- Month pagination -->
<div class="rpt-month-nav">
    <button class="rpt-month-btn" id="rptPrevMonth" title="Previous month">&#8249;</button>
    <span class="rpt-month-label" id="rptMonthLabel"></span>
    <button class="rpt-month-btn" id="rptNextMonth" title="Next month">&#8250;</button>
    <button class="rpt-month-btn rpt-print-btn" id="rptPrintBtn" type="button" title="Print or save this report as a PDF" aria-label="Print or save this report as a PDF">🖨️ Print</button>
</div>
```

In `src/ui.js`, after the `rptNextMonth` wiring (line 317), add:

```javascript
const rptPrintBtn = document.getElementById('rptPrintBtn');
if (rptPrintBtn) {
    rptPrintBtn.addEventListener('click', () => window.print());
}
```

In `styles.css`, add at the end of the file:

```css
/* ── Print stylesheet (Reports page) ────────────────────────────────────── */
@media print {
    header, nav.top-nav, .chart-export-toolbar, .rpt-tab-bar,
    .rpt-month-btn, button, select, input, .nw-range-buttons,
    .filter-controls, .ledger-pagination {
        display: none !important;
    }
    .page-section { display: none !important; }
    .page-section.active { display: block !important; }
    .rpt-tab-panel { display: none !important; }
    .rpt-tab-panel.rpt-tab-panel--active { display: block !important; }
    body {
        background: white !important;
        color: black !important;
    }
    .rpt-chart-card, .nw-history-card, .acct-mf-section {
        border: 1px solid #ccc !important;
        box-shadow: none !important;
        page-break-inside: avoid;
    }
    .rpt-chart-canvas-wrap, .rpt-moneyflow-wrap {
        height: 320px !important;
    }
    .rpt-month-label {
        font-size: 1.2rem;
        font-weight: 700;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/ui/test_reports_actions.py::test_reports_print_button_calls_window_print -v`
Expected: PASS

- [ ] **Step 5: Add an a11y check for the new button**

Add to `tests/a11y/test_a11y_audit.py` (check the file's existing structure first and follow its pattern — likely a list of selectors checked for `aria-label`/role):

```python
@pytest.mark.a11y
def test_reports_print_button_has_accessible_label(app_page):
    """#rptPrintBtn must have a non-empty aria-label for screen readers."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)
    btn = page.query_selector('#rptPrintBtn')
    assert btn
    label = btn.get_attribute('aria-label')
    assert label and len(label.strip()) > 0
```

- [ ] **Step 6: Run the a11y test**

Run: `pytest tests/a11y/test_a11y_audit.py::test_reports_print_button_has_accessible_label -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add styles.css index.html src/ui.js tests/ui/test_reports_actions.py tests/a11y/test_a11y_audit.py
git commit -m "feat: add print stylesheet and Print/Save-as-PDF button to Reports page"
```

---

### Task 6: Summary Report tab — markup, navigation, and cash-flow metrics

**Files:**
- Modify: `index.html:655-712` (add a "Print" tab group + `rptPanel-summary` panel)
- Modify: `src/reports.js` (export `getSnapshotSeries`, add `computeReportsSummaryMetrics`, add `renderReportsSummary`, call it from `renderReportsPage`)
- Modify: `src/app.js` (delegate `computeReportsSummaryMetrics`)
- Modify: `src/ui.js` (delegated click handler for the Monthly/Yearly toggle)
- Test: `tests/features/test_reports.py`, `tests/ui/test_reports_actions.py`

**Interfaces:**
- Produces: `export function computeReportsSummaryMetrics(app, rangeType, baseDate = getReportDate(app))` in `src/reports.js`, returning `{ rangeType, periodLabel, cashFlow: { income, bills, expenses, recurring, debtMin, savings, net }, accounts: [...], netWorth: {...} | null }`. Delegated as `app.computeReportsSummaryMetrics(rangeType, baseDate)`.
- Produces: `export function renderReportsSummary(app)` — reads `app._reportSummaryRange` (`'month' | 'year'`, default `'month'`), renders into `#reportsSummary`.
- Consumes: `getLedgerTransactionsForMonth(app, year, month)` (existing, from `ledger.js`), `app.computeAccountBalance(accountId, year, month)` (existing).

- [ ] **Step 1: Write the failing test (metrics calculation)**

Add to `tests/features/test_reports.py` (check existing imports/fixtures in the file first):

```python
@pytest.mark.feature
def test_summary_metrics_month_cash_flow():
    """computeReportsSummaryMetrics('month') sums one month's income/outflow
    correctly for a simple fixture."""
    pass  # placeholder removed below — see Step 1b
```

Replace with the real test (do not leave a placeholder — write it fully):

```python
@pytest.mark.feature
def test_summary_metrics_month_cash_flow(app_page):
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0');
        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        app.incomes = [{ id: 2, name: 'Salary', amount: 3000, accountId: 1, frequency: 'monthly', firstDate: `${y}-${m}-01` }];
        app.bills = [{ id: 3, name: 'Rent', amount: 1200, dueDay: 1, category: 'Housing', accountId: 1 }];
        app.debts = []; app.expenses = []; app.bonuses = []; app.recurringTemplates = [];
        app.emergencyFunds = []; app.sinkingFunds = []; app.monthlySnapshots = [];
    }""")
    metrics = page.evaluate("() => window.app.computeReportsSummaryMetrics('month')")
    assert metrics['cashFlow']['income'] == 3000
    assert metrics['cashFlow']['bills'] == 1200
    assert metrics['cashFlow']['net'] == 1800
    assert metrics['rangeType'] == 'month'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/features/test_reports.py::test_summary_metrics_month_cash_flow -v`
Expected: FAIL — `computeReportsSummaryMetrics` is not a function.

- [ ] **Step 3: Implement `computeReportsSummaryMetrics` and `renderReportsSummary` in `src/reports.js`**

Change `getSnapshotSeries` (line 68) from a private function to an exported one (no logic change, just add `export`):

```javascript
export function getSnapshotSeries(app, months = 12) {
```

Add the new exported function after `renderReportsVariance` (end of file, after line 1075):

```javascript
export function computeReportsSummaryMetrics(app, rangeType, baseDate = getReportDate(app)) {
    const year = baseDate.getFullYear();
    const months = rangeType === 'year' ? Array.from({ length: 12 }, (_, m) => m) : [baseDate.getMonth()];

    let income = 0, bills = 0, expenses = 0, recurring = 0, debtMin = 0, savings = 0;
    for (const m of months) {
        const txs = getLedgerTransactionsForMonth(app, year, m);
        for (const tx of txs) {
            if (tx.type === 'income' || tx.type === 'bonus') {
                income += tx.amount;
            } else if (tx.type === 'bill') {
                bills += Math.abs(tx.amount || 0);
            } else if (tx.type === 'expense') {
                expenses += Math.abs(tx.amount || 0);
            } else if (tx.type === 'recurring') {
                if (tx.amount >= 0) income += tx.amount;
                else recurring += Math.abs(tx.amount);
            } else if (tx.type === 'debt') {
                debtMin += Math.abs(tx.amount || 0);
            } else if (tx.type === 'savings') {
                savings += Math.abs(tx.amount || 0);
            }
        }
    }
    const net = income - (bills + expenses + recurring + debtMin + savings);

    const endMonth = rangeType === 'year' ? 11 : baseDate.getMonth();
    const accounts = (app.accounts || []).map(a => {
        const startBalance = Number(a.startingBalance) || 0;
        const endBalance = app.computeAccountBalance(a.id, year, endMonth);
        return {
            id: a.id,
            name: a.name,
            type: a.type,
            startBalance: parseFloat(startBalance.toFixed(2)),
            endBalance: parseFloat(endBalance.toFixed(2)),
            change: parseFloat((endBalance - startBalance).toFixed(2))
        };
    });

    const endMonthKey = `${year}-${String(endMonth + 1).padStart(2, '0')}`;
    const series = getSnapshotSeries(app, 240);
    const endSnapshot = series.find(s => String(s.date).slice(0, 7) === endMonthKey) || null;
    const startMonthKey = rangeType === 'year' ? `${year}-01` : endMonthKey;
    const startSnapshot = rangeType === 'year'
        ? (series.find(s => String(s.date).slice(0, 7) === startMonthKey) || null)
        : ([...series].reverse().find(s => String(s.date).slice(0, 7) < endMonthKey) || null);

    const netWorth = endSnapshot ? {
        netWorth: endSnapshot.netWorth,
        totalAssets: endSnapshot.totalAssets,
        totalLiabilities: endSnapshot.totalLiabilities,
        netChange: startSnapshot ? parseFloat((endSnapshot.netWorth - startSnapshot.netWorth).toFixed(2)) : null,
        assetGrowth: startSnapshot ? parseFloat((endSnapshot.totalAssets - startSnapshot.totalAssets).toFixed(2)) : null,
        debtDrop: startSnapshot ? parseFloat((startSnapshot.totalLiabilities - endSnapshot.totalLiabilities).toFixed(2)) : null
    } : null;

    return {
        rangeType,
        periodLabel: rangeType === 'year' ? String(year) : baseDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        cashFlow: {
            income: parseFloat(income.toFixed(2)),
            bills: parseFloat(bills.toFixed(2)),
            expenses: parseFloat(expenses.toFixed(2)),
            recurring: parseFloat(recurring.toFixed(2)),
            debtMin: parseFloat(debtMin.toFixed(2)),
            savings: parseFloat(savings.toFixed(2)),
            net: parseFloat(net.toFixed(2))
        },
        accounts,
        netWorth
    };
}

export function renderReportsSummary(app) {
    const container = document.getElementById('reportsSummary');
    if (!container) return;

    const rangeType = app._reportSummaryRange === 'year' ? 'year' : 'month';
    app._reportSummaryRange = rangeType;
    const metrics = computeReportsSummaryMetrics(app, rangeType);
    const cf = metrics.cashFlow;
    const netCls = cf.net >= 0 ? 'rpt-net--pos' : 'rpt-net--neg';

    const cashFlowRows = [
        ['Income', cf.income],
        ['Bills', cf.bills],
        ['Expense Budgets', cf.expenses],
        ['Recurring Costs', cf.recurring],
        ['Debt Minimums', cf.debtMin],
        ['Savings Contributions', cf.savings]
    ].map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td class="text-right">${formatCurrency(value)}</td></tr>`).join('');

    const accountRows = metrics.accounts.length === 0
        ? '<tr><td colspan="3" class="text-center text-muted-secondary">No accounts yet.</td></tr>'
        : metrics.accounts.map(a => `
            <tr>
                <td>${escapeHtml(a.name)}</td>
                <td class="text-right">${formatCurrency(a.startBalance)}</td>
                <td class="text-right">${formatCurrency(a.endBalance)}</td>
                <td class="text-right ${a.change >= 0 ? 'rpt-net--pos' : 'rpt-net--neg'}">${a.change >= 0 ? '+' : ''}${formatCurrency(a.change)}</td>
            </tr>`).join('');

    const netWorthSection = metrics.netWorth ? `
        <h4 class="rpt-section-title">Net Worth</h4>
        <table class="nw-history-table">
            <tbody>
                <tr><td>Net Worth</td><td class="text-right">${formatCurrency(metrics.netWorth.netWorth)}</td></tr>
                <tr><td>Total Assets</td><td class="text-right">${formatCurrency(metrics.netWorth.totalAssets)}</td></tr>
                <tr><td>Total Liabilities</td><td class="text-right">${formatCurrency(metrics.netWorth.totalLiabilities)}</td></tr>
                ${metrics.netWorth.netChange !== null ? `<tr><td>Net Change</td><td class="text-right">${formatCurrency(metrics.netWorth.netChange)}</td></tr>` : ''}
                ${metrics.netWorth.debtDrop !== null ? `<tr><td>Debt Reduction</td><td class="text-right">${formatCurrency(metrics.netWorth.debtDrop)}</td></tr>` : ''}
            </tbody>
        </table>` : '<p class="rpt-empty-msg">No net worth snapshot recorded for this period yet.</p>';

    container.innerHTML = `
        <div class="nw-report-header">
            <h3>Summary Report — ${escapeHtml(metrics.periodLabel)}</h3>
            <div class="nw-range-buttons" role="group" aria-label="Summary report range">
                <button class="nw-range-btn ${rangeType === 'month' ? 'active' : ''}" data-rpt-summary-range="month" type="button">Monthly</button>
                <button class="nw-range-btn ${rangeType === 'year' ? 'active' : ''}" data-rpt-summary-range="year" type="button">Yearly</button>
            </div>
        </div>
        <h4 class="rpt-section-title">Cash Flow</h4>
        <table class="nw-history-table">
            <tbody>
                ${cashFlowRows}
                <tr class="${netCls}"><td><strong>Net Remaining</strong></td><td class="text-right"><strong>${formatCurrency(cf.net)}</strong></td></tr>
            </tbody>
        </table>
        <h4 class="rpt-section-title">Account Balances</h4>
        <table class="nw-history-table">
            <thead><tr><th>Account</th><th>Start</th><th>End</th><th>Change</th></tr></thead>
            <tbody>${accountRows}</tbody>
        </table>
        ${netWorthSection}`;
}
```

Update `renderReportsPage` (line 44) to call the new function:

```javascript
export function renderReportsPage(app) {
    updateReportMonthNav(app);

    ['_rptIncomeChart', '_rptBillsChart', '_rptExpChart', '_rptMoneyFlowChart', '_rptOutflowChart', '_rptNetWorthTrendChart', '_rptNetWorthCompositionChart', '_rptForecastChart', '_rptSpendingPieChart', '_rptSpendingBarChart']
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
    renderReportsSpending(app);
    renderReportsSummary(app);
}
```

In `index.html`, add a new tab group after the "Planning" group (after line 679, before the closing `</div>` of `.rpt-tab-bar` at line 680):

```html
<div class="rpt-tab-group-sep" aria-hidden="true"></div>
<div class="rpt-tab-group">
    <span class="rpt-tab-group-label">Print</span>
    <div class="rpt-tab-group-tabs">
        <button class="rpt-tab-btn" data-rptab="summary" role="tab" aria-selected="false" aria-controls="rptPanel-summary">🖨️ Summary</button>
    </div>
</div>
```

Add the panel after `rptPanel-spending` (after line 712, before `</section>` at line 713):

```html
<div class="rpt-tab-panel" id="rptPanel-summary">
    <div id="reportsSummary"></div>
</div>
```

In `src/app.js`, add the import (extend the existing `from './reports.js'` import block) and delegating method:

```javascript
computeReportsSummaryMetrics(rangeType, baseDate) {
    return computeReportsSummaryMetricsFeature(this, rangeType, baseDate);
}
```

(Import `computeReportsSummaryMetrics as computeReportsSummaryMetricsFeature` alongside the other `reports.js` imports near line 62-64.)

In `src/ui.js`, add a delegated handler inside the existing `document.addEventListener('click', event => { ... })` block (before the closing `});` at line 347):

```javascript
const summaryRangeBtn = event.target.closest('[data-rpt-summary-range]');
if (summaryRangeBtn) {
    const next = summaryRangeBtn.getAttribute('data-rpt-summary-range');
    if (next === 'month' || next === 'year') {
        app._reportSummaryRange = next;
        app.renderReportsPage();
    }
    return;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/features/test_reports.py::test_summary_metrics_month_cash_flow -v`
Expected: PASS

- [ ] **Step 5: Write and run a UI test for the tab + toggle**

Add to `tests/ui/test_reports_actions.py`:

```python
@pytest.mark.ui
def test_summary_tab_monthly_yearly_toggle(app_page):
    """Switching to the Summary tab and toggling Yearly updates the period label."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.click('[data-rptab="summary"]')
    page.wait_for_timeout(200)

    heading = page.query_selector('#reportsSummary h3')
    assert heading and 'Summary Report' in heading.text_content()

    page.click('[data-rpt-summary-range="year"]')
    page.wait_for_timeout(200)
    heading = page.query_selector('#reportsSummary h3')
    import datetime
    assert str(datetime.date.today().year) in heading.text_content()
```

Run: `pytest tests/ui/test_reports_actions.py::test_summary_tab_monthly_yearly_toggle -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/reports.js src/app.js src/ui.js index.html tests/features/test_reports.py tests/ui/test_reports_actions.py
git commit -m "feat: add printable Monthly/Yearly Summary Report tab to Reports page"
```

---

### Task 7: Summary Report accessibility pass

**Files:**
- Modify: `src/reports.js` (`renderReportsSummary` — add table captions)
- Test: `tests/a11y/test_a11y_audit.py`

**Interfaces:**
- Consumes: `renderReportsSummary` from Task 6.

- [ ] **Step 1: Write the failing test**

```python
@pytest.mark.a11y
def test_summary_report_tables_have_captions(app_page):
    """Summary Report tables must have a <caption> for screen-reader context,
    matching the pattern used by the Net Worth history table."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.click('[data-rptab="summary"]')
    page.wait_for_timeout(200)

    tables = page.query_selector_all('#reportsSummary table')
    assert len(tables) >= 2, "Expected at least Cash Flow and Account Balances tables"
    for table in tables:
        caption = table.query_selector('caption')
        assert caption is not None, "Each Summary Report table must have a <caption>"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/a11y/test_a11y_audit.py::test_summary_report_tables_have_captions -v`
Expected: FAIL — no `<caption>` elements exist yet.

- [ ] **Step 3: Implement**

In `src/reports.js`, update `renderReportsSummary`'s table markup to add captions (modify the two `<table class="nw-history-table">` blocks built in Task 6):

```javascript
<table class="nw-history-table">
    <caption class="sr-only">Cash flow summary for ${escapeHtml(metrics.periodLabel)}</caption>
    <tbody>
        ${cashFlowRows}
        <tr class="${netCls}"><td><strong>Net Remaining</strong></td><td class="text-right"><strong>${formatCurrency(cf.net)}</strong></td></tr>
    </tbody>
</table>
<h4 class="rpt-section-title">Account Balances</h4>
<table class="nw-history-table">
    <caption class="sr-only">Account balances for ${escapeHtml(metrics.periodLabel)}</caption>
    <thead><tr><th>Account</th><th>Start</th><th>End</th><th>Change</th></tr></thead>
    <tbody>${accountRows}</tbody>
</table>
```

(`.sr-only` already exists in `styles.css` per `renderChartDataTable`'s usage — no new CSS needed.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/a11y/test_a11y_audit.py::test_summary_report_tables_have_captions -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/reports.js tests/a11y/test_a11y_audit.py
git commit -m "fix: add screen-reader captions to Summary Report tables"
```

---

### Task 8: Ledger — extract `getFilteredSortedLedgerTransactions`

**Files:**
- Modify: `src/ledger.js:545-642` (`renderLedgerPage` — extract the filter/sort block into a new exported function)
- Test: `tests/features/test_ledger.py`

**Interfaces:**
- Produces: `export function getFilteredSortedLedgerTransactions(app)` — returns the fully filtered (account + date-range) and sorted transaction array, reading the same `app._ledgerAccountFilter`, `app._ledgerDateRange`, `app._ledgerSortKey`, `app._ledgerSortDir` state `renderLedgerPage` already reads. No pagination applied (callers slice separately).
- Consumes: `getLedgerTransactions(app)` (existing).

- [ ] **Step 1: Write the failing test**

Add to `tests/features/test_ledger.py` (check existing imports/fixtures first):

```python
@pytest.mark.feature
def test_get_filtered_sorted_ledger_transactions_respects_account_filter(app_page):
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [
            { id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 },
            { id: 2, name: 'Savings', type: 'Savings', startingBalance: 500 }
        ];
        app.incomes = [
            { id: 10, name: 'Job A', amount: 1000, accountId: 1, frequency: 'monthly', firstDate: '2026-06-01' },
            { id: 11, name: 'Job B', amount: 500, accountId: 2, frequency: 'monthly', firstDate: '2026-06-01' }
        ];
        app.debts = []; app.bills = []; app.expenses = []; app.bonuses = [];
        app.recurringTemplates = []; app._ledgerAccountFilter = '1'; app._ledgerDateRange = 'all';
        app._ledgerSortKey = 'date'; app._ledgerSortDir = 'desc';
    }""")
    txs = page.evaluate("() => window.app.getFilteredSortedLedgerTransactions()")
    assert all(tx['accountId'] == 1 or str(tx['accountId']) == '1' for tx in txs)
    assert any(tx['name'] == 'Job A' for tx in txs)
    assert not any(tx['name'] == 'Job B' for tx in txs)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/features/test_ledger.py::test_get_filtered_sorted_ledger_transactions_respects_account_filter -v`
Expected: FAIL — `getFilteredSortedLedgerTransactions` is not a function on `window.app`.

- [ ] **Step 3: Implement**

In `src/ledger.js`, add the new exported function right before `renderLedgerPage` (before line 545):

```javascript
export function getFilteredSortedLedgerTransactions(app) {
    let transactions = getLedgerTransactions(app);
    const selectedAccount = app._ledgerAccountFilter || 'all';
    const selectedDateRange = app._ledgerDateRange || '30';

    if (selectedAccount !== 'all') {
        transactions = transactions.filter(tx => String(tx.accountId) === String(selectedAccount));
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (selectedDateRange !== 'all') {
        transactions = transactions.filter(tx => {
            const txDate = new Date(tx.date);
            const txDateOnly = new Date(txDate.getFullYear(), txDate.getMonth(), txDate.getDate());
            if (selectedDateRange === 'past') {
                return txDateOnly <= todayStart;
            } else if (selectedDateRange === '30' || selectedDateRange === '60' || selectedDateRange === '90') {
                const days = parseInt(selectedDateRange, 10);
                const futureLimit = new Date(todayStart.getTime() + days * 24 * 60 * 60 * 1000);
                return txDateOnly >= todayStart && txDateOnly < futureLimit;
            } else if (selectedDateRange === 'month') {
                const y = now.getFullYear();
                const m = now.getMonth();
                const endOfNextMonth = new Date(y, m + 2, 0, 23, 59, 59, 999);
                return txDateOnly >= todayStart && txDateOnly <= endOfNextMonth;
            }
            return true;
        });
    }

    const sortKey = app._ledgerSortKey || 'date';
    const sortDir = app._ledgerSortDir || 'desc';
    transactions.sort((a, b) => {
        let vA = a[sortKey], vB = b[sortKey];
        if (sortKey === 'amount' || sortKey === 'balance') {
            vA = Number(vA); vB = Number(vB);
        } else if (sortKey === 'date') {
            vA = new Date(vA); vB = new Date(vB);
        } else {
            vA = (vA || '').toString().toLowerCase();
            vB = (vB || '').toString().toLowerCase();
        }
        if (vA < vB) return sortDir === 'asc' ? -1 : 1;
        if (vA > vB) return sortDir === 'asc' ? 1 : -1;
        return 0;
    });

    return transactions;
}
```

Now replace the inlined filter/sort logic inside `renderLedgerPage` (the block from `let transactions = getLedgerTransactions(app);` through the closing of the `transactions.sort(...)` call, roughly lines 549 and 588-631) with a single call. Specifically:

- Delete lines 549 (`let transactions = getLedgerTransactions(app);`) and the filter/sort block at lines 588-594 (account filter) and 596-631 (date-range filter + sort) — i.e. everything that mutates/filters/sorts `transactions` after it's first assigned.
- Keep the `filterHtml` construction (it reads `selectedAccount`/`selectedDateRange` for the `<select>` markup — keep those two `let` declarations at lines 551-552 since the dropdowns still need them).
- Replace with:

```javascript
let transactions = getFilteredSortedLedgerTransactions(app);
```

placed immediately after the pagination/page-size `let` declarations (after line 560), before `filterHtml` is built. (The `selectedAccount`/`selectedDateRange` locals stay, used only for rendering the `<select>` `selected` attributes — they are no longer used to filter `transactions`, since `getFilteredSortedLedgerTransactions` reads `app._ledgerAccountFilter`/`app._ledgerDateRange` directly.)

In `src/app.js`, add the delegating method (alongside other `ledger.js` delegations):

```javascript
getFilteredSortedLedgerTransactions() {
    return getFilteredSortedLedgerTransactionsFeature(this);
}
```

(Import `getFilteredSortedLedgerTransactions as getFilteredSortedLedgerTransactionsFeature` from `./ledger.js` alongside the other ledger imports.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/features/test_ledger.py::test_get_filtered_sorted_ledger_transactions_respects_account_filter -v`
Expected: PASS

- [ ] **Step 5: Run the full existing ledger test suite to confirm no regression**

Run: `pytest tests/features/test_ledger.py tests/ui/test_modals.py -v`
Expected: All PASS — the Ledger table must render identically to before this refactor.

- [ ] **Step 6: Commit**

```bash
git add src/ledger.js src/app.js tests/features/test_ledger.py
git commit -m "refactor: extract getFilteredSortedLedgerTransactions from renderLedgerPage"
```

---

### Task 9: Ledger custom-column CSV export — `exportLedgerToCSV`

**Files:**
- Modify: `src/storage.js` (export `csvField`, add `exportLedgerToCSV`)
- Modify: `src/app.js` (delegate `exportLedgerToCSV`)
- Test: `tests/security/test_input_validation.py`

**Interfaces:**
- Produces: `export function exportLedgerToCSV(app, columns)` in `src/storage.js`, where `columns` is an array of keys from `['date', 'account', 'name', 'amount', 'category', 'balance', 'type']` (any subset, any order). Triggers a `ledger-export-YYYY-MM-DD.csv` download. Delegated as `app.exportLedgerToCSV(columns)`.
- Consumes: `getFilteredSortedLedgerTransactions(app)` from Task 8 (import from `./ledger.js`).

- [ ] **Step 1: Write the failing test**

Add to `tests/security/test_input_validation.py` (check existing imports first):

```python
@pytest.mark.security
def test_ledger_csv_export_quotes_fields_against_csv_injection(app_page):
    """A transaction name starting with '=' (a CSV-injection vector if opened
    in Excel) must be quoted by csvField() the same way commas already are,
    not emitted as a raw leading '=' that a spreadsheet would evaluate."""
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        app.incomes = [{ id: 2, name: '=2+2', amount: 100, accountId: 1, frequency: 'monthly', firstDate: '2026-06-01' }];
        app.debts = []; app.bills = []; app.expenses = []; app.bonuses = []; app.recurringTemplates = [];
        app._ledgerAccountFilter = 'all'; app._ledgerDateRange = 'all';
        app._ledgerSortKey = 'date'; app._ledgerSortDir = 'desc';
    }""")
    with page.expect_download() as download_info:
        page.evaluate("() => window.app.exportLedgerToCSV(['date', 'account', 'name', 'amount'])")
    download = download_info.value
    path = download.path()
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    assert '"=2+2"' in content, "Transaction name must be wrapped in quotes by csvField()"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/security/test_input_validation.py::test_ledger_csv_export_quotes_fields_against_csv_injection -v`
Expected: FAIL — `exportLedgerToCSV` is not a function.

- [ ] **Step 3: Implement**

In `src/storage.js`, change `function csvField(value) {` (line 413) to `export function csvField(value) {` (no logic change).

Add the import at the top of `src/storage.js` for `getFilteredSortedLedgerTransactions` (check the file's existing import block first and add to it, or add a new `import { getFilteredSortedLedgerTransactions } from './ledger.js';` line):

```javascript
import { getFilteredSortedLedgerTransactions } from './ledger.js';
```

Add the new function after `exportToCSV` (after line 523, before `// Import a full backup JSON file.`):

```javascript
const LEDGER_EXPORT_COLUMN_LABELS = {
    date: 'Date',
    account: 'Account',
    name: 'Transaction',
    amount: 'Amount',
    category: 'Category',
    balance: 'Running Balance',
    type: 'Type'
};
export const LEDGER_EXPORT_COLUMN_KEYS = Object.keys(LEDGER_EXPORT_COLUMN_LABELS);

function ledgerExportCellValue(tx, key) {
    switch (key) {
        case 'date': return tx.date ? new Date(tx.date).toISOString().slice(0, 10) : '';
        case 'account': return tx.account || '';
        case 'name': return tx.name || '';
        case 'amount': return Number(tx.amount || 0).toFixed(2);
        case 'category': return tx.category || '';
        case 'balance': return Number(tx.balance || 0).toFixed(2);
        case 'type': return tx.type || '';
        default: return '';
    }
}

// Export the currently filtered/sorted Ledger view to CSV with user-selected columns.
export function exportLedgerToCSV(app, columns) {
    const selectedColumns = (Array.isArray(columns) ? columns : []).filter(c => LEDGER_EXPORT_COLUMN_KEYS.includes(c));
    if (selectedColumns.length === 0) return;

    const transactions = getFilteredSortedLedgerTransactions(app);

    let csv = selectedColumns.map(c => csvField(LEDGER_EXPORT_COLUMN_LABELS[c])).join(',') + '\n';
    for (const tx of transactions) {
        csv += selectedColumns.map(c => csvField(ledgerExportCellValue(tx, c))).join(',') + '\n';
    }

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledger-export-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}
```

In `src/app.js`, add the import (extend the existing `from './storage.js'` import) and delegating method:

```javascript
exportLedgerToCSV(columns) {
    return exportLedgerToCSVFeature(this, columns);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/security/test_input_validation.py::test_ledger_csv_export_quotes_fields_against_csv_injection -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage.js src/app.js tests/security/test_input_validation.py
git commit -m "feat: add exportLedgerToCSV with selectable columns"
```

---

### Task 10: Ledger — Export CSV button + column-picker modal

**Files:**
- Modify: `index.html` (add `#ledgerExportModal`, add the export button to the ledger filter bar markup is done in `ledger.js`, not HTML — only the modal is static HTML)
- Modify: `src/ledger.js` (`renderLedgerPage` — add the "Export CSV" button to `filterHtml`; add `openLedgerExportModal`)
- Test: `tests/ui/test_modals.py`, `tests/integration/test_workflows.py`

**Interfaces:**
- Consumes: `app.exportLedgerToCSV(columns)` (Task 9), `getSetting`/`setSetting` from `src/settings.js`.
- Produces: clicking `#ledgerExportCsvBtn` opens `#ledgerExportModal`; confirming calls `app.exportLedgerToCSV(columns)` with the checked columns and persists the selection via `setSetting(app, 'ledgerExportColumns', columns.join(','))`.

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/test_workflows.py`:

```python
@pytest.mark.integration
def test_ledger_export_csv_with_column_picker(app_page):
    """Opening the Ledger export modal, unchecking a column, and confirming
    downloads a CSV containing only the selected columns."""
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        app.incomes = [{ id: 2, name: 'Paycheck', amount: 2000, accountId: 1, frequency: 'monthly', firstDate: '2026-06-01' }];
        app.debts = []; app.bills = []; app.expenses = []; app.bonuses = []; app.recurringTemplates = [];
        app.switchPage('ledger');
    }""")
    page.wait_for_timeout(300)

    page.click('#ledgerExportCsvBtn')
    page.wait_for_timeout(200)
    modal = page.query_selector('#ledgerExportModal')
    assert modal and 'flex-visible' in (modal.get_attribute('class') or '')

    page.uncheck('#ledgerExportCol-category')

    with page.expect_download() as download_info:
        page.click('#ledgerExportConfirmBtn')
    download = download_info.value

    assert download.suggested_filename.endswith('.csv')
    path = download.path()
    with open(path, 'r', encoding='utf-8') as f:
        header = f.readline()
    assert 'Category' not in header
    assert 'Transaction' in header
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_workflows.py::test_ledger_export_csv_with_column_picker -v`
Expected: FAIL — `#ledgerExportCsvBtn` not found.

- [ ] **Step 3: Implement**

In `index.html`, add the modal after `#ledgerOverrideModal` (after line 879, before `#reconcileModal`):

```html
<div id="ledgerExportModal" class="modal modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="ledgerExportTitle" tabindex="-1">
    <div class="modal-content">
        <button id="ledgerExportCloseBtn" aria-label="Close" class="modal-close">&times;</button>
        <h3 id="ledgerExportTitle">Export Ledger to CSV</h3>
        <p class="modal-description">Choose which columns to include. Exports the currently filtered and sorted view.</p>
        <div class="form-group modal-form-group" id="ledgerExportColumnList">
            <label><input type="checkbox" id="ledgerExportCol-date" value="date" checked> Date</label>
            <label><input type="checkbox" id="ledgerExportCol-account" value="account" checked> Account</label>
            <label><input type="checkbox" id="ledgerExportCol-name" value="name" checked> Transaction Name</label>
            <label><input type="checkbox" id="ledgerExportCol-amount" value="amount" checked> Amount</label>
            <label><input type="checkbox" id="ledgerExportCol-category" value="category" checked> Category</label>
            <label><input type="checkbox" id="ledgerExportCol-balance" value="balance" checked> Running Balance</label>
            <label><input type="checkbox" id="ledgerExportCol-type" value="type" checked> Type</label>
        </div>
        <p class="modal-helper-text" id="ledgerExportEmptyWarning" hidden>No transactions match the current filters — nothing to export.</p>
        <div class="modal-actions">
            <button id="ledgerExportConfirmBtn" class="btn btn-success">Export CSV</button>
            <button id="ledgerExportCancelBtn" class="btn btn-secondary">Cancel</button>
        </div>
    </div>
</div>
```

In `src/ledger.js`, add the import at the top:

```javascript
import { getSetting, setSetting } from './settings.js';
```

Add the button to `filterHtml`, right after the `</div>` closes `.filter-controls`'s select group but while still inside it — insert before the existing `if (selectedAccount !== 'all') { filterHtml += ...reconcile button... }` block (so it appears before the reconcile button, inside `.filter-controls`):

```javascript
filterHtml += `<button id="ledgerExportCsvBtn" class="btn btn-secondary btn-small" type="button">⬇️ Export CSV</button>`;
```

(Insert this line directly after the `</select>` that closes the Rows dropdown, i.e. right before the existing `if (selectedAccount !== 'all') { ... }` reconcile-button block.)

Add the modal-opening function near `openLedgerOverrideModal` (before `renderLedgerPage`):

```javascript
const LEDGER_EXPORT_COLUMN_KEYS = ['date', 'account', 'name', 'amount', 'category', 'balance', 'type'];

function openLedgerExportModal(app) {
    const modal = document.getElementById('ledgerExportModal');
    const confirmBtn = document.getElementById('ledgerExportConfirmBtn');
    const cancelBtn = document.getElementById('ledgerExportCancelBtn');
    const closeBtn = document.getElementById('ledgerExportCloseBtn');
    const warning = document.getElementById('ledgerExportEmptyWarning');
    if (!modal || !confirmBtn || !cancelBtn || !closeBtn || !warning) return;

    const savedColumns = (getSetting(app, 'ledgerExportColumns', LEDGER_EXPORT_COLUMN_KEYS.join(',')) || '')
        .split(',')
        .filter(c => LEDGER_EXPORT_COLUMN_KEYS.includes(c));
    const activeColumns = savedColumns.length > 0 ? savedColumns : LEDGER_EXPORT_COLUMN_KEYS;
    for (const key of LEDGER_EXPORT_COLUMN_KEYS) {
        const checkbox = document.getElementById(`ledgerExportCol-${key}`);
        if (checkbox) checkbox.checked = activeColumns.includes(key);
    }

    const hasRows = getFilteredSortedLedgerTransactions(app).length > 0;
    warning.hidden = hasRows;
    confirmBtn.disabled = !hasRows;

    const close = () => {
        modal.classList.add('hidden'); modal.classList.remove('flex-visible');
        modal.onkeydown = null;
    };

    confirmBtn.onclick = () => {
        const columns = LEDGER_EXPORT_COLUMN_KEYS.filter(key => document.getElementById(`ledgerExportCol-${key}`)?.checked);
        if (columns.length === 0) return;
        setSetting(app, 'ledgerExportColumns', columns.join(','));
        app.exportLedgerToCSV(columns);
        close();
    };
    cancelBtn.onclick = close;
    closeBtn.onclick = close;
    modal.onclick = (event) => { if (event.target === modal) close(); };
    modal.onkeydown = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
        }
    };

    modal.classList.add('flex-visible'); modal.classList.remove('hidden');
    setTimeout(() => closeBtn.focus(), 30);
}
```

At the end of `renderLedgerPage`, after the existing `reconcileFromLedgerBtn` wiring (after line 789, before the closing comment at line 790), add:

```javascript
const exportCsvBtn = container.querySelector('#ledgerExportCsvBtn');
if (exportCsvBtn) {
    exportCsvBtn.onclick = () => openLedgerExportModal(app);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/integration/test_workflows.py::test_ledger_export_csv_with_column_picker -v`
Expected: PASS

- [ ] **Step 5: Add an a11y test for the modal**

Add to `tests/a11y/test_a11y_audit.py`:

```python
@pytest.mark.a11y
def test_ledger_export_modal_escape_closes_and_returns_focus(app_page):
    """Escape closes the Ledger export modal (keyboard parity with the Cancel button)."""
    page = app_page
    page.evaluate("""() => {
        window.app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        window.app.switchPage('ledger');
    }""")
    page.wait_for_timeout(300)
    page.click('#ledgerExportCsvBtn')
    page.wait_for_timeout(200)
    page.keyboard.press('Escape')
    page.wait_for_timeout(200)
    modal = page.query_selector('#ledgerExportModal')
    assert 'hidden' in (modal.get_attribute('class') or '')
```

Run: `pytest tests/a11y/test_a11y_audit.py::test_ledger_export_modal_escape_closes_and_returns_focus -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add index.html src/ledger.js tests/integration/test_workflows.py tests/a11y/test_a11y_audit.py
git commit -m "feat: add Ledger CSV export button with column-picker modal"
```

---

### Task 11: CSP / static-scan regression check

**Files:**
- Modify: `tests/security/test_static_scan.py` (check the file's existing structure first and follow its pattern)
- Test: same file

**Interfaces:**
- None — this is a verification-only task confirming Tasks 1-10 introduced no CSP/static-scan violations.

- [ ] **Step 1: Write the failing-if-violated test**

Add to `tests/security/test_static_scan.py` (adapt to the file's existing helper functions for reading source files — follow whatever pattern the file already uses to scan `src/*.js` and `index.html`; if it already has a generic "no inline style/script attributes" test that scans all files, skip this step and go to Step 2 directly since the existing test already covers new files automatically):

```python
@pytest.mark.security
def test_no_new_external_origins_introduced():
    """The CSP's script-src/style-src allowlist must still only reference
    'self' and the existing Chart.js CDN origin — Enhanced Data Export adds
    no PDF or image library, so no new origin should appear."""
    with open('index.html', 'r', encoding='utf-8') as f:
        html = f.read()
    import re
    csp_match = re.search(r'Content-Security-Policy" content="([^"]+)"', html)
    assert csp_match, "Expected a CSP meta tag in index.html"
    csp = csp_match.group(1)
    assert "cdn.jsdelivr.net" in csp
    assert "'self'" in csp
    forbidden_hosts = ['jspdf', 'html2canvas', 'unpkg.com', 'cdnjs.cloudflare.com']
    for host in forbidden_hosts:
        assert host not in csp.lower(), f"Unexpected new external dependency origin in CSP: {host}"
```

- [ ] **Step 2: Run test**

Run: `pytest tests/security/test_static_scan.py::test_no_new_external_origins_introduced -v`
Expected: PASS (no CSP changes were made by Tasks 1-10).

- [ ] **Step 3: Run the full security suite to confirm no regressions from Tasks 1-10**

Run: `pytest tests/security/ -v`
Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/security/test_static_scan.py
git commit -m "test: add CSP regression check for Enhanced Data Export (no new origins)"
```

---

### Task 12: Full regression pass + documentation updates

**Files:**
- Modify: `README.md` (feature list)
- Modify: `ROADMAP.md:141, 541-549, 566` (mark delivered)
- Modify: `guide.html:627-647` (extend "Exporting Data" section)

**Interfaces:** None — documentation only.

- [ ] **Step 1: Run the full test suite**

Run: `pytest tests/ -v`
Expected: All PASS. (Start the server first: `python -m http.server 5500` in a separate terminal, if not already running.)

- [ ] **Step 2: Update `ROADMAP.md`**

Change line 141 (`| Enhanced Data Export | 4 | 📋 | |`) to mark it delivered (match the existing table's delivered-row convention — check a neighboring delivered row in the same table for the exact emoji/format used, e.g. `✅`).

Replace the block at lines 541-549:

```markdown
#### 📄 Enhanced Data Export
**Priority**: LOW | **Effort**: MEDIUM | **Status**: ✅ **Delivered June 21, 2026**

**Features**:
- ✅ CSV export with custom columns — column-picker modal on the Ledger page (`#ledgerExportCsvBtn`), exports the currently filtered/sorted view.
- ✅ Monthly/yearly summary reports — new "Summary" tab on the Reports page with a Monthly/Yearly toggle.
- ✅ PDF report generation — "Print / Save as PDF" button on the Reports page, using the browser's native print-to-PDF (no new dependency).
- ✅ Chart export as images — every Chart.js canvas app-wide now has a PNG download button (`chart.toBase64Image()`).

---
```

Update line 566 (the Tier 5 "Print-friendly Reports view" bullet) to:

```markdown
- ~~**Print-friendly Reports view**~~ ✅ **Delivered June 21, 2026** — a `@media print` stylesheet plus a "Print / Save as PDF" button on the Reports page; doubles as the PDF mechanism for Enhanced Data Export (Tier 4).
```

- [ ] **Step 3: Update `README.md`**

Find the feature list section (search for where Reports/Ledger features are listed) and add bullets for: CSV export with custom columns (Ledger), printable Monthly/Yearly Summary Report, Print/Save-as-PDF for Reports, and per-chart PNG export — match the existing bullet style in that section exactly.

- [ ] **Step 4: Update `guide.html`**

In the existing "Exporting Data" section (around line 627-630), add after the existing JSON-export bullets:

```html
<h3>Exporting the Ledger to CSV</h3>
<ul>
    <li>From the Ledger page, click <strong>Export CSV</strong></li>
    <li>Choose which columns to include (date, account, transaction, amount, category, running balance, type)</li>
    <li>Export uses your current account/date-range filters and sort order</li>
</ul>
<h3>Printing or Saving Reports as PDF</h3>
<ul>
    <li>From the Reports page, click <strong>🖨️ Print</strong></li>
    <li>Use your browser's print dialog to print or choose "Save as PDF"</li>
    <li>Only the currently active report tab is printed</li>
</ul>
<h3>Summary Reports</h3>
<ul>
    <li>From the Reports page, open the <strong>🖨️ Summary</strong> tab</li>
    <li>Toggle between Monthly and Yearly views</li>
    <li>Shows cash flow, account balances, and net worth for the selected period</li>
</ul>
<h3>Exporting Charts as Images</h3>
<p>Every chart throughout the app has a small <strong>⬇️ PNG</strong> button above it to download that chart as an image.</p>
```

- [ ] **Step 5: Commit**

```bash
git add README.md ROADMAP.md guide.html
git commit -m "docs: document Enhanced Data Export features (CSV columns, summary report, print/PDF, chart PNG export)"
```

---

## Self-Review Notes (for the plan author, not a task)

- Spec coverage: CSV custom columns → Task 9-10; Monthly/yearly summary → Task 6-7; PDF generation → Task 5; Chart export as images → Tasks 1-4; Print-friendly Reports view → Task 5. All five spec bullets have a task.
- `app.settings`'s scalar-only constraint (Global Constraints) is honored: ledger export columns are stored as a comma-joined string via the existing generic `setSetting`/`getSetting`, not a new array field or sanitizer.
- Every new exported function got a delegating method on `DebtTrackerApp` per the project's module pattern, except `renderReportsSummary` and `openLedgerExportModal`/`getFilteredSortedLedgerTransactions`'s internal callers — `renderReportsSummary` is called only internally from `renderReportsPage` (already delegated), consistent with how `renderReportsIncomeExp` etc. are never delegated individually either.
