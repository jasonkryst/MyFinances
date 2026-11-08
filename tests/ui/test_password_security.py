#!/usr/bin/env python3
"""
Password security UI (issue #456).

Settings -> Security (change password), the accessible strength meter, and the
login gate's setup/reset forms. Server responses are mocked with page.route;
the server-side rules and the HIBP check are covered by
server/test/passwordSecurity.test.js, and the pure rules by
tests/unit/passwordPolicy.test.js.
"""

import json

import pytest

from tests.conftest import (BASE_URL, ensure_session, open_settings, reset_server_state,
                            switch_settings_tab, wait_for_app_ready)

@pytest.fixture
def app_page(browser, stack_user):
    """Signed-in page on an empty server, with service workers blocked.

    These tests mock GET /auth/setup-status and /auth/password-policy with page.route. The app's
    service worker proxies same-origin GETs itself, which bypasses page.route, so it is blocked
    here (same approach as tests/features/test_code_splitting.py).
    """
    context = browser.new_context(service_workers='block')
    page = context.new_page()
    page.console_errors = []
    page.page_errors = []
    page.on('console', lambda m: page.console_errors.append(m.text or '')
            if m.type == 'error' and 'favicon' not in (m.text or '').lower() else None)
    page.on('pageerror', lambda e: page.page_errors.append(str(e)))
    page.on('dialog', lambda d: d.accept())
    ensure_session(context)
    page.goto(BASE_URL, wait_until='networkidle', timeout=60000)
    wait_for_app_ready(page)
    reset_server_state(page)
    yield page
    context.close()


STRONG = 'violet harbor lantern 42'


def _open_security_tab(page):
    open_settings(page)
    switch_settings_tab(page, 'security')
    page.wait_for_selector('#settingsPanel-security.settings-tab-panel--active')


def _mock_policy(page, breached_enabled=False):
    page.route('**/auth/password-policy', lambda route: route.fulfill(
        status=200, content_type='application/json',
        body=json.dumps({'minLength': 15, 'maxLength': 128, 'breachedCheckEnabled': breached_enabled})))


def _mock_change(page, status, body, calls):
    def handle(route):
        calls.append({'body': route.request.post_data_json, 'headers': route.request.headers})
        route.fulfill(status=status, content_type='application/json', body=json.dumps(body))
    page.route('**/auth/change-password', handle)


@pytest.fixture
def pg_page(app_page):
    """The signed-in page. The app is server-only (v7.0.0), so the Security
    form always shows; the name is kept from when a Postgres mode existed."""
    yield app_page


# ---------------------------------------------------------------- Security tab

@pytest.mark.ui
def test_security_tab_is_fifth_settings_tab(app_page):
    tabs = app_page.eval_on_selector_all('.settings-tab-btn', 'els => els.map(e => e.dataset.settingsTab)')
    assert tabs == ['appearance', 'data', 'notifications', 'advanced', 'security']
    btn = app_page.locator('[data-settings-tab="security"]')
    assert btn.get_attribute('role') == 'tab'
    assert btn.get_attribute('aria-controls') == 'settingsPanel-security'


@pytest.mark.ui
def test_security_tab_always_shows_form(pg_page):
    _mock_policy(pg_page)
    _open_security_tab(pg_page)
    assert pg_page.is_visible('#settingsChangePasswordForm')
    assert pg_page.locator('#settingsSecurityLocalNote').count() == 0
    assert pg_page.get_attribute('[data-settings-tab="security"]', 'aria-selected') == 'true'
    assert pg_page.get_attribute('#settingsCurrentPassword', 'autocomplete') == 'current-password'
    assert pg_page.get_attribute('#settingsNewPassword', 'autocomplete') == 'new-password'
    assert pg_page.get_attribute('#settingsConfirmPassword', 'autocomplete') == 'new-password'


@pytest.mark.ui
def test_breach_note_follows_server_policy(pg_page):
    _mock_policy(pg_page, breached_enabled=True)
    _open_security_tab(pg_page)
    pg_page.wait_for_selector('#settingsSecurityBreachNote:not(.hidden)')


