# Spending Analysis by Category — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "🏷️ Spending" tab to the Reports page showing a doughnut pie, ranked category list, 6-month stacked bar trend, and a click-through drill-down modal — all derived from the existing ledger transaction pipeline.

**Architecture:** New `src/spending.js` module exports `computeSpendingByCategory(app, year, month)` (pure data) and `renderReportsSpending(app)` (DOM). `reports.js` imports and calls it inside `renderReportsPage`; `index.html` gets a new tab button + panel following the existing `rpt-tab-btn` / `rpt-tab-panel` pattern. No new app-state collections; no new storage fields.

**Tech Stack:** Vanilla ES6 modules, Chart.js (CDN, already loaded), Playwright + pytest, served via `python -m http.server 5500`.

---

## Setup

Start the dev server and leave it running:
```bash
python -m http.server 5500
```

---

### Task 1: `computeSpendingByCategory` in `src/spending.js` (TDD)

**Files:**
- Create: `src/spending.js`
- Create: `tests/features/test_spending_analysis.py`

- [ ] **Step 1: Create the test file with all seven feature tests**

Create `tests/features/test_spending_analysis.py`:

```python
import pytest

@pytest.mark.feature
def test_spending_aggregates_all_outflow_types(app_page):
    """expenses + bills + recurring outflows + debt minimums + savings all count."""
    page = app_page
    result = page.evaluate("""async () => {
        const mod = await import('/src/spending.js');
        const app = window.app;
        app.expenses = [{ id: 1, name: 'Groceries', category: 'Food', budgetAmount: 100, date: '2026-06-05', accountId: null }];
        app.bills = [{ id: 2, name: 'Electric', category: 'Utilities', amount: 80, dueDay: 10, accountId: null }];
        app.recurringTemplates = [{
            id: 3, name: 'Netflix', type: 'subscription', amount: 15,
            frequency: 'monthly', dayOfMonth: 1, category: 'Subscriptions',
            accountId: null, targetAccountId: null, startDate: '2026-01-01',
            endDate: null, paused: false, skippedMonths: [], paidMonths: []
        }];
        app.debts = [{ id: 4, name: 'Car Loan', minimumPayment: 200, dueDate: 15, accountId: null, debtType: 'creditCard', accountBalance: 5000, interestRate: 5 }];
        app.emergencyFunds = [{ id: 5, name: 'Emergency', monthlyContribution: 50, currentAmount: 100, targetAmount: 1000, autoContribute: true, accountId: null }];
        app.sinkingFunds = [];
        app.incomes = []; app.bonuses = []; app.accounts = [];
        app.ledgerAmountOverrides = {};
        const cats = mod.computeSpendingByCategory(app, 2026, 5);
        const out = {};
        for (const c of cats) out[c.category] = Math.round(c.total * 100) / 100;
        return out;
    }""")
    assert result.get('Food', 0) == pytest.approx(100, rel=0.01)
    assert result.get('Utilities', 0) == pytest.approx(80, rel=0.01)
    assert result.get('Subscriptions', 0) == pytest.approx(15, rel=0.01)
    assert result.get('Debt Payments', 0) == pytest.approx(200, rel=0.01)
    assert result.get('Savings', 0) == pytest.approx(50, rel=0.01)


@pytest.mark.feature
def test_spending_excludes_income(app_page):
    """Income, bonus, and reimbursement (positive recurring) are not counted."""
    page = app_page
    result = page.evaluate("""async () => {
        const mod = await import('/src/spending.js');
        const app = window.app;
        app.incomes = [{ id: 1, name: 'Salary', amount: 3000, firstPayDate: '2026-06-01', frequency: 'monthly', accountId: null, category: 'Income' }];
        app.bonuses = [{ id: 2, name: 'Bonus', amount: 500, date: '2026-06-15', accountId: null }];
        app.recurringTemplates = [{
            id: 3, name: 'Rental Income', type: 'reimbursement', amount: 200,
            frequency: 'monthly', dayOfMonth: 1, category: 'Income',
            accountId: null, targetAccountId: null, startDate: '2026-01-01',
            endDate: null, paused: false, skippedMonths: [], paidMonths: []
        }];
        app.expenses = []; app.bills = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = []; app.accounts = [];
        app.ledgerAmountOverrides = {};
        return mod.computeSpendingByCategory(app, 2026, 5);
    }""")
    assert result == [], f"Expected no spending for income-only data, got {result}"


@pytest.mark.feature
def test_spending_sorted_by_total_desc(app_page):
    """Result array is sorted highest total first."""
    page = app_page
    result = page.evaluate("""async () => {
        const mod = await import('/src/spending.js');
        const app = window.app;
        app.expenses = [
            { id: 1, name: 'Coffee', category: 'Coffee', budgetAmount: 30, date: '2026-06-01', accountId: null },
            { id: 2, name: 'Rent', category: 'Housing', budgetAmount: 950, date: '2026-06-01', accountId: null },
            { id: 3, name: 'Gas', category: 'Transport', budgetAmount: 60, date: '2026-06-01', accountId: null }
        ];
        app.bills = []; app.recurringTemplates = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.incomes = []; app.bonuses = []; app.accounts = [];
        app.ledgerAmountOverrides = {};
        return mod.computeSpendingByCategory(app, 2026, 5).map(c => c.category);
    }""")
    assert result == ['Housing', 'Transport', 'Coffee']


@pytest.mark.feature
def test_spending_other_fallback(app_page):
    """Blank category falls back to 'Other'."""
    page = app_page
    result = page.evaluate("""async () => {
        const mod = await import('/src/spending.js');
        const app = window.app;
        app.expenses = [{ id: 1, name: 'Mystery', category: '', budgetAmount: 42, date: '2026-06-10', accountId: null }];
        app.bills = []; app.recurringTemplates = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.incomes = []; app.bonuses = []; app.accounts = [];
        app.ledgerAmountOverrides = {};
        const cats = mod.computeSpendingByCategory(app, 2026, 5);
        return cats.length === 1 ? cats[0].category : null;
    }""")
    assert result == 'Other'


@pytest.mark.feature
def test_spending_change_vs_last_month(app_page):
    """changeVsLastMonth = (this - prior) / prior for categories present both months."""
    page = app_page
    result = page.evaluate("""async () => {
        const mod = await import('/src/spending.js');
        const app = window.app;
        // Bill appears every month; expense only in June.
        // June Food = $100 (bill) + $120 (expense) = $220
        // May Food = $100 (bill only) = $100
        // change = (220-100)/100 = 1.2
        app.expenses = [{ id: 1, name: 'Extra shop', category: 'Food', budgetAmount: 120, date: '2026-06-10', accountId: null }];
        app.bills = [{ id: 2, name: 'Grocery budget', category: 'Food', amount: 100, dueDay: 10, accountId: null }];
        app.recurringTemplates = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.incomes = []; app.bonuses = []; app.accounts = [];
        app.ledgerAmountOverrides = {};
        const cats = mod.computeSpendingByCategory(app, 2026, 5);
        const food = cats.find(c => c.category === 'Food');
        return food ? { total: food.total, change: food.changeVsLastMonth } : null;
    }""")
    assert result is not None
    assert result['total'] == pytest.approx(220, rel=0.01)
    assert result['change'] == pytest.approx(1.2, rel=0.01)


@pytest.mark.feature
def test_spending_change_vs_last_month_null_when_no_prior(app_page):
    """changeVsLastMonth is None when the category had no prior-month spending."""
    page = app_page
    result = page.evaluate("""async () => {
        const mod = await import('/src/spending.js');
        const app = window.app;
        app.expenses = [{ id: 1, name: 'New thing', category: 'BrandNew', budgetAmount: 50, date: '2026-06-01', accountId: null }];
        app.bills = []; app.recurringTemplates = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.incomes = []; app.bonuses = []; app.accounts = [];
        app.ledgerAmountOverrides = {};
        const cats = mod.computeSpendingByCategory(app, 2026, 5);
        const cat = cats.find(c => c.category === 'BrandNew');
        return cat ? cat.changeVsLastMonth : 'not found';
    }""")
    assert result is None


@pytest.mark.feature
def test_spending_empty_state(app_page):
    """Returns empty array when there are no outflow transactions."""
    page = app_page
    result = page.evaluate("""async () => {
        const mod = await import('/src/spending.js');
        const app = window.app;
        app.expenses = []; app.bills = []; app.recurringTemplates = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.incomes = []; app.bonuses = []; app.accounts = [];
        app.ledgerAmountOverrides = {};
        return mod.computeSpendingByCategory(app, 2026, 5);
    }""")
    assert result == []
```

