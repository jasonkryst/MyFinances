"""Issue #579: the server's monthly net-worth snapshot job and the app compute
the same snapshot.

The server job runs the shared pure core (src/netWorthCore.js) over the raw GET
bodies of the API routes (server/src/jobs/loadUserState.js; server/test/jobs.test.js
proves that object equals what the routes return and that the stored row equals
the core's output). This test closes the loop in a real browser: the core run
on the app's own loaded state (what captureNetWorthSnapshot stores) equals the
core run on the raw GET bodies (what the server job sees), for a dataset that
touches every source the snapshot reads.
"""
from datetime import date

import pytest

from tests.conftest import seed_state


def _month_day(day):
    today = date.today()
    return f'{today.year}-{today.month:02d}-{day:02d}'


def _dataset():
    return {
        'accounts': [
            {'id': 1, 'name': 'Checking', 'type': 'Checking', 'startingBalance': 1500, 'interestRate': 0},
            {'id': 2, 'name': 'Savings', 'type': 'Savings', 'startingBalance': 5000, 'interestRate': 4.2},
            {'id': 3, 'name': 'Overdrawn', 'type': 'Checking', 'startingBalance': -250, 'interestRate': 0},
        ],
        'incomes': [
            {'id': 10, 'name': 'Salary', 'amount': 2400, 'frequency': 'monthly', 'firstPayDate': '2025-01-05',
             'accountId': 1, 'withholdingPercent': 20},
        ],
        'bonuses': [{'id': 11, 'name': 'Award', 'amount': 600, 'date': _month_day(20), 'accountId': 1}],
        'debts': [
            {'id': 20, 'name': 'Visa', 'category': 'Credit Card', 'debtType': 'creditCard', 'accountBalance': 3200.55,
             'minimumPayment': 95, 'interestRate': 21.9, 'dueDate': 14, 'accountId': 1},
            {'id': 21, 'name': 'Loan', 'category': 'Other', 'debtType': 'fixedAmount', 'fixedAmount': 800,
             'minimumPayment': 100, 'dueDate': 3, 'accountId': 1},
        ],
        'recurringTemplates': [
            {'id': 30, 'name': 'Streaming', 'type': 'subscription', 'amount': 17.99, 'frequency': 'monthly',
             'dayOfMonth': 8, 'category': 'Entertainment', 'accountId': 1},
            {'id': 31, 'name': 'Side gig', 'type': 'income', 'amount': 300, 'frequency': 'monthly',
             'dayOfMonth': 21, 'accountId': 1},
            {'id': 32, 'name': 'Sweep', 'type': 'transfer', 'amount': 200, 'frequency': 'monthly',
             'dayOfMonth': 1, 'accountId': 1, 'targetAccountId': 2},
        ],
        'transfers': [{'id': 40, 'fromAccountId': 2, 'toAccountId': 1, 'amount': 125, 'date': _month_day(10)}],
        'manualTransactions': [
            {'id': 50, 'accountId': 1, 'date': _month_day(4), 'amount': -42.5, 'name': 'Groceries', 'category': 'Food'},
            {'id': 51, 'accountId': 1, 'date': _month_day(6), 'amount': 80, 'name': 'Refund', 'category': 'Other'},
        ],
        'emergencyFunds': [{'id': 60, 'accountId': 2, 'targetAmount': 10000, 'currentAmount': 5000,
                            'monthlyContribution': 150, 'autoContribute': True}],
        'ledgerAmountOverrides': {
            f'income|10|1|{_month_day(5)}': {'amount': 2000, 'originalAmount': 1920},
        },
        'settings': [{'key': 'autoNwSnapshot', 'value': False}],
    }


_PARITY_JS = """async () => {
    const core = await import('/src/netWorthCore.js');
    const endpoints = {
        persons: '/api/persons', debts: '/api/debts', accounts: '/api/accounts', incomes: '/api/incomes',
        bonuses: '/api/bonuses', bills: '/api/bills', expenses: '/api/expenses',
        recurringTemplates: '/api/recurring-templates', emergencyFunds: '/api/emergency-funds',
        sinkingFunds: '/api/sinking-funds', reconciliations: '/api/reconciliations',
        planHistory: '/api/plan-history', retirementSnapshots: '/api/retirement-snapshots',
        transfers: '/api/transfers', manualTransactions: '/api/manual-transactions',
        balanceHistory: '/api/balance-history',
    };
    const get = async path => (await fetch(path, { cache: 'no-store' })).json();
    const raw = {};
    for (const [field, path] of Object.entries(endpoints)) raw[field] = await get(path);
    raw.monthlySnapshots = await get('/api/net-worth-snapshots');
    raw.settings = await get('/api/settings');
    raw.ledgerAmountOverrides = Object.fromEntries((await get('/api/ledger-overrides')).map(o => [o.overrideKey, o]));
    raw.ledgerClearedTransactions = Object.fromEntries((await get('/api/ledger-cleared')).map(c => [c.clearedKey, c]));
    const now = new Date();
    return {
        app: core.buildNetWorthSnapshot(window.app, now, 'auto'),
        server: core.buildNetWorthSnapshot(raw, now, 'auto'),
        overrides: Object.keys(raw.ledgerAmountOverrides).length,
    };
}"""


@pytest.mark.feature
def test_app_and_server_inputs_give_the_same_snapshot(app_page):
    page = app_page
    seed_state(page, _dataset())
    page.wait_for_function('() => window.app.accounts.length === 3 && window.app.manualTransactions.length === 2')
    result = page.evaluate(_PARITY_JS)
    assert result['overrides'] == 1, 'the Ledger override was imported (its key remapped)'
    assert result['app'] == result['server']
    snap = result['app']
    assert snap['totalLiabilities'] == 4000.55
    assert snap['debtPaymentMade'] == 195
    assert snap['totalAssets'] > 0 and snap['incomeReceived'] > 0


@pytest.mark.feature
def test_capture_stores_what_the_core_computes(app_page):
    """Negative control: the app's own capture really goes through the shared core."""
    page = app_page
    seed_state(page, _dataset())
    page.wait_for_function('() => window.app.accounts.length === 3')
    result = page.evaluate("""async () => {
        const core = await import('/src/netWorthCore.js');
        const expected = core.buildNetWorthSnapshot(window.app, new Date(), 'manual');
        const stored = window.app.captureNetWorthSnapshot({ source: 'manual', silent: true, skipMilestone: true });
        const empty = core.buildNetWorthSnapshot({}, new Date(), 'auto');
        return { expected, stored, empty };
    }""")
    assert result['stored'] == result['expected']
    assert result['empty']['netWorth'] == 0
    assert result['stored']['netWorth'] != result['empty']['netWorth']
