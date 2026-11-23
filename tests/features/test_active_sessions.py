"""#683: Settings -> Security -> Active sessions.

The page lists every browser signed in to the account, marks this one, signs
out a single other session or all of them, and a signed-out browser lands on
the login gate on its next request. The Notifications page has a switch for
the new-device sign-in email (notifyNewSignIn, on by default).
"""
import pytest

from tests.conftest import (
    BASE_URL, TEST_EMAIL, TEST_PASSWORD, open_settings_page, wait_for_api, wait_for_app_ready,
)

FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0'
SAFARI_IPHONE = ('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 '
                 '(KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1')


def _sign_out_others(page):
    """Starts each test from a single session (this page's): earlier tests and
    processes may have left sessions for the shared test user."""
    status = page.evaluate("""async () => {
        const { getCsrfCookie } = await import('/src/storage.js');
        const res = await fetch('/api/sessions?others=1', { method: 'DELETE', headers: { 'X-CSRF-Token': getCsrfCookie() } });
        await res.text();
        return res.status;
    }""")
    assert status == 200


def _other_session(playwright_browser, user_agent):
    """A second signed-in browser with its own session and User-Agent."""
    context = playwright_browser.new_context(user_agent=user_agent, base_url=BASE_URL)
    res = context.request.post('auth/login', data={'email': TEST_EMAIL, 'password': TEST_PASSWORD})
    assert res.ok, res.text()
    return context


def _probe(context):
    return context.request.get('api/plan-settings').status


def _rows(page):
    return page.locator('#settingsSessionsList > li')


def _show_security(page):
    open_settings_page(page, 'security')
    page.wait_for_selector('#settingsSessionsList > li')


@pytest.mark.feature
def test_lists_only_this_browser_with_controls_disabled(app_page):
    page = app_page
    _sign_out_others(page)
    _show_security(page)
    rows = _rows(page)
    assert rows.count() == 1
    assert rows.first.locator('.settings-session-badge').inner_text() == 'This device'
    assert rows.first.locator('.settings-session-signout').count() == 0, 'no Sign out on the current session'
    assert page.is_disabled('#settingsSignOutOthersBtn')
    assert page.inner_text('#settingsSessionsSummary') == 'Only this browser is signed in.'
    assert 'Last active' in rows.first.inner_text()


@pytest.mark.feature
def test_sign_out_one_session_sends_it_to_the_login_gate(app_page, browser):
    page = app_page
    _sign_out_others(page)
    other = _other_session(browser, FIREFOX_LINUX)
    try:
        # The other browser opens the app signed in.
        other_page = other.new_page()
        other_page.goto(BASE_URL)
        wait_for_app_ready(other_page)
        assert other_page.is_hidden('#loginGate')

        _show_security(page)
        assert _rows(page).count() == 2
        assert page.inner_text('#settingsSessionsSummary') == '1 other session is signed in.'
        btn = page.get_by_role('button', name='Sign out Firefox on Linux')
        btn.click()
        page.wait_for_function("document.querySelectorAll('#settingsSessionsList > li').length === 1")
        assert page.inner_text('#settingsSessionsStatus') == 'Signed out Firefox on Linux.'
        assert _probe(other) == 401

        # Its next load shows the login gate.
        other_page.reload()
        other_page.wait_for_selector('#loginGateEmail', state='visible')
        # This browser is still signed in.
        assert page.evaluate("fetch('/api/plan-settings').then(r => r.text().then(() => r.status))") == 200
    finally:
        other.close()


@pytest.mark.feature
def test_sign_out_all_other_sessions(app_page, browser):
    page = app_page
    _sign_out_others(page)
    others = [_other_session(browser, FIREFOX_LINUX), _other_session(browser, SAFARI_IPHONE)]
    try:
        _show_security(page)
        assert _rows(page).count() == 3
        assert page.inner_text('#settingsSessionsSummary') == '2 other sessions are signed in.'
        page.click('#settingsSignOutOthersBtn')
        page.wait_for_function("document.querySelectorAll('#settingsSessionsList > li').length === 1")
        assert page.inner_text('#settingsSessionsStatus') == 'Signed out 2 other sessions.'
        assert page.is_disabled('#settingsSignOutOthersBtn')
        assert [_probe(c) for c in others] == [401, 401]
    finally:
        for c in others:
            c.close()


@pytest.mark.feature
def test_session_revoked_elsewhere_is_handled_quietly(app_page, browser):
    """A session already gone (signed out from another device) just refreshes the list."""
    page = app_page
    _sign_out_others(page)
    other = _other_session(browser, FIREFOX_LINUX)
    try:
        _show_security(page)
        assert _rows(page).count() == 2
        # Gone before the click: the other browser signs itself out.
        csrf = next(c['value'] for c in other.cookies() if c['name'] == 'csrf')
        assert other.request.post('auth/logout', headers={'X-CSRF-Token': csrf}).ok
        page.get_by_role('button', name='Sign out Firefox on Linux').click()
        page.wait_for_function("document.querySelectorAll('#settingsSessionsList > li').length === 1")
        assert page.inner_text('#settingsSessionsError') == ''
    finally:
        other.close()


@pytest.mark.feature
def test_new_sign_in_email_switch_defaults_on_and_saves(app_page):
    page = app_page
    open_settings_page(page, 'notifications')
    box = page.locator('#settingNotifyNewSignIn')
    assert box.is_checked(), 'on by default'
    box.click()
    wait_for_api(page, '/api/settings',
                 lambda rows: any(r.get('key') == 'notifyNewSignIn' and r.get('value') is False for r in rows))
    assert not box.is_checked()