@pytest.mark.ui
def test_breach_note_hidden_when_check_off(pg_page):
    _mock_policy(pg_page, breached_enabled=False)
    _open_security_tab(pg_page)
    pg_page.wait_for_timeout(200)
    assert not pg_page.is_visible('#settingsSecurityBreachNote')


# ---------------------------------------------------------------- strength meter

@pytest.mark.ui
def test_meter_is_text_not_only_colour(pg_page):
    _mock_policy(pg_page)
    _open_security_tab(pg_page)
    label = pg_page.locator('#settingsNewPasswordStrength')
    assert label.get_attribute('aria-live') == 'polite'
    described = pg_page.get_attribute('#settingsNewPassword', 'aria-describedby').split()
    assert 'settingsNewPasswordStrength' in described
    assert 'settingsNewPasswordStrengthHint' in described
    track = pg_page.locator('.pw-meter[data-for="settingsNewPassword"] .pw-meter-track')
    assert track.get_attribute('aria-hidden') == 'true'

    assert 'not entered yet' in label.inner_text()
    assert '15 characters' in pg_page.inner_text('#settingsNewPasswordStrengthHint')

    pg_page.fill('#settingsNewPassword', 'short')
    assert label.inner_text() == 'Password strength: Does not meet the rules'
    assert 'at least 15 characters' in pg_page.inner_text('#settingsNewPasswordStrengthHint')

    pg_page.fill('#settingsNewPassword', '123456789012345')
    assert 'repeated characters' in pg_page.inner_text('#settingsNewPasswordStrengthHint')

    pg_page.fill('#settingsNewPassword', 'Correct horse, battery staple 42!')
    assert label.inner_text() == 'Password strength: Strong'
    fill_cls = pg_page.get_attribute('.pw-meter[data-for="settingsNewPassword"] .pw-meter-fill', 'class')
    assert 'pw-meter-fill--4' in fill_cls


@pytest.mark.ui
def test_meter_flags_email_name_as_context(pg_page):
    _mock_policy(pg_page)
    pg_page.evaluate("() => { window.app.userEmail = 'budgetfan@example.com'; }")
    _open_security_tab(pg_page)
    pg_page.fill('#settingsNewPassword', 'budgetfan rules the world')
    assert 'email name' in pg_page.inner_text('#settingsNewPasswordStrengthHint')


@pytest.mark.ui
def test_meter_text_is_localized(pg_page):
    _mock_policy(pg_page)
    pg_page.evaluate("() => window.app.setLocale('es')")
    _open_security_tab(pg_page)
    pg_page.fill('#settingsNewPassword', 'short')
    assert pg_page.inner_text('#settingsNewPasswordStrength') == 'Seguridad de la contraseña: No cumple las reglas'
    pg_page.evaluate("() => window.app.setLocale('en')")


# ---------------------------------------------------------------- change password

@pytest.mark.ui
def test_change_password_success_sends_csrf_and_clears_fields(pg_page):
    _mock_policy(pg_page)
    calls = []
    _mock_change(pg_page, 200, {'ok': True}, calls)
    pg_page.context.add_cookies([{'name': 'csrf', 'value': 'tok123', 'url': BASE_URL}])
    _open_security_tab(pg_page)
    pg_page.fill('#settingsCurrentPassword', 'my old password here')
    pg_page.fill('#settingsNewPassword', STRONG)
    pg_page.fill('#settingsConfirmPassword', STRONG)
    pg_page.click('#settingsChangePasswordBtn')
    pg_page.wait_for_selector('#settingsChangePasswordStatus:has-text("Password changed")')
    assert calls[0]['body'] == {'currentPassword': 'my old password here', 'newPassword': STRONG}
    assert calls[0]['headers'].get('x-csrf-token') == 'tok123'
    for sel in ('#settingsCurrentPassword', '#settingsNewPassword', '#settingsConfirmPassword'):
        assert pg_page.input_value(sel) == ''
    assert 'not entered yet' in pg_page.inner_text('#settingsNewPasswordStrength')


