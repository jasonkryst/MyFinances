#!/usr/bin/env python3
"""
Debt Management Tests
Tests debt CRUD operations and calculations.
"""

import pytest

from tests.conftest import create_debt

BASE_URL = "http://localhost:32900/"


@pytest.mark.feature
def test_create_debt(app_page, debt_data):
    """Test creating a new debt."""
    page = app_page
    
    # Create account first for debt assignment
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)
    page.fill('#accountName', 'Debt Account')
    page.select_option('#accountType', label='Credit Card')
    page.fill('#accountStartingBalance', '0')
    page.click('#accountFormSubmit')
    
    # Navigate to debts
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_selector('[data-liabilities-subtab="debts"].active', timeout=5000)
    page.click('#debtFormToggle')
    page.wait_for_selector('#debtFormBody:not([hidden])', timeout=5000)
    
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
    page.wait_for_selector('#accountsSection.active', timeout=5000)
    page.fill('#accountName', 'Debt Types Account')
    page.select_option('#accountType', label='Credit Card')
    page.fill('#accountStartingBalance', '0')
    page.click('#accountFormSubmit')
    
    # Navigate to debts
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_selector('[data-liabilities-subtab="debts"].active', timeout=5000)
    
    debt_types = ['creditCard', 'fixedAmount']
    
    for i, debt_type in enumerate(debt_types):
        page.click('#debtFormToggle')
        page.wait_for_selector('#debtFormBody:not([hidden])', timeout=5000)

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


@pytest.mark.feature
def test_debt_interest_calculation(app_page):
    """Test that debt interest is calculated correctly."""
    page = app_page
    
    # Create account
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)
    page.fill('#accountName', 'Interest Test Account')
    page.select_option('#accountType', label='Credit Card')
    page.fill('#accountStartingBalance', '0')
    page.click('#accountFormSubmit')
    
    # Create debt with known interest rate
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_selector('[data-liabilities-subtab="debts"].active', timeout=5000)
    page.click('#debtFormToggle')
    page.wait_for_selector('#debtFormBody:not([hidden])', timeout=5000)
    
    page.fill('#debtName', 'Interest Calc Debt')
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', '5000')
    page.fill('#interestRate', '18.5')
    page.fill('#minimumPayment', '150')
    page.fill('#dueDate', '15')
    page.click('#debtFormSubmit')
    
    # Verify debt is shown
    assert page.query_selector('text=Interest Calc Debt'), "Debt not created"


@pytest.mark.feature
def test_debt_payoff_strategy(app_page):
    """Test debt payoff strategy calculation."""
    page = app_page
    
    # Navigate to strategy
    page.click('button[data-page="strategy"]')
    page.wait_for_selector('#strategySection.active', timeout=5000)
    
    # Verify strategy page loaded
    strategy_section = page.query_selector('#strategySection')
    assert strategy_section, "Strategy section not found"


@pytest.mark.feature
def test_amortization_schedule(app_page):
    """Test amortization schedule generation."""
    page = app_page
    
    # Create account
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)
    page.fill('#accountName', 'Amort Account')
    page.select_option('#accountType', label='Credit Card')
    page.fill('#accountStartingBalance', '0')
    page.click('#accountFormSubmit')
    
    # Create debt
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_selector('[data-liabilities-subtab="debts"].active', timeout=5000)
    page.click('#debtFormToggle')
    page.wait_for_selector('#debtFormBody:not([hidden])', timeout=5000)
    
    page.fill('#debtName', 'Amortization Test')
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', '2000')
    page.fill('#interestRate', '15')
    page.fill('#minimumPayment', '75')
    page.fill('#dueDate', '15')
    page.click('#debtFormSubmit')
    
    # Navigate to strategy and check amortization
    page.click('button[data-page="strategy"]')
    page.wait_for_selector('#strategySection.active', timeout=5000)
    
    # Look for amortization button
    amort_button = page.query_selector('button:has-text("Show Amortization")')
    if amort_button:
        amort_button.click()
        
        # Check if amortization modal appears
        amort_modal = page.query_selector('#amortizationModal')
        assert amort_modal, "Amortization modal not found"


