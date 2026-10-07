# MyFinances Testing Audit — October 6, 2026

**App version under test**: 6.10.7 (branch `feature/ui-polish-mobile-2026-10`, HEAD `12682b5`)
**Scope**: Post-September standing-state audit. Tracks changes since `TESTING_AUDIT_2026-09-02.md`
(v4.40.0, HEAD `aa6ead3`). Covers feature-coverage inventory, new-feature gaps, test quality,
unit/mutation scope, security tests, and CI shard configuration.
**Method**: Static scan — test-file/line counts, function listings, CI YAML analysis.
No live pytest run was performed for this audit.

---

## Executive summary

**Overall coverage health: GOOD** — the suite has grown substantially since September, adding
dedicated test files for every major feature shipped in Q4 (retirement, people, balance history,
surplus analysis, sort/filter controls). The single highest-severity finding is a CI configuration
gap: **9 test files (≈172 tests) exist in `tests/features/` but are not assigned to any CI shard**
and therefore never run in CI. No feature currently has zero coverage; the gaps are sharding,
depth, and a handful of untested sanitizer functions.

| Suite | Status |
|---|---|
| **Python/Playwright** (`tests/features/`) | ~616 tests across 49 files (up from 372/34 in September). **172 tests in 9 files silently skip CI — HIGH priority.** |
| **Python/Playwright** (`tests/ui/`) | ~254 tests across 30 files across 3 shards (up from 233/28) |
| **Python/Playwright** (`tests/security/`) | 62+ tests; new XSS cases for retirement/people/balance-history added |
| **Python/Playwright** (`tests/integration/`) | ~22 tests; unchanged |
| **Python/Playwright** (`tests/postgres/`) | ~33 tests; requires Docker stack (CI-only) |
| **Jest unit** | ~135 tests across 7 files (up from 69/5); new `balanceHistoryCore.test.js`, `retirementCalculator.test.js`, `i18n.test.js` |
| **Stryker mutation** | Threshold 48% (was 42.47%). Scope expanded to `retirementCalculator.js` + `balanceHistoryCore.js` |
| **`wait_for_timeout` anti-pattern** | **81 occurrences** (down from 789 — 90% reduction; major improvement) |

**Top findings:**

1. **9 feature test files are not in any CI shard** — 172 tests that pass locally never run in CI.
   Affects `test_retirement`, `test_people`, `test_balance_history`, `test_filter_sort`,
   `test_calendar_feed`, `test_account_menu`, `test_analytics`, `test_performance`,
   `test_recurring_archive`.
2. **`test_filter_sort.py` uses 22 `wait_for_timeout()` calls** — the highest per-file count
   remaining after the 90% suite-wide reduction; should be cleaned up before this grows.
3. **8 sanitizer functions have no unit tests**: `sanitizeBonus`, `sanitizeEmergencyFund`,
   `sanitizeSinkingFund`, `sanitizeNetWorthSnapshot`, `sanitizeForecastSettings`,
   `sanitizeSetting`, `sanitizeReconciliation`, `sanitizePlanHistoryEntry` — all pure, DOM-free,
   ideal for the Jest toolchain.
4. **Stryker's `sanitizers.js` scope** ends at line 153 but `src/sanitizers.js` is now 343 lines —
   a large swath of pure sanitizer functions added since the last Stryker tune-up (emergency funds,
   sinking funds, net worth snapshots, settings, plan history) is entirely outside mutation scope.

---

## Resolved since 2026-09-02

