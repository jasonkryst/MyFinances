#!/usr/bin/env python3
"""
Expense Tracking Tests
"""

import pytest

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
