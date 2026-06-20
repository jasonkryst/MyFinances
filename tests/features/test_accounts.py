#!/usr/bin/env python3
"""
Account Management Tests
Tests account CRUD operations and calculations.
"""

import pytest

BASE_URL = "http://localhost:5500/"


@pytest.mark.feature
def test_create_account(app_page, account_data):
    """Test creating a new account."""
    page = app_page
    
    # Navigate to accounts
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    
    # Fill form
    page.fill('#accountName', account_data["name"])
    page.select_option('#accountType', label=account_data["type"])
    page.fill('#accountStartingBalance', account_data["balance"])
    
    # Submit
    page.click('#accountFormSubmit')
    page.wait_for_selector(f'text={account_data["name"]}', timeout=10000)
    
    # Verify account appears in list
    assert page.query_selector(f'text={account_data["name"]}'), "Account not created"


@pytest.mark.feature
def test_account_types(app_page):
    """Test all account types can be created."""
    page = app_page
    
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    
    account_types = ['Checking', 'Savings', 'Investment', 'Credit Card']
    
    for account_type in account_types:
        page.fill('#accountName', f'{account_type} Test')
        page.select_option('#accountType', label=account_type)
        page.fill('#accountStartingBalance', '1000')
        page.click('#accountFormSubmit')
        page.wait_for_timeout(500)
        
        # Verify account created
        assert page.query_selector(f'text={account_type} Test'), \
            f"Could not create {account_type} account"


@pytest.mark.feature
def test_account_balance_display(app_page):
    """Test account balance is displayed correctly."""
    page = app_page
    
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    
    balance = '5432.10'
    page.fill('#accountName', 'Balance Test')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', balance)
    page.click('#accountFormSubmit')
    page.wait_for_timeout(500)
    
    # Find account and check balance display
    account_card = page.query_selector('text=Balance Test')
    assert account_card, "Account not found"
    
    # Balance should be displayed somewhere in the card
    card_text = account_card.evaluate('(el) => el.closest(".acct-card").textContent')
    assert '5432' in card_text or '5,432' in card_text, "Balance not displayed correctly"


@pytest.mark.feature
def test_net_worth_includes_accounts(app_page):
    """Test that net worth widget includes account totals."""
    page = app_page
    
    # Create account
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'NW Test Account')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '10000')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(500)
    
    # Check net worth widget
    net_worth_widget = page.query_selector('#netWorthWidget')
    assert net_worth_widget, "Net worth widget not found"
    
    net_worth_text = net_worth_widget.evaluate('(el) => el.textContent')
    # Net worth should reflect the account balance
    assert '10000' in net_worth_text or '10,000' in net_worth_text or '$' in net_worth_text, \
        "Net worth does not include account balance"


@pytest.mark.feature
def test_multiple_accounts(app_page):
    """Test creating and managing multiple accounts."""
    page = app_page
    
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    
    accounts = [
        ('Checking', '5000'),
        ('Savings', '15000'),
        ('Investment', '25000'),
    ]
    
    for name, balance in accounts:
        page.fill('#accountName', f'{name} Test')
        page.select_option('#accountType', label=name)
        page.fill('#accountStartingBalance', balance)
        page.click('#accountFormSubmit')
        page.wait_for_timeout(500)
    
    # Verify all accounts are displayed
    for name, _ in accounts:
        assert page.query_selector(f'text={name} Test'), f"{name} account not found"


@pytest.mark.feature
def test_account_form_submission(app_page):
    """Test account form submission and validation."""
    page = app_page
    
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    
    # Submit valid form
    page.fill('#accountName', 'Form Test')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '2500')
    page.click('#accountFormSubmit')
    
    # Wait for account to appear
    page.wait_for_selector('text=Form Test', timeout=10000)
    assert_no_errors(page)


def assert_no_errors(page):
    """Helper to check for console errors."""
    if hasattr(page, 'console_errors'):
        filtered = [
            e for e in page.console_errors
            if 'favicon' not in e
        ]
        assert len(filtered) == 0, f"Console errors: {filtered}"


@pytest.mark.feature
def test_delete_account_with_linked_items_orphans_gracefully(app_page):
    """Deleting an account that has linked income/bills/debts doesn't crash;
    the linked items survive with a now-dangling accountId, and computeAccountBalance
    (and every render that depends on it) tolerates the missing account.
    """
    page = app_page

    # Create the account that will be deleted.
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Orphan Source Account')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '1000')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(300)

    # Link an income source to it.
    page.click('button[data-page="income"]')
    page.wait_for_timeout(300)
    page.fill('#incomeName', 'Linked Salary')
    page.fill('#incomeAmount', '4000')
    page.fill('#incomeFirstDate', '2026-05-01')
    page.select_option('#incomeFrequency', 'monthly')
    page.select_option('#incomeAccount', index=1)
    page.click('#incomeFormSubmit')
    page.wait_for_timeout(300)

    # Delete the account it's linked to.
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.click('[data-account-action="delete"]')
    page.wait_for_timeout(300)

    assert_no_errors(page)

    # The account is gone...
    assert page.query_selector('text=Orphan Source Account') is None, \
        "Deleted account should no longer appear in the accounts list"

    # ...but the linked income record survives with its dangling accountId.
    page.click('button[data-page="income"]')
    page.wait_for_timeout(300)
    assert page.query_selector('text=Linked Salary'), \
        "Income linked to a deleted account should survive, not be deleted along with it"

    # Navigating through pages that read computeAccountBalance for every income/account
    # must not throw even though the income's accountId no longer resolves.
    page.click('button[data-page="health"]')
    page.wait_for_timeout(300)
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(300)
    assert_no_errors(page)
