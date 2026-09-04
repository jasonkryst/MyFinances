#!/usr/bin/env python3
"""
Validation Modal Tests

Verifies that all form-submission validation errors show the themed #alertModal
instead of a native browser alert() popup. Covers positive paths (valid
submission succeeds without a modal) and negative paths (invalid submission
shows the modal with the correct message, dismissible via OK or Escape).
"""

import pytest


@pytest.mark.feature
def test_alert_modal_present_in_dom(app_page):
    """The #alertModal element exists and is hidden on load."""
    page = app_page
    modal = page.query_selector('#alertModal')
    assert modal is not None, "#alertModal not found in DOM"
    assert 'hidden' in (modal.get_attribute('class') or ''), \
        "#alertModal should be hidden on load"


@pytest.mark.feature
def test_add_debt_missing_name_shows_modal(app_page):
    """Submitting the Add Debt form with no name shows the alert modal."""
    page = app_page
    page.click('button[data-page="liabilities"]')
    page.wait_for_timeout(300)
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)

    toggle = page.query_selector('#debtFormToggle')
    if toggle:
        toggle.click()
        page.wait_for_timeout(300)

    # Submit with empty name
    page.click('#debtFormSubmit')
    page.wait_for_timeout(400)

    modal = page.query_selector('#alertModal')
    assert modal is not None, "#alertModal not found"
    classes = modal.get_attribute('class') or ''
    assert 'flex-visible' in classes, \
        "Alert modal should be visible after submitting empty debt name"

    # Message should mention name
    msg = page.text_content('#alertModalMessage') or ''
    assert 'name' in msg.lower() or 'debt' in msg.lower(), \
        f"Modal message should mention name or debt, got: {msg!r}"


@pytest.mark.feature
def test_alert_modal_ok_button_closes_modal(app_page):
    """Clicking OK on the alert modal closes it."""
    page = app_page
    page.click('button[data-page="liabilities"]')
    page.wait_for_timeout(300)
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)

    toggle = page.query_selector('#debtFormToggle')
    if toggle:
        toggle.click()
        page.wait_for_timeout(300)

    page.click('#debtFormSubmit')
    page.wait_for_timeout(400)

    # Modal should be open
    modal = page.query_selector('#alertModal')
    assert 'flex-visible' in (modal.get_attribute('class') or '')

    # Click OK
    page.click('#alertModalOkBtn')
    page.wait_for_timeout(300)

    classes = modal.get_attribute('class') or ''
    assert 'hidden' in classes, "Alert modal should be hidden after clicking OK"
    assert 'flex-visible' not in classes, "flex-visible should be removed after OK"


@pytest.mark.feature
def test_alert_modal_escape_key_closes_modal(app_page):
    """Pressing Escape on the alert modal closes it."""
    page = app_page
    page.click('button[data-page="liabilities"]')
    page.wait_for_timeout(300)
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)

    toggle = page.query_selector('#debtFormToggle')
    if toggle:
        toggle.click()
        page.wait_for_timeout(300)

    page.click('#debtFormSubmit')
    page.wait_for_timeout(400)

    modal = page.query_selector('#alertModal')
    assert 'flex-visible' in (modal.get_attribute('class') or '')

    page.keyboard.press('Escape')
    page.wait_for_timeout(300)

    classes = modal.get_attribute('class') or ''
    assert 'hidden' in classes, "Alert modal should be hidden after Escape"


@pytest.mark.feature
def test_valid_debt_submission_no_modal(app_page):
    """A valid Add Debt submission does NOT trigger the alert modal."""
    page = app_page

    # Add account first
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Modal Test Account')
    page.select_option('#accountType', label='Credit Card')
    page.fill('#accountStartingBalance', '0')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(500)

    page.click('button[data-page="liabilities"]')
    page.wait_for_timeout(300)
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)

    toggle = page.query_selector('#debtFormToggle')
    if toggle:
        toggle.click()
        page.wait_for_timeout(300)

    page.fill('#debtName', 'Valid Test Debt')
    page.fill('#accountBalance', '1000')
    page.fill('#interestRate', '5')
    page.fill('#minimumPayment', '50')
    page.fill('#dueDate', '15')
    page.click('#debtFormSubmit')
    page.wait_for_timeout(600)

    modal = page.query_selector('#alertModal')
    classes = modal.get_attribute('class') or '' if modal else ''
    assert 'flex-visible' not in classes, \
        "Alert modal should NOT appear after a valid debt submission"


@pytest.mark.feature
def test_add_income_missing_fields_shows_modal(app_page):
    """Submitting the Add Income form without required fields shows the alert modal."""
    page = app_page
    page.click('button[data-page="income"]')
    page.wait_for_timeout(500)

    # Try to submit without filling anything
    submit = page.query_selector('#incomeFormSubmit')
    if submit:
        submit.click()
        page.wait_for_timeout(400)

    modal = page.query_selector('#alertModal')
    assert modal is not None, "#alertModal not found"
    classes = modal.get_attribute('class') or ''
    assert 'flex-visible' in classes, \
        "Alert modal should appear after submitting empty income form"

    # Dismiss
    page.click('#alertModalOkBtn')
    page.wait_for_timeout(200)


@pytest.mark.feature
def test_add_account_missing_name_shows_modal(app_page):
    """Submitting the Add Account form with no name shows the alert modal."""
    page = app_page
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)

    # Clear name and submit
    page.fill('#accountName', '')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(400)

    modal = page.query_selector('#alertModal')
    assert modal is not None
    classes = modal.get_attribute('class') or ''
    assert 'flex-visible' in classes, \
        "Alert modal should appear when account name is missing"

    page.click('#alertModalOkBtn')
    page.wait_for_timeout(200)


@pytest.mark.feature
def test_strategy_no_debts_shows_modal(app_page):
    """Calculating a payment plan with no debts shows the alert modal."""
    page = app_page
    page.click('button[data-page="strategy"]')
    page.wait_for_timeout(500)

    monthly_input = page.query_selector('#monthlyPayment')
    if monthly_input:
        monthly_input.fill('500')

    calc_btn = page.query_selector('#calculateBtn')
    if not calc_btn:
        pytest.skip("Calculate button not found")

    calc_btn.click()
    page.wait_for_timeout(400)

    modal = page.query_selector('#alertModal')
    classes = modal.get_attribute('class') or '' if modal else ''
    assert 'flex-visible' in classes, \
        "Alert modal should appear when calculating with no debts"

    page.click('#alertModalOkBtn')
    page.wait_for_timeout(200)


@pytest.mark.feature
def test_alert_modal_is_accessible(app_page):
    """The alert modal has correct ARIA attributes."""
    page = app_page
    modal = page.query_selector('#alertModal')
    assert modal is not None

    role = modal.get_attribute('role')
    assert role == 'alertdialog', f"Expected role='alertdialog', got {role!r}"

    aria_modal = modal.get_attribute('aria-modal')
    assert aria_modal == 'true', "aria-modal should be 'true'"

    aria_labelledby = modal.get_attribute('aria-labelledby')
    assert aria_labelledby == 'alertModalTitle', \
        "aria-labelledby should reference alertModalTitle"
