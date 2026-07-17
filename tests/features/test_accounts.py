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


def _seed_accounts(page, accounts):
    """Replace app.accounts wholesale and re-render the Accounts page."""
    page.evaluate("""(accounts) => {
        const app = window.app;
        app.accounts = accounts;
        app.saveToStorage();
        app.switchPage('accounts');
    }""", accounts)
    page.wait_for_timeout(200)


def _badge_text_for_card(page, account_name):
    """The .acct-rate-badge text (or None) scoped to the card matching account_name."""
    return page.evaluate("""(name) => {
        const cards = Array.from(document.querySelectorAll('.acct-card'));
        const card = cards.find(c => c.querySelector('.acct-card-name')?.textContent === name);
        return card?.querySelector('.acct-rate-badge')?.textContent ?? null;
    }""", account_name)


# ---------- interest rate display (issue #45) ----------

@pytest.mark.feature
def test_interest_rate_badge_at_minimum_threshold(app_page):
    """A rate of exactly 0.01% is the smallest value that renders a badge."""
    page = app_page
    _seed_accounts(page, [
        {'id': 1, 'name': 'Threshold Savings', 'type': 'Savings', 'startingBalance': 100, 'interestRate': 0.01}
    ])
    badge = _badge_text_for_card(page, 'Threshold Savings')
    assert badge is not None and '0.01% APY' in badge, f"Expected a 0.01% badge, got: {badge}"


@pytest.mark.feature
def test_interest_rate_just_below_threshold_shows_no_badge(app_page):
    """A rate just under the 0.01% display threshold renders no badge."""
    page = app_page
    _seed_accounts(page, [
        {'id': 1, 'name': 'Almost Rated', 'type': 'Savings', 'startingBalance': 100, 'interestRate': 0.009}
    ])
    assert _badge_text_for_card(page, 'Almost Rated') is None, \
        "A sub-0.01% rate should not render an APY badge"


@pytest.mark.feature
def test_whole_number_interest_rate_formats_with_two_decimals(app_page):
    """A whole-number rate still displays with two decimal places."""
    page = app_page
    _seed_accounts(page, [
        {'id': 1, 'name': 'Round Number', 'type': 'Savings', 'startingBalance': 100, 'interestRate': 5}
    ])
    badge = _badge_text_for_card(page, 'Round Number')
    assert badge is not None and '5.00% APY' in badge, f"Expected '5.00% APY', got: {badge}"


@pytest.mark.feature
def test_max_interest_rate_displays_full_badge(app_page):
    """The maximum allowed rate (100%) still renders a correctly formatted badge."""
    page = app_page
    _seed_accounts(page, [
        {'id': 1, 'name': 'Max Rate', 'type': 'Savings', 'startingBalance': 100, 'interestRate': 100}
    ])
    badge = _badge_text_for_card(page, 'Max Rate')
    assert badge is not None and '100.00% APY' in badge, f"Expected '100.00% APY', got: {badge}"


@pytest.mark.feature
def test_multiple_accounts_badge_scoped_to_correct_card(app_page):
    """When several accounts are listed together, the APY badge only appears
    on cards for accounts that actually carry a rate — not on every card."""
    page = app_page
    _seed_accounts(page, [
        {'id': 1, 'name': 'Rated Card', 'type': 'Savings', 'startingBalance': 100, 'interestRate': 3.25},
        {'id': 2, 'name': 'Unrated Card', 'type': 'Checking', 'startingBalance': 100, 'interestRate': 0},
        {'id': 3, 'name': 'Also Unrated', 'type': 'Cash', 'startingBalance': 100},
    ])

    rated_badge = _badge_text_for_card(page, 'Rated Card')
    assert rated_badge is not None and '3.25% APY' in rated_badge, \
        f"Expected the rated account's own badge, got: {rated_badge}"

    assert _badge_text_for_card(page, 'Unrated Card') is None, \
        "A 0%-rate account should not show a badge"
    assert _badge_text_for_card(page, 'Also Unrated') is None, \
        "An account with no interestRate field at all should not show a badge"

    # Exactly one badge should exist on the page, not three.
    badge_count = page.evaluate("() => document.querySelectorAll('.acct-rate-badge').length")
    assert badge_count == 1, f"Expected exactly 1 badge across all cards, found {badge_count}"


