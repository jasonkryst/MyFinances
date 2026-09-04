# MyFinances — Features & Functionality Audit

**Date**: 2026-09-02
**Version audited**: 4.40.0 (HEAD @ `aa6ead3`, branch `feature/ledger-cleared-transactions`)
**Scope**: Feature completeness, cross-feature consistency, data-shape/sanitizer parity, the known `server/test/` failure, dead code, TODO markers, responsive-table compliance.
**Explicitly out of scope**: security, accessibility, i18n, performance, test coverage (covered by other audits).

> **Post-audit update:** the `clearedAt`/`updatedAt` timestamp-truncation bug documented below (§4, and the sibling `ledgerAmountOverrides` case in §3) was fixed the same day: a new `sanitizeTimestampISO()` helper in `src/utils.js` replaced the misused `sanitizeDateISO()` in `src/sanitizers.js` and `server/src/routes/ledgerCleared.js`. `server/test/` re-run afterward: 86/86 passing. Findings below are left as-written as the audit trail.

---

## Executive Summary

The codebase is in good functional shape overall: all ten top-level pages are consistently wired through `switchPage()` → `renderPageData()` → the command palette (no missing/orphaned page registrations found), every feature module follows the `featureFn(app, ...)` + thin `DebtTrackerApp` wrapper delegation pattern, no `TODO`/`FIXME`/`XXX`/`HACK` markers exist anywhere in `src/` or `server/src/`, and the two documented responsive-table CSS patterns are being followed correctly in the Ledger and Reconciliation tables, including the newly added Cleared column.

The one substantive functional bug found is the one the task flagged: **the ledger-cleared-transaction `clearedAt` timestamp silently loses its time-of-day on every round-trip through a sanitizer**, both server-side (Postgres) and client-side (localStorage/sessionStorage load + JSON import). Root cause: `sanitizeClearedEntry` (server) and `sanitizeLedgerClearedTransactions` (client) both reuse `sanitizeDateISO()` — a helper deliberately designed to reduce any timestamp down to a bare `YYYY-MM-DD` date — for a field that the UI (`src/ledger.js:169`) renders as a full date+time tooltip (`new Date(tx.clearedAt).toLocaleString()`). The identical mistake also exists for `ledgerAmountOverrides.updatedAt` (lower impact — not rendered as a timestamp anywhere), suggesting the new `ledgerCleared.js` code was copy-pasted from the override pattern without re-checking whether the reused sanitizer was appropriate for a full-precision field.

Secondary findings: a small cluster of dead/superseded exports (`src/i18n.js:getLocalePreference`, `src/recurring.js:getRecurringTotalsForMonth`, `src/savings.js:calculateSavingsProjection`, plus three `utils.js` day-bucketing helpers), and a documentation gap where CLAUDE.md's module list doesn't flag that `bills.js`'s add/edit/render-list functions are intentionally unreachable from the UI (a decision already made and tracked in `ROADMAP.md`/`tests/features/test_bills.py`, just not mentioned in CLAUDE.md).

**Top 5 findings** (see full detail below):
1. **[High]** `clearedAt` timestamp truncated to midnight by `sanitizeDateISO` misuse — root cause of the failing `server/test/keyedResources.test.js` test, and also reproducible client-side with no server involved.
2. **[Medium]** Same `sanitizeDateISO`-for-a-timestamp mistake also affects `ledgerAmountOverrides.updatedAt` (both client sanitizer and Postgres route) — currently benign only because nothing renders that field's time-of-day.
3. **[Low]** `renderBillList`, `getLocalePreference`, `getRecurringTotalsForMonth`, `calculateSavingsProjection`, `getExpensesByDayForMonth`, `getBonusesByDayForMonth` are dead/unreachable exports, mostly superseded by the unified ledger-transaction data path.
4. **[Low]** `getBillsByDayForMonth` is used by `strategyCalendar.js` but its sibling helpers for expenses/bonuses are not — the Strategy page's mini-calendar surfaces only bill due-dates, not expense or bonus days, even though matching helpers exist (unclear if intentional).
5. **[Low/Doc]** CLAUDE.md's architecture section doesn't mention that the Bills UI (`#billForm`/`#billList`) was intentionally removed May 29, 2026 in favor of Recurring Templates, while `bills.js` and `app.bills` remain fully alive as a data model/calculation dependency for accounts/health/ledger/strategy — a newcomer reading only CLAUDE.md would expect a working Bills UI.

