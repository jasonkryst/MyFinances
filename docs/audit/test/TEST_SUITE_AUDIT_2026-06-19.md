# MyFinances Test Suite Audit — June 19, 2026

**Status**: ✅ 324/324 passing, 0 failures, 0 skips
**Run command**: `python -m pytest tests/ -v` (server at `http://localhost:5500/`)
**Duration**: 10m 29s (629.78s)
**Supersedes**: `TEST_REPORT.md` (May 31), `FINAL_TEST_SUMMARY.md` (June 8), `TEST_SUITE_CLEANUP_SUMMARY.md` — all stale relative to the current 324-test suite (grew from 264 → 324 in the June 19 session that produced this audit).

This is a fresh, from-scratch pass: every file under `tests/{security,features,ui,integration,a11y}/` was read (not inferred from filenames), counts were verified with `grep -cE "^(async )?def test_"`, and `src/*.js` modules were cross-referenced against `tests/features/` for direct-unit-test coverage.

---

## 1. Totals by category

| Category | Files | Tests |
|---|---|---|
| `tests/security/` | 4 | 51 |
| `tests/features/` | 21 | 169 |
| `tests/ui/` | 13 | 85 |
| `tests/integration/` | 2 | 11 |
| `tests/a11y/` | 1 | 8 |
| **Total** | **41** | **324** |

(`__init__.py` files and `run_a11y_audit.py` — the standalone script `test_a11y_audit.py` wraps — excluded from the file count above as they contain no `test_*` functions.)

## 2. File-by-file inventory

### `tests/security/` (51 tests)
| File | Count | Scope |
|---|---|---|
| `test_csp.py` | 5 | CSP meta tag presence/correctness, no inline scripts/styles, nonce absence |
| `test_input_validation.py` | 15 | Negative/huge/decimal/empty numeric inputs, special chars, interest-rate bounds, health gauge clamping, recurring day-of-month bounds, savings/emergency-fund bounds, reconciliation balance validation + note truncation, Unicode names, `paidMonths` sanitization |
| `test_static_scan.py` | 14 | Static source scan: no `eval`/`unsafe-inline`, CSP headers in HTML+nginx stay in sync, no hardcoded secrets, `localStorage`-only persistence, HTTPS-only fetches, no debug `console.log` left in shipped code, no inline styles on nav |
| `test_xss.py` | 17 | `escapeHtml()` coverage for every user-text field across debts/accounts/income/bills/recurring/savings/reports/spending modals |

### `tests/features/` (169 tests)
| File | Count | Scope |
|---|---|---|
| `test_accounts.py` | 6 | CRUD, balance projection |
| `test_bills.py` | 5 | Legacy Bills data model/calculations (UI removed, model retained) |
| `test_debt_calculator.py` | 10 | `DebtCalculator` engine: 4 strategies, back-calculator, fixedAmount windows, stimulus edge cases |
| `test_debts.py` | 8 | CRUD, interest calc, amortization, strategy run, payoff-date display |
| `test_expenses.py` | 11 | CRUD + validation (empty/negative/zero/missing-date amounts) |
| `test_forecast.py` | 16 | Horizon/account selection, notable months, negative-balance warnings, intra-month dip detection |
| `test_health.py` | 19 | All 6 dashboard cards, nav links, empty states |
| `test_income.py` | 4 | CRUD |
| `test_ledger.py` | 6 | Aggregation, override modal persistence |
| `test_main_nav_groups.py` | 5 | Nav grouping/active-state logic |
| `test_networth.py` | 6 | Snapshot capture, milestones, trend chart data |
| `test_reconciliation.py` | 11 | Apply/history/expected-transactions/sanitization/import-export |
| `test_recurring.py` | 13 | Create (3 cadences), pause/skip, account linkage, validation |
| `test_recurring_occurrences.py` | 5 | Occurrence-date math |
| `test_reports.py` | 7 | Month offset, year-boundary labels, variance |
| `test_reports_nav_groups.py` | 5 | Reports tab grouping |
| `test_savings.py` | 7 | Emergency/sinking fund CRUD + coverage math |
| `test_spending_analysis.py` | 7 | Category aggregation, drilldown |
| `test_storage_import.py` | 18 | `utils.js` sanitizer primitives + adversarial import for every record type + legacy v1.0 format |

