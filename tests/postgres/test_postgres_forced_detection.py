"""Tests for issue #164: a genuinely fresh browser (no
`debtTrackerStorageBackend` key at all -- e.g. an incognito window) must be
forced into Postgres + the login gate whenever this origin is a
Postgres-backed deployment, rather than silently defaulting to local-storage
mode and never asking the visitor to log in.

Unlike tests/postgres/test_postgres_setup_wizard.py, these tests do NOT
pre-seed `debtTrackerStorageBackend` via add_init_script -- that pre-seeding
is exactly the condition this fix removes the dependency on. Requests are
mocked via page.route() so these stay hermetic frontend-only checks; the
real server's /auth/setup-status contract is covered in
server/test/setup.test.js.

Detection itself (checkPostgresBackendPresent() in src/storage.js) reads an
`X-Myfinances-Backend: postgres` response header off a HEAD request to `/`,
not a probe of a Postgres-only endpoint -- deliberately, so a plain
static/local-only deployment (no such header) never has to 404 a fetch,
which Chrome logs as a console error regardless of the surrounding JS
try/catch. These tests mock that header rather than /auth/setup-status.
"""
import json
import pytest
from playwright.async_api import async_playwright, expect

pytestmark = pytest.mark.asyncio


async def _mock_all_api_unauthenticated(page):
    """All /api/* calls 401 (no session cookie), forcing checkPostgresSession()
    to return false so the login gate is shown rather than skipped."""
    await page.route('**/api/**', lambda route: route.fulfill(
        status=401, content_type='application/json',
        body=json.dumps({'error': {'code': 'UNAUTHENTICATED'}})
    ))


async def _mock_setup_status(page, needs_setup):
    await page.route('**/auth/setup-status', lambda route: route.fulfill(
        status=200, content_type='application/json',
        body=json.dumps({'needsSetup': needs_setup})
    ))


def _root_header_router(present):
    """Route handler for the root document ('/') that forwards the request
    to the real server via route.fetch() and re-fulfills it with the
    X-Myfinances-Backend header added (present=True) or stripped
    (present=False), leaving the actual body untouched. Every other path
    (JS/CSS assets, /api/**, /auth/**) is handled by separate routes and
    hits the real server unmodified."""
    async def _handler(route):
        response = await route.fetch()
        headers = dict(response.headers)
        if present:
            headers['x-myfinances-backend'] = 'postgres'
        else:
            headers.pop('x-myfinances-backend', None)
        await route.fulfill(response=response, headers=headers)
    return _handler


async def test_fresh_browser_forced_to_login_when_postgres_present(base_url):
    """A brand-new browser profile with no stored backend preference still
    gets the Sign In gate when the root document carries the Postgres
    backend header and /auth/setup-status reports an existing user."""
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context()
        page = await ctx.new_page()
        try:
            await page.route(base_url + '/', _root_header_router(present=True))
            await _mock_setup_status(page, needs_setup=False)
            await _mock_all_api_unauthenticated(page)

            await page.goto(base_url)
            gate = page.locator('#loginGate')
            await gate.wait_for(state='visible', timeout=8000)

            submit = page.locator('#loginGateSubmit')
            await expect(submit).to_have_text('Sign In', timeout=4000)

            # Detection must have persisted the backend choice so later
            # navigations (and the Settings modal) treat this browser as
            # locked to Postgres without re-detecting every time.
            backend = await page.evaluate("window.localStorage.getItem('debtTrackerStorageBackend')")
            assert backend == 'postgres'
        finally:
            await browser.close()


async def test_fresh_browser_forced_to_setup_when_postgres_present_no_user(base_url):
    """A brand-new browser profile also gets the Create Account gate when
    /auth/setup-status reports needsSetup: true -- no init script needed to
    reach the setup flow, matching the equivalent seeded test in
    test_postgres_setup_wizard.py."""
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context()
        page = await ctx.new_page()
        try:
            await page.route(base_url + '/', _root_header_router(present=True))
            await _mock_setup_status(page, needs_setup=True)
            await _mock_all_api_unauthenticated(page)

            await page.goto(base_url)
            gate = page.locator('#loginGate')
            await gate.wait_for(state='visible', timeout=8000)

            confirm_group = page.locator('#loginGateConfirmGroup')
            assert await confirm_group.is_visible()

            submit = page.locator('#loginGateSubmit')
            await expect(submit).to_have_text('Create Account', timeout=4000)
        finally:
            await browser.close()


async def test_fresh_browser_stays_local_when_no_postgres_backend(base_url):
    """When the root document has no X-Myfinances-Backend header (plain
    static/local-only deployment, e.g. `python -m http.server`), a fresh
    browser must NOT be forced into Postgres mode -- the login gate stays
    hidden and the app boots normally in local-storage mode, exactly as
    before this fix, with no console errors from a failed detection probe."""
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context()
        page = await ctx.new_page()
        console_errors = []
        page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
        try:
            await page.route(base_url + '/', _root_header_router(present=False))

            await page.goto(base_url)
            version_el = page.locator('#appVersion')
            await expect(version_el).not_to_have_text('', timeout=8000)

            gate = page.locator('#loginGate')
            assert not await gate.is_visible(), 'Login gate must stay hidden with no Postgres backend'

            backend = await page.evaluate("window.localStorage.getItem('debtTrackerStorageBackend')")
            assert backend is None, 'Backend preference must not be forced when no Postgres backend is detected'

            assert console_errors == [], f'Detection must not log console errors when absent: {console_errors}'
        finally:
            await browser.close()
