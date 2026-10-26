#!/usr/bin/env python3
"""
Account Transfer Tracking Tests (issue #248)
Tests sanitizeTransfer, the two-leg ledger generation, computeAccountBalance
interaction, storage save/load round-trip, and export/import.
"""

import pytest


def _seed_two_accounts(page):
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [
            { id: 9001, name: 'Transfer Checking', type: 'Checking', startingBalance: 1000 },
            { id: 9002, name: 'Transfer Savings', type: 'Savings', startingBalance: 500 }
        ];
        app.incomes = []; app.bonuses = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = []; app.transfers = [];
    }""")


@pytest.mark.feature
def test_add_transfer_creates_record(app_page):
    """app.addTransfer() creates a transfer record in app.transfers."""
    page = app_page
    _seed_two_accounts(page)

    result = page.evaluate("""async () => {
        const app = window.app;
        const res = await app.addTransfer(9001, 9002, 250, '2026-06-10', 'Move to savings');
        return { success: res.success, count: app.transfers.length, entry: app.transfers[0] };
    }""")

    assert result['success'] is True
    assert result['count'] == 1
    entry = result['entry']
    assert entry['fromAccountId'] == 9001
    assert entry['toAccountId'] == 9002
    assert entry['amount'] == 250
    assert entry['memo'] == 'Move to savings'


@pytest.mark.feature
def test_add_transfer_rejects_same_account(app_page):
    """addTransfer refuses a transfer where fromAccountId === toAccountId."""
    page = app_page
    _seed_two_accounts(page)

    page.evaluate("""() => {
        window._transferTestPromise = window.app.addTransfer(9001, 9001, 100, '2026-06-10', '');
    }""")
    page.locator('#alertModalOkBtn').click()
    result = page.evaluate("""async () => {
        const res = await window._transferTestPromise;
        return { success: res.success, count: window.app.transfers.length };
    }""")

    assert result['success'] is False
    assert result['count'] == 0


@pytest.mark.feature
def test_add_transfer_rejects_non_positive_amount(app_page):
    """addTransfer refuses a zero/negative amount."""
    page = app_page
    _seed_two_accounts(page)

    page.evaluate("""() => {
        window._transferTestPromise = window.app.addTransfer(9001, 9002, 0, '2026-06-10', '');
    }""")
    page.locator('#alertModalOkBtn').click()
    result = page.evaluate("""async () => {
        const res = await window._transferTestPromise;
        return { success: res.success, count: window.app.transfers.length };
    }""")

    assert result['success'] is False
    assert result['count'] == 0


@pytest.mark.feature
def test_edit_transfer_updates_record(app_page):
    """app.editTransfer() mutates the existing record in place rather than
    creating a second one."""
    page = app_page
    _seed_two_accounts(page)

    result = page.evaluate("""async () => {
        const app = window.app;
        const added = await app.addTransfer(9001, 9002, 250, '2026-06-10', '');
        const id = app.transfers[0].id;
        const res = await app.editTransfer(id, { fromAccountId: 9001, toAccountId: 9002, amount: 400, date: '2026-06-11', memo: 'Updated' });
        return { success: res.success, count: app.transfers.length, entry: app.transfers[0] };
    }""")

    assert result['success'] is True
    assert result['count'] == 1, "Editing must not create a second record"
    assert result['entry']['amount'] == 400
    assert result['entry']['date'] == '2026-06-11'
    assert result['entry']['memo'] == 'Updated'


@pytest.mark.feature
def test_delete_transfer_removes_record(app_page):
    """app.deleteTransfer() removes the record after confirmation."""
    page = app_page
    _seed_two_accounts(page)

    page.evaluate("""async () => {
        const app = window.app;
        await app.addTransfer(9001, 9002, 250, '2026-06-10', '');
        window._deleteTransferPromise = app.deleteTransfer(app.transfers[0].id);
    }""")
    page.locator('#deleteConfirmBtn').click()
    result = page.evaluate("""async () => {
        await window._deleteTransferPromise;
        return { count: window.app.transfers.length };
    }""")

    assert result['count'] == 0


@pytest.mark.feature
def test_transfer_generates_two_opposite_signed_ledger_legs(app_page):
    """buildProjectedAccountTransactions generates a negative leg on the
    source account and a positive leg on the destination account, both
    dated the transfer's date, summing to zero."""
    page = app_page
    _seed_two_accounts(page)

    result = page.evaluate("""async () => {
        const app = window.app;
        await app.addTransfer(9001, 9002, 250, '2026-06-10', '');
        const mod = await import('/src/ledgerTransactions.js');
        const fromTxs = mod.getLedgerTransactionsForMonth(app, 2026, 5, 9001).filter(t => t.type === 'transfer');
        const toTxs = mod.getLedgerTransactionsForMonth(app, 2026, 5, 9002).filter(t => t.type === 'transfer');
        return {
            fromAmount: fromTxs[0]?.amount, fromName: fromTxs[0]?.name,
            toAmount: toTxs[0]?.amount, toName: toTxs[0]?.name,
            fromCount: fromTxs.length, toCount: toTxs.length
        };
    }""")

    assert result['fromCount'] == 1
    assert result['toCount'] == 1
    assert result['fromAmount'] == -250
    assert result['toAmount'] == 250
    assert 'Transfer Savings' in result['fromName']
    assert 'Transfer Checking' in result['toName']


