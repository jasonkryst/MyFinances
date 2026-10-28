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
    page.evaluate(f"""async () => {{
        const app = window.app;
        app.accounts = [{{ id: 8001, name: 'Recon Checking', type: 'Checking', startingBalance: 1000 }}];
        {bill_js}
        app.incomes = []; app.bonuses = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = [];
        app.settings = [{{ key: 'reconciliationAdjustsBalance', value: true }}];
        app._reconciliationAccountFilter = 'all';
        app.switchPage('reconcile');
        await app.renderReconciliationPage();
    }}""")


@pytest.mark.ui
def test_reconcile_empty_state(app_page):
    """Reconcile page shows an empty state when no accounts exist."""
    page = app_page

    page.evaluate("""async () => {
        const app = window.app;
        app.accounts = [];
        app.incomes = []; app.bonuses = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = [];
        app.switchPage('reconcile');
        await app.renderReconciliationPage();
    }""")

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

    diff_el = page.query_selector('#recon-diff-8001')
    assert diff_el.text_content().strip() == '$100.00'
    assert 'recon-diff--pos' in diff_el.get_attribute('class')

    page.fill('#recon-balance-8001', '900')
    page.dispatch_event('#recon-balance-8001', 'input')

    diff_el = page.query_selector('#recon-diff-8001')
    assert diff_el.text_content().strip() == '-$100.00'
    assert 'recon-diff--neg' in diff_el.get_attribute('class')


@pytest.mark.ui
def test_statement_end_date_defaults_to_today_and_is_editable(app_page):
    """Statement end date defaults to today, start to the 1st of the month; both are editable."""
    page = app_page
    _seed_reconciliation_account(page)

    today = page.evaluate("""async () => {
        const mod = await import('/src/utils.js');
        return mod.todayISO();
    }""")

    assert page.input_value('#recon-end-8001') == today
    assert page.input_value('#recon-start-8001') == today[:8] + '01'

    page.fill('#recon-start-8001', '2026-01-01')
    page.fill('#recon-end-8001', '2026-01-15')
    assert page.input_value('#recon-start-8001') == '2026-01-01'
    assert page.input_value('#recon-end-8001') == '2026-01-15'


@pytest.mark.ui
def test_reconcile_button_updates_balance_and_history(app_page):
    """Clicking Reconcile updates the account balance and adds a history row with the badge."""
    page = app_page
    _seed_reconciliation_account(page)

    page.fill('#recon-balance-8001', '1234.56')
    page.fill('#recon-note-8001', 'Bank fee adjustment')
    page.click('[data-recon-action="reconcile"][data-recon-id="8001"]')
    page.wait_for_function(
        "() => (document.querySelector('.recon-card')?.textContent || '').includes('$1,234.56')",
        timeout=5000
    )

    card_text = page.query_selector('.recon-card').text_content()
    assert 'Current Tracked Balance: $1,234.56' in card_text

    history_text = page.query_selector('.recon-history-table').text_content()
    assert '🔄 Balance Reconciliation' in history_text
    assert 'Bank fee adjustment' in history_text
    assert '$1,234.56' in history_text

    # Accounts page should also reflect the updated balance
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)
    accounts_text = page.query_selector('#accountList').text_content()
    assert '$1,234.56' in accounts_text