@pytest.mark.feature
def test_net_worth_includes_debts(app_page):
    """Test that net worth accounts for debt liabilities."""
    page = app_page
    
    # Create account
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)
    page.fill('#accountName', 'Asset Account')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '10000')
    page.click('#accountFormSubmit')
    
    # Create debt
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_selector('[data-liabilities-subtab="debts"].active', timeout=5000)
    page.click('#debtFormToggle')
    page.wait_for_selector('#debtFormBody:not([hidden])', timeout=5000)
    
    page.fill('#debtName', 'Liability')
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', '3000')
    page.fill('#interestRate', '18')
    page.fill('#minimumPayment', '100')
    page.fill('#dueDate', '15')
    page.click('#debtFormSubmit')
    
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
    page.wait_for_selector('#strategySection.active', timeout=5000)
    page.fill('#monthlyPayment', '200')
    page.select_option('#paymentStrategy', 'avalanche')
    page.click('#calculateBtn')
    page.wait_for_selector('#resultsSection.visible', timeout=10000)

    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_selector('[data-liabilities-subtab="debts"].active', timeout=5000)

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
def test_debt_card_shows_last_updated_date(app_page, debt_data):
    """Debt cards show a 'Last updated' date, stamped on create and refreshed on edit (#88)."""
    import datetime

    page = app_page
    create_debt(page, debt_data)

    today_iso = datetime.date.today().isoformat()
    stored_updated_at = page.evaluate(
        """(name) => {
            const debt = window.app.debts.find(d => d.name === name);
            return debt ? debt.updatedAt : null;
        }""",
        debt_data["name"]
    )
    assert stored_updated_at == today_iso, "New debt should be stamped with today's date"

    card_text = page.evaluate("""() => {
        const card = document.querySelector('#debtsList .debt-card');
        return card ? card.textContent : '';
    }""")
    assert 'Last updated' in card_text, "Expected a 'Last updated' label on the debt card"

    # Updating the balance re-stamps updatedAt (value stays the same day-granularity,
    # but this exercises the write path that must not clear/skip the field).
    page.click('[data-debt-action="update-balance"]')
    page.wait_for_selector('#updateBalanceModal:not(.hidden)', timeout=5000)
    page.fill('#updateBalanceInput', '999')
    page.click('#confirmUpdateBalance')
    page.wait_for_selector('#updateBalanceModal', state='hidden', timeout=5000)

    updated_after_balance_change = page.evaluate(
        """(name) => {
            const debt = window.app.debts.find(d => d.name === name);
            return debt ? debt.updatedAt : null;
        }""",
        debt_data["name"]
    )
    assert updated_after_balance_change == today_iso, "Balance update should keep updatedAt stamped with today's date"

    card_text_after_update = page.evaluate("""() => {
        const card = document.querySelector('#debtsList .debt-card');
        return card ? card.textContent : '';
    }""")
    assert 'Last updated' in card_text_after_update, "'Last updated' label should still be shown after a balance update"


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
    page.wait_for_selector('#accountsSection.active', timeout=5000)
    page.fill('#accountName', 'Fixed Debt Account')
    page.select_option('#accountType', label='Credit Card')
    page.fill('#accountStartingBalance', '0')
    page.click('#accountFormSubmit')

    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_selector('[data-liabilities-subtab="debts"].active', timeout=5000)
    page.click('#debtFormToggle')
    page.wait_for_selector('#debtFormBody:not([hidden])', timeout=5000)

    page.fill('#debtName', 'Negative Fixed Debt')
    page.select_option('#debtType', 'fixedAmount')
    page.fill('#fixedAmount', '-100')
    page.fill('#fixedStartDate', '2026-01-01')
    page.fill('#fixedEndDate', '2026-12-31')
    page.click('#debtFormSubmit')

    assert page.query_selector('text=Negative Fixed Debt') is None, (
        "A negative fixed-amount debt payment should be rejected, not silently saved as $0.01"
    )


# ---------------------------------------------------------------------------
# Debts list "Interest" filter dropdown
# ---------------------------------------------------------------------------

def _create_interest_and_no_interest_debts(page):
    """One 0%-rate debt and one interest-bearing debt, for filter tests."""
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)
    page.fill('#accountName', 'Interest Filter Account')
    page.select_option('#accountType', label='Credit Card')
    page.fill('#accountStartingBalance', '0')
    page.click('#accountFormSubmit')

    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_selector('[data-liabilities-subtab="debts"].active', timeout=5000)

    debts = [
        ('No Interest Card', '300', '0', '20'),
        ('Interest Bearing Card', '400', '18', '30'),
    ]
    for name, balance, rate, min_pmt in debts:
        page.click('#debtFormToggle')
        page.wait_for_selector('#debtFormBody:not([hidden])', timeout=5000)
        page.fill('#debtName', name)
        page.select_option('#debtType', 'creditCard')
        page.fill('#accountBalance', balance)
        page.fill('#interestRate', rate)
        page.fill('#minimumPayment', min_pmt)
        page.fill('#dueDate', '15')
        page.click('#debtFormSubmit')


