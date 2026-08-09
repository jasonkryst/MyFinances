# Money Flow Sankey Diagram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-month Sankey-style flow diagram (Income sources → Account hub → Outflow categories) to the Reports → Money Flow tab, as hand-drawn inline SVG with no new external dependency.

**Architecture:** A new module `src/reportsMoneyFlowSankey.js` exports a pure data function (`computeMoneyFlowSankeyData`) that groups the month's ledger transactions into nodes/links, and a render function (`renderMoneyFlowSankey`) that lays out and draws them as inline SVG (bezier-ribbon links, rect nodes) into a new container above the existing Money Flow charts. Colors and category grouping reuse the conventions already established in `reportsCashFlow.js`.

**Tech Stack:** Vanilla ES6 modules, hand-built inline SVG (no charting library), Playwright/pytest for tests.

## Global Constraints

- No new external dependency — Chart.js (CDN) remains the app's only external dependency (`CLAUDE.md`).
- No `style="..."` attributes anywhere in generated markup — the CSP is `style-src 'self'`; all SVG presentation must use presentational attributes (`fill`, `x`, `y`, etc.), never the `style` attribute.
- All user-supplied text (category/source/debt/savings names) must go through `escapeHtml()` (from `src/utils.js`) before being placed into any `innerHTML` string.
- Every persisted-field/module addition that touches the module list in `CLAUDE.md`'s feature-module bullet must be added there.
- `APP_VERSION` (`src/utils.js`) and the top `CHANGELOG.md` heading must be bumped together, in lockstep (enforced by `tests/features/test_versioning.py`).
- Tests assume the app is served at `http://localhost:5500/` — start `python -m http.server 5500` before running `pytest`.

---

### Task 1: Data layer — `computeMoneyFlowSankeyData`

**Files:**
- Create: `src/reportsMoneyFlowSankey.js`
- Modify: `src/app.js` (add import + delegating method)
- Test: `tests/features/test_money_flow_sankey.py`

**Interfaces:**
- Produces: `computeMoneyFlowSankeyData(app, year, month)` → `{ nodes, links, hasData }` where:
  - `nodes`: `Array<{ id: string, label: string, column: 0|1|2, amount: number, color: string }>` — exactly one `column: 1` node (`label: 'Account'`).
  - `links`: `Array<{ sourceId: string, targetId: string, amount: number, color: string }>`.
  - `hasData`: `boolean` — `true` iff the month has any income or outflow.
  - Exposed on the app instance as `app.computeMoneyFlowSankeyData(year, month)` (delegating method, mirrors the existing `app.getCashFlowTrendSeries(months)` pattern in `src/app.js`).

- [ ] **Step 1: Write the failing tests**

Create `tests/features/test_money_flow_sankey.py`:

