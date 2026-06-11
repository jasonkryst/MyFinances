# Cash Flow Forecasting — Design Spec

**Date**: 2026-06-09
**Status**: Approved (pending writing-plans)
**Roadmap item**: Tier 2, "🔮 Cash Flow Forecasting" (v3.3 target)

## Goal

Project account balances forward (1/2/3/6/12 months) based on existing income, bills,
expenses, debt minimum payments, recurring templates, and savings auto-contributions.
Surface the lowest/highest projected balances, warn on projected negative balances,
and flag months with unusually high outflow ("seasonal" expenses like quarterly/yearly
bills).

**Out of scope** (deferred to the separate "Multiple Scenario Comparison" roadmap item):
comparing baseline vs. an alternate/extra debt payment plan.

## Data Layer

### `src/ledger.js` — new export

```js
export function getAccountForecastSeries(app, accountId, monthsAhead)
```

Returns `monthsAhead + 1` entries:

- **Index 0** = `{ label: 'Now', income: 0, outflow: 0, net: 0, balance: <account.startingBalance> }`
  — a reference point representing "today's" balance.
- **Indices 1..monthsAhead** = for each consecutive month starting at the current
  calendar month:
  - Call `getLedgerTransactionsForMonth(app, year, month, accountId)` (existing function —
    already projects income, bonuses, debts, bills, expenses, recurring occurrences,
    and savings auto-contributions for any future month)
  - `income` = sum of positive transaction amounts
  - `outflow` = sum of `Math.abs()` of negative transaction amounts
  - `net = income - outflow`
  - `balance = previous.balance + net` (cumulative running balance)
  - `{ year, month, label, income, outflow, net, balance }` where `label` is a short
    month/year string (e.g. "Jun 2026")

This mirrors the running-balance logic already used by `getLedgerTransactions()` for
the ledger table, scoped to a single account and a configurable horizon.

### "Total Cash Position"

Defined as the element-wise sum of `getAccountForecastSeries(...)` across every
**asset-type account** — any account whose `type` is **not** `Credit Card` or
`Loan` (i.e. `Checking`, `Savings`, `Cash`, `Investment`, `Other`). Credit Card
and Loan accounts represent liabilities and are excluded — their debt payoff is
already tracked separately via `app.debts` and the Health/Plan pages.

### Derived stats (computed in `src/forecast.js`)

From a series (whether a single account's or the "Total"):

- **Current balance** = `series[0].balance`
- **Lowest / highest projected balance** = min/max over `series[1..]`, with the
  corresponding month label
- **Negative-balance warning** = first entry in `series[1..]` where `balance < 0`
  (if any)
- **Notable months** = any entry in `series[1..]` where
  `outflow > (notableThresholdPct / 100) * averageOutflow` (average computed over
  `series[1..]`). For each notable month, re-query
  `getLedgerTransactionsForMonth(app, year, month, accountId)`, filter to negative
  amounts, sort descending by `Math.abs(amount)`, and take the top 3 as "drivers"
  (name + amount).

`notableThresholdPct` is user-configurable (default `130`).

## UI Layout

### Location

New tab in the existing Reports page tab bar (`src/index.html`,
`.rpt-tab-bar`): `🔮 Forecast`, with panel `id="rptPanel-forecast"` containing
`<div id="reportsCashFlowForecast"></div>`. Wired the same way as the other
report tabs (`data-rptab="forecast"`).

### New file: `src/forecast.js`

Exports `renderCashFlowForecast(app)`, called from `renderReportsPage()` in
`reports.js` (alongside `renderReportsCalendar`, `renderReportsNetWorth`, etc.).
`renderReportsPage()`'s chart-cleanup list gains `_rptForecastChart`.

### Controls row

- **Horizon buttons**: `1M / 2M / 3M / 6M / 12M`, default `1M`. Same visual
  pattern as the existing `nw-range-btn` buttons for Net Worth. Stored in
  `app._forecastRangeMonths`.
- **Account selector** (`<select>`): `Total Cash Position` (default) + each
  asset-type account by name. Stored in `app._forecastAccountId` (`'total'` or
  an account id). If the previously-selected account no longer exists (e.g.
  deleted), falls back to `'total'`.
- **Notable threshold**: inline number input, "Flag months with outflow above
  ___% of average" (default `130`, reasonable bounds e.g. 100–500). Stored in
  `app._forecastNotableThresholdPct`.

All three settings persist to localStorage (see Persistence below) and are
restored on load — unlike `_netWorthRangeMonths`, which resets each session.

### Negative-balance warning banner

Shown above the chart when the selected series has a projected negative month:

> ⚠️ Projected to go negative in **March 2027**: -$340.00

### Summary stat row

Three cards (same visual style as the Net Worth summary stats):
- Current Balance
- Lowest Projected (value + month)
- Highest Projected (value + month)

### Chart

Chart.js line chart, single dataset "Projected Balance", `monthsAhead + 1`
points (including the "Now" reference point):

- `segment.borderColor`: red (`#dc2626`) for any segment ending below $0,
  blue (`#2563eb`) otherwise (Chart.js v3+ native feature, no extra plugin)
- The lowest and highest points get distinct `pointBackgroundColor`
  (red/green) and a larger `pointRadius`
- Y-axis ticks formatted via `formatCurrency`, consistent with other Reports
  charts

### Table

Columns: Month | Income | Outflow | Net | Ending Balance — one row per
projected month (`series[1..]`, i.e. `monthsAhead` rows; the "Now" point is
chart-only).

- Rows where `balance < 0` get a red highlight class
- "Notable" months get an additional note row listing the top outflow drivers
  (e.g. "⚠️ Driven by: Property Tax ($1,200), Annual Subscription ($120)")

### Empty state

If there are no asset-type accounts, show a message directing the user to the
Accounts page (consistent with other empty states, e.g. `health-empty-state`).

## Persistence (`src/storage.js`)

New `forecastSettings` object, mirroring the existing `ledgerSettings` pattern:

```js
forecastSettings: {
    rangeMonths: 1,           // one of [1, 2, 3, 6, 12]
    accountId: 'total',       // 'total' or an account id (as string/number)
    notableThresholdPct: 130  // numeric, sanitized with min/max bounds
}
```

Added to:
- `sanitizeParsedState` (new `sanitizeForecastSettings` helper)
- `saveToStorage` / `loadFromStorage`
- `exportAllJSON` / both branches of `importAllJSON`
- `clearAllData` (reset to defaults)

## Testing Plan

New `tests/features/test_forecast.py` (structured like `test_health.py`):

- Forecast tab renders with default 1-month/Total view
- Each horizon option (1/2/3/6/12) recalculates and re-renders the chart/table
- Account dropdown lists only asset-type accounts plus "Total Cash Position";
  Credit Card/Loan accounts excluded
- Negative-balance warning banner appears/disappears correctly based on
  projected data
- Summary stats (current/lowest/highest + month labels) match expected values
  for a known fixture
- Notable-month flag appears for a yearly/quarterly recurring item that spikes
  outflow, and respects a custom `notableThresholdPct`
- Empty state renders when no asset-type accounts exist
- `forecastSettings` round-trips through save/load and export/import

Additional:
- XSS check: account names and transaction "driver" names in the table are
  rendered via `escapeHtml()` — extend `tests/security/test_xss.py`
- Add a Forecast-tab step to `tests/integration/test_smoke.py`
