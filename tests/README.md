# MyFinances Test Suite Documentation

## Overview

The MyFinances test suite is organized by functional category to ensure comprehensive coverage, maintainability, and clarity. All tests use Playwright for browser automation and follow pytest conventions.

**Current Status: Fully Passing**
- ✅ 768 Tests Passing across 6 categories (security, features, ui, a11y, integration, postgres — the last requires the Docker Postgres stack)
- ✅ Complete Feature Coverage including Financial Health Dashboard, Cash Flow Forecast, Account Reconciliation, Command Palette, Print/PDF, Reduced Motion, Storage Quota, Settings, PWA, i18n, and the optional PostgreSQL backend
- ✅ Direct unit coverage of every `utils.js` sanitizer primitive, plus adversarial/negative-input import tests for every record-type sanitizer
- ✅ 0 HIGH/MEDIUM Security Issues
- ✅ 100% CSP Compliance Verified

---

## Quick Start

### Prerequisites

```bash
pip install playwright pytest
playwright install chromium
```

### Running Tests

Run all tests:
```bash
pytest tests/ -v
```

Run by category:
```bash
pytest tests/security/ -v          # Security tests only
pytest tests/features/ -v          # Feature tests only
pytest tests/ui/ -v                # UI tests only
pytest tests/a11y/ -v               # Accessibility audit tests only
pytest tests/integration/ -v       # End-to-end tests only
pytest tests/postgres/ -v          # Postgres backend tests only (requires Docker stack)
```

Run specific test file:
```bash
pytest tests/features/test_accounts.py -v
```

Run with markers:
```bash
pytest -m "security" -v            # All security tests
pytest -m "feature" -v             # All feature tests
pytest -m "ui" -v                  # All UI tests
pytest -m "a11y" -v                # All accessibility audit tests
pytest -m "integration" -v         # All integration tests
pytest -m "not slow" -v            # Skip slow tests
```

Run with coverage:
```bash
pytest --cov=. --cov-report=html
```

### Prerequisites for Test Execution

**Local Server Must Be Running:**
- Default URL: `http://localhost:32900/`
- Can start a simple Python server: `python -m http.server 32900`
- Or use VS Code Live Server extension

---

## Test Organization

### Directory Structure