- [ ] **Step 2: Run tests to confirm they all fail**

```bash
pytest tests/features/test_spending_analysis.py -v
```

Expected: All 7 FAIL — `import('/src/spending.js')` resolves but `computeSpendingByCategory` is not a function (module doesn't exist yet).

- [ ] **Step 3: Create `src/spending.js` with `computeSpendingByCategory`**

Create `src/spending.js`:

```js
import { getLedgerTransactionsForMonth } from './ledger.js';
import { escapeHtml, formatCurrency } from './utils.js';

export const PALETTE = [
    '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6',
    '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#64748b'
];

const PINNED_COLORS = { 'Debt Payments': '#ef4444', 'Savings': '#10b981' };

export function categoryColor(name) {
    if (Object.prototype.hasOwnProperty.call(PINNED_COLORS, name)) return PINNED_COLORS[name];
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
    return PALETTE[Math.abs(h) % PALETTE.length];
}

function _catForTx(tx) {
    if (tx.type === 'bill' || tx.type === 'expense' || (tx.type === 'recurring' && tx.amount < 0))
        return tx.category || 'Other';
    if (tx.type === 'debt') return 'Debt Payments';
    if (tx.type === 'savings') return 'Savings';
    return null;
}

function _aggregate(txs) {
    const m = new Map();
    for (const tx of txs) {
        const cat = _catForTx(tx);
        if (!cat) continue;
        if (!m.has(cat)) m.set(cat, { total: 0, transactions: [] });
        const b = m.get(cat);
        b.total += Math.abs(tx.amount || 0);
        b.transactions.push(tx);
    }
    return m;
}

export function computeSpendingByCategory(app, year, month) {
    const txs = getLedgerTransactionsForMonth(app, year, month);
    const buckets = _aggregate(txs);

    let py = year, pm = month - 1;
    if (pm < 0) { pm = 11; py--; }
    const priorBuckets = _aggregate(getLedgerTransactionsForMonth(app, py, pm));

    const result = [];
    for (const [category, { total, transactions }] of buckets) {
        const prior = priorBuckets.get(category);
        const changeVsLastMonth = (prior && prior.total > 0) ? (total - prior.total) / prior.total : null;
        result.push({ category, total, transactions, changeVsLastMonth });
    }
    result.sort((a, b) => b.total - a.total);
    return result;
}

export function renderReportsSpending(app) {
    const container = document.getElementById('reportsSpending');
    if (!container) return;
    container.innerHTML = '';
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pytest tests/features/test_spending_analysis.py -v
```

Expected: All 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/spending.js tests/features/test_spending_analysis.py
git commit -m "Add computeSpendingByCategory data layer for Spending Analysis"
```

---

### Task 2: Tab infrastructure + navigation test (TDD)

**Files:**
- Modify: `index.html:638-639` (tab bar + panels)
- Modify: `src/reports.js:1-9` (import), `src/reports.js:45-58` (chart cleanup + call)
- Create: `tests/ui/test_spending_ui.py`

- [ ] **Step 1: Write the failing tab navigation test**

Create `tests/ui/test_spending_ui.py`:

```python
import pytest

def _seed_and_navigate(page):
    """Seed spending data and open the Spending tab."""
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)
    page.evaluate("""() => {
        const app = window.app;
        app.expenses = [
            { id: 9001, name: 'Rent', category: 'Housing', budgetAmount: 950, date: '2026-06-01', accountId: null },
            { id: 9002, name: 'Groceries', category: 'Food', budgetAmount: 180, date: '2026-06-10', accountId: null }
        ];
        app.bills = []; app.recurringTemplates = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.incomes = []; app.bonuses = []; app.accounts = [];
        app.ledgerAmountOverrides = {};
        app._reportMonthOffset = 0;
        app.renderReportsPage();
    }""")
    page.click('[data-rptab="spending"]')
    page.wait_for_timeout(300)


