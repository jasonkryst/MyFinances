"""#461: every fetch response the app gets is read or discarded.

The API sends `Cache-Control: no-store`; an unread body keeps its connection
pending, which once stalled every first-run boot short of Playwright's
`networkidle`. A wrapper installed before boot records each response with a
body, and the flows that used to leave bodies unread (sign-in failure,
sign-out, sign-in, the calendar dialog) are checked for leftovers.
"""
import re

import pytest

from tests.conftest import BASE_URL, TEST_EMAIL, TEST_PASSWORD, ensure_session, wait_for_app_ready

pytestmark = pytest.mark.feature

TRACK_JS = """
(() => {
    const orig = window.fetch;
    window.__responses = [];
    window.fetch = async (...args) => {
        const res = await orig(...args);
        const url = String(args[0] && args[0].url ? args[0].url : args[0]);
        window.__responses.push({ url, status: res.status, res });
        return res;
    };
})();
"""

# Unread = has a body (not 204/HEAD) and nothing consumed it.
UNREAD_JS = """() => (window.__responses || [])
    .filter(r => r.res.body !== null && !r.res.bodyUsed)
    .map(r => r.status + ' ' + r.url)"""


def _new_page(browser):
    context = browser.new_context(service_workers='block')
    ensure_session(context)
    page = context.new_page()
    page.add_init_script(TRACK_JS)
    return context, page


def _unread(page):
    page.wait_for_timeout(500)  # let fire-and-forget readers finish
    return page.evaluate(UNREAD_JS)


def test_boot_and_calendar_dialog_read_every_body(browser):
    context, page = _new_page(browser)
    try:
        page.goto(BASE_URL)
        wait_for_app_ready(page)
        page.click('#accountMenuBtn')
        page.click('#accountMenuCalendarFeedBtn')
        page.wait_for_timeout(800)
        assert _unread(page) == []
        assert page.evaluate('window.__responses.length') > 5, 'the tracker saw no traffic'
    finally:
        context.close()


def test_sign_out_and_back_in_leaves_no_body_unread_and_reaches_network_idle(browser):
    context, page = _new_page(browser)
    try:
        page.goto(BASE_URL)
        wait_for_app_ready(page)
        # Sign out: a full reload into the sign-in gate.
        page.click('#accountMenuBtn')
        with page.expect_navigation():
            page.click('#accountMenuLogoutBtn')
        wait_for_app_ready(page)
        page.wait_for_selector('#loginGate', state='visible', timeout=10000)

        # Negative path: a wrong password is answered (401) and its body read.
        page.fill('#loginGateEmail', TEST_EMAIL)
        page.fill('#loginGatePassword', 'definitely-not-the-password')
        page.click('#loginGateSubmit')
        page.wait_for_function("() => document.getElementById('loginGateError').textContent.trim() !== ''")
        assert _unread(page) == []

        # Sign in for real; the page must settle to network idle (#461).
        page.fill('#loginGatePassword', TEST_PASSWORD)
        page.click('#loginGateSubmit')
        page.wait_for_selector('#loginGate', state='hidden', timeout=15000)
        page.wait_for_load_state('networkidle', timeout=15000)
        unread = _unread(page)
        assert unread == [], unread
        statuses = page.evaluate("() => window.__responses.map(r => r.status + ' ' + r.url)")
        assert any(re.search(r'^401 .*/auth/login$', s) for s in statuses), statuses
        assert any(re.search(r'^200 .*/auth/login$', s) for s in statuses), statuses
    finally:
        context.close()


def test_tracker_reports_an_unread_body(browser):
    """Negative control: a response nobody reads is reported."""
    context, page = _new_page(browser)
    try:
        page.goto(BASE_URL)
        wait_for_app_ready(page)
        page.evaluate("async () => { await fetch('/auth/password-policy'); }")
        assert any('/auth/password-policy' in u for u in _unread(page))
    finally:
        context.close()
