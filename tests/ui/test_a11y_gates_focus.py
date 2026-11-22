#!/usr/bin/env python3
"""
Focus and announcement fixes from the 7.21.0 accessibility batch.

- #464: the sign-in gate, the "Can't reach your server" gate and the legacy-data
  modal make the rest of <body> inert, so Tab/Shift+Tab never reach the app behind
  them, and remove `inert` again when they close.
- #491: after a mid-session sign-in, focus returns to the control that triggered it.
- #492 / #493: dismissing the save-error banner moves focus to <main>; its close
  button is at least 24x24 (44x44 on touch screens).
- #499: login and change-password errors are linked to the field at fault
  (aria-invalid + aria-describedby) and cleared when the field is edited.
- #502: no element combines role="alert" with aria-live="polite".
- #503: a repeat save failure re-announces the banner; a failed legacy import shows
  one alert, not two.

Contexts block the service worker so page.route() sees every request.
"""

import pytest
from playwright.sync_api import expect

from tests.conftest import (
    BASE_URL,
    TEST_EMAIL,
    TEST_PASSWORD,
    _http_json,
    _valid_session_cookies,
    ensure_session,
    open_settings_page,
    reset_server_state_http,
    wait_for_app_ready,
)

BANNER = '#syncErrorBanner'

# True when focus is on <body> (past the last control, on its way to the browser
# chrome) or inside the overlay; anything else means Tab escaped.
_FOCUS_INSIDE_JS = """(sel) => {
    const a = document.activeElement;
    if (!a || a === document.body || a === document.documentElement) return true;
    return !!document.querySelector(sel)?.contains(a);
}"""

_FOCUS_DESC_JS = """() => {
    const a = document.activeElement;
    return a ? (a.id ? '#' + a.id : a.tagName + '.' + a.className) : 'null';
}"""

# Body children that are inert, other than the given overlay.
_INERT_JS = """(sel) => Array.from(document.body.children)
    .filter(el => el.hasAttribute('inert')).map(el => el.id || el.className || el.tagName)"""


def _assert_tab_stays_inside(page, sel, presses=14):
    for shift in (False, True):
        for _ in range(presses):
            page.keyboard.press('Shift+Tab' if shift else 'Tab')
            assert page.evaluate(_FOCUS_INSIDE_JS, sel), (
                f"{'Shift+' if shift else ''}Tab left {sel}: focus on {page.evaluate(_FOCUS_DESC_JS)}")


def _assert_background_inert(page, sel):
    inert = page.evaluate(_INERT_JS, sel)
    assert 'container' in inert, inert
    assert 'skip-link' in inert, inert
    assert not page.evaluate("(sel) => document.querySelector(sel).closest('[inert]') !== null", sel)


def _assert_nothing_inert(page):
    assert page.evaluate("() => document.querySelectorAll('[inert]').length") == 0


@pytest.fixture
def blocked_context(browser, stack_user):
    """Signed-in context on an empty server, service worker blocked, not yet loaded."""
    reset_server_state_http()
    context = browser.new_context(service_workers='block')
    ensure_session(context)
    yield context
    context.close()


@pytest.fixture
def signed_in_page(blocked_context):
    page = blocked_context.new_page()
    page.on('dialog', lambda d: d.accept())
    page.goto(BASE_URL, wait_until='domcontentloaded')
    wait_for_app_ready(page)
    page.wait_for_function("() => window.app && window.app._currentPage === 'health'", timeout=30000)
    # A first run opens the setup wizard on an empty server; close it.
    if page.locator('#setupWizardModal:not(.hidden)').count():
        page.click('#setupWizardVisibleBtn')
    return page


def _sign_in(page):
    page.fill('#loginGateEmail', TEST_EMAIL)
    page.fill('#loginGatePassword', TEST_PASSWORD)
    page.click('#loginGateSubmit')
    expect(page.locator('#loginGate')).to_be_hidden(timeout=15000)


