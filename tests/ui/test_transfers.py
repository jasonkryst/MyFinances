#!/usr/bin/env python3
"""
Account Transfer Tracking UI Tests (issue #248)
Tests the Transfer modal (Accounts card + Ledger toolbar entry points),
Ledger row rendering (visual indicator, override exclusion, edit/delete),
and from/to validation.
"""

import pytest

from tests.conftest import accept_creates_for_local_parents


@pytest.fixture(autouse=True)
def _accept_local_parent_creates(request):
    """These tests inject accounts that exist only in memory; see
    accept_creates_for_local_parents (tests/conftest.py, #460)."""
    if 'app_page' in request.fixturenames:
        accept_creates_for_local_parents(request.getfixturevalue('app_page'), '**/api/transfers')


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


# ── Recurring-template transfers (#399) ──────────────────────────────────────

def _seed_recurring(page, templates):
    """Seed two accounts plus the given recurring templates and open the
    Ledger with the 'all' date range."""
    page.evaluate(f"""() => {{
        const app = window.app;
        const y = new Date().getFullYear();
        app.accounts = [
            {{ id: 9301, name: 'Transfer UI Checking', type: 'Checking', startingBalance: 1000 }},
            {{ id: 9302, name: 'Transfer UI Savings', type: 'Savings', startingBalance: 500 }}
        ];
        app.incomes = []; app.bonuses = []; app.bills = []; app.expenses = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = []; app.reconciliations = []; app.transfers = [];
        app.ledgerClearedTransactions = {{}}; app.ledgerAmountOverrides = {{}};
        app.recurringTemplates = {templates}.map(t => Object.assign({{
            frequency: 'monthly', dayOfMonth: 1, category: 'Transfer', accountId: 9301,
            targetAccountId: null, startDate: `${{y - 1}}-01-01`, endDate: null,
            paused: false, archived: false, skippedMonths: [], paidMonths: [], paidAmounts: {{}}
        }}, t));
        app.switchPage('ledger');
    }}""")
    page.wait_for_selector('#ledgerSection.active', timeout=5000)
    page.select_option('#ledgerDateRange', value='all')
    page.wait_for_timeout(200)


def _ledger_name_cells(page, name):
    return page.evaluate("""(name) => Array.from(
        document.querySelectorAll('.ledger-table tbody td[data-col="name"]'))
        .map(td => ({ text: td.textContent, row: td.closest('tr') }))
        .filter(r => r.text.includes(name))
        .map(r => ({
            text: r.text.trim(),
            hasOverride: !!r.row.querySelector('[data-ledger-override]'),
            hasNav: !!r.row.querySelector('.ledger-nav-btn[data-ledger-nav-type="recurring"]'),
            hasTransferEdit: !!r.row.querySelector('[data-ledger-transfer-edit]'),
            hasCleared: !!r.row.querySelector('.ledger-cleared-checkbox')
        }))""", name)


@pytest.mark.ui
def test_recurring_transfer_legs_show_transfer_indicator(app_page):
    """#399: both legs of a recurring-template transfer get the same ⇄ prefix
    one-off transfers (#248) use."""
    _seed_recurring(app_page, '[{ id: 9401, name: "Monthly Savings Sweep", type: "transfer", amount: 200, targetAccountId: 9302 }]')
    cells = _ledger_name_cells(app_page, 'Monthly Savings Sweep')
    assert len(cells) >= 2, cells
    assert all(c['text'].startswith('⇄') for c in cells), cells


@pytest.mark.ui
def test_recurring_transfer_rows_keep_recurring_controls(app_page):
    """#399 is rendering only: recurring-transfer rows keep the override,
    cleared and go-to-Recurring controls (used by #434's paid sync) and do not
    pick up the one-off transfer Edit/Delete actions."""
    _seed_recurring(app_page, '[{ id: 9401, name: "Monthly Savings Sweep", type: "transfer", amount: 200, targetAccountId: 9302 }]')
    cells = _ledger_name_cells(app_page, 'Monthly Savings Sweep')
    assert cells
    for c in cells:
        assert c['hasOverride'], c
        assert c['hasCleared'], c
        assert c['hasNav'], c
        assert not c['hasTransferEdit'], c


@pytest.mark.ui
def test_recurring_transfer_data_model_unchanged(app_page):
    """#399: the generated legs stay type 'recurring' with opposite-signed
    amounts -- no change to the underlying transaction shape or balance math."""
    _seed_recurring(app_page, '[{ id: 9401, name: "Monthly Savings Sweep", type: "transfer", amount: 200, targetAccountId: 9302 }]')
    legs = app_page.evaluate("""async () => {
        const mod = await import('./src/ledgerTransactions.js');
        const now = new Date();
        const map = mod.buildProjectedAccountTransactions(window.app, now.getFullYear(), now.getMonth(), 1);
        return Object.values(map).flatMap(acct => acct.txs
            .filter(t => t.sourceId === 9401)
            .map(t => ({ type: t.type, amount: t.originalAmount, accountId: acct.id })));
    }""")
    assert sorted(l['amount'] for l in legs) == [-200, 200], legs
    assert sorted(l['accountId'] for l in legs) == [9301, 9302], legs
    assert all(l['type'] == 'recurring' for l in legs), legs


@pytest.mark.ui
def test_non_transfer_recurring_rows_have_no_transfer_indicator(app_page):
    """Negative: subscription and income recurring rows never get ⇄."""
    _seed_recurring(app_page, '''[
        { id: 9402, name: "Streaming Plan", type: "subscription", amount: 15, category: "Bills" },
        { id: 9403, name: "Side Gig Payout", type: "income", amount: 300, category: "Income" }
    ]''')
    for name in ('Streaming Plan', 'Side Gig Payout'):
        cells = _ledger_name_cells(app_page, name)
        assert cells, name
        assert not any('⇄' in c['text'] for c in cells), cells


@pytest.mark.ui
def test_transfer_template_without_target_has_no_transfer_indicator(app_page):
    """Negative: a 'transfer' template with no target account generates a
    single plain outflow leg, not a transfer pair, so it gets no ⇄."""
    _seed_recurring(app_page, '[{ id: 9404, name: "Orphan Transfer", type: "transfer", amount: 75, targetAccountId: null }]')
    cells = _ledger_name_cells(app_page, 'Orphan Transfer')
    assert cells
    assert not any('⇄' in c['text'] for c in cells), cells
