
# Changelog

All notable changes to MyFinances are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
Detailed specs and implementation notes live in [`docs/superpowers/`](docs/superpowers/).

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