# ---------------------------------------------------------------------------
# #464: focus containment
# ---------------------------------------------------------------------------

@pytest.mark.ui
def test_login_gate_at_boot_keeps_tab_inside(browser, stack_user):
    context = browser.new_context(service_workers='block')  # no session: boot shows the gate
    try:
        page = context.new_page()
        page.goto(BASE_URL, wait_until='domcontentloaded')
        expect(page.locator('#loginGate')).to_be_visible(timeout=30000)
        _assert_background_inert(page, '#loginGate')
        _assert_tab_stays_inside(page, '#loginGate')
        _sign_in(page)
        wait_for_app_ready(page)
        page.wait_for_function("() => window.app && window.app._currentPage === 'health'", timeout=30000)
        _assert_nothing_inert(page)
    finally:
        context.close()


@pytest.mark.ui
def test_unreachable_gate_keeps_tab_inside_and_releases(blocked_context):
    page = blocked_context.new_page()
    state = {'down': True}
    page.route('**/api/plan-settings',
               lambda r: r.abort() if state['down'] and r.request.method == 'GET' else r.continue_())
    page.goto(BASE_URL, wait_until='domcontentloaded')
    expect(page.locator('#serverUnreachableGate')).to_be_visible(timeout=30000)
    _assert_background_inert(page, '#serverUnreachableGate')
    _assert_tab_stays_inside(page, '#serverUnreachableGate')
    state['down'] = False
    page.click('#serverUnreachableRetryBtn')
    expect(page.locator('#serverUnreachableGate')).to_be_hidden(timeout=30000)
    page.wait_for_function("() => window.app && window.app._currentPage === 'health'", timeout=30000)
    _assert_nothing_inert(page)


LEGACY = (
    '{"debts":[{"id":1,"name":"Legacy Debt","debtType":"creditCard","accountBalance":1000,'
    '"interestRate":15,"minimumPayment":50,"dueDate":1}]}'
)


@pytest.fixture
def legacy_page(blocked_context):
    cookies = {c['name']: c['value'] for c in _valid_session_cookies()}
    status, _, _ = _http_json('DELETE', '/api/settings/reconciliationAdjustsBalance', cookies=cookies)
    assert status < 300, status
    page = blocked_context.new_page()
    page.on('dialog', lambda d: d.accept())
    page.goto(BASE_URL + '/guide.html', wait_until='domcontentloaded')
    page.evaluate("v => localStorage.setItem('debtTrackerData', v)", LEGACY)
    page.goto(BASE_URL, wait_until='domcontentloaded')
    expect(page.locator('#pgMigrationModal')).to_be_visible(timeout=30000)
    return page


@pytest.mark.ui
def test_legacy_modal_keeps_tab_inside_and_releases(legacy_page):
    page = legacy_page
    _assert_background_inert(page, '#pgMigrationModal')
    _assert_tab_stays_inside(page, '#pgMigrationModal')
    page.click('#pgMigrationTransferBtn')
    expect(page.locator('#pgMigrationModal')).to_be_hidden(timeout=30000)
    page.wait_for_function("() => window.app && window.app._currentPage === 'health'", timeout=30000)
    _assert_nothing_inert(page)


@pytest.mark.ui
def test_failed_legacy_import_shows_one_alert(legacy_page):
    """#503: the modal's own error reports the failure; the save banner stays hidden."""
    page = legacy_page
    page.route('**/api/debts', lambda r: r.fulfill(status=500, body='{}', content_type='application/json')
               if r.request.method == 'POST' else r.continue_())
    page.click('#pgMigrationTransferBtn')
    expect(page.locator('#pgMigrationError')).to_be_visible(timeout=30000)
    expect(page.locator(BANNER)).to_be_hidden()
    # Still contained after the failure (focus went back to Transfer).
    _assert_tab_stays_inside(page, '#pgMigrationModal', presses=6)