```python
#!/usr/bin/env python3
"""
Money Flow Sankey diagram tests (GitHub issue #79).

computeMoneyFlowSankeyData(app, year, month) groups a month's ledger
transactions into Sankey nodes/links: income sources -> a single "Account"
hub -> outflow categories (bills/expenses/recurring by category, debts/
savings by name). These tests exercise the data layer directly via
window.app.computeMoneyFlowSankeyData before any DOM rendering exists
(Task 1). DOM-level rendering tests are in the same file, added by Task 2.
"""

import pytest


def _find_node(nodes, label):
    return next((n for n in nodes if n['label'] == label), None)


def _link_amount(data, source_label, target_label):
    source_id = next((n['id'] for n in data['nodes'] if n['label'] == source_label), None)
    target_id = next((n['id'] for n in data['nodes'] if n['label'] == target_label), None)
    link = next((l for l in data['links']
                 if l['sourceId'] == source_id and l['targetId'] == target_id), None)
    return link['amount'] if link else None


@pytest.mark.feature
def test_money_flow_sankey_data_groups_by_category(app_page):
    """Income groups by source name; bills/expenses group by category;
    debts/savings group by name. Each leaf node gets exactly one link
    to/from the single Account hub, and income > outflow produces a
    Surplus node/link for the difference."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        app.incomes = [
            { id: 1, name: 'Salary', amount: 3000, accountId: 1, frequency: 'monthly', firstPayDate: `${y}-${m}-01` },
            { id: 2, name: 'Freelance', amount: 500, accountId: 1, frequency: 'monthly', firstPayDate: `${y}-${m}-15` }
        ];
        app.bills = [{ id: 1, name: 'Rent', amount: 1200, dueDay: 1, accountId: 1, category: 'Housing' }];
        app.expenses = [{ id: 1, name: 'Groceries', budgetAmount: 300, date: `${y}-${m}-05`, accountId: 1, category: 'Food' }];
        app.debts = [{ id: 1, name: 'Credit Card', minimumPayment: 100, dueDate: 10, accountId: 1 }];
        app.recurringTemplates = [];
        app.emergencyFunds = [];
        app.sinkingFunds = [{ id: 1, name: 'Vacation Fund', accountId: 1, autoContribute: true, monthlyAllocation: 150, currentAmount: 0, targetAmount: 5000 }];
        app.monthlySnapshots = [];
        app._reportMonthOffset = 0;
        window.__y = y; window.__m = now.getMonth();
    }""")

    data = page.evaluate("() => window.app.computeMoneyFlowSankeyData(window.__y, window.__m)")

    assert data['hasData'] is True

    account = next(n for n in data['nodes'] if n['column'] == 1)
    assert account['label'] == 'Account'
    assert round(account['amount'], 2) == 3500.0

    salary = _find_node(data['nodes'], 'Salary')
    freelance = _find_node(data['nodes'], 'Freelance')
    assert salary and round(salary['amount'], 2) == 3000.0
    assert freelance and round(freelance['amount'], 2) == 500.0

    housing = _find_node(data['nodes'], '🧾 Housing')
    food = _find_node(data['nodes'], '💸 Food')
    debt = _find_node(data['nodes'], '💳 Credit Card')
    savings = _find_node(data['nodes'], '💰 Vacation Fund')
    assert housing and round(housing['amount'], 2) == 1200.0
    assert food and round(food['amount'], 2) == 300.0
    assert debt and round(debt['amount'], 2) == 100.0
    assert savings and round(savings['amount'], 2) == 150.0

    surplus = _find_node(data['nodes'], 'Surplus')
    assert surplus and round(surplus['amount'], 2) == 1750.0
    assert _find_node(data['nodes'], 'Shortfall') is None

    assert round(_link_amount(data, 'Salary', 'Account'), 2) == 3000.0
    assert round(_link_amount(data, 'Account', '🧾 Housing'), 2) == 1200.0
    assert round(_link_amount(data, 'Account', 'Surplus'), 2) == 1750.0


@pytest.mark.feature
def test_money_flow_sankey_data_shortfall_when_outflow_exceeds_income(app_page):
    """When outflow > income, a Shortfall node/link (Shortfall -> Account)
    covers the gap instead of a Surplus node."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        app.incomes = [{ id: 1, name: 'Salary', amount: 1000, accountId: 1, frequency: 'monthly', firstPayDate: `${y}-${m}-01` }];
        app.bills = [{ id: 1, name: 'Rent', amount: 1500, dueDay: 1, accountId: 1, category: 'Housing' }];
        app.expenses = []; app.debts = []; app.recurringTemplates = [];
        app.emergencyFunds = []; app.sinkingFunds = []; app.monthlySnapshots = [];
        app._reportMonthOffset = 0;
        window.__y = y; window.__m = now.getMonth();
    }""")

    data = page.evaluate("() => window.app.computeMoneyFlowSankeyData(window.__y, window.__m)")

    assert data['hasData'] is True
    shortfall = _find_node(data['nodes'], 'Shortfall')
    assert shortfall and round(shortfall['amount'], 2) == 500.0
    assert _find_node(data['nodes'], 'Surplus') is None
    assert round(_link_amount(data, 'Shortfall', 'Account'), 2) == 500.0

    account = next(n for n in data['nodes'] if n['column'] == 1)
    assert round(account['amount'], 2) == 1500.0


@pytest.mark.feature
def test_money_flow_sankey_data_balanced_month_has_no_extra_node(app_page):
    """When income exactly equals outflow, no Surplus/Shortfall node or
    link is added."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        app.incomes = [{ id: 1, name: 'Salary', amount: 1000, accountId: 1, frequency: 'monthly', firstPayDate: `${y}-${m}-01` }];
        app.bills = [{ id: 1, name: 'Rent', amount: 1000, dueDay: 1, accountId: 1, category: 'Housing' }];
        app.expenses = []; app.debts = []; app.recurringTemplates = [];
        app.emergencyFunds = []; app.sinkingFunds = []; app.monthlySnapshots = [];
        app._reportMonthOffset = 0;
        window.__y = y; window.__m = now.getMonth();
    }""")

    data = page.evaluate("() => window.app.computeMoneyFlowSankeyData(window.__y, window.__m)")

    assert data['hasData'] is True
    assert _find_node(data['nodes'], 'Surplus') is None
    assert _find_node(data['nodes'], 'Shortfall') is None
    assert len(data['links']) == 2  # Salary->Account, Account->Housing only


@pytest.mark.feature
def test_money_flow_sankey_data_empty_state(app_page):
    """With no income/expense/bill/debt/recurring data at all, hasData is
    false."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        app.accounts = []; app.debts = []; app.bills = []; app.expenses = [];
        app.incomes = []; app.recurringTemplates = []; app.emergencyFunds = [];
        app.sinkingFunds = []; app.monthlySnapshots = [];
        app._reportMonthOffset = 0;
        window.__y = now.getFullYear(); window.__m = now.getMonth();
    }""")

    data = page.evaluate("() => window.app.computeMoneyFlowSankeyData(window.__y, window.__m)")
    assert data['hasData'] is False
```

