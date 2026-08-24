import pytest
from playwright.async_api import async_playwright

pytestmark = pytest.mark.asyncio


async def test_login_gate_shown_when_no_session(pg_page, base_url):
    """Boot with postgres preference + no session → login gate visible, app shell hidden."""
    await pg_page.goto(base_url)
    gate = pg_page.locator('#loginGate')
    await gate.wait_for(state='visible', timeout=8000)
    assert await gate.is_visible()
    nav = pg_page.locator('#topNav')
    assert not await nav.is_visible()


async def test_wrong_password_shows_error_gate_stays(pg_page, base_url, credentials):
    """Wrong password → error message shown, gate remains visible."""
    await pg_page.goto(base_url)
    await pg_page.locator('#loginGate').wait_for(state='visible', timeout=8000)

    await pg_page.fill('#loginGateEmail', credentials['email'])
    await pg_page.fill('#loginGatePassword', 'definitely-wrong-password-xyz')
    await pg_page.click('.login-gate-submit')

    error = pg_page.locator('#loginGateError')
    await error.wait_for(state='visible', timeout=5000)
    text = await error.text_content()
    assert text.strip() != ''
    assert await pg_page.locator('#loginGate').is_visible()


async def test_successful_login_hides_gate_and_boots_app(pg_page, base_url, credentials):
    """Correct credentials → gate hides, app shell renders."""
    await pg_page.goto(base_url)
    gate = pg_page.locator('#loginGate')
    await gate.wait_for(state='visible', timeout=8000)

    await pg_page.fill('#loginGateEmail', credentials['email'])
    await pg_page.fill('#loginGatePassword', credentials['password'])
    await pg_page.click('.login-gate-submit')

    await gate.wait_for(state='hidden', timeout=8000)
    assert not await gate.is_visible()
    await pg_page.wait_for_selector('#topNav', state='visible', timeout=8000)


async def test_valid_session_skips_gate(pg_page, base_url, credentials):
    """After login, page reload with valid session cookie skips gate entirely."""
    await pg_page.goto(base_url)
    gate = pg_page.locator('#loginGate')
    await gate.wait_for(state='visible', timeout=8000)
    await pg_page.fill('#loginGateEmail', credentials['email'])
    await pg_page.fill('#loginGatePassword', credentials['password'])
    await pg_page.click('.login-gate-submit')
    await gate.wait_for(state='hidden', timeout=8000)

    await pg_page.reload()
    await pg_page.wait_for_selector('#topNav', state='visible', timeout=8000)
    assert not await gate.is_visible()


async def test_settings_postgres_option_reloads_to_gate(base_url):
    """Selecting Postgres in Settings and clicking Done reloads to login gate."""
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context()
        page = await ctx.new_page()
        await page.goto(base_url)
        await page.wait_for_selector('#topNav', state='visible', timeout=8000)

        await page.click('#settingsBtn')
        await page.wait_for_selector('#settingsModal', state='visible', timeout=5000)

        await page.select_option('#settingStorageBackend', 'postgres')
        await page.click('#settingsDoneBtn')

        gate = page.locator('#loginGate')
        await gate.wait_for(state='visible', timeout=10000)
        assert await gate.is_visible()
        await browser.close()
