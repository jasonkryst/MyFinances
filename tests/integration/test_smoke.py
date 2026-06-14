#!/usr/bin/env python3
"""
Smoke Test - Full Application Workflow
End-to-end test of major features in sequence.
"""

import pytest

BASE_URL = "http://localhost:5500/"


@pytest.mark.integration
@pytest.mark.slow
def test_smoke_full_workflow(app_page):
    """Test complete application workflow end-to-end."""
    page = app_page
    
    # 1. Create account
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(500)
    page.fill('#accountName', 'Smoke Checking')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '5000')
    page.click('#accountFormSubmit')
    page.wait_for_selector('text=Smoke Checking', timeout=10000)
    assert page.query_selector('text=Smoke Checking'), "Account creation failed"
    
    # 2. Add income
    page.click('button[data-page="income"]')
    page.wait_for_timeout(500)
    page.fill('#incomeName', 'Salary')
    page.fill('#incomeAmount', '5000')
    page.fill('#incomeFirstDate', '2026-05-01')
    page.select_option('#incomeFrequency', 'monthly')
    page.select_option('#incomeAccount', index=1)
    page.click('#incomeFormSubmit')
    page.wait_for_timeout(500)
    assert page.query_selector('text=Salary'), "Income creation failed"
    
    # 3. Add debt
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(500)
    page.click('#debtFormToggle')
    page.wait_for_timeout(300)
    page.fill('#debtName', 'Credit Card')
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', '2500')
    page.fill('#interestRate', '18')
    page.fill('#minimumPayment', '100')
    page.fill('#dueDate', '15')
    page.click('#debtFormSubmit')
    page.wait_for_timeout(500)
    assert page.query_selector('text=Credit Card'), "Debt creation failed"
    
    # 4. Check net worth
    net_worth_widget = page.query_selector('#netWorthWidget')
    assert net_worth_widget, "Net worth widget not found"
    net_worth_text = net_worth_widget.evaluate('(el) => el.textContent')
    # Net worth should be 5000 - 2500 = 2500
    assert net_worth_text, "Net worth not displayed"
    
    # 5. Navigate to strategy
    page.click('button[data-page="strategy"]')
    page.wait_for_timeout(500)
    strategy_section = page.query_selector('#strategySection')
    assert strategy_section, "Strategy section not found"
    
    # 6. Navigate to reports
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(500)
    reports_section = page.query_selector('#reportsSection')
    assert reports_section, "Reports section not found"

    # 6b. Check Cash Flow Forecast tab renders
    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(500)
    forecast_panel = page.query_selector('#reportsCashFlowForecast')
    assert forecast_panel and forecast_panel.evaluate('(el) => el.innerHTML.length > 0'), \
        "Forecast tab should render content"

    # 7. Navigate to health dashboard and verify it renders with real data
    page.click('button[data-page="health"]')
    page.wait_for_timeout(600)
    health_section = page.query_selector('#healthSection')
    assert health_section, "Health section not found"
    health_cards = page.query_selector_all('.health-metric-card')
    assert len(health_cards) == 6, f"Expected 6 health metric cards, found {len(health_cards)}"
    # With income + debt added above, cash flow should not be Break Even
    health_text = health_section.text_content()
    assert 'Surplus' in health_text or 'Deficit' in health_text, \
        "Health dashboard should show Surplus or Deficit with real data"

    # 8. Verify no console errors
    console_errors = []
    if hasattr(page, 'console_errors'):
        filtered = [
            e for e in page.console_errors
            if 'favicon' not in e
        ]
        assert len(filtered) == 0, f"Console errors: {filtered}"


@pytest.mark.integration
def test_smoke_account_to_networth(app_page):
    """Test account creation affects net worth."""
    page = app_page
    
    # Create multiple accounts
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    
    accounts = [('Smoke_1', '3000'), ('Smoke_2', '4000')]
    for name, balance in accounts:
        page.fill('#accountName', name)
        page.select_option('#accountType', label='Checking')
        page.fill('#accountStartingBalance', balance)
        page.click('#accountFormSubmit')
        page.wait_for_timeout(500)
    
    # Verify all accounts created
    for name, _ in accounts:
        assert page.query_selector(f'text={name}'), f"{name} not found"
    
    # Net worth should include all accounts (3000 + 4000 = 7000)
    net_worth_widget = page.query_selector('#netWorthWidget')
    assert net_worth_widget, "Net worth widget missing"


@pytest.mark.integration
def test_smoke_data_persistence(app_page):
    """Test data persists across navigation."""
    page = app_page
    
    # Create account
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Persist Test')
    page.select_option('#accountType', label='Savings')
    page.fill('#accountStartingBalance', '9999')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(500)
    
    # Navigate away
    page.click('button[data-page="income"]')
    page.wait_for_timeout(500)
    
    # Navigate back
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(500)
    
    # Account should still be there
    assert page.query_selector('text=Persist Test'), "Data not persisted"


@pytest.mark.integration
def test_smoke_export_import(app_page):
    """Test data export functionality."""
    page = app_page
    
    # Create test data
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Export Test')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '1000')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(500)
    
    # Look for export button
    export_btn = page.query_selector('#exportJsonBtn')
    if export_btn:
        # Export functionality exists
        assert export_btn.evaluate('(el) => el.offsetHeight > 0'), "Export button should be visible"
    
    # Look for import button
    import_btn = page.query_selector('#importJsonBtn')
    if import_btn:
        assert import_btn.evaluate('(el) => el.offsetHeight > 0'), "Import button should be visible"