No security, a11y, i18n, performance, or test-coverage issues are in scope for this report.

---

## 1. Feature completeness vs. documentation

Verified every module CLAUDE.md names under "Every feature module... follow this same pattern" exists in `src/`, exports plain `featureFn(app, ...)` functions, and is wrapped by a thin one-line `DebtTrackerApp` method in `src/app.js` (e.g. `renderRecurringPage() { return renderRecurringPageFeature(this); }`, `src/app.js:880-909`). No missing modules, no logic found living directly on `DebtTrackerApp` in place of delegation — the handful of methods in `src/app.js` lines 232-872 that look longer than one line are all pre-existing wrapper bodies matching the module's actual call signature (e.g. `switchPage(pageName)` at `src/app.js:341` still just forwards into `ui.js`'s `switchPage`), not reimplemented business logic.

**Page navigation** (`src/ui.js:555-638`) and **command palette** (`src/commandPalette.js:13-23`) both register exactly the same 10 pages: `health, accounts, liabilities, income, savings, strategy, reports, ledger, recurring, reconcile`. No orphaned or missing page.

**Finding — Doc gap, Low severity — RESOLVED 2026-09-03**: a new `CLAUDE.md` "Cross-cutting features" bullet now documents this exact gap, cross-referencing `test_bills.py`'s `test_no_reachable_bill_add_ui`. `CLAUDE.md`'s "Cross-cutting features" section doesn't mention that the **Bills feature has no reachable add/edit UI** (`#billForm`/`#billList` don't exist in `index.html`; no nav button targets a `budget` page). This is an intentional, already-tracked decision (`ROADMAP.md:463-471`, `tests/features/test_bills.py:1-16`) dating to May 29, 2026, in favor of Recurring Templates — `app.bills` still round-trips through storage/import/export and is consumed by `accounts.js`, `health.js`, `ledger.js`, `strategy.js`. Not a bug, but CLAUDE.md's module list presents `bills.js` without this caveat, which will mislead anyone auditing/extending the app from CLAUDE.md alone. Consequence: `renderBillList`, and by extension the add/edit/delete bill functions, are technically "used" (imported by `app.js`'s wrapper methods) but functionally unreachable — see dead-code appendix.

`ROADMAP.md` itself is stale relative to `CHANGELOG.md` (last substantive update Aug 31 / v4.29.0, while `CHANGELOG.md` is at v4.40.0 — `ROADMAP.md:15-17` acknowledges this with a pointer to the changelog for v4.7+). Not a functional bug, just a doc-hygiene note.

---

## 2. Cross-feature consistency (Reports / Forecast / Health / Accounts)

Checked whether Reports/Forecast/Health modules recompute account balances independently instead of using `computeAccountBalance()` (`src/accounts.js:35-49`).

- `src/reportsSummary.js:40` (`computeReportsSummaryMetrics`) calls `app.computeAccountBalance(a.id, year, endMonth)` for the end balance and only uses the account's static `startingBalance` field for the period-start figure (which is correct — `startingBalance` isn't month-scoped). **Consistent.**
- `src/reportsCashFlow.js:305` (`renderReportsMoneyFlow`) likewise calls `app.computeAccountBalance(a.id, year, month)`. **Consistent.**
- `src/forecast.js` uses a *different* code path — `getAccountForecastSeries()` / `buildProjectedAccountTransactions()` in `src/ledgerTransactions.js` — for its day-granular, multi-month-ahead projection with intra-month low/high tracking. This is a deliberately different computation (`computeAccountBalance()` is month-end only; forecast needs day-by-day running balance across a >12-month window), not a duplicated reimplementation of the same math, and both ultimately derive from the same `getLedgerTransactionsForMonth`/`buildProjectedAccountTransactions` ledger data. **No divergence found**, but flagging as a **watch item**: `computeAccountBalance()` and `getAccountForecastSeries()` are two independently-maintained balance-computation paths sharing no common helper — a future change to how transactions net into a balance (e.g. a new transaction type) would need to be applied in both places. Not currently observed to have drifted, but worth a shared-helper refactor if a real divergence is ever found.
- `src/health.js` does not compute account balances itself; it reads pre-aggregated debt totals only. No issue.