@pytest.mark.ui
def test_stacked_overlays_release_in_order(signed_in_page):
    """A gate opened over another overlay must not un-inert what the first one set."""
    page = signed_in_page
    result = page.evaluate("""async () => {
        const m = await import('/src/overlayFocus.js');
        const a = document.getElementById('pgMigrationModal');
        const b = document.getElementById('loginGate');
        const releaseA = m.makeBackgroundInert(a);
        const releaseB = m.makeBackgroundInert(b);
        const aInertUnderB = a.hasAttribute('inert');
        releaseB();
        const containerStillInert = document.querySelector('.container').hasAttribute('inert');
        const aFreed = !a.hasAttribute('inert');
        releaseA();
        return { aInertUnderB, containerStillInert, aFreed,
                 left: document.querySelectorAll('[inert]').length };
    }""")
    assert result == {'aInertUnderB': True, 'containerStillInert': True, 'aFreed': True, 'left': 0}


# ---------------------------------------------------------------------------
# #491: focus restored after a mid-session sign-in
# ---------------------------------------------------------------------------

@pytest.mark.ui
def test_focus_returns_after_mid_session_login(signed_in_page):
    page = signed_in_page
    calls = {'n': 0}

    def debts(route):
        if route.request.method == 'POST' and calls['n'] == 0:
            calls['n'] += 1
            route.fulfill(status=401, body='{}', content_type='application/json')
        else:
            route.continue_()

    page.route('**/api/debts', debts)
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    if page.locator('#debtFormBody[hidden]').count():
        page.click('#debtFormToggle')
    page.fill('#debtName', 'Focus Debt')
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', '500')
    page.fill('#interestRate', '18')
    page.fill('#minimumPayment', '25')
    page.fill('#dueDate', '15')
    page.focus('#debtFormSubmit')
    page.keyboard.press('Enter')  # submit-no-wait: the 401 opens the sign-in gate; the retry finishes below
    expect(page.locator('#loginGate')).to_be_visible(timeout=15000)
    assert page.evaluate("() => document.querySelector('.container').hasAttribute('inert')")
    _sign_in(page)
    expect(page.locator('#debtsList')).to_contain_text('Focus Debt', timeout=10000)
    # The retried save succeeded and the Add Debt form collapsed, hiding Submit,
    # so focus goes to the toggle that owns the form, never to <body>.
    page.wait_for_function("() => document.activeElement && document.activeElement.id === 'debtFormToggle'",
                           timeout=15000)
    _assert_nothing_inert(page)


@pytest.mark.ui
def test_focus_returns_to_visible_control_after_login(signed_in_page):
    """The control is still shown after sign-in, so focus goes straight back to it."""
    page = signed_in_page
    page.route('**/auth/change-password',
               lambda r: r.fulfill(status=401, body='{}', content_type='application/json'))
    open_settings_page(page, 'security')
    page.fill('#settingsCurrentPassword', 'current-Passphrase-1!')
    page.fill('#settingsNewPassword', 'a-Brand-New-Passphrase-2026!')
    page.fill('#settingsConfirmPassword', 'a-Brand-New-Passphrase-2026!')
    page.focus('#settingsChangePasswordBtn')
    page.keyboard.press('Enter')
    expect(page.locator('#loginGate')).to_be_visible(timeout=15000)
    # Settings sits under the gate and is inert too.
    assert page.evaluate("() => document.getElementById('settingsModal').hasAttribute('inert')")
    _assert_tab_stays_inside(page, '#loginGate', presses=6)
    page.unroute('**/auth/change-password')
    _sign_in(page)
    page.wait_for_function(
        "() => document.activeElement && document.activeElement.id === 'settingsChangePasswordBtn'", timeout=15000)
    _assert_nothing_inert(page)


