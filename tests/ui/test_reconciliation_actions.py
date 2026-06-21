#!/usr/bin/env python3
"""
Account Reconciliation UI Tests
Tests the Reconcile page (empty state, cards, live diff, history table)
and the quick-reconcile modal launched from the Ledger page.
"""

import pytest


def _seed_reconciliation_account(page, with_bill=False):
    """Create a single checking account on the Reconcile page, optionally with a bill."""
    bill_js = (
        "app.bills = [{ id: 80, name: 'Rent', dueDay: 1, amount: 200, category: 'Housing', accountId: 8001 }];"
        if with_bill else "app.bills = [];"
    )
    page.evaluate(f"""() => {{
        const app = window.app;
        app.accounts = [{{ id: 8001, name: 'Recon Checking', type: 'Checking', startingBalance: 1000 }}];
        {bill_js}
        app.incomes = []; app.bonuses = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = [];
        app.settings = [{{ key: 'reconciliationAdjustsBalance', value: true }}];
        app._reconciliationAccountFilter = 'all';
        app.switchPage('reconcile');
    }}""")
    page.wait_for_timeout(300)


@pytest.mark.ui
def test_reconcile_empty_state(app_page):
    """Reconcile page shows an empty state when no accounts exist."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [];
        app.incomes = []; app.bonuses = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = [];
        app.switchPage('reconcile');
    }""")
    page.wait_for_timeout(300)

    section_text = page.query_selector('#reconcileSection').text_content()
    assert 'No accounts yet. Add an account first to reconcile its balance.' in section_text


@pytest.mark.ui
def test_reconcile_card_shows_current_balance_and_live_diff(app_page):
    """Reconcile card shows the current tracked balance and a live, color-coded diff."""
    page = app_page
    _seed_reconciliation_account(page)

    card_text = page.query_selector('.recon-card').text_content()
    assert 'Current Tracked Balance: $1,000.00' in card_text

    page.fill('#recon-balance-8001', '1100')
    page.dispatch_event('#recon-balance-8001', 'input')
    page.wait_for_timeout(100)

    diff_el = page.query_selector('#recon-diff-8001')
    assert diff_el.text_content().strip() == '$100.00'
    assert 'recon-diff--pos' in diff_el.get_attribute('class')

    page.fill('#recon-balance-8001', '900')
    page.dispatch_event('#recon-balance-8001', 'input')
    page.wait_for_timeout(100)

    diff_el = page.query_selector('#recon-diff-8001')
    assert diff_el.text_content().strip() == '-$100.00'
    assert 'recon-diff--neg' in diff_el.get_attribute('class')


@pytest.mark.ui
def test_statement_date_defaults_to_today_and_is_editable(app_page):
    """Statement date input defaults to today and can be changed to a past date."""
    page = app_page
    _seed_reconciliation_account(page)

    today = page.evaluate("""async () => {
        const mod = await import('/src/utils.js');
        return mod.todayISO();
    }""")

    date_value = page.input_value('#recon-date-8001')
    assert date_value == today

    page.fill('#recon-date-8001', '2026-01-15')
    assert page.input_value('#recon-date-8001') == '2026-01-15'


@pytest.mark.ui
def test_reconcile_button_updates_balance_and_history(app_page):
    """Clicking Reconcile updates the account balance and adds a history row with the badge."""
    page = app_page
    _seed_reconciliation_account(page)

    page.fill('#recon-balance-8001', '1234.56')
    page.fill('#recon-note-8001', 'Bank fee adjustment')
    page.click('[data-recon-action="reconcile"][data-recon-id="8001"]')
    page.wait_for_timeout(300)

    card_text = page.query_selector('.recon-card').text_content()
    assert 'Current Tracked Balance: $1,234.56' in card_text

    history_text = page.query_selector('.recon-history-table').text_content()
    assert '🔄 Balance Reconciliation' in history_text
    assert 'Bank fee adjustment' in history_text
    assert '$1,234.56' in history_text

    # Accounts page should also reflect the updated balance
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    accounts_text = page.query_selector('#accountList').text_content()
    assert '$1,234.56' in accounts_text


