#!/usr/bin/env python3
"""
"Saving... / All changes saved" chip and the unload warning (issue #576).

The chip follows postgresSync's pendingWriteCount() through the
myfinances:writes-changed event. Writes are held or failed with page.route, so
the context blocks service workers (the SW can serve past page.route; see
test_code_splitting.py).
"""

import pytest

from tests.conftest import BASE_URL, ensure_session, reset_server_state, wait_for_app_ready

pytestmark = pytest.mark.feature

PLAN_SETTINGS = '**/api/plan-settings'

# Records every text the chip's live region ever shows.
_WATCH_JS = """() => {
    window.__saveTexts = [];
    const el = document.getElementById('saveStatusText');
    new MutationObserver(() => window.__saveTexts.push(el.textContent))
        .observe(el, { childList: true, characterData: true, subtree: true });
}"""

# A block body: returning the promise would make page.evaluate wait for a held request.
_SAVE_JS = "() => { window.app.saveToStorage(['budgetCategories']); }"


@pytest.fixture
def app_page(browser, stack_user):
    context = browser.new_context(service_workers='block')
    page = context.new_page()
    page.console_errors = []
    page.page_errors = []
    page.on('pageerror', lambda e: page.page_errors.append(str(e)))
    ensure_session(context)
    page.goto(BASE_URL, wait_until='networkidle', timeout=60000)
    wait_for_app_ready(page)
    reset_server_state(page)
    page.evaluate(_WATCH_JS)
    yield page
    context.close()


def _text(page):
    return (page.text_content('#saveStatusText') or '').strip()


def _pending(page):
    return page.evaluate(
        "async () => (await import('/src/postgresSync.js')).pendingWriteCount()")


def _unload_prevented(page):
    return page.evaluate("""() => {
        const e = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(e);
        return e.defaultPrevented;
    }""")


def _hold_plan_settings(page):
    held = []
    page.route(PLAN_SETTINGS, lambda route: held.append(route) if route.request.method == 'PATCH' else route.continue_())
    return held


def test_chip_is_hidden_and_neutral_at_boot(app_page):
    page = app_page
    assert page.locator('#saveStatusChip').is_hidden()
    assert _text(page) == ''
    assert page.get_attribute('#saveStatus', 'role') == 'status'
    assert page.get_attribute('#saveStatus', 'aria-live') == 'polite'


def test_shows_saving_while_held_then_saved(app_page):
    page = app_page
    held = _hold_plan_settings(page)
    page.evaluate(_SAVE_JS)
    page.wait_for_selector('#saveStatusChip:not(.hidden)', timeout=5000)
    assert _text(page) == 'Saving…'
    assert _pending(page) >= 1
    assert len(held) == 1

    held[0].continue_()
    page.wait_for_function(
        "() => document.getElementById('saveStatusText').textContent === 'All changes saved'", timeout=8000)
    assert _pending(page) == 0
    # It idles again after a few seconds.
    page.wait_for_selector('#saveStatusChip.hidden', state='attached', timeout=10000)
    texts = page.evaluate("() => window.__saveTexts.filter(Boolean)")
    assert texts == ['Saving…', 'All changes saved'], f'one announcement per transition, got {texts}'


def test_a_failed_write_never_shows_saved(app_page):
    page = app_page
    page.route(PLAN_SETTINGS, lambda route: route.fulfill(status=500, body='{}', content_type='application/json')
               if route.request.method == 'PATCH' else route.continue_())
    page.evaluate(_SAVE_JS)
    page.wait_for_function(
        "() => document.getElementById('saveStatusText').textContent === 'Not saved'", timeout=8000)
    assert page.get_attribute('#saveStatusChip', 'data-state') == 'error'
    # Stays an error, and never passed through "saved".
    page.wait_for_timeout(1500)
    assert _text(page) == 'Not saved'
    texts = page.evaluate("() => window.__saveTexts")
    assert 'All changes saved' not in texts, texts
    # The existing banner still reports the failure.
    assert page.locator('#syncErrorBanner').is_visible()


