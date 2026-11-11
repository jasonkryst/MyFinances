#!/usr/bin/env python3
"""
Clear All Data wipes children before parents (#608).

pgDeleteAll used to send every collection-level DELETE at once, 6 in flight.
DELETE FROM accounts runs its foreign keys' SET NULL/CASCADE on the child
tables, and when a child table's own DELETE ran at the same moment, Postgres
aborted one of them with "deadlock detected" (a 500, part of the data left).
It now deletes in the layers of src/resourceDeletion.js. These tests log when
each DELETE starts and ends in the page and check that no parent's DELETE
starts before every one of its children's DELETEs has finished.
"""
import pytest

from tests.conftest import seed_state

STATE = {
    'persons': [{'id': 1, 'name': 'Pat'}],
    'accounts': [
        {'id': 10, 'name': 'Wipe Checking', 'type': 'Checking', 'startingBalance': 500},
        {'id': 11, 'name': 'Wipe Savings', 'type': 'Savings', 'startingBalance': 900},
        {'id': 12, 'name': 'Wipe Card', 'type': 'Credit Card', 'startingBalance': -300, 'minimumPayment': 25},
    ],
    'debts': [{'id': 20, 'name': 'Wipe Loan', 'debtType': 'creditCard', 'accountBalance': 800, 'interestRate': 19,
               'minimumPayment': 40, 'dueDate': 5, 'accountId': 10}],
    'incomes': [{'id': 30, 'name': 'Wipe Pay', 'amount': 2000, 'firstPayDate': '2026-11-01', 'frequency': 'monthly',
                 'accountId': 10, 'personId': 1}],
    'recurringTemplates': [{'id': 40, 'name': 'Wipe Move', 'type': 'transfer', 'amount': 50, 'frequency': 'monthly',
                            'dayOfMonth': 3, 'accountId': 10, 'targetAccountId': 11, 'startDate': '2026-01-01'}],
    'emergencyFunds': [{'id': 50, 'accountId': 11, 'targetAmount': 5000, 'currentAmount': 900, 'monthlyContribution': 100}],
    'transfers': [{'id': 60, 'fromAccountId': 10, 'toAccountId': 11, 'amount': 25, 'date': '2026-11-02'}],
}

# Wrap fetch to record the start and end of every DELETE, run the real pgDeleteAll,
# and return the log plus the declared parent map.
WIPE_AND_LOG = """async () => {
    const sync = await import('/src/postgresSync.js');
    const order = await import('/src/resourceDeletion.js');
    const log = [];
    const original = window.fetch;
    window.fetch = async (url, options) => {
        const method = (options && options.method) || 'GET';
        const path = new URL(url, location.href).pathname;
        if (method === 'DELETE') log.push(['start', path]);
        try {
            return await original(url, options);
        } finally {
            if (method === 'DELETE') log.push(['end', path]);
        }
    };
    try {
        await sync.pgDeleteAll(window.app);
    } finally {
        window.fetch = original;
    }
    return { log, parents: order.RESOURCE_PARENTS, paths: order.ALL_RESOURCE_PATHS };
}"""


def _wipe(page):
    seed_state(page, STATE)
    page.wait_for_function("() => window.app.accounts.length === 3 && window.app.debts.length === 1")
    return page.evaluate(WIPE_AND_LOG)


@pytest.mark.feature
def test_parents_are_deleted_only_after_their_children(app_page):
    result = _wipe(app_page)
    log = result['log']
    started = {path: i for i, (kind, path) in enumerate(log) if kind == 'start'}
    ended = {path: i for i, (kind, path) in enumerate(log) if kind == 'end'}
    violations = []
    for child, parents in result['parents'].items():
        for parent in parents:
            if not started[parent] > ended[child]:
                violations.append(f'{parent} started before {child} finished')
    assert violations == [], violations
    # Accounts, the most-referenced table, goes last.
    assert max(started.values()) == started['/api/accounts']


@pytest.mark.feature
def test_every_collection_is_deleted_once(app_page):
    result = _wipe(app_page)
    deleted = [path for kind, path in result['log'] if kind == 'start' and path.count('/') == 2]
    for path in result['paths']:
        assert deleted.count(path) == 1, f'{path} deleted {deleted.count(path)} times'


@pytest.mark.feature
def test_wipe_leaves_the_server_empty(app_page):
    page = app_page
    result = _wipe(page)
    counts = page.evaluate("""async (paths) => {
        const out = {};
        for (const path of paths) {
            const body = await (await fetch(path, { credentials: 'same-origin' })).json();
            out[path] = Array.isArray(body) ? body.length : Object.keys(body || {}).length;
        }
        return out;
    }""", result['paths'])
    assert {p: n for p, n in counts.items() if n} == {}
    assert not page.is_visible('#syncErrorBanner')