- [ ] **Step 2: Run tests to verify they fail**

Start the server first (leave it running in a separate terminal): `python -m http.server 5500`

Run: `pytest tests/features/test_money_flow_sankey.py -v`
Expected: FAIL — `window.app.computeMoneyFlowSankeyData is not a function` (or similar) for all four tests.

- [ ] **Step 3: Create `src/reportsMoneyFlowSankey.js` with `computeMoneyFlowSankeyData`**

```js
// Reports page: single-month Money Flow Sankey diagram (issue #79)

import { escapeHtml, getReportDate, formatCurrency, renderChartDataTable } from './utils.js';
import { getLedgerTransactionsForMonth } from './ledgerTransactions.js';
import { computeMonthCashFlowTotals } from './reportsCashFlow.js';

const INCOME_COLORS = ['#10b981', '#34d399', '#6ee7b7', '#a7f3d0', '#059669', '#047857', '#065f46'];

const OUTFLOW_GROUPS = [
    { icon: '🧾', color: '#f59e0b', match: tx => tx.type === 'bill', key: tx => tx.category || 'Other' },
    { icon: '💸', color: '#8b5cf6', match: tx => tx.type === 'expense', key: tx => tx.category || 'Other' },
    { icon: '🔄', color: '#06b6d4', match: tx => tx.type === 'recurring' && tx.amount < 0, key: tx => tx.category || 'Other' },
    { icon: '💳', color: '#ef4444', match: tx => tx.type === 'debt', key: tx => tx.name || 'Debt' },
    { icon: '💰', color: '#10b981', match: tx => tx.type === 'savings', key: tx => tx.name || 'Savings' }
];

const ACCOUNT_COLOR = '#2563eb';
const SURPLUS_COLOR = '#10b981';
const SHORTFALL_COLOR = '#ef4444';
const BALANCE_EPSILON = 0.005;

export function computeMoneyFlowSankeyData(app, year, month) {
    const monthTxs = getLedgerTransactionsForMonth(app, year, month);
    const totals = computeMonthCashFlowTotals(app, year, month);
    const balancedTotal = Math.max(totals.income, totals.outflow);
    const hasData = totals.income > 0 || totals.outflow > 0;

    const nodes = [];
    const links = [];
    let nodeSeq = 0;
    const nextId = () => `n${nodeSeq++}`;

    const accountId = nextId();
    nodes.push({ id: accountId, label: 'Account', column: 1, amount: balancedTotal, color: ACCOUNT_COLOR });

    const incomeBySource = {};
    for (const tx of monthTxs) {
        const isIncome = tx.type === 'income' || tx.type === 'bonus' || tx.type === 'interest' ||
            (tx.type === 'recurring' && tx.amount >= 0);
        if (!isIncome) continue;
        incomeBySource[tx.name] = (incomeBySource[tx.name] || 0) + tx.amount;
    }
    let colorIdx = 0;
    for (const [name, amount] of Object.entries(incomeBySource)) {
        if (amount <= 0) continue;
        const id = nextId();
        const color = INCOME_COLORS[colorIdx % INCOME_COLORS.length];
        colorIdx++;
        nodes.push({ id, label: name, column: 0, amount, color });
        links.push({ sourceId: id, targetId: accountId, amount, color });
    }

    for (const group of OUTFLOW_GROUPS) {
        const grouped = {};
        for (const tx of monthTxs) {
            if (!group.match(tx)) continue;
            const key = group.key(tx);
            grouped[key] = (grouped[key] || 0) + Math.abs(tx.amount || 0);
        }
        for (const [key, amount] of Object.entries(grouped)) {
            if (amount <= 0) continue;
            const id = nextId();
            const label = `${group.icon} ${key}`;
            nodes.push({ id, label, column: 2, amount, color: group.color });
            links.push({ sourceId: accountId, targetId: id, amount, color: group.color });
        }
    }

    const netDiff = totals.income - totals.outflow;
    if (netDiff > BALANCE_EPSILON) {
        const id = nextId();
        nodes.push({ id, label: 'Surplus', column: 2, amount: netDiff, color: SURPLUS_COLOR });
        links.push({ sourceId: accountId, targetId: id, amount: netDiff, color: SURPLUS_COLOR });
    } else if (netDiff < -BALANCE_EPSILON) {
        const id = nextId();
        const amount = Math.abs(netDiff);
        nodes.push({ id, label: 'Shortfall', column: 0, amount, color: SHORTFALL_COLOR });
        links.push({ sourceId: id, targetId: accountId, amount, color: SHORTFALL_COLOR });
    }

    return { nodes, links, hasData };
}
```

