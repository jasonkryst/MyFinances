import re
"""Setup wizard Playwright tests.

These tests exercise the frontend setup form (shown when the server has no
users yet).  To remain independent of the docker-compose stack state they
use page.route() to mock the /auth/setup-status and /auth/register responses,
testing only the frontend UI behaviour.  The full API contract (register
creates a session, 409 on second call, etc.) is covered in
server/test/setup.test.js.
"""
import json
import pytest
from playwright.async_api import async_playwright, expect

pytestmark = pytest.mark.asyncio

BASE_URL_DEFAULT = "http://localhost:5500"


def _make_pg_context(playwright):
    """Return an async context manager that yields a postgres-backend page."""
    class _Ctx:
        async def __aenter__(self):
            self.browser = await playwright.chromium.launch()
            ctx = await self.browser.new_context()
            await ctx.add_init_script(
                "window.localStorage.setItem('debtTrackerStorageBackend', 'postgres');"
            )
            self.page = await ctx.new_page()
            return self.page

        async def __aexit__(self, *_):
            await self.browser.close()

    return _Ctx()


def _capture_console(page):
    messages = []
    page.on('console', lambda m: messages.append(f'[{m.type}] {m.text}'))
    return messages


# ---------------------------------------------------------------------------
# Helpers for route mocking
# ---------------------------------------------------------------------------

async def _mock_setup_needed(page):
    """Intercept /auth/setup-status to return needsSetup:true."""
    await page.route('**/auth/setup-status', lambda route: route.fulfill(
        status=200,
        content_type='application/json',
        body=json.dumps({'needsSetup': True})
    ))


async def _mock_register_ok(page):
    """Intercept /auth/register to return a successful response."""
    await page.route('**/auth/register', lambda route: route.fulfill(
        status=200,
        content_type='application/json',
        body=json.dumps({'ok': True})
    ))


async def _mock_all_api(page):
    """Intercept all /api/* calls with minimal empty-state responses so
    loadFromPostgres() can complete without a real session cookie."""
    def _api_handler(route):
        url = route.request.url
        if 'plan-settings' in url:
            body = json.dumps({
                'strategy': None, 'monthlyPayment': None,
                'ledgerSettings': {'accountFilter': 'all', 'dateRange': 'all', 'sortKey': 'date', 'sortDir': 'desc'},
                'forecastSettings': {'rangeMonths': 1, 'accountId': 'total', 'notableThresholdPct': 130},
                'netWorthMilestonesAwarded': [], 'perMonthStimulus': []
            })
        elif 'settings' in url and 'plan' not in url:
            body = json.dumps([])
        elif 'ledger-overrides' in url:
            body = json.dumps({})
        else:
            body = json.dumps([])
        route.fulfill(status=200, content_type='application/json', body=body)
    await page.route('**/api/**', _api_handler)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

async def test_setup_form_shown_when_no_user(base_url):
    """When /auth/setup-status returns needsSetup:true the setup form is shown."""
    async with async_playwright() as p:
        async with _make_pg_context(p) as page:
            logs = _capture_console(page)
            await _mock_setup_needed(page)

            await page.goto(base_url)
            gate = page.locator('#loginGate')
            await gate.wait_for(state='visible', timeout=8000)

            confirm_group = page.locator('#loginGateConfirmGroup')
            assert await confirm_group.is_visible(), \
                f'Confirm field not visible in setup mode. Console: {logs}'

            submit = page.locator('#loginGateSubmit')
            await expect(submit).to_have_text('Create Account', timeout=4000)

            subtitle = page.locator('#loginGateSubtitle')
            await expect(subtitle).to_have_text('Create your account', timeout=4000)


async def test_login_form_shown_when_user_exists(base_url, credentials):
    """When /auth/setup-status returns needsSetup:false the login form is shown
    (confirm field hidden, button reads Sign In)."""
    async with async_playwright() as p:
        async with _make_pg_context(p) as page:
            logs = _capture_console(page)
            # Real server has a pre-seeded user -> setup-status returns false
            await page.goto(base_url)
            gate = page.locator('#loginGate')
            await gate.wait_for(state='visible', timeout=8000)

            confirm_group = page.locator('#loginGateConfirmGroup')
            assert not await confirm_group.is_visible(), \
                f'Confirm field should be hidden in login mode. Console: {logs}'

            submit = page.locator('#loginGateSubmit')
            await expect(submit).to_have_text('Sign In', timeout=4000)