@pytest.mark.ui
@pytest.mark.parametrize('current,new,confirm,expected', [
    ('', STRONG, STRONG, 'Enter your current password'),
    ('old password value', 'short', 'short', 'at least 15 characters'),
    ('old password value', STRONG, STRONG + 'x', 'do not match'),
    (STRONG, STRONG, STRONG, 'different from your current one'),
])
def test_change_password_client_validation_blocks_request(pg_page, current, new, confirm, expected):
    _mock_policy(pg_page)
    calls = []
    _mock_change(pg_page, 200, {'ok': True}, calls)
    _open_security_tab(pg_page)
    pg_page.fill('#settingsCurrentPassword', current)
    pg_page.fill('#settingsNewPassword', new)
    pg_page.fill('#settingsConfirmPassword', confirm)
    pg_page.click('#settingsChangePasswordBtn')
    assert expected in pg_page.inner_text('#settingsChangePasswordError')
    assert calls == []


@pytest.mark.ui
@pytest.mark.parametrize('status,body,expected', [
    (400, {'error': {'code': 'VALIDATION_FAILED', 'reason': 'PASSWORD_BREACHED', 'message': 'x'}}, 'known data breach'),
    (400, {'error': {'code': 'VALIDATION_FAILED', 'reason': 'PASSWORD_COMMON', 'message': 'x'}}, 'too common'),
    (400, {'error': {'code': 'INVALID_CURRENT_PASSWORD', 'message': 'x'}}, 'current password is incorrect'),
    (429, {'error': {'code': 'RATE_LIMITED', 'message': 'x'}}, 'Too many attempts'),
    (500, {}, 'Could not change the password'),
])
def test_change_password_server_errors_are_localized(pg_page, status, body, expected):
    _mock_policy(pg_page)
    calls = []
    _mock_change(pg_page, status, body, calls)
    _open_security_tab(pg_page)
    pg_page.fill('#settingsCurrentPassword', 'old password value')
    pg_page.fill('#settingsNewPassword', STRONG)
    pg_page.fill('#settingsConfirmPassword', STRONG)
    pg_page.click('#settingsChangePasswordBtn')
    pg_page.wait_for_selector(f'#settingsChangePasswordError:has-text("{expected}")')
    assert pg_page.inner_text('#settingsChangePasswordStatus') == ''
    assert pg_page.is_enabled('#settingsChangePasswordBtn')


@pytest.mark.ui
def test_breached_message_in_polish(pg_page):
    _mock_policy(pg_page)
    _mock_change(pg_page, 400, {'error': {'code': 'VALIDATION_FAILED', 'reason': 'PASSWORD_BREACHED'}}, [])
    pg_page.evaluate("() => window.app.setLocale('pl')")
    _open_security_tab(pg_page)
    pg_page.fill('#settingsCurrentPassword', 'old password value')
    pg_page.fill('#settingsNewPassword', STRONG)
    pg_page.fill('#settingsConfirmPassword', STRONG)
    pg_page.click('#settingsChangePasswordBtn')
    pg_page.wait_for_selector('#settingsChangePasswordError:has-text("wycieku danych")')
    pg_page.evaluate("() => window.app.setLocale('en')")


@pytest.mark.ui
def test_reopening_settings_wipes_typed_passwords(pg_page):
    _mock_policy(pg_page)
    _open_security_tab(pg_page)
    pg_page.fill('#settingsCurrentPassword', 'old password value')
    pg_page.fill('#settingsNewPassword', STRONG)
    pg_page.click('#settingsModalCloseBtn')
    pg_page.wait_for_selector('#settingsModal', state='hidden')
    _open_security_tab(pg_page)
    assert pg_page.input_value('#settingsCurrentPassword') == ''
    assert pg_page.input_value('#settingsNewPassword') == ''


# ---------------------------------------------------------------- login gate

def _show_gate(page, needs_setup, reset_token=None):
    page.route('**/auth/setup-status', lambda route: route.fulfill(
        status=200, content_type='application/json', body=json.dumps({'needsSetup': needs_setup})))
    _mock_policy(page)
    page.evaluate("""async (token) => {
        if (token) history.replaceState({}, '', '?reset_token=' + token);
        const lg = await import('/src/loginGate.js');
        lg.showLoginGate(window.app);  // resolves only on sign-in; don't await
    }""", reset_token)
    page.wait_for_selector('#loginGate:not(.hidden)')


