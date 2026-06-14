#!/usr/bin/env python3
"""
Account Reconciliation Tests
Tests applyReconciliation, reconciliation history entries, the
expected-transactions lookup, and storage sanitization/round-trip for
app.reconciliations.
"""

import re
from datetime import date

import pytest


def _seed_reconciliation_account(page):
    """Create a single checking account with no other collections."""
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 7001, name: 'Recon Checking', type: 'Checking', startingBalance: 1000 }];
        app.incomes = []; app.bonuses = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = [];
        app._reconciliationAccountFilter = 'all';
    }""")


@pytest.mark.feature
def test_today_iso_format(app_page):
    """todayISO() returns today's date as YYYY-MM-DD."""
    page = app_page

    result = page.evaluate("""async () => {
        const mod = await import('/src/utils.js');
        return mod.todayISO();
    }""")

    assert re.match(r'^\d{4}-\d{2}-\d{2}$', result), f"Expected YYYY-MM-DD format, got {result}"
    assert result == date.today().isoformat()


@pytest.mark.feature
def test_apply_reconciliation_updates_balance_and_history(app_page):
    """applyReconciliation updates account.startingBalance and records a history entry."""
    page = app_page
    _seed_reconciliation_account(page)

    result = page.evaluate("""() => {
        const app = window.app;
        const res = app.applyReconciliation(7001, 1250.50, 'Found extra deposit', '2026-06-10');
        return {
            success: res.success,
            balance: app.accounts[0].startingBalance,
            historyCount: app.reconciliations.length,
            entry: app.reconciliations[0]
        };
    }""")

    assert result['success'] is True
    assert result['balance'] == 1250.50
    assert result['historyCount'] == 1
    entry = result['entry']
    assert entry['accountId'] == 7001
    assert entry['previousBalance'] == 1000
    assert entry['statementBalance'] == 1250.50
    assert entry['difference'] == 250.50
    assert entry['date'] == '2026-06-10'
    assert entry['note'] == 'Found extra deposit'


@pytest.mark.feature
def test_apply_reconciliation_records_zero_difference(app_page):
    """Reconciling to the same balance still records a history entry with difference 0."""
    page = app_page
    _seed_reconciliation_account(page)

    result = page.evaluate("""() => {
        const app = window.app;
        const res = app.applyReconciliation(7001, 1000, '', '2026-06-10');
        return {
            success: res.success,
            historyCount: app.reconciliations.length,
            difference: app.reconciliations[0].difference
        };
    }""")

    assert result['success'] is True
    assert result['historyCount'] == 1
    assert result['difference'] == 0


@pytest.mark.feature
def test_apply_reconciliation_invalid_date_falls_back_to_today(app_page):
    """An invalid statement date falls back to today's date on the recorded entry."""
    page = app_page
    _seed_reconciliation_account(page)

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/utils.js');
        app.applyReconciliation(7001, 1100, '', 'not-a-date');
        return { entryDate: app.reconciliations[0].date, today: mod.todayISO() };
    }""")

    assert result['entryDate'] == result['today']


@pytest.mark.feature
def test_apply_reconciliation_rejects_invalid_balance(app_page):
    """A non-numeric statement balance is rejected; balance and history are unchanged."""
    page = app_page
    _seed_reconciliation_account(page)

    result = page.evaluate("""() => {
        const app = window.app;
        const res = app.applyReconciliation(7001, 'not-a-number', '', '2026-06-10');
        return {
            success: res.success,
            balance: app.accounts[0].startingBalance,
            historyCount: app.reconciliations.length
        };
    }""")

    assert result['success'] is False
    assert result['balance'] == 1000
    assert result['historyCount'] == 0


@pytest.mark.feature
def test_delete_reconciliation_entry_does_not_alter_balance(app_page):
    """Deleting a history entry removes it without reverting startingBalance."""
    page = app_page
    _seed_reconciliation_account(page)

    result = page.evaluate("""() => {
        const app = window.app;
        app.applyReconciliation(7001, 1200, '', '2026-06-10');
        const entryId = app.reconciliations[0].id;
        app.deleteReconciliationEntry(entryId);
        return { balance: app.accounts[0].startingBalance, historyCount: app.reconciliations.length };
    }""")

    assert result['balance'] == 1200
    assert result['historyCount'] == 0


@pytest.mark.feature
def test_expected_transactions_across_month_boundary(app_page):
    """getExpectedTransactionsInRange returns transactions spanning a month boundary, sorted by date."""
    page = app_page

    result = page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 7002, name: 'Recon Bills', type: 'Checking', startingBalance: 2000 }];
        app.bills = [
            { id: 70, name: 'Rent', dueDay: 28, amount: 1000, category: 'Housing', accountId: 7002 },
            { id: 71, name: 'Phone', dueDay: 2, amount: 50, category: 'Utilities', accountId: 7002 }
        ];
        app.incomes = []; app.bonuses = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = [];

        const results = app.getExpectedTransactionsInRange(7002, '2026-01-28', '2026-02-02');
        return results.map(tx => ({ name: tx.name, date: tx.date.slice(0, 10) }));
    }""")

    assert len(result) == 2, f"Expected 2 transactions spanning the month boundary, got {result}"
    assert result[0]['name'] == 'Rent' and result[0]['date'] == '2026-01-28'
    assert result[1]['name'] == 'Phone' and result[1]['date'] == '2026-02-02'


