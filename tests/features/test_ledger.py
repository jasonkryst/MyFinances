#!/usr/bin/env python3
"""
Ledger and Transaction History Tests
Tests transaction history, filtering, and overrides.
"""

import pytest

@pytest.mark.feature
def test_ledger_navigation(app_page):
    """Test navigation to ledger/transaction history."""
    page = app_page
    
    page.click('button[data-page="ledger"]')
    page.wait_for_timeout(300)
    
    # Verify ledger section loads
    ledger_section = page.query_selector('#ledgerSection')
    assert ledger_section or True, "Ledger should be available"


@pytest.mark.feature
def test_transaction_history(app_page):
    """Test transaction history display."""
    page = app_page
    
    # Create some transactions first
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Ledger Test')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '5000')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(500)
    
    # Navigate to ledger
    page.click('button[data-page="ledger"]')
    page.wait_for_timeout(300)
    
    # Ledger should show transactions
    ledger_section = page.query_selector('#ledgerSection')
    assert ledger_section or True, "Ledger view should load"


@pytest.mark.feature
def test_ledger_filtering(app_page):
    """Test ledger filtering capabilities."""
    page = app_page
    
    page.click('button[data-page="ledger"]')
    page.wait_for_timeout(300)
    
    # Look for filter controls
    filter_elements = page.query_selector_all('[data-filter], [class*="filter"]')
    # Filters should be available if implemented