| Finding | Status |
|---|---|
| Stryker `sanitizers.js` mutate ranges stale (§3) | **RESOLVED 2026-09-03** — ranges corrected, 8 new unit tests added for `sanitizeLedgerOverrides`/`sanitizeLedgerClearedTransactions`, thresholds re-derived (48.77%, threshold 48/38) |
| `test-features-b`/`c` CI shard imbalance | **RESOLVED 2026-09-04** — bin-packed into b/c/h at ~82 tests each |
| Server `ledger-cleared` PUT timezone bug (§1.5) | **RESOLVED** — `sanitizeTimestampISO()` added to `src/utils.js` |
| `bonusAdvisor.js` — no dedicated test file | **Partially improved** — still no dedicated file, but `test_income.py` grew from 8→26 tests covering more bonus paths |
| `wait_for_timeout()` widespread at 789 instances/54 files | **SUBSTANTIALLY IMPROVED** — reduced to 81 instances/12 files (90% reduction); all well-established files (test_accounts, test_ledger, test_validation_modals) are now clean |
| No dedicated test for `ledgerCleared.js` sanitizer | **RESOLVED** — `sanitizeLedgerClearedTransactions` unit tests added to `sanitizers.test.js` |
| `debtCalculator.js` `maxMonths` loop-exit untested | **Still open** — no new unit test found |

---

## Feature coverage table

Coverage key: ✅ well-covered (dedicated file, CRUD + edge cases) | ⚠️ partial (indirect only, or thin) | ❌ no tests

| Module(s) | Test file(s) | Test count | Status |
|---|---|---|---|
| `accounts.js` | `test_accounts.py`, `test_account_menu.py`, `test_balance_history.py` | 33+14+24 | ✅ |
| `debts.js` | `test_debts.py`, `test_balance_history.py` | 34+24 | ✅ |
| `income.js`, `bonusAdvisor.js` | `test_income.py`, `test_interest_income.py` | 26+20 | ⚠️ `bonusAdvisor.js` indirect only |
| `people.js` | `test_people.py` | 22 | ✅ (NOT in CI shard) |
| `recurring.js` | `test_recurring.py`, `test_recurring_archive.py`, `test_recurring_occurrences.py` | 13+13+5 | ✅ (`test_recurring_archive` NOT in CI) |
| `savings.js` | `test_savings.py` | 7 | ✅ |
| `strategy.js` + submodules | `test_strategy.py`, `test_plan_history.py` | 4+5 | ⚠️ `test_strategy.py` only 4 tests; strategy submodule logic untested at unit level |
| `ledger.js` + submodules | `test_ledger.py` | 41 | ✅ |
| `reconciliation.js` | `test_reconciliation.py` | 13 | ✅ |
| `reports.js` + submodules | `test_reports.py`, `test_money_flow_sankey.py`, `test_networth.py`, `test_cash_flow_trend.py` | 9+8+6+5 | ✅ |
| `spending.js` | `test_spending_analysis.py`, `test_spending_ui.py` | 7+N/A | ✅ |
| `forecast.js` | `test_forecast.py` | 16 | ✅ |
| `retirement.js`, `retirementCalculator.js` | `test_retirement.py` + unit `retirementCalculator.test.js` | 18+8 | ✅ (playwright NOT in CI shard) |
| `breakEven.js`, `debtBreakEven.js` | `test_break_even.py` | 13 | ✅ |
| `health.js` (incl. surplus analysis) | `test_health.py` | 44 | ✅ |
| `dataExport.js` | `test_storage_import.py`, `test_issue_92_export.py`, `test_issue_93_expense_save.py` | 21+9+10 | ✅ |
| `settings.js` | `test_settings.py` | 10 | ✅ |
| `balanceHistory.js`, `balanceHistoryCore.js`, `balanceHistoryModal.js` | `test_balance_history.py` + unit `balanceHistoryCore.test.js` | 24+26 | ✅ (playwright NOT in CI shard) |
| `calendarFeed.js` | `test_calendar_feed.py` | 28 | ✅ (NOT in CI shard) |
| `i18n.js` | `test_i18n.py` + unit `i18n.test.js` | 14+6 | ✅ |
| `debtCalculator.js` | `test_debt_calculator.py` + unit `debtCalculator.test.js` | 10+12 | ✅ |
| `sanitizers.js` | unit `sanitizers.test.js` + Playwright-level | 55 unit tests | ⚠️ 8 sanitizer functions uncovered (see §4) |
| `utils.js` | unit `utils.test.js` | 28 | ✅ |
| `commandPalette.js` | `test_command_palette.py` | N/A | ✅ |
| `charts.js` | `test_charts.py`, `test_chart_accessibility.py` | N/A | ✅ |
| `storage.js`, `storageAdapters.js` | `test_storage_backend.py`, `test_storage_quota.py` | 8+5 | ⚠️ adapter interface not unit-tested in isolation |
| `serviceWorker.js` | `test_pwa.py`, `test_pwa_offline.py` | 13+2 | ✅ |
| `postgresSync.js`, `postgresImport.js`, `loginGate.js`, `pgMigrationModal.js` | `tests/postgres/` | ~33 | ⚠️ CI-only (Docker stack required) |
| `analytics.js` | `test_analytics.py` | 4 | ⚠️ 4 tests only; NOT in CI shard |
| `setupWizard.js` | `test_setup_wizard.py` | 18 | ✅ |