---

## 3. Data-shape / sanitizer parity — spot check: `ledgerClearedTransactions` (newest field, commit `aa6ead3`)

Traced all four persistence paths for the `clearedAt` field:

| Path | File:line | Behavior |
|---|---|---|
| localStorage/sessionStorage **save** | `src/storage.js:126` | Writes `app.ledgerClearedTransactions` raw (full-precision ISO timestamp), no sanitization on save. |
| localStorage/sessionStorage **load** | `src/storage.js:186` → `src/sanitizers.js:114-124` (`sanitizeLedgerClearedTransactions`) | **Truncates** `clearedAt` to a bare date via `sanitizeDateISO()` (`src/utils.js:67-83`). |
| JSON export/import | `src/dataExport.js:35,277,358,404` | Export copies the in-memory value as-is; import runs the same `sanitizeParsedState`/`sanitizeLedgerClearedTransactions` as load, so import also truncates. |
| Postgres | `server/src/routes/ledgerCleared.js:4-9` (`sanitizeClearedEntry`) | **Truncates** immediately on `PUT`, using the same `sanitizeDateISO` (re-exported via `server/src/sanitizers/index.js` → `src/sanitizers.js`/`src/utils.js`). |

Table/migration parity itself is otherwise correct: `ledger_cleared_transactions` (`server/migrations/1755600000005_create-ledger-cleared-transactions.js`) has the right `timestamptz` column and compound primary key `(user_id, cleared_key)`; the keyed-resource route (`server/src/routes/ledgerCleared.js`, built on the shared `createKeyedResource` factory in `server/src/keyedRouter.js`) correctly implements PUT-upsert/GET-list/DELETE; `loadFromPostgres()` (`src/storage.js:34-53`), `postgresSync.js` (endpoint list, `src/postgresSync.js:17`), and `postgresImport.js` (replace/merge/rollback, lines 62, 108-118, 154-155, 193, 297-318, 381) all wire the resource through correctly. **The only defect is the timestamp precision loss described in §4.**

Spot-checked `ledgerAmountOverrides` for the same class of bug: `sanitizeLedgerOverrides()` (`src/sanitizers.js:95-112`) and the Postgres route (`server/src/routes/ledgerOverrides.js:4-16`) both also run `updatedAt` through `sanitizeDateISO`, truncating it identically. Currently low-impact because nothing in the UI displays `updatedAt`'s time-of-day (unlike `clearedAt`), but it's the same latent defect and should be fixed alongside §4.

---

## 4. Known live issue — root cause of the failing `server/test/` test

**Test**: `server/test/keyedResources.test.js:108` — `"ledger-cleared: PUT upserts a compound-key entry and GET lists it"`.

Reproduced directly (test Postgres already running via `server/docker-compose.test.yml`, migrations applied):

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected
+ '2026-08-02T00:00:00.000Z'
- '2026-08-02T10:00:00.000Z'
    at TestContext.<anonymous> (test\keyedResources.test.js:116:12)
