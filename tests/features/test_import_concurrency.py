#!/usr/bin/env python3
"""
Bounded import fan-out (issue #519).

Replace and merge imports, their rollbacks and balance-history seeding used to
send one request per record with a bare Promise.all. A backup with 2,000
Ledger overrides and 1,000 cleared flags put ~3,000 requests in flight, and
Chromium aborted some with net::ERR_INSUFFICIENT_RESOURCES, failing the import
and sometimes its rollback. Every fan-out now goes through a pool of 6
(src/concurrency.js).

The in-flight count is recorded by wrapping window.fetch, so it measures what
the app actually sends.
"""

import datetime

import pytest

from tests.conftest import seed_state, wait_for_api

LIMIT = 6

# Wrap fetch once per page: count concurrent non-GET /api/ requests.
_TRACK_JS = """() => {
    if (window.__inflight) { window.__inflight.max = 0; window.__inflight.total = 0; return; }
    const t = window.__inflight = { now: 0, max: 0, total: 0, byPath: {} };
    const orig = window.fetch.bind(window);
    window.fetch = async (url, opts = {}) => {
        const method = (opts.method || 'GET').toUpperCase();
        const track = method !== 'GET' && String(url).includes('/api/');
        if (track) {
            t.now++; t.total++;
            t.max = Math.max(t.max, t.now);
            const key = method + ' ' + String(url).split('/').slice(0, 3).join('/');
            t.byPath[key] = (t.byPath[key] || 0) + 1;
        }
        try { return await orig(url, opts); } finally { if (track) t.now--; }
    };
}"""

# Build an export-shaped state in the page and run the real import path.
_IMPORT_JS = """async ({ mode, overrides, cleared, accounts }) => {
    const { sanitizeParsedState } = await import('/src/sanitizers.js');
    const { replaceForPostgres, mergeForPostgres } = await import('/src/postgresImport.js');
    const state = {
        version: '3.0',
        accounts: Array.from({ length: accounts }, (_, i) =>
            ({ id: 100 + i, name: `Bulk Account ${i}`, type: 'Checking', startingBalance: 10 })),
        ledgerAmountOverrides: {},
        ledgerClearedTransactions: {},
        settings: [{ key: 'reconciliationAdjustsBalance', value: false }],
    };
    // Keys must resolve to an imported record or they are dropped (#520):
    // interest rows use the account's own id as their source, so one account
    // backs any number of keys, one per distinct date.
    const day = i => new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    for (let i = 0; i < overrides; i++) {
        state.ledgerAmountOverrides[`interest|100|100|${day(i)}`] = { amount: i, originalAmount: i + 1, date: day(i) };
    }
    for (let i = 0; i < cleared; i++) {
        state.ledgerClearedTransactions[`interest|100|100|${day(i)}`] = { clearedAt: '2025-06-02T00:00:00.000Z' };
    }
    const clean = sanitizeParsedState(state);
    const run = mode === 'merge' ? mergeForPostgres : replaceForPostgres;
    try {
        await run(window.app, clean, {});
        return { ok: true };
    } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
    }
}"""


def _inflight(page):
    return page.evaluate("() => window.__inflight")


@pytest.mark.feature
def test_large_replace_import_succeeds_with_bounded_concurrency(app_page):
    """Acceptance (#519): 2,000 overrides + 1,000 cleared flags import in
    Chromium, with never more than 6 write requests in flight."""
    page = app_page
    page.evaluate(_TRACK_JS)
    result = page.evaluate(_IMPORT_JS, {'mode': 'replace', 'overrides': 2000, 'cleared': 1000, 'accounts': 1})
    assert result == {'ok': True}, result

    stats = _inflight(page)
    assert stats['total'] >= 3000, stats
    assert stats['max'] <= LIMIT, stats
    assert stats['max'] >= 2, 'the pool should still run requests in parallel'

    assert len(wait_for_api(page, '/api/ledger-overrides', lambda d: len(d) >= 2000, timeout=30)) == 2000
    assert len(wait_for_api(page, '/api/ledger-cleared', lambda d: len(d) >= 1000, timeout=30)) == 1000