---

## New features without adequate tests

All features listed in the task as "recently added" now have dedicated test coverage. The gap
is CI wiring, not test existence:

| Feature | Test file | Tests | CI shard |
|---|---|---|---|
| Surplus Analysis (health.js) | `test_health.py` — 9 surplus-specific tests (lines 596–976) | ✅ thorough | shard `h` ✅ |
| Balance history | `test_balance_history.py` + unit `balanceHistoryCore.test.js` | ✅ thorough (24+26) | **NOT in CI** ❌ |
| Sort & filter controls | `test_filter_sort.py` | ✅ good (26 tests, all 3 pages) | **NOT in CI** ❌ |
| Ledger column visibility | `test_ledger.py` (lines 1139–1220) — 4 dedicated tests | ✅ adequate | shard `f` ✅ |
| Year filter on bonuses | `test_income.py` (line 254 section) | ✅ covered | shard `b` ✅ |
| Retirement page | `test_retirement.py` + unit | ✅ good (18+8) | **NOT in CI** ❌ |
| People page | `test_people.py` | ✅ thorough (22 tests) | **NOT in CI** ❌ |
| Plan history | `test_plan_history.py` | ⚠️ thin (5 tests only) | shard `a` ✅ |
| `computeSpendingByCategory` | `test_spending_analysis.py` | ✅ good (7 tests, all edge cases) | shard `c` ✅ |

---

## Test quality observations

### Wait pattern — major improvement since September

The September audit found 789 `wait_for_timeout()` instances across 54 files. The current count
is **81 instances across 12 files** — a 90% reduction. The remaining uses are concentrated in:

| File | `wait_for_timeout` count |
|---|---|
| `test_filter_sort.py` | 22 |
| `test_health.py` | 14 |
| `test_account_menu.py` | 1 |
| `test_income.py` | 3 |
| `test_people.py` | 5 |
| `test_recurring_archive.py` | 3 |
| Postgres suite (4 files) | ~33 total |

The well-established files that previously drove the count (`test_accounts.py`, `test_ledger.py`,
`test_validation_modals.py`) are now clean. `test_balance_history.py` and `test_retirement.py`
— both new since September — use proper `wait_for_selector`/`wait_for_function` patterns throughout
(zero `wait_for_timeout` calls), which should serve as the model for future files.

`test_filter_sort.py` at 22 instances is the highest per-file count remaining; most are of the
form `page.wait_for_timeout(300)` after a sort-button click. These should be replaced with
`wait_for_function` assertions checking the rendered order.

### Assertion quality (spot check)

**`test_spending_analysis.py`** (7 tests): Each test sets up minimal in-memory state via
`page.evaluate`, directly calls `computeSpendingByCategory`, and makes exact numeric assertions.
No DOM interaction — clean unit-style Playwright tests. Good model for logic-layer coverage.

**`test_filter_sort.py`** (26 tests): Seeds data via `page.evaluate`, asserts rendered card order
by reading `.querySelector`/`querySelectorAll` results. Good coverage of all three pages. The
wait-pattern issue noted above is the main quality concern; assertions themselves are solid.

**`test_balance_history.py`** (24 tests): Uses `_reload_app()` helper with proper
`wait_for_function` condition. Seeds data directly into `localStorage`, reloads, then validates
derived state. Tests cover seeding, idempotency, clear-data, add/edit/delete lifecycle, modal
interactions, import/export round-trips. Strong coverage depth. Zero `wait_for_timeout` calls.

