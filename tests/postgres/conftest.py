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