@pytest.mark.ui
def test_spending_tab_exists_and_navigates(app_page):
    """Spending tab button exists and clicking it makes its panel visible."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    btn = page.query_selector('[data-rptab="spending"]')
    assert btn, "Expected a spending tab button with data-rptab='spending'"

    btn.click()
    page.wait_for_timeout(200)

    is_active = page.evaluate('() => document.getElementById("rptPanel-spending")?.classList.contains("rpt-tab-panel--active")')
    assert is_active, "Expected #rptPanel-spending to have class rpt-tab-panel--active after clicking the tab"
```

- [ ] **Step 2: Run to confirm it fails**

```bash
pytest tests/ui/test_spending_ui.py::test_spending_tab_exists_and_navigates -v
```

Expected: FAIL — `btn` is None (tab button not in HTML yet).

- [ ] **Step 3: Add tab button + panel to `index.html`**

In `index.html`, change:
```html
                    <button class="rpt-tab-btn" data-rptab="forecast" aria-selected="false">🔮 Forecast</button>
                </div>
```
to:
```html
                    <button class="rpt-tab-btn" data-rptab="forecast" aria-selected="false">🔮 Forecast</button>
                    <button class="rpt-tab-btn" data-rptab="spending" aria-selected="false">🏷️ Spending</button>
                </div>
```

Then after:
```html
                <div class="rpt-tab-panel" id="rptPanel-forecast">
                    <div id="reportsCashFlowForecast"></div>
                </div>
```
add:
```html
                <div class="rpt-tab-panel" id="rptPanel-spending">
                    <div id="reportsSpending"></div>
                </div>
```

- [ ] **Step 4: Wire `renderReportsSpending` into `src/reports.js`**

In `src/reports.js`, change the import block at the top from:
```js
import { renderCashFlowForecast } from './forecast.js';
```
to:
```js
import { renderCashFlowForecast } from './forecast.js';
import { renderReportsSpending } from './spending.js';
```

In the same file, change the chart cleanup array (lines 45-51) from:
```js
    ['_rptIncomeChart', '_rptBillsChart', '_rptExpChart', '_rptMoneyFlowChart', '_rptOutflowChart', '_rptNetWorthTrendChart', '_rptNetWorthCompositionChart', '_rptForecastChart']
```
to:
```js
    ['_rptIncomeChart', '_rptBillsChart', '_rptExpChart', '_rptMoneyFlowChart', '_rptOutflowChart', '_rptNetWorthTrendChart', '_rptNetWorthCompositionChart', '_rptForecastChart', '_rptSpendingPieChart', '_rptSpendingBarChart']
```

Then change the last line of `renderReportsPage` from:
```js
    renderCashFlowForecast(app);
}
```
to:
```js
    renderCashFlowForecast(app);
    renderReportsSpending(app);
}
```

- [ ] **Step 5: Run to confirm the tab test passes**

```bash
pytest tests/ui/test_spending_ui.py::test_spending_tab_exists_and_navigates -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add index.html src/reports.js src/spending.js tests/ui/test_spending_ui.py
git commit -m "Add Spending tab infrastructure and wire renderReportsSpending"
```

---

### Task 3: Summary strip + ranked list + CSS (TDD)

**Files:**
- Modify: `src/spending.js` (renderReportsSpending body)
- Modify: `styles.css` (append new rules)
- Modify: `tests/ui/test_spending_ui.py` (append test)

- [ ] **Step 1: Write the failing ranked-list test**

Append to `tests/ui/test_spending_ui.py`:

```python
@pytest.mark.ui
def test_spending_ranked_list_shows_categories(app_page):
    """Ranked list rows show the seeded category names after data is loaded."""
    page = app_page
    _seed_and_navigate(page)

    text = page.evaluate('() => document.getElementById("spendingRankedList")?.textContent || ""')
    assert 'Housing' in text, f"Expected 'Housing' in ranked list, got: {text[:200]}"
    assert 'Food' in text, f"Expected 'Food' in ranked list, got: {text[:200]}"
```

- [ ] **Step 2: Run to confirm it fails**

```bash
pytest tests/ui/test_spending_ui.py::test_spending_ranked_list_shows_categories -v
```

Expected: FAIL — `#spendingRankedList` does not exist yet.

- [ ] **Step 3: Implement summary strip + ranked list in `renderReportsSpending`**

In `src/spending.js`, replace the `renderReportsSpending` stub with:

```js
function _getReportDate(app) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + (app._reportMonthOffset || 0), 1);
}

function _changeBadgeHTML(change, prevLabel, cls) {
    if (change === null || change === undefined) return '<span></span>';
    const pct = Math.round(Math.abs(change) * 100);
    const dir = change >= 0 ? '↑' : '↓';
    return `<span class="spending-change-badge ${cls}">${dir} ${pct}% vs ${escapeHtml(prevLabel)}</span>`;
}

function _openSpendingDrilldown(app, catData, year, month) {
    const modal = document.getElementById('spendingDrilldownModal');
    const content = document.getElementById('spendingDrilldownContent');
    if (!modal || !content) return;
    let py = year, pm = month - 1;
    if (pm < 0) { pm = 11; py--; }
    const monthLabel = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const prevLabel = new Date(py, pm, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const typeIcons = { expense: '💸', bill: '🧾', recurring: '🔄', debt: '💳', savings: '💰' };
    const badgeHTML = _changeBadgeHTML(
        catData.changeVsLastMonth, prevLabel,
        catData.changeVsLastMonth >= 0 ? 'spending-badge--up' : 'spending-badge--down'
    );
    const txRows = catData.transactions.map(tx => {
        const d = new Date(tx.date);
        const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const icon = typeIcons[tx.type] || '•';
        return `<div class="spending-modal-tx-row">
            <span class="spending-modal-tx-name">${escapeHtml(tx.name)}</span>
            <span class="spending-modal-tx-meta">${dateStr} ${icon}</span>
            <span class="spending-modal-tx-amt--neg">–${formatCurrency(Math.abs(tx.amount))}</span>
        </div>`;
    }).join('');
    content.innerHTML = `
        <div class="spending-modal-header">
            <div>
                <h3 class="spending-modal-title" id="spendingDrilldownTitle">${escapeHtml(catData.category)} — ${escapeHtml(monthLabel)}</h3>
                <p class="spending-modal-subtitle">${catData.transactions.length} transaction${catData.transactions.length !== 1 ? 's' : ''} · ${formatCurrency(catData.total)}</p>
            </div>
            ${badgeHTML}
        </div>
        <div class="spending-modal-tx-list">${txRows || '<p class="spending-empty-detail">No transactions.</p>'}</div>
        <div class="spending-modal-footer">
            <button class="btn btn-secondary" id="spendingDrilldownClose">Close</button>
        </div>`;
    modal.classList.remove('hidden');
    document.getElementById('spendingDrilldownClose').onclick = () => modal.classList.add('hidden');
    modal.onclick = e => { if (e.target === modal) modal.classList.add('hidden'); };
}

export function renderReportsSpending(app) {
    const container = document.getElementById('reportsSpending');
    if (!container) return;

    if (app._rptSpendingPieChart) { app._rptSpendingPieChart.destroy(); app._rptSpendingPieChart = null; }
    if (app._rptSpendingBarChart) { app._rptSpendingBarChart.destroy(); app._rptSpendingBarChart = null; }

    const d = _getReportDate(app);
    const year = d.getFullYear(), month = d.getMonth();
    const monthLabel = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const categories = computeSpendingByCategory(app, year, month);

    if (categories.length === 0) {
        container.innerHTML = `<p class="spending-empty">No spending data for ${escapeHtml(monthLabel)}. Add expenses, bills, or recurring templates.</p>`;
        return;
    }

    const total = categories.reduce((s, c) => s + c.total, 0);
    let py = year, pm = month - 1;
    if (pm < 0) { pm = 11; py--; }
    const prevLabel = new Date(py, pm, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const prevCats = computeSpendingByCategory(app, py, pm);
    const prevTotal = prevCats.reduce((s, c) => s + c.total, 0);
    const totalChange = prevTotal > 0 ? (total - prevTotal) / prevTotal : null;
    const totalBadge = _changeBadgeHTML(totalChange, prevLabel, totalChange !== null && totalChange >= 0 ? 'spending-badge--up' : 'spending-badge--down');

    const rankedRows = categories.map((cat, i) => {
        const changeHTML = _changeBadgeHTML(cat.changeVsLastMonth, prevLabel,
            cat.changeVsLastMonth !== null && cat.changeVsLastMonth >= 0 ? 'spending-ranked-change--up' : 'spending-ranked-change--down');
        return `<div class="spending-ranked-row" data-spending-cat="${escapeHtml(cat.category)}" role="button" tabindex="0" aria-label="View ${escapeHtml(cat.category)} details">
            <span class="spending-ranked-rank">${i + 1}.</span>
            <span class="spending-ranked-name">${escapeHtml(cat.category)}</span>
            <span class="spending-ranked-total">${formatCurrency(cat.total)}</span>
            ${changeHTML}
        </div>`;
    }).join('');

    container.innerHTML = `
        <div class="spending-summary-strip">
            <span>Total: <strong>${formatCurrency(total)}</strong> · ${escapeHtml(monthLabel)}</span>
            ${totalBadge}
        </div>
        <div class="spending-hero-row">
            <div class="spending-pie-wrap"><canvas id="rptSpendingPieChart"></canvas></div>
            <div class="spending-ranked-list" id="spendingRankedList">${rankedRows}</div>
        </div>
        <div class="spending-bar-section">
            <h4 class="spending-bar-title">6-Month Trend by Category</h4>
            <div class="spending-bar-wrap"><canvas id="rptSpendingBarChart"></canvas></div>
        </div>`;

    const rankedList = document.getElementById('spendingRankedList');
    if (rankedList) {
        rankedList.addEventListener('click', e => {
            const row = e.target.closest('[data-spending-cat]');
            if (!row) return;
            const cat = categories.find(c => c.category === row.getAttribute('data-spending-cat'));
            if (cat) _openSpendingDrilldown(app, cat, year, month);
        });
    }
}
```

- [ ] **Step 4: Append CSS to `styles.css`**

Append at the end of `styles.css`:

```css
/* ── Spending Analysis ───────────────────────────────────────────────────── */
.spending-summary-strip {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
    font-size: 1rem;
    color: var(--text-primary, #1e293b);
}
.spending-change-badge {
    font-size: 0.78rem;
    font-weight: 600;
    padding: 3px 9px;
    border-radius: 9999px;
}
.spending-badge--up   { background: #fee2e2; color: #b91c1c; }
.spending-badge--down { background: #dcfce7; color: #15803d; }
body.dark-mode .spending-badge--up   { background: #450a0a; color: #fca5a5; }
body.dark-mode .spending-badge--down { background: #052e16; color: #86efac; }

.spending-hero-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-bottom: 28px;
    align-items: start;
}
.spending-pie-wrap { position: relative; height: 280px; }

.spending-ranked-list { display: flex; flex-direction: column; gap: 6px; }
.spending-ranked-row {
    display: grid;
    grid-template-columns: 28px 1fr auto auto;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 8px;
    background: #f8fafc;
    cursor: pointer;
    transition: background 0.15s;
    border: none;
}
body.dark-mode .spending-ranked-row { background: #1e293b; }
.spending-ranked-row:hover { background: #f1f5f9; }
body.dark-mode .spending-ranked-row:hover { background: #334155; }
.spending-ranked-rank  { font-weight: 700; color: #64748b; font-size: 0.85rem; }
.spending-ranked-name  { font-weight: 500; color: #1e293b; }
.spending-ranked-total { font-weight: 700; color: #1e293b; }
body.dark-mode .spending-ranked-name,
body.dark-mode .spending-ranked-total { color: #e2e8f0; }
.spending-ranked-change--up   { font-size: 0.78rem; font-weight: 600; color: #b91c1c; }
.spending-ranked-change--down { font-size: 0.78rem; font-weight: 600; color: #15803d; }
body.dark-mode .spending-ranked-change--up   { color: #fca5a5; }
body.dark-mode .spending-ranked-change--down { color: #86efac; }

.spending-bar-section { margin-top: 8px; }
.spending-bar-title { font-size: 0.9rem; font-weight: 600; color: #1e293b; margin: 0 0 8px; }
body.dark-mode .spending-bar-title { color: #e2e8f0; }
.spending-bar-wrap { position: relative; height: 280px; }

.spending-empty {
    text-align: center;
    color: #64748b;
    padding: 48px 0;
    font-size: 0.95rem;
}

/* Spending drill-down modal */
.spending-modal-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 16px;
}
.spending-modal-title    { font-size: 1.05rem; font-weight: 700; margin: 0 0 4px; }
.spending-modal-subtitle { font-size: 0.85rem; color: #64748b; margin: 0; }
.spending-modal-tx-list  {
    max-height: 320px;
    overflow-y: auto;
    border-top: 1px solid #e5e7eb;
    margin-bottom: 16px;
}
body.dark-mode .spending-modal-tx-list { border-top-color: #374151; }
.spending-modal-tx-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 8px;
    padding: 9px 0;
    border-bottom: 1px solid #f1f5f9;
    align-items: center;
}
body.dark-mode .spending-modal-tx-row { border-bottom-color: #1e293b; }
.spending-modal-tx-name { font-weight: 500; color: #1e293b; }
body.dark-mode .spending-modal-tx-name { color: #e2e8f0; }
.spending-modal-tx-meta { font-size: 0.8rem; color: #64748b; }
.spending-modal-tx-amt--neg { color: #b91c1c; font-weight: 600; font-size: 0.9rem; }
body.dark-mode .spending-modal-tx-amt--neg { color: #fca5a5; }
.spending-modal-footer  { text-align: right; }
.spending-empty-detail  { text-align: center; color: #64748b; padding: 16px 0; }

@media (max-width: 640px) {
    .spending-hero-row    { grid-template-columns: 1fr; }
    .spending-pie-wrap    { height: 220px; }
}
```

- [ ] **Step 5: Run to confirm ranked list test passes**

```bash
pytest tests/ui/test_spending_ui.py::test_spending_ranked_list_shows_categories -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/spending.js styles.css tests/ui/test_spending_ui.py
git commit -m "Add Spending Analysis summary strip, ranked list, and CSS"
```

---

### Task 4: Doughnut pie chart (TDD)

**Files:**
- Modify: `src/spending.js` (add pie chart rendering after innerHTML)
- Modify: `tests/ui/test_spending_ui.py` (append test)

- [ ] **Step 1: Write the failing pie chart test**

Append to `tests/ui/test_spending_ui.py`:

```python
@pytest.mark.ui
def test_spending_pie_chart_renders(app_page):
    """A canvas element for the pie chart is present after navigating to the Spending tab."""
    page = app_page
    _seed_and_navigate(page)

    canvas = page.query_selector('#rptSpendingPieChart')
    assert canvas, "Expected canvas#rptSpendingPieChart to exist after rendering the Spending tab"
    chart_exists = page.evaluate('() => !!(window.app._rptSpendingPieChart)')
    assert chart_exists, "Expected app._rptSpendingPieChart to be a Chart instance"
```

- [ ] **Step 2: Run to confirm it fails**

```bash
pytest tests/ui/test_spending_ui.py::test_spending_pie_chart_renders -v
```

Expected: FAIL — `app._rptSpendingPieChart` is null (canvas exists from Task 3 HTML but chart not yet created).

- [ ] **Step 3: Add pie chart rendering to `renderReportsSpending`**

In `src/spending.js`, at the end of `renderReportsSpending` (after the `rankedList.addEventListener` block), add:

```js
    // Pie chart
    const pieCvs = document.getElementById('rptSpendingPieChart');
    if (pieCvs && typeof Chart !== 'undefined') {
        app._rptSpendingPieChart = new Chart(pieCvs, {
            type: 'doughnut',
            data: {
                labels: categories.map(c => c.category),
                datasets: [{
                    data: categories.map(c => c.total),
                    backgroundColor: categories.map(c => categoryColor(c.category)),
                    borderWidth: 2,
                    borderColor: '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                onClick: (event, elements) => {
                    if (!elements.length) return;
                    const cat = categories[elements[0].index];
                    _openSpendingDrilldown(app, cat, year, month);
                },
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
                    tooltip: {
                        callbacks: {
                            label: ctx => ` ${ctx.label}: ${formatCurrency(ctx.parsed)}`
                        }
                    }
                }
            }
        });
    }
```

- [ ] **Step 4: Run to confirm it passes**

```bash
pytest tests/ui/test_spending_ui.py::test_spending_pie_chart_renders -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/spending.js tests/ui/test_spending_ui.py
git commit -m "Add doughnut pie chart to Spending Analysis tab"
```

---

### Task 5: 6-month stacked bar chart (TDD)

**Files:**
- Modify: `src/spending.js` (add bar chart rendering)
- Modify: `tests/ui/test_spending_ui.py` (append test)

- [ ] **Step 1: Write the failing bar chart test**

Append to `tests/ui/test_spending_ui.py`:

```python
@pytest.mark.ui
def test_spending_bar_chart_renders(app_page):
    """A canvas element for the stacked bar chart exists after navigating to Spending tab."""
    page = app_page
    _seed_and_navigate(page)

    canvas = page.query_selector('#rptSpendingBarChart')
    assert canvas, "Expected canvas#rptSpendingBarChart to exist"
    chart_exists = page.evaluate('() => !!(window.app._rptSpendingBarChart)')
    assert chart_exists, "Expected app._rptSpendingBarChart to be a Chart instance"
```

- [ ] **Step 2: Run to confirm it fails**

```bash
pytest tests/ui/test_spending_ui.py::test_spending_bar_chart_renders -v
```

Expected: FAIL — `app._rptSpendingBarChart` is null.

- [ ] **Step 3: Add bar chart rendering to `renderReportsSpending`**

Add a helper at module level in `src/spending.js` (before `renderReportsSpending`):

```js
function _hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}
```

Then at the end of `renderReportsSpending` (after the pie chart block), add:

```js
    // 6-month stacked bar chart
    const barCvs = document.getElementById('rptSpendingBarChart');
    if (barCvs && typeof Chart !== 'undefined') {
        // Build 6 months ending at current month
        const months = [];
        for (let i = 5; i >= 0; i--) {
            let bm = month - i, by = year;
            if (bm < 0) { bm += 12; by--; }
            months.push({ year: by, month: bm, label: new Date(by, bm, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) });
        }
        const monthCats = months.map(({ year: by, month: bm }) => computeSpendingByCategory(app, by, bm));

        // Union of all category names
        const allCatNames = [...new Set(monthCats.flatMap(mc => mc.map(c => c.category)))];

        const barDatasets = allCatNames.map(cat => {
            const color = categoryColor(cat);
            return {
                label: cat,
                data: monthCats.map(mc => { const found = mc.find(c => c.category === cat); return found ? found.total : 0; }),
                backgroundColor: monthCats.map((_, idx) => idx === 5 ? color : _hexToRgba(color, 0.5)),
                borderWidth: 0
            };
        });

        app._rptSpendingBarChart = new Chart(barCvs, {
            type: 'bar',
            data: { labels: months.map(m => m.label), datasets: barDatasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { stacked: true },
                    y: { stacked: true, ticks: { callback: v => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v) } }
                },
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
                    tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}` } }
                }
            }
        });
    }
```

- [ ] **Step 4: Run to confirm it passes**

```bash
pytest tests/ui/test_spending_ui.py::test_spending_bar_chart_renders -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/spending.js tests/ui/test_spending_ui.py
git commit -m "Add 6-month stacked bar trend chart to Spending Analysis"
```

---

### Task 6: Drill-down modal (TDD)

**Files:**
- Modify: `index.html` (add modal div before `</body>`)
- Modify: `tests/ui/test_spending_ui.py` (append 3 tests)

Note: `_openSpendingDrilldown` and the ranked-list click handler were already added in Task 3. This task adds the modal div to `index.html` (which `_openSpendingDrilldown` requires) and the tests that exercise it.

- [ ] **Step 1: Write the three failing modal tests**

Append to `tests/ui/test_spending_ui.py`:

```python
@pytest.mark.ui
def test_spending_ranked_row_opens_modal(app_page):
    """Clicking a ranked list row opens the drill-down modal showing the category name."""
    page = app_page
    _seed_and_navigate(page)

    row = page.query_selector('[data-spending-cat="Housing"]')
    assert row, "Expected a ranked row for 'Housing'"
    row.click()
    page.wait_for_timeout(200)

    modal_visible = page.is_visible('#spendingDrilldownModal')
    assert modal_visible, "Expected the drill-down modal to be visible after clicking a ranked row"

    title_text = page.evaluate('() => document.getElementById("spendingDrilldownTitle")?.textContent || ""')
    assert 'Housing' in title_text, f"Expected modal title to contain 'Housing', got: {title_text}"


@pytest.mark.ui
def test_spending_modal_shows_transactions(app_page):
    """The drill-down modal body lists the individual transaction names."""
    page = app_page
    _seed_and_navigate(page)

    page.click('[data-spending-cat="Housing"]')
    page.wait_for_timeout(200)

    tx_list = page.evaluate('() => document.querySelector(".spending-modal-tx-list")?.textContent || ""')
    assert 'Rent' in tx_list, f"Expected 'Rent' transaction in modal body, got: {tx_list[:200]}"


@pytest.mark.ui
def test_spending_modal_close_button_dismisses(app_page):
    """Clicking the Close button hides the modal."""
    page = app_page
    _seed_and_navigate(page)

    page.click('[data-spending-cat="Housing"]')
    page.wait_for_timeout(200)
    assert page.is_visible('#spendingDrilldownModal'), "Modal should be visible before closing"

    page.click('#spendingDrilldownClose')
    page.wait_for_timeout(200)
    assert not page.is_visible('#spendingDrilldownModal'), "Modal should be hidden after clicking Close"
```

- [ ] **Step 2: Run to confirm they fail**

```bash
pytest tests/ui/test_spending_ui.py::test_spending_ranked_row_opens_modal tests/ui/test_spending_ui.py::test_spending_modal_shows_transactions tests/ui/test_spending_ui.py::test_spending_modal_close_button_dismisses -v
```

Expected: All FAIL — `#spendingDrilldownModal` does not exist.

- [ ] **Step 3: Add the modal div to `index.html`**

In `index.html`, immediately before `</body>`, after the last existing modal (`</div>` that closes `reconcileModal`), add:

```html
    <!-- Spending Category Drill-Down Modal -->
    <div id="spendingDrilldownModal" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="spendingDrilldownTitle" tabindex="-1">
        <div class="modal-content" id="spendingDrilldownContent">
        </div>
    </div>
```

- [ ] **Step 4: Run to confirm modal tests pass**

```bash
pytest tests/ui/test_spending_ui.py::test_spending_ranked_row_opens_modal tests/ui/test_spending_ui.py::test_spending_modal_shows_transactions tests/ui/test_spending_ui.py::test_spending_modal_close_button_dismisses -v
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/ui/test_spending_ui.py
git commit -m "Add drill-down modal for Spending Analysis category detail"
```

---

### Task 7: Empty state (TDD)

**Files:**
- Modify: `tests/ui/test_spending_ui.py` (append test)

Note: The empty-state message was already added in `renderReportsSpending` in Task 3 (the early-return branch). This task adds the test that exercises it.

- [ ] **Step 1: Write the failing empty state test**

Append to `tests/ui/test_spending_ui.py`:

```python
@pytest.mark.ui
def test_spending_empty_state_message(app_page):
    """When there is no spending data, an informational message is shown instead of charts."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)
    page.evaluate("""() => {
        const app = window.app;
        app.expenses = []; app.bills = []; app.recurringTemplates = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.incomes = []; app.bonuses = []; app.accounts = [];
        app.ledgerAmountOverrides = {};
        app._reportMonthOffset = 0;
        app.renderReportsPage();
    }""")
    page.click('[data-rptab="spending"]')
    page.wait_for_timeout(300)

    empty = page.query_selector('.spending-empty')
    assert empty, "Expected a .spending-empty element when there is no spending data"
    ranked = page.query_selector('#spendingRankedList')
    assert not ranked, "Expected no ranked list when there is no spending data"
