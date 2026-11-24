"""
Bulk import (#529): a backup is one POST /api/import, applied in one transaction.

The page's own import path (importAllJSON -> replaceForPostgres / mergeForPostgres) is
driven, and the requests it sends are recorded. It used to send one request per record.
Run: pytest tests/postgres/test_bulk_import.py -v
"""
import json

import pytest

from tests.conftest import seed_state, wait_for_api

pytestmark = pytest.mark.feature

BACKUP = {
    'version': '3.0',
    'accounts': [
        {'id': 1, 'name': 'Bulk Checking', 'type': 'Checking', 'startingBalance': 100},
        {'id': 2, 'name': 'Bulk Savings', 'type': 'Checking', 'startingBalance': 900},  # not Savings: history-tracked types are seeded after an import
    ],
    'bills': [{'id': i, 'name': f'Bill {i}', 'amount': 10 + i, 'dueDay': (i % 28) + 1, 'category': 'Housing',
               'accountId': 1 + (i % 2)} for i in range(1, 41)],
    'manualTransactions': [{'id': i, 'name': f'Purchase {i}', 'amount': -i, 'date': '2026-03-0%d' % (1 + i % 9),
                            'category': 'Dining', 'accountId': 1} for i in range(1, 61)],
    'ledgerClearedTransactions': {f'manual|{i}|1|2026-03-0{1 + i % 9}': {'clearedAt': '2026-03-10T00:00:00.000Z'}
                                  for i in range(1, 21)},
    'settings': [{'key': 'reconciliationAdjustsBalance', 'value': False}],
    'strategy': {'paymentStrategy': 'snowball', 'monthlyPayment': 250},
}

_RECORD_REQUESTS_JS = """() => {
    if (window.__writes) { window.__writes.length = 0; return; }
    window.__writes = [];
    const orig = window.fetch.bind(window);
    window.fetch = (url, opts = {}) => {
        const method = (opts.method || 'GET').toUpperCase();
        if (method !== 'GET' && String(url).includes('/api/')) window.__writes.push(method + ' ' + String(url));
        return orig(url, opts);
    };
}"""

_RUN_IMPORT_JS = """async ({ json, replace }) => {
    const mod = await import('/src/dataExport.js');
    const file = new File([json], 'backup.json', { type: 'application/json' });
    return new Promise(resolve => {
        mod.importAllJSON(window.app, file, {
            requestImportMode: () => replace,
            onImported: (parts, warnings) => resolve({ ok: true, warnings }),
            onMergeDuplicates: (skipped, warnings) => resolve({ ok: true, skipped, warnings }),
            onImportError: () => resolve({ ok: false }),
            onNoData: () => resolve({ ok: false, noData: true }),
        });
    });
}"""


def _writes(page):
    return page.evaluate('() => window.__writes')


def _import(page, state, replace):
    return page.evaluate(_RUN_IMPORT_JS, {'json': json.dumps(state), 'replace': replace})


def test_replace_import_is_one_request(app_page_no_sw):
    page = app_page_no_sw
    page.evaluate(_RECORD_REQUESTS_JS)
    result = _import(page, BACKUP, replace=True)
    assert result['ok'] is True, result

    # One request for the whole backup, and no per-record writes.
    assert _writes(page) == ['POST /api/import']

    # The page shows what the server now holds.
    assert page.evaluate('() => window.app.accounts.map(a => a.name)') == ['Bulk Checking', 'Bulk Savings']
    assert page.evaluate('() => window.app.bills.length') == 40
    assert page.evaluate('() => window.app.manualTransactions.length') == 60
    assert page.evaluate('() => Object.keys(window.app.ledgerClearedTransactions).length') == 20
    assert page.evaluate('() => window.app._savedStrategy') == 'snowball'
    assert len(wait_for_api(page, '/api/bills', lambda d: len(d) == 40)) == 40
    assert len(wait_for_api(page, '/api/manual-transactions', lambda d: len(d) == 60)) == 60
    assert len(wait_for_api(page, '/api/ledger-cleared', lambda d: len(d) == 20)) == 20


def test_merge_import_is_one_request_and_reports_duplicates(app_page_no_sw):
    page = app_page_no_sw
    seed_state(page, BACKUP)
    page.evaluate(_RECORD_REQUESTS_JS)
    extra = {**BACKUP, 'accounts': BACKUP['accounts'] + [{'id': 3, 'name': 'Bulk Brokerage', 'type': 'Investment', 'startingBalance': 5}]}
    result = _import(page, extra, replace=False)
    assert result['ok'] is True, result
    assert _writes(page) == ['POST /api/import']
    assert result['skipped']['accounts'] == 2
    assert result['skipped']['bills'] == 40
    assert page.evaluate('() => window.app.accounts.map(a => a.name)') == ['Bulk Checking', 'Bulk Savings', 'Bulk Brokerage']
    assert len(wait_for_api(page, '/api/bills', lambda d: len(d) == 40)) == 40


