#!/usr/bin/env python3
"""
Sort and filter controls tests (issue #219)

Covers sort/filter toolbars on the Debts, Recurring, and Accounts pages.
"""

import pytest

from tests.conftest import assert_no_errors


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _go_debts(page):
    page.click('button[data-page="liabilities"]')
    page.wait_for_selector('#liabilitiesSection.active', timeout=5000)


def _go_recurring(page):
    page.click('button[data-page="recurring"]')
    page.wait_for_selector('#recurringSection.active', timeout=5000)


def _go_accounts(page):
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)


def _seed_debts(page):
    """Seed three debts with different balances, rates, and one with a credit limit."""
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'Chase', type: 'Checking', startingBalance: 0 },
                        { id: 2, name: 'BofA', type: 'Checking', startingBalance: 0 }];
        app.debts = [
            { id: 10, name: 'Credit Card', debtType: 'creditCard', accountBalance: 500, interestRate: 22,
              minimumPayment: 25, dueDate: 15, category: 'Credit', accountId: 1,
              creditLimit: 1000, archived: false },
            { id: 11, name: 'Car Loan', debtType: 'creditCard', accountBalance: 8000, interestRate: 5,
              minimumPayment: 200, dueDate: 5, category: 'Loan', accountId: 2,
              creditLimit: null, archived: false },
            { id: 12, name: 'Personal Loan', debtType: 'creditCard', accountBalance: 2000, interestRate: 12,
              minimumPayment: 100, dueDate: 20, category: 'Loan', accountId: null,
              creditLimit: null, archived: false },
        ];
        app.incomes = []; app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('liabilities');
    }""")


def _seed_recurring(page):
    """Seed recurring templates across two categories and accounts."""
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 0 },
                        { id: 2, name: 'Savings', type: 'Savings', startingBalance: 0 }];
        app.recurringTemplates = [
            { id: 1, name: 'Netflix', type: 'subscription', amount: 15, frequency: 'monthly',
              dayOfMonth: 5, startDate: '2026-01-01', category: 'Subscription',
              accountId: 1, archived: false, paused: false, skippedMonths: [], paidMonths: [] },
            { id: 2, name: 'Gym', type: 'subscription', amount: 40, frequency: 'monthly',
              dayOfMonth: 20, startDate: '2026-01-01', category: 'Health',
              accountId: 2, archived: false, paused: false, skippedMonths: [], paidMonths: [] },
            { id: 3, name: 'Annual', type: 'subscription', amount: 100, frequency: 'yearly',
              dayOfMonth: 25, startDate: '2026-06-01', category: 'Subscription',
              accountId: null, archived: false, paused: false, skippedMonths: [], paidMonths: [] },
        ];
        app.incomes = []; app.bills = []; app.expenses = [];
        app.switchPage('recurring');
    }""")


