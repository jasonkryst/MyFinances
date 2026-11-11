import os
import pytest

from tests.conftest import TEST_EMAIL, TEST_PASSWORD, ensure_session_async, reset_server_state_async


BASE_URL = os.environ.get('POSTGRES_TEST_BASE_URL', 'http://localhost:32900').rstrip('/')


async def sign_in(page, base_url, *, wipe=False):
    """Land on the app signed in, without a UI login.

    Installs the harness's cached session (the login limiter allows 5 per 15 minutes, so tests
    must not each log in), loads the app and waits for init. With wipe=True the server's data
    is also reset first (the shared harness leaves the previous test's data behind).
    """
    await ensure_session_async(page.context)
    await page.goto(base_url)
    await page.wait_for_selector('html[data-app-ready="true"]', state='attached', timeout=30000)
    await page.wait_for_function('() => !!window.app', timeout=30000)
    if wipe:
        await reset_server_state_async(page)


@pytest.fixture
def base_url():
    return BASE_URL


@pytest.fixture
def credentials():
    return {'email': TEST_EMAIL, 'password': TEST_PASSWORD}


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