def test_record_edits_after_an_import_still_carry_a_row_version(app_page_no_sw):
    """loadFromPostgres seeds the shadow copies, so the first PATCH after an import
    diffs correctly and does not conflict."""
    page = app_page_no_sw
    assert _import(page, BACKUP, replace=True)['ok'] is True
    bill_id = page.evaluate('() => window.app.bills[0].id')
    page.evaluate("""async (id) => {
        const sync = await import('/src/postgresSync.js');
        const bill = window.app.bills.find(b => b.id === id);
        bill.amount = 999;
        sync.pgPatch(window.app, '/api/bills/' + id, bill);
    }""", bill_id)
    assert wait_for_api(page, '/api/bills', lambda d: any(b['id'] == bill_id and b['amount'] == 999 for b in d))


def _page_and_server_state(page):
    return {
        'page': page.evaluate('() => window.app.accounts.map(a => a.name)'),
        'server': page.evaluate("async () => (await (await fetch('/api/accounts')).json()).map(a => a.name)"),
        'bills': page.evaluate("async () => (await (await fetch('/api/bills')).json()).length"),
    }


@pytest.mark.parametrize('replace', [True, False], ids=['replace', 'merge'])
def test_failed_import_leaves_page_and_server_unchanged(app_page_no_sw, replace):
    """A server error (500) means nothing was imported: no rollback traffic, no change."""
    page = app_page_no_sw
    seed_state(page, {'version': '3.0', 'accounts': [{'id': 1, 'name': 'Existing', 'type': 'Checking', 'startingBalance': 1}],
                      'bills': [{'id': 1, 'name': 'Existing Bill', 'amount': 5, 'dueDay': 1, 'accountId': 1}]})
    before = _page_and_server_state(page)
    assert before == {'page': ['Existing'], 'server': ['Existing'], 'bills': 1}

    page.evaluate(_RECORD_REQUESTS_JS)
    page.route('**/api/import', lambda route: route.fulfill(
        status=500, content_type='application/json', body='{"error":{"code":"INTERNAL_ERROR","message":"boom"}}'))
    result = _import(page, BACKUP, replace=replace)
    page.unroute('**/api/import')

    assert result == {'ok': False}
    assert _writes(page) == ['POST /api/import'], 'no wipe, no per-record writes, no rollback requests'
    assert _page_and_server_state(page) == before


@pytest.mark.parametrize('replace', [True, False], ids=['replace', 'merge'])
def test_server_rejection_changes_nothing(app_page_no_sw, replace):
    """The real server refuses a record (an override on an account that is not the user's):
    400, the whole import rolled back, existing data intact."""
    page = app_page_no_sw
    seed_state(page, {'version': '3.0', 'accounts': [{'id': 1, 'name': 'Existing', 'type': 'Checking', 'startingBalance': 1}],
                      'bills': [{'id': 1, 'name': 'Existing Bill', 'amount': 5, 'dueDay': 1, 'accountId': 1}]})
    before = _page_and_server_state(page)
    statuses = []
    page.on('response', lambda r: statuses.append(r.status) if r.url.endswith('/api/import') else None)

    def poison(route):
        body = route.request.post_data_json
        body['data'].setdefault('ledgerAmountOverrides', {})['manual|1|1|2026-03-01'] = {
            'amount': 1, 'accountId': 987654321, 'date': '2026-03-01'}
        route.continue_(post_data=json.dumps(body))

    page.route('**/api/import', poison)
    result = _import(page, BACKUP, replace=replace)
    page.unroute('**/api/import')

    assert result == {'ok': False}
    assert statuses == [400]
    assert _page_and_server_state(page) == before
    assert wait_for_api(page, '/api/ledger-overrides', lambda d: d == []) == []


def test_a_hand_edited_file_with_a_text_strategy_still_imports(app_page_no_sw):
    """Only an object `strategy` is meaningful; anything else is ignored, not an error."""
    page = app_page_no_sw
    result = _import(page, {**BACKUP, 'strategy': 'avalanche'}, replace=True)
    assert result['ok'] is True, result
    assert page.evaluate('() => window.app.accounts.length') == 2
    assert page.evaluate('() => window.app._savedStrategy') is None
