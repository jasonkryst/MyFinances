# Cash Flow Trend Chart — Design

Issue: #76 — "Implement a charting layout to show monthly money Flow like Monarch app."

## Context

The Reports page already has a "Money Flow" tab (`reportsCashFlow.js` →
`renderReportsMoneyFlow`) showing a single month's cumulative income/outflow/net
as a line chart, day by day, plus category breakdown donut/bar charts
(`renderReportsIncomeExp`). What's missing — and what Monarch's flagship "Cash
Flow" view is actually known for — is a **multi-month trend**: income vs.
expenses per month across a selectable range, with a net/savings line
overlaid. This spec covers that addition only. A Sankey-style single-month
flow diagram was considered and deferred to a separate follow-up issue — it's
an independent piece of UI (no native Chart.js support, needs its own
research) and isn't needed to satisfy the "monthly" trend framing of #76.

## Goals

- Add a bar chart of Income vs. Outflow per month, with a Net line overlay,
  over a selectable 3/6/12-month range ending at the currently-viewed report
  month (respects existing `_reportMonthOffset` month navigation).
- Reuse the existing per-month income/outflow totals logic rather than
  duplicating it.
- Follow the existing range-button UX pattern already established by the Net
  Worth trend (`reportsNetWorth.js`, `data-networth-range`).

## Non-goals

- Sankey/flow-diagram visualization (separate follow-up issue).
- Persisting the selected range across sessions (matches `_netWorthRangeMonths`,
  which is also session-only — unlike `_forecastRangeMonths`, which is saved).
- Any change to the existing single-month Money Flow line chart or
  Income/Outflow category charts.

## Architecture

### 1. Extract shared per-month totals helper

`reportsCashFlow.js` currently computes income/bills/expenses/recurring/debt
minimums/savings inline inside `renderReportsIncomeExp` (lines ~21-59) for the
single report month. Extract this into:

```js
export function computeMonthCashFlowTotals(app, year, month)
// returns { income, bills, expenses, recurring, debtMin, savings, outflow, net }
```

`renderReportsIncomeExp` is refactored to call this for the report month — no
behavioral change, just deduplication so the trend feature and the existing
report can't drift out of sync.

### 2. Multi-month series

```js
export function getCashFlowTrendSeries(app, months)
// returns [{ year, month, label, income, outflow, net }, ...] oldest-first
```

Anchors on `getReportDate(app)` (so it respects month navigation) and walks
backward `months - 1` additional months via `new Date(y, m - i, 1)` (same
plain-Date arithmetic `getReportDate` already relies on, so year boundaries
fall out naturally). Calls `computeMonthCashFlowTotals` per month.

### 3. Render function

```js
export function renderReportsCashFlowTrend(app)
```

Renders into a new `#reportsCashFlowTrend` container, placed directly below
`#reportsMoneyFlow` inside the existing "Money Flow" tab panel in
`index.html`. Structure mirrors `reportsNetWorth.js`:

- Header with title + 3M/6M/12M range buttons (`data-cashflow-range`,
  reusing the existing `.nw-range-buttons`/`.nw-range-btn` CSS classes).
- Summary stats row (avg income, avg outflow, avg net across the range).
- A mixed Chart.js chart: `type: 'bar'` with grouped Income (green) /
  Outflow (red) datasets, plus a third dataset with `type: 'line'` for Net,
  matching the color conventions already used elsewhere in this file
  (`#10b981` income green, `#ef4444` outflow red, `#2563eb` net blue).
- `renderChartDataTable(...)` call immediately after chart construction for
  the screen-reader-accessible equivalent table (existing house convention).
- Empty state (no income/outflow across the whole range) reuses the existing
  `rpt-empty-msg` class and message style.

### 4. Wiring

- `app.js`: add `this._cashFlowTrendRangeMonths = 6;` next to the existing
  `this._netWorthRangeMonths = 6;` (session-only, not persisted).
- `app.js`: add a thin delegating method `getCashFlowTrendSeries(months)` →
  calls the module function, for test/DOM-console access (mirrors the
  existing `computeReportsSummaryMetrics` pattern).
- `ui.js`: the existing single delegated `document.addEventListener('click', ...)`
  handler gains a `data-cashflow-range` branch alongside the existing
  `data-networth-range`/`data-forecast-range` branches — sets
  `app._cashFlowTrendRangeMonths` (clamped to `[3, 6, 12]`) and calls
  `app.renderReportsPage()`.
- `reports.js`: import and call `renderReportsCashFlowTrend(app)` right after
  `renderReportsMoneyFlow(app)` in `renderReportsPage`; add
  `'_rptCashFlowTrendChart'` to the chart-destroy list at the top of that
  function.
- `index.html`: add `<div id="reportsCashFlowTrend"></div>` inside the
  existing `<div class="rpt-tab-panel" id="rptPanel-moneyflow">` panel, below
  `#reportsMoneyFlow`.

## Error handling / edge cases

- No income/outflow data anywhere in the range → empty-state message, no
  canvas created (same convention as the two existing Money Flow charts).
- Far-future/far-past report months (no underlying data) → series is all
  zeros; chart renders with $0 bars, doesn't crash — covered by the existing
  `test_report_far_future_month_renders_empty_state` pattern for the other
  two charts, and a new equivalent for this one.
- Month-nav across a year boundary while a multi-month range is selected →
  handled by the same `Date`-arithmetic approach `getReportDate` already
  uses; explicitly tested.

## Testing

New `tests/features/test_cash_flow_trend.py`:

- **Positive**: seed income/bills/expenses across 3 distinct months, assert
  `window.app.getCashFlowTrendSeries(3)` returns the correct
  income/outflow/net per month, in the correct oldest-first order.
- **Range switching**: click each of the 3M/6M/12M buttons, assert
  `app._cashFlowTrendRangeMonths` updates and the active button class moves.
- **Empty state**: no data at all → `#reportsCashFlowTrend` shows the empty
  message and no `<canvas>` is created, no console errors.
- **Month navigation**: with `_reportMonthOffset` moved (including across a
  Dec→Jan year boundary), the returned series' month range shifts to match,
  mirroring the existing `test_report_month_offset_year_boundary_label` test
  for the calendar section.

## Documentation

- Bump `APP_VERSION` in `src/utils.js`: `4.13.0` → `4.14.0`.
- Add a matching `## [4.14.0] — 2026-08-09` entry to `CHANGELOG.md` under
  "Added", referencing #76 (kept in sync by `tests/features/test_versioning.py`).
- No `CLAUDE.md` changes needed: the existing "Reports/Forecast/Health" bullet
  already describes this class of feature generically, and no new module or
  top-level page is introduced.