```

- [ ] **Step 2: Run to confirm it fails**

```bash
pytest tests/ui/test_spending_ui.py::test_spending_empty_state_message -v
```

Expected: FAIL — `.spending-empty` is not present (the empty-state branch hasn't been triggered or the element is missing).

Note: If Task 3's implementation already included the empty-state branch and it works, this test may pass immediately. If so, skip to Step 4.

- [ ] **Step 3: Verify the empty-state branch exists in `renderReportsSpending`**

Confirm `src/spending.js` contains this block (added in Task 3):

```js
    if (categories.length === 0) {
        container.innerHTML = `<p class="spending-empty">No spending data for ${escapeHtml(monthLabel)}. Add expenses, bills, or recurring templates.</p>`;
        return;
    }
```

If missing, add it now (between the chart cleanup block and the `total` computation).

- [ ] **Step 4: Run to confirm it passes**

```bash
pytest tests/ui/test_spending_ui.py::test_spending_empty_state_message -v
```

Expected: PASS.

- [ ] **Step 5: Run the full spending UI suite to check for regressions**

```bash
pytest tests/ui/test_spending_ui.py -v
```

Expected: All 8 PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/ui/test_spending_ui.py
git commit -m "Add empty state test for Spending Analysis tab"
```

---

### Task 8: XSS security test

