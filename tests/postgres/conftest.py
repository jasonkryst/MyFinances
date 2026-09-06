import os
import pytest


BASE_URL = os.environ.get('POSTGRES_TEST_BASE_URL', 'http://localhost:32900')
TEST_EMAIL = os.environ.get('POSTGRES_TEST_EMAIL', 'testuser@example.com')
TEST_PASSWORD = os.environ.get('POSTGRES_TEST_PASSWORD', '')


@pytest.fixture
def base_url():
    return BASE_URL


@pytest.fixture
def credentials():
    return {'email': TEST_EMAIL, 'password': TEST_PASSWORD}


@pytest.fixture
def bypass_postgres_detection_once():
    """Factory for a Playwright route handler on the root document ('/')
    that omits the X-Myfinances-Backend response header (nginx.conf) only
    for HEAD requests, passing every GET (page navigation, reloads) through
    unmodified.

    Since issue #164, the frontend auto-detects a real Postgres deployment
    by sending `fetch('/', {method: 'HEAD'})` at boot (src/storage.js's
    checkPostgresBackendPresent()) and, on success, forces the login gate
    before Settings is ever reachable -- so a test that wants to exercise
    the *manual* "switch to Postgres" flow in Settings needs to simulate
    the one legitimate reason a browser could still be sitting in local
    mode on a real Postgres origin: that detection HEAD request itself
    missed/raced. Keying off the HEAD method (rather than "first request")
    matters because the initial page navigation is itself a GET to '/' that
    would otherwise consume a naive first-request counter before the app's
    own detection request ever runs. Detection is only attempted once per
    boot while the backend preference isn't already 'postgres', so once a
    test manually sets it and reloads, this handler is never consulted
    again. Register the returned handler with
    `await ctx.route(base_url + '/', handler)` before the first `page.goto`.
    """
    def _factory():
        async def _handler(route):
            if route.request.method != 'HEAD':
                await route.continue_()
                return
            response = await route.fetch()
            headers = dict(response.headers)
            headers.pop('x-myfinances-backend', None)
            await route.fulfill(response=response, headers=headers)
        return _handler
    return _factory


@pytest.fixture
async def pg_page(base_url):
    """Browser page with postgres backend preference pre-set in localStorage."""
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context()
        # Runs before the app's JS on every navigation (including reloads),
        # ensuring the backend preference survives clearAllData wiping localStorage.
        await ctx.add_init_script(
            "window.localStorage.setItem('debtTrackerStorageBackend', 'postgres');"
        )
        page = await ctx.new_page()
        yield page
        await browser.close()