@pytest.mark.ui
def test_restore_focus_falls_back_when_control_hidden(signed_in_page):
    """A control hidden by the time it's ready hands focus to the toggle that owns it."""
    page = signed_in_page
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    if page.locator('#debtFormBody[hidden]').count():
        page.click('#debtFormToggle')
    result = page.evaluate("""async () => {
        const m = await import('/src/overlayFocus.js');
        const btn = document.getElementById('debtFormSubmit');
        document.activeElement && document.activeElement.blur();
        document.getElementById('debtFormToggle').click();  // collapse the form
        const ok = await m.restoreFocus(btn, { waitMs: 500 });
        return { ok, active: document.activeElement.id };
    }""")
    assert result == {'ok': True, 'active': 'debtFormToggle'}


@pytest.mark.ui
def test_restore_focus_skips_when_user_moved_on(signed_in_page):
    """Negative: focus is not yanked back once the user has focused something else."""
    page = signed_in_page
    restored = page.evaluate("""async () => {
        const m = await import('/src/overlayFocus.js');
        const target = document.getElementById('commandPaletteBtn');
        const other = document.querySelector('button[data-page="accounts"]');
        other.focus();
        const ok = await m.restoreFocus(target, { waitMs: 200 });
        return { ok, active: document.activeElement === other };
    }""")
    assert restored == {'ok': False, 'active': True}


@pytest.mark.ui
def test_restore_focus_waits_for_reenable(signed_in_page):
    page = signed_in_page
    restored = page.evaluate("""async () => {
        const m = await import('/src/overlayFocus.js');
        const btn = document.getElementById('commandPaletteBtn');
        document.activeElement && document.activeElement.blur();
        btn.disabled = true;
        const p = m.restoreFocus(btn, { waitMs: 3000 });
        setTimeout(() => { btn.disabled = false; }, 200);
        const ok = await p;
        return { ok, active: document.activeElement === btn };
    }""")
    assert restored == {'ok': True, 'active': True}


# ---------------------------------------------------------------------------
# #492 / #493 / #503: the save-error banner
# ---------------------------------------------------------------------------

def _fail_plan_settings(page):
    page.route('**/api/plan-settings', lambda r: r.fulfill(status=500, body='{}', content_type='application/json')
               if r.request.method == 'PATCH' else r.continue_())


@pytest.mark.ui
def test_dismiss_banner_moves_focus_to_main(signed_in_page):
    page = signed_in_page
    _fail_plan_settings(page)
    page.evaluate("() => window.app.saveToStorage(['ledgerSettings'])")
    page.wait_for_selector(BANNER + ':visible', timeout=10000)
    page.focus('#syncErrorBannerDismiss')
    page.keyboard.press('Enter')
    expect(page.locator(BANNER)).to_be_hidden()
    assert page.evaluate("() => document.activeElement && document.activeElement.id") == 'main'


@pytest.mark.ui
def test_hide_banner_leaves_focus_alone_when_not_inside(signed_in_page):
    """Negative: a banner hidden while focus is elsewhere doesn't move focus."""
    page = signed_in_page
    active = page.evaluate("""async () => {
        const ui = await import('/src/ui.js');
        const banner = document.getElementById('syncErrorBanner');
        banner.classList.remove('hidden');
        const btn = document.getElementById('commandPaletteBtn');
        btn.focus();
        ui.hideBanner(banner);
        return document.activeElement.id;
    }""")
    assert active == 'commandPaletteBtn'


@pytest.mark.ui
def test_banner_dismiss_target_size(signed_in_page):
    page = signed_in_page
    page.evaluate("() => document.getElementById('syncErrorBanner').classList.remove('hidden')")
    box = page.locator('#syncErrorBannerDismiss').bounding_box()
    assert box['width'] >= 24 and box['height'] >= 24, box