async def test_password_mismatch_shows_error_no_network_call(base_url):
    """Mismatched passwords show a client-side error; /auth/register is not called."""
    async with async_playwright() as p:
        async with _make_pg_context(p) as page:
            logs = _capture_console(page)
            await _mock_setup_needed(page)

            register_called = []
            await page.route('**/auth/register', lambda route: register_called.append(True) or route.continue_())

            await page.goto(base_url)
            await page.locator('#loginGate').wait_for(state='visible', timeout=8000)

            await page.fill('#loginGateEmail', 'user@example.com')
            await page.fill('#loginGatePassword', 'correct horse battery staple')
            await page.fill('#loginGateConfirm', 'different password here')
            await page.click('#loginGateSubmit')

            error = page.locator('#loginGateError')
            await expect(error).to_have_text(re.compile(r'.'), timeout=4000)
            text = await error.text_content()
            assert 'match' in text.lower(), f'Expected mismatch error, got: "{text}". Console: {logs}'
            assert len(register_called) == 0, '/auth/register should not be called'


async def test_short_password_shows_error_no_network_call(base_url):
    """Password shorter than 12 chars shows a client-side error; /auth/register is not called."""
    async with async_playwright() as p:
        async with _make_pg_context(p) as page:
            logs = _capture_console(page)
            await _mock_setup_needed(page)

            register_called = []
            await page.route('**/auth/register', lambda route: register_called.append(True) or route.continue_())

            await page.goto(base_url)
            await page.locator('#loginGate').wait_for(state='visible', timeout=8000)

            await page.fill('#loginGateEmail', 'user@example.com')
            await page.fill('#loginGatePassword', 'short')
            await page.fill('#loginGateConfirm', 'short')
            await page.click('#loginGateSubmit')

            error = page.locator('#loginGateError')
            await expect(error).to_have_text(re.compile(r'.'), timeout=4000)
            text = await error.text_content()
            assert '12' in text, f'Expected min-length error, got: "{text}". Console: {logs}'
            assert len(register_called) == 0, '/auth/register should not be called'


async def test_setup_submit_calls_register_not_login(base_url):
    """In setup mode the form submits to /auth/register, not /auth/login."""
    async with async_playwright() as p:
        async with _make_pg_context(p) as page:
            await _mock_setup_needed(page)
            await _mock_register_ok(page)
            await _mock_all_api(page)

            register_called = []
            login_called = []

            async def _track_register(route):
                register_called.append(route.request.post_data)
                await route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True}))

            async def _track_login(route):
                login_called.append(True)
                await route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True}))

            await page.route('**/auth/register', _track_register)
            await page.route('**/auth/login', _track_login)

            await page.goto(base_url)
            await page.locator('#loginGate').wait_for(state='visible', timeout=8000)

            await page.fill('#loginGateEmail', 'user@example.com')
            await page.fill('#loginGatePassword', 'correct horse battery staple')
            await page.fill('#loginGateConfirm', 'correct horse battery staple')

            await page.click('#loginGateSubmit')

            # Wait briefly for the click to be processed
            await page.wait_for_timeout(2000)

            assert len(login_called) == 0, '/auth/login should NOT be called in setup mode'
            assert len(register_called) == 1, '/auth/register should be called exactly once'
            payload = json.loads(register_called[0])
            assert payload['email'] == 'user@example.com'
            assert 'password' in payload


async def test_successful_register_hides_gate(base_url):
    """After a successful /auth/register response the gate hides."""
    async with async_playwright() as p:
        async with _make_pg_context(p) as page:
            logs = _capture_console(page)
            await _mock_setup_needed(page)
            await _mock_register_ok(page)
            await _mock_all_api(page)

            await page.goto(base_url)
            gate = page.locator('#loginGate')
            await gate.wait_for(state='visible', timeout=8000)

            await page.fill('#loginGateEmail', 'user@example.com')
            await page.fill('#loginGatePassword', 'correct horse battery staple')
            await page.fill('#loginGateConfirm', 'correct horse battery staple')
            await page.click('#loginGateSubmit')

            try:
                await gate.wait_for(state='hidden', timeout=12000)
            except Exception as e:
                pytest.fail(f'Gate still visible after register. Console: {logs}\n{e}')
            assert not await gate.is_visible()