@pytest.mark.ui
def test_history_filter_and_delete(app_page):
    """History table account filter narrows rows, and delete removes a row."""
    page = app_page

    page.evaluate("""async () => {
        const app = window.app;
        app.accounts = [
            { id: 8001, name: 'Recon Checking', type: 'Checking', startingBalance: 1000 },
            { id: 8002, name: 'Recon Savings', type: 'Savings', startingBalance: 500 }
        ];
        app.incomes = []; app.bonuses = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = [];
        app._reconciliationAccountFilter = 'all';
        await app.applyReconciliation(8001, 1100, 'Checking adj', '2026-06-01');
        await app.applyReconciliation(8002, 600, 'Savings adj', '2026-06-02');
        app.switchPage('reconcile');
        await app.renderReconciliationPage();
    }""")

    rows = page.query_selector_all('.recon-history-table tbody tr')
    assert len(rows) == 2

    page.select_option('#reconHistoryAccountFilter', label='Recon Checking (Checking)')

    rows = page.query_selector_all('.recon-history-table tbody tr')
    assert len(rows) == 1
    assert 'Checking adj' in rows[0].text_content()

    delete_btn = rows[0].query_selector('[data-recon-action="delete-history"]')
    assert delete_btn, "Expected a Delete button on the history row"
    delete_btn.click()

    history_text = page.query_selector('.recon-history-table').text_content()
    assert 'No reconciliation history yet.' in history_text


@pytest.mark.ui
def test_expected_transactions_details(app_page):
    """The 'Expected transactions {start} – {end}' details show matching bills, with an empty state otherwise."""
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

    # No reconcile button while "All Accounts" is selected
    assert page.query_selector('#reconcileFromLedgerBtn') is None

    page.select_option('#ledgerAccountFilter', label='Recon Ledger (Checking)')
    page.wait_for_selector('#reconcileFromLedgerBtn', timeout=5000)

    reconcile_btn = page.query_selector('#reconcileFromLedgerBtn')
    assert reconcile_btn, "Expected a Reconcile button when a specific account is selected"
    reconcile_btn.click()
    page.wait_for_selector('#reconcileModal.flex-visible', timeout=5000)

    modal_visible = page.evaluate(
        '() => document.getElementById("reconcileModal")?.classList.contains("flex-visible")'
    )
    assert modal_visible, "Reconcile modal should be visible after clicking the button"

    current_text = page.query_selector('#reconcileModalCurrent').text_content()
    assert '$1,000.00' in current_text

    page.fill('#reconcileModalBalance', '950')
    page.click('#reconcileModalConfirmBtn')
    page.wait_for_selector('#reconcileModal', state='hidden', timeout=5000)

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

    page.wait_for_selector('#reconcileModal.flex-visible', timeout=5000)
    modal_visible = page.evaluate(
        '() => document.getElementById("reconcileModal")?.classList.contains("flex-visible")'
    )
    assert modal_visible

    # Ensure focus is inside the modal before pressing Escape — the modal focuses
    # balanceInput via a 30ms setTimeout, so we wait for it rather than racing.
    page.wait_for_selector('#reconcileModalBalance:focus', timeout=2000)
    page.keyboard.press('Escape')
    page.wait_for_selector('#reconcileModal', state='hidden', timeout=5000)

    modal_hidden = page.evaluate(
        '() => document.getElementById("reconcileModal")?.classList.contains("hidden")'
    )
    assert modal_hidden, "Escape should close the reconcile modal"

    # Reopen and confirm via Enter
    page.evaluate('() => window.app.openReconcileModal(8004)')
    page.wait_for_selector('#reconcileModal.flex-visible', timeout=5000)

    page.fill('#reconcileModalBalance', '650')
    page.keyboard.press('Enter')
    page.wait_for_selector('#reconcileModal', state='hidden', timeout=5000)

    balance = page.evaluate('() => window.app.accounts.find(a => a.id === 8004).startingBalance')
    assert balance == 650, "Enter should confirm the reconciliation"


def _seed_recon_in_progress_account(page, account_id, with_bill=False):
    bill_js = (
        f"app.bills = [{{ id: {account_id + 500}, name: 'Rent', dueDay: 1, amount: 200, category: 'Housing', accountId: {account_id} }}];"
        if with_bill else "app.bills = [];"
    )
    page.evaluate(f"""() => {{
        const app = window.app;
        app.accounts = [{{ id: {account_id}, name: 'Recon In-Progress', type: 'Checking', startingBalance: 1000 }}];
        {bill_js}
        app.incomes = []; app.bonuses = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = [];
        app.settings = [{{ key: 'reconciliationAdjustsBalance', value: true }}];
        app.openReconcileModal({account_id});
    }}""")
    page.wait_for_selector('#reconcileModal.flex-visible', timeout=5000)
    page.wait_for_selector('#reconcileModalBalance:focus', timeout=2000)


