#!/usr/bin/env python3
"""
Merge-mode import dedupe (issues #567 and #478).

Merging the app's own fresh export must create zero new records in any
collection (before: expenses, emergency funds, transfers and retirement
snapshots doubled), the result message lists skipped counts, a file that
repeats a record collapses to one, and a record differing in a key field is
still imported.
"""

import json

import pytest

from tests.conftest import seed_state, wait_for_api

pytestmark = pytest.mark.feature

COLLECTIONS = {
    'accounts': '/api/accounts',
    'debts': '/api/debts',
    'expenses': '/api/expenses',
    'emergencyFunds': '/api/emergency-funds',
    'sinkingFunds': '/api/sinking-funds',
    'transfers': '/api/transfers',
    'retirementSnapshots': '/api/retirement-snapshots',
    'reconciliations': '/api/reconciliations',
    'planHistory': '/api/plan-history',
    'manualTransactions': '/api/manual-transactions',
    'recurringTemplates': '/api/recurring-templates',
    'incomes': '/api/incomes',
}

STATE = {
    'accounts': [
        {'id': 10, 'name': 'MD Checking', 'type': 'Checking', 'startingBalance': 500},
        {'id': 11, 'name': 'MD Savings', 'type': 'Savings', 'startingBalance': 900},
        {'id': 12, 'name': 'MD Retirement', 'type': 'Retirement', 'startingBalance': 100, 'retirementSubtype': '401k'},
    ],
    'debts': [{'id': 20, 'name': 'MD Card', 'debtType': 'creditCard', 'accountBalance': 800, 'interestRate': 19,
               'minimumPayment': 40, 'dueDate': 5, 'accountId': 10}],
    'incomes': [{'id': 30, 'name': 'MD Pay', 'amount': 2000, 'firstPayDate': '2026-11-01', 'frequency': 'monthly',
                 'accountId': 10}],
    'expenses': [
        {'id': 31, 'name': 'MD Food', 'budgetAmount': 300, 'date': '2026-11-05', 'category': 'Food', 'accountId': 10},
        {'id': 32, 'name': 'MD Gas', 'budgetAmount': 80, 'date': '2026-11-06', 'category': 'Transport', 'accountId': 10},
    ],
    'recurringTemplates': [{'id': 40, 'name': 'MD Netflix', 'type': 'subscription', 'amount': 16,
                            'frequency': 'monthly', 'dayOfMonth': 3, 'accountId': 10, 'startDate': '2026-01-01'}],
    'emergencyFunds': [{'id': 50, 'accountId': 11, 'targetAmount': 5000, 'currentAmount': 900, 'monthlyContribution': 100}],
    'sinkingFunds': [{'id': 51, 'name': 'MD Car', 'monthlyAllocation': 50, 'targetAmount': 1000, 'accountId': 11}],
    'transfers': [{'id': 60, 'fromAccountId': 10, 'toAccountId': 11, 'amount': 25, 'date': '2026-11-02'}],
    'retirementSnapshots': [
        {'id': 70, 'accountId': 12, 'date': '2026-09-01', 'balance': 100, 'contribution': 10},
        {'id': 71, 'accountId': 12, 'date': '2026-10-01', 'balance': 120, 'contribution': 10},
    ],
    'reconciliations': [{'id': 80, 'accountId': 10, 'date': '2026-10-31', 'statementStartDate': '2026-10-01',
                         'statementEndDate': '2026-10-31', 'previousBalance': 400, 'statementBalance': 500,
                         'difference': 0, 'createdAt': '2026-11-01T12:00:00.000Z'}],
    'planHistory': [{'id': 90, 'monthlyPayment': 300, 'strategy': 'avalanche', 'totalInterest': 100,
                     'monthsToPayOff': 10, 'payoffDate': '2027-09-01', 'totalDebt': 800,
                     'createdAt': '2026-11-02T08:30:15.123Z'}],
    'manualTransactions': [{'id': 95, 'accountId': 10, 'date': '2026-11-04', 'amount': -12.5, 'name': 'MD Coffee',
                            'category': 'Food', 'createdAt': '2026-11-04T09:00:00.000Z'}],
}