(Leave `renderMoneyFlowSankey` out for now — Task 2 adds it to this same file.)

- [ ] **Step 4: Wire the delegating method into `src/app.js`**

Add to the import block near the existing `getCashFlowTrendSeries` import (around `src/app.js:85-87`):

```js
import {
    getCashFlowTrendSeries as getCashFlowTrendSeriesFeature
} from './reportsCashFlow.js';
import {
    computeMoneyFlowSankeyData as computeMoneyFlowSankeyDataFeature
} from './reportsMoneyFlowSankey.js';
```

Add the delegating method next to `getCashFlowTrendSeries(months)` (around `src/app.js:825-827`):

```js
    getCashFlowTrendSeries(months) {
        return getCashFlowTrendSeriesFeature(this, months);
    }

    computeMoneyFlowSankeyData(year, month) {
        return computeMoneyFlowSankeyDataFeature(this, year, month);
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/features/test_money_flow_sankey.py -v`
Expected: PASS — all 4 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/reportsMoneyFlowSankey.js src/app.js tests/features/test_money_flow_sankey.py
git commit -m "feat: compute Money Flow Sankey diagram data (#79)"
```

---

### Task 2: SVG rendering + page wiring

**Files:**
- Modify: `src/reportsMoneyFlowSankey.js` (add `renderMoneyFlowSankey`)
- Modify: `src/reports.js` (call it from `renderReportsPage`)
- Modify: `index.html` (new container div)
- Modify: `styles.css` (layout classes for the new container)
- Test: `tests/features/test_money_flow_sankey.py` (append DOM-level tests)

**Interfaces:**
- Consumes: `computeMoneyFlowSankeyData(app, year, month)` from Task 1 (`{ nodes, links, hasData }`), `getReportDate(app)`, `escapeHtml`, `formatCurrency`, `renderChartDataTable` (all from `src/utils.js`).
- Produces: `renderMoneyFlowSankey(app)` — renders into `#reportsMoneyFlowSankey`. No return value. No new state on `app` (reads `getReportDate(app)` directly, like `renderReportsMoneyFlow`).