**Files:**
- Modify: `tests/security/test_xss.py` (append one test)

- [ ] **Step 1: Append the XSS test**

Append to `tests/security/test_xss.py`:

```python
@pytest.mark.security
def test_xss_in_spending_category_name(app_page):
    """Category names containing HTML tags are escaped in the Spending tab ranked list and modal."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)
    page.evaluate("""() => {
        const app = window.app;
        app.expenses = [{ id: 8801, name: 'Unsafe item', category: '<script>window._xssSpendingFired=true</script>', budgetAmount: 99, date: '2026-06-01', accountId: null }];
        app.bills = []; app.recurringTemplates = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.incomes = []; app.bonuses = []; app.accounts = [];
        app.ledgerAmountOverrides = {};
        app._reportMonthOffset = 0;
        app.renderReportsPage();
    }""")
    page.click('[data-rptab="spending"]')
    page.wait_for_timeout(300)

    xss_fired = page.evaluate('() => !!window._xssSpendingFired')
    assert not xss_fired, "XSS script should not have executed in the spending ranked list"

    raw_tag = page.evaluate('() => document.getElementById("spendingRankedList")?.innerHTML.includes("<script>")')
    assert not raw_tag, "Raw <script> tag should not appear in ranked list innerHTML — it must be escaped"
```