# Capture the blob exportAllJSON() hands to the download link, return its text.
_EXPORT_JS = """async () => {
    const { exportAllJSON } = await import('/src/dataExport.js');
    let blob = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = b => { blob = b; return orig.call(URL, b); };
    try { exportAllJSON(window.app); } finally { URL.createObjectURL = orig; }
    return await blob.text();
}"""

# Run the real importAllJSON in merge mode and capture which callback fired.
_MERGE_JS = """(json) => new Promise((resolve) => {
    const app = window.app;
    const file = new File([new Blob([json], { type: 'application/json' })], 'b.json', { type: 'application/json' });
    import('/src/dataExport.js').then(({ importAllJSON }) => {
        importAllJSON(app, file, {
            requestImportMode: async () => false,
            onNoData: () => resolve({ kind: 'no-data' }),
            onInvalidJSON: () => resolve({ kind: 'invalid' }),
            onImportError: () => resolve({ kind: 'error' }),
            onMergeDuplicates: (skipped) => resolve({ kind: 'skipped', skipped }),
            onImported: (parts) => resolve({ kind: 'imported', parts }),
        });
    });
})"""

_COUNTS_JS = """(fields) => Object.fromEntries(fields.map(f => [f, (window.app[f] || []).length]))"""


def _merge(page, payload):
    return page.evaluate(_MERGE_JS, json.dumps(payload))


def _counts(page):
    return page.evaluate(_COUNTS_JS, list(COLLECTIONS))


def _server_counts(page):
    out = {}
    for field, path in COLLECTIONS.items():
        out[field] = len(wait_for_api(page, path, lambda d: isinstance(d, list)))
    return out


def test_merge_of_own_fresh_export_creates_nothing(app_page):
    page = app_page
    seed_state(page, STATE)
    before = _counts(page)
    assert before['expenses'] == 2 and before['transfers'] == 1 and before['retirementSnapshots'] == 2
    server_before = _server_counts(page)
    assert server_before == before

    exported = page.evaluate(_EXPORT_JS)
    result = _merge(page, json.loads(exported))

    assert result['kind'] == 'skipped', result
    skipped = result['skipped']
    for field in ('accounts', 'debts', 'expenses', 'emergencyFunds', 'sinkingFunds', 'transfers',
                  'retirementSnapshots', 'reconciliations', 'planHistory', 'manualTransactions',
                  'recurringTemplates', 'incomes'):
        assert skipped.get(field) == before[field], (field, skipped)

    assert _counts(page) == before
    assert _server_counts(page) == before

    # A reload proves what the server holds, not just app state.
    page.reload()
    page.wait_for_function('() => !!window.app && window.app.expenses.length > 0')
    assert _counts(page) == before


def test_merge_message_lists_skipped_counts_per_type(app_page):
    page = app_page
    seed_state(page, STATE)
    payload = json.loads(page.evaluate(_EXPORT_JS))
    result = _merge(page, payload)
    assert result['kind'] == 'skipped'
    text = page.evaluate("""(skipped) => import('/src/i18n.js').then(({ t }) =>
        Object.entries(skipped).map(([f, c]) => t('import.mergeSkippedItem', { label: t('import.skippedType.' + f), count: c })).join(', '))""",
                         result['skipped'])
    assert 'Expense budgets: 2' in text
    assert 'Transfers: 1' in text
    assert 'Retirement snapshots: 2' in text


def test_same_debt_twice_in_one_file_creates_one_debt(app_page):
    """#478: the same debt twice in a file is created once, the other skipped."""
    page = app_page
    seed_state(page, {})
    debt = {'name': 'Twice Card', 'debtType': 'creditCard', 'accountBalance': 500, 'interestRate': 20,
            'minimumPayment': 25, 'dueDate': 7}
    result = _merge(page, {'debts': [dict(debt, id=1), dict(debt, id=2, name='twice card')]})
    assert result == {'kind': 'skipped', 'skipped': {'debts': 1}}, result
    assert page.evaluate("() => window.app.debts.length") == 1
    assert len(wait_for_api(page, '/api/debts', lambda d: len(d) >= 1)) == 1