def _seed_accounts(page):
    """Seed accounts of different types and balances."""
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [
            { id: 1, name: 'Zorro Checking', type: 'Checking', startingBalance: 500, interestRate: 0 },
            { id: 2, name: 'Alpha Savings', type: 'Savings', startingBalance: 3000, interestRate: 4.5 },
            { id: 3, name: 'My Credit Card', type: 'Credit Card', startingBalance: 0, interestRate: 0 },
        ];
        app.incomes = []; app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.debts = [];
        app.switchPage('accounts');
    }""")


# ─── Debts: controls present ──────────────────────────────────────────────────

@pytest.mark.feature
def test_debts_sort_control_present(app_page):
    """Sort dropdown is rendered on the debts tab."""
    page = app_page
    _go_debts(page)
    assert page.query_selector('#debtSortBy'), "Sort control should exist on debts tab"
    assert_no_errors(page)


@pytest.mark.feature
def test_debts_account_filter_present(app_page):
    """Account filter dropdown is rendered on the debts tab."""
    page = app_page
    _go_debts(page)
    assert page.query_selector('#debtAccountFilter'), "Account filter should exist"
    assert_no_errors(page)


@pytest.mark.feature
def test_debts_progress_filter_present(app_page):
    """Payoff progress filter dropdown is rendered on the debts tab."""
    page = app_page
    _go_debts(page)
    assert page.query_selector('#debtProgressFilter'), "Progress filter should exist"
    assert_no_errors(page)


@pytest.mark.feature
def test_debts_utilization_filter_present(app_page):
    """Utilization filter dropdown is rendered on the debts tab."""
    page = app_page
    _go_debts(page)
    assert page.query_selector('#debtUtilizationFilter'), "Utilization filter should exist"
    assert_no_errors(page)


# ─── Debts: sort ─────────────────────────────────────────────────────────────

@pytest.mark.feature
def test_debts_sort_by_balance_desc(app_page):
    """Sorting by Balance ↓ puts the highest balance first."""
    page = app_page
    _seed_debts(page)

    page.select_option('#debtSortBy', 'balance-desc')
    page.wait_for_timeout(200)

    names = page.evaluate("""() =>
        Array.from(document.querySelectorAll('#debtsList .debt-card .debt-name'))
             .map(el => el.textContent.trim().split('\\n')[0].trim())
    """)
    assert names[0] == 'Car Loan', f"Highest balance (8000) should be first, got {names}"
    assert_no_errors(page)


@pytest.mark.feature
def test_debts_sort_by_interest_desc(app_page):
    """Sorting by Interest Rate ↓ puts the highest rate first."""
    page = app_page
    _seed_debts(page)

    page.select_option('#debtSortBy', 'interest-desc')
    page.wait_for_timeout(200)

    names = page.evaluate("""() =>
        Array.from(document.querySelectorAll('#debtsList .debt-card .debt-name'))
             .map(el => el.textContent.trim().split('\\n')[0].trim())
    """)
    assert names[0] == 'Credit Card', f"Highest rate (22%) should be first, got {names}"
    assert_no_errors(page)


@pytest.mark.feature
def test_debts_sort_by_due_asc(app_page):
    """Sorting by Due Soonest puts the lowest dueDate day first."""
    page = app_page
    _seed_debts(page)

    page.select_option('#debtSortBy', 'due-asc')
    page.wait_for_timeout(200)

    names = page.evaluate("""() =>
        Array.from(document.querySelectorAll('#debtsList .debt-card .debt-name'))
             .map(el => el.textContent.trim().split('\\n')[0].trim())
    """)
    assert names[0] == 'Car Loan', f"Due day 5 should be first, got {names}"
    assert_no_errors(page)


# ─── Debts: filter ────────────────────────────────────────────────────────────

@pytest.mark.feature
def test_debts_filter_by_account(app_page):
    """Filtering by account shows only debts linked to that account."""
    page = app_page
    _seed_debts(page)

    # Wait for account filter to populate
    page.wait_for_timeout(200)
    page.select_option('#debtAccountFilter', '1')  # Chase
    page.wait_for_timeout(200)

    cards = page.query_selector_all('#debtsList .debt-card')
    assert len(cards) == 1, f"Only 1 debt linked to Chase, got {len(cards)}"
    name = page.text_content('#debtsList .debt-name')
    assert 'Credit Card' in name
    assert_no_errors(page)


@pytest.mark.feature
def test_debts_filter_by_utilization_low(app_page):
    """Filtering by Low utilization shows only debts with <30% utilization."""
    page = app_page
    _seed_debts(page)

    page.select_option('#debtUtilizationFilter', 'low')
    page.wait_for_timeout(200)

    names = page.evaluate("""() =>
        Array.from(document.querySelectorAll('#debtsList .debt-card .debt-name'))
             .map(el => el.textContent.trim().split('\\n')[0].trim())
    """)
    # Credit Card: 500/1000 = 50% — NOT low; Car Loan and Personal Loan have no limit → excluded
    assert 'Credit Card' not in names, "50% utilization should not appear in Low filter"
    assert_no_errors(page)


@pytest.mark.feature
def test_debts_filter_by_utilization_medium(app_page):
    """Filtering by Medium utilization (30–70%) shows the 50% credit card."""
    page = app_page
    _seed_debts(page)

    page.select_option('#debtUtilizationFilter', 'medium')
    page.wait_for_timeout(200)

    names = page.evaluate("""() =>
        Array.from(document.querySelectorAll('#debtsList .debt-card .debt-name'))
             .map(el => el.textContent.trim().split('\\n')[0].trim())
    """)
    assert 'Credit Card' in names, "50% utilization should appear in Medium filter"
    assert len(names) == 1, f"Only the credit card should show, got {names}"
    assert_no_errors(page)


@pytest.mark.feature
def test_debts_no_utilization_sort_to_bottom(app_page):
    """Debts without a credit limit appear at the bottom when sorting by utilization."""
    page = app_page
    _seed_debts(page)

    page.select_option('#debtSortBy', 'utilization-desc')
    page.wait_for_timeout(200)

    names = page.evaluate("""() =>
        Array.from(document.querySelectorAll('#debtsList .debt-card .debt-name'))
             .map(el => el.textContent.trim().split('\\n')[0].trim())
    """)
    # Credit Card has utilization (50%), Car Loan and Personal Loan have null → bottom
    assert names[0] == 'Credit Card', f"Only debt with utilization should be first, got {names}"
    assert_no_errors(page)


# ─── Recurring: controls present ─────────────────────────────────────────────

@pytest.mark.feature
def test_recurring_sort_control_present(app_page):
    """Sort dropdown is rendered on the recurring page."""
    page = app_page
    _go_recurring(page)
    assert page.query_selector('#recurringSortBy'), "Sort control should exist on recurring page"
    assert_no_errors(page)


@pytest.mark.feature
def test_recurring_category_filter_present(app_page):
    """Category filter dropdown is rendered on the recurring page."""
    page = app_page
    _go_recurring(page)
    assert page.query_selector('#recurringCategoryFilter'), "Category filter should exist"
    assert_no_errors(page)


@pytest.mark.feature
def test_recurring_month_filter_present(app_page):
    """Month filter dropdown is rendered on the recurring page."""
    page = app_page
    _go_recurring(page)
    assert page.query_selector('#recurringMonthFilter'), "Month filter should exist"
    assert_no_errors(page)


# ─── Recurring: sort ──────────────────────────────────────────────────────────

@pytest.mark.feature
def test_recurring_sort_by_amount_desc(app_page):
    """Sorting by Amount ↓ puts the highest amount first."""
    page = app_page
    _seed_recurring(page)

    page.select_option('#recurringSortBy', 'amount-desc')
    page.wait_for_timeout(200)

    names = page.evaluate("""() =>
        Array.from(document.querySelectorAll('#recurringList .recurring-card-name'))
             .map(el => el.textContent.trim())
    """)
    assert names[0] == 'Annual', f"$100 annual should be first, got {names}"
    assert_no_errors(page)


@pytest.mark.feature
def test_recurring_sort_by_due_asc(app_page):
    """Sorting by Due Soonest puts the lowest dayOfMonth first."""
    page = app_page
    _seed_recurring(page)

    page.select_option('#recurringSortBy', 'due-asc')
    page.wait_for_timeout(200)

    names = page.evaluate("""() =>
        Array.from(document.querySelectorAll('#recurringList .recurring-card-name'))
             .map(el => el.textContent.trim())
    """)
    assert names[0] == 'Netflix', f"Day 5 (Netflix) should be first, got {names}"
    assert_no_errors(page)


# ─── Recurring: filter ────────────────────────────────────────────────────────

@pytest.mark.feature
def test_recurring_filter_by_category(app_page):
    """Filtering by category shows only templates in that category."""
    page = app_page
    _seed_recurring(page)

    page.wait_for_timeout(200)
    page.select_option('#recurringCategoryFilter', 'Health')
    page.wait_for_timeout(200)

    names = page.evaluate("""() =>
        Array.from(document.querySelectorAll('#recurringList .recurring-card-name'))
             .map(el => el.textContent.trim())
    """)
    assert names == ['Gym'], f"Only Gym is Health, got {names}"
    assert_no_errors(page)


@pytest.mark.feature
def test_recurring_filter_by_account(app_page):
    """Filtering by account shows only templates linked to that account."""
    page = app_page
    _seed_recurring(page)

    page.wait_for_timeout(200)
    page.select_option('#recurringAccountFilter', '2')  # Savings
    page.wait_for_timeout(200)

    names = page.evaluate("""() =>
        Array.from(document.querySelectorAll('#recurringList .recurring-card-name'))
             .map(el => el.textContent.trim())
    """)
    assert names == ['Gym'], f"Only Gym is on Savings, got {names}"
    assert_no_errors(page)


@pytest.mark.feature
def test_recurring_filter_by_month_shows_monthly_templates(app_page):
    """Month filter shows templates that have at least one occurrence in the selected month."""
    page = app_page
    _seed_recurring(page)

    page.wait_for_timeout(300)
    # Select the first available month option (current month)
    first_month = page.evaluate("""() => {
        const sel = document.getElementById('recurringMonthFilter');
        return sel?.options[1]?.value || '';
    }""")
    assert first_month, "Month filter should have at least one month option"

    page.select_option('#recurringMonthFilter', first_month)
    page.wait_for_timeout(200)

    names = page.evaluate("""() =>
        Array.from(document.querySelectorAll('#recurringList .recurring-card-name'))
             .map(el => el.textContent.trim())
    """)
    # Netflix and Gym are monthly (always have occurrences); Annual may or may not
    assert 'Netflix' in names, "Monthly template should appear for any selected month"
    assert 'Gym' in names, "Monthly template should appear for any selected month"
    assert_no_errors(page)


# ─── Accounts: controls present ──────────────────────────────────────────────

@pytest.mark.feature
def test_accounts_sort_control_present(app_page):
    """Sort dropdown is rendered on the accounts page."""
    page = app_page
    _go_accounts(page)
    assert page.query_selector('#accountSortBy'), "Sort control should exist on accounts page"
    assert_no_errors(page)


@pytest.mark.feature
def test_accounts_type_filter_present(app_page):
    """Type filter dropdown is rendered on the accounts page."""
    page = app_page
    _go_accounts(page)
    assert page.query_selector('#accountTypeFilter'), "Type filter should exist"
    assert_no_errors(page)


# ─── Accounts: sort ───────────────────────────────────────────────────────────

@pytest.mark.feature
def test_accounts_sort_by_name_asc(app_page):
    """Sorting by Name A–Z puts the alphabetically first name first."""
    page = app_page
    _seed_accounts(page)

    page.select_option('#accountSortBy', 'name-asc')
    page.wait_for_timeout(200)

    names = page.evaluate("""() =>
        Array.from(document.querySelectorAll('#accountList .acct-card-name'))
             .map(el => el.textContent.trim())
    """)
    assert names[0].startswith('Alpha Savings'), f"Alpha should be first alphabetically, got {names}"
    assert_no_errors(page)


@pytest.mark.feature
def test_accounts_sort_by_apy_desc(app_page):
    """Sorting by APY ↓ puts the highest rate first."""
    page = app_page
    _seed_accounts(page)

    page.select_option('#accountSortBy', 'apy-desc')
    page.wait_for_timeout(200)

    names = page.evaluate("""() =>
        Array.from(document.querySelectorAll('#accountList .acct-card-name'))
             .map(el => el.textContent.trim())
    """)
    assert names[0].startswith('Alpha Savings'), f"4.5% APY should be first, got {names}"
    assert_no_errors(page)


# ─── Accounts: filter ─────────────────────────────────────────────────────────

@pytest.mark.feature
def test_accounts_filter_by_type(app_page):
    """Filtering by type shows only accounts of that type."""
    page = app_page
    _seed_accounts(page)

    page.select_option('#accountTypeFilter', 'Savings')
    page.wait_for_timeout(200)

    cards = page.query_selector_all('#accountList .acct-card')
    assert len(cards) == 1, f"Only 1 Savings account, got {len(cards)}"
    name = page.text_content('#accountList .acct-card-name')
    assert 'Alpha Savings' in name
    assert_no_errors(page)


@pytest.mark.feature
def test_accounts_filter_shows_empty_when_no_match(app_page):
    """Filtering by a type with no accounts shows no cards."""
    page = app_page
    _seed_accounts(page)

    page.select_option('#accountTypeFilter', 'Investment')
    page.wait_for_timeout(200)

    cards = page.query_selector_all('#accountList .acct-card')
    assert len(cards) == 0, "No Investment accounts seeded — should show nothing"
    assert_no_errors(page)


@pytest.mark.feature
def test_accounts_clear_filter_shows_all(app_page):
    """Clearing the type filter (All) shows all accounts again."""
    page = app_page
    _seed_accounts(page)

    page.select_option('#accountTypeFilter', 'Savings')
    page.wait_for_timeout(200)
    page.select_option('#accountTypeFilter', '')
    page.wait_for_timeout(200)

    cards = page.query_selector_all('#accountList .acct-card')
    assert len(cards) == 3, f"All 3 accounts should show after clearing filter, got {len(cards)}"
    assert_no_errors(page)
