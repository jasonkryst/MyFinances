#!/usr/bin/env python3
"""
Account Transfer Tracking UI Tests (issue #248)
Tests the Transfer modal (Accounts card + Ledger toolbar entry points),
Ledger row rendering (visual indicator, override exclusion, edit/delete),
and from/to validation.
"""

import pytest


def _seed_two_accounts(page, switch_to='accounts'):
    page.evaluate(f"""() => {{
        const app = window.app;
        app.accounts = [
            {{ id: 9301, name: 'Transfer UI Checking', type: 'Checking', startingBalance: 1000 }},
            {{ id: 9302, name: 'Transfer UI Savings', type: 'Savings', startingBalance: 500 }}
        ];
        app.incomes = []; app.bonuses = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = []; app.transfers = [];
        app.switchPage('{switch_to}');
    }}""")


@pytest.mark.ui
def test_transfer_modal_opens_from_accounts_card_prefilled(app_page):
    """Clicking the Transfer action on an account card opens the modal with
    that account pre-selected as From."""
    page = app_page
    _seed_two_accounts(page)

    page.click('[data-account-action="transfer"][data-account-id="9301"]')
    page.wait_for_selector('#transferModal.flex-visible', timeout=5000)

    from_value = page.evaluate('() => document.getElementById("transferModalFrom").value')
    assert from_value == '9301'


@pytest.mark.ui
def test_transfer_modal_submit_creates_transfer_and_shows_two_ledger_rows(app_page):
    """Submitting a valid transfer closes the modal and the Ledger shows
    both legs with the ⇄ visual indicator."""
    page = app_page
    _seed_two_accounts(page)

    page.click('[data-account-action="transfer"][data-account-id="9301"]')
    page.wait_for_selector('#transferModal.flex-visible', timeout=5000)
    page.select_option('#transferModalTo', value='9302')
    page.fill('#transferModalAmount', '250')
    # Leave the date at its default (today) -- the Ledger's rolling window is
    # anchored to the real current date, not a fixed test date.
    page.click('#transferModalConfirmBtn')
    page.wait_for_selector('#transferModal', state='hidden', timeout=5000)

    count = page.evaluate('() => window.app.transfers.length')
    assert count == 1

    page.evaluate("() => window.app.switchPage('ledger')")
    page.wait_for_selector('#ledgerSection.active', timeout=5000)
    page.select_option('#ledgerDateRange', value='all')
    page.wait_for_timeout(200)

    rows_text = page.evaluate("""
        () => Array.from(document.querySelectorAll('.ledger-table tbody td[data-col="name"]')).map(td => td.textContent)
    """)
    transfer_rows = [t for t in rows_text if '⇄' in t]
    assert len(transfer_rows) == 2, f"Expected 2 transfer rows, got: {rows_text}"


@pytest.mark.ui
def test_transfer_modal_same_account_disables_confirm_with_inline_error(app_page):
    """Selecting the same account for From and To shows an inline error and
    disables the confirm button, without needing to submit first."""
    page = app_page
    _seed_two_accounts(page)

    page.click('[data-account-action="transfer"][data-account-id="9301"]')
    page.wait_for_selector('#transferModal.flex-visible', timeout=5000)
    page.select_option('#transferModalTo', value='9301')

    error_visible = page.evaluate(
        '() => !document.getElementById("transferModalError").classList.contains("hidden")'
    )
    assert error_visible
    confirm_disabled = page.evaluate('() => document.getElementById("transferModalConfirmBtn").disabled')
    assert confirm_disabled


@pytest.mark.ui
def test_transfer_modal_cancel_and_escape_close_without_creating(app_page):
    """Cancel (and Escape) close the modal without creating a transfer."""
    page = app_page
    _seed_two_accounts(page)

    page.click('[data-account-action="transfer"][data-account-id="9301"]')
    page.wait_for_selector('#transferModal.flex-visible', timeout=5000)
    page.click('#transferModalCancelBtn')
    page.wait_for_selector('#transferModal', state='hidden', timeout=5000)

    count = page.evaluate('() => window.app.transfers.length')
    assert count == 0