def test_same_account_twice_in_one_file_creates_one_account(app_page):
    page = app_page
    seed_state(page, {})
    acct = {'name': 'Dup Acct', 'type': 'Checking', 'startingBalance': 5}
    exp = {'name': 'Dup Exp', 'budgetAmount': 10, 'date': '2026-11-01', 'category': 'Food'}
    result = _merge(page, {'accounts': [dict(acct, id=1), dict(acct, id=2)],
                           'expenses': [dict(exp, id=3, accountId=1), dict(exp, id=4, accountId=2)]})
    assert result['kind'] == 'skipped'
    assert result['skipped'] == {'accounts': 1, 'expenses': 1}, result
    state = page.evaluate("() => ({ a: window.app.accounts.map(a => a.id), e: window.app.expenses.map(e => e.accountId) })")
    assert len(state['a']) == 1 and state['e'] == state['a']


def test_record_differing_by_date_or_amount_is_still_imported(app_page):
    page = app_page
    seed_state(page, STATE)
    before = _counts(page)
    payload = json.loads(page.evaluate(_EXPORT_JS))
    t = payload['transfers'][0]
    payload['transfers'] = [
        t,                                    # unchanged: skipped
        dict(t, id=61, date='2026-11-09'),    # other date: imported
        dict(t, id=62, amount=26),            # other amount: imported
    ]
    payload['expenses'] = [dict(payload['expenses'][0], id=33, date='2026-12-05')]  # other date: imported
    payload['manualTransactions'] = [dict(payload['manualTransactions'][0], id=96, amount=-13)]
    result = _merge(page, payload)
    assert result['kind'] == 'skipped', result
    after = _counts(page)
    assert after['transfers'] == before['transfers'] + 2
    assert after['expenses'] == before['expenses'] + 1
    assert after['manualTransactions'] == before['manualTransactions'] + 1
    assert len(wait_for_api(page, '/api/transfers', lambda d: len(d) == 3)) == 3


def test_ledger_keys_attach_to_the_existing_record_after_dedupe(app_page):
    """#520 still holds: a file with different ids and Ledger keys for records
    that dedupe onto existing ones remaps the keys onto the existing ids."""
    page = app_page
    seed_state(page, STATE)
    ids = page.evaluate("""() => ({
        acct: window.app.accounts.find(a => a.name === 'MD Checking').id,
        exp: window.app.expenses.find(a => a.name === 'MD Food').id,
    })""")
    key = f"expense|{ids['exp']}|{ids['acct']}|2026-11-05"
    before_keys = page.evaluate("() => Object.keys(window.app.ledgerClearedTransactions)")
    assert key not in before_keys
    payload = {
        'accounts': [{'id': 900, 'name': 'md checking', 'type': 'Checking', 'startingBalance': 500}],
        'expenses': [{'id': 901, 'name': 'MD Food', 'budgetAmount': 300, 'date': '2026-11-05',
                      'category': 'Food', 'accountId': 900}],
        'ledgerClearedTransactions': {'expense|901|900|2026-11-05': {'clearedAt': '2026-11-05T00:00:00.000Z'}},
    }
    before = _counts(page)
    result = _merge(page, payload)
    assert result['kind'] == 'skipped'
    assert result['skipped'] == {'accounts': 1, 'expenses': 1}, result
    assert _counts(page) == before
    wait_for_api(page, '/api/ledger-cleared', lambda d: any(r.get('clearedKey') == key for r in d))
    keys = page.evaluate("() => Object.keys(window.app.ledgerClearedTransactions)")
    assert key in keys
    assert not any('901' in k or '900' in k for k in keys), keys
