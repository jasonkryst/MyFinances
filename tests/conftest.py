#!/usr/bin/env python3
"""
Shared pytest fixtures and configuration for MyFinances test suite.
Provides common browser setup, test data, and utility functions.
"""

from datetime import date

import pytest
from playwright.sync_api import sync_playwright, Browser, Page
from playwright.async_api import async_playwright

# Configuration
BASE_URL = "http://localhost:5500/"
HEADLESS = True


def current_month_iso(day=1):
    """ISO date string for `day` in the real current calendar month.

    Report rendering (e.g. renderReportsSpending) derives "this month" from
    the browser's live `new Date()`, not from seeded fixture data. Tests that
    hardcode a fixed year-month (e.g. '2026-06-01') for data meant to land in
    "this month" silently start failing once the wall clock passes that month.
    Use this helper instead for any seed data that must fall in the current
    report month.
    """
    today = date.today()
    return f"{today.year:04d}-{today.month:02d}-{day:02d}"


# Sync fixtures
@pytest.fixture
def browser() -> Browser:
    """Create a browser instance for sync tests."""
    playwright = sync_playwright().start()
    browser = playwright.chromium.launch(headless=HEADLESS)
    yield browser
    browser.close()
    playwright.stop()


@pytest.fixture
def page(browser) -> Page:
    """Create a new page instance for each test."""
    page = browser.new_page()
    
    # Track console errors and page errors
    page.console_errors = []
    page.page_errors = []
    
    def on_console(msg):
        if msg.type == "error":
            text = msg.text or ""
            if "favicon" not in text.lower():
                page.console_errors.append(text)
    
    page.on("console", on_console)
    page.on("pageerror", lambda e: page.page_errors.append(str(e)))
    page.on("dialog", lambda d: d.accept())
    
    yield page
    page.close()


# Seeds localStorage with an already-onboarded, empty-but-valid state before
# any page script runs, so the first-run setup wizard (shown only when
# localStorage has no debtTrackerData key at all) doesn't pop up and block
# interaction in every other test. Tests that specifically want to exercise
# first-run/onboarding behavior should clear storage themselves and reload.
SKIP_FIRST_RUN_WIZARD_SCRIPT = """
    try {
        if (!localStorage.getItem('debtTrackerData')) {
            localStorage.setItem('debtTrackerData', JSON.stringify({ accounts: [], debts: [], settings: [] }));
        }
    } catch (e) {}
"""


@pytest.fixture
def app_page(page) -> Page:
    """Navigate to the app and return ready page."""
    page.add_init_script(SKIP_FIRST_RUN_WIZARD_SCRIPT)
    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
    return page


# Async fixtures
@pytest.fixture
async def async_browser():
    """Create a browser instance for async tests."""
    playwright = await async_playwright().start()
    browser = await playwright.chromium.launch(headless=HEADLESS)
    yield browser
    await browser.close()
    await playwright.stop()


@pytest.fixture
async def async_page(async_browser):
    """Create a new page instance for async tests."""
    page = await async_browser.new_page()
    
    # Track console and page errors
    page.console_errors = []
    page.page_errors = []
    
    def on_console(msg):
        if msg.type == "error":
            text = msg.text or ""
            if "favicon" not in text.lower():
                page.console_errors.append(text)
    
    page.on("console", on_console)
    page.on("pageerror", lambda e: page.page_errors.append(str(e)))
    page.on("dialog", lambda d: d.accept())
    
    yield page
    await page.close()


@pytest.fixture
async def async_app_page(async_page):
    """Navigate to app and return ready async page."""
    await async_page.add_init_script(SKIP_FIRST_RUN_WIZARD_SCRIPT)
    await async_page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
    return async_page


# Test data fixtures
@pytest.fixture
def account_data():
    """Standard account test data."""
    return {
        "name": "Test Checking",
        "type": "Checking",
        "balance": "5000"
    }


@pytest.fixture
def debt_data():
    """Standard debt test data."""
    return {
        "name": "Test Credit Card",
        "type": "creditCard",
        "balance": "2500",
        "interest_rate": "18.5",
        "min_payment": "100",
        "category": "Credit Card"
    }


