# MyFinances Test Suite Report — June 28, 2026

**Status**: ✅ 452/452 passing, 0 failures, 0 skips
**Run command**: `python -m pytest tests/ -v --tb=short` (server at `http://localhost:5500/`)
**Duration**: 14m 40s (880.72s)
**Environment**: Python 3.14.5, pytest-9.0.3, pluggy-1.6.0, asyncio-1.4.0 — Windows 11
**Supersedes**: `TEST_SUITE_AUDIT_2026-06-19.md` (344 tests / 41 files)
**Version under test**: v4.2.0

This report reflects the full suite as of June 28, 2026. Every test result was read directly from a live pytest run; per-file counts were verified against the output. No tests were modified as part of this report.

---

## 1. Totals by category

| Category | Files | Tests | vs. June 19 |
|---|---|---|---|
| `tests/a11y/` | 1 | 10 | +2 |
| `tests/features/` | 22 | 203 | +1 file, +34 |
| `tests/integration/` | 2 | 13 | +2 |
| `tests/security/` | 4 | 56 | +5 |
| `tests/ui/` | 22 | 170 | +9 files, +85 |
| **Total** | **51** | **452** | **+10 files, +108** |

---

## 2. File-by-file inventory

### `tests/a11y/` (1 file, 10 tests)
| File | Count | Scope |
|---|---|---|
| `test_a11y_audit.py` | 10 | Page-spanning sweep: dangling ARIA refs, duplicate IDs, orphaned inputs, unnamed interactive elements, missing alt text, site-wide colour contrast (all 10 pages × 2 themes + `guide.html`), modal Escape behaviour, mobile nav `aria-expanded`, summary report table captions, ledger export modal focus return |

### `tests/features/` (22 files, 203 tests)
| File | Count | Scope |
|---|---|---|
| `test_accounts.py` | 7 | CRUD, balance projection, linked-item orphan handling on delete |
| `test_bills.py` | 5 | Legacy Bills data model/calculations (UI removed, model retained) |
| `test_debt_calculator.py` | 10 | `DebtCalculator` engine: 4 strategies, back-calculator, fixedAmount windows, stimulus edge cases |
| `test_debts.py` | 9 | CRUD, interest calc, amortization, strategy run, payoff-date display, fixed-amount negative rejection |
| `test_expenses.py` | 11 | CRUD + validation (empty/negative/zero/missing-date amounts) |
| `test_forecast.py` | 16 | Horizon/account selection, notable months, negative-balance warnings, intra-month dip detection |
| `test_health.py` | 19 | All 6 dashboard cards, nav links, empty states |
| `test_income.py` | 8 | CRUD + negative/bonus/edit validation |
| `test_ledger.py` | 11 | Aggregation, account filtering, override modal persistence, reconciliation row rendering and balance contribution |
| `test_main_nav_groups.py` | 5 | Nav grouping/active-state logic |
| `test_networth.py` | 6 | Snapshot capture, milestones, trend chart data |
| `test_reconciliation.py` | 13 | Apply/history/expected-transactions/sanitization/import-export, Adjust-Balance vs. Visible-Only mode switching |
| `test_recurring.py` | 13 | Create (3 cadences), pause/skip, account linkage, validation |
| `test_recurring_occurrences.py` | 5 | Occurrence-date math |
| `test_reports.py` | 9 | Month offset, year-boundary labels, variance, summary metrics |
| `test_reports_nav_groups.py` | 5 | Reports tab grouping |
| `test_savings.py` | 7 | Emergency/sinking fund CRUD + coverage math |
| `test_settings.py` | 10 | `settings.js` get/set/sanitize; export/import round-trip; legacy import without settings key; ledger column setting |
| `test_spending_analysis.py` | 7 | Category aggregation, drilldown |
| `test_storage_import.py` | 18 | `utils.js` sanitizer primitives + adversarial import for every record type + legacy v1.0 format |
| `test_storage_quota.py` | 5 | Quota-warning banner: no-warning baseline, threshold trigger, dismiss, no-duplicate, reset below threshold |
| `test_strategy.py` | 4 | Strategy switch recalculates without error, comparison panel shows all 4 strategies, stimulus increases payments, non-numeric stimulus falls back to zero |