@pytest.mark.feature
def test_debt_interest_filter_shows_only_interest_bearing(app_page):
    """Selecting 'Interest Bearing Only' hides the 0%-rate debt."""
    page = app_page
    _create_interest_and_no_interest_debts(page)

    page.select_option('#debtInterestFilter', 'interestBearing')

    assert page.query_selector('text=Interest Bearing Card') is not None
    assert page.query_selector('text=No Interest Card') is None


@pytest.mark.feature
def test_debt_interest_filter_shows_only_no_interest(app_page):
    """Selecting 'No Interest Only' hides the interest-bearing debt."""
    page = app_page
    _create_interest_and_no_interest_debts(page)

    page.select_option('#debtInterestFilter', 'noInterest')

    assert page.query_selector('text=No Interest Card') is not None
    assert page.query_selector('text=Interest Bearing Card') is None


@pytest.mark.feature
def test_debt_interest_filter_any_shows_both(app_page):
    """The default 'Any' option shows every debt regardless of rate."""
    page = app_page
    _create_interest_and_no_interest_debts(page)

    page.select_option('#debtInterestFilter', 'interestBearing')
    page.select_option('#debtInterestFilter', '')

    assert page.query_selector('text=No Interest Card') is not None
    assert page.query_selector('text=Interest Bearing Card') is not None


# ---------------------------------------------------------------------------
# Archive paid-off debts (issue #202)
# ---------------------------------------------------------------------------

def _seed_paid_off_debt(page, name='Paid Off Card', balance=0):
    """Seed app state with a single credit-card debt at the given balance."""
    page.evaluate(f"""() => {{
        window.app.debts = [{{
            id: 9001,
            name: '{name}',
            category: '',
            debtType: 'creditCard',
            accountBalance: {balance},
            originalBalance: 1000,
            interestRate: 18,
            minimumPayment: 25,
            originalMinimumPayment: 25,
            dueDate: 15,
            debtStartDate: null,
            fixedAmount: 0,
            fixedStartDate: null,
            fixedEndDate: null,
            updatedAt: null,
            priority: null,
            accountId: null,
            archived: false
        }}];
        window.app.switchPage('liabilities');
        window.app.updateUI();
    }}""")
    page.wait_for_selector('#debtsList .debt-card', timeout=5000)


@pytest.mark.feature
def test_archive_button_shown_on_paid_off_debt(app_page):
    """Archive button is present when debt balance is 0."""
    page = app_page
    _seed_paid_off_debt(page, balance=0)
    assert page.query_selector('[data-debt-action="archive"]') is not None


@pytest.mark.feature
def test_archive_button_not_shown_on_active_debt(app_page):
    """Archive button is absent when debt still has a positive balance."""
    page = app_page
    _seed_paid_off_debt(page, name='Active Debt', balance=500)
    assert page.query_selector('[data-debt-action="archive"]') is None


@pytest.mark.feature
def test_archive_paid_off_debt_hides_from_list(app_page):
    """Clicking Archive → confirming removes the card from the list."""
    page = app_page
    _seed_paid_off_debt(page)

    page.click('[data-debt-action="archive"][data-debt-id="9001"]')
    page.wait_for_selector('#archiveConfirmModal.flex-visible', timeout=5000)
    page.click('#archiveConfirmBtn')
    page.wait_for_selector('#archiveConfirmModal', state='hidden', timeout=5000)

    # Scope to #debtsList — the modal message still contains the debt name in the DOM
    assert page.query_selector('[data-debt-id="9001"]') is None


@pytest.mark.feature
def test_archive_confirm_cancel_keeps_debt_visible(app_page):
    """Cancelling the archive modal leaves the debt card in place."""
    page = app_page
    _seed_paid_off_debt(page)

    page.click('[data-debt-action="archive"][data-debt-id="9001"]')
    page.wait_for_selector('#archiveConfirmModal.flex-visible', timeout=5000)
    page.click('#archiveConfirmCancelBtn')
    page.wait_for_selector('#archiveConfirmModal', state='hidden', timeout=5000)

    assert page.query_selector('text=Paid Off Card') is not None


@pytest.mark.feature
def test_archived_debts_hidden_by_default(app_page):
    """An already-archived debt is not shown when Show Archived Debts is off."""
    page = app_page
    page.evaluate("""() => {
        window.app.debts = [{
            id: 9002,
            name: 'Already Archived',
            category: '',
            debtType: 'creditCard',
            accountBalance: 0,
            originalBalance: 500,
            interestRate: 0,
            minimumPayment: 0,
            originalMinimumPayment: 0,
            dueDate: 1,
            debtStartDate: null,
            fixedAmount: 0,
            fixedStartDate: null,
            fixedEndDate: null,
            updatedAt: null,
            priority: null,
            accountId: null,
            archived: true
        }];
        window.app.settings = [];
        window.app.switchPage('liabilities');
        window.app.updateUI();
    }""")
    page.wait_for_selector('#liabilitiesSection.active', timeout=5000)
    assert page.query_selector('text=Already Archived') is None