def test_a_network_failure_never_shows_saved(app_page):
    page = app_page
    page.route(PLAN_SETTINGS, lambda route: route.abort() if route.request.method == 'PATCH' else route.continue_())
    page.evaluate(_SAVE_JS)
    page.wait_for_function(
        "() => document.getElementById('saveStatusText').textContent === 'Not saved'", timeout=8000)
    assert 'All changes saved' not in page.evaluate("() => window.__saveTexts")


def test_next_successful_write_clears_the_error(app_page):
    page = app_page
    state = {'fail': True}

    def handler(route):
        if route.request.method != 'PATCH':
            return route.continue_()
        if state['fail']:
            return route.fulfill(status=500, body='{}', content_type='application/json')
        return route.continue_()

    page.route(PLAN_SETTINGS, handler)
    page.evaluate(_SAVE_JS)
    page.wait_for_function(
        "() => document.getElementById('saveStatusText').textContent === 'Not saved'", timeout=8000)
    state['fail'] = False
    page.evaluate(_SAVE_JS)
    page.wait_for_function(
        "() => document.getElementById('saveStatusText').textContent === 'All changes saved'", timeout=8000)


def test_record_patch_is_counted_too(app_page):
    """A per-record PATCH (pgPatch) goes through the same counter, not only plan settings."""
    page = app_page
    page.evaluate("""async () => {
        const { pgPost } = await import('/src/postgresSync.js');
        window.__acct = await pgPost(window.app, '/api/accounts',
            { name: 'Chip Acct', type: 'Checking', startingBalance: 10 });
    }""")
    acct_id = page.evaluate("() => window.__acct && window.__acct.id")
    assert acct_id
    held = []
    page.route(f'**/api/accounts/{acct_id}',
               lambda route: held.append(route) if route.request.method == 'PATCH' else route.continue_())
    page.evaluate("""async () => {
        const { pgPatch } = await import('/src/postgresSync.js');
        pgPatch(window.app, '/api/accounts/' + window.__acct.id, { ...window.__acct, name: 'Chip Acct 2' });
    }""")
    page.wait_for_function(
        "() => document.getElementById('saveStatusText').textContent === 'Saving…'", timeout=5000)
    assert _unload_prevented(page) is True
    for _ in range(50):
        if held:
            break
        page.wait_for_timeout(100)
    assert held
    held[0].continue_()
    page.wait_for_function(
        "() => document.getElementById('saveStatusText').textContent === 'All changes saved'", timeout=8000)


def test_beforeunload_is_prevented_only_while_a_write_is_pending(app_page):
    page = app_page
    # Negative: nothing pending, so closing the tab is never blocked.
    assert _pending(page) == 0
    assert _unload_prevented(page) is False

    held = _hold_plan_settings(page)
    page.evaluate(_SAVE_JS)
    page.wait_for_function("async () => (await import('/src/postgresSync.js')).pendingWriteCount() > 0", timeout=5000)
    assert _unload_prevented(page) is True

    for _ in range(50):
        if held:
            break
        page.wait_for_timeout(100)
    # Stop holding before releasing: the app can send its own background
    # plan-settings save after boot, and a route left in place would hold that
    # one forever (seen in CI as pending stuck at 1).
    page.unroute(PLAN_SETTINGS)
    for route in held:
        route.continue_()
    # Wait for an idle moment and dispatch in the same task, so no write can
    # start between reading the count and the unload check.
    result = page.evaluate("""async () => {
        const sync = await import('/src/postgresSync.js');
        const deadline = Date.now() + 8000;
        while (sync.pendingWriteCount() !== 0 && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 50));
        }
        const pending = sync.pendingWriteCount();
        const e = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(e);
        return { pending, prevented: e.defaultPrevented };
    }""")
    assert result == {'pending': 0, 'prevented': False}, result


def test_chip_has_an_accessible_name_while_visible(app_page):
    page = app_page
    held = _hold_plan_settings(page)
    page.evaluate(_SAVE_JS)
    page.wait_for_selector('#saveStatusChip:not(.hidden)', timeout=5000)
    # The text is the name (it stays in the DOM even when visually hidden on phones).
    assert _text(page)
    assert page.locator('#saveStatus[role="status"]').count() == 1
    for _ in range(50):
        if held:
            break
        page.wait_for_timeout(100)
    held[0].continue_()
