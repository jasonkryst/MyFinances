# Retirement Accounts Dashboard — Design

## Context

MyFinances currently has no concept of a retirement account. The account
"type" dropdown (`ACCT_TYPES` in `src/accounts.js`) offers `Checking`,
`Savings`, `Cash`, `Investment`, `Credit Card`, `Loan`, `Other` — all sharing
one schema (`{ id, name, type, startingBalance, interestRate }`). `Investment`
is generic and carries no retirement-specific fields. `ROADMAP.md` lists
"Retirement Planning" (years-to-retirement countdown, savings-needed
calculator, readiness score) as a planned but unbuilt feature; no commit has
ever touched retirement/401k/IRA.

Historical balance tracking today exists only at the whole-portfolio level:
`app.monthlySnapshots` (`reportsNetWorth.js`) stores one aggregate
`{ date, totalAssets, totalLiabilities, netWorth, ... }` row per month,
auto-captured from `computeAccountBalance()` summed across all accounts.
There is no per-account historical series anywhere, and retirement account
balances (401k, IRA) don't move through the ledger like a checking account
does — they're updated from periodic statements, not day-to-day
transactions. This feature adds a dedicated retirement account type, a
manual per-account balance/contribution history log, a growth-projection
calculator, and a new "Retirement" page to visualize all of it.

## Goals

- A `Retirement` account type with a subtype (401k / Traditional IRA / Roth
  IRA / HSA / Other), a per-account annual rate-of-return assumption, and an
  optional employer-match percentage.
- A manually-maintained history log per retirement account (balance +
  contribution per period), independent of the ledger.
- Charts: balance over time (per account), contribution vs. growth
  (per period), current balance breakdown by account, and a projected future
  value at a user-set target retirement date.
- A new top-level "Retirement" nav page hosting all of the above.

## Non-goals

- Changing the existing generic `Investment` account type or migrating any
  existing accounts to `Retirement`.
- Linking contributions to Income/Recurring Templates for auto-computed
  contribution amounts (deferred — contributions are manually entered here).
- Translating the new page (matches current i18n scope: only nav, toolbar,
  Settings, and Health are translated today).
- Retirement readiness scoring / Social-Security-aware planning from
  `ROADMAP.md` — this spec covers the dashboard/history/simple-projection
  slice only.

## Architecture

### 1. Data model — account fields

`src/accounts.js`:
- `ACCT_TYPES` gains `'Retirement'`; `ACCOUNT_TYPE_ICONS` gains
  `Retirement: '🏛️'`.
- New fields on the account record, present (with defaults) on every
  account but only exposed in the edit form when `type === 'Retirement'`:
  - `retirementSubtype` — one of `401k`, `Traditional IRA`, `Roth IRA`,
    `HSA`, `Other`; default `'Other'`.
  - `rateOfReturn` — annual %, `sanitizeFiniteNumber(..., 0, {min: 0, max:
    100})`. Kept distinct from `interestRate` (used elsewhere for
    debt/APY-style balance growth) since "expected rate of return" is a
    planning input, not an accrual rate the app applies to `startingBalance`.
  - `employerMatchPercent` — %, same sanitizer/bounds as above, default 0.
- `sanitizers.js` `sanitizeAccount()` extended with the three fields above
  (each defaulted so old records round-trip unchanged).

### 2. Data model — retirement snapshots

New top-level array `app.retirementSnapshots`:
```js
{ id, accountId, date /* ISO */, balance, contribution }
```
- New `sanitizeRetirementSnapshot(record, idFallback)` in `sanitizers.js`
  (`sanitizeInteger` for `id`/`accountId`, `sanitizeDateISO` for `date`,
  `sanitizeFiniteNumber(..., 0, {min: 0})` for `balance` and
  `contribution`), following the existing per-record-type sanitizer
  convention. Included in load, JSON export, and JSON import.
- One row per account per logged period. Growth for a period is derived,
  not stored: `growth = balance − previousBalance − contribution`.

### 3. Global setting — target retirement date

- `app.retirementTargetDate` (ISO date string, nullable), persisted as a
  plain field in the main storage blob (not a separate `localStorage` key —
  unlike `debtTrackerTheme`/`debtTrackerStorageBackend`, this is app data
  the user edits per financial plan, not a device preference). Sanitized
  with `sanitizeDateISO`. Set from an input on the new Retirement page.

### 4. Calculation engine — `src/retirementCalculator.js`

New ES module (not a classic/global script like `debtCalculator.js` — that
global-script treatment exists only for load-order reasons predating ES
modules; every other calculation lives in a regular module). Pure,
DOM-free, unit-testable functions:

```js
export function computeRetirementProjection(currentBalance, monthlyContribution, annualRatePct, monthsUntilTarget)
// Future value via monthly-compounding: iterates month by month (or closed-form
// annuity formula) applying annualRatePct/12 growth then adding monthlyContribution.
// Returns a number. monthsUntilTarget <= 0 returns currentBalance unchanged.

export function splitGrowthFromContribution(snapshotsForOneAccount)
// snapshotsForOneAccount: date-sorted [{ date, balance, contribution }, ...]
// Returns [{ date, contribution, growth }, ...], growth = balance delta − contribution,
// first entry has growth = 0 (no prior balance to diff against).
```

Both functions take primitives/plain arrays, not `app` — they have no
reason to know about app state, matching `debtCalculator.js`'s own
convention of pure functions over data the caller extracts.

### 5. `src/retirement.js` — feature module

Following the established `moduleFn(app, ...)` delegation pattern:

- `addRetirementSnapshot(app, accountId, date, balance, contribution)` /
  `deleteRetirementSnapshot(app, id)` — mutate `app.retirementSnapshots`,
  save, re-render.
