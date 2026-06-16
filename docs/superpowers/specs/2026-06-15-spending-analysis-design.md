# Spending Analysis by Category — Design Spec

**Date**: June 15, 2026  
**Status**: Approved  
**Feature tier**: Tier 2 (ROADMAP.md)

---

## Overview

A new "🏷️ Spending" tab inside the existing Reports page that gives users a visual breakdown of where their money goes — by category — for the currently-selected month. Covers all outflow transaction types: expenses, bills, recurring template outflows, debt minimum payments, and savings contributions.

---

## Architecture

### New file: `src/spending.js`

Keeps `reports.js` (currently 995 lines) from growing further. Exports:

- `computeSpendingByCategory(app, year, month)` — pure data function, no DOM access
- `renderReportsSpending(app)` — renders the full tab into `#reportsSpending`

### Modified files

| File | Change |
|---|---|
| `index.html` | New `rpt-tab-btn` button (`data-rptab="spending"`) and `rpt-tab-panel` container (`id="rptPanel-spending"`) with a `<div id="reportsSpending"></div>` inside |
| `src/reports.js` | Import `renderReportsSpending` from `./spending.js`; call it inside `renderReportsPage` |
| `src/app.js` | Import `renderReportsSpending`; add one-line delegation method on `DebtTrackerApp` |
| `styles.css` | CSS for spending-specific elements (ranked list rows, % change badges, modal body) |

Pattern matches every existing feature module — `spending.js` is a plain ES module whose functions take `app` as their first argument.

---

## Data Layer

### `computeSpendingByCategory(app, year, month)`

Calls `getLedgerTransactionsForMonth(app, year, month)` then maps each outflow transaction to a category:

| Transaction type | Category key |
|---|---|
| `bill` | `tx.category \|\| 'Other'` |
| `expense` | `tx.category \|\| 'Other'` |
| `recurring` (amount < 0) | `tx.category \|\| 'Other'` |
| `debt` | `'Debt Payments'` (synthetic — aggregates all debt minimums) |
| `savings` | `'Savings'` (synthetic — aggregates all contributions) |
| `income`, `bonus`, positive `recurring` | excluded |

**Returns** an array of objects sorted by `total` descending:

```js
[
  {
    category: string,          // display name
    total: number,             // sum of |amount| for the month
    transactions: LedgerTx[],  // individual transactions in this category
    changeVsLastMonth: number | null  // fraction: (this - last) / last, or null if no prior data
  },
  ...
]
```

`changeVsLastMonth` is computed by running the same aggregation one month back (no extra ledger calls — reuses the same function with `month - 1`, wrapping at year boundaries).

---

## UI Components

### Tab button & panel

```html
<button class="rpt-tab-btn" data-rptab="spending" aria-selected="false">🏷️ Spending</button>
<div class="rpt-tab-panel" id="rptPanel-spending">
  <div id="reportsSpending"></div>
</div>
```

Tab switching is already wired generically in `src/ui.js` — no changes needed there.

### Summary strip

One line rendered at the top of the panel:

> **Total spending: $1,640** · June 2026 &nbsp; `↑ $120 vs May` *(badge, red if up, green if down)*

### Hero row (two columns)

**Left — Doughnut pie chart**
- Chart.js doughnut, one slice per category
- Click handled via Chart.js `onClick` chart option callback → calls module-internal `_openSpendingDrilldown(app, category, year, month)` (not exported)
- Stored on `app._rptSpendingPieChart`; destroyed before re-render

**Right — Ranked list**
- One row per category, sorted by total descending
- Row: `① Housing · · · $950 ↑ 8%`
- `↑`/`↓` badge is colored red/green; absent when `changeVsLastMonth` is null
- Clicking a row calls `_openSpendingDrilldown(app, category, year, month)`

### 6-month stacked bar chart (full-width)

- Chart.js bar chart, `stacked: true`
- Six months ending on the selected report month; one dataset per category
- **Category union**: the union of all categories present across all 6 months is used; months where a category had no spending contribute 0 to that dataset
- Category → color mapping via a stable palette: `PALETTE[hashCategory(name) % PALETTE.length]`  
  This guarantees the same category always gets the same color across months and re-renders