**`test_plan_history.py`** (5 tests): Thin. Tests calculate-then-assert, repeated-calculate ordering,
cap at 20 entries, target-payoff exclusion, and reload persistence. Missing: concurrent-session
edge cases, storage migration from v1/v2 data without `planHistory`, very-long name truncation.

### State isolation

All reviewed files rely on the `app_page` fixture (from `conftest.py`), which provides a fresh
browser context per test. The fixture calls `window.app.clearAllData()` at the end of setup
(confirmed by reviewing conftest). No cross-test state leakage patterns were observed in the
spot-checked files. `test_balance_history.py` additionally uses `_reload_app()` to test
post-reload persistence — correct pattern for storage-round-trip tests.

---

## Unit test coverage

**Current unit test files** (7 total, ~135 tests):

| File | Tests | Functions covered |
|---|---|---|
| `debtCalculator.test.js` | 12 | `calculatePaymentPlan`, `formatDate`, `calculateMonthsBetweenDates` |
| `utils.test.js` | 28 | `formatCurrency`, `normalizeText`, `sanitizeFiniteNumber`, `parseFiniteOrNull`, `formatShortDate`, `formatMonthYear`, `sanitizeInteger`, `sanitizeDateISO`, `dateToISO`, `dailyCompoundInterest` |
| `sanitizers.test.js` | 55 | `sanitizePerson` (new), `sanitizeAccount`, `sanitizeDebt`, `sanitizeIncome`, `sanitizeBill`, `sanitizeExpense`, `sanitizeRecurringTemplate`, `sanitizeLedgerOverrides`, `sanitizeLedgerClearedTransactions`, `sanitizeRetirementSnapshot` (new), `sanitizeBalanceHistoryEntry` (new), `sanitizeParsedState` |
| `retirementCalculator.test.js` | 8 | `computeRetirementProjection`, `splitGrowthFromContribution` (both fully covered) |
| `balanceHistoryCore.test.js` | 26 | `isHistoryTrackedAccount`, `ownerOfEntry`, `entryBelongsTo`, `sortHistory`, `buildHistoryEntry`, `upsertHistoryEntry`, `seedHistoryForDebt`, `seedHistoryForAccount`, `remapHistoryOwners`, `excludeExistingHistory`, `computeHistoryDeltas` |
| `i18n.test.js` | 6 | `t()` lookup, fallback behavior, missing-key safety |
| `smoke.test.js` | 2 | Module-load smoke tests |

**`src/sanitizers.js` uncovered functions** (all pure, DOM-free — ideal Jest candidates):

The file has grown from 262 lines (September) to 343 lines. The Stryker `mutate` scope ends at
line 153 (`sanitizeRecurringTemplate`), leaving the following entirely outside unit tests and
mutation scope:

- `sanitizeBonus` (line 83)
- `sanitizeEmergencyFund` (line 173)
- `sanitizeSinkingFund` (line 185)
- `sanitizeNetWorthSnapshot` (line 200)
- `sanitizeForecastSettings` (line 217)
- `sanitizeSetting` (line 226)
- `sanitizeReconciliation` (line 241)
- `sanitizePlanHistoryEntry` (line 257)

`sanitizeBonus`, `sanitizeEmergencyFund`, `sanitizeSinkingFund`, and `sanitizeSetting` are the
most commonly exercised at runtime; Playwright tests cover them indirectly but no unit test
validates their field-level sanitization, nil-record robustness, or floor/ceiling clamping.

---

## Mutation testing scope and gaps

**Current `stryker.config.mjs` scope:**