@pytest.mark.ui
def test_sign_in_form_has_no_meter(app_page):
    _show_gate(app_page, needs_setup=False)
    app_page.fill('#loginGatePassword', 'anything at all here')
    assert app_page.locator('.pw-meter[data-for="loginGatePassword"]').count() == 0
    assert app_page.inner_text('#loginGateSubmit') == 'Sign In'


@pytest.mark.ui
def test_setup_form_has_meter_and_rejects_short_password_locally(app_page):
    calls = []
    app_page.route('**/auth/register', lambda route: (calls.append(1), route.fulfill(status=200, body='{}')))
    _show_gate(app_page, needs_setup=True)
    assert app_page.inner_text('#loginGateSubmit') == 'Create Account'
    app_page.wait_for_selector('.pw-meter[data-for="loginGatePassword"]')
    app_page.fill('#loginGateEmail', 'owner@example.com')
    app_page.fill('#loginGatePassword', 'fourteen chars')
    app_page.fill('#loginGateConfirm', 'fourteen chars')
    app_page.click('#loginGateSubmit')
    assert 'at least 15 characters' in app_page.inner_text('#loginGateError')
    assert calls == []


@pytest.mark.ui
def test_setup_shows_localized_breach_rejection(app_page):
    app_page.route('**/auth/register', lambda route: route.fulfill(
        status=400, content_type='application/json',
        body=json.dumps({'error': {'code': 'VALIDATION_FAILED', 'reason': 'PASSWORD_BREACHED', 'message': 'x'}})))
    app_page.evaluate("() => window.app.setLocale('es')")
    _show_gate(app_page, needs_setup=True)
    assert app_page.inner_text('#loginGateSubtitle') == 'Crea tu cuenta'
    app_page.fill('#loginGateEmail', 'owner@example.com')
    app_page.fill('#loginGatePassword', STRONG)
    app_page.fill('#loginGateConfirm', STRONG)
    app_page.click('#loginGateSubmit')
    app_page.wait_for_selector('#loginGateError:has-text("filtración de datos")')
    app_page.evaluate("() => window.app.setLocale('en')")


@pytest.mark.ui
def test_reset_form_has_meter_and_shows_policy_reason(app_page):
    app_page.route('**/auth/reset-password', lambda route: route.fulfill(
        status=400, content_type='application/json',
        body=json.dumps({'error': {'code': 'VALIDATION_FAILED', 'reason': 'PASSWORD_COMMON', 'message': 'x'}})))
    _show_gate(app_page, needs_setup=False, reset_token='abc123')
    app_page.wait_for_selector('#loginGateResetForm:not(.hidden)')
    app_page.wait_for_selector('.pw-meter[data-for="loginGateResetPassword"]')
    app_page.fill('#loginGateResetPassword', STRONG)
    app_page.fill('#loginGateResetConfirm', STRONG)
    app_page.click('#loginGateResetForm [type="submit"]')
    app_page.wait_for_selector('#loginGateResetError:has-text("too common")')
    app_page.evaluate("() => history.replaceState({}, '', location.pathname)")


@pytest.mark.ui
def test_reset_invalid_token_message(app_page):
    app_page.route('**/auth/reset-password', lambda route: route.fulfill(
        status=400, content_type='application/json',
        body=json.dumps({'error': {'code': 'INVALID_TOKEN', 'message': 'Invalid or expired reset link.'}})))
    _show_gate(app_page, needs_setup=False, reset_token='expired')
    app_page.wait_for_selector('#loginGateResetForm:not(.hidden)')
    app_page.fill('#loginGateResetPassword', STRONG)
    app_page.fill('#loginGateResetConfirm', STRONG)
    app_page.click('#loginGateResetForm [type="submit"]')
    app_page.wait_for_selector('#loginGateResetError:has-text("link may have expired")')
    app_page.evaluate("() => history.replaceState({}, '', location.pathname)")