@pytest.mark.ui
def test_ledger_toolbar_transfer_button_opens_modal(app_page):
    """The Ledger page's own ⇄ Transfer toolbar button opens the same modal."""
    page = app_page
    _seed_two_accounts(page, switch_to='ledger')

    page.wait_for_selector('#ledgerTransferBtn', timeout=5000)
    page.click('#ledgerTransferBtn')
    page.wait_for_selector('#transferModal.flex-visible', timeout=5000)


@pytest.mark.ui
def test_ledger_transfer_row_excludes_override_but_allows_cleared(app_page):
    """A transfer row offers no amount-override action (both legs must
    stay in sync with the one record) but still has a cleared checkbox."""
    page = app_page
    _seed_two_accounts(page)

    page.evaluate("""async () => {
        const today = new Date().toISOString().slice(0, 10);
        await window.app.addTransfer(9301, 9302, 250, today, '');
        window.app.switchPage('ledger');
    }""")
    page.wait_for_selector('#ledgerSection.active', timeout=5000)
    page.select_option('#ledgerDateRange', value='all')
    page.wait_for_timeout(200)

    override_buttons = page.evaluate(
        "() => document.querySelectorAll('.ledger-override-btn:not([data-ledger-transfer-edit])').length"
    )
    assert override_buttons == 0, "Transfer rows must not offer an amount-override action"

    cleared_checkboxes = page.evaluate(
        "() => document.querySelectorAll('.ledger-cleared-checkbox').length"
    )
    assert cleared_checkboxes == 2, "Both transfer legs should still be individually clearable"


@pytest.mark.ui
def test_ledger_transfer_edit_opens_prefilled_modal(app_page):
    """Clicking Edit on either leg's row opens the modal pre-filled with the
    transfer's current values."""
    page = app_page
    _seed_two_accounts(page)

    page.evaluate("""async () => {
        const today = new Date().toISOString().slice(0, 10);
        await window.app.addTransfer(9301, 9302, 250, today, 'Original memo');
        window.app.switchPage('ledger');
    }""")
    page.wait_for_selector('#ledgerSection.active', timeout=5000)
    page.select_option('#ledgerDateRange', value='all')
    page.wait_for_timeout(200)

    page.locator('[data-ledger-transfer-edit]').first.click()
    page.wait_for_selector('#transferModal.flex-visible', timeout=5000)

    title = page.evaluate('() => document.getElementById("transferModalTitle").textContent')
    assert title == 'Edit Transfer'
    amount_value = page.evaluate('() => document.getElementById("transferModalAmount").value')
    assert float(amount_value) == 250
    memo_value = page.evaluate('() => document.getElementById("transferModalMemo").value')
    assert memo_value == 'Original memo'

    page.fill('#transferModalAmount', '400')
    page.click('#transferModalConfirmBtn')
    page.wait_for_selector('#transferModal', state='hidden', timeout=5000)

    result = page.evaluate('() => ({ count: window.app.transfers.length, amount: window.app.transfers[0].amount })')
    assert result['count'] == 1, "Editing must not create a second transfer record"
    assert result['amount'] == 400


@pytest.mark.ui
def test_ledger_transfer_delete_removes_both_legs(app_page):
    """Confirming Delete on a transfer row removes the record and both
    ledger legs disappear."""
    page = app_page
    _seed_two_accounts(page)

    page.evaluate("""async () => {
        const today = new Date().toISOString().slice(0, 10);
        await window.app.addTransfer(9301, 9302, 250, today, '');
        window.app.switchPage('ledger');
    }""")
    page.wait_for_selector('#ledgerSection.active', timeout=5000)
    page.select_option('#ledgerDateRange', value='all')
    page.wait_for_timeout(200)

    page.locator('[data-ledger-transfer-delete]').first.click()
    page.wait_for_selector('#deleteConfirmModal.flex-visible', timeout=5000)
    page.click('#deleteConfirmBtn')
    page.wait_for_timeout(200)

    count = page.evaluate('() => window.app.transfers.length')
    assert count == 0
    remaining_transfer_rows = page.evaluate(
        "() => Array.from(document.querySelectorAll('.ledger-table tbody td[data-col=\"name\"]')).filter(td => td.textContent.includes('⇄')).length"
    )
    assert remaining_transfer_rows == 0
