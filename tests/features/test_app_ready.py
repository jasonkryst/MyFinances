#!/usr/bin/env python3
"""
Issue #422: src/app.js sets <html data-app-ready="true"> once `await window.app.init()`
settles, and the app_page fixture waits for it, so tests stop racing app startup
(the source of most "window.app is undefined" flakes).
"""

import pytest

from tests.conftest import BASE_URL, SKIP_FIRST_RUN_WIZARD_SCRIPT, wait_for_app_ready


@pytest.mark.feature
def test_app_page_fixture_returns_initialized_app(app_page):
    page = app_page
    assert page.get_attribute('html', 'data-app-ready') == 'true'
    # init() has run: the post-init globals from the DOMContentLoaded handler exist.
    assert page.evaluate("() => !!window.app && typeof window.flushStorageSave === 'function'")


@pytest.mark.feature
def test_reload_waits_for_init(app_page):
    page = app_page
    page.evaluate("""() => {
        const d = JSON.parse(localStorage.getItem('debtTrackerData') || '{}');
        d.accounts = [{ id: 4220, name: 'Ready Check', type: 'Checking', startingBalance: 10 }];
        localStorage.setItem('debtTrackerData', JSON.stringify(d));
    }""")
    page.reload()
    # No explicit wait: the fixture's reload wrapper must already have waited for init.
    assert page.get_attribute('html', 'data-app-ready') == 'true'
    assert page.evaluate("() => window.app.accounts.some(a => a.name === 'Ready Check')")


@pytest.mark.feature
def test_marker_absent_until_app_script_runs(page):
    """Negative: the marker is set by the app, not present in the static HTML."""
    page.add_init_script(SKIP_FIRST_RUN_WIZARD_SCRIPT)
    page.route('**/src/app.js', lambda route: route.abort())
    page.goto(BASE_URL, wait_until='domcontentloaded')
    page.wait_for_timeout(500)
    assert page.get_attribute('html', 'data-app-ready') is None


@pytest.mark.feature
def test_marker_still_set_when_init_throws(page):
    """Negative: a failing init() must not leave waiters hanging until timeout."""
    page.add_init_script(SKIP_FIRST_RUN_WIZARD_SCRIPT)
    page.add_init_script("""
        Storage.prototype.getItem = function () { throw new Error('storage unavailable (test)'); };
    """)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE_URL, wait_until='domcontentloaded')
    # Startup failed, so window.app may be missing — wait on the marker alone.
    page.wait_for_selector('html[data-app-ready="true"]', state='attached', timeout=15000)
    assert errors, 'expected the simulated storage failure to surface as a page error'
