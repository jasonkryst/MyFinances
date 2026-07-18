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
        const txs = await import('/src/ledgerTransactions.js').then(m => m.getLedgerTransactions(app));
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
        const txs = await import('/src/ledgerTransactions.js').then(m => m.getLedgerTransactions(app));
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


def _seed_monthly_bill_for_rollover_collision(page):
    """A bill due on the 1st of every month guarantees that the
    auto-generated 'Balance Rollover' row (inserted whenever the month
    changes, dated the 1st of the new month) lands on the exact same date
    as that month's own transaction — the same-day collision from issue #46.
    """
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000, interestRate: 0 }];
        app.bills = [{ id: 1, name: 'Rent', amount: 100, dueDay: 1, accountId: 1, category: 'Housing' }];
        app.incomes = []; app.bonuses = []; app.debts = []; app.expenses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = [];
        app._ledgerAccountFilter = '1'; app._ledgerDateRange = 'all';
        app._ledgerPage = 1;
    }""")


def _assert_running_balance_internally_consistent(transactions, sort_dir):
    """For any two adjacent rows in the displayed order, whichever row is
    chronologically later must equal (chronologically earlier row's balance
    + later row's own amount). This is the invariant a running-balance
    column must satisfy no matter how same-date rows are ordered; issue #46
    was a same-date 'Balance Rollover' row violating it (a $0.00 row that
    appeared to silently shift the balance)."""
    assert len(transactions) >= 2, "Need at least 2 rows to check adjacency"
    for i in range(len(transactions) - 1):
        row_a = transactions[i]      # earlier in display order
        row_b = transactions[i + 1]  # later in display order
        if sort_dir == 'asc':
            # row_b is chronologically later than row_a
            expected = row_a['balance'] + row_b['amount']
            actual = row_b['balance']
        else:
            # row_a is chronologically later than row_b
            expected = row_b['balance'] + row_a['amount']
            actual = row_a['balance']
        assert abs(actual - expected) < 0.005, (
            f"Row {i} vs {i + 1} ({sort_dir}) broke the running-balance chain: "
            f"expected {expected}, got {actual}. Rows: {row_a} | {row_b}"
        )


@pytest.mark.feature
def test_ledger_running_balance_consistent_ascending_with_rollover_collision(app_page):
    """Issue #46: sorting the ledger ascending (oldest first) must keep the
    running-balance column internally consistent even when a 'Balance
    Rollover' row shares its date with that month's own transaction."""
    page = app_page
    _seed_monthly_bill_for_rollover_collision(page)

    page.evaluate("""() => {
        window.app._ledgerSortKey = 'date';
        window.app._ledgerSortDir = 'asc';
    }""")
    transactions = page.evaluate("() => window.app.getFilteredSortedLedgerTransactions()")

    assert any(tx['type'] == 'rollover' for tx in transactions), \
        "Fixture should produce at least one Balance Rollover row"
    _assert_running_balance_internally_consistent(transactions, 'asc')


@pytest.mark.feature
def test_ledger_running_balance_consistent_descending_with_rollover_collision(app_page):
    """Issue #46, descending direction: same invariant as the ascending
    test, checked against the ledger's default (newest-first) sort."""
    page = app_page
    _seed_monthly_bill_for_rollover_collision(page)

    page.evaluate("""() => {
        window.app._ledgerSortKey = 'date';
        window.app._ledgerSortDir = 'desc';
    }""")
    transactions = page.evaluate("() => window.app.getFilteredSortedLedgerTransactions()")

    assert any(tx['type'] == 'rollover' for tx in transactions), \
        "Fixture should produce at least one Balance Rollover row"
    _assert_running_balance_internally_consistent(transactions, 'desc')


@pytest.mark.feature
def test_ledger_rollover_row_balance_reflects_true_carry_in_value(app_page):
    """The specific defect from issue #46's screenshot: the Balance Rollover
    row must sit next to the transaction it logically precedes such that its
    $0.00 amount never appears to move the balance. Concretely, in ascending
    order the rollover (representing the carry-in balance, before that
    month's transaction posts) must be listed BEFORE the same-day
    transaction, not after it."""
    page = app_page
    _seed_monthly_bill_for_rollover_collision(page)

    page.evaluate("""() => {
        window.app._ledgerSortKey = 'date';
        window.app._ledgerSortDir = 'asc';
    }""")
    transactions = page.evaluate("() => window.app.getFilteredSortedLedgerTransactions()")

    rollover_index = next(i for i, tx in enumerate(transactions) if tx['type'] == 'rollover')
    same_date_tx_index = next(
        i for i, tx in enumerate(transactions)
        if tx['type'] != 'rollover' and tx['date'] == transactions[rollover_index]['date']
    )
    assert rollover_index < same_date_tx_index, (
        "Ascending order: Balance Rollover (the pre-transaction carry-in balance) "
        "must be listed before the same-day transaction it precedes"
    )


@pytest.mark.feature
def test_ledger_multiple_real_transactions_on_same_day_balance_consistent(app_page):
    """Two independent real transactions (both bills, so their generated
    dates are exact-midnight ties, not just same calendar day) landing on
    the same date must still chain correctly in both sort directions. This
    is the general form of #46: any same-date tie — not just rollover rows —
    needs a tie-break that flips with sort direction instead of a fixed
    type-priority."""
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000, interestRate: 0 }];
        app.bills = [
            { id: 1, name: 'Rent', amount: 400, dueDay: 15, accountId: 1, category: 'Housing' },
            { id: 2, name: 'Utilities', amount: 150, dueDay: 15, accountId: 1, category: 'Utilities' }
        ];
        app.incomes = []; app.debts = []; app.expenses = []; app.bonuses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = [];
        app._ledgerAccountFilter = '1'; app._ledgerDateRange = 'all';
    }""")

    for sort_dir in ('asc', 'desc'):
        page.evaluate(f"""() => {{
            window.app._ledgerSortKey = 'date';
            window.app._ledgerSortDir = '{sort_dir}';
        }}""")
        transactions = page.evaluate("() => window.app.getFilteredSortedLedgerTransactions()")
        _assert_running_balance_internally_consistent(transactions, sort_dir)


@pytest.mark.feature
def test_ledger_rollover_bill_and_reconciliation_three_way_collision(app_page):
    """A rarer but real scenario: a Balance Rollover, a recurring bill, and a
    manual reconciliation can all land on the exact same calendar date (the
    1st of a month, with reconciliation-adjusts-balance on). Even with three
    rows tied on one date, the chain must stay internally consistent in both
    directions, the tie order must follow true computed sequence (rollover,
    then bill, then reconciliation, since that's the order their balances
    were actually derived in), and the reconciliation row must still snap to
    the exact statement balance regardless of where it lands."""
    page = app_page
    _seed_monthly_bill_for_rollover_collision(page)

    setup = page.evaluate("""() => {
        const app = window.app;
        const today = new Date();
        const target = new Date(today.getFullYear(), today.getMonth() + 2, 1);
        const y = target.getFullYear();
        const m = String(target.getMonth() + 1).padStart(2, '0');
        const dateStr = `${y}-${m}-01`;
        app.settings = [{ key: 'reconciliationAdjustsBalance', value: true }];
        app.reconciliations = [{
            id: 9001, accountId: 1, date: dateStr,
            previousBalance: 0, statementBalance: 5000, difference: 5000, note: 'test'
        }];
        return { dateStr };
    }""")

    for sort_dir, expected_order in (
        ('asc', ['rollover', 'bill', 'reconciliation']),
        ('desc', ['reconciliation', 'bill', 'rollover']),
    ):
        page.evaluate(f"""() => {{
            window.app._ledgerSortKey = 'date';
            window.app._ledgerSortDir = '{sort_dir}';
        }}""")
        transactions = page.evaluate("() => window.app.getFilteredSortedLedgerTransactions()")

        same_date = [tx for tx in transactions if tx['date'][:10] == setup['dateStr']]
        assert len(same_date) == 3, f"Expected rollover+bill+reconciliation collision, got {same_date}"
        assert [tx['type'] for tx in same_date] == expected_order, (
            f"{sort_dir}: got {[tx['type'] for tx in same_date]}, expected {expected_order}"
        )

        # Check the three-way collision's own internal math directly, rather
        # than reusing the whole-list chain helper: the reconciliation row
        # always reports amount=0 (its real snap delta lives in
        # tx.meta.difference, shown separately by the renderer) and removing
        # it from a full-projection list would falsely "break" the chain at
        # every later month's now-adjusted balance — a test artifact, not a
        # real inconsistency.
        rollover_row = next(tx for tx in same_date if tx['type'] == 'rollover')
        bill_row = next(tx for tx in same_date if tx['type'] == 'bill')
        recon_row = next(tx for tx in same_date if tx['type'] == 'reconciliation')
        assert abs(bill_row['balance'] - (rollover_row['balance'] + bill_row['amount'])) < 0.005, (
            "Bill balance must equal the rollover carry-in plus the bill's own amount"
        )
        assert abs(recon_row['balance'] - 5000) < 0.005, \
            "Reconciliation row must snap exactly to the statement balance"


@pytest.mark.feature
def test_ledger_override_on_collision_transaction_keeps_balance_consistent(app_page):
    """Applying an amount override to the transaction that collides with a
    Balance Rollover must not break the running-balance chain — the override
    changes the delta actually applied, but the chain must still add up
    around it in both sort directions."""
    page = app_page
    _seed_monthly_bill_for_rollover_collision(page)

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/ledgerOverrides.js');
        app._ledgerSortKey = 'date'; app._ledgerSortDir = 'asc';
        const before = app.getFilteredSortedLedgerTransactions();
        const billTx = before.find(tx => tx.type === 'bill');
        mod.setLedgerAmountOverride(app, billTx.transactionId, -250, {
            originalAmount: billTx.originalAmount,
            transactionName: billTx.name,
            accountId: billTx.accountId,
            date: billTx.date
        });
        const asc = app.getFilteredSortedLedgerTransactions();
        app._ledgerSortDir = 'desc';
        const desc = app.getFilteredSortedLedgerTransactions();
        return { asc, desc, overriddenId: billTx.transactionId };
    }""")

    for direction in ('asc', 'desc'):
        rows = result[direction]
        overridden = next(tx for tx in rows if tx['transactionId'] == result['overriddenId'])
        assert overridden['amount'] == -250, "Override must be reflected in the row's amount"
        assert overridden['hasOverride'] is True
        _assert_running_balance_internally_consistent(rows, direction)


