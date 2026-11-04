"""Persistent sync-error banner (v7.0.0, spec section 6).

A failed save used to show a 5-second toast; the user could believe an edit
was saved when it was not. The banner stays until dismissed, is never stacked,
and a 401 shows the login gate instead.
"""
import pytest

from tests.conftest import BASE_URL, ensure_session, reset_server_state, wait_for_app_ready

BANNER = '#syncErrorBanner'
EN_TEXT = "Couldn't save your last change — check your connection. Reload to see what's saved."


@pytest.fixture
def app_page(browser, stack_user):
    """Signed-in page on an empty server, service worker blocked so page.route() is in charge."""
    context = browser.new_context(service_workers='block')
    page = context.new_page()
    page.on('dialog', lambda d: d.accept())
    ensure_session(context)
    page.goto(BASE_URL, wait_until='networkidle', timeout=60000)
    wait_for_app_ready(page)
    reset_server_state(page)
    yield page
    context.close()


def _add_debt(page, name):
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_selector('[data-liabilities-subtab="debts"].active', timeout=5000)
    if page.locator('#debtFormBody[hidden]').count():
        page.click('#debtFormToggle')
    page.wait_for_selector('#debtFormBody:not([hidden])', timeout=5000)
    page.fill('#debtName', name)
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', '500')
    page.fill('#interestRate', '18')
    page.fill('#minimumPayment', '25')
    page.fill('#dueDate', '15')
    page.click('#debtFormSubmit')


@pytest.mark.feature
def test_mutation_500_shows_sync_banner(app_page):
    page = app_page
    page.route('**/api/debts', lambda r: r.fulfill(status=500, body='{}', content_type='application/json')
               if r.request.method == 'POST' else r.continue_())
    _add_debt(page, 'Fail Debt')
    page.wait_for_selector(BANNER + ':visible', timeout=10000)
    assert EN_TEXT in page.inner_text(BANNER)
    assert page.get_attribute(BANNER, 'role') == 'alert'


@pytest.mark.feature
def test_mutation_network_error_shows_sync_banner(app_page):
    page = app_page
    page.route('**/api/debts', lambda r: r.abort() if r.request.method == 'POST' else r.continue_())
    _add_debt(page, 'Abort Debt')
    page.wait_for_selector(BANNER + ':visible', timeout=10000)


@pytest.mark.feature
def test_plan_settings_patch_failure_shows_banner(app_page):
    page = app_page
    page.route('**/api/plan-settings', lambda r: r.fulfill(status=500, body='{}', content_type='application/json')
               if r.request.method == 'PATCH' else r.continue_())
    page.evaluate("() => window.app.saveToStorage()")
    page.wait_for_selector(BANNER + ':visible', timeout=10000)


@pytest.mark.feature
def test_banner_not_stacked_and_persistent(app_page):
    page = app_page
    page.route('**/api/plan-settings', lambda r: r.fulfill(status=500, body='{}', content_type='application/json')
               if r.request.method == 'PATCH' else r.continue_())
    page.evaluate("async () => { await window.app.saveToStorage(); await window.app.saveToStorage(); }")
    page.wait_for_selector(BANNER + ':visible', timeout=10000)
    assert page.locator(BANNER).count() == 1
    page.wait_for_timeout(6000)  # the old toast vanished after 5s
    assert page.is_visible(BANNER)


@pytest.mark.feature
def test_banner_dismiss_and_reappears(app_page):
    page = app_page
    page.route('**/api/plan-settings', lambda r: r.fulfill(status=500, body='{}', content_type='application/json')
               if r.request.method == 'PATCH' else r.continue_())
    page.evaluate("() => window.app.saveToStorage()")
    page.wait_for_selector(BANNER + ':visible', timeout=10000)
    assert page.get_attribute('#syncErrorBannerDismiss', 'aria-label')
    page.click('#syncErrorBannerDismiss')
    assert not page.is_visible(BANNER)
    page.evaluate("() => window.app.saveToStorage()")
    page.wait_for_selector(BANNER + ':visible', timeout=10000)


@pytest.mark.feature
def test_mutation_401_shows_login_gate_not_banner(app_page):
    page = app_page
    page.route('**/api/debts', lambda r: r.fulfill(status=401, body='{}', content_type='application/json')
               if r.request.method == 'POST' else r.continue_())
    _add_debt(page, 'Gate Debt')
    page.wait_for_selector('#loginGate:not(.hidden)', timeout=10000)
    assert not page.is_visible(BANNER)


@pytest.mark.feature
def test_concurrent_401s_open_one_login_gate(app_page):
    page = app_page
    setup_calls = []
    page.on('request', lambda r: setup_calls.append(r.url) if '/auth/setup-status' in r.url else None)
    unauth = lambda r: r.fulfill(status=401, body='{}', content_type='application/json')
    page.route('**/api/plan-settings', lambda r: unauth(r) if r.request.method == 'PATCH' else r.continue_())
    page.route('**/api/persons', lambda r: unauth(r) if r.request.method == 'POST' else r.continue_())
    page.evaluate("""() => {
        window.app.saveToStorage();
        window.app.saveToStorage();
        import('/src/postgresSync.js').then(m => { m.pgPost(window.app, '/api/persons', { name: 'X' }); });
    }""")
    page.wait_for_selector('#loginGate:not(.hidden)', timeout=10000)
    page.wait_for_timeout(1500)
    assert len(setup_calls) == 1, setup_calls
    assert page.locator('#loginGate:not(.hidden)').count() == 1
    assert not page.is_visible(BANNER)


@pytest.mark.feature
def test_plan_settings_401_shows_login_gate_not_banner(app_page):
    page = app_page
    page.route('**/api/plan-settings', lambda r: r.fulfill(status=401, body='{}', content_type='application/json')
               if r.request.method == 'PATCH' else r.continue_())
    # showLoginGate resolves only after sign-in, so do not await the saves.
    page.evaluate("() => { window.app.saveToStorage(); window.app.saveToStorage(); }")
    page.wait_for_selector('#loginGate:not(.hidden)', timeout=10000)
    assert not page.is_visible(BANNER)
    assert page.locator('#loginGate').count() == 1