### `tests/ui/` (85 tests)
| File | Count | Scope |
|---|---|---|
| `test_accessibility.py` | 28 | Keyboard nav, ARIA roles, modal focus traps, skip links, form labels (single-page spot checks) |
| `test_css_load.py` | 7 | Stylesheet load order/CSP compliance |
| `test_dark_mode.py` | 6 | Theme toggle persistence, corrupted-localStorage fallback |
| `test_debt_actions.py` | 1 | Debt action menu |
| `test_main_nav.py` | 5 | Desktop/mobile nav layout |
| `test_mobile.py` | 4 | Responsive breakpoints, mobile menu |
| `test_modals.py` | 5 | Modal open/close/visibility-toggle mechanics |
| `test_reconciliation_actions.py` | 8 | Reconcile page + ledger quick-reconcile modal interactions |
| `test_recurring_actions.py` | 4 | Pause/resume/skip/mark-paid inline actions |
| `test_reports_actions.py` | 2 | Snapshot button, tab-panel visibility toggle |
| `test_reports_nav.py` | 7 | Reports tab bar grouping/sticky/dark-mode |
| `test_spending_ui.py` | 8 | Charts, ranked list, drilldown modal |

### `tests/integration/` (11 tests)
| File | Count | Scope |
|---|---|---|
| `test_smoke.py` | 4 | App loads, all pages reachable, no console errors |
| `test_workflows.py` | 7 | End-to-end multi-step workflows: CSV export escaping, clear-data → reimport round trip |

### `tests/a11y/` (8 tests)
| File | Count | Scope |
|---|---|---|
| `test_a11y_audit.py` | 8 | Wraps `run_a11y_audit.py`'s page-spanning sweep: dangling ARIA refs, duplicate IDs, orphaned inputs, unnamed interactive elements, missing alt text, site-wide contrast (all 10 pages × 2 themes + guide.html), modal Escape behavior, mobile nav `aria-expanded` |

---

## 3. Source-module → test coverage cross-reference