```
tests/
├── conftest.py                 # Shared fixtures and utilities
├── README.md                   # This file
├── security/                   # Security and compliance tests (65 tests)
│   ├── test_xss.py            # XSS prevention tests across all input surfaces
│   ├── test_csp.py            # CSP compliance + meta-tag/nginx-header sync check
│   ├── test_input_validation.py # Input sanitization, bounds checking, negative-amount guards
│   └── test_static_scan.py     # Static security scanning (0 HIGH/MEDIUM)
├── features/                   # Feature-specific tests (389+ tests, 37 files)
│   ├── test_accounts.py        # Account management (incl. delete-with-linked-items orphaning, interest-rate badge display)
│   ├── test_debts.py           # Debt/liability management, amortization, validation
│   ├── test_debt_calculator.py # Pure calculation engine (strategies, back-calculator, stimulus)
│   ├── test_break_even.py      # Per-debt break-even analysis (badge, accelerate modal, plan table columns)
│   ├── test_interest_income.py # Interest income engine, compounding, accounts UI badge, Reports/Forecast integration
│   ├── test_health.py          # Financial Health Dashboard (all six metric cards)
│   ├── test_income.py          # Income sources, add + inline-edit negative-amount rejection
│   ├── test_expenses.py        # Expense tracking (add/edit/delete, validation)
│   ├── test_bills.py           # Bill data model, sanitization, calculation integration
│   ├── test_recurring.py       # Recurring transactions (CRUD, mark-as-paid, validation)
│   ├── test_recurring_occurrences.py # Frequency-edge-case occurrence generation
│   ├── test_ledger.py          # Ledger filters, amount-override modal, cleared-checkbox tracking, CSV export column picker
│   ├── test_reports.py         # Reports functionality, tab grouping, date-boundary handling
│   ├── test_reports_nav_groups.py # Reports tab grouping structure
│   ├── test_main_nav_groups.py # Main nav grouping structure (Overview/Manage/Analyze)
│   ├── test_networth.py        # Net worth tracking, snapshots, milestones
│   ├── test_savings.py         # Emergency fund & sinking funds, persistence
│   ├── test_forecast.py        # Cash Flow Forecast (horizon, dip detection, drivers)
│   ├── test_reconciliation.py  # Account reconciliation, expected transactions, import/export
│   ├── test_spending_analysis.py # Spending category breakdowns, month-over-month trends
│   ├── test_storage_import.py  # Sanitizer unit tests + adversarial import tests
│   ├── test_storage_quota.py   # Soft warning at ~80%, hard-failure on write error, re-arming
│   ├── test_settings.py        # Reconciliation mode persistence and import/export round-trip
│   ├── test_strategy.py        # Strategy switching, comparison panel, stimulus validation
│   ├── test_plan_history.py    # Plan History logging/cap on Calculate, last-plan restore on reload (#162)
│   ├── test_validation_modals.py     # Themed #alertModal replaces native browser alert() for all form validation errors
│   ├── test_storage_backend.py       # localStorage vs. sessionStorage adapter selection, default/compat path, switchStorageBackend migration
│   ├── test_i18n.py            # Locale storage, t() lookup with English fallback, applyStaticTranslations(); Spanish/Polish pilot scope
│   ├── test_pwa.py             # manifest.json validity, SW precache list vs. src/ + APP_VERSION sync, SW browser registration
│   ├── test_pwa_icons.py       # PNG icon assets from tools/generate-icons.js: correct dimensions via IHDR chunk parse, no Pillow dep
│   ├── test_cash_flow_trend.py # getCashFlowTrendSeries() income/outflow/net per month correctness; rendered chart widget
│   ├── test_money_flow_sankey.py     # computeMoneyFlowSankeyData() node/link grouping: income→hub→outflow categories
│   ├── test_analytics.py       # GA disabled by default; only injects gtag.js when window.__ENV__.GA_MEASUREMENT_ID is present
│   ├── test_versioning.py      # APP_VERSION (utils.js) and most-recent CHANGELOG.md entry stay in sync (issue #59)
│   ├── test_retirement.py      # Retirement account type/fields, snapshot logging, charts, projection, export/import round-trip
│   ├── test_issue_92_export.py # Regression: perMonthStimulus export gap, hardcoded export version, no-data guard, merge mode (#92)
│   └── test_issue_93_expense_save.py # Regression: expense.date stored as Date object → JSON timestamp → sanitizeDateISO drops it (#93)
├── ui/                         # UI/UX and responsive tests (254 tests, 30 files)
│   ├── test_mobile.py          # Mobile responsiveness, hamburger menu, touch sizing
│   ├── test_modals.py          # Modal visibility, close buttons, calendar day-detail
│   ├── test_dark_mode.py       # Dark/light theme selection, persistence, corrupted-localStorage fallback
│   ├── test_high_contrast_theme.py # 3-way theme selector, dark-mode+high-contrast-mode pairing, persistence, focus ring
│   ├── test_css_load.py        # External stylesheet, utility classes, responsive breakpoints
│   ├── test_accessibility.py   # Keyboard nav, ARIA labels, semantic HTML, Results tab-bar
│   ├── test_charts.py          # Chart.js destroy-before-recreate on repeated re-render
│   ├── test_chart_accessibility.py # .sr-only data-table fallback for health/spending/forecast/net-worth/strategy/budget charts
│   ├── test_guide_theme.py     # guide.html dark-mode sync via guideTheme.js
│   ├── test_guide_nav.py       # guide.html sticky nav, back-link, mobile behavior
│   ├── test_reduced_motion.py  # CSS transitions collapse + Chart.defaults.animation disabled
│   ├── test_command_palette.py # Ctrl+K open/filter/navigate/close; action commands
│   ├── test_setup_wizard.py    # First-run modal, setting persistence, skip flow
│   ├── test_overview_print.py  # Print button on Health, Accounts, Income pages
│   ├── test_remaining_pages_print.py # Print button on Liabilities, Recurring, Plan, Savings, Ledger, Reconcile
│   ├── test_table_mobile_scroll.py   # Ledger/reconciliation/report tables scroll in .table-wrapper on narrow viewports
│   ├── test_main_nav.py        # Main nav active-state highlighting, keyboard reachability
│   ├── test_reports_nav.py     # Reports tab bar grouping, sticky positioning, dark mode
│   ├── test_debt_actions.py    # Debt card inline edit, delete, payoff-date display
│   ├── test_recurring_actions.py # Recurring pause/skip/edit/mark-paid actions
│   ├── test_reports_actions.py # Reports tab switching, snapshot capture, spending drill-down
│   ├── test_reconciliation_actions.py # Reconcile-modal flows, history filter/delete
│   ├── test_spending_ui.py     # Spending charts, ranked list, drill-down modal
│   ├── test_strategy_calendar.py # Strategy mini-calendar: debt/income/bill/expense/bonus day-markers
│   ├── test_whatif_simulator.py # What-If slider: immediate label update, debounced simulation
│   ├── test_data_transfer_modal.py   # Consolidated Backup & Restore two-tab modal; import inline feedback replaces alert()/confirm()
│   ├── test_delete_confirm_modal.py  # Themed #deleteConfirmModal replaces native browser confirm() for all destructive deletes
│   ├── test_settings_theme_location.py # Theme selector moved from toolbar into Settings modal (#71); location and label coverage
│   ├── test_pwa_update_banner.py     # app.showUpdateAvailableBanner() called directly with stub worker; banner show/dismiss/reload
│   └── test_login_gate_theme.py      # Login gate overlay matches light-mode body gradient + header band; dark/high-contrast in peer tests
├── a11y/                        # Site-wide accessibility audit (10 tests)
│   ├── run_a11y_audit.py       # Standalone Playwright audit script (also runnable directly)
│   └── test_a11y_audit.py      # Pytest wiring: asserts zero Serious findings from the audit
├── integration/                 # End-to-end workflow tests (18 tests)
│   ├── test_smoke.py            # Full application smoke test (account → debt → net worth)
│   ├── test_workflows.py        # Multi-step workflows, JSON/CSV import/export, ledger CSV column picker, clear-data/reimport
│   ├── test_interest_income_workflow.py # End-to-end interest income workflow
│   └── test_pwa_offline.py      # Offline app-shell behavior via the service worker
└── postgres/                     # Optional PostgreSQL backend tests (47 tests — requires Docker stack)
    ├── test_postgres_bootstrap.py     # Auth, login gate, session handling
    ├── test_postgres_import.py        # loadFromPostgres fan-out + import round-trip
    ├── test_postgres_mutations.py     # Per-resource CRUD via pgPost/pgPatch/pgDelete
    ├── test_postgres_migration.py     # local→Postgres one-time migration modal flow
    ├── test_postgres_notifications.py # Mailpit-backed end-to-end coverage for the test-email flow
    └── test_postgres_setup_wizard.py  # First-run setup wizard against the Postgres backend
```