- `getRetirementAccounts(app)` — `app.accounts.filter(a => a.type ===
  'Retirement')`.
- `getSnapshotsForAccount(app, accountId)` — filtered + date-sorted.
- `computeAccountProjection(app, accountId)` — pulls the account's
  `rateOfReturn`, the most recent snapshot's `contribution` as the assumed
  recurring monthly contribution, months between today and
  `app.retirementTargetDate`, and calls `computeRetirementProjection`.
  Returns `null` if no `retirementTargetDate` is set.
- `renderRetirementPage(app)` — builds:
  - Account cards (balance, subtype, rate of return, employer match,
    "Add Snapshot" button opening a small modal: date/balance/contribution).
  - Target retirement date input (writes `app.retirementTargetDate`).
  - Balance-over-time line chart (one line per retirement account, built
    from `retirementSnapshots`), mirroring `renderReportsNetWorth`'s
    Chart.js setup, plus a `renderChartDataTable()` call.
  - Contribution-vs-growth stacked bar chart (aggregated across accounts,
    per period) using `splitGrowthFromContribution`.
  - Current-balance breakdown doughnut (by account).
  - Projection panel: per-account and combined-total projected value at
    `retirementTargetDate`, using `computeAccountProjection`.
  - Empty states: no retirement accounts → prompt to add one (link to
    Accounts page); an account with no snapshots yet → "log your first
    balance" prompt instead of an empty chart.

### 6. Wiring

- `index.html`: new `<button class="page-button" data-page="retirement">`
  in nav; new `<section id="retirementPage" class="page-section">`
  container (structure mirrors the `reports`/`savings` sections); new
  `<div id="retirementSnapshotModal">` modal markup.
- `ui.js`: `switchPage`'s page-name mapping and `renderPageData`'s dispatch
  both gain a `'retirement'` case calling `renderRetirementPage(app)`.
- `app.js`: `DebtTrackerApp` gains thin delegating methods
  (`renderRetirementPage()`, `addRetirementSnapshot(...)`, etc.) plus
  `this.retirementSnapshots = []` and `this.retirementTargetDate = null` in
  initial state.
- `commandPalette.js`: add "Retirement" to the page jump list.
- `accounts.js`: the account add/edit form conditionally shows the
  subtype/rate-of-return/employer-match fields when `type === 'Retirement'`
  is selected (plain `classList` toggle driven by the type `<select>`'s
  `change` event — no inline styles, CSP-compliant).
- `dataExport.js`: `exportAllJSON()` adds `retirementSnapshots:
  app.retirementSnapshots || []` and `retirementTargetDate:
  app.retirementTargetDate || null` to the payload (the exported `version`
  field is just `APP_VERSION`, not a separate schema-version counter — no
  format-version bump needed, this is a purely additive field). Import
  (`sanitizeParsedState` in `sanitizers.js`) maps `retirementSnapshots`
  through `sanitizeRetirementSnapshot` the same way `accounts`/`debts`/etc.
  are mapped through their sanitizers today, and reads `retirementTargetDate`
  through `sanitizeDateISO`. Both default to empty/null when absent, so
  pre-5.0.0 export files still import cleanly.

## Error handling / edge cases

- No `retirementTargetDate` set → projection panel shows a prompt to set one
  instead of a number; no crash.
- Account has a `rateOfReturn` of 0 → projection still computes (straight
  linear contribution sum, no compounding term).
- Only one snapshot ever logged for an account → growth chart shows a single
  point with `growth = 0` (no prior balance to diff against); balance chart
  still renders the single point.
- Deleting a retirement account does **not** cascade-delete its snapshots
  automatically-orphaned rows are filtered out at read time by
  `getSnapshotsForAccount`'s join against `app.accounts`, consistent with
  how other modules treat orphaned `accountId` references elsewhere in the
  codebase (e.g. ledger).
- `monthsUntilTarget` negative (target date in the past) →
  `computeRetirementProjection` returns `currentBalance` unchanged rather
  than projecting backward.

## Testing

- `tests/unit/retirementCalculator.test.js` (Jest): `computeRetirementProjection`
  (zero rate, zero contribution, negative months, multi-year compounding
  against a hand-computed expected value) and `splitGrowthFromContribution`
  (single snapshot, multiple snapshots, a mid-series contribution change).
  Added to `stryker.config.mjs`'s `mutate` line-range globs alongside
  `debtCalculator.js`/`utils.js`/`sanitizers.js`.
- `tests/features/test_retirement.py` (Playwright): add a Retirement account
  with subtype/rate/match, add/delete snapshots, verify balance/contribution
  charts render with the right data (via `renderChartDataTable`'s a11y
  table), set a target date and verify the projection panel shows a number,
  empty states (no accounts, account with no snapshots), JSON export/import
  round-trip of the new fields, and old-format (v3.0) import still working.
- `tests/security/`: covered automatically by the existing `escapeHtml`/CSP
  static-scan tests since this introduces no new `innerHTML` patterns beyond
  the established convention.

## Documentation

- `CLAUDE.md`: new bullet under "Cross-cutting features" describing the
  Retirement page/data model/calculator, following the existing bullet
  style for other features (Ledger, Accounts, etc.).
- Bump `APP_VERSION` in `src/utils.js`: `4.48.0` → `5.0.0` (major, per
  explicit request rather than the usual minor-for-new-feature convention);
  matching `sw.js` `CACHE_NAME` bump (PWA cache invalidation).
- New `## [5.0.0] — 2026-09-07` entry in `CHANGELOG.md` under "Added"
  (kept in sync with `APP_VERSION` per `tests/features/test_versioning.py`).