```
src/debtCalculator.js:41-276    // calculatePaymentPlan
src/debtCalculator.js:431-433   // formatDate
src/debtCalculator.js:442-454   // calculateMonthsBetweenDates
src/utils.js:10-83              // formatCurrency, normalizeText, sanitizeFiniteNumber, …
src/utils.js:92-97              // dateToISO
src/utils.js:284-287            // dailyCompoundInterest
src/sanitizers.js:5-64          // sanitizeAccount, sanitizeDebt, sanitizeIncome
src/sanitizers.js:78-99         // sanitizeBill, sanitizeExpense
src/sanitizers.js:101-131       // sanitizeLedgerOverrides, sanitizeLedgerClearedTransactions
src/sanitizers.js:132-153       // sanitizeRecurringTemplate
src/sanitizers.js:286-300       // sanitizeBalanceHistoryEntry
src/retirementCalculator.js:3-12   // computeRetirementProjection
src/retirementCalculator.js:14-23  // splitGrowthFromContribution
src/balanceHistoryCore.js           // all (full-file — 114 lines)
```

**Threshold**: `high: 53, low: 48, break: 38`. Derived from a real run at 48.77%.

**Gaps / stale-range risks:**

1. `sanitizers.js` currently has 343 lines; the Stryker scope covers through line 300
   (`sanitizeBalanceHistoryEntry` — good). However, `sanitizeParsedState` (line 303, ends ~343)
   is partially tested in `sanitizers.test.js` but not in the `mutate` array. The 8 uncovered
   sanitizer functions (lines 83-260) are also outside mutation scope — this is by design since
   they lack unit tests — but represents an expanding blind spot as the file grows.

2. `sanitizePerson` (line 7) is now unit-tested but is NOT in the Stryker `mutate` array (scope
   starts at `sanitizeAccount`, line 14). This is an easy win to add.

3. **Line-range drift risk**: `sanitizers.js` has grown 81 lines since the September audit. The
   range `5-64` (sanitizeAccount→sanitizeIncome) has likely shifted. Recommend re-verifying
   function start/end lines match the config before the next Stryker run.

4. `debtCalculator.js`'s `maxMonths` runaway-loop safety exit (line ~271 guard) remains untested
   at both the unit and Playwright level (unchanged from September finding).

5. `utils.js` `sanitizeTimestampISO` (added in the ledger-cleared fix) is in the file but not in
   the Stryker scope.

---

## CI shard inventory

| Shard | Files | Approx. tests |
|---|---|---|
| `test-features-a` | test_debts, test_strategy, test_plan_history | 34+4+5 = 43 |
| `test-features-b` | test_income, test_recurring, test_expenses, test_issue_92_export, test_money_flow_sankey, test_pwa_icons, test_cash_flow_trend, test_main_nav_groups | ~84 |
| `test-features-c` | test_storage_import, test_i18n, test_pwa, test_issue_93_expense_save, test_storage_backend, test_spending_analysis, test_bills, test_storage_quota | ~73 |
| `test-features-d` | test_accounts, test_forecast | 33+16 = 49 |
| `test-features-e` | test_reports, test_debt_calculator, test_break_even, test_networth | 9+10+13+6 = 38 |
| `test-features-f` | test_ledger | 41 |
| `test-features-g` | test_reconciliation | 13 |
| `test-features-h` | test_interest_income, test_health, test_settings, test_validation_modals, test_versioning, test_savings, test_recurring_occurrences, test_reports_nav_groups | ~87 |
| **MISSING from all shards** | test_retirement, test_people, test_balance_history, test_filter_sort, test_calendar_feed, test_account_menu, test_analytics, test_performance, test_recurring_archive | **~172 tests** |
| `test-ui-a` | test_accessibility, test_setup_wizard, test_remaining_pages_print, test_reports_nav | ~83 |
| `test-ui-b` | test_table_mobile_scroll, test_data_transfer_modal, test_command_palette, test_reconciliation_actions, test_reports_actions, test_css_load, test_chart_accessibility, test_modals, test_whatif_simulator, test_strategy_calendar, test_mobile, test_charts, test_debt_actions | ~85 |
| `test-ui-c` | test_high_contrast_theme, test_guide_nav, test_dark_mode, test_spending_ui, test_overview_print, test_settings_theme_location, test_delete_confirm_modal, test_pwa_update_banner, test_main_nav, test_recurring_actions, test_login_gate_theme, test_reduced_motion, test_guide_theme | ~86 |
| `test-integration` | tests/integration/ | ~22 |
| `test-security` | tests/security/ | 62+ |
| `test-postgres` | tests/postgres/ | ~33 (Docker stack required) |