@pytest.mark.feature
def test_compute_account_balance_reflects_transfer_on_both_accounts(app_page):
    """computeAccountBalance() needs no transfer-specific code -- it already
    sums whatever the ledger generator produces per account."""
    page = app_page
    _seed_two_accounts(page)

    result = page.evaluate("""async () => {
        const app = window.app;
        await app.addTransfer(9001, 9002, 250, '2026-06-10', '');
        return {
            fromBalance: app.computeAccountBalance(9001, 2026, 5),
            toBalance: app.computeAccountBalance(9002, 2026, 5)
        };
    }""")

    assert result['fromBalance'] == 1000 - 250
    assert result['toBalance'] == 500 + 250


@pytest.mark.feature
def test_transfer_with_deleted_account_does_not_throw(app_page):
    """A transfer whose account was deleted after creation renders/generates
    without throwing (the generic UNLINKED_KEY fallback in addTx())."""
    page = app_page
    _seed_two_accounts(page)

    result = page.evaluate("""async () => {
        const app = window.app;
        await app.addTransfer(9001, 9002, 250, '2026-06-10', '');
        app.accounts = app.accounts.filter(a => a.id !== 9002);
        let threw = false;
        try {
            const mod = await import('/src/ledgerTransactions.js');
            mod.getLedgerTransactionsForMonth(app, 2026, 5, 9001);
        } catch (e) {
            threw = true;
        }
        return { threw };
    }""")

    assert result['threw'] is False


@pytest.mark.feature
def test_save_and_reload_from_storage_preserves_transfers(app_page):
    """Regression guard: app.transfers must actually round-trip through
    saveToStorage()/loadFromStorage(), not just through sanitizeParsedState
    in isolation -- _writeNow()'s serialized payload must include it."""
    page = app_page
    _seed_two_accounts(page)

    result = page.evaluate("""async () => {
        const app = window.app;
        await app.addTransfer(9001, 9002, 250, '2026-06-10', 'Round trip check');
        await app.saveToStorage();
        app.transfers = [];
        app.loadFromStorage();
        return { count: app.transfers.length, entry: app.transfers[0] };
    }""")

    assert result['count'] == 1, "app.transfers did not survive a save/reload round trip"
    assert result['entry']['memo'] == 'Round trip check'


@pytest.mark.feature
def test_sanitize_parsed_state_rejects_invalid_transfers(app_page):
    """sanitizeParsedState (via loadFromStorage) drops transfers with equal
    from/to accounts or a non-positive amount, keeping valid entries."""
    page = app_page

    result = page.evaluate("""() => {
        const app = window.app;
        const data = {
            accounts: [
                { id: 9101, name: 'A', type: 'Checking', startingBalance: 100 },
                { id: 9102, name: 'B', type: 'Savings', startingBalance: 100 }
            ],
            debts: [], incomes: [], bonuses: [], bills: [], expenses: [],
            recurringTemplates: [], emergencyFunds: [], sinkingFunds: [],
            transfers: [
                { id: 1, fromAccountId: 9101, toAccountId: 9101, amount: 100, date: '2026-06-01' },
                { id: 2, fromAccountId: 9101, toAccountId: 9102, amount: -50, date: '2026-06-01' },
                { id: 3, fromAccountId: 9101, toAccountId: 9999, amount: 50, date: '2026-06-01' },
                { id: 4, fromAccountId: 9101, toAccountId: 9102, amount: 75, date: '2026-06-01', memo: 'Valid' }
            ]
        };
        localStorage.setItem(app.storageKey, JSON.stringify(data));
        app.loadFromStorage();
        return { transfers: app.transfers };
    }""")

    transfers = result['transfers']
    assert len(transfers) == 1, f"Expected only the valid transfer to survive sanitization, got {transfers}"
    assert transfers[0]['memo'] == 'Valid'
    assert transfers[0]['amount'] == 75


@pytest.mark.feature
def test_export_import_round_trip_preserves_transfers(app_page):
    """importAllJSON preserves transfers, re-ids them, and keeps account FKs
    valid (accounts keep their ids in replace mode)."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/dataExport.js');
        app.accounts = [
            { id: 9201, name: 'Import Checking', type: 'Checking', startingBalance: 500 },
            { id: 9202, name: 'Import Savings', type: 'Savings', startingBalance: 0 }
        ];
        app.transfers = [];

        const payload = {
            accounts: app.accounts,
            debts: [], incomes: [], bonuses: [], bills: [], expenses: [],
            recurringTemplates: [], emergencyFunds: [], sinkingFunds: [],
            transfers: [{
                id: 999, fromAccountId: 9201, toAccountId: 9202, amount: 150,
                date: '2026-06-01', memo: 'Imported', createdAt: '2026-06-01T12:00:00.000Z'
            }]
        };
        const file = new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' });

        return new Promise(resolve => {
            mod.importAllJSON(app, file, {});
            setTimeout(() => resolve({ transfers: app.transfers }), 300);
        });
    }""")

    transfers = result['transfers']
    assert len(transfers) == 1
    assert transfers[0]['fromAccountId'] == 9201
    assert transfers[0]['toAccountId'] == 9202
    assert transfers[0]['amount'] == 150
    assert transfers[0]['id'] != 999, "Imported entries should be re-id'd to avoid collisions"


@pytest.mark.feature
def test_clear_all_data_resets_transfers(app_page):
    """clearAllData resets app.transfers."""
    page = app_page
    _seed_two_accounts(page)

    result = page.evaluate("""async () => {
        const app = window.app;
        await app.addTransfer(9001, 9002, 250, '2026-06-10', '');
        const mod = await import('/src/storage.js');
        mod.clearAllData(app, {});
        return { count: app.transfers.length };
    }""")

    assert result['count'] == 0
