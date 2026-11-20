#!/usr/bin/env python3
"""
Boot gate behaviour (issues #462, #468, #466) and the balance-history seeding
concurrency regression (#534).

Each gate test builds its own browser context with service workers blocked, so the
`page.route()` stubs see every request, and installs the stubs before the first load.

Stub design for the 401 tests: `probeServer()` decides "has a session" from
GET /api/plan-settings, and `loadFromPostgres()` fails with SessionExpiredError when
any list GET (here /api/debts) answers 401. Stubbing only /api/debts therefore gives
the "probe says signed in, load says expired" state init() re-probes on; flipping
/api/plan-settings to 401 afterwards makes the next probe report no session.
"""

import re

import pytest
from playwright.sync_api import expect

from tests.conftest import (
    BASE_URL,
    _http_json,
    _valid_session_cookies,
    ensure_session,
    reset_server_state_http,
    seed_state,
    wait_for_api,
    wait_for_app_ready,
)

GATE = '#serverUnreachableGate'
LOGIN = '#loginGate'
WIZARD = '#setupWizardModal'
LANDED = "() => window.app && window.app._currentPage === 'health'"


@pytest.fixture
def gate_context(browser, stack_user):
    """A signed-in context on an empty server, service workers blocked, not yet loaded."""
    reset_server_state_http()
    context = browser.new_context(service_workers='block')
    ensure_session(context)
    yield context
    context.close()


def _count_requests(page):
    counts = {'plan': 0, 'setup': 0}

    def on_request(req):
        if req.url.endswith('/api/plan-settings'):
            counts['plan'] += 1
        elif req.url.endswith('/auth/setup-status'):
            counts['setup'] += 1

    page.on('request', on_request)
    return counts


# ---------------------------------------------------------------------------
# #468: "Try again" probes once
# ---------------------------------------------------------------------------

@pytest.mark.feature
def test_retry_probes_once_then_boots(gate_context):
    page = gate_context.new_page()
    state = {'down': True}
    page.route('**/api/plan-settings',
               lambda r: r.abort() if state['down'] else r.continue_())
    counts = _count_requests(page)

    page.goto(BASE_URL, wait_until='domcontentloaded')
    expect(page.locator(GATE)).to_be_visible(timeout=30000)
    before = dict(counts)

    state['down'] = False
    page.click('#serverUnreachableRetryBtn')
    page.wait_for_function(LANDED, timeout=30000)
    expect(page.locator(GATE)).to_be_hidden()

    # One probe (the Retry's), reused by boot; a signed-in boot adds no setup-status call.
    assert counts['plan'] - before['plan'] == 1, counts
    assert counts['setup'] - before['setup'] == 0, counts


@pytest.mark.feature
def test_retry_while_still_unreachable_keeps_gate(gate_context):
    page = gate_context.new_page()
    page.route('**/api/plan-settings', lambda r: r.abort())
    counts = _count_requests(page)

    page.goto(BASE_URL, wait_until='domcontentloaded')
    expect(page.locator(GATE)).to_be_visible(timeout=30000)
    before = counts['plan']

    page.click('#serverUnreachableRetryBtn')
    expect(page.locator('#serverUnreachableStatus')).to_have_text(re.compile("Still can't reach"), timeout=15000)
    expect(page.locator(GATE)).to_be_visible()
    expect(page.locator('#serverUnreachableRetryBtn')).to_be_enabled()
    assert counts['plan'] - before == 1, counts
    assert not page.evaluate(LANDED)


# ---------------------------------------------------------------------------
# #462: the re-probe cap resets
# ---------------------------------------------------------------------------

def _expiring_stubs(page, state, *, expire_on_call):
    """/api/debts answers 401 for its first `expire_on_call` loads; the call numbered
    `expire_on_call` also flips /api/plan-settings to 401 (the session is then gone)."""
    def debts(route):
        state['debts'] += 1
        if state['debts'] >= expire_on_call:
            state['expired'] = True
        if state['debts'] <= expire_on_call:
            route.fulfill(status=401, content_type='application/json', body='{"error":"unauthorized"}')
        else:
            route.continue_()

    def plan(route):
        if state['expired']:
            route.fulfill(status=401, content_type='application/json', body='{"error":"unauthorized"}')
        else:
            route.continue_()

    page.route('**/api/debts', debts)
    page.route('**/api/plan-settings', plan)


