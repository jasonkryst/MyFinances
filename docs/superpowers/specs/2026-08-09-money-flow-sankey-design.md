# Money Flow Sankey Diagram — Design

Issue: #79 — "Money Flow Sankey diagram (single-month)"

## Context

The Reports → Money Flow tab currently has two charts: a single-month
cumulative income/outflow/net line chart (`reportsCashFlow.js` →
`renderReportsMoneyFlow`) and a multi-month Income vs. Outflow trend chart
(`renderReportsCashFlowTrend`, added in #76). Both are line/bar charts.
Neither shows, at a glance, *where* money comes from and *where it goes* in a
single month — that's what a Sankey-style flow diagram (as seen in Monarch)
is for. This was scoped out of #76 because it needs its own research: Chart.js
(the app's only external dependency, per `CLAUDE.md`) has no native Sankey
chart type.

## Goals

- Add a single-month Sankey-style flow diagram to the Money Flow tab: Income
  sources → a single "Account" hub → Outflow categories (bills, expenses,
  recurring, debt minimums, savings).
- No new external dependency — hand-drawn inline SVG, consistent with the
  project's stated "Chart.js is the only external dependency" architecture.
- Respect the existing report-month navigation (`_reportMonthOffset` via
  `getReportDate(app)`), same as the other two Money Flow charts.
- Reuse category-grouping logic rather than duplicating what
  `renderReportsIncomeExp` already computes inline.

## Non-goals

- Multi-month / trend view of the flow diagram (single-month only, per issue
  title).
- Per-account breakdown — all accounts are aggregated into one "Account" hub
  node (see Architecture).
- Replacing or modifying the existing single-month line chart or the #76
  trend chart — this is an additional section, placed above both.
- Interactive drag/reflow of nodes — links and nodes are computed and drawn
  once per render, like every other chart in this app.

## Architecture

### 1. New module: `src/reportsMoneyFlowSankey.js`

Follows the existing one-file-per-report-widget convention
(`reportsNetWorth.js`, `reportsCalendar.js`, `reportsVariance.js`,
`reportsSummary.js`) rather than growing `reportsCashFlow.js` (already ~480
lines) further.

```js
export function computeMoneyFlowSankeyData(app, year, month)
// returns { nodes, links, hasData }
```

- `nodes`: `[{ id, label, column, amount, color }]` where `column` is
  `0` (income sources), `1` (Account hub, always exactly one node), or `2`
  (outflow categories, plus optionally a Surplus/Shortfall node — see below).
- `links`: `[{ sourceId, targetId, amount, color }]`.
- Grouping logic (income by source name; bills/expenses/recurring by
  `category`; debts by `name`; savings by `name`) mirrors what
  `renderReportsIncomeExp` (in `reportsCashFlow.js`) already computes inline
  for its donut/bar charts — extracted here so both call sites share one
  grouping implementation instead of drifting independently. `computeMonthCashFlowTotals`
  (from `reportsCashFlow.js`) is reused for the aggregate income/outflow
  totals needed to size the Account hub node and determine surplus/shortfall.
- Net balancing: if `income > outflow`, an extra `Surplus` node is added in
  column 2 (the outflow side — leftover money is effectively an "outflow"
  into savings-not-yet-categorized) with an `Account → Surplus` link for the
  difference, colored green (`#10b981`). If `outflow > income`, a
  `Shortfall` node is added in column 0 (the income side — it's effectively
  an additional inflow covering the gap) with a `Shortfall → Account` link,
  colored red (`#ef4444`). This keeps total inflow always equal to total
  outflow, per standard Sankey-diagram convention — the diagram would
  otherwise look unbalanced with no visual explanation why.
- `hasData` is `true` when there is at least one non-zero income or outflow
  transaction for the month (same convention as `computeMonthCashFlowTotals`
  consumers elsewhere).

```js
export function renderMoneyFlowSankey(app)
```

- Renders into a new `#reportsMoneyFlowSankey` container.
- Computes node column x-positions and vertical stacking from `nodes`/`links`
  (fixed diagram width/height; node height ∝ `amount`; nodes within a column
  stacked with a fixed gap, in the type-grouped order already used by the
  existing outflow bar chart: 🧾 bills, 💸 expenses, 🔄 recurring, 💳 debt,
  💰 savings — not re-sorted by amount, so the icon/color grouping stays
  legible).
- Builds link ribbons as cubic-bezier `<path>` elements: two bezier curves
  (top edge, bottom edge of the ribbon) forming a closed shape whose
  thickness at each end matches the connected nodes' allocated vertical
  span for that link. Standard Sankey-ribbon construction — d3-sankey uses
  the same idea internally, we're just hand-rolling the geometry.
- Colors: income node colors follow the same green-shades cycle already used
  for the income donut chart; outflow category colors reuse the existing
  per-type constants from `renderReportsIncomeExp`
  (`#f59e0b` bills, `#8b5cf6` expenses, `#06b6d4` recurring, `#ef4444` debt,
  `#10b981` savings); the Account hub is `#2563eb` (matches the existing Net
  line color elsewhere on this tab). Links are colored by whichever end is
  the "category" end (source for income→Account links, target for
  Account→outflow links) at reduced opacity, so both halves of the diagram
  stay legible by category.
- Every `<path>` and node `<rect>` gets a child `<title>` element
  (`"Salary → Account: $3,200.00"`) for a native hover tooltip — no custom
  tooltip JS needed, unlike the Chart.js-based charts elsewhere in this file.
- Text labels use `escapeHtml()` (from `utils.js`) before being placed in the
  SVG markup string, matching house convention for all innerHTML-injected
  user data.
- Root `<svg>` uses `viewBox="0 0 W H"` with `width="100%"` (no fixed pixel
  width), so it scales responsively via CSS alone — no resize listener
  needed (unlike Chart.js, which manages canvas resize itself).
- **No `style="..."` attributes anywhere** — all presentation (`fill`, `x`,
  `y`, node/ribbon geometry) is set via SVG presentational attributes, which
  are unaffected by the CSP's `style-src 'self'` restriction (that directive
  governs stylesheets and the `style` attribute, not SVG geometry/color
  attributes).
- `renderChartDataTable('reportsMoneyFlowSankeyDiagram', { caption, columns: ['From', 'To', 'Amount'], rows })`
  called immediately after building the SVG, one row per link — the existing
  helper only needs an element id + parent, so it works unchanged even
  though there's no `<canvas>`.
- Empty state (`hasData === false`): existing `rpt-empty-msg` convention, no
  `<svg>` built — same pattern as the other two Money Flow charts.

### 2. Wiring

- `index.html`: add `<div id="reportsMoneyFlowSankey"></div>` inside
  `<div class="rpt-tab-panel" id="rptPanel-moneyflow">`, **before** the
  existing `<div id="reportsMoneyFlow"></div>` (new section goes at the top
  of the tab).
- `reports.js`: import and call `renderMoneyFlowSankey(app)` first, before
  `renderReportsMoneyFlow(app)`, inside `renderReportsPage`. No chart-destroy
  bookkeeping needed (unlike the Chart.js charts) — replacing
  `container.innerHTML` each render is sufficient cleanup for SVG.
- `app.js`: no new state needed — the diagram has no range selector and
  reads the same `getReportDate(app)` the other two charts already use.
- `styles.css`: add layout-only classes for the new container (sizing,
  spacing) alongside the existing `rpt-chart-card`-style conventions; no
  color values in CSS since colors are set as SVG attributes at render time
  (matching how Chart.js color constants are passed inline elsewhere in this
  file, not via CSS).

## Error handling / edge cases

- No income/outflow data anywhere in the month → empty-state message, no
  `<svg>` created (same convention as the two existing Money Flow charts).
- Income exactly equals outflow → no Surplus/Shortfall node added (zero-value
  nodes/links are omitted entirely, not rendered as zero-width ribbons).
- Only income, no outflow (or vice versa) → the Account hub still renders
  with a Shortfall/Surplus link carrying the full amount, so the diagram
  never has a dangling column-2 or column-0 with nothing connected.
- Month navigation across a year boundary while viewing the Sankey diagram →
  handled by the same `getReportDate`/`_reportMonthOffset` mechanism the
  other two charts already use; explicitly tested.
- Many categories in one month (e.g. 15+ expense categories) → no artificial
  cap; nodes simply stack taller. Not addressed further in this iteration —
  flagged here as a known limitation rather than solved speculatively
  (YAGNI; no evidence yet that real usage produces enough categories to make
  this unreadable).

## Testing

New `tests/features/test_money_flow_sankey.py`:

- **Positive**: seed multiple income sources, bill/expense/recurring
  categories, a debt, and a savings contribution for the report month;
  assert `window.app.computeMoneyFlowSankeyData` (thin delegating method,
  mirroring `getCashFlowTrendSeries`) returns the correct node amounts and
  link `{sourceId, targetId, amount}` triples.
- **Net surplus**: income > outflow → a `Surplus` node and `Account→Surplus`
  link with the correct amount are present.
- **Net shortfall**: outflow > income → a `Shortfall` node and
  `Shortfall→Account` link with the correct amount are present.
- **Balanced month**: income === outflow → no Surplus/Shortfall node/link.
- **Empty state**: no data at all → `#reportsMoneyFlowSankey` shows the empty
  message and no `<svg>` is created, no console errors.
- **Month navigation**: with `_reportMonthOffset` moved (including across a
  Dec→Jan year boundary), the returned nodes/links shift to match, mirroring
  the existing `test_report_month_offset_year_boundary_label`-style test.
- **Accessibility**: sr-only data table row count equals the number of
  links.
- **No inline styles**: rendered markup for the diagram never contains
  `style="`, extending the spirit of the existing
  `test_no_unsafe_inline_in_html` static check to this dynamically-generated
  SVG.

## Documentation

- Bump `APP_VERSION` in `src/utils.js`: `4.14.0` → `4.15.0`.
- Add a matching `## [4.15.0] — 2026-08-09` entry to `CHANGELOG.md` under
  "Added", referencing #79.
- `CLAUDE.md`: add `reportsMoneyFlowSankey.js` to the feature-module list in
  the "Central app object + feature-module delegation pattern" section.
