#!/usr/bin/env python3
"""
Refresh on focus and across tabs (#575), and records deleted elsewhere (#565).

- A write in one tab is relayed on a BroadcastChannel; the other tabs of the
  same browser re-read the server within about a second.
- A tab hidden for at least REFRESH_ON_FOCUS_SECONDS (window.__ENV__, default
  60) re-reads the server when it is shown again. Tests set it to 0 and fake
  the visibility change, since a headless page can't really be hidden.
- A refresh waits while the user is typing, editing or in a modal, and keeps
  the Ledger view state.
- A PATCH/DELETE that finds the record already deleted shows
  #recordGoneBanner (with Reload) instead of the connection banner.
"""

import pytest

from tests.conftest import BASE_URL, ensure_session, open_debt_form, seed_state, wait_for_api, wait_for_app_ready

STATE = {
    'version': '3.0',
    'accounts': [{'id': 1, 'name': 'LR Checking', 'type': 'Checking', 'startingBalance': 1000}],
    'debts': [{'id': 1, 'name': 'Refresh Visa', 'debtType': 'creditCard', 'accountBalance': 900,
               'interestRate': 19, 'minimumPayment': 40, 'dueDate': 12, 'accountId': 1}],
}

# Fake a hide → show cycle (the tab really stays visible).
_HIDE_SHOW_JS = """async (seconds) => {
    window.__ENV__ = Object.assign(window.__ENV__ || {}, { REFRESH_ON_FOCUS_SECONDS: seconds });
    let vis = 'hidden';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => vis });
    document.dispatchEvent(new Event('visibilitychange'));
    vis = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
}"""


def _hide_and_show(page, seconds=0):
    page.evaluate("() => { delete document.documentElement.dataset.lastRefresh; }")
    page.evaluate(_HIDE_SHOW_JS, seconds)


def _wait_refreshed(page, timeout=5000):
    page.wait_for_function(
        "() => (document.documentElement.dataset.lastRefresh || '').startsWith('applied')", timeout=timeout)


def _csrf_headers(page):
    csrf = page.evaluate("document.cookie.split('; ').find(r => r.startsWith('csrf='))?.split('=')[1] || ''")
    return {'X-CSRF-Token': csrf}


def _delete_debt_via_api(page):
    debt_id = page.evaluate("() => window.app.debts[0].id")
    res = page.request.delete(f"{BASE_URL.rstrip('/')}/api/debts/{debt_id}", headers=_csrf_headers(page))
    assert res.status == 204, res.status
    return debt_id


def _two_tabs(page):
    """Two tabs in one fresh browser context (BroadcastChannel only reaches
    tabs of the same browser profile). The app_page fixture's own context
    can't open extra pages. Close with `tab_a.context.close()`."""
    context = page.context.browser.new_context()
    ensure_session(context)
    tabs = []
    for _ in range(2):
        tab = context.new_page()
        tab.goto(BASE_URL)
        wait_for_app_ready(tab)
        tabs.append(tab)
    return tabs


# ─── Cross-tab (BroadcastChannel) ────────────────────────────────────────────

@pytest.mark.feature
def test_record_added_in_one_tab_appears_in_the_other(app_page):
    """Acceptance (#575): a record added in tab A appears in tab B within a second."""
    seed_state(app_page, STATE)
    page_a, page_b = _two_tabs(app_page)
    try:
        page_b.evaluate("() => { delete document.documentElement.dataset.lastRefresh; }")
        page_a.evaluate("""async () => {
            const sync = await import('/src/postgresSync.js');
            await sync.pgPost(window.app, '/api/persons', { name: 'Tab A Person' });
        }""")
        page_b.wait_for_function(
            "() => (window.app.persons || []).some(p => p.name === 'Tab A Person')", timeout=2500)
        assert page_b.evaluate("document.documentElement.dataset.lastRefresh").startswith('applied')
    finally:
        page_a.context.close()


@pytest.mark.feature
def test_writing_tab_does_not_refresh_itself(app_page):
    """Negative: BroadcastChannel never delivers to the sender, so the tab that
    wrote doesn't pay for a pointless refresh."""
    page = app_page
    seed_state(page, STATE)
    page.evaluate("() => { delete document.documentElement.dataset.lastRefresh; }")
    page.evaluate("""async () => {
        const sync = await import('/src/postgresSync.js');
        await sync.pgPost(window.app, '/api/persons', { name: 'Solo Person' });
    }""")
    page.wait_for_timeout(1200)  # longer than debounce + a refresh round trip
    assert page.evaluate("document.documentElement.dataset.lastRefresh") is None


# ─── Refresh on returning to the tab ─────────────────────────────────────────

@pytest.mark.feature
def test_record_deleted_elsewhere_is_gone_after_regaining_focus(app_page):
    """Acceptance (#565): a record deleted via the API disappears from the open
    tab when it regains focus."""
    page = app_page
    seed_state(page, STATE)
    page.click('[data-page="liabilities"]')
    page.locator('#debtsList >> text=Refresh Visa').wait_for()
    _delete_debt_via_api(page)
    _hide_and_show(page, 0)
    _wait_refreshed(page)
    assert page.evaluate("() => window.app.debts.length") == 0
    page.locator('#debtsList >> text=Refresh Visa').wait_for(state='detached')


@pytest.mark.feature
def test_short_absence_below_threshold_does_not_refresh(app_page):
    """Negative: returning sooner than REFRESH_ON_FOCUS_SECONDS changes nothing."""
    page = app_page
    seed_state(page, STATE)
    _delete_debt_via_api(page)
    _hide_and_show(page, 3600)
    page.wait_for_timeout(1000)
    assert page.evaluate("document.documentElement.dataset.lastRefresh") is None
    assert page.evaluate("() => window.app.debts.length") == 1