- Current month bars are rendered at full opacity; prior months at 0.6 alpha — achieved by passing per-bar `backgroundColor` arrays in each dataset (programmatic JS, not HTML inline styles, so CSP is unaffected)
- Stored on `app._rptSpendingBarChart`; destroyed before re-render

### Drill-down modal

Reuses existing `.modal` / `.modal-content` / `.modal-overlay` CSS classes.

**Header:**
- Category name and month: `🍔 Food — June 2026`
- Subtitle: `3 transactions · $420.00 total`
- `↑ 15% vs May` badge (right-aligned, amber background when up, green when down)

**Body:**
- Scrollable list of transactions
- Each row: transaction name | date (formatted) | type icon | amount (red)
- Type icons: 💸 expense, 🧾 bill, 🔄 recurring, 💳 debt, 💰 savings

**Footer:** single "Close" button; clicking the overlay also closes.

All user-supplied strings (category name, transaction name) go through `escapeHtml()` before `innerHTML`.

---

## Color Palette

A fixed 10-color palette is defined in `spending.js`. Category names are hashed to an index so colors are deterministic across re-renders and months:

```js
const PALETTE = ['#6366f1','#f59e0b','#10b981','#ef4444','#8b5cf6',
                 '#06b6d4','#f97316','#84cc16','#ec4899','#64748b'];
```

`'Debt Payments'` always maps to `#ef4444` (red); `'Savings'` always maps to `#10b981` (green) — these are pinned, not hashed.

---

## Security

- All `innerHTML` insertions use `escapeHtml()` (imported from `utils.js`)
- No inline `style=""` attributes — all dynamic styling via `classList` and CSS classes/variables
- No `eval` or `new Function()`
- CSP is unchanged

---

## Testing

### Security — `tests/security/test_xss.py` (append)

- `test_xss_in_spending_category_name` — seeds an expense with `<script>alert(1)</script>` as the category name, navigates to the Spending tab, asserts no alert fires and the script tag does not appear in the DOM

### Feature — `tests/features/test_spending_analysis.py` (new file)

- `test_spending_aggregates_all_outflow_types` — expenses + bills + recurring outflows + debt + savings all contribute to totals
- `test_spending_excludes_income` — income and positive recurring entries are not counted
- `test_spending_sorted_by_total_desc` — highest-total category is first
- `test_spending_other_fallback` — transaction with blank category lands in `'Other'`
- `test_spending_change_vs_last_month` — correct % change when prior month has data
- `test_spending_change_vs_last_month_null_when_no_prior` — `changeVsLastMonth` is `null` when prior month has no spending
- `test_spending_empty_state` — no transactions → function returns empty array, UI shows an empty-state message

### UI — `tests/ui/test_spending_ui.py` (new file)

- `test_spending_tab_exists_and_navigates` — tab button is present; clicking it shows `#rptPanel-spending`
- `test_spending_pie_chart_renders` — `#reportsSpending canvas` exists after seeding data
- `test_spending_ranked_list_shows_categories` — ranked list rows contain expected category names
- `test_spending_ranked_row_opens_modal` — clicking a ranked row opens a modal containing the category name
- `test_spending_modal_shows_transactions` — modal body contains seeded transaction names
- `test_spending_modal_close_button_dismisses` — clicking Close hides the modal
- `test_spending_bar_chart_renders` — second canvas in `#reportsSpending` exists after seeding data
- `test_spending_empty_state_message` — with no data, an empty-state message is visible

### Integration — existing `tests/integration/test_smoke.py`

Existing smoke test navigates all pages; once the Spending tab is added to `index.html` it will be exercised automatically. Passes = no console errors on load.

---

## Documentation updates (after implementation)

- `ROADMAP.md` — mark "Spending Analysis by Category" as ✅, add delivery date and At-a-Glance table row
- `README.md` — add "Spending Analysis by Category (NEW)" subsection under Key Product Updates; bump version and date
- `guide.html` — add "Spending by Category" section explaining the tab, pie chart, ranked list, drill-down modal, and trend chart
- `src/utils.js` — bump `APP_VERSION` to `3.6.0`