```

**Root cause**: `server/src/routes/ledgerCleared.js:4-9`

```js
function sanitizeClearedEntry(body, key) {
    return {
        clearedKey: key,
        clearedAt: sanitizeDateISO(body?.clearedAt) || new Date().toISOString()
    };
}
```

`sanitizeDateISO()` (`src/utils.js:67-83`, shared into the server via `server/src/sanitizers/index.js:1`) is purpose-built to **normalize any full ISO timestamp down to its bare `YYYY-MM-DD` date part** — its own comment says "Heal legacy full ISO timestamps stored by `Date.toISOString()`". It was written for genuinely date-only fields (e.g. an override's `date`, a net-worth snapshot's date). The `PUT` body's `clearedAt: '2026-08-02T10:00:00.000Z'` is reduced to `'2026-08-02'` before being written to the `timestamptz` column, which Postgres then stores as `2026-08-02 00:00:00+00` — midnight — permanently discarding the actual time the checkbox was clicked.

This is not a test-only artifact — it reproduces identically on the pure client (no server/Postgres involved):
- `src/ledgerCleared.js:26` sets `clearedAt: new Date().toISOString()` (correct, full precision) when a user checks the box.
- `src/ledger.js:169` renders the checkbox tooltip as `Cleared ${new Date(tx.clearedAt).toLocaleString()}` — a full date+time string, per the 4.40.0 changelog entry ("stamps a `clearedAt` timestamp... shown as the checkbox's tooltip").
- `src/storage.js:89-126` (`saveToStorage`) persists the full-precision value to `localStorage`/`sessionStorage` untouched.
- But `src/storage.js:173-186` (`loadFromStorage`, called on every app boot) runs `sanitizeParsedState()` → `sanitizeLedgerClearedTransactions()` (`src/sanitizers.js:114-124`), which calls the same `sanitizeDateISO()` and truncates `clearedAt` to a bare date.

**End-to-end user impact**: check "Cleared" → tooltip is correct for that session → reload the page (or the app boots fresh next visit) → the tooltip now shows midnight in the viewer's local timezone (potentially even the *previous calendar day*, depending on UTC offset) instead of the actual time it was cleared — and because the truncated value is what gets held in memory from that point on, the next save persists the degraded value, making the loss permanent. JSON export/import goes through the same sanitizer and has the identical effect. Postgres users lose the precision immediately on `PUT`, with no reload needed.

**Fix direction (not applied — audit only)**: `clearedAt` (and `ledgerAmountOverrides.updatedAt`, §3) need a full-timestamp sanitizer — e.g. validate via `Number.isNaN(new Date(value).getTime())` and pass through `new Date(value).toISOString()` rather than reusing the date-only `sanitizeDateISO()`. `sanitizeDateISO()` itself should probably keep its current date-only contract for the fields that genuinely want it (its "heal legacy timestamps" fallback is fine for those).

---

## 5. Dead code / unused exports

**RESOLVED 2026-09-04:** `renderBillList`, `getLocalePreference`, `getRecurringTotalsForMonth`, `calculateSavingsProjection`, and `incomeDaysInMonth` were deleted (with `CLAUDE.md`'s helper-list mention of `incomeDaysInMonth` corrected to `countIncomePaydaysInMonth`, and `stryker.config.mjs`'s `utils.js` mutate ranges corrected, since removing dead code shifted every line number below it). `getExpensesByDayForMonth`/`getBonusesByDayForMonth` were **not** deleted — see the product-decision note below, which was resolved in favor of wiring them in rather than deleting them.

Method: `grep -rn "^export function\|^export async function" src/` (191 exports found), cross-referenced against whole-repo usage (`\b<name>\b` word-boundary count across all `src/*.js`, `index.html`; test files checked separately). Exports with **zero** references outside their own definition line:

| Export | Location | Note |
|---|---|---|
| `renderBillList` | `src/bills.js:16` | Never called — `renderBudgetPage()` (`src/bills.js:9-14`, the only entry point invoked after bill/expense mutations) calls `renderExpenseList` and `renderCashFlowSummary` but not `renderBillList`. Consequence of the intentional Bills-UI removal (§1) — the `#billList` container it targets doesn't exist in `index.html` either. |
| `getLocalePreference` | `src/i18n.js:37-39` | Duplicates the module-private `readStoredLocale()`; superseded by `getCurrentLocale()` (`src/i18n.js:49-51`, backed by the cached `currentLocale` module variable), which is what `src/setupWizard.js:103` actually uses. |
| `getRecurringTotalsForMonth` | `src/recurring.js:459-473` | Doc'd as "Storage helpers" section but computes debit/credit totals per month directly from `recurringTemplates`. Appears superseded by the unified ledger-transaction approach (`getLedgerTransactionsForMonth`, `tx.type === 'recurring'`) used by `reportsSummary.js` and others. |
| `calculateSavingsProjection` | `src/savings.js:653-676` | Doc comment says "Calculate projected savings for reports," but Reports computes its `savings` cash-flow total from ledger transactions (`tx.type === 'savings'`) in `reportsSummary.js:30-31` instead — a different, non-overlapping concept (actual ledger movement vs. a projection of auto-contributions), but this function itself has no caller anywhere. |
| `incomeDaysInMonth` | `src/utils.js:196-199` | CLAUDE.md explicitly lists this as one of the "shared formatting/date/number helpers," but it has no current caller; likely superseded by `countIncomePaydaysInMonth` (`src/utils.js:192`), which *is* used. |
| `getExpensesByDayForMonth` | `src/utils.js:317-330` | See finding below — paired with `getBillsByDayForMonth`, which *is* used. |
| `getBonusesByDayForMonth` | `src/utils.js:331-345` | Same as above. |

**Related completeness finding (Low, unclear intent) — RESOLVED 2026-09-04, decided in favor of wiring in, not deleting.** `getBillsByDayForMonth` is used by `src/strategyCalendar.js:108` to mark bill due-dates on the Strategy page's mini-calendar. Its two siblings, `getExpensesByDayForMonth` and `getBonusesByDayForMonth`, existed with matching signatures/purpose but were never called anywhere — meaning the Strategy calendar showed bill due-dates only, not expense or bonus days, despite the helper code for those existing. Product decision: expense (`.cal-expense-event`, purple) and bonus (`.cal-bonus-event`, teal) day-markers are now rendered alongside the existing debt-payment/payday/bill-due markers, with matching legend entries and dark-mode/high-contrast styling. 4 new Playwright tests in `tests/ui/test_strategy_calendar.py` (previously zero coverage of the calendar view at all).

---

## 6. TODO / FIXME / XXX / HACK inventory

```
grep -rn "TODO\|FIXME\|XXX\|HACK" src/ server/src/
```

**Zero matches.** No incomplete-work markers exist anywhere in the application or server source trees.

---

## 7. Responsive table/grid compliance spot-check

CLAUDE.md documents two required patterns: (1) `.table-wrapper`/`overflow-x: auto` for genuinely wide multi-column tables, (2) header-hiding + `attr(data-label)` restacking for narrow summary grids — citing the 4.19.0 clipping bug as the failure mode to avoid.

- **Ledger** (`src/ledger.js:128`): `<div class="table-wrapper"><table class="ledger-table">...` — correctly wrapped. The new Cleared checkbox column (`src/ledger.js:169`) is just an additional `<td>` inside this existing wrapper; `.ledger-table` (`styles.css:338-390`) has no fixed-px `grid-template-columns` and scrolls horizontally as a normal `<table>` would. **Compliant.**
- **Reconciliation** (`styles.css:5907`): `.recon-table-wrap { overflow-x: auto; }` — same pattern. **Compliant.**
- **Account Balances / Money Flow summary** (`src/reportsCashFlow.js:309`, `.acct-mf-row`, `styles.css:5299-5332`): uses the header-hide/restack pattern (`.acct-mf-row` has a mobile breakpoint rule at `styles.css:5332`), consistent with pattern (2) for a few-column summary grid. **Compliant.**
- **Budget Variance** (`.var-row`, `styles.css:4966-5126`): same restack pattern with a mobile breakpoint at `styles.css:5107` and `::before`/`attr(data-label)` at `styles.css:5126`. **Compliant.**

No new wide-table or summary-grid CSS was found that reintroduces a fixed-px `grid-template-columns` without a mobile treatment. No regression of the 4.19.0 bug class detected in the areas spot-checked.

---

## Appendix A — Dead code (full list)

See §5 for detail. Summary list of exports with no callers anywhere in `src/`, tests, or `index.html`:

- `src/bills.js:16` — `renderBillList(app)`
- `src/i18n.js:37` — `getLocalePreference()`
- `src/recurring.js:459` — `getRecurringTotalsForMonth(app, year, month)`
- `src/savings.js:653` — `calculateSavingsProjection(app, year, month)`
- `src/utils.js:196` — `incomeDaysInMonth(inc, year, month)`
- `src/utils.js:317` — `getExpensesByDayForMonth(expenses, year, month)`
- `src/utils.js:331` — `getBonusesByDayForMonth(bonuses, year, month)`

Note: `addBill`, `deleteBill`, `startEditBill`, `saveEditBill`, `cancelEditBill` (`src/bills.js`) are technically "used" (imported and wrapped by `src/app.js`'s thin delegation methods) but are functionally unreachable from any UI path, per the intentional Bills-UI removal documented in `ROADMAP.md:463-471` and protected by `tests/features/test_bills.py:22-37`. Not flagged as dead code (the wrapper chain is real, exercised by tests operating on `app` state directly) but noted here since a naive "is it imported" check would miss that it's UI-dead.

## Appendix B — TODO/FIXME/XXX/HACK inventory

None found in `src/` or `server/src/` (see §6).