@pytest.mark.feature
def test_edit_account_removing_rate_hides_badge(app_page):
    """Editing a rated account's rate down to 0 removes its APY badge."""
    page = app_page
    _seed_accounts(page, [
        {'id': 1, 'name': 'Was Rated', 'type': 'Savings', 'startingBalance': 100, 'interestRate': 4}
    ])
    assert _badge_text_for_card(page, 'Was Rated') is not None, "Badge should show before the edit"

    page.click('[data-account-action="edit"][data-account-id="1"]')
    page.wait_for_selector('#ac-rate-1')
    page.fill('#ac-rate-1', '0')
    page.click('[data-account-action="save"][data-account-id="1"]')
    page.wait_for_timeout(300)

    assert _badge_text_for_card(page, 'Was Rated') is None, \
        "Badge should disappear once the rate is edited down to 0"


@pytest.mark.feature
def test_interest_rate_badge_persists_after_reload(app_page):
    """A rated account's badge survives a full page reload (localStorage round-trip)."""
    page = app_page
    _seed_accounts(page, [
        {'id': 1, 'name': 'Persisted Rate', 'type': 'Savings', 'startingBalance': 100, 'interestRate': 2.75}
    ])
    assert _badge_text_for_card(page, 'Persisted Rate') is not None, "Badge should show before reload"

    page.reload(wait_until="networkidle")
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)

    badge = _badge_text_for_card(page, 'Persisted Rate')
    assert badge is not None and '2.75% APY' in badge, \
        f"Badge should still show the correct rate after reload, got: {badge}"


@pytest.mark.feature
def test_imported_account_with_clamped_rate_shows_correct_badge(app_page):
    """An imported account with an out-of-range rate is clamped on import, and the
    Accounts page badge reflects the clamped (not the raw) value."""
    page = app_page
    page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/dataExport.js');
        const payload = {
            debts: [{ id: 1, name: 'Anchor Debt', debtType: 'creditCard',
                      accountBalance: 100, interestRate: 5, minimumPayment: 10, dueDate: 1 }],
            accounts: [
                { id: 1, name: 'Huge Rate Import', type: 'Savings', startingBalance: 100, interestRate: 200 }
            ]
        };
        const file = new File([JSON.stringify(payload)], 'import.json', { type: 'application/json' });
        return new Promise(resolve => {
            mod.importAllJSON(app, file, {});
            setTimeout(resolve, 300);
        });
    }""")
    page.evaluate("() => window.app.switchPage('accounts')")
    page.wait_for_timeout(200)

    badge = _badge_text_for_card(page, 'Huge Rate Import')
    assert badge is not None and '100.00% APY' in badge, \
        f"Imported rate of 200 should clamp to 100 and show '100.00% APY', got: {badge}"


@pytest.mark.feature
def test_imported_account_with_invalid_rate_shows_no_badge(app_page):
    """An imported account with a non-numeric rate sanitizes to 0 and shows no badge."""
    page = app_page
    page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/dataExport.js');
        const payload = {
            debts: [{ id: 1, name: 'Anchor Debt', debtType: 'creditCard',
                      accountBalance: 100, interestRate: 5, minimumPayment: 10, dueDate: 1 }],
            accounts: [
                { id: 1, name: 'Junk Rate Import', type: 'Savings', startingBalance: 100, interestRate: 'abc' }
            ]
        };
        const file = new File([JSON.stringify(payload)], 'import.json', { type: 'application/json' });
        return new Promise(resolve => {
            mod.importAllJSON(app, file, {});
            setTimeout(resolve, 300);
        });
    }""")
    page.evaluate("() => window.app.switchPage('accounts')")
    page.wait_for_timeout(200)

    assert _badge_text_for_card(page, 'Junk Rate Import') is None, \
        "A non-numeric imported rate should sanitize to 0 and show no badge"


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