- [ ] **Step 1: Write the failing DOM-level tests**

Append to `tests/features/test_money_flow_sankey.py`:

```python
@pytest.mark.feature
def test_money_flow_sankey_empty_state_renders_no_svg(app_page):
    """With no data at all, the Sankey section shows its empty-state
    message and creates no <svg>."""
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

    section_text = page.query_selector('#reportsMoneyFlowSankey').text_content()
    assert 'Add income, bills, debts' in section_text, \
        f"Expected empty Sankey state, got: {section_text}"
    assert page.query_selector('#reportsMoneyFlowSankeyDiagram') is None
    assert page.console_errors == []


@pytest.mark.feature
def test_money_flow_sankey_renders_nodes_links_and_sr_table(app_page):
    """With income/outflow data, the diagram renders one <rect> per node,
    one <path> per link, and a matching accessible data table."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        app.incomes = [{ id: 1, name: 'Salary', amount: 3000, accountId: 1, frequency: 'monthly', firstPayDate: `${y}-${m}-01` }];
        app.bills = [{ id: 1, name: 'Rent', amount: 1200, dueDay: 1, accountId: 1, category: 'Housing' }];
        app.expenses = []; app.debts = []; app.recurringTemplates = [];
        app.emergencyFunds = []; app.sinkingFunds = []; app.monthlySnapshots = [];
        app._reportMonthOffset = 0;
        app.switchPage('reports');
    }""")
    page.click('[data-rptab="moneyflow"]')
    page.wait_for_timeout(300)

    svg = page.query_selector('#reportsMoneyFlowSankeyDiagram')
    assert svg is not None

    node_count = page.evaluate("() => document.querySelectorAll('#reportsMoneyFlowSankeyDiagram rect').length")
    link_count = page.evaluate("() => document.querySelectorAll('#reportsMoneyFlowSankeyDiagram path').length")
    # Account + Salary + Housing + Surplus (income 3000 > outflow 1200)
    assert node_count == 4
    assert link_count == 3

    table_rows = page.evaluate("""() => {
        const table = document.querySelector('#reportsMoneyFlowSankeyDiagram-sr-table');
        return table ? table.querySelectorAll('tbody tr').length : -1;
    }""")
    assert table_rows == link_count

    assert page.console_errors == []


@pytest.mark.feature
def test_money_flow_sankey_no_inline_styles(app_page):
    """Generated markup for the diagram never contains a style= attribute
    (CSP requirement — see test_no_unsafe_inline_in_html for the static
    index.html check this extends to dynamically-generated SVG)."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        app.incomes = [{ id: 1, name: 'Salary', amount: 3000, accountId: 1, frequency: 'monthly', firstPayDate: `${y}-${m}-01` }];
        app.bills = [{ id: 1, name: 'Rent', amount: 1200, dueDay: 1, accountId: 1, category: 'Housing' }];
        app.expenses = []; app.debts = []; app.recurringTemplates = [];
        app.emergencyFunds = []; app.sinkingFunds = []; app.monthlySnapshots = [];
        app._reportMonthOffset = 0;
        app.switchPage('reports');
    }""")
    page.click('[data-rptab="moneyflow"]')
    page.wait_for_timeout(300)

    html = page.eval_on_selector('#reportsMoneyFlowSankey', 'el => el.innerHTML')
    assert 'style="' not in html


@pytest.mark.feature
def test_money_flow_sankey_respects_report_month_offset_year_boundary(app_page):
    """Navigating the report month across a Dec->Jan boundary shifts which
    month's transactions feed the diagram, mirroring the existing Cash
    Flow Trend month-offset test."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        app.debts = []; app.bills = []; app.recurringTemplates = [];
        app.incomes = []; app.emergencyFunds = []; app.sinkingFunds = []; app.monthlySnapshots = [];
        app._reportMonthOffset = 0;
        app.switchPage('reports');

        const now = new Date();
        const stepsToJan = ((12 - now.getMonth()) % 12) || 12;
        window.__stepsToJan = stepsToJan;

        // Mirror getReportDate(app)'s own arithmetic exactly: new Date(y, m + offset, 1).
        const decDate = new Date(now.getFullYear(), now.getMonth() + stepsToJan - 1, 5);
        const janDate = new Date(now.getFullYear(), now.getMonth() + stepsToJan, 5);
        const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        app.expenses = [
            { id: 1, name: 'Dec Only', budgetAmount: 80, date: fmt(decDate), accountId: 1, category: 'DecCat' },
            { id: 2, name: 'Jan Only', budgetAmount: 120, date: fmt(janDate), accountId: 1, category: 'JanCat' }
        ];
    }""")

    steps = page.evaluate('() => window.__stepsToJan')
    for _ in range(steps - 1):
        page.click('#rptNextMonth')
        page.wait_for_timeout(150)
    page.click('[data-rptab="moneyflow"]')
    page.wait_for_timeout(300)

    dec_text = page.query_selector('#reportsMoneyFlowSankey').text_content()
    assert 'DecCat' in dec_text
    assert 'JanCat' not in dec_text

    page.click('#rptNextMonth')
    page.wait_for_timeout(300)

    jan_text = page.query_selector('#reportsMoneyFlowSankey').text_content()
    assert 'JanCat' in jan_text
    assert 'DecCat' not in jan_text
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/features/test_money_flow_sankey.py -v`
Expected: FAIL — `#reportsMoneyFlowSankey` doesn't exist yet (no container in `index.html`, no render call wired up), so `query_selector` returns `None` and the `.text_content()` calls raise.