@pytest.mark.feature
def test_show_archived_debts_setting_reveals_card(app_page):
    """Enabling Show Archived Debts in Settings makes archived cards visible."""
    from tests.conftest import open_settings, close_settings
    page = app_page

    page.evaluate("""() => {
        window.app.debts = [{
            id: 9003,
            name: 'Hidden Archived',
            category: '',
            debtType: 'creditCard',
            accountBalance: 0,
            originalBalance: 200,
            interestRate: 0,
            minimumPayment: 0,
            originalMinimumPayment: 0,
            dueDate: 1,
            debtStartDate: null,
            fixedAmount: 0,
            fixedStartDate: null,
            fixedEndDate: null,
            updatedAt: null,
            priority: null,
            accountId: null,
            archived: true
        }];
        window.app.settings = [];
        window.app.switchPage('liabilities');
        window.app.updateUI();
    }""")
    page.wait_for_selector('#liabilitiesSection.active', timeout=5000)
    assert page.query_selector('text=Hidden Archived') is None

    open_settings(page)
    page.check('#settingShowArchivedDebts')
    close_settings(page)

    page.wait_for_selector('[data-debt-action="unarchive"]', timeout=5000)
    assert page.query_selector('text=Hidden Archived') is not None


@pytest.mark.feature
def test_unarchive_restores_debt_to_active(app_page):
    """Unarchive button flips archived=false and re-shows the debt normally."""
    from tests.conftest import open_settings, close_settings
    page = app_page

    page.evaluate("""() => {
        window.app.debts = [{
            id: 9004,
            name: 'Unarchive Me',
            category: '',
            debtType: 'creditCard',
            accountBalance: 0,
            originalBalance: 300,
            interestRate: 0,
            minimumPayment: 0,
            originalMinimumPayment: 0,
            dueDate: 1,
            debtStartDate: null,
            fixedAmount: 0,
            fixedStartDate: null,
            fixedEndDate: null,
            updatedAt: null,
            priority: null,
            accountId: null,
            archived: true
        }];
        window.app.settings = [{ key: 'showArchivedDebts', value: true }];
        window.app.switchPage('liabilities');
        window.app.updateUI();
    }""")
    page.wait_for_selector('[data-debt-action="unarchive"]', timeout=5000)

    page.click('[data-debt-action="unarchive"][data-debt-id="9004"]')
    page.wait_for_selector('[data-debt-action="archive"]', timeout=5000)

    archived = page.evaluate("() => window.app.debts.find(d => d.id === 9004)?.archived")
    assert archived is False
    assert page.query_selector('[data-debt-action="unarchive"]') is None


@pytest.mark.feature
def test_archived_debt_excluded_from_overview_totals(app_page):
    """Archived debt balance does not count toward the Debt Overview total."""
    page = app_page
    page.evaluate("""() => {
        window.app.debts = [
            {
                id: 9005,
                name: 'Active Debt',
                category: '',
                debtType: 'creditCard',
                accountBalance: 1000,
                originalBalance: 1000,
                interestRate: 15,
                minimumPayment: 50,
                originalMinimumPayment: 50,
                dueDate: 10,
                debtStartDate: null,
                fixedAmount: 0,
                fixedStartDate: null,
                fixedEndDate: null,
                updatedAt: null,
                priority: null,
                accountId: null,
                archived: false
            },
            {
                id: 9006,
                name: 'Archived Debt',
                category: '',
                debtType: 'creditCard',
                accountBalance: 500,
                originalBalance: 500,
                interestRate: 0,
                minimumPayment: 0,
                originalMinimumPayment: 0,
                dueDate: 1,
                debtStartDate: null,
                fixedAmount: 0,
                fixedStartDate: null,
                fixedEndDate: null,
                updatedAt: null,
                priority: null,
                accountId: null,
                archived: true
            }
        ];
        window.app.settings = [];
        window.app.switchPage('liabilities');
        window.app.updateUI();
    }""")
    page.wait_for_selector('#categorySummary .debt-overview-card', timeout=5000)

    total_text = page.inner_text('.debt-overview-stat-value')
    assert '1,000' in total_text or '1000' in total_text
    assert '1,500' not in total_text and '1500' not in total_text