@pytest.mark.ui
def test_recon_modal_cancel_with_changes_offers_save_progress(app_page):
    """Cancelling with unsaved edits opens the Save Progress / Discard /
    Keep Editing prompt instead of silently closing (issue #343)."""
    page = app_page
    _seed_recon_in_progress_account(page, 8101)

    page.fill('#reconcileModalBalance', '1234.56')
    page.click('#reconcileModalCancelBtn')

    page.wait_for_selector('#reconSaveProgressModal.flex-visible', timeout=5000)
    # The Reconcile modal itself must still be open behind the prompt.
    still_open = page.evaluate(
        '() => document.getElementById("reconcileModal")?.classList.contains("flex-visible")'
    )
    assert still_open, "Reconcile modal should remain open while the save-progress prompt is up"

    page.click('#reconSaveProgressSaveBtn')
    page.wait_for_selector('#reconcileModal', state='hidden', timeout=5000)

    saved = page.evaluate("""() => {
        const raw = JSON.parse(localStorage.getItem('debtTrackerReconInProgress') || '{}');
        return raw['8101'];
    }""")
    assert saved is not None, "Save Progress should persist state under debtTrackerReconInProgress"
    assert float(saved['statementBalance']) == 1234.56

    balance = page.evaluate('() => window.app.accounts.find(a => a.id === 8101).startingBalance')
    assert balance == 1000, "Saving progress must not apply the reconciliation itself"


@pytest.mark.ui
def test_recon_modal_resume_restores_fields_and_shows_banner(app_page):
    """Reopening an account with saved in-progress state restores the
    balance and shows the Resume indicator (issue #343)."""
    page = app_page
    _seed_recon_in_progress_account(page, 8102)

    page.fill('#reconcileModalBalance', '777.77')
    page.fill('#reconcileModalNote', 'Partial review')
    page.click('#reconcileModalCancelBtn')
    page.wait_for_selector('#reconSaveProgressModal.flex-visible', timeout=5000)
    page.click('#reconSaveProgressSaveBtn')
    page.wait_for_selector('#reconcileModal', state='hidden', timeout=5000)

    # Re-open the same account.
    page.evaluate('() => window.app.openReconcileModal(8102)')
    page.wait_for_selector('#reconcileModal.flex-visible', timeout=5000)

    banner_visible = page.evaluate(
        '() => !document.getElementById("reconcileModalResumeBanner")?.classList.contains("hidden")'
    )
    assert banner_visible, "Resuming should show the Resume indicator banner"

    balance_value = page.evaluate('() => document.getElementById("reconcileModalBalance").value')
    note_value = page.evaluate('() => document.getElementById("reconcileModalNote").value')
    assert float(balance_value) == 777.77
    assert note_value == 'Partial review'

    # Completing the reconciliation must clear the saved in-progress state.
    page.click('#reconcileModalConfirmBtn')
    page.wait_for_selector('#reconcileModal', state='hidden', timeout=5000)
    remaining = page.evaluate("""() => {
        const raw = JSON.parse(localStorage.getItem('debtTrackerReconInProgress') || '{}');
        return raw['8102'] || null;
    }""")
    assert remaining is None, "Completing the reconciliation should clear its in-progress state"