- [ ] **Step 2: Run the test**

```bash
pytest tests/security/test_xss.py::test_xss_in_spending_category_name -v
```

Expected: PASS — `escapeHtml()` is already applied in Task 3's `renderReportsSpending`.

- [ ] **Step 3: Commit**

```bash
git add tests/security/test_xss.py
git commit -m "Add XSS security test for Spending Analysis category names"
```

---

### Task 9: Documentation + version bump

**Files:**
- Modify: `src/utils.js:3`
- Modify: `ROADMAP.md`
- Modify: `README.md`
- Modify: `guide.html`

- [ ] **Step 1: Bump `APP_VERSION` in `src/utils.js`**

In `src/utils.js`, change:
```js
export const APP_VERSION = '3.5.0';
```
to:
```js
export const APP_VERSION = '3.6.0';
```

- [ ] **Step 2: Update `ROADMAP.md` — At a Glance table**

In `ROADMAP.md`, in the At a Glance table, change:
```
| Spending Analysis by Category | 2 | 📋 | |
```
to:
```
| Spending Analysis by Category | 2 | ✅ | Delivered June 15, 2026 |
```

- [ ] **Step 3: Update `ROADMAP.md` — header version and date**

Change:
```
**Last Updated**: June 14, 2026  
**Current Version**: v3.5.0  
```
to:
```
**Last Updated**: June 15, 2026  
**Current Version**: v3.6.0  
```