@pytest.mark.ui
def test_banner_dismiss_target_size_touch(browser, stack_user):
    context = browser.new_context(service_workers='block', has_touch=True, is_mobile=True,
                                  viewport={'width': 390, 'height': 844})
    try:
        ensure_session(context)
        page = context.new_page()
        page.goto(BASE_URL, wait_until='domcontentloaded')
        wait_for_app_ready(page)
        assert page.evaluate("() => matchMedia('(pointer: coarse)').matches")
        page.evaluate("() => document.getElementById('syncErrorBanner').classList.remove('hidden')")
        box = page.locator('#syncErrorBannerDismiss').bounding_box()
        assert box['width'] >= 44 and box['height'] >= 44, box
    finally:
        context.close()


@pytest.mark.ui
def test_repeat_failure_reannounces_banner(signed_in_page):
    page = signed_in_page
    _fail_plan_settings(page)
    page.evaluate("() => window.app.saveToStorage(['ledgerSettings'])")
    page.wait_for_selector(BANNER + ':visible', timeout=10000)
    page.evaluate("""() => {
        window.__bannerTexts = [];
        const el = document.querySelector('#syncErrorBanner .sync-error-banner-text');
        new MutationObserver(() => window.__bannerTexts.push(el.textContent))
            .observe(el, { childList: true, characterData: true, subtree: true });
    }""")
    page.evaluate("() => window.app.saveToStorage(['ledgerSettings'])")
    page.wait_for_function("() => window.__bannerTexts.length >= 2", timeout=10000)
    texts = page.evaluate("() => window.__bannerTexts")
    assert texts[0] == '' and texts[-1] != '', texts


@pytest.mark.ui
def test_banner_suppressed_while_legacy_modal_open(signed_in_page):
    page = signed_in_page
    shown = page.evaluate("""async () => {
        const ui = await import('/src/ui.js');
        const modal = document.getElementById('pgMigrationModal');
        modal.classList.remove('hidden');
        ui.showSyncErrorBanner();
        const whileOpen = !document.getElementById('syncErrorBanner').classList.contains('hidden');
        modal.classList.add('hidden');
        ui.showSyncErrorBanner();
        const afterClose = !document.getElementById('syncErrorBanner').classList.contains('hidden');
        return { whileOpen, afterClose };
    }""")
    assert shown == {'whileOpen': False, 'afterClose': True}


# ---------------------------------------------------------------------------
# #502: no conflicting politeness
# ---------------------------------------------------------------------------

@pytest.mark.ui
def test_no_alert_with_polite_live(signed_in_page):
    bad = signed_in_page.evaluate("""() => Array.from(document.querySelectorAll('[role="alert"][aria-live]'))
        .filter(el => el.getAttribute('aria-live') !== 'assertive').map(el => el.id || el.className)""")
    assert bad == []


# ---------------------------------------------------------------------------
# #499: errors linked to their fields
# ---------------------------------------------------------------------------

def _described_by(page, sel):
    return (page.get_attribute(sel, 'aria-describedby') or '').split()


@pytest.mark.ui
def test_login_error_linked_to_password(browser, stack_user):
    context = browser.new_context(service_workers='block')
    try:
        page = context.new_page()
        page.goto(BASE_URL, wait_until='domcontentloaded')
        expect(page.locator('#loginGate')).to_be_visible(timeout=30000)
        # Negative first: nothing is marked before an error.
        assert page.get_attribute('#loginGatePassword', 'aria-invalid') is None
        page.route('**/auth/login', lambda r: r.fulfill(status=401, body='{}', content_type='application/json'))
        page.fill('#loginGateEmail', TEST_EMAIL)
        page.fill('#loginGatePassword', 'wrong-password')
        page.click('#loginGateSubmit')
        expect(page.locator('#loginGateError')).not_to_be_empty(timeout=10000)
        assert page.get_attribute('#loginGatePassword', 'aria-invalid') == 'true'
        assert 'loginGateError' in _described_by(page, '#loginGatePassword')
        # The email isn't blamed: the message doesn't say which was wrong.
        assert page.get_attribute('#loginGateEmail', 'aria-invalid') is None
        # Editing the field clears the link.
        page.type('#loginGatePassword', 'x')
        assert page.get_attribute('#loginGatePassword', 'aria-invalid') is None
        assert 'loginGateError' not in _described_by(page, '#loginGatePassword')
    finally:
        context.close()