- [ ] **Step 3: Add `renderMoneyFlowSankey` to `src/reportsMoneyFlowSankey.js`**

Append to `src/reportsMoneyFlowSankey.js` (after `computeMoneyFlowSankeyData`):

```js
const WIDTH = 760;
const HEIGHT = 420;
const TOP_PADDING = 24;
const NODE_WIDTH = 14;
const COLUMN_X = [16, (WIDTH - NODE_WIDTH) / 2, WIDTH - NODE_WIDTH - 16];

function layoutColumn(nodes, x, scale) {
    let cursor = TOP_PADDING;
    for (const node of nodes) {
        node.x = x;
        node.y = cursor;
        node.height = node.amount * scale;
        cursor += node.height;
    }
}

// Ribbon: horizontal band from (x0, yTop..yBottom) to (x1, yTop..yBottom),
// with a soft bezier transition at the column boundary. Every link in this
// diagram touches the single Account node on one end, and the Account's
// per-link vertical offset is defined (via layoutColumn, same order/scale)
// to exactly match the leaf node's own y/height — so yTop/yBottom are the
// same at both ends and no vertical taper is needed.
function ribbonPath(x0, yTop, yBottom, x1) {
    const midX = (x0 + x1) / 2;
    return `M ${x0} ${yTop} C ${midX} ${yTop} ${midX} ${yTop} ${x1} ${yTop} ` +
        `L ${x1} ${yBottom} C ${midX} ${yBottom} ${midX} ${yBottom} ${x0} ${yBottom} Z`;
}

export function renderMoneyFlowSankey(app) {
    const container = document.getElementById('reportsMoneyFlowSankey');
    if (!container) return;

    const rptDate = getReportDate(app);
    const year = rptDate.getFullYear();
    const month = rptDate.getMonth();
    const monthLabel = rptDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const { nodes, links, hasData } = computeMoneyFlowSankeyData(app, year, month);

    if (!hasData) {
        container.innerHTML = `
            <h3 class="rpt-section-title">🌊 Money Flow — ${escapeHtml(monthLabel)}</h3>
            <p class="rpt-empty-msg">Add income, bills, debts, bonuses, expenses, or recurring items to see the money flow diagram.</p>`;
        return;
    }

    const accountNode = nodes.find(n => n.column === 1);
    const incomeNodes = nodes.filter(n => n.column === 0);
    const outflowNodes = nodes.filter(n => n.column === 2);
    const balancedTotal = accountNode.amount;
    const availableHeight = HEIGHT - TOP_PADDING * 2;
    const scale = balancedTotal > 0 ? availableHeight / balancedTotal : 0;

    layoutColumn(incomeNodes, COLUMN_X[0], scale);
    layoutColumn(outflowNodes, COLUMN_X[2], scale);
    accountNode.x = COLUMN_X[1];
    accountNode.y = TOP_PADDING;
    accountNode.height = availableHeight;

    const nodesById = {};
    for (const n of nodes) nodesById[n.id] = n;

    const isDark = document.body.classList.contains('dark-mode');
    const labelColor = isDark ? '#d1d5db' : '#374151';
    const strokeColor = isDark ? '#1f2937' : '#ffffff';

    const linkMarkup = links.map(link => {
        const source = nodesById[link.sourceId];
        const target = nodesById[link.targetId];
        const leaf = source.column === 1 ? target : source;
        const x0 = source.x + NODE_WIDTH;
        const x1 = target.x;
        const yTop = leaf.y;
        const yBottom = leaf.y + leaf.height;
        const d = ribbonPath(x0, yTop, yBottom, x1);
        const title = `${escapeHtml(source.label)} → ${escapeHtml(target.label)}: ${escapeHtml(formatCurrency(link.amount))}`;
        return `<path d="${d}" fill="${link.color}" fill-opacity="0.35" stroke="none"><title>${title}</title></path>`;
    }).join('');

    const nodeMarkup = nodes.map(node => {
        let labelX, labelY, anchor, dominantBaseline;
        if (node.column === 0) {
            labelX = node.x - 6; labelY = node.y + node.height / 2; anchor = 'end'; dominantBaseline = 'middle';
        } else if (node.column === 2) {
            labelX = node.x + NODE_WIDTH + 6; labelY = node.y + node.height / 2; anchor = 'start'; dominantBaseline = 'middle';
        } else {
            labelX = node.x + NODE_WIDTH / 2; labelY = node.y - 8; anchor = 'middle'; dominantBaseline = 'auto';
        }
        const title = `${escapeHtml(node.label)}: ${escapeHtml(formatCurrency(node.amount))}`;
        return `
            <g>
                <rect x="${node.x}" y="${node.y}" width="${NODE_WIDTH}" height="${Math.max(node.height, 0.5)}" fill="${node.color}" stroke="${strokeColor}" stroke-width="1"><title>${title}</title></rect>
                <text x="${labelX}" y="${labelY}" text-anchor="${anchor}" dominant-baseline="${dominantBaseline}" fill="${labelColor}" font-size="11">${escapeHtml(node.label)}</text>
            </g>`;
    }).join('');

    container.innerHTML = `
        <h3 class="rpt-section-title">🌊 Money Flow — ${escapeHtml(monthLabel)}</h3>
        <p class="rpt-chart-sub">How money flows from income sources, through your account, to where it goes.</p>
        <div class="mf-sankey-wrap">
            <svg id="reportsMoneyFlowSankeyDiagram" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Money flow diagram for ${escapeHtml(monthLabel)}">
                ${linkMarkup}
                ${nodeMarkup}
            </svg>
        </div>`;

    renderChartDataTable('reportsMoneyFlowSankeyDiagram', {
        caption: `Money flow — ${monthLabel}`,
        columns: ['From', 'To', 'Amount'],
        rows: links.map(link => [nodesById[link.sourceId].label, nodesById[link.targetId].label, formatCurrency(link.amount)])
    });
}
```

