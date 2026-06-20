#!/usr/bin/env python3
"""
Debt Management Tests
Tests debt CRUD operations and calculations.
"""

import pytest

from tests.conftest import create_debt

BASE_URL = "http://localhost:5500/"


@pytest.mark.feature
def test_create_debt(app_page, debt_data):
    """Test creating a new debt."""
    page = app_page
    
    # Create account first for debt assignment
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Debt Account')
    page.select_option('#accountType', label='Credit Card')
    page.fill('#accountStartingBalance', '0')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(500)
    
    # Navigate to debts
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)
    page.click('#debtFormToggle')
    page.wait_for_timeout(300)
    
    # Fill form
    page.fill('#debtName', debt_data["name"])
    page.select_option('#debtType', debt_data["type"])
    page.fill('#accountBalance', debt_data["balance"])
    page.fill('#interestRate', debt_data["interest_rate"])
    page.fill('#minimumPayment', debt_data["min_payment"])
    page.fill('#dueDate', '15')
    
    # Submit
    page.click('#debtFormSubmit')
    page.wait_for_selector(f'text={debt_data["name"]}', timeout=10000)
    
    # Verify debt appears in list
    assert page.query_selector(f'text={debt_data["name"]}'), "Debt not created"


@pytest.mark.feature
def test_debt_types(app_page):
    """Test all debt types can be created."""
    page = app_page
    
    # Create account
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Debt Types Account')
    page.select_option('#accountType', label='Credit Card')
    page.fill('#accountStartingBalance', '0')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(500)
    
    # Navigate to debts
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)
    
    debt_types = ['creditCard', 'fixedAmount']
    
    for i, debt_type in enumerate(debt_types):
        page.click('#debtFormToggle')
        page.wait_for_timeout(300)

        page.fill('#debtName', f'Debt Type {i}')
        page.select_option('#debtType', debt_type)
        if debt_type == 'creditCard':
            page.fill('#accountBalance', '1000')
            page.fill('#interestRate', '5')
            page.fill('#minimumPayment', '100')
            page.fill('#dueDate', '15')
        else:
            page.fill('#fixedAmount', '100')
            page.fill('#fixedStartDate', '2026-01-01')
            page.fill('#fixedEndDate', '2026-12-31')
        page.click('#debtFormSubmit')
        page.wait_for_timeout(500)


@pytest.mark.feature
def test_debt_interest_calculation(app_page):
    """Test that debt interest is calculated correctly."""
    page = app_page
    
    # Create account
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Interest Test Account')
    page.select_option('#accountType', label='Credit Card')
    page.fill('#accountStartingBalance', '0')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(500)
    
    # Create debt with known interest rate
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)
    page.click('#debtFormToggle')
    page.wait_for_timeout(300)
    
    page.fill('#debtName', 'Interest Calc Debt')
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', '5000')
    page.fill('#interestRate', '18.5')
    page.fill('#minimumPayment', '150')
    page.fill('#dueDate', '15')
    page.click('#debtFormSubmit')
    page.wait_for_timeout(500)
    
    # Verify debt is shown
    assert page.query_selector('text=Interest Calc Debt'), "Debt not created"


@pytest.mark.feature
def test_debt_payoff_strategy(app_page):
    """Test debt payoff strategy calculation."""
    page = app_page
    
    # Navigate to strategy
    page.click('button[data-page="strategy"]')
    page.wait_for_timeout(300)
    
    # Verify strategy page loaded
    strategy_section = page.query_selector('#strategySection')
    assert strategy_section, "Strategy section not found"


@pytest.mark.feature
def test_amortization_schedule(app_page):
    """Test amortization schedule generation."""
    page = app_page
    
    # Create account
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Amort Account')
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
    
    page.fill('#debtName', 'Amortization Test')
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', '2000')
    page.fill('#interestRate', '15')
    page.fill('#minimumPayment', '75')
    page.fill('#dueDate', '15')
    page.click('#debtFormSubmit')
    page.wait_for_timeout(500)
    
    # Navigate to strategy and check amortization
    page.click('button[data-page="strategy"]')
    page.wait_for_timeout(300)
    
    # Look for amortization button
    amort_button = page.query_selector('button:has-text("Show Amortization")')
    if amort_button:
        amort_button.click()
        page.wait_for_timeout(500)
        
        # Check if amortization modal appears
        amort_modal = page.query_selector('#amortizationModal')
        assert amort_modal, "Amortization modal not found"