@pytest.mark.feature
def test_expiry_after_gate_retry_shows_login_gate(gate_context):
    page = gate_context.new_page()
    state = {'debts': 0, 'expired': False}
    # Loads 1-3 are 401 with a live session: two re-probes, then the cap shows the
    # unreachable gate. Load 4 (after Retry) is 401 again and the session is gone.
    _expiring_stubs(page, state, expire_on_call=4)

    page.goto(BASE_URL, wait_until='domcontentloaded')
    expect(page.locator(GATE)).to_be_visible(timeout=30000)
    assert state['debts'] == 3 and not state['expired'], state

    page.click('#serverUnreachableRetryBtn')
    # With the counter reset, this 401 re-probes and lands on sign-in. Before the fix
    # the stale count sent it straight back to the unreachable gate.
    expect(page.locator(LOGIN)).to_be_visible(timeout=30000)
    expect(page.locator(GATE)).to_be_hidden()
    assert state['debts'] == 4, state


@pytest.mark.feature
def test_expiry_below_cap_shows_login_gate(gate_context):
    page = gate_context.new_page()
    state = {'debts': 0, 'expired': False}
    _expiring_stubs(page, state, expire_on_call=1)

    page.goto(BASE_URL, wait_until='domcontentloaded')
    expect(page.locator(LOGIN)).to_be_visible(timeout=30000)
    expect(page.locator(GATE)).to_be_hidden()
    assert state['debts'] == 1, state


@pytest.mark.feature
def test_expiry_at_cap_without_logout_shows_unreachable_gate(gate_context):
    """The cap itself still holds: a server that reports a session but 401s the data
    ends at the unreachable gate rather than looping."""
    page = gate_context.new_page()
    state = {'debts': 0, 'expired': False}
    _expiring_stubs(page, state, expire_on_call=99)

    page.goto(BASE_URL, wait_until='domcontentloaded')
    expect(page.locator(GATE)).to_be_visible(timeout=30000)
    expect(page.locator(LOGIN)).to_be_hidden()
    assert state['debts'] == 3, state


# ---------------------------------------------------------------------------
# #466: legacy prompt dismissed on an empty server
# ---------------------------------------------------------------------------

LEGACY = (
    '{"debts":[{"id":1,"name":"Legacy Debt","debtType":"creditCard","accountBalance":1000,'
    '"interestRate":15,"minimumPayment":50,"dueDate":1}],'
    '"accounts":[{"id":2,"name":"Legacy Checking","type":"Checking","startingBalance":500}]}'
)


@pytest.fixture
def legacy_page(gate_context):
    """Empty server that has never stored the wizard setting, and a legacy browser key
    written once from a static page (so the app has not booted and opened the wizard)."""
    cookies = {c['name']: c['value'] for c in _valid_session_cookies()}
    status, _, _ = _http_json('DELETE', '/api/settings/reconciliationAdjustsBalance', cookies=cookies)
    assert status < 300, status
    page = gate_context.new_page()
    page.on('dialog', lambda d: d.accept())
    page.goto(BASE_URL + '/guide.html', wait_until='domcontentloaded')
    page.evaluate("v => localStorage.setItem('debtTrackerData', v)", LEGACY)
    page.evaluate("() => localStorage.removeItem('debtTrackerLastSeenVersion')")
    page.goto(BASE_URL, wait_until='domcontentloaded')
    expect(page.locator('#pgMigrationModal')).to_be_visible(timeout=30000)
    return page


def _legacy_key(page):
    return page.evaluate("() => localStorage.getItem('debtTrackerData')")