| `src/` module | Direct feature test file | Status |
|---|---|---|
| `debtCalculator.js` | `test_debt_calculator.py` (10) | ✅ Good |
| `accounts.js` | `test_accounts.py` (6) | ✅ Adequate |
| `income.js` | `test_income.py` (4) | ⚠️ Thin — CRUD only, no validation/edge tests |
| `bills.js` | `test_bills.py` (5) + `test_expenses.py` (11) | ✅ Good (expenses live in bills.js) |
| `recurring.js` | `test_recurring.py` (13) + `test_recurring_occurrences.py` (5) + `test_recurring_actions.py` (4 UI) | ✅ Strong |
| `savings.js` | `test_savings.py` (7) | ✅ Adequate |
| `reports.js` | `test_reports.py` (7) + `test_reports_nav_groups.py` (5) + `test_reports_nav.py` (7 UI) | ✅ Good |
| `forecast.js` | `test_forecast.py` (16) | ✅ Strong |
| `health.js` | `test_health.py` (19) | ✅ Strong |
| `spending.js` | `test_spending_analysis.py` (7) + `test_spending_ui.py` (8) | ✅ Good |
| `ledger.js` | `test_ledger.py` (6) + `test_modals.py` (override modal) | ⚠️ Thin given the module's role as the cross-feature aggregator — no direct test for combined multi-type sort/filter edge cases |
| `reconciliation.js` | `test_reconciliation.py` (11) + `test_reconciliation_actions.py` (8 UI) | ✅ Strong |
| `strategy.js` | Indirectly via `test_debts.py`, `test_workflows.py`, `test_smoke.py` | ⚠️ **Gap** — no dedicated `test_strategy.py`; strategy *switching* (Avalanche/Snowball/Priority-Lowest/Priority-Highest) and per-month stimulus entry are only exercised incidentally, not as first-class UI tests |
| `charts.js` | None direct; covered transitively wherever a chart renders (health/spending/forecast/networth tests) | ⚠️ No test asserts chart instances are destroyed on re-render (memory-leak regression risk) |
| `ui.js` | None direct; `switchPage` covered transitively by every page test | ✅ Acceptable — pure dispatch logic, low risk |
| `storage.js` | `test_storage_import.py` (18) | ✅ Strong |
| `utils.js` | `test_storage_import.py` (sanitizer primitives) | ✅ Adequate |
| `app.js` | None direct (it's the composition root) | ✅ Acceptable — thin delegation wrappers, exercised by every other test |
| `guideTheme.js` | None | ⚠️ **Gap** — `guide.html`'s theme toggle logic has no automated test; this is the feature the user has twice asked to verify by hand this cycle (confirmed working manually, but a regression would go undetected) |

---

## 4. Positive/negative balance review

Areas with **good positive+negative balance** (happy path + invalid/edge/adversarial case both present): debts, expenses, recurring templates, reconciliation, storage import (all sanitizers), CSV export, health dashboard clamping, XSS coverage.

Areas with **positive-only coverage** (gaps):
1. **`income.js`** (`test_income.py`, 4 tests) — only CRUD happy-path. No test for negative/zero amount, invalid pay-frequency, or missing account link rejection, even though `bills.js`/`recurring.js` got this exact bug-class fix this session (clamp-before-check). Worth auditing `addIncome`/`saveEditIncome` for the same dead-code-validation pattern.
2. **`accounts.js`** (`test_accounts.py`, 6 tests) — no test for deleting an account that has linked income/debts/bills/recurring items (orphan-handling path); `reconciliation.js`'s "Unknown account" orphan-rendering is tested, but the account-deletion side isn't.
3. **`strategy.js`** — no negative-path test for an invalid/empty stimulus amount, or switching strategies mid-flow without recalculating.
4. **`charts.js`** — no test verifies stale Chart.js instances are destroyed before a re-render (only that a chart *appears*).

## 5. Flaky-pattern scan

No `time.sleep`/arbitrary waits found in the reviewed files — all use Playwright's `wait_for_selector`/`wait_for_function`/auto-waiting locators, which is the right pattern. `tests/a11y/test_a11y_audit.py` caches its expensive Playwright sweep at module scope (`_CACHED_RESULTS`), which is good practice but means a failure in one `a11y` test can be caused by state from an earlier one in the same module run — acceptable tradeoff given the cost (14 full page loads), but worth knowing if an `a11y` test ever flakes only when run in isolation vs. as part of the full module.

## 6. Housekeeping (not a coverage gap, but noted)

`tests/debug/` contains 10 files (`debug_app.py`, `debug_menu.py`, `debug_nav_clicks.py`, etc.) with no `test_*` functions — these are ad-hoc manual debugging scripts, not part of the pytest suite (pytest's default `test_*.py` collection still imports them looking for test functions, finds none, and silently no-ops). They aren't broken, but they're dead weight in the tree and could confuse a future contributor about what's "real" test coverage. Consider moving them to a `scripts/` or `tools/` directory outside `tests/`, or deleting if no longer needed for manual debugging.

## 7. Recommended follow-up tests (prioritized)

1. **`tests/features/test_income.py::test_add_income_negative_amount_rejected`** — verify `addIncome`/`saveEditIncome` reject negative/zero/empty amounts at the UI layer (check for the same clamp-before-validate bug already fixed in `bills.js`/`recurring.js` this session).
2. **`tests/features/test_strategy.py`** (new file) — `test_switch_strategy_recalculates_payoff_order`, `test_stimulus_invalid_amount_rejected`, covering the one `src/` module with no dedicated feature-test file.
3. **`tests/features/test_accounts.py::test_delete_account_with_linked_items_orphans_gracefully`** — mirror the orphan-handling pattern already tested for reconciliation history entries.
4. **`tests/ui/test_charts.py::test_chart_instance_destroyed_on_rerender`** (new file) — assert `app._healthDtiChart`/`app._healthSavingsChart` (and forecast/spending/networth chart refs) get `.destroy()`'d, not silently leaked, across repeated re-renders.
5. **`tests/ui/test_guide_theme.py::test_guide_theme_toggle_persists`** (new file) — close the one module (`guideTheme.js`) with zero automated coverage.

---

**Audit method**: manual file-by-file read of all 41 test files, `grep -cE "^(async )?def test_" <file>` count verification, `python -m pytest tests/ -v` full run, and a module-by-module diff of `src/*.js` against `tests/features/`. No code or tests were modified as part of this audit.