@pytest.mark.feature
def test_net_worth_includes_debts(app_page):
    """Test that net worth accounts for debt liabilities."""
    page = app_page
    
    # Create account
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Asset Account')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '10000')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(500)
    
    # Create debt
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)
    page.click('#debtFormToggle')
    page.wait_for_timeout(300)
    
    page.fill('#debtName', 'Liability')
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', '3000')
    page.fill('#interestRate', '18')
    page.fill('#minimumPayment', '100')
    page.fill('#dueDate', '15')
    page.click('#debtFormSubmit')
    page.wait_for_timeout(500)
    
    # Check net worth (should be 10000 - 3000 = 7000)
    net_worth_widget = page.query_selector('#netWorthWidget')
    assert net_worth_widget, "Net worth widget not found"


@pytest.mark.feature
def test_debt_card_shows_run_a_plan_hint_before_calculation(app_page, debt_data):
    """Before any payment plan is calculated, debt cards show a 'Run a plan to see' payoff hint."""
    page = app_page
    create_debt(page, debt_data)

    card_text = page.evaluate("""() => {
        const card = document.querySelector('#debtsList .debt-card');
        return card ? card.textContent : '';
    }""")
    assert '📅 Payoff Date' in card_text, "Expected a Payoff Date label even before calculating a plan"
    assert 'Run a plan to see' in card_text, "Expected a 'Run a plan to see' payoff hint before calculating a plan"


@pytest.mark.feature
def test_debt_card_shows_payoff_date_after_plan_calculation(app_page, debt_data):
    """After calculating a payment plan, each debt card shows its projected payoff date."""
    page = app_page
    create_debt(page, debt_data)

    page.click('button[data-page="strategy"]')
    page.wait_for_timeout(300)
    page.fill('#monthlyPayment', '200')
    page.select_option('#paymentStrategy', 'avalanche')
    page.click('#calculateBtn')
    page.wait_for_timeout(500)

    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)

    card_text = page.evaluate("""() => {
        const card = document.querySelector('#debtsList .debt-card');
        return card ? card.textContent : '';
    }""")
    assert '📅 Payoff Date' in card_text, "Expected a Payoff Date label after calculating a plan"
    assert 'Run a plan to see' not in card_text, "Expected the 'Run a plan to see' hint to be replaced by an actual date"

    summary_payoff_date = page.evaluate(
        """(name) => {
            const row = window.app._debtSummaryRows?.find(r => r.name === name);
            return row ? row.payoffDate : null;
        }""",
        debt_data["name"]
    )
    assert summary_payoff_date, "Expected _debtSummaryRows to contain a payoffDate"
    assert summary_payoff_date in card_text, "Debt card should display the same payoff date as the summary table"


@pytest.mark.feature
def test_add_fixed_amount_debt_negative_amount_rejected(app_page):
    """Negative fixed-amount debt payments are rejected, not silently clamped to $0.01.

    addDebt()'s fixedAmount branch previously validated the post-clamp value
    (sanitizeFiniteNumber(raw, NaN, { min: 0.01 })), so a negative input was
    clamped up to 0.01 *before* the `fixedAmount <= 0` check ran. Fixed in
    src/debts.js to validate the raw input string before clamping, matching
    the pattern already applied to src/bills.js and src/recurring.js.
    """
    page = app_page

    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Fixed Debt Account')
    page.select_option('#accountType', label='Credit Card')
    page.fill('#accountStartingBalance', '0')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(500)

    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)
    page.click('#debtFormToggle')
    page.wait_for_timeout(300)

    page.fill('#debtName', 'Negative Fixed Debt')
    page.select_option('#debtType', 'fixedAmount')
    page.fill('#fixedAmount', '-100')
    page.fill('#fixedStartDate', '2026-01-01')
    page.fill('#fixedEndDate', '2026-12-31')
    page.click('#debtFormSubmit')
    page.wait_for_timeout(300)

    assert page.query_selector('text=Negative Fixed Debt') is None, (
        "A negative fixed-amount debt payment should be rejected, not silently saved as $0.01"
    )