- [ ] **Step 4: Update `ROADMAP.md` — footer date**

Change the last line:
```
**Last Updated**: June 14, 2026
```
to:
```
**Last Updated**: June 15, 2026
```

- [ ] **Step 5: Update `ROADMAP.md` — Spending Analysis section body**

In the Tier 2 "Spending Analysis by Category" section, change the status line from:
```
**Priority**: MEDIUM | **Effort**: MEDIUM | **Status**: PROPOSED
```
to:
```
**Priority**: MEDIUM | **Effort**: MEDIUM | **Status**: ✅ DELIVERED June 15, 2026
```

- [ ] **Step 6: Add README subsection**

In `README.md`, after the "Recurring Template 'Mark as Paid This Month' (NEW)" subsection (after its last bullet), add:

```markdown

### Spending Analysis by Category (NEW)
- **Spending Tab in Reports** — a dedicated "🏷️ Spending" tab joins the existing Calendar, Income vs Expenses, Money Flow, What Changed, Net Worth, and Forecast tabs
- **Doughnut Pie Chart** — visual slice-by-slice breakdown of all outflows (expenses, bills, recurring subscriptions, debt minimums, savings contributions) for the selected month; click a slice to drill down
- **Ranked Category List** — categories sorted by total spend with month-over-month % change badges (↑/↓)
- **6-Month Stacked Bar Trend** — current month highlighted at full opacity; prior 5 months at reduced opacity; category union taken across all 6 months so no data is missing
- **Drill-Down Modal** — click any category row or pie slice to see the individual transactions (name, date, type icon, amount)
```

