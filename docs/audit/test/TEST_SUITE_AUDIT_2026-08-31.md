# MyFinances Test Suite Audit — August 31, 2026

**Status**: Pending CI run — see counts below; non-Postgres suite ran clean in prior CI jobs  
**Run command**: `python -m pytest tests/ -v` (server at `http://localhost:5500/`; Docker stack for `tests/postgres/`)  
**Supersedes**: `TEST_SUITE_AUDIT_2026-06-19.md` (324 tests / June 19, 2026)

This audit updates all file/test counts after the following features shipped post–June 19:
Interest Income, Break-Even Analysis, Ledger Tie-Break Fix, PWA, i18n, Storage Abstraction,
Spending Analysis, Cash Flow Trend, Money Flow Sankey, Bonus Advisor, Data Transfer Modal,
High Contrast Theme, Command Palette, Guide Nav, Settings Theme Location, PWA Update Banner,
Table Mobile Scroll, Storage Backend tests, Issue #92/#93 regression tests,
PostgreSQL Phase 1/2a/2b/2c (bootstrap, mutations, import, migration), Dependabot.

---

## 1. Totals by category

| Category | Files | Tests | Notes |
|---|---|---|---|
| `tests/security/` | 4 | 62 | |
| `tests/features/` | 33 | 347 | |
| `tests/ui/` | 26 | 205 | |
| `tests/a11y/` | 1 | 10 | |
| `tests/integration/` | 4 | 17 | |
| `tests/postgres/` | 4 | 34 | Requires Docker stack |
| **Total** | **72** | **675** | |
| **Total (no Postgres)** | **68** | **641** | Runs without Docker |

---

## 2. File-by-file inventory

### `tests/security/` (62 tests)
| File | Count | Scope |
|---|---|---|
| `test_csp.py` | 5 | CSP meta tag presence/correctness, no inline scripts/styles, nonce absence |
| `test_input_validation.py` | 17 | Numeric bounds, special chars, interest-rate, health gauge clamping, recurring day bounds, savings/emergency bounds, reconciliation, Unicode, paidMonths |
| `test_static_scan.py` | 21 | No eval/unsafe-inline, CSP sync (HTML+nginx), no hardcoded secrets, localStorage-only persistence in frontend, HTTPS-only fetches, no debug console.log, no inline styles |
| `test_xss.py` | 19 | escapeHtml() coverage for all user-text fields across all modules |

### `tests/features/` (347 tests)
| File | Count | Scope |
|---|---|---|
| `test_accounts.py` | 16 | CRUD, balance projection, interest rate badge, orphaning |
| `test_bills.py` | 5 | Legacy bills data model/calculations |
| `test_break_even.py` | 13 | Badge states, min-type toggle, accelerate modal, plan table, edge cases |
| `test_cash_flow_trend.py` | 5 | 1-month trend horizon |
| `test_debt_calculator.py` | 10 | 4 strategies, back-calculator, fixedAmount windows, stimulus |
| `test_debts.py` | 13 | CRUD, interest, amortization, strategy, payoff-date |
| `test_expenses.py` | 11 | CRUD + validation |
| `test_forecast.py` | 16 | Horizon/account, notable months, negative-balance, dip detection |
| `test_health.py` | 19 | All 6 dashboard cards, nav links, empty states |
| `test_i18n.py` | 12 | Locale switching, static translations, number/date formatting |
| `test_income.py` | 20 | Sources, frequencies, one-time entries, negative-amount rejection |
| `test_interest_income.py` | 20 | Monthly compounding, last-day posting, override-aware, Reports/Forecast integration |
| `test_issue_92_export.py` | 9 | Expense date in export regression |
| `test_issue_93_expense_save.py` | 10 | Expense save regression |
| `test_ledger.py` | 18 | Aggregation, override modal, key collision, CSV export, tie-break |
| `test_main_nav_groups.py` | 5 | Nav grouping/active-state |
| `test_money_flow_sankey.py` | 8 | Sankey chart data and rendering |
| `test_networth.py` | 6 | Snapshot, milestones, trend chart |
| `test_pwa.py` | 11 | Service worker, cache name sync, offline capability |
| `test_pwa_icons.py` | 5 | PWA icon set presence and sizes |
| `test_reconciliation.py` | 13 | Apply/history/expected-transactions/sanitization/import-export |
| `test_recurring.py` | 13 | 3 cadences, pause/skip, account linkage, validation |
| `test_recurring_occurrences.py` | 5 | Occurrence-date math |
| `test_reports.py` | 9 | Month offset, year-boundary, variance |
| `test_reports_nav_groups.py` | 5 | Reports tab grouping |
| `test_savings.py` | 7 | Emergency/sinking fund CRUD + coverage |
| `test_settings.py` | 10 | Reconciliation mode, storage backend persistence |
| `test_spending_analysis.py` | 7 | Category aggregation, drilldown |
| `test_storage_backend.py` | 8 | Backend switching (localStorage ↔ sessionStorage), preference persistence |
| `test_storage_import.py` | 21 | Sanitizer primitives, adversarial import, all record types, legacy v1.0 |
| `test_storage_quota.py` | 5 | Soft warning ~80%, dismissibility, hard-failure |
| `test_strategy.py` | 4 | Avalanche/Snowball/Priority switching, comparison panel |
| `test_versioning.py` | 8 | APP_VERSION ↔ CHANGELOG sync, descending order |

