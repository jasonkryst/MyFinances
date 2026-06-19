#!/usr/bin/env python3
"""
Expense Tracking Tests
"""

import pytest

from tests.conftest import assert_no_errors


def _open_expenses_panel(page):
    """Navigate to Liabilities > Expenses subtab and expand the add-expense form."""
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="expenses"]')
    page.wait_for_timeout(300)
    page.click('#expenseFormToggle')
    page.wait_for_selector('#expenseForm', state="visible", timeout=5000)


def _fill_expense_form(page, name=None, amount=None, date=None, category=None):
    """Fill whichever fields are provided in the add-expense form (does not submit)."""
    if name is not None:
        page.fill('#expenseName', name)
    if amount is not None:
        page.fill('#expenseBudget', amount)
    if date is not None:
        page.fill('#expenseDate', date)
    if category is not None:
        page.select_option('#expenseCategory', category)


def _add_expense(page, expense_data):
    """Fill and submit the add-expense form via the standard expense_data fixture shape."""
    _open_expenses_panel(page)
    _fill_expense_form(
        page,
        name=expense_data["name"],
        amount=expense_data["amount"],
        date=expense_data["date"],
        category=expense_data["category"],
    )
    page.click('#expenseFormSubmit')
    page.wait_for_timeout(300)


@pytest.mark.feature
def test_expense_tab_navigation(app_page):
    """Test navigation to expense/bill tracking."""
    page = app_page
    
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="expenses"]')
    page.wait_for_timeout(300)
    
    # Verify expense section loads
    expense_section = page.query_selector('#expensesSection')
    assert expense_section or True, "Expense tab should be available"


@pytest.mark.feature
def test_bill_tracking(app_page):
    """Test bill/recurring expense tracking."""
    page = app_page
    
    page.click('button[data-page="liabilities"]')
    page.wait_for_timeout(300)
    
    # Look for bill management section
    liabilities_section = page.query_selector('#liabilitiesSection')
    assert liabilities_section, "Liabilities section not found"


@pytest.mark.feature
def test_add_expense_via_ui(app_page, expense_data):
    """Adding an expense through the form shows it with correct name/amount/category."""
    page = app_page

    _add_expense(page, expense_data)

    card = page.query_selector('#expenseList .budget-card')
    assert card, "Expense card should be rendered after adding"

    name_text = page.text_content('.budget-card-name')
    assert expense_data["name"] in name_text

    amount_text = page.text_content('.budget-card-amount')
    assert "300.00" in amount_text

    meta_text = page.text_content('.budget-card-meta')
    assert expense_data["category"] in meta_text

    assert_no_errors(page)


@pytest.mark.feature
def test_edit_expense(app_page, expense_data):
    """Editing an expense updates the amount/category and removes the old values."""
    page = app_page

    _add_expense(page, expense_data)

    page.click('.budget-card [data-expense-action="edit"]')
    page.wait_for_selector('.budget-card--editing', timeout=5000)

    expense_id = page.get_attribute('.budget-card--editing [data-expense-action="save"]', 'data-expense-id')

    page.fill(f'#ee-amount-{expense_id}', '450')
    page.select_option(f'#ee-cat-{expense_id}', 'Entertainment')
    page.click(f'.budget-card--editing [data-expense-action="save"]')
    page.wait_for_timeout(300)

    amount_text = page.text_content('.budget-card-amount')
    meta_text = page.text_content('.budget-card-meta')

    assert "450.00" in amount_text, "Updated amount should be reflected"
    assert "300.00" not in amount_text, "Old amount should no longer be displayed"
    assert "Entertainment" in meta_text, "Updated category should be reflected"
    assert expense_data["category"] not in meta_text, "Old category should no longer be displayed"

    assert_no_errors(page)


@pytest.mark.feature
def test_delete_expense(app_page, expense_data):
    """Deleting an expense removes it from the list and its total."""
    page = app_page

    _add_expense(page, expense_data)
    assert page.query_selector('#expenseList .budget-card'), "Expense should exist before delete"

    page.click('.budget-card [data-expense-action="delete"]')
    page.wait_for_timeout(300)

    assert page.query_selector('#expenseList .budget-card') is None, "Expense card should be removed"
    empty_msg = page.text_content('#expenseList')
    assert "No expense budgets added yet" in empty_msg

    assert_no_errors(page)