@pytest.mark.ui
def test_history_filter_and_delete(app_page):
    """History table account filter narrows rows, and delete removes a row."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [
            { id: 8001, name: 'Recon Checking', type: 'Checking', startingBalance: 1000 },
            { id: 8002, name: 'Recon Savings', type: 'Savings', startingBalance: 500 }
        ];
        app.incomes = []; app.bonuses = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = [];
        app._reconciliationAccountFilter = 'all';
        app.applyReconciliation(8001, 1100, 'Checking adj', '2026-06-01');
        app.applyReconciliation(8002, 600, 'Savings adj', '2026-06-02');
        app.switchPage('reconcile');
    }""")
    page.wait_for_timeout(300)

    rows = page.query_selector_all('.recon-history-table tbody tr')
    assert len(rows) == 2

    page.select_option('#reconHistoryAccountFilter', label='Recon Checking')
    page.wait_for_timeout(300)

    rows = page.query_selector_all('.recon-history-table tbody tr')
    assert len(rows) == 1
    assert 'Checking adj' in rows[0].text_content()

    delete_btn = rows[0].query_selector('[data-recon-action="delete-history"]')
    assert delete_btn, "Expected a Delete button on the history row"
    delete_btn.click()
    page.wait_for_timeout(300)

    history_text = page.query_selector('.recon-history-table').text_content()
    assert 'No reconciliation history yet.' in history_text


@pytest.mark.ui
def test_expected_transactions_details(app_page):
    """The 'Expected transactions since {date}' details show matching bills, with an empty state otherwise."""
    page = app_page

    # No bills: empty state
    _seed_reconciliation_account(page, with_bill=False)
    details_text = page.query_selector('.recon-expected').text_content()
    assert 'No expected transactions in this period.' in details_text

    # With a bill due on the 1st of the month
    _seed_reconciliation_account(page, with_bill=True)
    expected_table = page.query_selector('.recon-expected-table')
    assert expected_table, "Expected a table of upcoming transactions when a bill exists this period"
    assert 'Rent' in expected_table.text_content()


@pytest.mark.ui
def test_ledger_reconcile_button_and_modal(app_page):
    """The Ledger page shows a Reconcile button for a selected account; confirming updates balances."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 8003, name: 'Recon Ledger', type: 'Checking', startingBalance: 1000 }];
        app.bills = [{ id: 83, name: 'Internet', dueDay: 1, amount: 60, category: 'Utilities', accountId: 8003 }];
        app.incomes = []; app.bonuses = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = [];
        app.settings = [{ key: 'reconciliationAdjustsBalance', value: true }];
        app.switchPage('ledger');
    }""")
    page.wait_for_timeout(300)

    # No reconcile button while "All Accounts" is selected
    assert page.query_selector('#reconcileFromLedgerBtn') is None

    page.select_option('#ledgerAccountFilter', label='Recon Ledger')
    page.wait_for_timeout(300)

    reconcile_btn = page.query_selector('#reconcileFromLedgerBtn')
    assert reconcile_btn, "Expected a Reconcile button when a specific account is selected"
    reconcile_btn.click()
    page.wait_for_timeout(300)

    modal_visible = page.evaluate(
        '() => document.getElementById("reconcileModal")?.classList.contains("flex-visible")'
    )
    assert modal_visible, "Reconcile modal should be visible after clicking the button"

    current_text = page.query_selector('#reconcileModalCurrent').text_content()
    assert '$1,000.00' in current_text

    page.fill('#reconcileModalBalance', '950')
    page.click('#reconcileModalConfirmBtn')
    page.wait_for_timeout(300)

    modal_hidden = page.evaluate(
        '() => document.getElementById("reconcileModal")?.classList.contains("hidden")'
    )
    assert modal_hidden, "Reconcile modal should close after confirming"

    balance = page.evaluate('() => window.app.accounts.find(a => a.id === 8003).startingBalance')
    assert balance == 950, "Confirming the modal should update the account's tracked balance"


@pytest.mark.ui
def test_reconcile_modal_escape_and_enter(app_page):
    """Escape closes the reconcile modal; Enter confirms it."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 8004, name: 'Recon Keys', type: 'Checking', startingBalance: 500 }];
        app.incomes = []; app.bonuses = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = [];
        app.settings = [{ key: 'reconciliationAdjustsBalance', value: true }];
        app.openReconcileModal(8004);
    }""")
    page.wait_for_timeout(300)

    modal_visible = page.evaluate(
        '() => document.getElementById("reconcileModal")?.classList.contains("flex-visible")'
    )
    assert modal_visible

    page.keyboard.press('Escape')
    page.wait_for_timeout(300)

    modal_hidden = page.evaluate(
        '() => document.getElementById("reconcileModal")?.classList.contains("hidden")'
    )
    assert modal_hidden, "Escape should close the reconcile modal"

    # Reopen and confirm via Enter
    page.evaluate('() => window.app.openReconcileModal(8004)')
    page.wait_for_timeout(300)

    page.fill('#reconcileModalBalance', '650')
    page.keyboard.press('Enter')
    page.wait_for_timeout(300)

    balance = page.evaluate('() => window.app.accounts.find(a => a.id === 8004).startingBalance')
    assert balance == 650, "Enter should confirm the reconciliation"