@pytest.fixture
def income_data():
    """Standard income test data."""
    return {
        "name": "Salary",
        "amount": "5000",
        "first_date": "2026-05-01",
        "frequency": "monthly"
    }


@pytest.fixture
def expense_data():
    """Standard expense test data."""
    return {
        "name": "Groceries",
        "amount": "300",
        "date": "2026-05-15",
        "category": "Food & Groceries"
    }


@pytest.fixture
def recurring_data():
    """Standard recurring transaction test data."""
    return {
        "name": "Netflix",
        "amount": "15.99",
        "type": "Subscription",
        "frequency": "monthly",
        "start_date": "2026-05-01"
    }


@pytest.fixture
def health_data():
    """App state for exercising all six health dashboard metric cards.

    Inject via page.evaluate before calling app.switchPage('health').
    Produces: ~4% DTI (Healthy), Surplus cash flow, no emergency fund.
    """
    return {
        "income": {"id": 1, "name": "Salary", "amount": 5000,
                   "firstPayDate": "2026-06-01", "frequency": "monthly"},
        "debt": {"id": 2, "name": "Credit Card", "accountBalance": 2500,
                 "originalBalance": 2500, "minimumPayment": 200,
                 "interestRate": 18, "dueDate": 15, "debtType": "creditCard"},
        "bill": {"id": 3, "name": "Rent", "amount": 1200,
                 "dueDay": 1, "category": "Housing"},
    }


# Utility functions
def assert_no_errors(page):
    """Assert that page has no console or page errors."""
    assert len(page.console_errors) == 0, f"Console errors: {page.console_errors}"
    assert len(page.page_errors) == 0, f"Page errors: {page.page_errors}"


def create_account(page, account_data):
    """Helper to create an account via UI."""
    page.click('button[data-page="accounts"]')
    page.fill('#accountName', account_data["name"])
    page.select_option('#accountType', label=account_data["type"])
    page.fill('#accountStartingBalance', account_data["balance"])
    page.click('#accountFormSubmit')
    page.wait_for_selector(f'text={account_data["name"]}', timeout=10000)


def create_debt(page, debt_data):
    """Helper to create a debt via UI."""
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.click('#debtFormToggle')
    page.fill('#debtName', debt_data["name"])
    page.select_option('#debtType', debt_data["type"])
    page.fill('#accountBalance', debt_data["balance"])
    page.fill('#interestRate', debt_data["interest_rate"])
    page.fill('#minimumPayment', debt_data["min_payment"])
    if debt_data["type"] == "creditCard":
        page.fill('#dueDate', '15')
    page.click('#debtFormSubmit')
    page.wait_for_selector(f'text={debt_data["name"]}', timeout=10000)


def create_income(page, income_data):
    """Helper to create income source via UI."""
    page.click('button[data-page="income"]')
    page.fill('#incomeName', income_data["name"])
    page.fill('#incomeAmount', income_data["amount"])
    page.fill('#incomeFirstDate', income_data["first_date"])
    page.select_option('#incomeFrequency', income_data["frequency"])
    page.click('button:has-text("Add Income")')
    page.wait_for_selector(f'text={income_data["name"]}', timeout=10000)


# Pytest configuration hooks
def pytest_configure(config):
    """Configure pytest."""
    config.addinivalue_line(
        "markers", 
        "security: security tests (XSS, CSP, validation)"
    )
    config.addinivalue_line(
        "markers",
        "feature: feature-specific tests"
    )
    config.addinivalue_line(
        "markers",
        "ui: UI/UX tests (mobile, modals, dark mode)"
    )
    config.addinivalue_line(
        "markers",
        "integration: end-to-end workflow tests"
    )
    config.addinivalue_line(
        "markers",
        "slow: slow running tests"
    )
    config.addinivalue_line(
        "markers",
        "a11y: standalone accessibility audit checks (run_a11y_audit.py findings)"
    )