@pytest.mark.ui
def test_login_rate_limit_marks_no_field(browser, stack_user):
    """Negative: a 429 isn't about a field, so none is marked invalid."""
    context = browser.new_context(service_workers='block')
    try:
        page = context.new_page()
        page.goto(BASE_URL, wait_until='domcontentloaded')
        expect(page.locator('#loginGate')).to_be_visible(timeout=30000)
        page.route('**/auth/login', lambda r: r.fulfill(status=429, body='{}', content_type='application/json'))
        page.fill('#loginGateEmail', TEST_EMAIL)
        page.fill('#loginGatePassword', 'whatever-password')
        page.click('#loginGateSubmit')
        expect(page.locator('#loginGateError')).not_to_be_empty(timeout=10000)
        assert page.get_attribute('#loginGatePassword', 'aria-invalid') is None
        assert page.get_attribute('#loginGateEmail', 'aria-invalid') is None
    finally:
        context.close()


@pytest.mark.ui
def test_change_password_mismatch_marks_confirm(signed_in_page):
    page = signed_in_page
    open_settings_page(page, 'security')
    page.fill('#settingsCurrentPassword', 'current-Passphrase-1!')
    page.fill('#settingsNewPassword', 'a-Brand-New-Passphrase-2026!')
    page.fill('#settingsConfirmPassword', 'something-else-entirely-2026!')
    page.click('#settingsChangePasswordBtn')
    expect(page.locator('#settingsChangePasswordError')).not_to_be_empty()
    assert page.get_attribute('#settingsConfirmPassword', 'aria-invalid') == 'true'
    assert 'settingsChangePasswordError' in _described_by(page, '#settingsConfirmPassword')
    # The new password is fine, so it isn't marked; its strength-meter links survive.
    assert page.get_attribute('#settingsNewPassword', 'aria-invalid') is None
    assert 'settingsNewPasswordStrengthHint' in _described_by(page, '#settingsNewPassword')
    page.fill('#settingsConfirmPassword', 'a-Brand-New-Passphrase-2026!')
    assert page.get_attribute('#settingsConfirmPassword', 'aria-invalid') is None


@pytest.mark.ui
def test_change_password_weak_marks_new_password(signed_in_page):
    page = signed_in_page
    open_settings_page(page, 'security')
    page.fill('#settingsCurrentPassword', 'current-Passphrase-1!')
    page.fill('#settingsNewPassword', 'short')
    page.fill('#settingsConfirmPassword', 'short')
    page.click('#settingsChangePasswordBtn')
    expect(page.locator('#settingsChangePasswordError')).not_to_be_empty()
    assert page.get_attribute('#settingsNewPassword', 'aria-invalid') == 'true'
    ids = _described_by(page, '#settingsNewPassword')
    assert 'settingsChangePasswordError' in ids and 'settingsNewPasswordStrengthHint' in ids
    assert page.get_attribute('#settingsConfirmPassword', 'aria-invalid') is None


@pytest.mark.ui
def test_change_password_missing_current_marks_current(signed_in_page):
    page = signed_in_page
    open_settings_page(page, 'security')
    page.click('#settingsChangePasswordBtn')
    expect(page.locator('#settingsChangePasswordError')).not_to_be_empty()
    assert page.get_attribute('#settingsCurrentPassword', 'aria-invalid') == 'true'
    # Re-opening Settings clears it.
    page.keyboard.press('Escape')
    open_settings_page(page, 'security')
    assert page.get_attribute('#settingsCurrentPassword', 'aria-invalid') is None
