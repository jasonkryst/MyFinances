# src/ Reorganization: Split Oversized Modules, Fix Misplacement, Deduplicate Shared Logic

## Context

MyFinances (`src/`) is 26 ES6 modules, ~11,700 lines, organized around the feature-module-delegation pattern documented in `CLAUDE.md` (every feature module exports plain `fn(app, ...)` functions; `app.js`'s `DebtTrackerApp` has thin delegating methods). Over time:

- Six files grew large enough to bundle multiple independent concerns: `reports.js` (1222 lines), `strategy.js` (995), `ledger.js` (983), `debts.js` (866), `app.js` (863), `storage.js` (830).
- Small helpers (date formatting, HTML escaping, currency formatting, account-type icons, `<option>`-list building) were copy-pasted across files instead of shared, in some cases with subtle behavioral drift (see the date-formatting bug below).
- A handful of functions ended up in a file that doesn't match their domain, or in `app.js` as more than a thin delegating wrapper.

This is a pure refactor: no behavior changes, no data-shape changes. The full Playwright test suite (`pytest tests/`) must stay green throughout, since it exercises real rendered DOM output, not just module imports.

## Goals

1. Split the six oversized files into focused, single-purpose modules along seams that don't share private state across the split (verified file-by-file below).
2. Consolidate duplicated logic into `utils.js` (generic) or the owning domain module (`accounts.js` for account-domain helpers).
3. Move the small number of confirmed-misplaced functions to their correct module.
4. Delete confirmed dead code.
5. Bump `APP_VERSION` (minor) and update `CLAUDE.md` to describe the new module layout.

## Non-goals

- No new abstractions beyond what's needed to remove the confirmed duplication below — e.g. `charts.js`'s two color palettes are *not* merged (different lengths/orderings; one is genuinely distinct, only the exact-duplicate one gets consolidated).
- No change to the JSON export format version, storage schema, or any sanitizer's validation behavior.
- `ui.js:483` `updateFormVisibility()` is *not* moved — plausibly debt-form-specific, but low-confidence, and moving it isn't justified by clear evidence either way.
- `health.js`/`spending.js` internal helpers (`dtiStatus`, `gaugeColor`, `categoryColor`, `_hexToRgba`, etc.) are *not* split out or moved — verified domain-local, not duplicated elsewhere.
- `getForecastAssetAccounts` (`forecast.js`) is *not* moved to `accounts.js` — only one consumer exists today; premature to relocate.

## File layout — new/changed files

All new files stay flat in `src/` (matching the existing convention; no subfolders introduced).

### `reports.js` (1222 → ~90 lines)

Split by render-target; the only shared dependency across the split is `getReportDate(app)` (moving to `utils.js`, see below) and `getLedgerTransactionsForMonth`.

- **`reports.js`** (orchestrator, stays): `prevReportMonth`, `nextReportMonth`, `updateReportMonthNav`, `renderReportsPage`.
- **`reportsNetWorth.js`** (new): `toMonthKey`, `getSnapshotSeries`, `computeSnapshotMetrics`, `captureNetWorthSnapshot`, `renderNetWorthWidget`, `renderReportsNetWorth`.
- **`reportsCalendar.js`** (new): `renderReportsCalendar`, `openCalendarDayModal`.
- **`reportsCashFlow.js`** (new): `renderReportsIncomeExp`, `renderReportsMoneyFlow`.
- **`reportsVariance.js`** (new): `renderReportsVariance`.
- **`reportsSummary.js`** (new): `computeReportsSummaryMetrics`, `renderReportsSummary` (imports `getSnapshotSeries` from `reportsNetWorth.js`).

### `ledger.js` (983 → ~340 lines)

- **`ledgerTransactions.js`** (new, pure computation, no DOM): `buildProjectedAccountTransactions`, `getLedgerTransactionsForMonth`, `getAccountForecastSeries`, `getLedgerTransactions`, `getFilteredSortedLedgerTransactions`, `makeLedgerTransactionId`, `toLedgerTxOutput`.
- **`ledgerOverrides.js`** (new, the override subsystem `CLAUDE.md` already documents as distinct): `getOverrideAmount`, `getEffectiveAmount`, `setLedgerAmountOverride`, `clearLedgerAmountOverride`, `openLedgerOverrideModal`.
- **`ledger.js`** (stays): `renderLedgerPage`, `openLedgerExportModal`.
- `reconciliation.js` (which currently imports `getLedgerTransactionsForMonth`, `renderLedgerPage` from `ledger.js`) updates its imports to pull the transaction functions from `ledgerTransactions.js` and the renderer from `ledger.js`.

### `storage.js` (830 → ~250 lines)

- **`sanitizers.js`** (new): all 15 `sanitizeX()` functions + `sanitizeParsedState` (currently lines 27–266 of `storage.js`).
- **`dataExport.js`** (new): `exportAllJSON`, `importAllJSON`, `csvField`, `exportToCSV`, `exportLedgerToCSV`, `ledgerExportCellValue`, and the `LEDGER_EXPORT_COLUMN_*` constants.
- **`storage.js`** (stays): `getStorageUsageInfo`, `saveToStorage`, `loadFromStorage`, `switchStorageBackend`, `clearAllData`. Imports sanitizers from `sanitizers.js` for use in `loadFromStorage`/`importAllJSON`'s call sites (import path updates as needed).

### `strategy.js` (995 → ~120 lines)

Flat naming per approved layout (`strategyX.js`, not `strategy/x.js`):

- **`strategyPlanCalculation.js`** (new): `calculatePaymentPlanFromInputs`, `calculateRequiredPayment`, plus the new consolidated `recalculatePaymentPlan(app)` (see Deduplication below).
- **`strategyCalendar.js`** (new): `renderCalendarView`.
- **`strategyComparison.js`** (new): `displayInterestComparison`, `displayWhatIfSimulator`.
- **`strategySummaryTable.js`** (new): `renderDebtSummaryTable`, `displayDebtSummary`, `showAmortizationModal`.
- **`strategyScheduleTable.js`** (new): `displayPaymentSchedule`.
- **`strategy.js`** (stays): `displayPaymentPlan` (orchestrator, calls into the above), `renderStrategyIncomeWidget`.

### `debts.js` (866 → ~610 lines)

- **`debtBreakEven.js`** (new): `renderBreakEvenBadge`, `_renderBreakEvenChart`, `showAccelerateModal` — all three render UI derived from `computeBreakEven()` (`breakEven.js`); pairs naturally with the existing pure-calc module.
- **`debts.js`** (stays): CRUD (`addDebt`, `deleteDebt`, `updateDebtBalance`, `saveEdit`, `cancelEdit`, `startEdit`, `cancelInlineEdit`, `saveInlineEdit`, `showUpdateBalanceModal`) + `renderDebtsList`.

## Deduplication — new shared helpers

### `utils.js` additions

| New export | Consolidates | Notes |
|---|---|---|
| `formatShortDate(value)` | 7 independent "Mon D, YYYY" formatters: `forecast.js:97` (`formatForecastDate`), `reconciliation.js:10` (`_formatDate`), `ledger.js:980` (`_formatLedgerDate`), `income.js:70,78,326` (inline ×3), `debts.js:583` (inline) | **Fixes a real bug**: the `reconciliation.js`/`income.js`/`debts.js` copies pad bare `YYYY-MM-DD` strings with `T12:00:00` before formatting (avoiding a UTC-midnight day rollback); the `ledger.js`/`forecast.js` copies don't. The new helper detects a bare-date string via `/^\d{4}-\d{2}-\d{2}$/` and pads it; otherwise passes the value straight to `toLocaleDateString` — a safe superset of every existing call site. |
| `formatMonthYear(value)` | `debts.js:589`, `strategy.js:673` (exact duplicates, "Mon YYYY") | |
| `dateToISO(date)` | `ledger.js:7` (`getDateKey`) | `todayISO()` becomes `dateToISO(new Date())` internally; `ledger.js` imports `dateToISO` and drops its local copy. |
| `parseFiniteOrNull(value)` | `ledger.js:24` (`parseFiniteNumber`) | **Not merged with `sanitizeFiniteNumber`** — different contract (null-sentinel for "no override set" vs. fallback+clamp for persisted-data sanitizing). Relocated only because it's a generic primitive with nothing ledger-specific about it. |
| `getReportDate(app)` | `reports.js:17` (canonical) + `spending.js:58` (`_getReportDate`, near-identical private copy) | Moving the canonical version to `utils.js` breaks the circular-import risk (`reports.js` imports `renderReportsSpending` from `spending.js`; `spending.js` importing back from `reports.js` would cycle). Both `reportsSummary.js` and `spending.js` import it from `utils.js`. |
| `incomeDaysInMonth(inc, year, month)` | `reports.js:13` | Pure wrapper around `getIncomePaydaysInMonth` that never used its `app` parameter — drop the parameter when moving. Check/update call sites for the signature change. |
| `dailyCompoundInterest(balance, aprPct, days)` | `debts.js:556` | Display-only reimplementation of the compounding formula that already exists twice inside `debtCalculator.js` (`:129`, `:172`, both left in place — internal to the calculation engine, not duplication across the app/calculator boundary). `debts.js` gets this from `utils.js` instead of reimplementing it for card rendering. |

Also: **`escapeHtml`** — delete `ledger.js`'s byte-identical local copy (`ledger.js:15-22`); add `escapeHtml` to `ledger.js`'s existing `from './utils.js'` import and update its 8 call sites to the import (no behavior change, they're identical).

**`charts.js`**: replace 5 inline `new Intl.NumberFormat('en-US', {style:'currency',...})` reimplementations (lines ~62, 107, 209-212, 272, 331) with the existing `formatCurrency` import from `utils.js`.

**`strategy.js` dead fallback**: delete the local `fmt()` wrapper (`strategy.js:553-562`) that reimplements `formatCurrency` defensively "in case it's not a function" — `formatCurrency` is always imported and always a function. Use it directly.

### `accounts.js` additions

Account-domain helpers stay in `accounts.js` rather than `utils.js`:

- **`ACCOUNT_TYPE_ICONS`** — the `{ Checking: '🏦', Savings: '💰', ... }` emoji map, currently copy-pasted identically in `accounts.js:50`, `reports.js:839` (as `typeIcon`), and `reconciliation.js:4` (as `TYPE_ICON`). Export once from `accounts.js`, import in `reportsCashFlow.js` and `reconciliation.js`.
- **`buildAccountOptionsHtml(accounts, selectedId, { emptyLabel } = {})`** — consolidates ~6 near-identical `<option>`-list-building blocks in `income.js:58,359`, `bills.js:39,131`, `recurring.js:246,249`, and the simpler no-`selected` variant in `savings.js:57,207`.

### `strategyPlanCalculation.js` addition

**`recalculatePaymentPlan(app)`** — consolidates 5 near-identical "read DOM inputs → guard → `DebtCalculator.calculatePaymentPlan` → store `lastPaymentPlan`/`lastSummary` → catch" blocks: `strategy.js:33-50`, `strategy.js:207-215`, `strategy.js:980-991`, `debts.js:5-22` (`recalculateIfConfigured`), and `debts.js:346-361` (inlined a second time within the same file, inside `saveEdit`). `debts.js` imports the consolidated function instead of keeping its own copies.

## Misplaced-function moves

- **`app.js:842-857` `switchLiabilitiesSubTab()`** — contains real DOM class-toggling logic inline, unlike its siblings `switchTab()`/`switchPage()`, which delegate to `ui.js`. Move the logic into `ui.js` as `switchLiabilitiesSubTab(app, subTab)`; leave a one-line delegating wrapper in `app.js`, matching the established pattern.
- **`app.js:165-175`** (constructor) — a backfill loop assigning a default `accountId` to legacy incomes missing one. This is load-time migration logic, not delegation. Move into `storage.js`'s load path (alongside `sanitizeIncome`/`loadFromStorage`), since that's where every other legacy-data-shape concern already lives.

## Dead code removal

- **`app.js:444-454`** `computeMonthlyIncome()` / `computeMonthlyBonuses()` — labeled as "compatibility shims for stale callsites." Verified via repo-wide grep: zero callers anywhere in `src/`, `index.html`, or `tests/`. Delete both methods entirely.

## Verification plan

1. After each file split/move, run `pytest tests/ -v` — full suite must stay green (it drives the real app via Playwright against `http://localhost:5500/`, so it validates actual rendered output of the split modules, not just that imports resolve).
2. Manually smoke-test in a browser: Reports page (all sub-tabs), Ledger page (including override modal and export), Strategy/Plan page (calendar, comparison, summary table, amortization modal, schedule), Debts page (add/edit/break-even badge/accelerate modal), Settings → storage backend switch, JSON export/import round-trip.
3. Confirm `index.html`'s `<script type="module" src="src/app.js">` still resolves the full import graph with no console errors (new files are all ES modules resolved by relative URL — no build step, no bundler config to update).

## Docs & versioning

- Bump `APP_VERSION` in `utils.js`: `4.6.1` → `4.7.0` (minor — organizational change, no user-facing behavior change).
- Update `CLAUDE.md`: the "Every feature module..." file list in the Architecture section, plus any prose referencing file line-count assumptions or the specific files being split.
- No change to the JSON export format version (`"3.0"`) — this refactor doesn't touch persisted data shape.
