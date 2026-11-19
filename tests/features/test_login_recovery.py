"""Sign-in recovery (2026-11-16): the email is not case-sensitive, the 429
message says how long to wait, and the email fields don't autocapitalize.

Signed-out contexts with the service worker blocked, so page.route() sees the
/auth requests. Only the case-insensitive test signs in for real (it succeeds,
so it never counts toward the login limit).
"""
import pytest

from tests.conftest import BASE_URL, TEST_EMAIL, TEST_PASSWORD, wait_for_app_ready

pytestmark = pytest.mark.feature


@pytest.fixture
def signed_out_page(browser, stack_user):
    context = browser.new_context(service_workers='block')
    page = context.new_page()
    page.goto(BASE_URL, wait_until='networkidle', timeout=60000)
    wait_for_app_ready(page)
    page.wait_for_selector('#loginGateEmail', state='visible')
    yield page
    context.close()


def _submit(page, email, password='whatever-password-123'):
    page.fill('#loginGateEmail', email)
    page.fill('#loginGatePassword', password)
    page.click('#loginGateSubmit')


def _route_login(page, status, headers=None, body='{"error":{"code":"RATE_LIMITED"}}'):
    page.route('**/auth/login', lambda route: route.fulfill(
        status=status, headers={'Content-Type': 'application/json', **(headers or {})}, body=body))


@pytest.mark.parametrize('headers, expected', [
    ({'Retry-After': '600'}, 'Too many attempts. Try again in 10 minutes.'),
    ({'Retry-After': '45'}, 'Too many attempts. Try again in 1 minute.'),
    ({'RateLimit-Reset': '125'}, 'Too many attempts. Try again in 3 minutes.'),
    ({}, 'Too many attempts. Try again later.'),
])
def test_rate_limited_sign_in_says_how_long_to_wait(signed_out_page, headers, expected):
    page = signed_out_page
    _route_login(page, 429, headers)
    _submit(page, 'someone@example.com')
    page.wait_for_function("(t) => document.getElementById('loginGateError').textContent === t", arg=expected)


def test_wrong_credentials_message_is_unchanged(signed_out_page):
    page = signed_out_page
    _route_login(page, 401, body='{"error":{"code":"INVALID_CREDENTIALS"}}')
    _submit(page, 'someone@example.com')
    page.wait_for_function("() => document.getElementById('loginGateError').textContent === 'Invalid email or password.'")


def test_email_fields_do_not_autocapitalize(signed_out_page):
    page = signed_out_page
    for sel in ('#loginGateEmail', '#loginGateForgotEmail'):
        assert page.get_attribute(sel, 'autocapitalize') == 'none', sel
        assert page.get_attribute(sel, 'autocorrect') == 'off', sel
        assert page.get_attribute(sel, 'spellcheck') == 'false', sel


def test_sends_the_email_trimmed(signed_out_page):
    page = signed_out_page
    seen = []

    def handler(route):
        seen.append(route.request.post_data_json)
        route.fulfill(status=401, headers={'Content-Type': 'application/json'}, body='{}')

    page.route('**/auth/login', handler)
    page.evaluate("() => { document.getElementById('loginGateEmail').type = 'text'; }")  # keep the spaces
    _submit(page, '  someone@example.com  ')
    page.wait_for_function("() => document.getElementById('loginGateError').textContent !== ''")
    assert seen and seen[0]['email'] == 'someone@example.com'


def test_sign_in_is_not_case_sensitive(signed_out_page):
    page = signed_out_page
    _submit(page, TEST_EMAIL.upper(), TEST_PASSWORD)
    page.wait_for_selector('#loginGate', state='hidden', timeout=15000)
