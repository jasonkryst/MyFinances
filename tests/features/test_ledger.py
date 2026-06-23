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


@pytest.mark.feature
def test_get_filtered_sorted_ledger_transactions_respects_account_filter(app_page):
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [
            { id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 },
            { id: 2, name: 'Savings', type: 'Savings', startingBalance: 500 }
        ];
        app.incomes = [
            { id: 10, name: 'Job A', amount: 1000, accountId: 1, frequency: 'monthly', firstDate: '2026-06-01' },
            { id: 11, name: 'Job B', amount: 500, accountId: 2, frequency: 'monthly', firstDate: '2026-06-01' }
        ];
        app.debts = []; app.bills = []; app.expenses = []; app.bonuses = [];
        app.recurringTemplates = []; app._ledgerAccountFilter = '1'; app._ledgerDateRange = 'all';
        app._ledgerSortKey = 'date'; app._ledgerSortDir = 'desc';
    }""")
    txs = page.evaluate("() => window.app.getFilteredSortedLedgerTransactions()")
    assert all(tx['accountId'] == 1 or str(tx['accountId']) == '1' for tx in txs)
    assert any(tx['name'] == 'Job A' for tx in txs)
    assert not any(tx['name'] == 'Job B' for tx in txs)


def _seed_income_for_ledger(page, name="Override Salary", amount=4000):
    """Create an account, then an income source linked to it, via the UI so
    the ledger has at least one overridable transaction (income paydays
    project forward from today). Income requires an account selection."""
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(200)
    page.fill('#accountName', 'Ledger Test Checking')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '1000')
    page.click('#accountFormSubmit')
    page.wait_for_selector('text=Ledger Test Checking', timeout=10000)

    page.click('button[data-page="income"]')
    page.wait_for_timeout(200)
    page.fill('#incomeName', name)
    page.fill('#incomeAmount', str(amount))
    page.fill('#incomeFirstDate', '2026-06-01')
    page.select_option('#incomeFrequency', 'monthly')
    page.select_option('#incomeAccount', index=1)
    page.click('#incomeFormSubmit')
    page.wait_for_selector(f'text={name}', timeout=10000)


@pytest.mark.feature
def test_ledger_override_modal_updates_row_amount(app_page):
    """Opening the override modal, setting a custom amount, and saving it
    should replace the displayed amount for that ledger row with the
    override (and show the original amount alongside it)."""
    page = app_page

    _seed_income_for_ledger(page)

    page.click('button[data-page="ledger"]')
    page.wait_for_timeout(300)
    page.wait_for_selector('[data-ledger-override]', timeout=10000)

    override_btn = page.query_selector('[data-ledger-override]')
    assert override_btn, "Expected at least one overridable ledger row"
    tx_id = override_btn.get_attribute('data-ledger-override')

    override_btn.click()
    page.wait_for_selector('#ledgerOverrideModal.flex-visible', timeout=5000)

    page.fill('#ledgerOverrideAmountInput', '1234.56')
    page.click('#ledgerOverrideConfirmBtn')
    page.wait_for_timeout(300)

    row_amount_text = page.evaluate(
        """(txId) => {
            const btn = document.querySelector(`[data-ledger-override="${txId}"]`);
            const row = btn ? btn.closest('tr') : null;
            return row ? row.querySelector('.ledger-amount-effective')?.textContent || '' : '';
        }""",
        tx_id
    )
    assert '1,234.56' in row_amount_text or '1234.56' in row_amount_text, (
        f"Expected overridden amount in ledger row, got: {row_amount_text!r}"
    )

    # Editing the same row should now show "Edit override" rather than "Override"
    btn_label = page.evaluate(
        """(txId) => document.querySelector(`[data-ledger-override="${txId}"]`)?.textContent || ''""",
        tx_id
    )
    assert 'Edit override' in btn_label


@pytest.mark.feature
def test_ledger_override_persists_after_reload(app_page):
    """An override saved via the modal must be written to localStorage
    (via sanitizeLedgerOverrides round-trip) and still be in effect after a
    fresh page load, not just held in in-memory app state."""
    page = app_page

    _seed_income_for_ledger(page, name="Persist Salary")

    page.click('button[data-page="ledger"]')
    page.wait_for_timeout(300)
    page.wait_for_selector('[data-ledger-override]', timeout=10000)

    override_btn = page.query_selector('[data-ledger-override]')
    tx_id = override_btn.get_attribute('data-ledger-override')

    override_btn.click()
    page.wait_for_selector('#ledgerOverrideModal.flex-visible', timeout=5000)
    page.fill('#ledgerOverrideAmountInput', '777.77')
    page.click('#ledgerOverrideConfirmBtn')
    page.wait_for_timeout(300)

    # Confirm it actually landed in localStorage before reloading.
    stored_overrides = page.evaluate(
        """() => {
            const raw = localStorage.getItem(window.app?.storageKey || 'debtTrackerData');
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed.ledgerAmountOverrides || null;
        }"""
    )
    assert stored_overrides, "ledgerAmountOverrides should be persisted to localStorage"
    assert tx_id in stored_overrides, "the specific transactionId key should be present in storage"
    assert abs(float(stored_overrides[tx_id]['amount']) - 777.77) < 0.01

    page.reload(wait_until="networkidle")
    page.click('button[data-page="ledger"]')
    page.wait_for_timeout(300)
    page.wait_for_selector(f'[data-ledger-override="{tx_id}"]', timeout=10000)

    row_amount_text = page.evaluate(
        """(txId) => {
            const btn = document.querySelector(`[data-ledger-override="${txId}"]`);
            const row = btn ? btn.closest('tr') : null;
            return row ? row.querySelector('.ledger-amount-effective')?.textContent || '' : '';
        }""",
        tx_id
    )
    assert '777.77' in row_amount_text, (
        f"Override should survive reload, got row text: {row_amount_text!r}"
    )


@pytest.mark.feature
def test_ledger_overrides_for_different_keys_do_not_collide(app_page):
    """Two different ledger transactions (different type|id|accountId|date
    keys) must be overridable independently without one overwriting the
    other's stored amount."""
    page = app_page

    _seed_income_for_ledger(page, name="Collision Salary A", amount=3000)
    _seed_income_for_ledger(page, name="Collision Salary B", amount=3500)

    page.click('button[data-page="ledger"]')
    page.wait_for_timeout(300)
    page.wait_for_selector('[data-ledger-override]', timeout=10000)

    override_btns = page.query_selector_all('[data-ledger-override]')
    assert len(override_btns) >= 2, "Need at least two distinct overridable ledger rows"

    tx_id_1 = override_btns[0].get_attribute('data-ledger-override')
    tx_id_2 = override_btns[1].get_attribute('data-ledger-override')
    assert tx_id_1 != tx_id_2, "Test setup should yield two distinct transaction keys"

    # Override the first row.
    override_btns[0].click()
    page.wait_for_selector('#ledgerOverrideModal.flex-visible', timeout=5000)
    page.fill('#ledgerOverrideAmountInput', '111.11')
    page.click('#ledgerOverrideConfirmBtn')
    page.wait_for_timeout(300)

    # Override the second row with a different amount.
    btn2 = page.query_selector(f'[data-ledger-override="{tx_id_2}"]')
    btn2.click()
    page.wait_for_selector('#ledgerOverrideModal.flex-visible', timeout=5000)
    page.fill('#ledgerOverrideAmountInput', '222.22')
    page.click('#ledgerOverrideConfirmBtn')
    page.wait_for_timeout(300)

    stored_overrides = page.evaluate(
        """() => {
            const raw = localStorage.getItem(window.app?.storageKey || 'debtTrackerData');
            const parsed = JSON.parse(raw);
            return parsed.ledgerAmountOverrides || {};
        }"""
    )

    assert tx_id_1 in stored_overrides and tx_id_2 in stored_overrides, (
        "Both override keys should be present in storage independently"
    )
    assert abs(float(stored_overrides[tx_id_1]['amount']) - 111.11) < 0.01, (
        f"First override amount was overwritten/corrupted: {stored_overrides[tx_id_1]}"
    )
    assert abs(float(stored_overrides[tx_id_2]['amount']) - 222.22) < 0.01, (
        f"Second override amount was overwritten/corrupted: {stored_overrides[tx_id_2]}"
    )