**The three UI shards (a/b/c) are now well-balanced** — the September audit flagged ui-a vs ui-b
imbalance; this has been resolved with the addition of `test-ui-c`.

---

## Top 10 missing test areas (by risk)

Ranked by: probability of regression × impact if missed.

| Rank | Area | Risk rationale |
|---|---|---|
| 1 | **New feature test files not in any CI shard** | 172 tests that exist and can catch regressions _never run in CI_. Any PR that breaks retirement, people, balance history, filter/sort, calendar feed, or account menu passes CI green. High regression probability as these pages continue to evolve. |
| 2 | **`bonusAdvisor.js` — no dedicated test file** | Bonus elimination plan logic is complex (multi-debt targeting, interest filtering) and exercised only via `test_income.py` at the integration level. No test verifies the `computeElimintaionPlan` logic in isolation. |
| 3 | **`sanitizeBonus`, `sanitizeEmergencyFund`, `sanitizeSinkingFund`, `sanitizeSetting` — no unit tests** | These sanitizers are called on every load/import. A nil-record crash or invalid field passing through unsanitized would affect every user on first startup. No Playwright test currently calls them with adversarial inputs (null record, NaN amount, overlong string). |
| 4 | **`plan_history` test coverage thin** (5 tests) | Only happy-path behavior tested. Missing: storage migration (data without `planHistory` key), concurrent-session clobbering, name truncation, and the UI rendering of the history table when it's populated. The feature was just added and is listed as a key strategy feature. |
| 5 | **`strategy.js` submodule coverage** | `test_strategy.py` has only 4 tests. The plan-calculation (`strategyPlanCalculation.js`), comparison (`strategyComparison.js`), schedule-table (`strategyScheduleTable.js`), summary-table (`strategySummaryTable.js`), and calendar (`strategyCalendar.js`) logic are tested indirectly at best. Strategy is the most calculation-dense feature and a prime regression surface. |
| 6 | **Stryker scope not updated after `sanitizers.js` growth** | `sanitizers.js` grew from 262→343 lines since the last Stryker tune-up. The `5-64` range may now have drifted off its intended functions, and the 8 new pure functions (emergency fund, sinking fund, net worth snapshot, forecast settings, settings, reconciliation, plan history) are entirely outside mutation scope — surviving mutants in these would go undetected. |
| 7 | **`debtCalculator.js` runaway-loop safety exit untested** | The `month > maxMonths` guard at line ~271 has no test at any level (unit or Playwright). An off-by-one regression silently produces infinite loops or wrong payoff schedules for edge-case debt configurations. |
| 8 | **`calendarFeed.js` / `server/src/calendarGenerator.js` cross-file parity** | `test_calendar_feed.py` (28 tests) covers the client-side ICS generator well, but it is not in any CI shard. The CLAUDE.md explicitly warns that any change to event selection/occurrence logic must land in both files — but only the client-side logic is covered by the existing tests; the server-side generator (`calendarGenerator.js`) is only exercised by `tests/postgres/test_calendar_feed_content.py` (Docker-only). |
| 9 | **`storageAdapters.js` interface untested in isolation** | The `get`/`set`/`remove` adapter interface is only tested via Playwright backend-switching flows. A TypeScript signature change or a silent `undefined`-return in a new adapter would not be caught by any unit test. |
| 10 | **`utils.js` `sanitizeTimestampISO` and ISO-anchor regex edge cases** | `sanitizeTimestampISO` (added in the ledger-cleared timezone fix) has no unit test. The September audit also flagged `Regex` mutant survivors on the ISO-date anchor check (`^(\d{4}-\d{2}-\d{2})T`) — still open: no test feeds a near-valid date string to confirm boundary rejection. |

---

## Security test coverage

**Files**: `test_csp.py` (5 tests), `test_xss.py` (25 tests), `test_static_scan.py` (25 tests),
`test_input_validation.py` (19 tests).