@pytest.mark.feature
def test_decline_legacy_import_opens_wizard_same_load(legacy_page):
    page = legacy_page
    # The wizard must not stack on the prompt.
    expect(page.locator(WIZARD)).to_be_hidden()
    page.click('#pgMigrationSkipBtn')
    expect(page.locator('#pgMigrationModal')).to_be_hidden()
    expect(page.locator(WIZARD)).to_be_visible(timeout=15000)
    assert _legacy_key(page) is None
    page.wait_for_function(LANDED, timeout=30000)
    # First-run handling is the same as a normal first run: the silent What's New mark and
    # the auto net-worth snapshot default both apply in this load.
    assert page.evaluate("() => localStorage.getItem('debtTrackerLastSeenVersion')")
    assert page.evaluate("() => window.app.settings.some(s => s.key === 'autoNwSnapshot' && s.value === true)")
    expect(page.locator('#whatsNewModal')).to_be_hidden()

    # Choosing in the wizard ends it for good: the next load shows neither prompt nor wizard.
    page.click('#setupWizardVisibleBtn')
    expect(page.locator(WIZARD)).to_be_hidden()
    wait_for_api(page, '/api/settings',
                 lambda rows: any(r.get('key') == 'reconciliationAdjustsBalance' for r in rows))
    page.reload()
    wait_for_app_ready(page)
    expect(page.locator('#pgMigrationModal')).to_be_hidden()
    expect(page.locator(WIZARD)).to_be_hidden()


@pytest.mark.feature
def test_accept_legacy_import_does_not_open_wizard(legacy_page):
    page = legacy_page
    page.click('#pgMigrationTransferBtn')
    expect(page.locator('#pgMigrationModal')).to_be_hidden(timeout=30000)
    page.wait_for_function(LANDED, timeout=30000)
    expect(page.locator(WIZARD)).to_be_hidden()
    assert page.evaluate("() => window.app.accounts.length") == 1
    assert _legacy_key(page) is None


@pytest.mark.feature
def test_escape_legacy_prompt_keeps_key_and_opens_wizard(legacy_page):
    """Escape keeps the browser copy (the prompt returns next load) but the dataset is
    still empty, so the wizard opens now, as for any other first run."""
    page = legacy_page
    page.keyboard.press('Escape')
    expect(page.locator('#pgMigrationModal')).to_be_hidden()
    expect(page.locator(WIZARD)).to_be_visible(timeout=15000)
    assert _legacy_key(page) is not None


# ---------------------------------------------------------------------------
# #534: balance-history seeding is bounded (fix shipped in 7.3.0)
# ---------------------------------------------------------------------------

_TRACK_POSTS = """
(() => {
    window.__bh = { inflight: 0, max: 0, total: 0 };
    const orig = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        if (method !== 'POST' || !/\\/api\\/balance-history$/.test(url)) return orig(input, init);
        const s = window.__bh;
        s.inflight += 1; s.total += 1; s.max = Math.max(s.max, s.inflight);
        try {
            // Hold each request open so overlapping ones are observable.
            await new Promise(r => setTimeout(r, 80));
            return await orig(input, init);
        } finally { s.inflight -= 1; }
    };
})();
"""


@pytest.mark.feature
def test_balance_history_seeding_is_bounded(app_page):
    page = app_page
    n = 12
    seed_state(page, {
        'debts': [{'id': i + 1, 'name': f'Card {i}', 'debtType': 'creditCard', 'accountBalance': 500 + i,
                   'minimumPayment': 25, 'interestRate': 18, 'dueDate': 5} for i in range(n)],
        'accounts': [{'id': 100 + i, 'name': f'Loan {i}', 'type': 'Loan', 'startingBalance': -5000 - i,
                      'minimumPayment': 100} for i in range(n)],
    }, reload=False)
    # Start from no history so the next boot has 2n entries to seed.
    cookies = {c['name']: c['value'] for c in _valid_session_cookies()}
    status, _, _ = _http_json('DELETE', '/api/balance-history', cookies=cookies)
    assert status < 300, status

    page.add_init_script(_TRACK_POSTS)
    page.reload()

    debts = page.evaluate("async () => (await (await fetch('/api/debts')).json()).map(d => d.id)")
    accounts = page.evaluate("async () => (await (await fetch('/api/accounts')).json()).map(a => a.id)")
    assert len(debts) == n and len(accounts) == n
    history = wait_for_api(page, '/api/balance-history', lambda rows: len(rows) >= 2 * n, timeout=20.0)

    stats = page.evaluate("() => window.__bh")
    assert 2 <= stats['max'] <= 6, stats  # overlapping (the probe works) but bounded
    assert stats['total'] == 2 * n, stats
    # The seeded history is complete: one entry per debt and per tracked account.
    assert {e['debtId'] for e in history if e.get('debtId') is not None} == set(debts)
    assert {e['accountId'] for e in history if e.get('accountId') is not None} == set(accounts)