### `tests/integration/` (2 files, 13 tests)
| File | Count | Scope |
|---|---|---|
| `test_smoke.py` | 4 | App loads, all pages reachable, no console errors, account → net worth flow |
| `test_workflows.py` | 9 | End-to-end: CSV export escaping, JSON import, clear-data → reimport, clear → reload → setup wizard re-triggers, ledger CSV column picker |

### `tests/security/` (4 files, 56 tests)
| File | Count | Scope |
|---|---|---|
| `test_csp.py` | 5 | CSP meta tag presence/correctness, no inline scripts/styles, security headers |
| `test_input_validation.py` | 17 | Negative/huge/decimal/empty numerics, special chars, interest-rate bounds, health gauge clamping, recurring day-of-month bounds, savings/emergency-fund bounds, reconciliation balance and note validation, Unicode names, `paidMonths` sanitization, `setting` XSS/object-value rejection, ledger CSV injection quoting |
| `test_static_scan.py` | 15 | Static source scan: no `eval`/`unsafe-inline`, CSP headers in HTML + nginx stay in sync, no hardcoded secrets, `localStorage`-only persistence, HTTPS-only fetches, no debug `console.log`, no inline nav styles, no new external origins introduced |
| `test_xss.py` | 19 | `escapeHtml()` coverage for every user-text field across debts/accounts/income/bills/recurring/savings/reports/spending/ledger/reconciliation/sinking-funds/calendar modals |

### `tests/ui/` (22 files, 170 tests)
| File | Count | Scope |
|---|---|---|
| `test_accessibility.py` | 36 | Keyboard nav, ARIA roles, modal focus traps, skip links, form labels, reconcile inputs/buttons/modal, settings modal/button, setup wizard dialog, calendar day modal, guide link, reports nav tablist/tabs/aria, main nav landmark/aria-current/groups, results tab panel switching |
| `test_chart_accessibility.py` | 4 | `.sr-only` data-table fallbacks present for Health gauges, Spending charts, Forecast chart, Net Worth trend chart |
| `test_charts.py` | 4 | Chart instances survive repeated re-renders without crashing (regression guard for `destroy()`-before-recreate) |
| `test_command_palette.py` | 9 | Ctrl+K, toolbar button, Escape + focus restore, filter, no-match state, Enter navigates, arrow-key selection, backdrop click, theme toggle action |
| `test_css_load.py` | 7 | Stylesheet load order/CSP compliance |
| `test_dark_mode.py` | 6 | Theme toggle persistence, corrupted-`localStorage` fallback |
| `test_debt_actions.py` | 1 | Debt inline edit and save |
| `test_guide_nav.py` | 11 | `guide.html`: skip-link target, desktop sticky sidebar, mobile dropdown, toggle open/focus/Escape/outside-click/link-click, back-to-top visibility/scroll, table `th scope`, back-to-top accessible label |
| `test_guide_theme.py` | 3 | `guide.html` reads `localStorage` theme on load: dark, absent (light), explicit light |
| `test_main_nav.py` | 5 | Active group highlight, dimmed inactive labels, cross-group navigation, single active page, mobile separator hidden |
| `test_mobile.py` | 4 | Responsive breakpoints, mobile menu |
| `test_modals.py` | 5 | Modal open/close/visibility-toggle mechanics, ledger override modal, amortization modal |
| `test_overview_print.py` | 7 | Print buttons on Health/Accounts/Income pages call `window.print`, accessible labels, form cards hidden when printing |
| `test_reconciliation_actions.py` | 8 | Reconcile page + ledger quick-reconcile modal interactions |
| `test_recurring_actions.py` | 4 | Pause/resume/skip/mark-paid inline actions |
| `test_reduced_motion.py` | 3 | CSS transitions collapse under `prefers-reduced-motion`, chart animation disabled/enabled per OS preference |
| `test_remaining_pages_print.py` | 17 | Print buttons on Liabilities/Recurring/Strategy/Savings/Ledger/Reconcile pages call `window.print`, accessible labels, form areas hidden when printing |
| `test_reports_actions.py` | 7 | Calendar day dots, click/keyboard opens modal, net-worth capture button, reports print button, tab panel visibility, monthly/yearly toggle |
| `test_reports_nav.py` | 7 | Reports tab bar: active group highlight, dimmed inactive, cross-group switch, single active, sticky position, dark-mode background, mobile separator hidden |
| `test_setup_wizard.py` | 9 | Wizard shows on true first run, suppressed when data exists, Adjust Balance / Visible Only choice persists, choice survives reload, settings button/modal, modal Escape, command palette settings entry |
| `test_spending_ui.py` | 8 | Charts, ranked list, drilldown modal |
| `test_table_mobile_scroll.py` | 5 | Debt summary, payment schedule, summary report, ledger, and reconcile expected tables all scroll within `.table-wrapper` on mobile |