- [ ] **Step 7: Update README footer**

Change:
```
*MyFinances v3.5.0 — Updated June 14, 2026*
```
to:
```
*MyFinances v3.6.0 — Updated June 15, 2026*
```

- [ ] **Step 8: Add guide.html section**

In `guide.html`, find the Reports section. After the last existing subsection in the Reports section (before `</section>`), add:

```html
                <h3>Spending by Category</h3>
                <p>The <strong>🏷️ Spending</strong> tab provides a visual breakdown of where money is going for the selected month.</p>
                <ul>
                    <li><strong>Pie Chart</strong> — doughnut chart showing each spending category as a proportional slice; click a slice to open the drill-down modal</li>
                    <li><strong>Ranked List</strong> — categories sorted by total spend, with a month-over-month % change badge (↑ red if higher, ↓ green if lower); click any row to drill down</li>
                    <li><strong>6-Month Trend</strong> — stacked bar chart showing how total spending and category mix have changed over the past 6 months; the current month is highlighted at full opacity</li>
                    <li><strong>Drill-Down Modal</strong> — lists every transaction in the selected category for the month, with its date, source type, and amount</li>
                </ul>
                <div class="guide-note">All outflow types count toward spending: expenses, bills, recurring template outflows, debt minimum payments, and savings contributions. Income and reimbursements are excluded.</div>
```

- [ ] **Step 9: Verify no stale version references remain**

```bash
grep -n "v3.5.0\|June 14, 2026" ROADMAP.md README.md
```

Expected: No output.

- [ ] **Step 10: Commit**

```bash
git add src/utils.js ROADMAP.md README.md guide.html
git commit -m "Bump APP_VERSION to 3.6.0 and document Spending Analysis feature"
```

---

## Final Check

- [ ] Run the full test suite:

```bash
pytest tests/ -v
```

Expected: All tests PASS (200 existing + 16 new = 216 total, no regressions).