@pytest.mark.feature
def test_refresh_waits_while_typing_and_keeps_the_input(app_page):
    """Acceptance (#575): returning to the tab doesn't lose an open form. The
    refresh is deferred while focus is in a text field and runs afterwards."""
    page = app_page
    seed_state(page, STATE)
    page.click('[data-page="liabilities"]')
    open_debt_form(page)
    page.fill('#debtName', 'Half-typed debt')
    page.focus('#debtName')
    _delete_debt_via_api(page)
    _hide_and_show(page, 0)
    page.wait_for_function("() => document.documentElement.dataset.refreshDeferred === 'typing'", timeout=3000)
    assert page.evaluate("() => window.app.debts.length") == 1, 'refresh must wait while typing'
    assert page.input_value('#debtName') == 'Half-typed debt'

    page.evaluate("() => document.activeElement.blur()")
    _wait_refreshed(page, timeout=5000)
    assert page.evaluate("() => window.app.debts.length") == 0
    assert page.input_value('#debtName') == 'Half-typed debt', 'the add form keeps its input'


@pytest.mark.feature
def test_refresh_waits_for_an_open_inline_edit(app_page):
    page = app_page
    seed_state(page, STATE)
    page.evaluate("() => { window.app.editingDebtId = window.app.debts[0].id; }")
    _hide_and_show(page, 0)
    page.wait_for_function("() => document.documentElement.dataset.refreshDeferred === 'editing'", timeout=3000)
    page.evaluate("() => { window.app.editingDebtId = null; }")
    _wait_refreshed(page, timeout=5000)


@pytest.mark.feature
def test_refresh_keeps_the_ledger_view(app_page):
    """A background refresh updates data but not the user's Ledger sort."""
    page = app_page
    seed_state(page, STATE)
    page.evaluate("() => { window.app._ledgerSortDir = 'asc'; window.app._ledgerSortKey = 'amount'; }")
    page.evaluate("() => window.app.refreshFromServer()")
    assert page.evaluate("() => [window.app._ledgerSortKey, window.app._ledgerSortDir]") == ['amount', 'asc']


# ─── Deleted elsewhere (#565) ────────────────────────────────────────────────

@pytest.mark.feature
def test_editing_a_record_deleted_elsewhere_shows_the_gone_notice(app_page):
    """Acceptance (#565): a 404 on PATCH shows a distinct 'deleted elsewhere'
    notice with Reload, not the connection banner. The stale copy stays until
    Reload, which removes it."""
    page = app_page
    seed_state(page, STATE)
    _delete_debt_via_api(page)
    page.evaluate("""async () => {
        const sync = await import('/src/postgresSync.js');
        const d = window.app.debts[0];
        d.accountBalance = 1;
        await sync.pgPatch(window.app, `/api/debts/${d.id}`, d);
    }""")
    page.locator('#recordGoneBanner').wait_for(state='visible')
    assert 'another tab or device' in page.locator('#recordGoneBanner').text_content()
    assert not page.locator('#syncErrorBanner').is_visible()
    assert page.evaluate("() => window.app.debts.length") == 1, 'nothing vanishes before Reload'

    page.evaluate("() => { delete document.documentElement.dataset.lastRefresh; }")
    page.click('#recordGoneReloadBtn')
    _wait_refreshed(page)
    assert not page.locator('#recordGoneBanner').is_visible()
    assert page.evaluate("() => window.app.debts.length") == 0


@pytest.mark.feature
def test_deleting_a_record_deleted_elsewhere_shows_the_gone_notice(app_page):
    page = app_page
    seed_state(page, STATE)
    debt_id = _delete_debt_via_api(page)
    page.evaluate(f"""async () => {{
        const sync = await import('/src/postgresSync.js');
        await sync.pgDelete(window.app, '/api/debts/{debt_id}');
    }}""")
    page.locator('#recordGoneBanner').wait_for(state='visible')
    assert not page.locator('#syncErrorBanner').is_visible()
    page.click('#recordGoneDismiss')
    page.locator('#recordGoneBanner').wait_for(state='hidden')


@pytest.mark.feature
def test_deleting_a_missing_ledger_key_is_silent(app_page):
    """Negative: a keyed DELETE (override/cleared flag) that 404s is just
    already absent: no notice and no connection banner."""
    page = app_page
    seed_state(page, STATE)
    page.evaluate("""async () => {
        const sync = await import('/src/postgresSync.js');
        await sync.pgDelete(window.app, '/api/ledger-overrides/' + encodeURIComponent('debt|999|1|2026-01-01'));
    }""")
    page.wait_for_timeout(300)
    assert not page.locator('#recordGoneBanner').is_visible()
    assert not page.locator('#syncErrorBanner').is_visible()


@pytest.mark.feature
def test_other_failures_still_show_the_connection_banner(app_page):
    """Negative: only 404 maps to the gone notice; a 500 is still a failed save."""
    page = app_page
    seed_state(page, STATE)
    page.route('**/api/debts/*', lambda route: route.fulfill(
        status=500, content_type='application/json', body='{"error":"boom"}')
        if route.request.method == 'DELETE' else route.continue_())
    page.evaluate("""async () => {
        const sync = await import('/src/postgresSync.js');
        await sync.pgDelete(window.app, `/api/debts/${window.app.debts[0].id}`);
    }""")
    page.locator('#syncErrorBanner').wait_for(state='visible')
    assert not page.locator('#recordGoneBanner').is_visible()
    wait_for_api(page, '/api/debts', lambda d: len(d) == 1)