@pytest.mark.feature
def test_sanitize_reconciliation_rejects_invalid_entries(app_page):
    """sanitizeReconciliation (via loadFromStorage) drops entries with missing
    accountId or non-finite statementBalance, keeping valid entries."""
    page = app_page

    result = page.evaluate("""() => {
        const app = window.app;
        const data = {
            accounts: [{ id: 7201, name: 'Recon Sanitize', type: 'Checking', startingBalance: 100 }],
            debts: [], incomes: [], bonuses: [], bills: [], expenses: [],
            recurringTemplates: [], emergencyFunds: [], sinkingFunds: [],
            reconciliations: [
                { id: 1, accountId: null, date: '2026-06-01', previousBalance: 0, statementBalance: 100, difference: 100, note: '' },
                { id: 2, accountId: 7201, date: '2026-06-01', previousBalance: 0, statementBalance: 'not-a-number', difference: 0, note: '' },
                { id: 3, accountId: 7201, date: '2026-06-01', previousBalance: 50, statementBalance: 150, difference: 100, note: 'Valid' }
            ]
        };
        localStorage.setItem(app.storageKey, JSON.stringify(data));
        app.loadFromStorage();
        return { reconciliations: app.reconciliations };
    }""")

    recs = result['reconciliations']
    assert len(recs) == 1, f"Expected only the valid entry to survive sanitization, got {recs}"
    assert recs[0]['note'] == 'Valid'
    assert recs[0]['accountId'] == 7201
    assert recs[0]['statementBalance'] == 150


@pytest.mark.feature
def test_export_import_round_trip_preserves_reconciliations(app_page):
    """importAllJSON preserves reconciliations and re-ids them to avoid collisions."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/storage.js');
        app.accounts = [{ id: 7101, name: 'Recon Import', type: 'Checking', startingBalance: 500 }];
        app.reconciliations = [];

        const payload = {
            accounts: app.accounts,
            debts: [{ id: 1, name: 'Dummy Debt', debtType: 'creditCard', accountBalance: 100, interestRate: 5, minimumPayment: 10, dueDate: 1 }],
            incomes: [], bonuses: [], bills: [], expenses: [],
            recurringTemplates: [], emergencyFunds: [], sinkingFunds: [],
            reconciliations: [{
                id: 999, accountId: 7101, date: '2026-06-01',
                previousBalance: 400, statementBalance: 500, difference: 100,
                note: 'Imported entry', createdAt: '2026-06-01T12:00:00.000Z'
            }]
        };
        const file = new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' });

        return new Promise(resolve => {
            mod.importAllJSON(app, file, {});
            setTimeout(() => resolve({ reconciliations: app.reconciliations }), 300);
        });
    }""")

    recs = result['reconciliations']
    assert len(recs) == 1
    assert recs[0]['accountId'] == 7101
    assert recs[0]['statementBalance'] == 500
    assert recs[0]['note'] == 'Imported entry'
    assert recs[0]['id'] != 999, "Imported entries should be re-id'd to avoid collisions"


@pytest.mark.feature
def test_clear_all_data_resets_reconciliations(app_page):
    """clearAllData resets app.reconciliations and the account filter."""
    page = app_page
    _seed_reconciliation_account(page)

    result = page.evaluate("""async () => {
        const app = window.app;
        app.applyReconciliation(7001, 1200, '', '2026-06-10');
        app._reconciliationAccountFilter = '7001';
        const mod = await import('/src/storage.js');
        mod.clearAllData(app, {});
        return { historyCount: app.reconciliations.length, filter: app._reconciliationAccountFilter };
    }""")

    assert result['historyCount'] == 0
    assert result['filter'] == 'all'


@pytest.mark.feature
def test_orphaned_reconciliation_entry_renders_without_throwing(app_page):
    """A reconciliation entry whose account was deleted renders with an
    'Unknown account' label instead of throwing."""
    page = app_page

    result = page.evaluate("""() => {
        const app = window.app;
        app.accounts = [
            { id: 7301, name: 'Recon Deleted', type: 'Checking', startingBalance: 1000 },
            { id: 7302, name: 'Recon Remaining', type: 'Savings', startingBalance: 500 }
        ];
        app.incomes = []; app.bonuses = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = [];
        app._reconciliationAccountFilter = 'all';
        app.applyReconciliation(7301, 1100, 'Orphan test', '2026-06-10');

        // Delete the reconciled account, leaving its history entry orphaned
        app.accounts = app.accounts.filter(a => a.id !== 7301);

        let threw = false;
        try {
            app.renderReconciliationPage();
        } catch (e) {
            threw = true;
        }
        return { threw, html: document.getElementById('reconcileSection').innerHTML };
    }""")

    assert result['threw'] is False, "Rendering with an orphaned reconciliation entry should not throw"
    assert 'Unknown account' in result['html']