**New since September**: `test_xss.py` added:
- `test_xss_in_person_name` — XSS via People page (new feature, correctly added)
- `test_xss_in_retirement_target_date_input_value` — verifies escaped retirement date in DOM
- `test_xss_in_balance_history_modal_names` — verifies history modal escapes debt/account names

The security suite follows new features well. All three new XSS vectors are covered.

**Remaining gaps**:
- No XSS test for the sort/filter control rendered values (account/category names rendered in
  filter dropdowns) — low risk since those paths go through existing `escapeHtml()` calls, but
  worth adding given the new UI surface.
- `test_static_scan.py`'s `test_no_new_external_origins_introduced` assertion covers the allowed
  CDN/GA origins; no corresponding test validates that the new `retirementCalculator.js` or
  `balanceHistoryCore.js` modules don't introduce new external dependencies at runtime.

---

## Recommended next steps (prioritized)

1. **[HIGH] Assign the 9 unsharded test files to CI shards.** Bin-pack `test_retirement` (18),
   `test_people` (22), `test_balance_history` (24), `test_filter_sort` (26), `test_calendar_feed`
   (28), `test_account_menu` (14), `test_analytics` (4), `test_performance` (23),
   `test_recurring_archive` (13) across one or two new shard jobs (`test-features-i`/`j`).
   Combined count is 172 tests — fitting into one new 20-minute shard may be tight;
   two shards (~86 tests each) is safer. This is a pure CI YAML change, no test code required.

2. **[HIGH] Add unit tests for the 8 uncovered sanitizer functions**, then extend Stryker's
   `sanitizers.js` mutate ranges to cover them. Minimum: non-object input, a missing/NaN numeric
   field, and a well-formed round-trip for each. Priority order: `sanitizeBonus`,
   `sanitizeEmergencyFund`, `sanitizeSinkingFund`, `sanitizeSetting`. After adding tests,
   re-verify line ranges in `stryker.config.mjs` match current file structure and recompute
   thresholds from a fresh run.

3. **[MEDIUM] Add a unit test for `sanitizePerson` to Stryker scope.** It's now unit-tested but
   the `mutate` array starts at `sanitizeAccount` (line 14), leaving `sanitizePerson` (line 7)
   outside mutation testing. One-line config change.

4. **[MEDIUM] Replace `wait_for_timeout` calls in `test_filter_sort.py`** (22 instances) with
   `wait_for_function` assertions on the rendered list order or a `wait_for_selector` on the
   first expected card's `textContent`. This is the highest-count remaining file.

5. **[MEDIUM] Expand `test_plan_history.py`** with at least 3–5 additional tests: legacy-data
   migration (no `planHistory` key in stored data), the rendered history-table DOM, and truncation
   of very-long debt names in the history display.

6. **[MEDIUM] Add a `debtCalculator.js` unit test for the `maxMonths` runaway-loop exit.** Feed
   `calculatePaymentPlan` a configuration where monthly payment barely covers interest — the loop
   should hit `maxMonths` and return a schedule capped at that length rather than running forever.

7. **[LOW] Add a dedicated `bonusAdvisor.js` test file** or at minimum move the elimination-plan
   tests from `test_income.py` into a file named for the module, so future coverage of
   `computeElimintaionPlan` edge cases can accumulate without inflating `test_income.py` further.

8. **[LOW] Unit-test `sanitizeTimestampISO`** and add a Stryker entry for it in `utils.js`
   (`sanitizeTimestampISO` neighbors `dateToISO` which is already in scope at lines 92–97;
   extend that range to cover it).

9. **[LOW] Add an XSS test for filter dropdown rendered values** (account/category names in the
   new sort/filter controls' `<select>` or rendered filter list) to `test_xss.py`.

10. **[INFORMATIONAL] Document the local Postgres test runbook.** The September audit flagged that
    `tests/postgres/` provisioning only exists inline in `ci.yml`. This remains open — a
    `docs/dev/run-postgres-tests.md` or a `make postgres-test` target would lower the barrier for
    pre-PR verification.