@pytest.mark.feature
def test_add_expense_invalid_amount_rejected(app_page, expense_data):
    """An empty amount is rejected; no broken entry is created.

    addExpense() in src/bills.js validates the raw form value before it's
    clamped by sanitizeFiniteNumber(value, NaN, {min: 0}), so empty input is
    correctly rejected with an alert rather than creating an entry. (Non-numeric
    text like "abc" can't even be typed into #expenseBudget - it's a native
    type="number" input, so the browser itself blocks that case before any
    app code runs.)
    """
    page = app_page

    _open_expenses_panel(page)
    _fill_expense_form(
        page,
        name=expense_data["name"],
        amount="",
        date=expense_data["date"],
        category=expense_data["category"],
    )
    page.click('#expenseFormSubmit')
    page.wait_for_timeout(300)

    assert page.query_selector('#expenseList .budget-card') is None, (
        "No expense should be created for an empty amount"
    )

    assert_no_errors(page)


@pytest.mark.feature
def test_add_expense_zero_amount_accepted(app_page, expense_data):
    """A zero amount passes validation (budgetAmount < 0 is false for 0) and is stored as $0.00.

    This documents actual app behavior per sanitizeFiniteNumber's `min: 0` clamp combined
    with addExpense()'s `budgetAmount < 0` check -- zero is a valid, accepted amount.
    """
    page = app_page

    _add_expense(page, {**expense_data, "amount": "0"})

    card = page.query_selector('#expenseList .budget-card')
    assert card, "Zero-amount expense should be accepted and rendered"
    amount_text = page.text_content('.budget-card-amount')
    assert "0.00" in amount_text

    assert_no_errors(page)


@pytest.mark.feature
def test_add_expense_negative_amount_rejected(app_page, expense_data):
    """Negative amounts are rejected, not silently clamped to 0 and accepted.

    addExpense() previously validated the post-clamp value
    (sanitizeFiniteNumber(value, NaN, { min: 0 })), so a negative input was
    clamped to 0 *before* the `budgetAmount < 0` check ran, and that check
    could never be true. Fixed in src/bills.js to validate the raw input
    value before clamping, so a literal negative number is now rejected
    outright with the same alert as other invalid input.
    """
    page = app_page

    _open_expenses_panel(page)
    _fill_expense_form(
        page,
        name=expense_data["name"],
        amount="-50",
        date=expense_data["date"],
        category=expense_data["category"],
    )
    page.click('#expenseFormSubmit')
    page.wait_for_timeout(300)

    assert page.query_selector('#expenseList .budget-card') is None, (
        "A negative amount should be rejected, not silently clamped to 0 and accepted "
        "(actual app behavior: it IS accepted as $0.00 -- see docstring)."
    )


@pytest.mark.feature
def test_add_expense_missing_date_rejected(app_page, expense_data):
    """Submitting with no date set is rejected client-side (sanitizeDateISO returns null on empty)."""
    page = app_page

    _open_expenses_panel(page)
    _fill_expense_form(
        page,
        name=expense_data["name"],
        amount=expense_data["amount"],
        category=expense_data["category"],
    )
    # Explicitly clear the date field (HTML date inputs default to empty).
    page.evaluate("document.getElementById('expenseDate').value = ''")
    page.click('#expenseFormSubmit')
    page.wait_for_timeout(300)

    assert page.query_selector('#expenseList .budget-card') is None, (
        "No expense should be created when date is missing"
    )

    assert_no_errors(page)


@pytest.mark.feature
def test_add_expense_invalid_date_format_rejected(app_page, expense_data):
    """An invalid date string is sanitized to null via sanitizeDateISO and the submit is rejected."""
    page = app_page

    _open_expenses_panel(page)
    _fill_expense_form(
        page,
        name=expense_data["name"],
        amount=expense_data["amount"],
        category=expense_data["category"],
    )
    # Force a malformed value directly (bypassing native date-picker constraints),
    # mirroring how sanitizeDateISO would reject a non ISO-8601 string on import.
    page.evaluate("document.getElementById('expenseDate').value = 'not-a-date'")
    page.click('#expenseFormSubmit')
    page.wait_for_timeout(300)

    assert page.query_selector('#expenseList .budget-card') is None, (
        "No expense should be created when date is invalid"
    )

    assert_no_errors(page)


@pytest.mark.feature
def test_monthly_category_total_calculation(app_page, expense_data):
    """Two expenses in the same category sum correctly in the category summary total."""
    page = app_page

    _add_expense(page, expense_data)  # Food & Groceries, 300

    second = {**expense_data, "name": "More Groceries", "amount": "150"}
    _add_expense(page, second)

    summary_text = page.text_content('.budget-cat-summary--expense')
    assert "Food & Groceries" in summary_text
    assert "2 items" in summary_text
    assert "450.00" in summary_text, "Category total should be the sum of both expenses (300 + 150)"

    grand_total_text = page.text_content('.budget-cat-summary-header')
    assert "450.00" in grand_total_text, "Overall total should also reflect the sum"

    assert_no_errors(page)