---

## 3. Source-module → test coverage cross-reference

| `src/` module | Test file(s) | Count | Status |
|---|---|---|---|
| `debtCalculator.js` | `test_debt_calculator.py` | 10 | ✅ Strong |
| `accounts.js` | `test_accounts.py` | 7 | ✅ Adequate |
| `income.js` | `test_income.py` | 8 | ✅ Good — validation paths added (was 4) |
| `bills.js` | `test_bills.py` (5) + `test_expenses.py` (11) | 16 | ✅ Good |
| `recurring.js` | `test_recurring.py` (13) + `test_recurring_occurrences.py` (5) + `test_recurring_actions.py` (4) | 22 | ✅ Strong |
| `savings.js` | `test_savings.py` | 7 | ✅ Adequate |
| `reports.js` | `test_reports.py` (9) + `test_reports_nav_groups.py` (5) + `test_reports_nav.py` (7) | 21 | ✅ Good |
| `forecast.js` | `test_forecast.py` | 16 | ✅ Strong |
| `health.js` | `test_health.py` | 19 | ✅ Strong |
| `spending.js` | `test_spending_analysis.py` (7) + `test_spending_ui.py` (8) | 15 | ✅ Good |
| `ledger.js` | `test_ledger.py` (11) + `test_modals.py` | 12+ | ✅ Improved — reconciliation row tests added (was 6) |
| `reconciliation.js` | `test_reconciliation.py` (13) + `test_reconciliation_actions.py` (8) | 21 | ✅ Strong |
| `strategy.js` | `test_strategy.py` (4) + `test_debts.py`, `test_workflows.py` | 4+ | ✅ Gap closed — dedicated file now exists (was zero) |
| `charts.js` | `test_charts.py` (4) + `test_chart_accessibility.py` (4) | 8 | ✅ Gap closed — re-render survival tests added (was zero) |
| `commandPalette.js` | `test_command_palette.py` | 9 | ✅ Strong |
| `settings.js` | `test_settings.py` | 10 | ✅ Strong |
| `setupWizard.js` | `test_setup_wizard.py` | 9 | ✅ Strong |
| `guideTheme.js` | `test_guide_theme.py` | 3 | ✅ Gap closed — coverage added (was zero) |
| `ui.js` | Transitively via every page test | — | ✅ Acceptable — pure dispatch |
| `storage.js` | `test_storage_import.py` (18) + `test_storage_quota.py` (5) | 23 | ✅ Strong |
| `utils.js` | `test_storage_import.py` (sanitizer primitives) | included | ✅ Adequate |
| `app.js` | None direct (composition root) | — | ✅ Acceptable — thin delegation wrappers |

**All five coverage gaps flagged in the June 19 audit have been closed.**

---

## 4. Resolved gaps from the June 19 audit