### `tests/ui/` (205 tests)
| File | Count | Scope |
|---|---|---|
| `test_accessibility.py` | 36 | Keyboard navigation, ARIA labels, semantic HTML |
| `test_chart_accessibility.py` | 4 | .sr-only data-table for health/spending/forecast/net-worth charts |
| `test_charts.py` | 4 | Chart.js instance destroy-before-recreate |
| `test_command_palette.py` | 10 | Ctrl+K open, filtering, empty-state, arrow-key nav, Enter/Escape |
| `test_css_load.py` | 7 | External stylesheet, utility classes, responsive breakpoints |
| `test_dark_mode.py` | 6 | Theme switching, contrast, persistence, corrupted-localStorage fallback |
| `test_data_transfer_modal.py` | 12 | Data transfer modal lifecycle and interactions |
| `test_debt_actions.py` | 1 | Inline edit flow |
| `test_guide_nav.py` | 11 | guide.html navigation and back-link |
| `test_guide_theme.py` | 3 | guide.html dark/light sync |
| `test_high_contrast_theme.py` | 10 | 3-way selector, class pairing, persistence, focus-ring, contrast regression |
| `test_main_nav.py` | 5 | Grouped active-state and keyboard reachability |
| `test_mobile.py` | 4 | Hamburger menu, viewport, touch sizing |
| `test_modals.py` | 5 | Visibility toggling, close buttons, amortization, calendar day-detail |
| `test_overview_print.py` | 7 | Print buttons on Overview pages |
| `test_pwa_update_banner.py` | 5 | Update-available banner and reload flow |
| `test_reconciliation_actions.py` | 8 | Reconcile-modal flow |
| `test_recurring_actions.py` | 4 | Mark-paid flow |
| `test_reduced_motion.py` | 3 | CSS transition-duration collapse + Chart.defaults.animation |
| `test_remaining_pages_print.py` | 7 | Print buttons on all remaining pages |
| `test_reports_actions.py` | 7 | Tab-switching visibility |
| `test_reports_nav.py` | 7 | Reports tab bar grouping, sticky, dark mode |
| `test_settings_theme_location.py` | 6 | Settings modal theme selector placement |
| `test_setup_wizard.py` | 12 | First-run modal, setting persistence, skip flow |
| `test_spending_ui.py` | 8 | Pie/bar charts, ranked list, drill-down modal |
| `test_table_mobile_scroll.py` | 13 | Ledger/reconcile/report tables scroll in .table-wrapper |

### `tests/a11y/` (10 tests)
| File | Count | Scope |
|---|---|---|
| `test_a11y_audit.py` | 10 | WCAG 2.1 AA site-wide: dangling ARIA refs, duplicate IDs, orphaned inputs, unnamed elements, missing alt, computed contrast, Escape-to-close, mobile nav aria-expanded |

### `tests/integration/` (17 tests)
| File | Count | Scope |
|---|---|---|
| `test_smoke.py` | 4 | Basic page loads, no console errors |
| `test_workflows.py` | 10 | Account→debt→net-worth→reconciliation, import/export, CSV |
| `test_interest_income_workflow.py` | 1 | Interest income end-to-end workflow |
| `test_pwa_offline.py` | 2 | PWA offline capability |

### `tests/postgres/` (34 tests — requires Docker stack)
| File | Count | Scope |
|---|---|---|
| `test_postgres_bootstrap.py` | 5 | Auth, login gate, session handling, CSRF |
| `test_postgres_import.py` | 10 | loadFromPostgres fan-out + import round-trip |
| `test_postgres_mutations.py` | 11 | Per-resource CRUD via pgPost/pgPatch/pgDelete |
| `test_postgres_migration.py` | 8 | local→Postgres one-time migration modal flow |

---

## 3. Coverage gaps (known)

- `src/reportsMoneyFlowSankey.js` — covered via `test_money_flow_sankey.py` (8 tests)
- `src/bonusAdvisor.js` — tested indirectly via income/accounts integration; no dedicated unit file
- `src/pgMigrationModal.js` — covered by `tests/postgres/test_postgres_migration.py`
- `src/loginGate.js` — covered by `tests/postgres/test_postgres_bootstrap.py`
- Mutation testing (Stryker) covers `src/debtCalculator.js`, `src/utils.js`, `src/sanitizers.js` — run separately via `npm run test:mutation`

---

## 4. Superseded audit files

| File | Tests at time | Date |
|---|---|---|
| `TEST_REPORT.md` | ~264 | May 31, 2026 |
| `FINAL_TEST_SUMMARY.md` | ~264 | June 8, 2026 |
| `TEST_SUITE_CLEANUP_SUMMARY.md` | ~264 | June 2026 |
| `TEST_REPORT_2026-06-28.md` | ~280 | June 28, 2026 |
| `TEST_SUITE_AUDIT_2026-06-19.md` | 324 | June 19, 2026 |
| **This file** | **675** | **August 31, 2026** |