- [ ] **Step 4: Add the container div to `index.html`**

In `index.html`, find (around line 751-753):

```html
                <div class="rpt-tab-panel" id="rptPanel-moneyflow">
                    <div id="reportsMoneyFlow"></div>
                    <div id="reportsCashFlowTrend"></div>
```

Replace with:

```html
                <div class="rpt-tab-panel" id="rptPanel-moneyflow">
                    <div id="reportsMoneyFlowSankey"></div>
                    <div id="reportsMoneyFlow"></div>
                    <div id="reportsCashFlowTrend"></div>
```

- [ ] **Step 5: Wire the render call into `src/reports.js`**

Modify the import block (`src/reports.js:10`):

```js
import { renderReportsIncomeExp, renderReportsMoneyFlow, renderReportsCashFlowTrend } from './reportsCashFlow.js';
```

to:

```js
import { renderReportsIncomeExp, renderReportsMoneyFlow, renderReportsCashFlowTrend } from './reportsCashFlow.js';
import { renderMoneyFlowSankey } from './reportsMoneyFlowSankey.js';
```

Modify `renderReportsPage` (`src/reports.js:36-56`) so the Sankey diagram renders first in the Money Flow tab, above the existing charts:

```js
    renderReportsCalendar(app);
    renderMoneyFlowSankey(app);
    renderReportsIncomeExp(app);
    renderReportsMoneyFlow(app);
    renderReportsCashFlowTrend(app);
```