| Gap (June 19) | Resolution |
|---|---|
| `income.js` thin — validation paths untested | `test_income.py` expanded 4→8: added negative, bonus negative, edit-income negative, edit-bonus negative |
| `strategy.js` — no dedicated test file | `test_strategy.py` added (4 tests): strategy switch, comparison panel, stimulus happy/invalid path |
| `charts.js` — no re-render destruction test | `test_charts.py` added (4 tests): balance, DTI, net-worth trend, forecast chart survive repeated re-renders |
| `guideTheme.js` — zero automated coverage | `test_guide_theme.py` added (3 tests): dark, absent-key (light), explicit light |
| `tests/debug/` ad-hoc scripts in test tree | Relocated to `tools/debug/` in v3.7.0 |

---

## 5. Remaining coverage notes

1. **`strategy.js` negative paths** — `test_strategy.py` covers 4 happy/fallback cases; no test verifies what happens if a user switches strategies mid-flow without pressing "Calculate" first, or enters a stimulus amount that exceeds total remaining debt. Low risk (UI disables re-entry until recalculated), but a regression would go undetected.

2. **`ledger.js` combined multi-type sort/filter edge cases** — `test_ledger.py` now covers reconciliation row contributions and override collisions, but the specific interaction of "mixed real + synthetic rows for same date with running balance enabled" is still exercised only implicitly through integration tests, not as a first-class unit test.

3. **`accounts.js` deletion with linked sinking-fund items** — `test_delete_account_with_linked_items_orphans_gracefully` (added in this cycle) tests income/debt/bill/recurring linkage orphan handling; savings/sinking-fund linkage on account deletion is not yet tested.

---

## 6. Positive/negative balance review

**Well-balanced** (happy path + invalid/adversarial cases both present): debts, expenses, recurring, income, reconciliation, storage import, CSV export, health gauge clamping, XSS coverage, settings sanitization, quota warning.

**Positive-only** (no negative-path test, low priority):
- `strategy.js` — stimulus overflow and mid-flow strategy switch without recalculate
- `savings.js` — no test for deleting a sinking fund that is linked to a closed account
- `charts.js` — survival tests confirm no crash on re-render, but do not assert the stale instance is explicitly `.destroy()`'d (only that the new render works)

---

## 7. Flaky-pattern scan

No `time.sleep`/arbitrary waits found. All tests use Playwright's `wait_for_selector`/`wait_for_function`/auto-waiting locators.

`tests/a11y/test_a11y_audit.py` caches its 14-page sweep at module scope (`_CACHED_RESULTS`). A failure in one a11y test can be caused by state from an earlier one in the same module run — acceptable tradeoff given the cost, but worth knowing if an a11y test ever flakes in isolation.

`tests/ui/test_remaining_pages_print.py` uses parametrize over 6 page/button pairs, generating 17 tests from two fixtures. If the `window.print` stub is not reset between parametrize iterations, a failure in one pair could mask failures in others. No evidence of this in practice — all 17 passed cleanly.

---

## 8. Recommended follow-up tests (prioritized)

1. **`test_strategy.py::test_stimulus_exceeds_total_debt_does_not_overpay`** — mirrors the edge case already covered in `test_debt_calculator.py::test_debt_calculator_stimulus_larger_than_total_balance_no_overpayment` but at the UI layer.
2. **`test_ledger.py::test_running_balance_snaps_to_statement_on_recon_row_adjust_mode`** — direct regression test for the v4.2.0 balance-snap fix; currently covered implicitly by the integration smoke test but not as a named unit test.
3. **`test_accounts.py::test_delete_account_linked_to_sinking_fund_orphans_gracefully`** — round out the orphan-handling pattern already tested for income/debt/bill/recurring.
4. **`test_charts.py::test_chart_instance_explicitly_destroyed_before_rerender`** — assert `chart.destroy()` was called (via `Chart.instances` count or a spy), not just that the new render rendered.

---

**Audit method**: full `python -m pytest tests/ -v --tb=short` run, output read line-by-line, per-file counts verified from the live output, source modules cross-referenced against test files. No code or tests were modified as part of this audit.

**Previous audit**: [`TEST_SUITE_AUDIT_2026-06-19.md`](TEST_SUITE_AUDIT_2026-06-19.md) — 344 tests / 41 files