> The directory tree and "Test Categories" prose below were last fully reviewed on 2026-09-13 (issue #151). New test files should be added to both the tree (one-line description) and the prose (#### block) when merged.

> Ad-hoc manual debugging scripts (no `test_*` functions) live in `tools/debug/`, outside the `tests/` tree, so `tests/` only contains real pytest-collected tests.

---

## Test Categories

### 🔐 Security Tests (`tests/security/`)

**Purpose:** Verify security measures, prevent vulnerabilities, ensure compliance.

#### test_xss.py
- **Tests:** XSS prevention in all input fields
- **Coverage:** Account names, income sources, debt names, amount fields
- **Verification:** Confirms scripts are escaped and rendered as text
- **Status:** ✅ PASSING

#### test_csp.py
- **Tests:** Content Security Policy compliance
- **Coverage:** No unsafe-inline directives, proper header configuration
- **Verification:** Ensures strict CSP enforcement
- **Status:** ✅ PASSING

#### test_input_validation.py
- **Tests:** Input validation and sanitization
- **Coverage:** Amount fields, date fields, special characters
- **Verification:** Prevents invalid data persistence
- **Status:** ✅ PASSING

#### test_static_scan.py
- **Tests:** Static security analysis
- **Coverage:** Dependencies, code patterns, known vulnerabilities
- **Verification:** Zero HIGH/MEDIUM issues
- **Status:** ✅ PASSING

---

### 🎯 Feature Tests (`tests/features/`)

**Purpose:** Test individual feature functionality in isolation.

#### test_health.py
- **Tests:** Financial Health Dashboard — all six metric cards
- **Coverage:** DTI ratio classification, savings rate gauge, emergency fund coverage,
  debt payoff timeline (debt-free vs. active), monthly cash flow (surplus/deficit/break-even),
  budget allocation categories, internal nav links, no-error assertion
- **Fixtures:** `health_data`
- **Status:** ✅ PASSING

#### test_accounts.py
- **Tests:** Account CRUD operations, net worth calculations
- **Coverage:** Add, edit, delete accounts; account types (checking, savings, credit card); deleting an account with a linked income source orphans gracefully (no crash in health/reports rendering)
- **Fixtures:** `account_data`, `create_account`
- **Status:** ✅ PASSING

#### test_debts.py
- **Tests:** Debt management and amortization
- **Coverage:** Add debt, calculate interest, payment schedule, payoff strategies, negative fixed-amount-payment rejection
- **Fixtures:** `debt_data`, `create_debt`
- **Status:** ✅ PASSING

#### test_income.py
- **Tests:** Income source management
- **Coverage:** Add income, recurring frequency, total income calculation, negative income/bonus amount rejection on both the add and inline-edit (`saveEditIncome`/`saveEditBonus`) paths
- **Fixtures:** `income_data`, `create_income`
- **Status:** ✅ PASSING

#### test_expenses.py
- **Tests:** Expense tracking and categorization
- **Coverage:** Add expense, categories, amount validation, monthly totals
- **Fixtures:** `expense_data`
- **Status:** ✅ PASSING

#### test_recurring.py
- **Tests:** Recurring transaction templates
- **Coverage:** Create recurring transactions, frequency options, auto-generation
- **Fixtures:** `recurring_data`
- **Status:** ✅ PASSING

#### test_ledger.py
- **Tests:** Transaction history and ledger operations
- **Coverage:** Filters, date ranges, amount overrides, sorting
- **Status:** ✅ PASSING

#### test_reports.py
- **Tests:** Report generation and analysis
- **Coverage:** Income vs Expenses, money flow, variance analysis, date ranges
- **Status:** ✅ PASSING

#### test_networth.py
- **Tests:** Net worth tracking and historical snapshots
- **Coverage:** Net worth calculation, assets, liabilities, trends
- **Status:** ✅ PASSING

#### test_strategy.py
- **Tests:** Payment strategy switching and the per-month stimulus input
- **Coverage:** Avalanche/Snowball/Priority-Lowest/Priority-Highest switching with no console errors, strategy comparison panel row count, stimulus amount raising a month's total paid, non-numeric stimulus input falling back to 0 (not NaN)
- **Status:** ✅ PASSING

#### test_validation_modals.py
- **Tests:** Themed `#alertModal` replaces native `alert()` for all form-validation errors
- **Coverage:** Modal present and hidden on load; valid submissions succeed without a modal; invalid submissions (missing name, bad amounts, duplicate names) show the modal with the correct message; modal dismissible via OK button and Escape key
- **Status:** ✅ PASSING

#### test_storage_backend.py
- **Tests:** `localStorage` vs. `sessionStorage` adapter selection and migration
- **Coverage:** Default backend is `localStorage` (backward-compatible); data written through one adapter is not visible through the other; `switchStorageBackend()` migrates in-memory state to the new backend and removes it from the old one
- **Status:** ✅ PASSING

#### test_i18n.py
- **Tests:** Locale preference, `t()` lookup, and `applyStaticTranslations()` for `[data-i18n]` elements
- **Coverage:** Default locale is English (no `debtTrackerLocale` key); Settings modal exposes en/es/pl selector; switching to Spanish/Polish changes nav and toolbar text via `[data-i18n]` without reloading; unknown key falls back to raw key string (no crash)
- **Status:** ✅ PASSING

#### test_pwa.py
- **Tests:** PWA manifest validity, service-worker precache sync, and SW registration
- **Coverage:** `manifest.json` is valid JSON with all required fields; precache list in `sw.js` matches actual `src/` files and contains the current `APP_VERSION`; SW successfully registers in Chromium; manifest icon paths resolve to real files
- **Note:** Offline app-shell behavior is in `tests/integration/test_pwa_offline.py`; update-banner is in `tests/ui/test_pwa_update_banner.py`
- **Status:** ✅ PASSING

#### test_pwa_icons.py
- **Tests:** PNG icon assets generated by `tools/generate-icons.js`
- **Coverage:** Each icon listed in `manifest.json` exists on disk and has the correct pixel dimensions, verified via direct IHDR chunk parsing (no Pillow/image-library dependency, consistent with the app's zero-new-deps constraint)
- **Status:** ✅ PASSING

#### test_cash_flow_trend.py
- **Tests:** `getCashFlowTrendSeries()` data-layer correctness and rendered chart widget
- **Coverage:** Returns correct income/outflow/net per month oldest-first for a multi-month window ending at the current report month; respects `app._reportMonthOffset`; chart canvas renders without errors
- **Status:** ✅ PASSING

#### test_money_flow_sankey.py
- **Tests:** `computeMoneyFlowSankeyData()` Sankey node/link grouping
- **Coverage:** Income sources become source nodes; a single "Account" hub is the intermediate node; bills/expenses group by category, debts and savings by name; link amounts match the summed transactions; zero-flow sources are excluded
- **Status:** ✅ PASSING

#### test_analytics.py
- **Tests:** Google Analytics disabled by default; only injects when `window.__ENV__.GA_MEASUREMENT_ID` is set
- **Coverage:** Negative case (no env var) — no `<script src="gtag.js">` injected, no network call, no console errors; positive case (env var injected) — `<script>` is added and `window.dataLayer` initialized; GA is never active in the standard test-server environment
- **Status:** ✅ PASSING

#### test_versioning.py
- **Tests:** `APP_VERSION` (in `src/utils.js`) and the most recent `CHANGELOG.md` entry stay in sync (issue #59)
- **Coverage:** Parses both files with plain regexes (no browser required); fails if the version string doesn't match the latest `## [x.y.z]` heading; also enforces that changelog headings are in descending order
- **Status:** ✅ PASSING

#### test_retirement.py
- **Tests:** Retirement accounts dashboard end-to-end
- **Coverage:** Retirement account type with subtype/rate/employer-match fields; snapshot logging (add/edit/delete); balance-over-time, contribution-vs-growth, and breakdown charts render without errors; projection panel shows a value; full export/import round-trip preserves all retirement data including snapshots
- **Status:** ✅ PASSING

#### test_issue_92_export.py
- **Tests:** Regression suite for import/export gaps fixed in issue #92
- **Coverage:** `perMonthStimulus` round-trips through export/import; exported version reads `APP_VERSION` not a hardcoded string; "no data" guard accepts files containing only accounts, savings goals, or reconciliations; merge mode preserves rather than replaces non-debt collections
- **Status:** ✅ PASSING

#### test_issue_93_expense_save.py
- **Tests:** Regression suite for the expense-date serialization bug fixed in issue #93
- **Coverage:** `expense.date` stored as a bare `YYYY-MM-DD` string survives a save/reload cycle; the self-healing path in `sanitizeDateISO` converts legacy full ISO timestamps without dropping them; form boundary validation rejects non-date input
- **Status:** ✅ PASSING

---

### 🎨 UI Tests (`tests/ui/`)

**Purpose:** Verify user interface functionality and responsiveness.

#### test_mobile.py
- **Tests:** Mobile responsive design
- **Coverage:** Menu toggles, button sizing, layout reflow, touch interactions
- **Status:** ✅ PASSING

#### test_modals.py
- **Tests:** Modal visibility and behavior
- **Coverage:** Open/close interactions, amortization details, close buttons
- **Status:** ✅ PASSING

#### test_dark_mode.py
- **Tests:** Dark mode toggle functionality
- **Coverage:** Theme switching, persistence, styling application
- **Status:** ✅ PASSING

#### test_css_load.py
- **Tests:** CSS loading and style application
- **Coverage:** External stylesheet, utility classes, responsive breakpoints
- **Status:** ✅ PASSING

#### test_charts.py
- **Tests:** Chart.js instance lifecycle on repeated re-render
- **Coverage:** Balance, health-DTI, net-worth-trend, and cash-flow-forecast charts each have exactly one live `Chart.getChart()` instance (no leaked duplicates) and produce no console/page errors after 3 repeated recalculations/tab-switches
- **Status:** ✅ PASSING

#### test_guide_theme.py
- **Tests:** `guide.html` dark-mode sync via `src/guideTheme.js`
- **Coverage:** Dark mode applied when `debtTrackerTheme` is `'dark'`; stays light when the key is absent; stays light when explicitly `'light'`
- **Status:** ✅ PASSING

#### test_data_transfer_modal.py
- **Tests:** Consolidated Backup & Restore two-tab modal (`#dataTransferModal`)
- **Coverage:** Old standalone toolbar Export/Import buttons are gone; `#dataTransferBtn` opens the modal; Export tab renders a JSON download button; Import tab's validation errors (invalid JSON, no data, file too large) render inline rather than via `alert()`/`confirm()`; modal closes correctly
- **Status:** ✅ PASSING

#### test_delete_confirm_modal.py
- **Tests:** Themed `#deleteConfirmModal` replaces native `confirm()` for all destructive deletes
- **Coverage:** Modal is present and hidden on load; each delete action (account, debt, income, expense, recurring, milestone) opens the modal rather than a browser dialog; Cancel leaves the record in place; Confirm performs the deletion; modal is reusable across multiple consecutive deletes
- **Status:** ✅ PASSING

#### test_settings_theme_location.py
- **Tests:** Theme selector moved from toolbar into Settings modal (issue #71)
- **Coverage:** `#themeSwitcher` is inside `#settingsModal`, not the header toolbar; it is visible and labeled once Settings is open; opening and closing Settings does not change the currently-applied theme
- **Status:** ✅ PASSING

#### test_pwa_update_banner.py
- **Tests:** Service-worker update-available banner
- **Coverage:** `app.showUpdateAvailableBanner(fakeWorker)` shows the banner with a Reload button; clicking Reload calls `postMessage({type:'SKIP_WAITING'})` on the stub worker; banner disappears after dismissal; calling the method twice does not stack two banners
- **Note:** Calls the method directly with a stub worker object rather than forcing a real SW update cycle, matching the pattern used in `test_storage_quota.py`
- **Status:** ✅ PASSING

#### test_login_gate_theme.py
- **Tests:** Login gate overlay (`#loginGate`) matches the site's light-mode visual theme
- **Coverage:** Overlay gradient matches `<body>`'s backdrop; header band reuses the `<header>`'s blue gradient and goal logo; card body is flat/opaque; dark-mode and high-contrast variants are tested in `test_dark_mode.py` and `test_high_contrast_theme.py` respectively
- **Status:** ✅ PASSING

---

### ♿ Accessibility Audit (`tests/a11y/`)

**Purpose:** Site-wide accessibility sweep, complementing the targeted checks in `tests/ui/test_accessibility.py`.

#### test_a11y_audit.py
- **Tests:** Pytest wiring around `run_a11y_audit.py`'s `collect_audit_findings()`
- **Coverage:** Dangling ARIA references, duplicate IDs, orphaned form inputs, unnamed interactive elements, missing image alt text, and computed WCAG 1.4.3 color contrast across all 10 SPA pages (light + dark mode) and guide.html, plus Update Balance modal Escape-to-close and mobile nav `aria-expanded` toggle behavior
- **Note:** Two categories of known tool measurement artifacts (gradient/translucent-overlay backgrounds producing a meaningless `ratio ≈ 1`, and a modal title id that only exists once the modal is opened) are explicitly filtered with documented rationale — see the module docstring and `_is_gradient_header_false_positive`/`_is_dynamic_modal_title_false_positive` in the test file
- **Status:** ✅ PASSING

Run: `pytest tests/a11y/ -v`

---

### 🔄 Integration Tests (`tests/integration/`)

**Purpose:** Test complete workflows and feature interactions.

#### test_smoke.py
- **Tests:** Full application smoke test
- **Coverage:** Create account → add income → add debt → calculate net worth
- **Scope:** All major features in sequence
- **Status:** ✅ PASSING

#### test_workflows.py
- **Tests:** Complex multi-step workflows
- **Coverage:** Full debt payoff planning, account reconciliation, report generation, JSON/CSV export-import round-trips (incl. comma-escaping in debt names), full clear-all-data → reimport → render-every-page consistency
- **Status:** ✅ PASSING

---

## Fixtures and Utilities

All fixtures are defined in `conftest.py` and available to all tests.

### Browser Fixtures

- **`browser`** - Chromium browser instance (sync)
- **`page`** - Browser page with error tracking (sync)
- **`app_page`** - Page with app loaded at BASE_URL (sync)
- **`async_browser`** - Chromium browser instance (async)
- **`async_page`** - Browser page with error tracking (async)
- **`async_app_page`** - Page with app loaded at BASE_URL (async)

### Data Fixtures

- **`account_data`** - Standard account test data
- **`debt_data`** - Standard debt test data
- **`income_data`** - Standard income test data
- **`expense_data`** - Standard expense test data
- **`recurring_data`** - Standard recurring transaction data

### Helper Functions

```python
# Available from conftest
from conftest import assert_no_errors, create_account, create_debt, create_income

# Verify no console/page errors
assert_no_errors(page)

# Create test data via UI
create_account(page, account_data)
create_debt(page, debt_data)
create_income(page, income_data)
```

---

## Configuration

### Base URL
- **Default:** `http://localhost:32900/`
- **Set in:** `conftest.py` → `BASE_URL`
- **Used by:** All `app_page` and `async_app_page` fixtures

### Headless Mode
- **Default:** `HEADLESS = True`
- **Set in:** `conftest.py` → `HEADLESS`
- **Change to:** `False` for visual debugging

### Timeouts
- **Page Load:** 60 seconds
- **Element Wait:** 10 seconds
- **Animation Wait:** 500-1000ms
- **Selectors:** Adjusted per test needs

---

## Test Markers

Use pytest markers to organize and filter tests:

```bash
pytest -m "security"      # Security/compliance tests
pytest -m "feature"       # Feature tests
pytest -m "ui"            # UI tests
pytest -m "a11y"          # Accessibility audit tests
pytest -m "integration"   # Integration tests
pytest -m "slow"          # Slow running tests (>5s)
pytest -m "not slow"      # Exclude slow tests
```

Add markers to tests:
```python
@pytest.mark.security
def test_xss_protection():
    pass

@pytest.mark.integration
@pytest.mark.slow
def test_full_workflow():
    pass
```

---

## Coverage Analysis

### Feature Coverage

| Feature | Unit | Feature | UI | E2E | Security |
|---------|------|---------|----|----|----------|
| Accounts | N/A | ✅ | ✅ | ✅ | ✅ |
| Income | N/A | ✅ | ✅ | ✅ | ✅ |
| Debts | N/A | ✅ | ✅ | ✅ | ✅ |
| Debt Calculator (engine) | ✅ | N/A | N/A | N/A | N/A |
| Expenses | N/A | ✅ | ✅ | ✅ | ✅ |
| Bills | N/A | ✅ | N/A | ✅ | N/A |
| Recurring | N/A | ✅ | ✅ | ✅ | ✅ |
| Ledger | N/A | ✅ | ✅ | ✅ | ✅ |
| Reports | N/A | ✅ | ✅ | ✅ | ✅ |
| Savings | N/A | ✅ | N/A | N/A | N/A |
| Net Worth | N/A | ✅ | ✅ | ✅ | ✅ |
| **Health Dashboard** | N/A | ✅ | ✅ | ✅ | ✅ |
| Cash Flow Forecast | N/A | ✅ | ✅ | N/A | N/A |
| Account Reconciliation | N/A | ✅ | ✅ | N/A | ✅ |
| Spending Analysis | N/A | ✅ | ✅ | N/A | ✅ |
| Storage Import/Sanitizers | ✅ | ✅ | N/A | ✅ | ✅ |
| Storage Quota Monitoring | N/A | ✅ | N/A | N/A | N/A |
| Settings / Recon Mode | N/A | ✅ | ✅ | N/A | N/A |
| Command Palette | N/A | N/A | ✅ | N/A | N/A |
| Print / Save as PDF | N/A | N/A | ✅ | N/A | N/A |
| Reduced Motion | N/A | N/A | ✅ | N/A | N/A |
| Chart Accessibility | N/A | N/A | ✅ | N/A | N/A |
| Dark Mode | N/A | ✅ | ✅ | ⚠️ | N/A |
| Mobile | N/A | ✅ | ✅ | ✅ | N/A |
| CSP | N/A | ✅ | ✅ | ✅ | ✅ |
| XSS | N/A | ✅ | ✅ | ✅ | ✅ |
| Accessibility | N/A | N/A | ✅ | ✅ | N/A |
| PWA (installability + offline) | N/A | ✅ | ✅ | ✅ | N/A |
| i18n (locale switching) | N/A | ✅ | N/A | N/A | N/A |
| PostgreSQL Backend (optional) | N/A | N/A | ✅ | N/A | N/A |

**Legend:** ✅ Complete | ⚠️ Partial | N/A Not Applicable

Postgres-backend-specific coverage (bootstrap/login, per-resource mutation, import fan-out, migration modal, setup wizard) lives in `tests/postgres/` and is not broken out by feature in the table above — see the directory structure earlier in this document.

---

## Common Test Patterns

### Basic Feature Test
```python
def test_create_account(app_page, account_data):
    """Test creating a new account."""
    page = app_page
    
    # Navigate to accounts
    page.click('button[data-page="accounts"]')
    
    # Fill form
    page.fill('#accountName', account_data["name"])
    page.select_option('#accountType', label=account_data["type"])
    page.fill('#accountStartingBalance', account_data["balance"])
    
    # Submit
    page.click('#accountFormSubmit')
    
    # Verify
    page.wait_for_selector(f'text={account_data["name"]}', timeout=10000)
    assert_no_errors(page)
```

### Security Test
```python
@pytest.mark.security
def test_xss_in_account_name(app_page):
    """Test XSS prevention in account names."""
    page = app_page
    
    # Attempt XSS payload
    page.fill('#accountName', '<script>alert("xss")</script>')
    page.select_option('#accountType', 'Checking')
    page.fill('#accountStartingBalance', '1000')
    page.click('#accountFormSubmit')
    
    # Verify script was escaped
    text = page.evaluate('document.querySelector(".acct-card-name")?.textContent')
    assert '<script>' not in text
    assert_no_errors(page)
```

### Async Test
```python
@pytest.mark.integration
async def test_full_workflow(async_app_page):
    """Test complete workflow asynchronously."""
    page = async_app_page
    
    # Create account
    await page.fill('#accountName', 'Test Account')
    await page.click('#accountFormSubmit')
    
    # Verify
    await page.wait_for_selector('text=Test Account', timeout=10000)
```

---

## Troubleshooting

### Test Fails with "Connection Refused"
- **Issue:** Server not running
- **Solution:** Start local server: `python -m http.server 32900`
- **Check:** Verify BASE_URL in conftest.py matches server port

### Test Times Out Waiting for Element
- **Issue:** Selector incorrect or element not rendered
- **Solution:** 
  - Use browser dev tools to verify selector
  - Add wait_for_load_state('networkidle') before waits
  - Increase timeout if app is slow

### Console/Page Errors Detected
- **Issue:** JavaScript errors during test
- **Solution:**
  - Check browser console for specific errors
  - Review assert_no_errors output
  - May indicate app bug, not test issue

### Tests Pass Locally but Fail in CI
- **Issue:** Environment differences
- **Solution:**
  - Check BASE_URL matches CI server
  - Verify Playwright installed in CI
  - Check for timezone/locale differences

---

## Best Practices

1. **Use Fixtures** - Leverage conftest.py helpers instead of repeating code
2. **Test Isolation** - Each test should be independent and idempotent
3. **Clear Names** - Test names should describe what is being tested
4. **Assertions** - Use `assert_no_errors(page)` to catch hidden issues
5. **Markers** - Tag tests with appropriate markers for filtering
6. **Data** - Use fixture-based test data, not hardcoded values
7. **Waits** - Use appropriate waits (element, networkidle, timeout)
8. **Cleanup** - Fixtures automatically handle page/browser cleanup

---

## CI/CD Integration

To run tests in CI pipeline:

```yaml
# GitHub Actions example
- name: Run Tests
  run: |
    pip install -r requirements.txt
    playwright install chromium
    python -m http.server 32900 &
    sleep 2
    pytest tests/ -v --tb=short
```

---

## Contributing New Tests

1. **Identify test category** (security/features/ui/a11y/integration)
2. **Create test file** in appropriate subdirectory
3. **Use conftest fixtures** for page, data, helpers
4. **Add pytest markers** for categorization
5. **Follow naming conventions** (test_<feature>.py)
6. **Document purpose** in docstring
7. **Run locally:** `pytest tests/yourfile.py -v`

---

## Questions?

Refer to:
- **Playwright Docs:** https://playwright.dev/python/
- **Pytest Docs:** https://docs.pytest.org/
- **App Docs:** See README.md and docs/implementation/IMPLEMENTATION_SUMMARY.md

---

**Last Updated:** September 13, 2026 (issue #151 — prose write-ups for all test files)  
**Test Suite Status:** ✅ Fully Passing (778+ tests / 81+ files, incl. 47 Postgres/CI-only tests across 7 files)