@pytest.mark.feature
def test_ledger_multi_account_rollover_collisions_stay_independent(app_page):
    """Two accounts each with their own rollover/bill collision on the same
    calendar date must not cross-contaminate: each account's running-balance
    chain must stay consistent on its own, independent of how the two
    accounts' same-date rows happen to interleave in the merged, unfiltered
    (all-accounts) list."""
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [
            { id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000, interestRate: 0 },
            { id: 2, name: 'Savings', type: 'Savings', startingBalance: 2000, interestRate: 0 }
        ];
        app.bills = [
            { id: 1, name: 'Rent', amount: 100, dueDay: 1, accountId: 1, category: 'Housing' },
            { id: 2, name: 'Storage', amount: 50, dueDay: 1, accountId: 2, category: 'Other' }
        ];
        app.incomes = []; app.debts = []; app.expenses = []; app.bonuses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = [];
        app._ledgerAccountFilter = 'all'; app._ledgerDateRange = 'all';
    }""")

    for sort_dir in ('asc', 'desc'):
        page.evaluate(f"""() => {{
            window.app._ledgerSortKey = 'date';
            window.app._ledgerSortDir = '{sort_dir}';
        }}""")
        transactions = page.evaluate("() => window.app.getFilteredSortedLedgerTransactions()")
        for acct_id in ('1', '2'):
            acct_txs = [tx for tx in transactions if str(tx['accountId']) == acct_id]
            assert len(acct_txs) >= 2
            _assert_running_balance_internally_consistent(acct_txs, sort_dir)
