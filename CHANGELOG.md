# Changelog

All notable changes to MyFinances are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
Detailed specs and implementation notes live in [`docs/superpowers/`](docs/superpowers/).

## [6.48.1] — 2026-10-27

### Fixed
- **What's New modal stuck at 6.41.0** — `WHATS_NEW_ENTRIES` (`src/ui.js`) hadn't been updated since 6.41.0; entries for 6.42.0–6.48.0 added. The staleness guard `test_whats_new_entries_not_stale` (which allowed up to 3 minor versions of drift) never caught it because `tests/features/test_whats_new.py` wasn't listed in any `ci.yml` feature shard, so it never ran in CI. The file is now in `test-features-i`, the guard requires the newest entry's major.minor to equal `APP_VERSION`'s, and two new file-parsing tests fail on any CHANGELOG minor release missing from What's New and on out-of-order/ahead-of-app entries.

## [6.48.0] — 2026-10-27

### Added
- **Configurable $0 ledger amount policy** (issue #412) — new Settings → Advanced select ("$0 ledger amounts": Allow / Warn / Block, default Allow) controls whether a $0 amount may be saved in the Ledger override modal and in recurring templates (add and inline edit). Warn asks for confirmation; Block shows a notice and saves nothing. Recurring templates of type Transfer, and one-off transfers, still require an amount above $0 regardless of the policy. Recurring forms now accept $0 (previously rejected).

### Fixed
- A blank amount in the Ledger override modal was silently saved as $0; blank or whitespace-only amounts are now always rejected ("Please enter a valid number."). Type 0 for a deliberate $0 entry.

## [6.47.0] — 2026-10-27

### Changed
- **Accessibility: ARIA label audit across interactive controls** (issue #331) — per-item action buttons now carry item-specific accessible names (`Edit Visa card`, `Delete Netflix`, `Save changes to Main Checking`, `Cancel editing Visa card`, `Transfer from Main Checking`, `History for Visa card`, `Contribute to Vacation Fund`, etc.) on the Accounts, Income/Bonuses, People, Liabilities (Debts + Budget), Recurring, Savings (Emergency/Sinking), Reconcile, Retirement, and Ledger (override/transfer/cleared/select) controls; each label starts with the button's visible text, and item names are escaped with `escapeHtml()` before reaching the attribute. Toggle-style buttons (Liabilities/Savings sub-tabs, 1M/3M/6M/12M and Project range chips, Monthly/Yearly summary toggle, Budget cash-flow tabs, Show/Hide archived) now expose an explicit `aria-pressed` that is kept in sync on every change. The Ledger and Plan debt-summary sortable column headers are now keyboard-focusable (Enter/Space), expose `aria-sort`, and carry a direction-aware `aria-label` (e.g. "Sort by Amount, descending"). Reports month navigation gains `aria-label`s (previously `title`-only), the disabled bonus year arrows keep a label, and Plan's amortization "View" buttons name their debt. New Retirement strings are localized (`retirement.deleteSnapshotAria`, `retirement.addSnapshotAria`, `retirement.logSalaryReviewAria` in `en`/`es`/`pl`).

### Added
- `tests/ui/test_aria_labels.py` — automated scan asserting every visible `button`/`[role=button]`/`[role=tab]` has a non-empty accessible name on every top-level page and Reports sub-tab, plus positive and negative (XSS-safe literal item names, `aria-pressed="false"` never missing, untouched text buttons not overridden) checks for the labels above.

## [6.46.0] — 2026-10-27

### Fixed
- **Home Purchase plan now syncs to the optional Postgres backend** (issue #405) — the plan from #249 previously persisted only in the browser's local/session storage even when the Postgres backend was active. It is now stored as a nullable `home_purchase_plan jsonb` column on `plan_settings` (migration `1755600000025`) and travels through the existing `/api/plan-settings` GET/PATCH, re-sanitized server-side with `sanitizeHomePurchasePlan()` (invalid payloads become `null`). Load, save, clear-all (`pgDeleteAll`), and Postgres replace/merge import (including rollback snapshots) all carry it. Also fixes a JSON import containing only a Home Purchase plan being rejected as "no data".

## [6.45.0] — 2026-10-27

### Added
- **Reports: custom date range for Spending and Variance** (issue #329) — both the Spending Analysis and Budget Variance ("What Changed") reports gain a shared Range selector (Single Month/Quarter/Half Year/Year), generalizing their existing single-month comparison into an N-month window ending at the currently-navigated report month. `computeSpendingByCategoryRange(app, year, month, rangeMonths)` (`src/spending.js`) sums `computeSpendingByCategory()`'s per-category totals across every month in the range; `reportsVariance.js`'s new `_sumRangeTotals()` does the same for its five income/expense/recurring/debt/savings buckets. Both reports compare the selected range against the equivalent-length range immediately before it (e.g. a quarter compares against the prior quarter) via new shared helpers in `src/utils.js` (`reportRangeMonthsList`, `getPriorEquivalentRangeEnd`, `formatReportRangeLabel`); Spending's existing year-over-year toggle (issue #332) is generalized the same way (same N-month range, one year prior). The shared `app._reportRangeMonths` state (default `1`, the original single-month behavior) persists across Spending/Variance tab switches and resets to `1` on navigating away from and back to Reports, matching the existing `app._reportMonthOffset` reset convention in `renderPageData`.
- Fixed a latent, intermittent circular-import hazard surfaced by this work: `spending.js` (imports `ledgerTransactions.js`) → `ledgerTransactions.js` (imports `recurring.js`) → `recurring.js` (imported `PINNED_COLORS` from `spending.js`) formed a 3-module ES import cycle through a `const` export, which the browser's module loader intermittently evaluated out of order, throwing `ReferenceError: Cannot access 'PINNED_COLORS' before initialization`. `PINNED_COLORS` now lives in `src/utils.js` (a leaf module with no edge back into this cycle), removing the `recurring.js → spending.js` edge entirely. See the "Module import constraints" section in `CLAUDE.md` for the same hazard class.

## [6.44.0] — 2026-10-27

### Added
- **Export charts as PNG** (issue #271) — a new "Export Charts as PNG" button in the Backup & Restore modal's Export tab (`exportChartsAsPng()` in `src/dataExport.js`) exports every currently-visible Chart.js `<canvas>` as a sequentially-downloaded PNG (`<canvas-id-kebab-cased>-<date>.png`), using `canvas.toDataURL('image/png')` directly — no Chart.js instance tracking needed, and no new dependency (sequential downloads, not a ZIP). This is a deliberately different UX from the per-chart overlay-button version shipped and rolled back same-day in June 2026 for cluttering the chart views (see `ROADMAP.md`): the only new UI lives inside the already-existing modal, so no chart page gains any new markup. The button is disabled with an explanatory tooltip when no chart is currently visible (e.g. a page with no charts, or a chart hidden behind an empty-state).

## [6.43.0] — 2026-10-27

### Added
- **Recurring: pause with auto-resume date** (issue #299) — pausing a recurring template now opens a modal (`openRecurringPauseModal()` in `src/recurring.js`) with an optional "Resume on" date picker instead of pausing immediately; leaving it blank pauses indefinitely as before. The date is stored as `pauseUntil` (ISO date string or `null`) via `sanitizeRecurringTemplate()`. A new `isEffectivelyPaused(template, now)` helper treats a paused template as active again, with no manual unpause needed, once the current date reaches `pauseUntil` — applied everywhere `paused` previously gated behavior (`getRecurringOccurrencesInMonth`, `isOverdue`, the "Upcoming this month" panel, and the Recurring page card's badge/buttons/styling), so a template auto-resumes consistently across the Recurring page, Ledger, and Forecast. The Recurring page shows "⏸ Paused until Oct 31" on paused templates that have a resume date set. Manually resuming (the existing "▶ Resume" action) still clears `pauseUntil`. Wired to the optional Postgres backend via a new `pause_until` column (migration `1755600000024`) and the `/api/recurring-templates` route; the server-side calendar feed generator (`server/src/calendarGenerator.js`, which duplicates the occurrence engine since it can't import DOM-dependent frontend modules) mirrors the same auto-resume check.

## [6.42.0] — 2026-10-27

### Added
- **Savings: savings rate summary panel** (issue #303) — a new summary panel at the top of the Savings page (above the Emergency Fund/Sinking Funds/Home Purchase sub-tabs, so it's visible regardless of which sub-tab is active) shows what percentage of this month's net income is going to active savings contributions: `(emergency fund monthly contributions + sinking fund monthly allocations) ÷ computeMonthlyIncomeForMonth`. A new `computeTotalSavingsContribution(app)` helper in `src/utils.js` extracts the exact contribution-sum formula the Health page's existing Savings Rate card already used, so the two cannot drift apart on what counts as "saving"; `savingsStatus()` (`src/health.js`) is now exported and reused for the same green ≥20% / yellow 10–19% / red <10% thresholds and badge styling (`.health-status--*`/`.health-badge`). The panel shows both the rate (e.g. "18.0%") and the raw amounts ("Saving $900.00 of $5,000.00/mo income").

## [6.41.0] — 2026-10-26

### Added
- **Accounts: transfer tracking between accounts** (issue #248) — a new `transfer` record type (`app.transfers`: `fromAccountId`, `toAccountId`, `amount`, `date`, `memo`), reachable via a "⇄ Transfer" action on each Accounts page card or the Ledger toolbar's "⇄ Transfer" button. `sanitizeTransfer()` (`src/sanitizers.js`) rejects records with a missing/equal from/to account or a non-positive amount; a transfer referencing a since-deleted account is dropped on import with a warning. Two opposite-signed legs per transfer are generated in `buildProjectedAccountTransactions` (`src/ledgerTransactions.js`), the exact same `addTx()` mechanism every other transaction source (bills, income, the existing recurring-template transfer type) already uses — `computeAccountBalance()`, Reports, Forecast, and Net Worth needed **no changes** to handle transfers correctly, since they already just sum whatever that one generator produces per account; a transfer nets to zero across the two accounts by construction, not by special-casing. The Ledger shows both legs with a distinct `⇄` indicator (`src/ledger.js`), excludes them from `ledgerAmountOverrides` (overriding one leg independently would break the zero-sum guarantee) while still allowing each leg to be marked cleared independently, and offers inline Edit/Delete actions that act on the whole record. New `src/transfers.js` module (lazy-loaded per the issue #278 code-splitting pattern) owns the CRUD + modal UI. Wired through local/session storage, export/import (including FK remap through the same `accountIdMap` `balanceHistory` already uses, in both replace and merge-by-name import modes), and the optional Postgres backend via a new `transfers` table/`/api/transfers` CRUD route following the `retirementSnapshots`/`planHistory` recipe. See `docs/superpowers/specs/2026-10-26-account-transfer-tracking-design.md`. A follow-up, **issue #399**, will extend the same `⇄` indicator to the existing recurring-template transfer type's ledger rows (currently plain `type: 'recurring'` rows), split out since it touches already-shipped behavior.

## [6.40.0] — 2026-10-26

### Added
- **Reconciliation: partial/in-progress state** (issue #343) — closing the Reconcile modal (via Cancel, the × button, the Escape key, or a backdrop click) with unsaved edits now offers "Save Progress" / "Discard" / "Keep Editing" instead of silently losing the review, via a new `showReconSaveProgressModal()` in `src/ui.js`. "Keep Editing" (and Escape inside that prompt) leaves the Reconcile modal open and untouched — unlike the destructive-by-default `showDeleteConfirmModal`, Escape here is deliberately non-destructive. Closing with no changes at all (the common case) still closes immediately with no prompt. Saved progress is stored per account under a standalone `debtTrackerReconInProgress` `localStorage` key — written directly, not through the storage adapter or the main `debtTrackerData` payload, since it's transient per-device UI state that must not round-trip through export/import/Postgres sync — and includes the statement balance, start/end dates, note, and which expected transactions the user had checked off as reviewed during that session (keyed by the same `type|sourceId|accountId|date` format as `app.ledgerClearedTransactions`, via a new per-row checkbox column that only renders in the modal's expected-transactions table, not the Reconcile page's inline cards). Reopening the modal for an account with saved progress restores all of the above and shows a "Resumed in-progress reconciliation" banner; completing the reconciliation, or choosing Discard, clears that account's saved state. `clearAllData` now also removes the `debtTrackerReconInProgress` key outright.

## [6.39.0] — 2026-10-26

### Added
- **Retirement: multi-scenario projections** (issue #264) — the Retirement page's projection panel and a new "Projected Growth" chart now show conservative/moderate/aggressive bands instead of a single projected value. Moderate stays exactly each account's own `rateOfReturn` (unchanged behavior); conservative/aggressive are derived by applying a user-configurable delta (default −2 / +3 percentage points, giving the suggested 5%/7%/10% band for a typical 7% account) to that per-account rate, clamped to 0–100%, rather than three flat global rates — preserving each account's own assumption instead of overwriting it. Pension accounts (contribution-based, not rate-driven) show the same value in all three scenarios. New pure functions `computeScenarioRates`/`computeRetirementProjectionScenarios`/`computeRetirementProjectionSeries` in `src/retirementCalculator.js`; `computeRetirementProjection()` itself is unchanged. The withdrawal-rate ("monthly income in retirement") panel now shows three estimates, one per scenario, alongside the existing combined-total figure. See `docs/superpowers/specs/2026-10-25-retirement-multi-scenario-projections-design.md`.

## [6.38.0] — 2026-10-25

### Changed
- **Performance: dynamic `import()` code-splitting for non-critical modules** (issue #278) — `src/app.js` previously imported every feature module statically, so the whole module graph was fetched and evaluated before `DOMContentLoaded` fired, even for sessions that never visit the Retirement or Reconciliation pages or several Reports sub-tabs. A new `src/lazyModules.js` wraps native ES module dynamic `import()` with a per-module cache (fetched at most once; a failed load isn't cached, so a later retry re-fetches instead of being stuck): `retirement.js`/`retirementCalculator.js`, `reconciliation.js`, `strategyCalendar.js` (the Plan page's Calendar sub-tab), and the five Reports sub-tab modules (`reportsCalendar.js`, `reportsMoneyFlowSankey.js`, `reportsCashFlow.js`, `reportsVariance.js`, `reportsSummary.js`) now load on first navigation to their page/tab rather than at startup. A failed `import()` (e.g. a network error) shows an in-page error message instead of crashing or leaving a blank section. `reportsNetWorth.js` was deliberately kept static despite being a plausible-looking candidate — it's also used as a cross-page Accounts widget and from the app's startup auto-snapshot logic, not just the Reports page. No build step, bundler, or `index.html` script tag was introduced or changed; three `<link rel="modulepreload">` hints for now-lazy files were removed, since preloading them would have defeated the point. See `docs/superpowers/specs/2026-10-25-dynamic-import-code-splitting-design.md`.

## [6.37.0] — 2026-10-25

### Added
- **Income: gross vs. net modeling** (issue #251) — income sources gain an optional "Tax Withholding (%)" field (0–99.9%, default 0, backward compatible), sanitized via `sanitizeIncome()` and round-tripping through export/import. `computeMonthlyIncomeForMonth()` (`src/utils.js`) now applies withholding to return net (take-home) income, which flows through every one of its cash-flow call sites (Health's DTI/savings/cash-flow card, the Cash Flow summary, the Debt-to-Income chart, Home Purchase mortgage affordability, the Net Worth projection, and the Plan page's suggested-payment/income widgets) — all of which are more accurate against real take-home pay than gross. The Ledger's generated income transactions (and everything that derives from them: Account projections, Forecast, and the Cash Flow/Money Flow/Variance/Summary reports) likewise post the net amount. Income cards now show net as the primary amount with gross shown via tooltip/secondary text when withholding is set; the inline edit form and Add Income form still edit the raw gross amount. The Health page's DTI card now notes whether its income figure is gross or net. Wired to the optional Postgres backend via a new `withholding_percent` column (migration `1755600000022`) and the `/api/incomes` route.

## [6.36.0] — 2026-10-25

### Added
- **Home purchase planning** (issue #249) — a new "Home Purchase" sub-tab under Savings (alongside Emergency Fund and Sinking Funds) surfaces a down-payment goal tracker, a mortgage affordability calculator (Front-End/Back-End DTI, reusing the exact `mortgageFrontEndStatus`/`mortgageBackEndStatus` thresholds and `computeMonthlyIncomeForMonth` income derivation the Health page's mortgage DTI card already uses), a PMI threshold tracker (estimated monthly PMI cost while below 20% down, at a fixed ~1%/year assumed rate), and a "Debts to Clear Before Qualifying" panel that lists active debts smallest-balance-first (snowball order) and stops at the first point paying them off would bring the back-end ratio under the conventional 43% threshold. Logic lives in the new `src/homePurchase.js` module (`app.homePurchasePlan`, a single nullable plan object — not a record collection), sanitized on load/import via `sanitizeHomePurchasePlan()`, registered in the command palette, and wired into local/session storage save/load/export/import. Not yet wired to the optional Postgres backend (local/session storage only for this release).

## [6.35.0] — 2026-10-25

### Added
- **Plan: visual payoff Gantt chart** (issue #314) — the Plan page's Chart View tab adds a "Debt Elimination Timeline" horizontal-bar chart, with one bar per debt spanning from the plan's start to its own payoff month. Bars are sorted soonest-payoff-first so the chart visually cascades, colored with the same shared per-debt palette (`PLAN_CHART_PALETTE`) now used by the existing balance-over-time chart too, and their tooltip shows the payoff month plus total interest paid for that debt. Driven entirely by `app.lastPaymentPlan` — no new calculation — since every debt in the plan starts receiving payments in month 1, so each bar is a plain 0-to-payoff span with no floating-bar offset needed. Includes the standard `renderChartDataTable()` screen-reader fallback.

## [6.34.0] — 2026-10-25

### Added
- **Accounts: balance breakdown drill-down** (issue #257) — each account card's projected balance figure gains a "See breakdown" button that opens a read-only modal listing every transaction (income, debt payment, bill, expense, recurring item) that was summed to produce it, with a running balance shown after each row so the final total is traceable back to the account's starting balance. The list is the exact same `getLedgerTransactionsForMonth()` array `computeAccountBalance()` already sums, so the breakdown's final running balance always reconciles with the card's displayed figure by construction — no separate calculation to keep in sync. A "View in Ledger →" link pre-filters the Ledger page to this account (date range left at "All" since Ledger has no exact-calendar-month filter) and closes the modal. Follows the same accessible modal pattern (focus trap, Escape, backdrop click, `aria-labelledby`) established by the Spending report's category drill-down (#315).

## [6.33.0] — 2026-10-23

### Added
- **Health: per-card credit utilization breakdown** (issue #281) — the Credit Utilization card's "Show per-card breakdown" toggle lists every credit-card debt individually (balance, limit, percentage, color-coded status bar), not just the aggregate figure. Cards with no credit limit set show a "No limit set" label instead of disappearing — this now surfaces even when *no* card has a limit, a case that previously made the whole card fall back to its generic empty state. Reuses the existing `creditUtilizationStatus`/`statusFillCls` thresholds for consistency with the aggregate number.
- **Reports: Spending category → Ledger cross-navigation** (issue #315) — the Spending report's category drill-down modal gains a "View in Ledger →" link that jumps to the Ledger pre-filtered to that category, with a "Viewing: `<category>` · `<month>` — ← Back to Spending" breadcrumb that returns to the Spending tab. This required adding a real Category filter to the Ledger first — `getFilteredSortedLedgerTransactions` had no category filtering at all despite the issue's assumption that one already existed — now persisted alongside the existing Account/Date/Cleared filters. The category/pie-slice click itself still opens the existing drill-down modal unchanged (removing that to cross-navigate instead would have been a regression); the new link is additive, following the same "View in Ledger →" pattern issue #257 established for account balances.
- **Settings modal tabbed layout** (issue #322) — `#settingsModal` is reorganized into four tabs (Appearance, Data & Storage, Notifications, Advanced) using the same tab pattern already shipped for the Data Transfer modal's Export/Import tabs, under its own `settings-tab-*` class namespace. The active tab is remembered across open/close within the same page load, and opening the modal now focuses the first control of the active tab rather than a hardcoded checkbox that could end up hidden on a different tab.

## [6.32.1] — 2026-10-23

### Fixed
- **What's New notification content was stale since v6.24.0** — the `WHATS_NEW_ENTRIES` constant in `src/ui.js` carries an explicit "update this every version bump alongside CHANGELOG.md" comment, but no version from 6.25.0 through 6.32.0 actually added an entry. The notification mechanism (dot on upgrade, modal on click) kept working, but anyone upgrading past 6.24.0 only ever saw the 6.23.0/6.24.0 highlights. Backfilled entries for 6.25.0–6.32.0 from `CHANGELOG.md`, and added `test_whats_new_entries_not_stale` (`tests/features/test_whats_new.py`) asserting the newest entry stays within 3 minor versions of the running app version, so this can't silently regress again.

## [6.32.0] — 2026-10-23

### Added
- **Health: multi-model DTI view** (issue #253) — the Debt-to-Income card now shows Mortgage Front-End (housing cost ÷ income, green <28%/yellow <36%/red ≥36%) and Back-End (all debt minimums with housing cost swapped in ÷ income, green <43%/yellow <50%/red ≥50%) ratios alongside the existing Consumer DTI, in the same card. An editable "Est. monthly housing cost" field defaults to the sum of debts whose category matches the existing `/rent|mortgage|housing/i` pattern and persists via `getSetting`/`setSetting` (`HOUSING_COST_OVERRIDE`); with no housing debts and no override, Front-End is 0% and Back-End equals Consumer DTI exactly.
- **Health: customizable budget category thresholds** (issue #250) — a gear button on the Budget Allocation card opens a modal to set per-category healthy/warning % thresholds, replacing the previously hardcoded 28%/36% (housing) and 10%/15% (everything else) for categories a user wants to treat differently. `budgetCategoryStatusCls()` reads persisted thresholds and falls back to those same defaults when none are set; "Reset to Defaults" restores them. Thresholds are stored as two flat `getSetting`/`setSetting` entries per category (`bct:<category>:healthy`/`:warn`) rather than one JSON-blob setting, since `sanitizeSetting()` only accepts boolean/number/string values and would silently drop an object-valued entry on every load/import — the flat-key approach round-trips through export/import and the Postgres backend with zero sanitizer changes.

## [6.31.0] — 2026-10-22

### Added
- **Reports: year-over-year spending comparison** (issue #332) — the Spending Analysis report adds a "Compare:" toggle ("vs. last month" / "vs. same month last year") in the summary strip. In YoY mode, each category badge and the total badge recompute against the same calendar month one year prior instead of the prior calendar month; a category with no spending that far back shows no badge at all rather than a misleading 0%/divide-by-zero result. Default stays "vs. last month" — existing behavior is unchanged unless the toggle is switched.
- **Income Trend chart** (issue #262) — the Income page adds a stacked bar chart (Regular Income vs. Bonuses) over a trailing 12- or 24-month range (toggle), with an optional dashed overlay comparing each month to the same calendar month one year prior ("Compare to same month last year" checkbox). Hidden entirely when there's no income or bonus data at all. Follows the existing `renderChartDataTable` accessibility convention.
- **Net worth trajectory projection** (issue #335) — the Net Worth report's trend chart now extends forward 1/3/5 years (selectable) as a dashed continuation of the Net Worth line, with year-end values called out as milestone cards below the chart. `computeNetWorthProjection()` (`src/reportsNetWorth.js`) grows assets by (monthly income − non-debt expenses − cash actually paid to debt that month) and sources liabilities from `app.lastPaymentPlan`'s real per-debt balance schedule when one exists — avoiding double-counting principal, which is a dollar-for-dollar transfer from assets to a reduced liability, not a net-worth change by itself. Falls back to the issue's simplified flat model (net worth grows by a constant monthly income-minus-expenses delta, no debt-payoff compounding) once a plan ends or when none exists.

## [6.30.0] — 2026-10-22

### Added
- **Retirement: monthly income in retirement** (issue #345) — the Retirement page's projection panel now shows a "Monthly income in retirement" estimate derived from the combined projected balance using a configurable safe withdrawal rate (slider, 2%–8%, default 4%). `computeMonthlyWithdrawal(projectedBalance, withdrawalRatePct)` (`src/retirementCalculator.js`) is a pure arithmetic derivation of the existing projection — no new compounding logic. The rate updates the displayed estimate live as the slider moves and persists via `getSetting`/`setSetting` under `retirementWithdrawalRate` once released. A help icon explains the 4% rule for screen reader users.

### Notes
- Issue #346 (Coast FIRE calculation) was investigated but deferred — the suggested "infer target from the projection" approach is mathematically degenerate (growth-only compounding of today's balance can never catch up to a target that already assumes continued contributions over the same window), so it would almost always report "contributions required through retirement" regardless of actual progress. Needs a genuinely independent target-balance input before it can be implemented meaningfully; see the comment on #346.

## [6.29.0] — 2026-10-22

### Added
- **JSON import error surface** (issue #291) — importing a backup JSON file now reports what happened to every record, not just a generic success/failure toast. `sanitizeParsedState()` (`src/sanitizers.js`) optionally collects a `warnings` array alongside its normal sanitized output: one entry per field that was coerced to a default (record type, name, field, original value, new value) and one per record dropped entirely (missing/invalid required fields, or — for balance history — an orphaned reference to a debt/account that didn't survive the import). This covers every importable collection, including the ledger override/cleared-flag maps and the plan-history import cap. Soft warnings render as a collapsible "Import succeeded — N issues found (expand to see)" list inside the Backup & Restore modal's result banner (built with `createElement`/`textContent`, no `innerHTML` of untrusted content). A hard failure — the file isn't valid JSON at all — keeps the established inline (not popup-modal) error banner, but now includes the native parse error (which already includes a position and often a line/column) instead of only the old generic message; the existing "file too large" and "no data found" messaging is unchanged.
- **Focus-trap + restore on the Spending drill-down modal** (issue #310, N2 from the Oct 2026 a11y audit) — confirmed already implemented and extended test coverage for the three other flagged modals (Ledger Export, Ledger Mark-All-Cleared, Reports Calendar day detail): all four now have Playwright tests asserting that closing the modal restores focus to the control that opened it, in addition to the existing Tab-cycling/Escape coverage.

## [6.28.0] — 2026-10-22

### Added
- **Health "Top recommendations" panel** (issue #254) — the Health page now renders a panel below the metric cards surfacing up to 3 ranked recommendations (red status beats yellow/orange, then insertion priority) drawn from the existing DTI, savings rate, emergency fund, debt payoff timeline, cash flow, and credit utilization status functions — no new calculation logic. Each recommendation names the flagged metric, its current value, a one-sentence explanation (e.g. naming the highest-APR debt for a high DTI), and a navigable action link reusing the dashboard's existing in-app navigation. Shows an "All metrics healthy" message when every metric is green; hidden entirely on a brand-new empty dashboard.
- **Liabilities "Group by" (Person / Institution)** (issue #288) — a new Group by control on the Debts filter bar groups the debt list under person-name headers (a debt shared across multiple people appears under each) or institution headers (derived heuristically from the text before the first separator in the debt name, e.g. "Chase - Freedom" and "Chase - Sapphire" both group under "Chase"). Each group header shows a count, total balance, and total minimum payment. Sorting continues to apply within each group. The selection is a live UI control and does not persist across reload.

## [6.27.0] — 2026-10-22

### Added
- **Debt payoff celebration flow** (issue #294) — the "Archive" button shown on a paid-off debt card is replaced with a "🎉 Debt Paid Off!" button that opens a celebration modal (mirroring the #308 sinking-fund completion flow), congratulating the user and offering Archive Debt / Keep Active. Archiving from the modal goes through the existing archive-confirm step unchanged.
- **Upcoming-due urgency badge on recurring cards** (issue #382) — recurring template cards now show a small badge when the next occurrence this month is due soon: red for due in under 3 days (or today), yellow for under 7 days. Suppressed when paused, archived, skipped, already paid this month, or already shown as Overdue.
- **Health page stale-plan nudge** (issue #383) — a subtle banner appears on the Health page when the user has data but hasn't edited any debt or income record in 30+ days, nudging them to review their numbers. Income records now also track an `updatedAt` timestamp (mirroring the existing field on debts) to support this.

## [6.26.0] — 2026-10-20

### Added
- **A11Y-01 — Focus-trap on 3 modals** (issue #310) — keyboard Tab cycling is now fully trapped inside the Ledger Export CSV modal, Ledger Mark All Cleared modal, and the Reports Calendar day-detail modal. Each modal restores focus to the previously focused element on close.
- **SV-01 — Sinking fund priority ordering** (issue #304) — sinking funds now have a numeric `order` field (1–99, 0 = unset). The savings page renders funds sorted by `order` ascending, with unordered funds last. An "Order" input appears on the add form and inline edit; an order tag is shown on each card when set.
- **SV-02 — Sinking fund completion flow** (issue #308) — a "Complete this goal" button appears on fully funded sinking fund cards, opening a modal with Archive / Delete / Keep Active options. Archived funds gain a `completedDate` and are hidden by default behind an "archived" toggle. An empty state CTA appears when no active sinking funds exist.
- **ES-01 — Empty state CTAs across pages** (issue #276) — all major list pages now show a richly styled empty state with icon, heading, body, and a CTA button when no items exist: Debts (→ open add form), Accounts (→ scroll to form), Income (→ scroll to form), Health (→ navigate to Accounts), Ledger (contextual — distinguishes no accounts vs. no linked data vs. filtered). The Accounts and Debts pages also show a "no match" state when filters yield zero results.
- **RC-02 — Recurring actual-amount override** (issue #293) — clicking "Mark as paid" on a recurring template now opens a compact modal pre-filled with the budgeted amount; the user can edit to enter the actual amount paid this month. The actual amount is stored in a new `paidAmounts` map (`{ [YYYY-MM]: number }`) on the template record and shown on the paid badge when it differs from the budgeted amount.
- **LD-01 — Ledger cross-navigation** (issue #285) — debt payment, income, and recurring rows in the Ledger now each show a small `↗` button. Clicking it switches to the matching page (Liabilities / Income / Recurring) and scrolls to + briefly highlights the corresponding card.
- **LD-02 — Minimum payment trap warning** (issue #259) — each revolving debt card now computes the payoff timeline at only the minimum payment. When the result exceeds 36 months, a yellow "Min. payment trap" warning badge is shown with the years-to-payoff and estimated total interest cost, nudging users to pay more than the minimum.
- **LD-03 — Bulk debt actions** (issue #282) — each non-editing debt card now has a multi-select checkbox. Selecting one or more cards reveals a bulk action bar with Archive, Export CSV, and Delete buttons; archive and delete prompt for confirmation first. Export writes a CSV with Name, Type, Balance, Rate, MinPayment, DueDate, and Category columns.

## [6.25.0] — 2026-10-19

### Added
- **CP-01 — Bonus Advisor command palette + Health CTA** (issue #267) — the command palette now indexes a `keywords` field per command; a new "Open Bonus Advisor" command includes keywords `bonus windfall lump sum one-time payment` so searching any of those terms finds it. The Health page surplus section shows a "Got a bonus or windfall? Use the Bonus Advisor →" link when surplus > 0; clicking it navigates to the Income page and opens the Bonus Advisor modal.
- **LI-01 — Liabilities next payment due date** (issue #277) — a "Next Payment Due" date field is added to the Add Debt form, the inline edit form, and the sanitizer (`sanitizeDebt`). When set, the date is displayed on the debt card below Due Date. Both the client-side calendar feed (`src/calendarFeed.js`) and server-side calendar generator (`server/src/calendarGenerator.js`) use this date as an event override for the matching calendar month, falling back to the day-of-month `dueDate` otherwise.
- **RC-01 — Category datalist for Recurring & Expenses** (issue #298) — the `#recurringCategory` and `#expenseCategory` fields are converted from `<select>` dropdowns to `<input type="text" list="categoryOptions">` autocomplete inputs, backed by a shared `<datalist id="categoryOptions">` populated with 20 default categories, keys from `PINNED_COLORS` in `spending.js`, and any categories already used in the app state. The datalist is refreshed on every render of the Recurring page and the Income/Expenses page.
- **SP-01 — Strategy plan stale warning** (issue #325) — a `_planFingerprint` (sorted `id|balance|apr|minPayment` hash of all debts) is recorded in `app` whenever a payment plan is calculated. On the Strategy page a warning banner (`#planStaleWarning`) is shown when the current debt data no longer matches the fingerprint; a Recalculate button in the banner re-runs the plan and clears the warning.
- **I18N-01 — Retirement page full i18n** (issue #336) — all visible UI strings in `src/retirement.js` are now routed through `t()` from `src/i18n.js`. Forty-plus `retirement.*` keys are added to `src/locales/en.js` (canonical) and as English stubs to `src/locales/es.js` and `src/locales/pl.js`.
- **LF-01 — Ledger filter persistence** (issue #338) — account, date-range, cleared, and page-size filter selections on the Ledger page are saved to `localStorage` under `debtTrackerLedgerFilters` (a device UI preference, not part of `debtTrackerData`). They are restored automatically on the first render of the Ledger page per session. The "Clear filters" button also removes the stored preferences.
- **CI-01 — Circular import audit for people.js** (issue #340) — `src/people.js` was confirmed to form a `ui.js → people.js → postgresSync.js → ui.js` cycle. A comment at the top of `people.js` documents the cycle and confirms it is safe because all eight module exports are hoisted `function` declarations. CLAUDE.md updated accordingly.

## [6.24.0] — 2026-10-19

### Added
- **S-01 — Emergency fund auto-sync balance** (issue #313) — emergency fund records can now auto-sync their current amount from the linked account's projected balance. A new "Auto-sync balance from linked account" checkbox on the form enables this: when checked, the current-amount field is disabled (the balance derives from `computeAccountBalance`), and the card shows a ⟳ synced indicator. The manual + Contribute button is hidden when auto-sync is active. The `autoSyncBalance` field is added to `sanitizeEmergencyFund` so it survives export/import round-trips. Also fixes pre-existing bugs: EF ids are now plain numbers (not `ef-…` strings that mutated on each reload), and accountId is parsed as an integer on form submit (fixing duplicate-check false negatives and "Unknown Account" card display within the same session).
- **U-01 — What's New in-app notification** (issue #289) — after each version upgrade, a red notification dot appears on the account menu button. Clicking "What's New" in the account dropdown opens a modal with a summary of the current and previous releases. Dismissing the panel saves the current version to `debtTrackerLastSeenVersion` in localStorage and clears the dot. New installs silently set the current version and show no notification.

## [6.23.0] — 2026-10-19

### Added
- **L-02 — Ledger bulk clear/unclear** (issue #266) — the ledger table now has a row-selection checkbox column (hidden when the Cleared column is hidden). A select-all checkbox in the header selects all overridable rows on the current page. When one or more rows are selected, a "Bulk Actions" bar appears above the table showing the selection count and two buttons: "Mark Cleared" and "Mark Unclear". Each bulk action calls `setLedgerCleared` for every selected transaction, saves, and re-renders; selection resets automatically. The existing "Mark All Cleared" modal is preserved unchanged.
- **P-01 — Per-person financial summary card** (issue #284) — the People page person cards now show a four-tile KPI summary: Total Annual Income, Total Debt, Monthly Net (income minus debt minimums), and Credit Utilization % (with a color-coded `health-badge` using the same green/yellow/orange/red thresholds as the Health page). A DTI % badge appears in the card header when income is linked. Credit Utilization shows "N/A" when no CC debts with limits exist. The existing collapsible linked-items section is preserved below the KPI tiles. Cards are responsive below 480 px (single-column stacking). All KPI tiles carry `aria-label` attributes.

## [6.22.0] — 2026-10-19

### Added
- **RT-01 — Retirement contribution limit tracker** (issue #280) — each retirement account card now shows a year-to-date contribution progress bar against the IRS annual limit for that account subtype (401k, Traditional IRA, Roth IRA, HSA). The bar is green under 80%, amber at 80–99%, and red at or over 100%, with a "Near limit" / "Over limit" badge. A per-account "Catch-up (50+)" checkbox switches to the higher IRS catch-up limit; HSA accounts also get a Self-only / Family selector. Limits are stored as a year-keyed constant in `src/retirementCalculator.js` (covering 2024–2026) with a year-fallback for future years; `getContributionLimit()` and `computeYtdContributions()` are new pure exports covered by unit tests. Pension and Other accounts have no statutory limit and show no bar.

## [6.21.0] — 2026-10-19

### Added
- **RP-01 — Spending category drill-down UX** (issue #327) — ranked list rows and pie chart segments were already wired to `_openSpendingDrilldown`; this release adds keyboard activation (Enter/Space), a visible chevron affordance, focus management (focus moves to modal on open, is trapped inside, returns to the triggering element on close), and `aria-label="Close drill-down"` on the close button.
- **LD-01 — Ledger override memo field** (issue #341) — the ledger amount override modal now includes an optional memo/notes textarea (max 500 chars). The memo is stored in `app.ledgerAmountOverrides[key].memo` alongside the override amount, sanitized via `normalizeText` in `sanitizeLedgerOverrides`, shown as a title tooltip on the override icon, and survives JSON export/import round-trips. The Postgres PATCH payload includes it automatically via the existing `{ ...entry }` spread.

## [6.20.0] — 2026-10-18

### Added
- **CI-01 — Stryker coverage for 7 additional sanitizer functions** (issue #265) — unit tests added to `tests/unit/sanitizers.test.js` for `sanitizeBonus`, `sanitizeEmergencyFund`, `sanitizeSinkingFund`, `sanitizeNetWorthSnapshot`, `sanitizeForecastSettings`, `sanitizeSetting`, and `sanitizePlanHistoryEntry`; `stryker.config.mjs` extended with line ranges `89-99`, `179-245`, and `269-283` covering those functions.
- **PR-01 — Debounce `saveToStorage()`** (issue #273) — `saveToStorage()` for local/session backends now batches rapid-fire writes with a 300 ms trailing debounce; a `flushStorageSave()` export is wired to `beforeunload` in `app.js` so no edits are lost on tab close. The Postgres backend is unaffected. `switchStorageBackend` bypasses the debounce and calls the internal write directly (required for its synchronous migration result). Unit tests added to `tests/unit/storage.test.js`.

## [6.19.0] — 2026-10-18

### Added
- **X-01 — Keyboard shortcuts help panel** (issue #283) — new "Keyboard Shortcuts" modal listing every active shortcut (Ctrl/⌘+K, Esc, palette arrow/Enter navigation, dialog Tab/Enter, Reports-calendar Enter/Space), opened from a new "Keyboard shortcuts" command-palette command or the account menu's new "Keyboard Shortcuts" item. Content is generated from the single `KEYBOARD_SHORTCUTS` constant in the new `src/keyboardShortcuts.js` (DOM built via `textContent`, CSP-safe); the panel is a focus-trapped `role="dialog"` that closes on Escape, backdrop click, or ×/Done, restoring focus to its opener.
- **RC-02 — Reconciliation statement start/end dates** (issue #275) — the Reconcile page cards and the Ledger quick-reconcile modal replace the single "Statement Date" with "Statement Start Date" / "Statement End Date". The start defaults to the day after the account's most recent reconciliation (1st of the month if none), the end to today. The expected-transactions list (now also shown in the modal) is recomputed from the explicit range as you edit it. An inverted or missing range shows an inline `role="alert"` error and disables Reconcile; `applyReconciliation` re-validates. Entries now store `statementStartDate`/`statementEndDate` (sanitized in `sanitizeReconciliation`, nullable for legacy records, inverted start dropped) and the History table shows the statement period. `applyReconciliation`'s 5th argument accepts `{ statementStartDate, statementEndDate }`; a plain date string is still accepted as the end date. Postgres: migration `1755600000021` adds nullable `statement_start_date`/`statement_end_date` columns to `reconciliations`.

### Changed
- Reconcile modal: Enter now confirms only from a form field. Pressing Enter on Cancel/× or on the new "Expected transactions" disclosure keeps its native behavior instead of submitting the reconciliation.
- `stryker.config.mjs` — added `sanitizeReconciliation` to the mutation scope and corrected the stale `sanitizeBalanceHistoryEntry` line range.

## [6.18.0] — 2026-10-07

### Added
- **ST-02 — Export payment schedule to CSV** (issue #324) — new "Export Schedule as CSV" button in the payment schedule (tabular view) exports a CSV with columns: Month, Debt Name, Payment, Principal, Interest, Remaining Balance.
- **X-06 — Auto-capture monthly net worth snapshot** (issue #292) — new "Auto-capture monthly net worth snapshot" toggle in Settings; when enabled, captures a net worth snapshot on the first app load of each calendar month if one doesn't already exist for that month.
- **NEW-02 — Health FIRE number card** (issue #316) — new card on the Health page showing FIRE Number (25 × annual expenses), estimated years to Financial Independence based on current monthly surplus and net worth, and current net worth progress; green <10 years away, yellow 10–25 years, red >25 years or no surplus; empty state when no expense data.

## [6.17.0] — 2026-10-07

### Added
- **Debt notes/memo field** (issue #287) — free-text notes field (up to 500 chars) added to the debt form and inline edit; notes are displayed on the debt card and survive export/import round-trips via `sanitizeDebt()`.
- **Plan auto-fill suggested payment** (issue #319) — "Suggest" button next to the monthly payment input on the Plan page; computes `max(0, income − bills − expenses − debt minimums)` for the current month and prefills the field.
- **Print-friendly CSS** (issue #256) — comprehensive `@media print` rules hide interactive chrome (nav, toolbar, modals, buttons, forms) and show only the active page section; cards and tables styled for print with no box-shadows.

## [6.16.0] — 2026-10-07

### Added
- **Interest Burden Rate health card** (issue #321) — new card on the Health page showing monthly interest cost as a % of income; green ≤5%, yellow >5–10%, red >10%; shows empty state when no active debts.
- **Debt-to-Asset Ratio health card** (issue #339) — new card on the Health page showing total liabilities ÷ total assets (using projected account balances); green <0.5, yellow 0.5–1.0, red ≥1.0; shows empty state when no account assets exist; i18n keys added to `src/locales/en.js`.

## [6.15.1] — 2026-10-07

### Fixed
- **Calendar feed modal Escape key** — `initCalendarFeedModal` switched from `modal.onkeydown` to `document.addEventListener('keydown', ...)` so the Escape key closes the modal regardless of focus location (fixes `test_modal_closes_on_escape`).
- **People tests `#debtList` selector** — `tests/features/test_people.py` corrected all 5 `#debtList` references to `#debtsList` (the actual element ID in `index.html`); `test_people.py` and `test_calendar_feed.py` re-added to CI shards E and I respectively.

## [6.15.0] — 2026-10-07

### Added
- **CI-01 — 9 unsharded test files assigned to CI shard jobs** — `test_filter_sort.py`, `test_account_menu.py`, `test_balance_history.py`, `test_people.py`, `test_recurring_archive.py`, `test_recurring_r01_r02.py`, `test_analytics.py`, and `test_retirement.py` are now distributed across shards A–E; `test_performance.py` and `test_calendar_feed.py` go into a new shard-I (closes #297).
- **A11Y N1 — `renderChartDataTable` added to 4 charts missing sr-table fallbacks** — `rptIncomeChart`, `rptOutflowChart`, `rptMoneyFlowChart` (in `reportsCashFlow.js`), and `rptNetWorthCompositionChart` (in `reportsNetWorth.js`) now each have a paired `.sr-only` data table for screen reader users (closes #302).
- **A11Y N2 — CI gate test for chart sr-tables** — `tests/ui/test_chart_accessibility.py` extended with 3 new tests covering all 4 newly-fixed canvases; the block comment documents intent as a CI gate so new charts can't ship without sr-tables (closes #333).
- **A11Y N3 — `role=tabpanel` on 8 Reports tab panels** — all 8 `rpt-tab-panel` divs now carry `role="tabpanel"` + `aria-labelledby`; matching `id` attributes added to all 8 tab buttons (closes #323).
- **A11Y N4 — Strategy Schedule inner sub-tabs ARIA wiring** — `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, and `id` added to the Tabular/Calendar/Chart sub-tab buttons; `role="tabpanel"` + `aria-labelledby` added to the three content panels; `switchTab()` in `ui.js` now toggles `aria-selected` alongside the `.active` class (closes #328).

## [6.14.0] — 2026-10-07

### Added
- **R-01 — "Upcoming this month" summary panel on Recurring page** — a new panel above the recurring template list shows four stats for the current month: occurrences count, total amount, paid count, and overdue count (overdue only shown when > 0). Paused and archived templates are excluded. The panel has `aria-live="polite"` for screen reader support (closes #305).
- **R-02 — Overdue indicator on recurring cards** — monthly templates with a `dayOfMonth` that have passed for the current month without being marked paid or skipped show a red "Overdue" badge on their card and a red left border. Paused, archived, and non-monthly templates are never marked overdue (closes #309).

### Changed
- **CSS** — added `.recurring-overdue-badge` (red badge), `.recurring-card--overdue` (red left border), `.recurring-upcoming-panel` and child classes; all with dark-mode variants.

## [6.13.0] — 2026-10-07

### Fixed
- **I18N-01 — People nav + 3 Settings strings missing translations** — added `data-i18n="nav.people"` to the People nav button and `data-i18n` attributes to the "Show archived debts", "Show archived recurring templates", and "Send test email" Settings elements; added corresponding `nav.people`, `settings.showArchivedDebts`, `settings.showArchivedRecurring`, `settings.sendTestEmail` keys to `en.js`, `es.js`, and `pl.js` (closes #306).
- **I18N-02 — Surplus sparkline `renderChartDataTable` caption hardcoded English** — replaced the hardcoded `"Projected balance over ${windowDays} days"` string with `t('health.surplusSparklineCaption', { days: windowDays })`; added the key to all three locale files (closes #311).

## [6.12.0] — 2026-10-07

### Added
- **D-03 — Break-even shortcut button on debt cards** — interest-bearing debts with a positive balance now show a "Break-even" button in their action row. Clicking it reveals the break-even section (reusing the existing `[data-be-show]` mechanism) and scrolls it into view. Fixed-amount debts and 0% APR debts do not show the button (closes #360).
- **L-01 — Override indicator (pencil icon) in Ledger amount cell** — rows with an active override now display a `✎` pencil icon (`ledger-override-icon`) inline next to the effective amount. The icon's `title` shows the original pre-override amount as a tooltip, and clicking the icon opens the existing override modal (reuses the `[data-ledger-override]` click delegation already wired in `ledger.js`) (closes #361).

### Changed
- **CSS** — added `.debt-breakeven-btn` (small margin); `.ledger-override-icon` (primary-color, hover/focus outline, dark-mode variant).

## [6.11.0] — 2026-10-07

### Added
- **I-02 — Variable / estimated income flag** — income sources now have a "Variable / hourly amount" checkbox. Checking it marks the income as `isVariable: true` and shows a `~ Est.` amber badge on the income card to signal the amount may differ paycheck to paycheck. Field is sanitized (`sanitizeIncome`), persists through export/import, and is wired to Postgres via migration `020_add-is-variable-to-incomes` and `is_variable` column on `/api/incomes` (closes #356).
- **L-03 — Quick "Enter actual" for variable-income Ledger rows** — payday rows for variable income sources show an "Enter actual" primary button instead of the normal greyed-out Override link, and a `~ Est.` badge in the amount cell, to surface the task directly on the Ledger. Clicking it opens the existing override modal. Once an override is saved the badge disappears and the button changes to "Edit actual". No new modal UI — reuses `openLedgerOverrideModal` (closes #357).

### Changed
- **CSS** — added `.income-variable-badge` (amber); `.income-variable-group` / `.income-variable-label` checkbox wrapper; `.ledger-est-badge` (amber inline badge); `.ledger-enter-actual-btn` (primary-colour override button).

## [6.10.9] — 2026-10-07

### Added
- **H-01 — Trend arrows on Health dashboard** — DTI, Savings Rate, and Cash Flow cards now show a ▲/▼ trend arrow (green = improving, red = worsening) comparing the current month to the previous month's income-derived metrics. Arrows appear only when both months have data and the delta exceeds a 0.05% noise threshold. Tooltip shows the prior-month value (closes #270).
- **H-02 — Clickable Health metric cards** — every metric card on the Health dashboard now navigates to its related page (Liabilities, Savings, Strategy, Income, Accounts) when clicked. Cards gain a pointer cursor and accent-color hover border. Clicks on interactive elements inside the card (links, buttons, selects) continue to work as before (closes #271).
- **A-01 — Account archive/unarchive** — accounts can now be archived rather than deleted. Archived accounts are hidden by default; an "Show N archived" toggle appears at the bottom of the Accounts list when any exist. Archived accounts still participate in all calculations and storage round-trips. Fully wired for Postgres via new migration `018_add-archived-to-accounts` and the `archived` column on the `/api/accounts` CRUD resource (closes #274 partial — archive feature; A-02 was already implemented).
- **I-01 — Income categories** — income sources now have a Category field (Salary / Freelance / Rental / Investment / Other, defaulting to Salary). Category is shown as a badge on the income card and in the edit form. Stored in `sanitizeIncome` and wired to Postgres via migration `019_add-category-to-incomes` and `category` column on `/api/incomes` (closes #278).

### Changed
- **CSS** — added `.health-trend` / `.health-trend--good` / `.health-trend--bad` for trend arrows; `.health-metric-card[data-card-nav]` hover style; `.acct-card--archived` opacity; `.acct-archived-badge`; `.income-category-badge`; `.acct-archived-toggle`.

## [6.10.8] — 2026-10-06

### Security
- **Rate-limit `POST /auth/reset-password`** — the reset-password endpoint was missing the same `rateLimit` middleware already applied to `/auth/forgot-password` (5 req / 15 min window). Added `resetPasswordLimiter` (closes #301).

### Changed
- **Document `t()` vars contract** — added an explicit code comment on `src/i18n.js`'s `t()` function clarifying that `vars` values are not HTML-escaped and must never receive raw user input (closes #342).

### Tests
- `server/test/auth.test.js` — new: 6th `POST /auth/reset-password` attempt within 15 min returns 429.
- `tests/postgres/test_password_reset.py` — new: integration test confirming rate-limiter returns 429 on the live stack.

## [6.10.7] — 2026-10-06

### Fixed
- **Liabilities filter dropdowns still clipped** — the filter-pair stacked layout was only activating at ≤640px, but `.debts-layout` switches to single-column at ≤900px. In the 641–900px range the twelve flat flex items (6 labels + 6 selects via `display: contents`) had a minimum combined width of ~660px which overflowed the column and was hard-clipped by `overflow-x: clip`. Fix: raise the filter breakpoint to ≤900px to match the grid, add `max-width: 100%` + `overflow: hidden` on `.filter-pair`, and set `width: 0` (basis) on the select so flex grow fills the row without asserting an intrinsic minimum.

## [6.10.6] — 2026-10-06

### Fixed
- **Debt card action buttons clipped on mobile** — `.debt-actions` now uses `flex-wrap: wrap; gap: 6px` at ≤768px so the five buttons (Edit, Update Balance, History, Archive, Delete) wrap into two rows instead of overflowing the card's right edge.

## [6.10.5] — 2026-10-06

### Fixed
- **Liabilities filter dropdowns clipped on mobile** — replaced the flat label/select CSS-grid approach with explicit `<div class="filter-pair">` wrappers; each pair is a self-contained `display: flex` row on mobile (`display: contents` on desktop so children flow into the parent flex as before). `.debts-list-header` now uses `display: block` at ≤640px so the filter always occupies its own full-width row rather than sharing a flex line with the "Your Debts" heading.

## [6.10.4] — 2026-10-06

### Fixed
- **PWA horizontal scroll** — `.container` in `display-mode: standalone` had `overflow: visible`, which let child overflow propagate past all page-section clips to the document level; changed to `overflow-x: clip` to contain it.
- **Dark-mode native select arrows invisible** — added `color-scheme: dark` to `body.dark-mode` so browsers render native form control indicators (select chevrons, scrollbars, checkboxes) in light colors that are visible against dark backgrounds.

## [6.10.3] — 2026-10-06

### Fixed
- **Page-level horizontal overflow (restored)** — `overflow-x: clip` was re-added to `.page-section.active` after the Columns floating popover (which had been clipped by it) was replaced with a native `<select multiple>`; all pages including Liabilities now correctly contain horizontal overflow without breaking sticky filter bars.

## [6.10.2] — 2026-10-06

### Changed
- **Ledger column selector** — replaced the floating popover with a `<select multiple>` list box; all six columns are always visible and individually togglable without opening a separate panel, eliminating positioning/overflow issues on mobile.

### Fixed
- **Liabilities filter horizontal overflow** — at ≤640px the debt filter toolbar now uses a 2-column label/select grid (`auto 1fr`) instead of a flat flex row, so it can never be wider than the viewport.

## [6.10.1] — 2026-10-06

### Fixed
- **Ledger "Columns" popover layout** — the column-visibility popover now renders as an absolutely-positioned overlay instead of a block element that pushed filter controls onto a new line on mobile.
- **Mobile page gutters** — Ledger, Recurring Templates, and Savings pages use an outer-card container that compounded with `main`'s mobile padding; side padding now reduces at ≤480px so all pages have equivalent usable content width on narrow screens.
- **Section heading size** — `section h2` reduced from `1.5rem` to `1.4rem` to match the Ledger/Recurring/Savings overrides that already used `1.4rem`; all page headings now use a consistent size.
- **Liabilities debt filter selects** — `.category-filter` dropdowns now have the same border, padding, background, and dark-mode treatment as `.select-styled` filters used on other pages.

## [6.10.0] — 2026-10-05

### Added
- **Bonus/deposit year filter** — the "One-time Bonuses & Deposits" list on the Income page now defaults to showing the current year with prev/next year navigation and an "All time" toggle, preventing old entries from dominating the view.
- **Ledger column visibility** — a "Columns ▾" button in the Ledger filter bar opens an inline checklist to show/hide any of the six columns (Date, Account, Transaction, Amount, Running Balance, Cleared); preference persists per device in `localStorage`.

### Fixed
- **People page dark-mode link contrast** — income/debt navigation links inside person cards were near-invisible in dark mode (medium blue on dark navy); corrected to a lighter `#60a5fa` with high-contrast mode also covered.
- **Reports tab bar mobile layout** — replaced the horizontal scroll strip with a compact wrapping pill grid at ≤640px; all report tabs are now visible without scrolling.
- **Retirement page horizontal overflow** — retirement account cards and their nested snapshot tables no longer cause page-level horizontal scroll on mobile (`min-width: 0`, `overflow-x: hidden` on card containers).

## [6.9.0] — 2026-10-05

### Added
- **Surplus Analysis — payoff acceleration** — each debt recommendation now shows a "X mo sooner" badge indicating how many months earlier the debt would be paid off if the suggested amount were applied as a one-time extra payment today, computed by running `DebtCalculator.calculatePaymentPlan` twice per debt (baseline vs. reduced balance).
- **Surplus Analysis — balance dip warning** — a visible warning appears when the projected running balance dips below the minimum reserve at any point during the window, even when the net surplus is positive. Surfaces cash-flow timing risk hidden by net-only analysis.
- **Surplus Analysis — running balance sparkline** — a compact Chart.js line chart inside the card plots the projected account balance across the window, with a dashed amber reference line at the minimum reserve floor.
- **Surplus Analysis — allocation slider** — when both debt and savings recommendations are present, a range slider (0–100%) lets the user split the surplus between debt paydown and savings goals; recommendation amounts update live in-place without re-running the projection.

## [6.8.0] — 2026-10-05

### Added
- **Surplus Analysis transparency view** — the Surplus Analysis card now has a collapsible "Show projected transactions" toggle that reveals the individual income and expense transactions driving the window estimates, so users can verify exactly what's included in the calculation.

### Fixed
- **Zero-balance recommendations** — the Surplus Analysis recommendations list now filters out any debt with a zero balance before building strategy suggestions, and applies a final guard so no recommendation with a $0 suggested amount can appear for any category.

## [6.7.0] — 2026-10-05

### Added
- **Surplus Analysis** (issue #237) — new full-width card on the Health page that estimates free cash flow over a user-defined rolling window (default 90 days) for a selected account. Calculates projected income and expenses using the ledger projection engine, applies a configurable cushion percentage (default 20%) on top of the net outflow to determine a minimum reserve, then displays the difference as surplus or deficit. When a surplus exists, the card surfaces up to five read-only recommendations: the three best debt-paydown targets by strategy (highest APR, highest balance, snowball) and up to two open savings goals. The selected account, window length, and cushion percentage are all sticky settings persisted via `getSetting`/`setSetting`.

## [6.6.2] — 2026-10-05

### Fixed
- **Sync error toast on every Postgres session start** (issue #232) — `seedMissingBalanceHistory` was POSTing balance history entries with `date` values taken directly from `debt.updatedAt`, which the Postgres API returns as a full ISO timestamp (`"2026-10-05T12:34:56.789Z"`). The server sanitizer heals this, but the comparison `debt.debtStartDate < debt.updatedAt` used the raw timestamp in string comparison, and could produce unexpected branch behavior. `seedHistoryForDebt` now slices the date to `YYYY-MM-DD` before use.
- **`clearedFilter` preference lost on Postgres reload** — the `PATCH /api/plan-settings` handler rebuilt `ledgerSettings` from only four explicit fields, silently dropping `clearedFilter`. The field is now preserved.
- **`pgFetch` error logging now includes the server response body** — previously only the HTTP status code was logged on a non-ok response, making it impossible to see the server's error message. The response JSON is now logged alongside the status.

## [6.6.1] — 2026-10-04

### Changed
- **Calendar shortcut / nav changes** (issue #233):
  - Added a **Reports → Calendar shortcut** button to the toolbar (next to the command palette button) — clicking it navigates directly to the Reports page with the Calendar sub-tab active.
  - Added a **"Reports — Calendar"** entry to the command palette (Ctrl+K) for keyboard-first navigation to that sub-tab.
  - **Moved Calendar Feed** out of the toolbar and into the account dropdown menu (alongside Backup & Restore and Settings).

## [6.6.0] — 2026-10-04

### Added
- **Sort and filter controls** (issue #219) — all three list pages now have sort/filter toolbars:
  - **Liabilities (Debts)**: Sort by Balance, Interest Rate, Min Payment, Payoff Progress, Utilization, or Due Soonest. Filter by Category, Account, Interest type, Payoff Progress, and Utilization. Debts where progress/utilization cannot be calculated (no credit limit or original balance) sort to the bottom.
  - **Recurring**: Sort by Amount or Due Soonest (day of month). Filter by Category, Account, and Month (shows only templates with at least one occurrence in the selected month).
  - **Accounts**: Sort by Name, Type, Balance (projected), or APY. Filter by Type.
  - All controls are in-page DOM selects — no persistence, resets naturally on page reload.

## [6.5.3] — 2026-10-04

### Changed
- **Account menu** (issue #221) — the toolbar's Backup & Restore and Settings buttons are now consolidated into an Account menu (person icon, top right). The dropdown shows the logged-in email (display-only, Postgres mode only), Backup & Restore, Settings, and a Sign Out button (Postgres mode only). The Calendar feed button remains in the toolbar. Existing keyboard/command-palette shortcuts for Settings and Backup & Restore still work.
### Added
- **Recurring template archiving** (issue #222) — recurring templates can now be archived via an **Archive** button on each card. Archived templates are excluded from the ledger, calendar feed, and occurrence calculations everywhere (the same behavior as archived debts). A **Show archived** toggle in Settings makes archived templates visible on the Recurring page with a muted appearance and an **Unarchive** button. The archived count is shown as a note below the active list. The `archived` flag is persisted through all storage backends (local, session, Postgres).

## [6.5.2] — 2026-10-04

### Changed
- **Account linked-item chips** (issue #223) — account cards now show grouped count chips ("Income (2)", "Debts (1)", etc.) instead of one pill per item name. Recurring templates are now included (previously missing from the display). Each chip is clickable and navigates to the corresponding page. The chip set includes: Income (income + bonuses), Debts, Budget (bills + expenses), and Recurring. Accounts with no linked items show nothing.

## [6.5.1] — 2026-10-04

### Fixed
- **Expenses month scoping** (issue #220) — the Expenses list, category summary, cash flow totals, and outflow bar chart now all scope to the same calendar month. A `‹ Month Year ›` navigator above the expense list lets you browse other months. Previously, all expenses across all time were aggregated together, causing the list and summary figures to diverge from any single-month view.

## [6.5.0] — 2026-10-04

### Added
- **Balance History** (issue #TBD) — every debt and every Credit Card / Loan account now records a dated history of balance and minimum payment. A **History** button appears on each debt row and eligible account card, opening a modal with a line chart of balance over time and an editable entry table (add, edit, delete entries). Balance and minimum payment are auto-recorded whenever a debt or account is added, edited, or the balance is updated; the first entry is seeded from the current `accountBalance` / `startingBalance` on load. Fixed-Amount debt entries store `balance: null` and record `minimumPayment = fixedAmount`.
- **Account minimum payment field** — Credit Card and Loan accounts gain a **Minimum Payment** field (informational; does not affect forecasts or ledger calculations). Persisted across all three storage backends.
- Postgres backend: `balance_history` table with `debt_id` / `account_id` cascading FKs and a `CHECK` constraint enforcing exactly one owner; `minimum_payment` column on `accounts`; `/api/balance-history` CRUD route.
- Export/import: balance history round-trips through JSON export/import with owner-id remapping for all three backends (local, session, Postgres replace and merge modes).
- Jest/Stryker unit-test coverage for `src/balanceHistoryCore.js` pure helpers.

## [6.4.0] — 2026-09-28

### Added
- **Calendar Feed — paydays** (issue #217) — income paydays now appear in both the downloadable ICS and the server-side webcal subscription feed as all-day `Payday - Name` events (UID `income-<id>-<date>`), using the same weekly / biweekly / twice-monthly / monthly schedule as the Income page and Reports calendar. The description shows `Amount: $X`, the linked account, and the app link. The server generator carries a Node-side copy of `getIncomePaydaysInMonth()`.

### Changed
- **Calendar Feed — archived debts follow "Show archived debts"** (issue #217) — archived debts are omitted from the ICS download and the webcal feed by default (previously they always appeared). When Settings → Show archived debts is on, they are included and titled `Debt (Archived) - Name` so they're distinguishable from active debts. The server feed reads the `showArchivedDebts` row from the `settings` table.
- Calendar Feed modal and the Show-archived-debts setting helper text now mention paydays / the calendar feed behavior.

## [6.3.0] — 2026-09-28

### Changed
- **Calendar Feed** (issue #214) — all events (bills, debts, recurring, expenses) now render as all-day events in calendar apps (`DTSTART;VALUE=DATE`) rather than a 9–10 AM time slot; each event description now includes a "View in MyFinances" link back to the application.

## [6.2.0] — 2026-09-27

### Added
- **Calendar Feed** (issue #212) — export bills, debts, recurring templates, and expenses to a calendar application:
  - New toolbar calendar icon opens the Calendar Feed modal.
  - **Download .ics**: generates a standard iCal file (RFC 5545) covering a ±12-month window and triggers a browser download. Works for all storage backends (local, session, PostgreSQL).
  - **Live subscription** (PostgreSQL backend only): generates a `webcal://` URL backed by a per-user random token stored in `plan_settings.calendar_token`. Google Calendar and other apps can subscribe to this URL and receive automatic updates on each poll.
  - Token management: Generate / Regenerate buttons in the modal; token is a 128-bit random hex value. The public `GET /calendar.ics?token=<token>` endpoint bypasses session auth but validates the token before serving.
  - Events are titled `Bill - Name`, `Debt - Name`, `Subscription - Name`, `Reimbursement - Name`, `Transfer - Name`, or `Expense - Name`. Description includes amount, category, and linked account name.
  - All events scheduled at 9 AM floating local time; individual occurrences generated per month (not RRULE). Paused, skipped, and paid recurring months are excluded.
  - New DB migration `1755600000016_add-calendar-token.js` adds `calendar_token TEXT` column to `plan_settings`.

## [6.1.0] — 2026-09-20

### Added
- **Person association display** (follow-up to issue #203) — Family member linkages are now visible throughout the app without opening edit forms:
  - **Debt cards** (Liabilities page): each card shows green person pill(s) below the debt name for every linked family member.
  - **Income cards** (Income page): each card shows a green person pill when an income source is assigned to a family member.
  - **People page**: each person card gains a collapsible `<details>` section listing linked income sources and liabilities by name/amount; clicking any item navigates directly to that page and scrolls the card into view.
  - **Strategy / Payment Plan schedule table**: debt column headers show person pills so the payoff schedule can be read per-person at a glance.
  - **Ledger**: income and debt transaction rows show a person pill below the transaction name.
  - `buildPersonPillsHtml(personIds, persons)` added to `src/utils.js` as a shared pill-rendering helper.

## [6.0.1] — 2026-09-20

### Fixed
- **Person field in debt inline edit** — the Edit form on each debt card now includes a multi-select **People** field (visible only when persons exist), so family member assignments can be changed without re-opening the main debt form.

## [6.0.0] — 2026-09-20

### Added
- **Person / Family Member entity** (issue #203) — A new top-level **People** page lets you define family members and link financial data to them:
  - **Add, edit, delete** family members by name; deletion prompts for debt reassignment when the person owns debts.
  - **Income linking** — income records gain an optional `Person` selector; the person card derives annual income from linked income sources.
  - **Debt ownership (many-to-many)** — debts gain a multi-select `Family Member(s)` field; a debt can be shared between multiple persons (`personIds: []` on the debt record).
  - **Per-person dashboard** — the Health page Credit Utilization card now shows a per-person breakdown row (credit utilization % and DTI %) for every family member beneath the family total; persons with no CC debts show 0%.
  - **Full Postgres wiring** — `persons` table, new migration (`1755600000015_add-persons.js`), `/api/persons` CRUD route, `person_ids INTEGER[]` column on `debts`, `person_id` FK on `incomes`, full import/export round-trip support including ID remapping in both replace and merge modes.
  - **Command palette** — "People" page registered in the Ctrl/Cmd+K jump list.

---
## [5.16.0] — 2026-09-20

### Added
- **Ledger filters** (issue #201) — The Ledger page gains three new filter and action controls:
  - **Around Today (±7 days)** date range — new default Show option, displaying transactions from 7 days ago through 7 days ahead. Designed for reviewing items that are clearing close to today's date.
  - **Cleared status dropdown** — filters the ledger to "All" / "Uncleared Only" / "Cleared Only" transactions.
  - **Mark N as Cleared bulk action** — a button appears when the current filtered view contains uncleared rows; clicking it opens a confirmation modal and marks all visible uncleared transactions as cleared in one step.
  - **Clear Filters button + active badge** — when any filter deviates from its default, a "Clear Filters" button and an "N filters active" badge appear in the filter bar for a one-click reset.
  - **Sticky filter bar** — the filter controls row sticks to the top of the viewport when scrolling through long ledger views.
- All new filter state (`clearedFilter`) is persisted alongside existing ledger settings through localStorage, data export/import, and the optional Postgres backend.

---
## [5.15.0] — 2026-09-20

### Added
- **Credit limit & utilization tracking** (issue #200) — Credit-card debts now have an optional **Credit Limit** field (add form, inline edit). When set, each debt card shows a color-coded **utilization bar** immediately below the payoff-progress bar: ≤10% green (Good), 11-30% yellow (Fair), 31-50% orange (High), 51%+ red (Critical), ≥100% red (Maxed). The **Health dashboard** gains a 7th metric card showing aggregate utilization (sum of balances ÷ sum of limits) across all active credit-card debts that have a limit set, with the same 4-tier color scheme. If no limits are set the card shows an empty state with a link to the Liabilities page. New `credit_limit` column added to the Postgres `debts` table (migration 14); `archived` column also wired into the server-side columns map (existing gap).

---
## [5.14.0] — 2026-09-20

### Added
- **Archive paid-off debts** (issue #202) — Debt cards now show an **Archive** button once the debt is fully paid off (credit-card balance reaches $0, or a fixed-amount debt's end date has passed). Clicking it opens a confirmation modal and hides the debt from the Liabilities list. Archived debts are excluded from all calculations: debt overview totals, Strategy payoff plan, Health page DTI/timeline, account balance projections, and Ledger transactions. A new **Show archived debts** toggle in Settings reveals archived cards with an Unarchive button to restore them. The `archived` flag is persisted through all three storage backends (localStorage, sessionStorage, and Postgres via a new migration).

---
## [5.13.0] — 2026-09-15

### Fixed
- **Login gate UX hardening** — `link-btn` buttons ("Forgot password?" and "Back to sign in") now render as themed text links using `var(--primary-color)` / `var(--primary-hover)` in both light and dark mode; previously had no CSS definition and fell back to browser-default gray button chrome. `login-gate-forgot-link` centering rule also added.
- **Forgot-password form validation** — client-side email format check added; submitting an empty or `@`-less value now shows an inline error without sending a request.
- **Reset-password form validation** — 12-character minimum check added client-side to match the server-side guard, giving immediate feedback before the network round-trip.
- **In-flight double-submit prevention** — submit button is disabled on all four auth forms (forgot-password, reset-password, login, register) for the duration of the in-flight fetch request; re-enabled on every error path.
- **Forgot-password 429 surfacing** — rate-limit responses from `/auth/forgot-password` now show "Too many attempts. Try again later." rather than being silently swallowed; all other non-success responses still show the generic success message to preserve account-existence privacy.

---
## [5.12.0] — 2026-09-14

### Added
- **Currency preference** (issue #147) — Settings modal now has a Currency dropdown (20 major ISO 4217 codes). The selection is persisted under `debtTrackerCurrency` in `localStorage` (same device-preference pattern as `debtTrackerLocale`/`debtTrackerTheme`). `formatCurrency()` reads `getCurrencyCode()` from `i18n.js` instead of hardcoded `'USD'`, so all monetary displays update immediately on save.

---
## [5.11.0] — 2026-09-14

### Changed
- **DB schema hygiene** (issue #155) — `sessions.expires_at` index added (migration `1755600000012`) to support future session-sweep jobs without a full-table scan. `CLAUDE.md` gains a migration safety note covering two pitfalls: the `down()` risk profile change when the first alter-populated-table migration lands, and the correct `pgm.sql()` API for raw SQL (vs `db.query()` which throws).

---
## [5.10.0] — 2026-09-14

### Security
- **nginx proxy hardening** (issue #154) — explicit `proxy_connect_timeout 10s`, `proxy_read_timeout 30s`, `proxy_send_timeout 10s`, and `client_max_body_size 1m` on the `/api/` and `/auth/` proxy blocks; `client_max_body_size` is now documented alongside the matching `express.json({limit:'1mb'})` so the two limits can't silently drift. Commented-out `deploy.resources.limits` guidance added to all four services in `docker-compose.yml` (conservative starting points for shared-host deployments).

---
## [5.9.0] — 2026-09-14

### Security
- **Gate `/auth/register` behind `ALLOW_SETUP` env var** (issue #156) — `POST /auth/register` now returns 404 unless `ALLOW_SETUP=true` is set in the server container's environment, closing the deployment-sequencing window where a network-reachable server could be claimed by whoever reaches the endpoint first. The `setup.sh` / `setup.ps1` scripts set it automatically and prompt the operator to remove it after account creation. `docker-compose.yml` documents the variable; `server/README.md` explains the flow.

---
## [5.8.0] — 2026-09-14

### Added
- **Automated scheduled Postgres backups** (issue #159) — a `backup` service in `docker-compose.yml` runs `pg_dump` on a configurable cron schedule (default: 2 am daily) inside a `postgres:16-alpine` container, writing compressed `.dump` files to a dedicated `backup-data` named volume. No host-level cron required. `BACKUP_SCHEDULE` (cron syntax) and `BACKUP_RETENTION_DAYS` (default 7) env vars control the schedule and retention. Uses the existing `postgres_password` Docker secret.

---
## [5.7.0] — 2026-09-14

### Added
- **Password reset via email** (issue #176) — "Forgot password?" flow on the login gate: generates a time-limited (1 hour) single-use reset token, emails a reset link via the existing SMTP infrastructure, and provides a new reset-password form shown when `?reset_token=` is present in the URL. Token is stored hashed (SHA-256); the plaintext is only ever sent in email. Always returns HTTP 200 on the forgot-password endpoint to avoid leaking account existence.

---
## [5.6.0] — 2026-09-14

### Performance
- **JS module-fetch waterfall eliminated with modulepreload hints** (issue #146) — 16 transitive-import modules (not directly imported by `src/app.js` but pulled in one or two levels deep through `ui.js`, `reports.js`, `i18n.js`, `storage.js`, and others) now have `<link rel="modulepreload">` hints in `index.html`'s `<head>`. The browser fetches and links them in parallel while parsing `app.js` and its direct imports, collapsing the 3-level HTTP/1.1 waterfall. For deployments behind nginx proxy manager or any other TLS-terminating reverse proxy with HTTP/2 enabled, multiplexing already handles most of this; the hints remain valuable for local dev (`python -m http.server`) and any HTTP/1.1 path.
- **HTTP/2 guidance added to `nginx.conf`** — a comment explains that HTTP/2 should be enabled at the reverse proxy layer (nginx proxy manager, Caddy, Traefik), not in this backend's plain-HTTP `listen 80` block, which cannot carry HTTP/2 without TLS.
- **CSS split deferred** — `styles.css` (170 KB, ~93% unused on first paint per the Lighthouse audit) would benefit from a critical-CSS extraction, but doing this safely without a build step risks silent content-clipping regressions. Tracking as a follow-up that requires introducing a bundler.

### Tests
- **`tests/features/test_performance.py`** — 22 new tests covering: `lighthouserc.json` validity, all-four-category gating at `"error"` severity with `minScore >= 0.8`, nginx gzip config, the new modulepreload hints (presence, correct module list, real file hrefs, placement in `<head>`), the HTTP/2 proxy-layer comment, and negative cases that verify each check actually catches its target flaw rather than trivially passing.

---
## [5.5.0] — 2026-09-14

### Changed
- **Server: bump five server dependencies** (PR #169) — argon2 0.41→0.45, express 4.21→5.2 (major), express-rate-limit 7.4→8.7 (major), node-pg-migrate 7.6→9.0 (major), nodemailer 9.1→10.0 (major). The express 4→5 and node-pg-migrate 7→9 upgrades were the two breaking changes tracked in issue #141; both are now resolved: the `runner` named-export fix (PR #188) handles node-pg-migrate v9, and `app.set('trust proxy', 1)` already handles express-rate-limit v8's `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` check. Express 5 compat verified by three new tests in `server/test/app.test.js`.

---
## [5.4.4] — 2026-09-14

### Changed
- **CI: align codeql-action version across workflows** (issue #157) — `codeql.yml` now pins `github/codeql-action/{init,autobuild,analyze}@v4`, matching the `@v4` already used by the three `upload-sarif` steps in `trivy.yml`. Adds a regression test (`test_codeql_action_version_consistent` in `tests/security/test_static_scan.py`) that parses both workflow files and asserts every `github/codeql-action` reference uses the same major version, so drift cannot recur silently.

---
## [5.4.3] — 2026-09-13

### Changed
- **Deterministic test waits** — replaced all non-intentional `wait_for_timeout()` calls in the Playwright test suite with `wait_for_selector` / `wait_for_function` conditions (issue #150). Reduces flakiness from fixed-delay races and makes CI failures point to real problems rather than timing assumptions. Intentional exceptions kept: one `wait_for_timeout(20)` in `test_whatif_simulator.py` (below the 150 ms debounce threshold) and postgres-backend tests with multi-second waits for network-async bulk operations.

---
## [5.4.2] — 2026-09-13

### Changed
- **docs: `tests/README.md` prose write-ups complete** (issue #151) — added dedicated `#### test_x.py` sections for all 17 test files that were missing from the "Test Categories" prose: `test_validation_modals`, `test_storage_backend`, `test_i18n`, `test_pwa`, `test_pwa_icons`, `test_cash_flow_trend`, `test_money_flow_sankey`, `test_analytics`, `test_versioning`, `test_retirement`, `test_issue_92_export`, `test_issue_93_expense_save` (features) and `test_data_transfer_modal`, `test_delete_confirm_modal`, `test_settings_theme_location`, `test_pwa_update_banner`, `test_login_gate_theme` (UI). Also updated the directory tree to include all missing files and removed the stale "added since last revision" note.

---
## [5.4.1] — 2026-09-13

### Changed
- **CI: test-ui split from 2 → 3 parallel shards** (issue #153) — bin-packed all 30 UI test files by test count (a=83, b=85, c=86) rather than file count, keeping each shard well under the 20-minute budget. Also adds `test_login_gate_theme.py` to CI for the first time: it existed in `tests/ui/` but was inadvertently missing from both prior shards.

---
## [5.4.0] — 2026-09-13

### Added
- **Pension account type** — a new `Pension` retirement subtype (issue #174) on the Accounts page with five pension-specific fields: Annual Salary, Contribution Rate (% of salary), Vesting Years, Estimated Monthly Benefit (from the administrator's statement), and Years of Service. Pension accounts log annual salary reviews rather than balance snapshots — each review records the updated salary and auto-computes the monthly contribution (`salary × rate ÷ 12`). The Retirement page shows a dedicated salary history table for pension accounts and excludes them from the three investment charts (Balance Over Time, Contribution vs. Growth, Current Balance Breakdown) since those are market-driven metrics. The projection panel labels pension accounts as "total contributions accumulated" by the target date rather than a compounded balance. DB migration adds five `pension_*` columns to `accounts` and an `annual_salary` nullable column to `retirement_snapshots`; the `retirement_subtype` CHECK constraint is extended to include `'Pension'`.

---
## [5.3.0] — 2026-09-08

### Added
- Additional manifest links.
## [5.2.0] — 2026-09-08

### Added
- **PWA manifest completeness** — `manifest.json` now includes the three recommended-but-previously-missing fields: `id` (`"/"`) so an app's installed identity remains stable across any future `start_url` change; `categories` (`["finance", "productivity"]`) for app-store-style PWA listings; and `shortcuts` so the OS launcher can surface quick-jump actions — right-clicking the installed icon offers **Health Dashboard** (`/?page=health`) and **Ledger** (`/?page=ledger`). A matching two-line URL-routing hook in `app.js`'s `DOMContentLoaded` handler reads the `?page=` parameter after `init()` and calls `switchPage()`, so shortcut-launched sessions land directly on the right page. New `test_manifest_shortcuts_structure` and `test_manifest_shortcut_urls_use_known_page_names` tests; `id` and `categories` added to `REQUIRED_MANIFEST_FIELDS` (issue #158).

---
## [5.1.0] — 2026-09-08

### Changed
- **Login gate now matches the site's visual theme** — the full-page login/register overlay (`#loginGate`, Postgres backend only) previously used a plain flat background and a bare card with no branding. It now mirrors the rest of the app: the overlay uses the same gradient backdrop as `<body>`, and a new header band atop the card reuses the real `<header>`'s blue gradient plus the goal logo icon. The card body itself stays a flat, opaque surface so the form remains readable. Dark mode gets matching dark gradients; installed-PWA (standalone) mode drops the gradient backdrop and floating-card chrome for the same flat, edge-to-edge look `.container` already uses there; high-contrast mode forces both the overlay and header band to solid black, consistent with that tier's no-gradients rule (issue #33).

## [5.0.1] — 2026-09-08

### Fixed
- **XSS via retirement target date input** — the Retirement page's target-date `<input>` interpolated `app.retirementTargetDate` into its `value` attribute without `escapeHtml()`, so a value containing a `"` could break out of the attribute and inject arbitrary HTML on re-render (CodeQL `js/xss-through-dom`, high severity). New `tests/security/test_xss.py::test_xss_in_retirement_target_date_input_value` regression test.

---
## [5.0.0] — 2026-09-07

### Added
- **Retirement accounts dashboard** — a new `Retirement` account type (subtype, assumed rate of return, employer match %) alongside a manually-logged per-account balance/contribution history (`app.retirementSnapshots`), a pure projection calculator (`src/retirementCalculator.js`) that compounds monthly to a user-set target retirement date, and a new "Retirement" nav page with balance-over-time, contribution-vs-growth, and current-balance-breakdown charts plus a per-account and combined projected-value panel. Wired through all three storage backends, including a new `retirement_snapshots` table and `/api/retirement-snapshots` CRUD endpoint on the optional self-hosted Postgres server. New `tests/features/test_retirement.py`, `tests/unit/retirementCalculator.test.js`, `server/test/crudResources.test.js` case, and `tests/postgres/test_postgres_mutations.py` cases.

---
## [4.48.0] — 2026-09-07

### Added
- **Optional self-hosted Google Analytics (#131)** — a new `GA_MEASUREMENT_ID` environment variable (unset by default) on the `myfinances` service in `docker-compose.yml`. A new `docker-entrypoint.d/40-ga-env-config.sh` script (run automatically by the base nginx image's own entrypoint before nginx starts) validates the id and writes it into `/tmp/env-config.js`, served at `/env-config.js` by a new no-cache `nginx.conf` location block. `index.html`/`guide.html` load that file before the new `src/analytics.js`, which only injects `gtag.js` and initializes `dataLayer` when `window.__ENV__.GA_MEASUREMENT_ID` is actually present — a plain static deployment (`python -m http.server`, GitHub Pages, etc.) has no entrypoint to generate that file, so analytics stays off there with no code changes needed. This is a self-hosting-operator opt-in for their own instance, not a default the project ships tracking through: the CSP (`index.html` meta tag and `nginx.conf` header, kept in sync) now permanently allow-lists `googletagmanager.com`/`google-analytics.com` so the feature *can* load when configured, but nothing calls home unless the env var is set. New `tests/features/test_analytics.py`; `tests/security/test_static_scan.py` gained Dockerfile/nginx/docker-compose checks and its CSP-origin check now uses an explicit allowlist instead of a deny-list.

### Fixed
- **nginx was silently dropping the `Content-Security-Policy` and `X-XSS-Protection` headers on every response** — discovered while integration-testing the Google Analytics work above against a real container. nginx's `add_header` directives don't merge across levels: any `location` block that sets its own `add_header` fully replaces the server-level set for that location, rather than adding to it. Every content-serving `location` in `nginx.conf` (`/index.html`, `/manifest.json`, `/sw.js`, the CSS/JS and image/font regex blocks, and now `/env-config.js`) already redeclared `Cache-Control`/`X-Content-Type-Options`/`X-Frame-Options`/`Referrer-Policy` for itself, but none of them redeclared CSP or X-XSS-Protection — so despite the server-level `add_header Content-Security-Policy ...` looking correct in the file, curling a real running container showed it was never actually sent, on any path, including `/`. Only `index.html`'s `<meta>` tag CSP was ever enforced in production (which lacks `frame-ancestors`, since browsers ignore that directive in a meta tag), meaning the clickjacking protection SECURITY.md/DEPLOYMENT.md describe as coming from the nginx header was never actually active. Existing CSP tests never caught this because they run against `python -m http.server`, which never involves nginx at all. Every location block now redeclares both headers; verified against a real `docker build`/`docker run` (matching `docker-compose.yml`'s `read_only`/`tmpfs` constraints) that all response paths now carry both headers.

---
## [4.47.0] — 2026-09-06

### Added
- **Plan History on the Payment Plan page (#162)** — every "Calculate Payment Plan" submission now appends a read-only history entry (date, monthly payment, strategy, total interest, time to pay off, payoff date) to a new collapsible "📜 Plan History" panel, capped at the 20 most recent submissions (older entries are trimmed, and deleted server-side on the Postgres backend). Only the main Calculate flow records an entry — the Target Payoff Date back-calculator remains purely exploratory and doesn't. Separately, reloading the app now silently recalculates and reveals the Results section using the already-persisted last-used monthly payment/strategy (`_savedMonthlyPayment`/`_savedStrategy`, previously only used to pre-fill the form inputs), so the previous plan's results are visible again without re-clicking Calculate. New `plan_history` table/migration, `/api/plan-history` CRUD endpoint (`server/src/routes/planHistory.js`), and `sanitizePlanHistoryEntry()` (`src/sanitizers.js`, shared client/server); wired into JSON export/import and both Postgres import modes (replace/merge) alongside the existing `reconciliations` resource. New `tests/features/test_plan_history.py`, `server/test/planHistory.test.js`, and a `tests/postgres/test_postgres_mutations.py` case.

---
## [4.46.0] — 2026-09-06

### Fixed
- **Postgres backend is now auto-detected and forced, closing a login bypass (#164)** — `app._storageBackendKind` was previously decided purely from the per-browser `debtTrackerStorageBackend` `localStorage` key. A fresh browser profile (e.g. an incognito window) that never set this key silently defaulted to local-storage mode forever and never saw the login gate, even when the app was served from a live Postgres-backed deployment — so a visitor could end up entering data into a disconnected local-only copy of the app without ever being asked to authenticate. `init()` (`src/app.js`) now calls a new `checkPostgresBackendPresent()` (`src/storage.js` — `GET /auth/setup-status`, same endpoint the login gate already used) whenever the backend preference isn't already Postgres; a successful response forces Postgres mode and persists it, so every subsequent boot goes straight through the existing session-check/login-gate/local-data-migration flow. A plain static/local-only deployment has no `/auth` router, so the detection fetch fails fast and behavior is unchanged. As a side effect, the Settings modal's local/session storage options are now permanently hidden for any browser that has ever detected a Postgres server at this origin (existing UI logic, previously only reachable via a manual Settings switch). New `tests/postgres/test_postgres_forced_detection.py` (3 tests, run against the real docker-compose stack); `tests/postgres/test_postgres_bootstrap.py::test_settings_postgres_option_reloads_to_gate` updated since its old premise — a browser with existing local data staying unauthenticated long enough to open Settings on a real Postgres origin — is exactly the loophole this closes.

---
## [4.45.0] — 2026-09-04

### Fixed
- **Third audit follow-up pass, same day** (`docs/audit/AUDIT_SUMMARY_2026-09-02.md`'s "Fixed 2026-09-04 (round 3)"), picking off the last well-scoped remaining findings:
  - **`sanitizeDebt()` allowlist** — removed the `...record` spread-then-override; the function already built a complete allowlist, so this was a pure removal. New test asserts an injected unknown field (and a `__proto__` pollution attempt) doesn't survive sanitization.
  - **Reports page only re-renders the active tab** — `renderReportsPage()` (`src/reports.js`) previously rebuilt all 8 sub-panels and 11 Chart.js instances on every tab click, month-nav, or range change. Now scoped to whichever tab is actually visible, for every trigger. Surfaced and fixed: `reportsNetWorth.js`'s two charts had no self-destroy guard (every other chart-owning render function already did); 2 of the 11 tracked chart-instance keys were dead code, never created anywhere; and 6 pre-existing tests across 4 files silently depended on the old "render everything" behavior without ever switching to the tab they were actually checking.
  - **What-If slider debounced** — the Strategy page's payoff-simulation slider (`strategyComparison.js`) recomputed the full simulation on every raw `input` event; now debounced 150ms via a new `debounce()` utility (`src/utils.js`), with the extra-amount label still updating immediately for responsive feedback. New `tests/ui/test_whatif_simulator.py` (zero prior coverage of this panel).
  - **CI shard rebalancing** — `test-features-b`/`-c` had grown to ~123 tests each, ~3x every sibling shard. Rebalanced all 24 files across `b`/`c`/new `h` (82/81/83 tests, 8 files each).

---
## [4.44.0] — 2026-09-04

### Added
- **Strategy mini-calendar now shows expense and bonus days**, not just debt payments/paydays/bill due-dates — `src/strategyCalendar.js` gained purple expense (`📊`) and teal bonus (`🎁`) day-markers using the existing `getExpensesByDayForMonth`/`getBonusesByDayForMonth` helpers, which had sat unused since they were originally written alongside `getBillsByDayForMonth`. Matching legend entries and dark-mode/high-contrast styling. Resolves a "some helpers exist but aren't wired in — unclear if intentional" finding from the 2026-09-02 features audit; decided in favor of completing the feature. New `tests/ui/test_strategy_calendar.py` (4 tests — the calendar view had zero prior coverage).

### Fixed
- **Second follow-up pass on the 2026-09-02 audit** (`docs/audit/AUDIT_SUMMARY_2026-09-02.md`), across four batches — full detail in that file's "Fixed 2026-09-04" section:
  - **Session cookie `Secure` flag, done properly this time.** The 2026-09-03 attempt (`NODE_ENV: production` in `docker-compose.yml`) was reverted for breaking plain-HTTP login. The real fix: `server/src/app.js` now sets `app.set('trust proxy', 1)`, and `server/src/routes/auth.js` derives the `Secure` flag from per-request `req.secure` (Express reads nginx's `X-Forwarded-Proto` once `trust proxy` is set) instead of a static env-var check — correct automatically in both plain-HTTP local testing and a real HTTPS deployment, no manual step either way. `trust proxy` also fixes `express-rate-limit` keying off nginx's container IP instead of the real client.
  - **Postgres connection pool hardening** — `server/src/db.js` gained `statement_timeout`, explicit `max`/`idleTimeoutMillis`/`connectionTimeoutMillis`, and conditional `ssl` (required with full certificate validation for any non-local host, no insecure opt-out).
  - **3 modals gained a real Tab focus-trap and focus-restore** (Reconcile, the app-wide delete-confirm modal, the account-replacement modal) — previously a keyboard/screen-reader user could Tab straight out into background page controls, and dismissing lost focus context entirely for the latter two. 6 new Tab-cycling tests in `tests/ui/test_accessibility.py`.
  - **i18n gaps closed**: Health page's DTI/Savings gauge screen-reader tables and the Settings modal's PostgreSQL storage option/note now translate (`en`/`es`/`pl`), previously hardcoded English inside otherwise-translated UI.
  - **5 dead exports removed** (`renderBillList`, `getLocalePreference`, `getRecurringTotalsForMonth`, `calculateSavingsProjection`, `incomeDaysInMonth`); `CLAUDE.md` and `stryker.config.mjs` updated to match.
  - Plus: mobile Health-page Print button now meets the 44×44 tap-target size (fix applied to the shared `.page-print-btn` class, benefiting every page); a suspected dark-mode contrast false-positive confirmed via direct reproduction as a CSS-transition sampling artifact and the audit script's timing fixed so it doesn't recur; `CLAUDE.md`/`server/README.md` corrected on the `/auth/register` endpoint; stale `.plans/MIGRATION_PLAN.md` deleted; the `qs`/`body-parser` audit finding's "fixable via plain `npm audit fix`" claim corrected (verified false — needs an Express 4→5 major bump instead).

---
## [4.43.0] — 2026-09-03

### Fixed
- **Follow-up fixes from the 2026-09-02 audit** (`docs/audit/AUDIT_SUMMARY_2026-09-02.md`) — the highest-impact remaining items not already covered by the database-hardening (4.41.0) or ledger-timestamp (4.40.1) fixes:
  - **Render-blocking `debtCalculator.js`** — added `defer` to its `<script>` tag in `index.html` (Lighthouse-confirmed ~640ms render-blocking); safe since its only consumer, `app.js`, is itself a deferred `type="module"` script.
  - **7 Chart.js canvases missing screen-reader table fallbacks** — all 5 Strategy/Plan charts (`src/charts.js`: payoff timeline, payment progress, interest-vs-principal, payment distribution, debt-to-income) and both Budget cash-flow charts (`src/bills.js`: cash-flow donut, obligations bar) now call `renderChartDataTable()`, matching the convention already followed everywhere else. New `tests/ui/test_chart_accessibility.py` coverage for both tab groups closes the gap that let this slip past the existing suite (which never visited those tabs).
  - **Stale Stryker mutation scope** — `stryker.config.mjs`'s `sanitizers.js` line ranges no longer matched current line numbers after the 4.40.0 ledger-cleared feature shifted them; `sanitizeRecurringTemplate` was partially out of scope and `sanitizeLedgerOverrides`/`sanitizeLedgerClearedTransactions` had zero mutation coverage. Ranges corrected, both functions added to scope, and 8 new Jest tests added in `tests/unit/sanitizers.test.js` to actually exercise them. Thresholds re-derived from a real local run (46.93%).

  A fourth finding — `docker-compose.yml` never setting `NODE_ENV=production` — was investigated and its obvious fix (setting it unconditionally) was reverted: `DEPLOYMENT.md`'s "HTTPS Requirement" section already documents, deliberately, that this must be set only *after* HTTPS is terminated in front of the stack, since the session cookie's `Secure` flag has no protocol-detection fallback and would otherwise silently break login over plain HTTP. Remains open pending a real fix.

---
## [4.42.0] — 2026-09-03

### Added
- **SMTP email infrastructure + template system** (`docs/superpowers/specs/2026-09-03-smtp-email-notifications-design.md`): a server-only foundation for future notifications. `server/src/email/` provides a `nodemailer`-based transport (configured via `SMTP_HOST`/`PORT`/`USER`/`FROM`/`SECURE` env vars plus a `secrets/smtp_password.txt` Docker secret, mirroring the existing Postgres-password pattern — entirely optional, silently disabled when unconfigured) and a plain-JS template system (`testEmail`, `welcomeEmail`, `alertEmail`). A new authenticated `POST /api/notifications/test-email` endpoint (Settings modal's new "Send test email" button, visible only on the PostgreSQL backend) sends a verification email to the logged-in user's own address — never a client-supplied one, avoiding an open-relay vector. `server/scripts/create-user.js` and `POST /auth/register` now send a best-effort welcome email on account creation. `setup.sh`/`setup.ps1` gained an optional interactive SMTP configuration step.

### Upgrading from < 4.42.0
- `docker-compose.yml`'s `server` service now requires `secrets/smtp_password.txt` to exist (it can be empty — an empty file means SMTP stays disabled, same as leaving `SMTP_HOST` unset). Deployments that ran `setup.sh`/`setup.ps1` already have this file. Manual/Portainer deployments must create it once: `touch secrets/smtp_password.txt` (or copy `secrets/smtp_password.txt.example`) before the next `docker compose up -d`.

---
## [4.41.0] — 2026-09-02

### Added
- **Postgres backend hardening from the database audit** (`docs/audit/database/DATABASE_AUDIT_2026-09-02.md`, findings H1/H2/M3):
  - **Indexes on every `user_id`/`account_id` foreign-key column** — new migration `server/migrations/1755600000006_add-user-and-account-indexes.js` adds a `CREATE INDEX` for each FK column across all eleven affected tables (tables whose primary key already leads with `user_id` were skipped, since that already serves single-column lookups). Every `crudRouter.js`/`keyedRouter.js` `WHERE user_id = $1` query and every `ON DELETE SET NULL` account-deletion cascade previously sequential-scanned; both now use an index.
  - **`CHECK` constraints on enum-shaped columns** — new migration `server/migrations/1755600000007_add-enum-check-constraints.js` adds constraints on `recurring_templates.frequency`/`.type`, `sinking_funds.allocation_method`, and `incomes.frequency`, matching the allow-lists their sanitizers already enforce at the application layer (bringing them in line with `bonuses.purpose`, the one column that already had one). DB-level integrity no longer depends entirely on every write path remembering to sanitize.
  - **`backup.sh`/`backup.ps1` and `restore.sh`/`restore.ps1`** — root-level scripts wrapping `pg_dump -Fc`/`pg_restore --clean --if-exists` against the `postgres-data` volume, the only durability layer for the optional self-hosted Postgres backend, which previously had no backup story anywhere in the repo. Documented in `DEPLOYMENT.md`'s new "Backup and Restore" section under "PostgreSQL Backend Deployment", along with `docs/examples/myfinances-backup.{cron,service,timer}` and a Windows Task Scheduler snippet for actually scheduling them (nothing runs backups automatically by default).
  - New `server/test/migrations.test.js` coverage: every expected FK index exists (`pg_indexes` lookup), and each new `CHECK` constraint actually rejects an out-of-range value — both run against a real Postgres container per this repo's server-test convention.

---
## [4.40.1] — 2026-09-02

### Fixed
- **Ledger cleared-transaction timestamp no longer truncated to midnight** — `sanitizeLedgerClearedTransactions()` and `sanitizeLedgerOverrides()` (`src/sanitizers.js`) reused `sanitizeDateISO()`, a helper built to reduce any value to a bare `YYYY-MM-DD` date, on the full-precision `clearedAt`/`updatedAt` timestamp fields added in 4.40.0. Every load, JSON import, or Postgres write silently discarded the time-of-day, so the Ledger's "Cleared" checkbox tooltip always showed midnight regardless of when it was actually checked. New `sanitizeTimestampISO()` helper (`src/utils.js`) preserves full precision and is now used in `src/sanitizers.js` and `server/src/routes/ledgerCleared.js`.

### Documentation
- **Full-repo audit pass** — nine audits (documentation, security, accessibility, i18n, features, performance, database, testing, dependencies/PWA/tech-debt) with live-verified results, consolidated in `docs/audit/AUDIT_SUMMARY_2026-09-02.md`. Fixed stale setup instructions along the way: wrong port in `setup.ps1` and `server/README.md`, a nonexistent `COOKIE_SECURE` env var in `DEPLOYMENT.md` (the code actually checks `NODE_ENV`, now documented in `.env.example`), and badly outdated version/test-count references across `README.md`, `ROADMAP.md`, and `tests/README.md`.

---
## [4.40.0] — 2026-09-02

### Added
- **Ledger cleared-transaction tracking** — a "Cleared" checkbox on each Ledger transaction row records whether it has actually posted to the account, and stamps a `clearedAt` timestamp when checked (shown as the checkbox's tooltip). Purely informational — it doesn't affect running balances — intended to surface scheduled transactions (bills, recurring items) that haven't posted on their expected day. Keyed the same way as amount overrides (`type|id|accountId|date`) via new module `src/ledgerCleared.js` / `app.ledgerClearedTransactions`, so state survives ledger re-sorts and regeneration. Round-trips through localStorage/sessionStorage, full JSON export/import, and the Ledger CSV export's column picker (new "Cleared"/"Cleared At" columns). Full parity with the optional self-hosted Postgres backend: new `ledger_cleared_transactions` table/migration, `/api/ledger-cleared` keyed-resource route, and wiring through `loadFromPostgres`, `postgresSync.js`, and `postgresImport.js`'s replace/merge/rollback paths.

---
## [4.39.2] — 2026-09-02

### Fixed
- **loginGate focus race in CI** — `emailInput.focus()` delay reduced from 30 ms to 0 ms. The 30 ms `setTimeout` was racing with Playwright's CDP fill commands in CI: after `#loginGate` became visible Playwright immediately called `fill('#loginGatePassword')`, but the 30 ms timer fired mid-fill and stole focus back to the email input, leaving the password field empty. A 0 ms timeout fires on the next event-loop tick before any CDP round-trips, so focus is settled before the test fills the field.

---
## [4.39.1] — 2026-09-02

### Changed
- **CI: split test-features-a into two shards** — `test_accounts.py` (27 tests, multi-modal deletion flows) and `test_forecast.py` (16 tests, multi-month projection rendering) moved to a new parallel `test-features-d` shard after the deletion-with-replacement feature (#135) added 11 complex modal-interaction tests and pushed shard A past the 20-minute timeout. Shard A shrinks from 129 → 86 tests; B and C are unchanged.

---
## [4.39.0] — 2026-09-02

### Changed
- **Account selectors now show "Name (Type)" in all dropdowns** — every account selector across the app (income add/edit, debt inline-edit, bill/expense add/edit, recurring add/edit, savings, ledger account filter, and reconciliation history filter) now displays account options as "Jay BCU (Checking)" instead of just "Jay BCU". This makes it unambiguous which account is which when names are similar or when multiple accounts of the same type exist. Affected helpers: `buildAccountOptionsHtml` in `src/accounts.js`, `refreshRecurringAccountSelectors` in `src/recurring.js`, the debt inline-edit account map in `src/debts.js`, the reconciliation history filter in `src/reconciliation.js`, and the ledger account filter in `src/ledger.js`.

### Added
- **Test coverage** — `test_account_type_shown_in_selectors` in `tests/features/test_accounts.py` verifies that the income, debt, and ledger account selectors all render options in "Name (Type)" format after an account is created.

---
## [4.38.0] — 2026-09-01

### Changed
- **Exposed port changed from 5500 to 32900**: `docker-compose.yml` host-side port binding updated
  from `5500:80` to `32900:80`. All test `BASE_URL` constants, CI workflow server startup commands,
  `lighthouserc.json` target URLs, documentation (`README.md`, `DEPLOYMENT.md`, `CLAUDE.md`,
  `tests/README.md`, `.github/copilot-instructions.md`), `setup.sh`, and debug tooling updated
  to match. Closes #127.

## [4.37.0] — 2026-09-01

### Changed
- **Node.js upgrade to 24 LTS**: `server/Dockerfile` base image updated from `node:20-alpine`
  (EOL April 2026) to `node:24-alpine` (Active LTS). `server/package.json` `engines` field
  updated to `>=24`.
- **CI — `actions/setup-node` v4 → v5**: both the `test-unit` and `mutation-testing` jobs now
  use `actions/setup-node@v5`, which runs on the Node.js 22 action runner and resolves the
  GitHub deprecation warning for the `node20` runner runtime.
- **Security — non-root Docker user**: `server/Dockerfile` now runs as the built-in `node`
  user (uid 1000) instead of root. All file ownership is set via `chown -R node:node /app /src`
  before the `USER node` directive; Docker Compose `file:` secrets default to `0444` so the
  entrypoint script can still read `/run/secrets/postgres_password` without root.

## [4.36.0] — 2026-09-01

### Changed
- **CI — test job splitting** (PR #130): `test-features` (34 test files) split into three
  parallel shards (`test-features-a/b/c`, ~11 files each) and `test-ui` (27 files) split
  into two shards (`test-ui-a/b`, ~13 files each). Each shard runs comfortably under the
  20-minute timeout that previously caused the monolithic jobs to time out.
- **CI — Playwright browser caching**: `~/.cache/ms-playwright` is now cached per job using
  `actions/cache@v4` keyed on `tests/requirements.txt` hash. Avoids re-downloading the 130 MB
  Chromium binary on every runner; with 8+ browser-test jobs the saving is ~4-8 min of
  total runner time per CI run.
- **CI — pip caching**: new `tests/requirements.txt` pins `playwright`, `pytest`, and
  `pytest-asyncio`. All jobs now use `actions/setup-python cache: pip` with
  `cache-dependency-path: tests/requirements.txt` so pip packages are restored from cache.
- **CI — mutation testing split**: `mutation-testing` job separated into `test-unit` (fast
  Jest run, executes on every PR for immediate feedback) and `mutation-testing` (slow Stryker
  run, executes on push to `main` only, timeout raised to 45 min).
- **CI — Trivy code-scanning fix**: Added `trivy.yaml` at repo root (required by
  `trivy-action` v0.36.0+; absence caused "configuration not found" and GitHub Code
  Scanning showing as "not configured"). All `trivy-action` steps now reference `trivy.yaml`
  via `trivy-config`. Removed `hashFiles()` guards from SARIF upload steps (they were
  silently skipping uploads when scans produced no findings, preventing Code Scanning
  initialization). SARIF uploads now have `continue-on-error: true` so a transient upload
  failure does not fail the security gate.
- **CI — Lighthouse timeout**: raised from 20 to 30 minutes to accommodate Docker Compose
  build time on cold runners.

---
## [4.35.0] — 2026-09-01

### Changed
- **Account deletion now requires a replacement when linked items exist** — clicking Delete on an account that has income, bonuses, debts, bills, expenses, or recurring transfers linked to it opens a new `#accountReplacementModal`. The modal lists every linked item by category and presents a replacement-account dropdown with no pre-selection. The "Delete and Reassign" button stays disabled until a replacement is explicitly chosen. A second confirmation names the target account before committing. Cancelling either modal leaves the account and all linked items untouched. Accounts with no linked items follow the existing single-confirm flow. All linked `accountId` (and `targetAccountId` for recurring transfers) fields are updated in memory before the account is removed and storage is saved.

### Added
- **Comprehensive account-deletion tests** — `tests/features/test_accounts.py` covers both the no-links and has-links deletion paths: confirm modal appears for unlinked accounts; replacement modal appears for linked accounts; confirm button is disabled without a selection; cancelling either modal preserves all data; the second confirmation names the replacement; delete-and-reassign correctly moves income, debts, bills, expenses, and recurring transfers to the replacement account; and post-deletion navigation through health/reports/ledger produces no errors.

## [4.34.0] — 2026-09-01

### Added
- **Themed validation-error modal** — all browser `alert()` popups triggered when a form submission is invalid (or when an action cannot proceed due to missing/invalid data) are now replaced by a themed `#alertModal` dialog that respects dark mode and the app's design system. The new `showAlertModal(message, title?)` function in `src/ui.js` follows the same Promise-based pattern as `showDeleteConfirmModal`, resolves on OK-click or Escape/Enter key. Affected modules: `accounts`, `bills`, `bonusAdvisor`, `debts`, `income`, `ledgerOverrides`, `reconciliation`, `recurring`, `savings`, `strategyPlanCalculation`, and the `app.js` callbacks. Sync functions that previously called `alert()` are promoted to `async` where needed (`saveEditAccount`, `saveEditBill`, `saveEditExpense`, `saveEditIncome`, `addBonus`, `saveEditBonus`, `saveEditRecurring`, `saveEdit` in debts, `saveInlineEdit` in debts, `showBonusAdvice`, `calculatePaymentPlanFromInputs`).
- **Weekly and Twice-per-month income frequencies** — the Income page now supports two new payment schedules in addition to bi-weekly and monthly. `weekly` generates a payday every 7 days anchored to the first-pay-date. `twice_monthly` generates paydays on the 15th and the last day of every month, independent of the first-pay-date anchor. Annual income estimates use 52× (weekly) and 24× (twice-monthly) multipliers. Both frequencies are available in the Add and Edit income forms.
- **Account type shown in account list card names** — account cards now display the type in parentheses inline with the name (e.g. "Jay - BCU (Checking)"), making account type scannable without hovering over the badge.
- **Expense categories aligned with Recurring Templates** — the Expense budget category list (add form, inline-edit dropdown) now matches the Recurring Templates categories: Subscription, Insurance, Rent / Mortgage, Utilities, Transport, Food, Entertainment, Health, Education, Savings, Transfer, Reimbursement, Other.

## [4.33.4] — 2026-09-01

### Fixed
- **Edit and Delete buttons silently failed on the PostgreSQL backend** (all pages — Debts, Income, Accounts, Savings, Recurring, etc.): The node-postgres (pg) library returns BIGSERIAL/BIGINT column values as JavaScript **strings** by default to preserve 64-bit precision. Every id flowing from the server into pp.debts, pp.accounts, etc. was therefore a string (e.g. "1"), while the data-debt-id attribute HTML integer parsed via parseInt was a number (e.g. 1). The strict === comparison pp.editingDebtId === debt.id (number vs. string) was always false, so the inline edit form was never rendered. The same mismatch caused pp.debts.filter(d => d.id !== debtId) to never filter anything out, leaving deleted items in place. Fix: add a global type parser for pg OID 20 (bigint) in server/src/db.js so all BIGINT/BIGSERIAL columns — primary keys and foreign keys alike — are returned as JavaScript numbers. Pure frontend with no backend API running is unaffected.

---
## [4.33.3] — 2026-09-01

### Fixed
- **Delete and Clear All Data dialogs replaced with themed modals**: All five native confirm() browser dialogs (Delete Debt, Delete Emergency Fund, Delete Sinking Fund, Delete Recurring Template, Clear All Data) have been replaced with a Promise-based themed modal (#deleteConfirmModal). Chrome can suppress native confirm() dialogs if the user previously checked "Prevent this page from creating additional dialogs", causing all delete operations to silently fail with no feedback. The new modal is keyboard-navigable (Escape cancels), theme-aware, and consistent with the app's existing modal patterns. The deleteDebt, deleteEmergencyFund, deleteSinkingFund functions are now sync; the recurring-template list's event handler and the Settings "Clear All Data" handler are also async.

---
## [4.33.2] — 2026-09-01

### Fixed
- **Setup wizard blocks all UI interaction** (this PR): The first-run setup wizard modal (`z-index: 10002`) intercepted all pointer events, making every Edit and Delete button in the app appear completely unresponsive until the user happened to click one of the wizard's two specific buttons. Two bugs compounded the problem: (1) the wizard re-appeared on every page refresh until a button was clicked, because no storage key was written until then — leaving `isFirstRun = true` indefinitely; (2) there was no Escape or backdrop-click path out of the wizard. Fix: `maybeShowSetupWizard` now calls `setSetting(app, RECONCILIATION_ADJUSTS_BALANCE, false)` immediately before showing the modal, writing `debtTrackerData` to localStorage so subsequent loads treat the session as returning. Escape key and backdrop-click handlers are also wired so users are never stuck. Three new regression tests added to `tests/ui/test_setup_wizard.py`.

---
## [4.33.1] — 2026-09-01

### Fixed
- **Server auto-migration on startup** (PR #123): The PostgreSQL server now runs `node-pg-migrate up` automatically at startup before accepting connections. Previously, migrations only ran via the explicit `npm run migrate` CLI step — if a Portainer deployment reused an existing Postgres volume, Docker skipped the container init scripts and the schema was never applied, causing `relation "users" does not exist` errors on every request. The migration run is idempotent (tracked via the `pgmigrations` table), so redeployments do not re-apply completed migrations. If migration fails, the process exits with code 1 so Docker restarts the container rather than serving against a broken schema.

---

## [4.33.0] — 2026-08-31

### Added
- **Frontend setup wizard** (issue #121): Fresh PostgreSQL deploys no longer require running `server/scripts/create-user.js` from the command line. On first boot with an empty database, the login gate automatically switches to a "Create your account" form with a confirm-password field. After successful registration the session is created immediately (no separate login step). The CLI script remains available as a fallback for headless/scripted deployments.
  - `GET /auth/setup-status` — unauthenticated endpoint returning `{ needsSetup: bool }`; rate-limited at 20 requests/15 min.
  - `POST /auth/register` — one-shot unauthenticated endpoint that validates email + 12-char minimum password, atomically inserts the first user (`INSERT ... WHERE NOT EXISTS`), creates the session, and sets `session`/`csrf` cookies; rate-limited at 5 requests/15 min; returns 409 once a user exists.
  - `src/loginGate.js` probes `/auth/setup-status` on load and renders either the setup form or the login form accordingly.
  - New server tests in `server/test/setup.test.js` (positive, negative, boundary, rate-limit, conflict).
  - New Playwright tests in `tests/postgres/test_postgres_setup_wizard.py` using `page.route()` mocks (form rendering, client-side validation, request shape, gate hide on success).

---

## [4.32.0] — 2026-08-31

### Fixed
- **PostgreSQL dialog CSS theming** (issue #120): Login gate (email/password dialog) and Postgres modals now render correctly in light, dark, and high-contrast modes.
  - Defined --bg-primary (page backdrop) and --bg-secondary (card surface) CSS custom properties across all three theme tiers (:root, ody.dark-mode, ody.dark-mode.high-contrast-mode). The login gate CSS was already referencing these variables but they were never declared, causing transparent/invisible backgrounds in all themes.
  - Changed .modal-content from ackground: white to ackground: var(--bg-secondary, #ffffff); color: var(--text-primary), fixing all theme-unaware modals (pgMigrationModal, pgSwitchConfirmModal, calendarDayModal, setupWizardModal, dataTransferModal) in one change.
  - Changed .modal-description and .modal-helper-text to color: var(--text-secondary) instead of hardcoded #6b7280.
  - Added color: var(--text-primary) to .modal-close so the × button is visible in all themes.
  - Added missing .pg-migration-error CSS rule (class was referenced in HTML but had no styles).
  - Added 6 new themed regression tests across 	ests/ui/test_dark_mode.py and 	ests/ui/test_high_contrast_theme.py.

---
## [4.31.0] — 2026-08-31

### Added
- **GitHub Security Scanning** (issue #113): Comprehensive security scanning pipeline added to CI.
  - **CodeQL** (`.github/workflows/codeql.yml`): Static analysis of JavaScript/TypeScript source via GitHub's CodeQL engine. Runs on push/PR to `main` and weekly. Results appear in the GitHub Security tab.
  - **Trivy filesystem scan**: Scans repo source and lockfiles for known-vulnerable packages (CVEs) and secrets. CRITICAL/HIGH fixable findings gate the build. Results uploaded as SARIF to the Security tab under `trivy-fs` category.
  - **Trivy IaC scan**: Scans `Dockerfile`, `server/Dockerfile`, and `docker-compose.yml` for misconfigurations against CIS benchmarks. Informational only (no build gate). Results uploaded as SARIF under `trivy-iac` category.
  - **Dependency Review** (`.github/workflows/dependency-review.yml`): Blocks PRs that introduce new dependencies with HIGH or CRITICAL severity CVEs. Posts a summary comment on the PR.
  - The existing Docker image Trivy scan is unchanged; its SARIF output now uses the `trivy-image` category for clarity in the Security tab.

---
## [4.30.0] — 2026-08-31

### Changed
- **PostgreSQL backend switch confirmation** (issue #110): The one-time confirmation prompt shown when switching storage to PostgreSQL is now a theme-matching modal (#pgSwitchConfirmModal) instead of a browser confirm() dialog. Cancel and Escape both abort the switch; the Continue button is styled as destructive (`btn-danger`). Default focus is on Cancel to protect against accidental keyboard confirmation.

---

## [4.29.0] — 2026-08-31

### Changed
- **Documentation audit**: Comprehensive review and update of all project documentation to reflect the current state of the codebase (v4.29.0).
  - `README.md`: Updated test counts (553 → 675 across 72 files including new Postgres suite), file structure (added `i18n.js`, `loginGate.js`, `storageAdapters.js`, `serviceWorker.js`, `pgMigrationModal.js`, `postgresSync.js`, `postgresImport.js`, `dataTransferModal.js`, `guideNav.js`, `bonusAdvisor.js`, `settings.js`, `locales/`, `server/`), security section (optional Postgres backend with argon2id/CSRF), Quick Start, version footer (was stuck at v4.25.0).
  - `DEPLOYMENT.md`: Fixed nginx base image version (`nginx:1.27-alpine` → `nginx:1.29-alpine`), updated last-updated date.
  - `SECURITY.md`: Added Optional PostgreSQL Backend security section (argon2id, httpOnly cookies, CSRF double-submit), fixed broken audit link (`docs/SECURITY_AUDIT.md` → `docs/audit/security/`), updated Future Improvements to reflect shipped PWA.
  - `ROADMAP.md`: Updated version header (v4.6.1 → v4.29.0) and added gap-note covering all features from v4.7–v4.29.
  - `docs/audit/security/SECURITY_AUDIT.md`: Added Finding 13 — Server-Side Security for optional PostgreSQL backend; updated CSP connect-src and CSRF sections.
  - `docs/audit/test/TEST_SUITE_AUDIT_2026-08-31.md`: New comprehensive test audit replacing the stale June 19 document (324 → 675 tests, 41 → 72 files, all categories updated with current counts).
- **Dependabot** (v4.28.1, same release): `.github/dependabot.yml` added (backported note — actual file landed in v4.28.1 on a parallel branch).

---

## [4.28.1] — 2026-08-30

### Added
- **Dependabot**: Added .github/dependabot.yml to automate dependency update PRs on a weekly schedule. Covers five ecosystems:
  - **npm (root)** — dev tooling: Jest, Stryker, Babel (grouped into one PR)
  - **npm (server/)** — backend: Express, pg, argon2, node-pg-migrate (grouped into one PR)
  - **docker (root)** — frontend nginx base image
  - **docker (server/)** — backend Node.js base image
  - **github-actions** — all workflow action pins (grouped into one PR)
  - Note: Python pip dependencies (playwright, pytest, pytest-asyncio) are installed inline in CI without a requirements file; a requirements.txt would be needed to enable pip tracking.

---

## [4.28.0] — 2026-08-30

### Added
- **Issue #101 — Phase 2c: local->Postgres data migration**: When a user switches to the PostgreSQL backend and logs in for the first time on a fresh server account, the app detects existing localStorage data and presents a one-time migration modal. The modal shows a record summary and offers:
  - **Transfer**: posts all local records to Postgres via 
eplaceForPostgres (accounts first for FK remapping, remaining arrays in parallel, keyed resources, milestones, plan-settings). Clears localStorage.debtTrackerData on success; shows an inline error with a **Try Again** button on failure (Postgres is auto-rolled back).
  - **Skip for Now**: dismisses the modal; local data is preserved and the offer re-appears on the next login as long as Postgres remains empty.
- **One-way Postgres lock**: selecting PostgreSQL in Settings for the first time shows a window.confirm warning that the switch is permanent. After switching, the storage select in Settings is replaced by a read-only note: *You are using PostgreSQL. Switching back to local or session storage is not supported.*

### Technical
- New src/pgMigrationModal.js — modal lifecycle, record-count display, loading/error state, and localStorage cleanup.
- src/app.js init(): after loadFromPostgres, checks localStorage and array emptiness; awaits showPgMigrationModal when migration is needed.
- src/setupWizard.js initSettingsModal: open() hides the storage select and shows the lock note when already on Postgres; save() shows confirm before the first switch.
- src/pgMigrationModal.js added to the service worker precache list (sw.js).
- 8 new integration tests in tests/postgres/test_postgres_migration.py: 4 positive cases (modal shown, transfer, skip, re-prompt) and 4 negative/lock cases (no modal without data, no modal on non-empty Postgres, settings select hidden, confirm dialog shown).

---

## [4.27.0] — 2026-08-30

### Fixed
- **Issue #95**: JSON export/import now works correctly on the PostgreSQL backend.
  - **Export** was already correct (reads in-memory state populated from the server at boot); no change needed.
  - **Import replace mode**: previously `saveToStorage` only PATCHed `/api/plan-settings`, leaving all resource arrays (debts, accounts, incomes, etc.) unwritten to the server — on the next page reload, `loadFromPostgres` silently discarded the import. Import now: (1) wipes all server resources via `pgDeleteAll`, (2) POSTs accounts first to receive server-assigned IDs and builds a `localId → serverId` map, (3) remaps `accountId`/`targetAccountId` FK references across all other resources, (4) POSTs all resource arrays in parallel, (5) PUTs keyed resources (ledger overrides, net-worth snapshots, settings), (6) re-creates milestones, and (7) PATCHes plan-settings. On any failure it rolls back: wipes the partial write and re-POSTs the pre-import snapshot.
  - **Import merge mode**: builds an ID map from existing server accounts (matched by name), POSTs only new (unmatched) records per resource, PUTs keyed resources as upserts, and rolls back only newly created records on failure.
  - **`clearAllData` (pgDeleteAll)**: now also deletes milestones via `DELETE /api/plan-settings/milestones` and resets strategy/payment/stimulus fields on the plan-settings row, preventing them from surviving a full data clear.

### Added
- **Server**: `DELETE /api/plan-settings/milestones` endpoint — removes all net-worth milestones for the authenticated user. Used by the replace-mode import to wipe stale milestones before re-importing.

---## [4.26.0] — 2026-08-30

### Fixed
- **Issue #93**: Expenses silently disappeared after page reload. `addExpense` and `saveEditExpense` stored `expense.date` as a JavaScript `Date` object; `JSON.stringify` serialised it as a full UTC ISO-8601 timestamp (e.g. "2026-08-30T05:00:00.000Z"), which the `sanitizeDateISO` regex (`^\d{4}-\d{2}-\d{2}`) rejected on reload, causing `sanitizeParsedState` to silently drop every expense. Fixed by storing the date as a bare YYYY-MM-DD string. `sanitizeDateISO` also updated to accept full ISO timestamps, self-healing any records already corrupted in localStorage.
- **Issue #92**: `perMonthStimulus` (per-month extra payment schedule in the Strategy tab) was persisted to localStorage but absent from both `exportAllJSON` and `importAllJSON`, silently wiping it on every export/import cycle. Added to the export payload and restored in both import branches. Export `version` field now reads `APP_VERSION` instead of the hardcoded `'4.0.0'`. The "no data" guard in `importAllJSON` widened to accept files with only accounts, savings goals, or reconciliations. Merge mode now deduplicates all name-keyed collections (accounts, incomes, bills, recurring templates, sinking funds) instead of replacing them wholesale.

---
## [4.25.0] — 2026-08-30

### Fixed
- `docker-compose.yml`: Postgres secret file path is now configurable via `POSTGRES_SECRET_FILE` env var (default `./secrets/postgres_password.txt`), fixing Portainer GitOps deployments where the git checkout directory does not contain the gitignored secret file.

### Documentation
- `DEPLOYMENT.md`: new "PostgreSQL Backend Deployment" section covering prerequisites, `setup.sh`/`setup.ps1` first-time bootstrap, HTTPS requirements, Portainer GitOps wiring (including the `POSTGRES_SECRET_FILE` host-path step), update workflow, and bare-Node manual path.
- `server/README.md`: replaced outdated `cp .env.example .env` / `DATABASE_URL` instructions with `setup.sh` quick-start and bare-Node local-dev path; noted that Docker secrets replace `.env` for container deployments.

---
## [4.24.0] — 2026-08-26

### Added
- Deployment secrets automation: `setup.sh` (Linux/Mac) and `setup.ps1` (Windows) generate a cryptographically random Postgres password, write `secrets/postgres_password.txt`, start the Docker stack, run migrations, and prompt to create the first user — all in one command.
- `server/docker-entrypoint.sh`: server container now reads `/run/secrets/postgres_password` at startup and constructs `DATABASE_URL` internally so the database password is never exposed as an environment variable (invisible to `docker inspect`). Falls back to `DATABASE_URL` env var for local dev/test.
- `.env.example` documenting available environment variables for manual/Portainer deployments.
- Error toast (`showPgErrorToast`) surfaced in `src/ui.js` for failed Postgres sync operations, with `.pg-error-toast` styles in `styles-csp-classes.css`.

### Fixed
- Income mutations (`addIncome`) now call `pgPost /api/incomes` and swap the DB-assigned id — income entries were not persisting to Postgres.
- Net-worth snapshot captures now call `pgPut /api/net-worth-snapshots/:date` — snapshots were not persisting to Postgres.
- `docker-compose.yml`: server service mounts the `postgres_password` Docker secret; `DATABASE_URL`/`POSTGRES_PASSWORD` env var removed.
- CI `test-postgres` job uses `docker compose run --rm` for migrations and user creation so they go through the container entrypoint and inherit `DATABASE_URL`.

---

## [4.23.0] — 2026-08-25

PostgreSQL Phase 2b — per-resource mutation wiring. Every add/edit/delete operation in the frontend now persists directly to the Postgres REST API when the Postgres backend is selected. New `src/postgresSync.js` module provides `pgPost`/`pgPatch`/`pgDelete`/`pgPut`/`pgDeleteAll` helpers shared by all 11 feature modules. `addEmergencyFund` handles both create and update paths. `clearAllData` fans out delete-all requests to all 13 resource endpoints. Server adds `DELETE /` to both `crudRouter.js` and `keyedRouter.js` for bulk deletion. See `docs/superpowers/specs/2026-08-24-postgresql-storage-phase2b-design.md`..

---

## [4.22.0] — 2026-08-23

### Added
- PostgreSQL backend option in Settings modal: selecting "PostgreSQL (self-hosted server)" saves the preference and reloads the page
- Full-page `#loginGate` overlay shown before the app shell when Postgres is selected and no valid session exists
- Async app bootstrap: `DebtTrackerApp.init()` (called from an async `DOMContentLoaded` handler) handles session check, login gate, and parallel load from 14 REST endpoints via `Promise.all`
- `getCsrfCookie()` helper in `storage.js` for all authenticated Postgres mutation calls (Phase 2b will use this at every mutation site)

---

## [4.21.0] — 2026-08-23

### Added
- **Self-hosted PostgreSQL storage backend (Phase 1, issue #53)** — a standalone Node.js API (`server/`) with relational tables and granular REST endpoints for every record type, secured by argon2id password hashing and server-side sessions. Opt-in — the browser app's local-only, zero-setup mode is unchanged. Frontend integration (an async storage adapter, login UI, Settings backend picker) is a separate, upcoming Phase 2.

---

## [4.20.0] — 2026-08-18

### Changed
- **Installed PWA now fills the window edge-to-edge** — the standalone app window previously rendered the same centered `.container` card (capped at 1200px, gradient backdrop visible as side gutters) used in a browser tab, which read as "a website" rather than "an app." A new `@media (display-mode: standalone)` rule drops the card's max-width, rounding, shadow, and body padding so content fills the installed window at any size; browser-tab rendering is unchanged.

---

## [4.19.0] — 2026-08-17

### Fixed
- **Clipped tables on narrow/PWA viewports** — the Debt Overview card's category grid and the Reports "Account Balances" (Money Flow) grid used fixed-pixel columns inside an `overflow: hidden` container, so on narrow phone-width viewports the Balance/Projected columns were silently clipped instead of wrapping or scrolling. Both now restack into labelled cards below their breakpoint, matching the pattern already used by `.nw-history-table--compact` and `.var-row`.

### Changed
- **CI now required to merge to `main`** — branch protection requires all 9 CI jobs (tests, security, a11y, mutation testing, Docker build, Trivy, Lighthouse) to pass and the branch to be up to date before a PR can merge.

---

## [4.18.0] — 2026-08-17

### Added
- **Last updated date on debt cards** — every debt card now shows the date it was created or last edited (balance/minimum-payment updates via "Update Balance", and inline edits, both refresh the date). Preserved through export/import like any other debt field. (#88)

### Fixed
- **Stale data after import** — importing a backup now immediately refreshes whichever page you're currently viewing (Accounts, Reports, Ledger, etc.), not just the Debts list, so newly imported data shows up without navigating away and back. (#87)

---

## [4.17.0] — 2026-08-09

### Fixed
- **Version Update** — Updates version.

---

## [4.16.0] — 2026-08-09

### Fixed
- **Stale Chrome releases** — unhashed app-shell files now revalidate online instead of being marked immutable for a year, and the service worker now prefers fresh same-origin responses with offline cache fallback. This prevents older HTML, JavaScript, CSS, manifests, or service workers from keeping visitors on a prior release while preserving offline support. (#83)

---

## [4.15.0] — 2026-08-09

### Added
- **Money Flow Sankey diagram** — new single-month flow visualization on the Reports → Money Flow tab, showing money moving from income sources through the account to bills, expenses, recurring costs, debt minimums, and savings, as hand-drawn inline SVG (no new external dependency — Chart.js remains the app's only one). A Surplus/Shortfall node balances the diagram when income and outflow for the month don't match. (#79)

---

## [4.14.0] — 2026-08-09

### Added
- **Cash Flow Trend chart** — new multi-month (3M/6M/12M) view on the Reports → Money Flow tab, showing Income vs. Outflow per month as bars with a Net balance line overlaid, alongside the existing single-month Money Flow chart. Reuses the ledger-derived per-month totals that already power the Income vs Expenses report, so the two stay consistent. (#76)

---

## [4.13.0] — 2026-08-06

### Added
- **PWA support (installable + offline)** — added `manifest.json`, a root-scoped `sw.js` service worker (app-shell precaching + stale-while-revalidate runtime cache for the Chart.js CDN script), and a generated icon set (`icons/`, via `tools/generate-icons.js`), so the app can be installed to a home screen/desktop and loads with no network connectivity after a first visit. New service worker versions install and wait rather than silently taking over — a dismissible "Reload" banner prompts the user instead. See `docs/superpowers/specs/2026-08-06-pwa-support-design.md` (#75).

---

## [4.12.1] — 2026-08-05

### Fixed
- **CI pipeline failures on Trivy, Lighthouse, and accessibility checks** — the same 3 failures existed on `main` (not caused by prior PRs) and were fixed independently: `Dockerfile` now runs `apk update && apk upgrade` to pick up patched Alpine packages, clearing 11 fixable HIGH Trivy CVEs; `nginx.conf` gzips CSS/JS/JSON/SVG and the Lighthouse CI job now runs against the real `docker compose` nginx container instead of `python -m http.server`, bringing the performance score above the 0.8 minimum; `index.html`/`guide.html` gained `<meta name="description">` tags and the Health page's `data-health-nav` links gained `href="#"` (matching the existing pattern in `forecast.js`), fixing the SEO score that had been masked by the performance failure; a scoped color override for `.rpt-cal-today .rpt-cal-count` fixed a calendar contrast regression.

---

## [4.12.0] — 2026-08-05

### Changed
- **Consolidated Export/Import into a Backup & Restore modal** — the toolbar's separate ⬇️ Export / ⬆️ Import icon buttons are now one `#dataTransferBtn` button that opens a two-tab modal (Export / Import). `#exportJsonBtn`/`#importJsonBtn`/`#importJsonInput` kept their ids and behavior, just relocated. Import's feedback (invalid file, no recognisable data, file too large, read error, and the Replace-vs-Merge choice) moved from native `alert()`/`confirm()` popups into inline modal UI, styled with the existing `.target-result` success/warning/error banner pattern. See `docs/superpowers/specs/2026-08-05-data-transfer-modal-design.md`.

---

## [4.11.0] — 2026-08-04

### Changed
- **Theme selector moved into Settings (#71)** — the Light/Dark/High Contrast `<select>` no longer lives in the always-visible header toolbar; it's now the first control inside the Settings modal (⚙️ gear icon), grouped with Data Storage and Language. Its `id` (`themeSwitcher`), change-applies-immediately behavior, localStorage persistence, and the command palette's "Cycle theme" action are all unchanged — only its location moved. Translated strings moved from `toolbar.theme*` to `settings.theme*` in `src/locales/{en,es,pl}.js`.

---

## [4.10.0] — 2026-08-04

### Added
- **i18n infrastructure + Spanish/Polish pilot (#35)** — new `src/i18n.js` module (`t()` lookup with English fallback, `applyStaticTranslations()` for static markup, locale persisted under `debtTrackerLocale`) and `src/locales/{en,es,pl}.js` dictionaries. Navigation, the toolbar, the Settings modal, and the Health dashboard are translated into Spanish and Polish, selectable from a new Language control in Settings. `formatCurrency`/`formatShortDate`/`formatMonthYear` now format numbers/dates per the active locale everywhere in the app, not just the translated pages.

### Known limitations
- Only nav/toolbar/Settings/Health are translated — Accounts, Income, Liabilities, Recurring, Savings, Plan, Reports, Ledger, and Reconcile remain English pending follow-up issues.
- No grammatical pluralization — every translated string uses one fixed form regardless of count (e.g. Polish would grammatically need a different word form for 1 vs. 2-4 vs. 5+ months).
- No browser-language auto-detection on first run; the locale defaults to English until a user explicitly picks one in Settings.

---

## [4.9.0] — 2026-08-03

### Added
- **High Contrast theme (#33)** — the header's Light/Dark toggle is now a labeled 3-way selector (Light / Dark / High Contrast). High Contrast is built as Dark Mode plus extra overrides (`body.dark-mode.high-contrast-mode` in `styles.css`), so it inherits dark mode's existing surface colors and chart/gauge color logic, then swaps the ~20 shared CSS custom properties and a handful of known hardcoded-color spots (buttons, calendar pills, header/nav/inputs/tables, focus ring) to a pure black/white/bright-accent palette clearing WCAG AA (and mostly AAA) contrast. `guide.html`/`guide.css` pick up the same theme. The command palette's theme action now cycles Light → Dark → High Contrast.

### Fixed
- **`.nav-group-label` contrast (#33)** — the "Overview"/"Manage"/"Analyze" nav pills used translucent-white-on-translucent-white styling whose real contrast depended on the header gradient behind them; measured at ~2.9:1 in light mode against WCAG 1.4.3's 4.5:1 minimum (and intermittently flagged `pytest tests/a11y/` at other ratios due to a CSS-transition-timing artifact in the audit script). Redesigned as a solid dark badge with near-opaque text, which composites to ~6.8:1 (light) / ~12.7:1 (dark) regardless of theme.

### Known limitations
- High Contrast reuses dark mode's several hundred other component-specific hardcoded-color overrides as-is rather than giving each a bespoke high-contrast pass — see the scope note in `styles.css` above the `body.dark-mode.high-contrast-mode` block.

---

## [4.8.1] — 2026-08-03

### Fixed
- **Summary Report mobile table scroll (#31)** — the Reports → Summary tab's Cash Flow, Account Balances, and Net Worth tables shared the `.nw-history-table` class (and its 680px `min-width`) with genuinely wide tables like Net Worth History and Cash Flow Forecast, forcing an unnecessary horizontal scrollbar on mobile even though they only have 2–4 narrow columns. They now opt out via a new `.nw-history-table--compact` modifier and restack into label/value cards below 640px width, while the wider report tables keep their original scroll-in-wrapper behavior.

---

## [4.8.0] — 2026-08-02

### Added
- **Bonus Advisor (#64)** — one-time bonuses can now be tagged with a Purpose (Cash Flow or Long-term Savings), shown as a badge in the bonus list. A new "What should I do with this?" button computes real numbers for each option: interest saved and months-sooner debt payoff (via the existing `DebtCalculator` stimulus mechanism) vs. projected 1-year/5-year growth (via the existing account-interest helper) if left in a linked interest-bearing account. The Cash Flow card also includes a "Pay Off Debts Now" plan — which debts the bonus can eliminate outright (smallest balance first) plus any remainder applied to the highest-rate debt remaining — showing how much monthly cash flow frees up immediately, as a deliberately non-interest-optimal alternative to the avalanche/snowball result above it. New `src/bonusAdvisor.js` module; `purpose` added to the bonus record and sanitized in `src/sanitizers.js`. See `docs/superpowers/specs/2026-08-02-bonus-advisor-design.md`.
- **Interest-rate filters** — the Debts list toolbar gains an "Interest" dropdown (Any / Interest Bearing Only / No Interest Only, by actual APR) next to the existing category filter, and the Bonus Advisor's "Pay Off Debts Now" plan gets a matching filter to narrow which debts it considers.

---

## [4.7.3] — 2026-08-02

### Added
- **Stryker.js mutation testing (#52)** — new dev-only Jest + Stryker toolchain (`package.json`, `stryker.config.mjs`) mutation-tests the pure `src/debtCalculator.js`, `src/utils.js`, and `src/sanitizers.js` functions covered by new `tests/unit/*.test.js`. `stryker.config.mjs`'s `mutate` scope uses line ranges limited to the tested functions (a whole-file scope produced a ~22% score dominated by untested-function no-coverage mutants); the resulting real local score (47.04%) sets the `thresholds` (`low: 47`, `break: 37`, `high: 52`). Wired into a new `mutation-testing` CI job. See `docs/superpowers/specs/2026-08-02-stryker-js-mutation-testing-design.md` and `docs/superpowers/plans/2026-08-02-stryker-js-mutation-testing.md`.

---

## [4.7.2] — 2026-07-29

### Added
- **CI workflow (Story #57)** — `.github/workflows/ci.yml` runs pytest by category (security/feature/ui/integration), a Docker build, a Trivy image scan, and a Lighthouse audit (`lighthouserc.json`) on every push/PR. See `docs/superpowers/specs/2026-07-28-github-actions-ci-workflow-design.md` and `docs/superpowers/plans/2026-07-28-github-actions-ci-workflow.md`.
- **README CI/Docker badges** — CI, Copilot review, and Docker release status badges added to `README.md`.

### Fixed
- **CI reliability** — headless Chrome now launches with `--no-sandbox` under CI's containerized runner; the Docker base image was bumped to resolve known CVEs; the pytest job's broken pip cache was removed, `@lhci/cli` pinned to a real published version, server-readiness detection fixed, job timeouts added, and SARIF upload guarded so it doesn't fail on fork PRs (which don't have upload permissions).

### Changed
- **Docker image renamed** from `bookwheel` to `myfinances` in `docker-image.yml` to match the project name.

_Note: `4.7.1` was a version-only commit with no accompanying changes and has no changelog entry — see [#59](https://github.com/jasonkryst/MyFinances/issues/59)._

---

## [4.7.0] — 2026-07-17

### Changed
- **Internal src/ reorganization** — split six oversized modules (`reports.js`, `strategy.js`, `ledger.js`, `debts.js`, `storage.js`, `app.js`) into 15 new focused files (`sanitizers.js`, `dataExport.js`, `ledgerTransactions.js`, `ledgerOverrides.js`, `strategyPlanCalculation.js`, `strategyCalendar.js`, `strategyComparison.js`, `strategySummaryTable.js`, `strategyScheduleTable.js`, `debtBreakEven.js`, `reportsNetWorth.js`, `reportsCalendar.js`, `reportsCashFlow.js`, `reportsVariance.js`, `reportsSummary.js`), and consolidated a dozen instances of copy-pasted logic into shared helpers in `utils.js` and `accounts.js` (date formatting, `escapeHtml`, currency formatting, account-type icons, account `<option>`-list building, and a `recalculatePaymentPlan` helper unifying five near-duplicate payment-recalculation blocks). Fixed a real timezone-rollback bug found during the date-formatter consolidation (some copies padded bare `YYYY-MM-DD` strings before formatting and some didn't, which could render the wrong day near UTC midnight). Two misplaced functions moved to their correct modules (`switchLiabilitiesSubTab` to `ui.js`, an income-record migration to `storage.js`), and dead code removed (`app.js` compatibility shims, a defensive `formatCurrency` fallback with no live path). Pure refactor — no user-facing behavior change; see `docs/superpowers/specs/2026-07-16-src-reorganization-design.md` and `docs/superpowers/plans/2026-07-16-src-reorganization.md`.

---

## [4.6.1] — 2026-07-15

### Fixed
- **Ledger running-balance summation bug (#46)** — same-date rows (a "Balance Rollover" marker landing on the same day as that month's own transaction, two same-day real transactions, or a reconciliation sharing a date with either) could display in an order that didn't match the true running-balance chain. The tie-break lived only in `getLedgerTransactions`'s own fixed descending sort and used a type-priority heuristic (rollover/reconciliation always last); the actual on-screen order comes from `getFilteredSortedLedgerTransactions`'s separate sort, which had no tie-break at all and simply preserved whatever order rows arrived in — correct by accident under the default descending view, but visibly wrong under ascending (a $0.00 rollover row could appear to silently shift the balance by the amount of an adjacent transaction). Replaced the heuristic with a `_seq` field recording the true order each row's balance was computed in, and made the display sort break same-date ties by `_seq` in the same direction as the primary date sort. Added 7 tests (`tests/features/test_ledger.py`) covering the rollover/transaction collision, plain same-day real-transaction ties, a three-way rollover+bill+reconciliation collision, overrides applied to a colliding transaction, and multi-account independence — each verified in both ascending and descending sort.

---

## [4.6.0] — 2026-07-14

### Added
- **Storage abstraction layer (#41)** — `storage.js` now persists through a swappable adapter (`src/storageAdapters.js`) instead of calling `localStorage` directly. Users can choose Local Storage (default, persists across visits) or Session Storage (cleared when the tab closes) from the Settings modal; switching migrates existing data into the new backend and clears the old copy. The adapter interface stays synchronous by design — a documented seam for a future async backend (e.g. IndexedDB) exists but isn't implemented in this change. See `docs/superpowers/specs/2026-07-14-storage-abstraction-design.md`.

---

## [4.5.0] — 2026-07-14

### Fixed
- **Spending report UI tests (#43)** — `tests/ui/test_spending_ui.py` and `tests/ui/test_chart_accessibility.py::test_spending_charts_have_sr_tables` seeded expense fixtures with a hardcoded `2026-06` date; since `renderReportsSpending()` derives "this month" from the live system clock, the fixtures silently fell out of range once the wall clock passed June, leaving the Spending tab in its empty state for 7 tests. Added a `current_month_iso()` test helper (`tests/conftest.py`) and seed expense dates against the real current month instead

---

## [4.4.1] — 2026-07-15

### Added
- **10 Playwright tests** (`tests/features/test_accounts.py`) — dedicated Accounts-page coverage for the interest-rate APY badge introduced in 4.4.0 (#45): threshold boundary (0.01% shows, 0.009% doesn't), whole-number and max-rate (100%) formatting, per-card scoping across multiple mixed-rate accounts, badge removal on edit-to-zero, reload persistence, and import-clamped/invalid-rate display

### Changed
- Synced `README.md` and `tests/README.md` test counts/file listings with actual suite state (497 tests / 54 files); both had drifted since 4.3.0

---

## [4.4.0] — 2026-07-14

### Added
- **Interest Income (#30)** — accounts can now carry an annual interest rate (% APY). Non-zero rates auto-generate a monthly *Interest* deposit in the Ledger on the last day of each month, computed as APY ÷ 12 on the account's projected end-of-month balance and compounding month over month. Interest rows support the existing ledger amount override, and an overridden (true) amount feeds subsequent months' compounding. Interest counts as income in Reports (stat strip, income-by-source chart, month-over-month summary, summary metrics, calendar, and net-worth snapshot income). Zero/negative-balance months and sub-cent amounts generate nothing; debt-side interest remains modeled in the Debts module
- **Accounts UI** — Interest Rate (% APY) field on the Add Account form and inline edit card; accounts with a rate show a 📈 APY badge
- **23 Playwright tests** (`tests/features/test_interest_income.py`, `tests/features/test_storage_import.py`, `tests/integration/test_interest_income_workflow.py`) — engine math, compounding (ledger and Cash Flow Forecast), override feedback, last-day posting, projection-only persistence, negative/zero/sub-cent skips, accounts UI CRUD, reports integration (stat strip and summary metrics), import sanitization (clamping −5 → 0, 200 → 100, junk → 0, round-trip), and an end-to-end workflow

---

## [4.3.2] — 2026-07-01
### Fixed
- **Dark Mode Support** - Fixes issues with dark mode theme colors across various parts of the app.

## [4.3.1] — 2026-07-01
### Fixed
- **Modal Dialog** - Fixes issues with dark mode theme colors.

## [4.3.0] — 2026-06-30

### Added
- **Break-Even Analysis per Debt** — each credit-card debt card now shows a Payoff Analysis badge comparing your plan payment to minimum-payment-only: months to payoff, total interest, months saved, and interest saved; no-plan state shows a minimum-only estimate with a clear banner
- **Min-type toggle** — switch the minimum-payment scenario between Fixed (constant minimum) and % of Balance (recalculated each month) directly on the badge; updates live without page reload
- **Mini payoff chart** — Chart.js line chart on each debt card showing balance decay over time for both scenarios; fully accessible via a companion screen-reader data table
- **Accelerate modal** — "Accelerate this debt →" button opens a modal with a live extra-payment preview: type an amount and instantly see new payoff date, interest saved, and a comparison chart; "Apply to Plan" navigates to the Plan page with the new total pre-filled
- **Interest Saved / Months Saved columns** — two new sortable columns in the Plan page Debt Summary table showing per-debt savings vs. minimum-only; `fixedAmount` debts show `—`; footnote explains the comparison baseline
- **13 Playwright tests** (`tests/features/test_break_even.py`) — 8 positive + 5 negative/edge cases covering badge no-plan state, plan-active auto-render, min-type toggle, accelerate modal open/preview/apply, plan table columns, fixed-amount exclusion, 0% APR, balance=minimum, invalid percent, $0 extra, negative extra

### Fixed
- Dark mode contrast for `.break-even-show-link` (blue-400 `#60a5fa`), `.break-even-savings--positive`, `.be-col-saved`, and `.accelerate-preview-delta` (green-400 `#4ade80`) — matches the established dark mode color palette

---

## [4.2.1] — 2026-06-28

### Changed
- Reorganized README: removed three duplicate sections (Security & Compliance, Data Privacy & Security, stale Testing brief), extracted version history to dedicated `CHANGELOG.md`, expanded Features section with Navigation/Accessibility, Health Dashboard, Reconciliation, and Ledger sub-sections, updated all test counts to 452/51 files
- Created `CHANGELOG.md` — version history from v3.0 through v4.2.0 in Keep a Changelog format; README now links to it instead of growing inline
- Updated `ROADMAP.md`: added v4.2.0 entry, corrected release schedule from v3.x to v4.3/v4.4/v5.x, expanded Tier 5 with guide content audit and Savings Goals scope note
- Updated `tests/README.md`: 344→452 tests, 11 new test files added to directory listing and coverage matrix
- Created `docs/README.md`: index for the `docs/` folder describing audit, superpowers, and implementation subdirectories
- Saved full test-suite audit report `docs/audit/test/TEST_REPORT_2026-06-28.md` (452/452 passed, all June 19 coverage gaps closed)

---

## [4.2.0] — 2026-06-28

### Fixed
- Ledger running balance now snaps to the authoritative statement balance on reconciliation marker rows when "Reconciliation Adjusts Balance" mode is active, so all subsequent rows project forward from the correct value
- Added a sort tiebreaker so synthetic rows (rollover markers, reconciliation markers) always appear below same-date real transactions in newest-first view, eliminating confusing balance jumps from unstable ordering

### Added
- Inline ℹ info icon on every reconciliation marker row in the Ledger: muted-grey when the reconciliation mode is "Visible only" (informational), primary-blue when "Adjusts Balance" (balance-snapping active); tooltip explains current behaviour and references the setting by name; keyboard-accessible via `tabindex`

---

## [4.1.0] — 2026-06-24

### Added
- Print / Save as PDF button on Liabilities, Recurring, Plan (Strategy), Savings, Ledger, and Reconcile pages — completing the print-friendly rollout across every page; `@media print` rules hide forms and controls so only read-only data content prints

### Fixed
- Five tables in Reports, Reconciliation, and Ledger were not wrapped in `.table-wrapper`, causing columns to be cut off on narrow mobile viewports; now consistently wrapped in the horizontal-scroll pattern

---

## [4.0.0] — 2026-06-21

### Added
- Reconciliation marker rows now appear on the unified Ledger for full transparency, regardless of reconciliation mode
- Reconciliation Mode setting — **Adjust Balance** (reconciliation mutates `startingBalance` going forward) vs. **Visible Only** (recorded and shown on ledger, does not change the tracked balance); changeable any time via the Settings modal (⚙ gear icon or command palette)
- First-run setup wizard asks new users to choose their reconciliation mode once; existing users default silently to Visible Only
- Extensible `app.settings` array backed by `src/settings.js`; storage format bumped to `"4.0.0"` with round-trip sanitization
- Reports Calendar day cells now show compact dot-count indicators; clicking or pressing Enter/Space opens a `#calendarDayModal` with the full event list (icon, name, amount) at every viewport width
- Print / Save as PDF button added to Health, Accounts, Income, and Reports pages

---

## [3.9.0] — 2026-06-20

### Added
- Command palette (Ctrl/Cmd+K or toolbar 🔍 button) — fuzzy-filters across all 10 pages plus common actions (export/import JSON, toggle dark mode, calculate plan); Arrow-key navigation, Enter to activate, Escape restores prior focus; full `role="dialog"` / `role="listbox"` ARIA semantics (`src/commandPalette.js`)
- `prefers-reduced-motion` support — global CSS media query collapses all transitions and animations to near-instant; `Chart.defaults.animation` disabled app-wide when the OS preference is set
- Screen-reader `.sr-only` data-table fallback for all chart groups (Health gauges, Spending pie/bar, Forecast line, Net Worth trend); built by `renderChartDataTable()` in `src/utils.js` and rebuilt on every chart re-render
- localStorage quota monitoring — every save estimates the serialized payload against a conservative 5 MB limit and shows a dismissible soft-warning banner above ~80% usage; a hard-failure banner fires if `setItem` actually throws (quota exceeded)
- Test suite expanded from 344 → 365 tests / 41 → 45 files, zero regressions

### Fixed
- Unclosed Markdown code fence in README Quick Start was swallowing the entire Security & Privacy section into the code block

---

## [3.8.0] — 2026-06-19

### Added
- Regression tests for inline-edit negative-amount validation paths (`saveEditIncome`, `saveEditBonus`) — the underlying fix shipped in v3.7.0 but these two paths lacked dedicated test coverage; now closed (`test_edit_income_negative_amount_rejected`, `test_edit_bonus_negative_amount_rejected`)
- Test suite: 344 tests / 41 files

---

## [3.7.0] — 2026-06-19

### Fixed
- Negative-amount validation bypass in Income (`addIncome`, `saveEditIncome`, `addBonus`, `saveEditBonus`) and Fixed-Amount Debt (`addDebt`) forms — `sanitizeFiniteNumber(raw, NaN, {min: 0.01})` was clamping negative input up to `0.01` rather than to the NaN fallback, so the subsequent `amount <= 0` guard never fired; fixed by validating the raw string before clamping, matching the existing `bills.js` / `recurring.js` pattern
- Exception messages rendered via `innerHTML` in `src/ui.js` were not passed through `escapeHtml()`; now wrapped for defense-in-depth consistency with `src/strategy.js`
- Added a contract comment to `src/accounts.js` documenting that callers of the `innerHTML` option-list helper must pre-escape values via `escapeHtml()`

### Changed
- `tests/debug/` relocated to `tools/debug/` so the `tests/` tree contains only pytest-collected tests
- Test suite: 342 tests / 41 files

---

## [3.6.0] — 2026-06-17

### Fixed
- CSP violation: `connect-src` now allows `https://cdn.jsdelivr.net` (Chart.js sourcemap fetch) in both `index.html` meta tag and `nginx.conf` header
- `guide.html` inline `<script>` and `<style>` blocks externalized to `src/guideTheme.js` and `guide.css` for production CSP compliance (nginx's `Content-Security-Policy` header blocked inline scripts, unlike the `<meta>` tag)

### Added
- Static test asserting `index.html` CSP meta tag and `nginx.conf` CSP header remain in sync — catches this class of divergence automatically going forward
- Bills data-model test coverage (`tests/features/test_bills.py`)
- CSV schedule export tests in `tests/integration/test_workflows.py`
- Test suite expanded from 140 → 264 tests / 38 files

---

## [3.5.0] — 2026-06-16

### Added
- Spending Analysis tab in Reports (`src/spending.js`) — doughnut pie chart of all outflows for the selected month, 6-month stacked bar trend (current month at full opacity, prior 5 at reduced), ranked category list with month-over-month % change badges, drill-down modal with individual transactions per category; `.sr-only` screen-reader data tables for both charts via `renderChartDataTable()`
- Main navigation redesigned into three labeled groups — **Overview** (Health, Accounts, Income), **Manage** (Liabilities, Recurring, Savings, Plan), **Analyze** (Reports, Ledger, Reconcile) — with active-group highlighting, `aria-current`, keyboard reachability, and hamburger menu on ≤768px
- Reports navigation redesigned with a sticky, grouped tab bar replacing the previous flat row

---

## [3.4.0] — 2026-06-13

### Added
- Account Reconciliation tool (`src/reconciliation.js`) — Reconcile page with per-account statement balance entry, live colour-coded difference, "Expected transactions since {date}" listing, and history log recording previous → statement balance, difference, date, and an optional note; per-entry delete (does not revert balance)
- "🔄 Reconcile this account" quick-modal on the Ledger page when a single account is selected; Escape/Enter keyboard handling
- `app.reconciliations` round-trips through localStorage and JSON export/import with sanitization; orphaned entries (account deleted later) render as "Unknown account" rather than crashing

---

## [3.3.0] — 2026-06-10

### Added
- Cash Flow Forecast tab in Reports (`src/forecast.js`) — selectable 1/2/3/6/12 month horizon; "Total Cash Position" (all asset-type accounts) or per-account view; summary stats (current/lowest/highest projected balance); line chart with red lowest-month and green highest-month highlights, line turns red for any negative month-end balance; notable-month detection flags months whose outflow exceeds a configurable threshold (default 130% of average) with their top 3 drivers; negative-balance warning banner
- Intra-month dip detection — walks each month's transactions chronologically to find the true lowest balance mid-month (e.g. rent due before a paycheck arrives); surfaces warning banners, updates the "Lowest Projected" stat to the intra-month low with its date, and flags table rows even when the month ends positive
- Forecast settings (horizon, account, notable-month threshold) persisted to localStorage and JSON export/import

---

## [3.2.0] — 2026-06-14

### Added
- Debt Payoff Date display on every debt card — `📅 Payoff Date` row sourced from the plan calculation; shows "Run a plan to see" hint until a plan is calculated
- Recurring Template "Mark as Paid This Month" toggle — `paidMonths` array per template (mirrors `skippedMonths`); distinct from Skip (paid = occurred, skip = suppressed); resets each calendar month; round-trips through export/import

---

## [3.1.0] — 2026-06-08

### Added
- Financial Health Dashboard (`src/health.js`) — app's default landing page with six metric cards: Debt-to-Income Ratio (Chart.js doughnut gauge, Healthy/Moderate/High Risk badge), Savings Rate, Emergency Fund Runway, Debt Payoff Timeline, Monthly Cash Flow (Surplus/Break Even/Deficit), Budget Allocation; internal nav links route to relevant pages
- Net Worth Tracker — monthly snapshots with month-level upsert (auto on page load, manual capture button); historical trend chart (3/6/12 month range selector); Net Worth vs. Liabilities chart; Asset Growth vs. Debt Reduction chart; snapshot history audit table; milestone celebration toasts at +$5K net worth increments from the first snapshot; Accounts widget showing current net worth and change from prior snapshot
- Multi-account ledger: items without an account link route to a sentinel bucket and appear in report-wide aggregations but are excluded from per-account ledger views
- Import now preserves account IDs so all `accountId` cross-references remain valid after a full restore
- Reports aggregations now include items not linked to any account (previously only linked items were counted)
- Test suite: 22 new tests covering Health Dashboard (feature, security, integration)

---

## [3.0.0] and earlier

Core feature set: debt management (credit cards + fixed-amount recurring), account management with projected balances, income tracking (bi-weekly + monthly sources, one-time entries), budget tracking (bills + variable expenses), recurring transaction templates (subscriptions, reimbursements, transfers), savings goals (emergency fund + sinking funds with three allocation methods), unified ledger with amount overrides, calendar + reports (income vs. expenses, money flow, variance dashboard, net worth), debt payoff plan calculator with four strategies (Avalanche, Snowball, Priority-Low, Priority-High), what-if slider, target payoff date back-calculator (binary search), interest paid to date estimate, JSON export/import (legacy v1.0 + current v4.0.0 format), CSV schedule export, dark mode, in-app guide (`guide.html`), strict Content Security Policy.
