# MyFinances Test Suite Documentation

## Overview

The MyFinances test suite is organized by functional category to ensure comprehensive coverage, maintainability, and clarity. All tests use Playwright for browser automation and follow pytest conventions.

**Current Status: Fully Passing**
- ✅ 342 Tests Passing across 5 categories (security, features, ui, a11y, integration)
- ✅ Complete Feature Coverage including Financial Health Dashboard, Cash Flow Forecast, and Account Reconciliation
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
- Default URL: `http://localhost:5500/`
- Can start a simple Python server: `python -m http.server 5500`
- Or use VS Code Live Server extension

---

## Test Organization

### Directory Structure

```
tests/
├── conftest.py                 # Shared fixtures and utilities
├── README.md                   # This file
├── security/                   # Security and compliance tests (51 tests)
│   ├── test_xss.py            # XSS prevention tests
│   ├── test_csp.py            # CSP compliance tests
│   ├── test_input_validation.py # Input sanitization tests
│   └── test_static_scan.py     # Static security scanning
├── features/                   # Feature-specific tests (177 tests)
│   ├── test_accounts.py        # Account management (incl. delete-with-linked-items orphaning)
│   ├── test_debts.py           # Debt/liability management
│   ├── test_debt_calculator.py # Pure calculation engine (strategies, back-calculator, stimulus)
│   ├── test_health.py          # Financial Health Dashboard
│   ├── test_income.py          # Income source management
│   ├── test_expenses.py        # Expense tracking (add/edit/delete, validation)
│   ├── test_bills.py           # Bill data model, sanitization, calculation integration
│   ├── test_recurring.py       # Recurring transactions
│   ├── test_recurring_occurrences.py # Recurring occurrence generation (frequency edge cases)
│   ├── test_ledger.py          # Ledger, history, amount-override modal
│   ├── test_reports.py         # Reports functionality
│   ├── test_reports_nav_groups.py # Reports tab grouping structure
│   ├── test_main_nav_groups.py # Main nav grouping structure
│   ├── test_networth.py        # Net worth tracking
│   ├── test_forecast.py        # Cash Flow Forecast
│   ├── test_reconciliation.py  # Account reconciliation
│   ├── test_spending_analysis.py # Spending category breakdowns
│   ├── test_storage_import.py  # Sanitizer unit tests + adversarial import tests
│   └── test_strategy.py        # Strategy switching, comparison panel, stimulus validation
├── ui/                         # UI/UX and responsive tests (95 tests)
│   ├── test_mobile.py          # Mobile responsiveness
│   ├── test_modals.py          # Modal visibility and behavior
│   ├── test_dark_mode.py       # Dark mode functionality, corrupted-theme fallback
│   ├── test_css_load.py        # CSS loading and styling
│   ├── test_accessibility.py  # Keyboard navigation, ARIA, semantic HTML, Results tab bar
│   ├── test_charts.py          # Chart.js destroy-before-recreate on repeated re-render
│   ├── test_guide_theme.py     # guide.html dark-mode sync with saved theme preference
│   ├── test_main_nav.py        # Main nav active-state & keyboard reachability
│   ├── test_reports_nav.py     # Reports tab bar grouping/sticky positioning
│   ├── test_debt_actions.py    # Debt card inline actions
│   ├── test_recurring_actions.py # Recurring pause/skip/edit/mark-paid actions
│   ├── test_reports_actions.py # Reports tab switching, snapshot capture
│   ├── test_reconciliation_actions.py # Reconcile-modal flows
│   └── test_spending_ui.py     # Spending charts, ranked list, drill-down modal
├── a11y/                        # Site-wide accessibility audit (8 tests)
│   ├── run_a11y_audit.py       # Standalone Playwright audit script (also runnable via CLI)
│   └── test_a11y_audit.py      # Pytest wiring: asserts zero Serious findings from the audit
└── integration/                 # End-to-end workflow tests (11 tests)
    ├── test_smoke.py            # Full application smoke test
    └── test_workflows.py        # Multi-step workflows, import/export, clear-data/reimport
```

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
- **Coverage:** Add income, recurring frequency, total income calculation, negative income/bonus amount rejection
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
- **Default:** `http://localhost:5500/`
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
| Net Worth | N/A | ✅ | ✅ | ✅ | ✅ |
| **Health Dashboard** | N/A | ✅ | ✅ | ✅ | ✅ |
| Cash Flow Forecast | N/A | ✅ | ✅ | N/A | N/A |
| Account Reconciliation | N/A | ✅ | ✅ | N/A | ✅ |
| Spending Analysis | N/A | ✅ | ✅ | N/A | ✅ |
| Storage Import/Sanitizers | ✅ | ✅ | N/A | ✅ | ✅ |
| Dark Mode | N/A | ✅ | ✅ | ⚠️ | N/A |
| Mobile | N/A | ✅ | ✅ | ✅ | N/A |
| CSP | N/A | ✅ | ✅ | ✅ | ✅ |
| XSS | N/A | ✅ | ✅ | ✅ | ✅ |
| Accessibility | N/A | N/A | ✅ | ✅ | N/A |

**Legend:** ✅ Complete | ⚠️ Partial | N/A Not Applicable

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
- **Solution:** Start local server: `python -m http.server 5500`
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
    python -m http.server 5500 &
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

**Last Updated:** June 19, 2026  
**Test Suite Status:** ✅ Fully Passing (342 tests)