@pytest.mark.ui
def test_recon_modal_discard_drops_saved_state(app_page):
    """Choosing Discard removes any in-progress state and does not restore
    on the next open (issue #343)."""
    page = app_page
    _seed_recon_in_progress_account(page, 8103)

    page.fill('#reconcileModalBalance', '42')
    page.click('#reconcileModalCancelBtn')
    page.wait_for_selector('#reconSaveProgressModal.flex-visible', timeout=5000)
    page.click('#reconSaveProgressDiscardBtn')
    page.wait_for_selector('#reconcileModal', state='hidden', timeout=5000)

    saved = page.evaluate("""() => {
        const raw = JSON.parse(localStorage.getItem('debtTrackerReconInProgress') || '{}');
        return raw['8103'] || null;
    }""")
    assert saved is None, "Discard must not persist any in-progress state"

    page.evaluate('() => window.app.openReconcileModal(8103)')
    page.wait_for_selector('#reconcileModal.flex-visible', timeout=5000)
    banner_visible = page.evaluate(
        '() => !document.getElementById("reconcileModalResumeBanner")?.classList.contains("hidden")'
    )
    assert not banner_visible, "Discarded progress should not show the Resume indicator on reopen"
    balance_value = page.evaluate('() => document.getElementById("reconcileModalBalance").value')
    assert float(balance_value) == 1000, "Discarded progress should not be restored"


@pytest.mark.ui
def test_recon_modal_keep_editing_stays_open(app_page):
    """Choosing Keep Editing dismisses the prompt without closing the
    Reconcile modal or losing the typed value (issue #343)."""
    page = app_page
    _seed_recon_in_progress_account(page, 8104)

    page.fill('#reconcileModalBalance', '555')
    page.click('#reconcileModalCancelBtn')
    page.wait_for_selector('#reconSaveProgressModal.flex-visible', timeout=5000)
    page.click('#reconSaveProgressKeepEditingBtn')

    page.wait_for_selector('#reconSaveProgressModal', state='hidden', timeout=5000)
    still_open = page.evaluate(
        '() => document.getElementById("reconcileModal")?.classList.contains("flex-visible")'
    )
    assert still_open, "Keep Editing must leave the Reconcile modal open"
    balance_value = page.evaluate('() => document.getElementById("reconcileModalBalance").value')
    assert float(balance_value) == 555, "Keep Editing must not discard the typed value"


@pytest.mark.ui
def test_recon_modal_cancel_with_no_changes_closes_without_prompt(app_page):
    """Cancelling with no edits at all closes immediately -- no prompt for
    nothing-to-lose (regression guard for issue #343)."""
    page = app_page
    _seed_recon_in_progress_account(page, 8105)

    page.click('#reconcileModalCancelBtn')
    page.wait_for_selector('#reconcileModal', state='hidden', timeout=5000)

    prompt_visible = page.evaluate(
        '() => document.getElementById("reconSaveProgressModal")?.classList.contains("flex-visible")'
    )
    assert not prompt_visible, "No changes were made, so no save-progress prompt should appear"


@pytest.mark.ui
def test_recon_modal_checking_expected_transaction_counts_as_progress(app_page):
    """Checking a reviewed checkbox on an expected transaction, with no
    other field changed, still triggers the save-progress prompt, and the
    checked transaction id round-trips through Save Progress (issue #343)."""
    page = app_page
    _seed_recon_in_progress_account(page, 8106, with_bill=True)

    # Expected transactions render inside a collapsed <details> -- open it
    # before interacting with the checkbox, which is not actually visible
    # (let alone clickable) while collapsed.
    page.click('#reconcileModalExpectedSummary')
    page.wait_for_selector('#reconcileModalExpected .recon-expected-checkbox', timeout=5000)
    checkbox = page.query_selector('#reconcileModalExpected .recon-expected-checkbox')
    assert checkbox, "Expected transaction row should render a reviewed checkbox in the modal"
    checkbox.click()

    page.click('#reconcileModalCancelBtn')
    page.wait_for_selector('#reconSaveProgressModal.flex-visible', timeout=5000)
    page.click('#reconSaveProgressSaveBtn')
    page.wait_for_selector('#reconcileModal', state='hidden', timeout=5000)

    saved = page.evaluate("""() => {
        const raw = JSON.parse(localStorage.getItem('debtTrackerReconInProgress') || '{}');
        return raw['8106'];
    }""")
    assert saved is not None
    assert len(saved['clearedTxIds']) == 1
    assert 'bill|8606|8106|' in saved['clearedTxIds'][0]