(No addition to the `.destroy()` cleanup array at the top of `renderReportsPage` — the Sankey diagram is plain SVG replaced via `container.innerHTML`, not a Chart.js instance.)

- [ ] **Step 6: Add layout CSS to `styles.css`**

In `styles.css`, insert after the existing `/* ── Money Flow ── */` block (around line 4413, right after `.rpt-moneyflow-wrap { position: relative; height: 360px; }`):

```css
.mf-sankey-wrap { position: relative; width: 100%; overflow-x: auto; margin-bottom: 16px; }
.mf-sankey-wrap svg { width: 100%; height: auto; min-width: 480px; }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pytest tests/features/test_money_flow_sankey.py -v`
Expected: PASS — all 8 tests green (4 from Task 1 + 4 from this task).

Also run the full security suite to confirm nothing regresses:

Run: `pytest tests/security/ -v`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/reportsMoneyFlowSankey.js src/reports.js index.html styles.css tests/features/test_money_flow_sankey.py
git commit -m "feat: render Money Flow Sankey diagram on Reports page (#79)"
```

---

### Task 3: Documentation and version bump

**Files:**
- Modify: `src/utils.js` (line 4 — `APP_VERSION`)
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md`
- Test: `tests/features/test_versioning.py` (existing — verifies sync, no changes needed)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by other tasks — this is the final task.

- [ ] **Step 1: Bump `APP_VERSION` in `src/utils.js`**

Change line 4:

```js
export const APP_VERSION = '4.14.0';
```

to:

```js
export const APP_VERSION = '4.15.0';
```

- [ ] **Step 2: Add a CHANGELOG.md entry**

In `CHANGELOG.md`, insert a new section directly above the existing `## [4.14.0] — 2026-08-09` heading:

```markdown
## [4.15.0] — 2026-08-09

### Added
- **Money Flow Sankey diagram** — new single-month flow visualization on the Reports → Money Flow tab, showing money moving from income sources through the account to bills, expenses, recurring costs, debt minimums, and savings, as hand-drawn inline SVG (no new external dependency — Chart.js remains the app's only one). A Surplus/Shortfall node balances the diagram when income and outflow for the month don't match. (#79)

---

```

- [ ] **Step 3: Add the new module to `CLAUDE.md`'s feature-module list**

In `CLAUDE.md`, find the sentence listing feature modules (in the "Central app object + feature-module delegation pattern" section) that includes `..., reportsCashFlow.js, reportsVariance.js, ...`. Add `reportsMoneyFlowSankey.js` immediately after `reportsCashFlow.js` in that list:

```
..., reportsCashFlow.js, reportsMoneyFlowSankey.js, reportsVariance.js, ...
```

- [ ] **Step 4: Verify versioning sync**

Run: `pytest tests/features/test_versioning.py -v`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `pytest tests/ -v`
Expected: PASS (all suites, including the new `test_money_flow_sankey.py`).

- [ ] **Step 6: Commit**

```bash
git add src/utils.js CHANGELOG.md CLAUDE.md
git commit -m "chore: bump version to 4.15.0 for money flow sankey diagram (#79)"
```
