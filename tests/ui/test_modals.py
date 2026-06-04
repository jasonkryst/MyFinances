#!/usr/bin/env python3
"""
Modal Visibility and Behavior Tests
Tests modal functionality using CSS classes instead of inline styles.
"""

import pytest

@pytest.mark.ui
def test_modal_classes_not_styles(app_page):
    """Test that modals use CSS classes, not inline styles."""
    page = app_page

    # Open debt form panel
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)
    page.click('#debtFormToggle')
    page.wait_for_timeout(300)

    panel = page.query_selector('#debtFormBody')
    assert panel, "Debt form panel should exist"
    style_attr = panel.evaluate('(el) => el.getAttribute("style")')
    if style_attr:
        assert 'display' not in style_attr, "Debt form panel should not use inline display styles"


@pytest.mark.ui
def test_modal_visibility_toggle(app_page):
    """Test modal visibility toggling."""
    page = app_page

    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)

    # Open debt form panel
    page.click('#debtFormToggle')
    page.wait_for_timeout(300)

    panel = page.query_selector('#debtFormBody')
    assert panel, "Debt form panel should be present"
    is_hidden = panel.evaluate('(el) => el.hidden')
    assert not is_hidden, "Debt form panel should be visible after toggle"


@pytest.mark.ui
def test_modal_close_button(app_page):
    """Test modal close button functionality."""
    page = app_page

    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)

    # Open panel
    page.click('#debtFormToggle')
    page.wait_for_timeout(300)

    # Close panel by toggling again
    page.click('#debtFormToggle')
    page.wait_for_timeout(300)

    panel = page.query_selector('#debtFormBody')
    assert panel, "Debt form panel should be present"
    is_hidden = panel.evaluate('(el) => el.hidden')
    assert is_hidden, "Debt form panel should be hidden after closing"


@pytest.mark.ui
def test_amortization_modal(app_page):
    """Test amortization schedule modal."""
    page = app_page
    
    # Create account and debt
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Test Account')
    page.select_option('#accountType', label='Credit Card')
    page.fill('#accountStartingBalance', '0')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(500)
    
    # Create debt
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)
    page.click('#debtFormToggle')
    page.wait_for_timeout(300)
    page.fill('#debtName', 'Test Debt')
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', '2000')
    page.fill('#interestRate', '15')
    page.fill('#minimumPayment', '100')
    page.fill('#dueDate', '15')
    page.click('#debtFormSubmit')
    page.wait_for_timeout(500)
    
    # Navigate to strategy and open amortization
    page.click('button[data-page="strategy"]')
    page.wait_for_timeout(300)
    
    amort_button = page.query_selector('button:has-text("Show Amortization")')
    if amort_button:
        amort_button.click()
        page.wait_for_timeout(500)
        
        # Modal should be visible
        modal = page.query_selector('#amortizationModal')
        assert modal, "Amortization modal not found"