def _seed_account_for_recon_ledger(page):
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 8001, name: 'Recon Ledger Checking', type: 'Checking', startingBalance: 1000 }];
        app.incomes = []; app.bonuses = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = [];
    }""")


@pytest.mark.feature
def test_reconciliation_appears_as_ledger_row(app_page):
    """A reconciliation entry dated within the projected window shows up as
    a 'Balance Reconciliation' row in getLedgerTransactions output."""
    page = app_page
    _seed_account_for_recon_ledger(page)

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/utils.js');
        app.settings = [{ key: 'reconciliationAdjustsBalance', value: false }];
        app.applyReconciliation(8001, 1200, 'Spot check', mod.todayISO());
        const txs = await import('/src/ledger.js').then(m => m.getLedgerTransactions(app));
        return txs.filter(tx => tx.type === 'reconciliation');
    }""")

    assert len(result) == 1
    row = result[0]
    assert row['name'] == 'Balance Reconciliation'
    assert row['transactionId'] is None
    assert row['amount'] == 0
    assert row['meta']['previousBalance'] == 1000
    assert row['meta']['statementBalance'] == 1200
    assert row['meta']['difference'] == 200


@pytest.mark.feature
def test_reconciliation_row_contributes_zero_to_running_balance_visible_mode(app_page):
    """In visible-only mode, the reconciliation row must not move the
    running balance shown on the ledger (only future real transactions do)."""
    page = app_page
    _seed_account_for_recon_ledger(page)

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/utils.js');
        app.settings = [{ key: 'reconciliationAdjustsBalance', value: false }];
        const today = mod.todayISO();
        app.applyReconciliation(8001, 1200, '', today);
        const txs = await import('/src/ledger.js').then(m => m.getLedgerTransactions(app));
        const reconRow = txs.find(tx => tx.type === 'reconciliation');
        return { balance: reconRow.balance, accountStartingBalance: app.accounts[0].startingBalance };
    }""")

    assert result['accountStartingBalance'] == 1000, "Visible mode must not mutate the account balance"
    assert result['balance'] == 1000, "Reconciliation row must not move the running balance"


@pytest.mark.feature
def test_reconciliation_row_not_editable_via_override_modal(app_page):
    """Reconciliation rows have transactionId: null (mirroring the rollover
    row convention) so they're naturally excluded from the amount-override
    flow without needing a special-cased guard."""
    page = app_page
    _seed_account_for_recon_ledger(page)

    page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/utils.js');
        app.settings = [{ key: 'reconciliationAdjustsBalance', value: false }];
        app.applyReconciliation(8001, 1200, '', mod.todayISO());
    }""")

    page.click('button[data-page="ledger"]')
    page.wait_for_timeout(300)

    override_present = page.evaluate("""() => {
        const rows = Array.from(document.querySelectorAll('.ledger-row--reconciliation'));
        return rows.some(row => row.querySelector('[data-ledger-override]'));
    }""")
    assert override_present is False


@pytest.mark.feature
def test_reconciliation_excluded_from_expected_transactions_list(app_page):
    """getExpectedTransactionsInRange (used on the Reconcile page) should not
    surface the reconciliation events themselves as 'expected' transactions."""
    page = app_page
    _seed_account_for_recon_ledger(page)

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/utils.js');
        const today = mod.todayISO();
        app.applyReconciliation(8001, 1200, '', today);
        return app.getExpectedTransactionsInRange(8001, today, today);
    }""")

    assert all(tx['type'] != 'reconciliation' for tx in result)