@pytest.mark.feature
def test_merge_import_is_bounded(app_page):
    page = app_page
    page.evaluate(_TRACK_JS)
    result = page.evaluate(_IMPORT_JS, {'mode': 'merge', 'overrides': 400, 'cleared': 200, 'accounts': 3})
    assert result == {'ok': True}, result
    stats = _inflight(page)
    assert stats['total'] >= 600, stats
    assert stats['max'] <= LIMIT, stats


@pytest.mark.feature
def test_failed_import_rollback_is_bounded_and_restores_prior_data(app_page):
    """A failing replace import rolls back by re-posting the previous dataset
    through the same pool; the prior overrides and account come back."""
    page = app_page
    dates = [(datetime.date(2019, 1, 1) + datetime.timedelta(days=i)).isoformat() for i in range(300)]
    prior = {f'interest|1|1|{d}': {'amount': i, 'date': d} for i, d in enumerate(dates)}
    seed_state(page, {
        'version': '3.0',
        'accounts': [{'id': 1, 'name': 'Prior Account', 'type': 'Checking', 'startingBalance': 5}],
        'ledgerAmountOverrides': prior,
    })
    page.evaluate(_TRACK_JS)

    # The new dataset's cleared flags fail, after its overrides went in.
    def fail_cleared(route):
        if route.request.method == 'PUT':
            return route.fulfill(status=500, content_type='application/json', body='{"error":"boom"}')
        return route.continue_()
    page.route('**/api/ledger-cleared/**', fail_cleared)

    result = page.evaluate(_IMPORT_JS, {'mode': 'replace', 'overrides': 500, 'cleared': 50, 'accounts': 1})
    page.unroute('**/api/ledger-cleared/**', fail_cleared)
    assert result['ok'] is False, result

    stats = _inflight(page)
    assert stats['max'] <= LIMIT, stats
    overrides = wait_for_api(page, '/api/ledger-overrides', lambda d: len(d) == 300, timeout=30)
    accounts = wait_for_api(page, '/api/accounts', lambda d: len(d) == 1)
    assert accounts[0]['name'] == 'Prior Account'
    # The rollback re-posts the account under a new id and remaps the keys
    # with it (#520), so compare the dates and the restored account's id.
    acct = accounts[0]['id']
    assert {o['overrideKey'] for o in overrides} == {f'interest|{acct}|{acct}|{d}' for d in dates}, \
        'rollback should restore exactly the previous overrides, keyed to the restored account'


@pytest.mark.feature
def test_failure_stops_starting_new_requests(app_page):
    """Negative: once a request fails, the pool starts no further ones, so a
    doomed import doesn't keep sending hundreds of writes before rolling back."""
    page = app_page
    page.evaluate(_TRACK_JS)
    page.route('**/api/accounts', lambda route: route.fulfill(
        status=500, content_type='application/json', body='{"error":"boom"}')
        if route.request.method == 'POST' else route.continue_())
    result = page.evaluate(_IMPORT_JS, {'mode': 'replace', 'overrides': 0, 'cleared': 0, 'accounts': 60})
    assert result['ok'] is False, result
    account_posts = _inflight(page)['byPath'].get('POST /api/accounts', 0)
    assert account_posts <= 2 * LIMIT, f'{account_posts} account POSTs were sent after the first failure'


@pytest.mark.feature
def test_empty_import_sends_no_record_writes(app_page):
    """Negative: nothing to import means no per-record requests at all."""
    page = app_page
    page.evaluate(_TRACK_JS)
    result = page.evaluate(_IMPORT_JS, {'mode': 'merge', 'overrides': 0, 'cleared': 0, 'accounts': 0})
    assert result == {'ok': True}, result
    by_path = _inflight(page)['byPath']
    assert not any(k.startswith(('PUT /api/ledger', 'POST /api/accounts')) for k in by_path), by_path
