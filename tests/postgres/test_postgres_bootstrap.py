import re
import pytest
from playwright.async_api import async_playwright, expect

pytestmark = pytest.mark.asyncio


def _capture_console(page):
    """Collect all browser console messages for diagnostic output on failure."""
    messages = []
    page.on('console', lambda m: messages.append(f'[{m.type}] {m.text}'))
    return messages


async def test_login_gate_shown_when_no_session(pg_page, base_url):
    """Boot with postgres preference + no session → login gate visible."""
    logs = _capture_console(pg_page)
    await pg_page.goto(base_url)
    gate = pg_page.locator('#loginGate')
    await gate.wait_for(state='visible', timeout=8000)
    assert await gate.is_visible(), f'Gate not visible. Console: {logs}'
    # The gate is position:fixed inset:0 z-index:2000 with aria-modal=true —
    # that is sufficient to confirm it covers the page for all users.
    assert await pg_page.get_attribute('#loginGate', 'aria-modal') == 'true'


async def test_wrong_password_shows_error_gate_stays(pg_page, base_url, credentials):
    """Wrong password → error message shown, gate remains visible."""
    logs = _capture_console(pg_page)
    await pg_page.goto(base_url)
    await pg_page.locator('#loginGate').wait_for(state='visible', timeout=8000)

    await pg_page.fill('#loginGateEmail', credentials['email'])
    await pg_page.fill('#loginGatePassword', 'definitely-wrong-password-xyz')

    # Capture the /auth/login response to diagnose failures
    async with pg_page.expect_response(lambda r: '/auth/login' in r.url, timeout=10000) as resp_info:
        await pg_page.click('.login-gate-submit')
    resp = await resp_info.value
    assert resp.status == 401, f'Expected 401, got {resp.status}. Console: {logs}'

    # The error element has min-height CSS so it's always "visible" per Playwright.
    # Use expect().to_have_text() which polls on text content without unsafe-eval.
    error = pg_page.locator('#loginGateError')
    await expect(error).to_have_text(re.compile(r'.+'), timeout=4000)
    text = await error.text_content()
    assert text.strip() != '', f'Expected error text. Console: {logs}'
    assert await pg_page.locator('#loginGate').is_visible()


async def test_successful_login_hides_gate_and_boots_app(pg_page, base_url, credentials):
    """Correct credentials → gate hides, app shell renders."""
    logs = _capture_console(pg_page)
    await pg_page.goto(base_url)
    gate = pg_page.locator('#loginGate')
    await gate.wait_for(state='visible', timeout=8000)

    await pg_page.fill('#loginGateEmail', credentials['email'])
    await pg_page.fill('#loginGatePassword', credentials['password'])

    async with pg_page.expect_response(lambda r: '/auth/login' in r.url, timeout=10000) as resp_info:
        await pg_page.click('.login-gate-submit')
    resp = await resp_info.value
    login_status = resp.status

    try:
        await gate.wait_for(state='hidden', timeout=12000)
    except Exception as e:
        pytest.fail(
            f'Gate still visible after login (HTTP {login_status}). '
            f'Console: {logs}\n{e}'
        )
    assert not await gate.is_visible()
    await pg_page.wait_for_selector('#topNav', state='visible', timeout=8000)


async def test_valid_session_skips_gate(pg_page, base_url, credentials):
    """After login, page reload with valid session cookie skips gate entirely."""
    logs = _capture_console(pg_page)
    await pg_page.goto(base_url)
    gate = pg_page.locator('#loginGate')
    await gate.wait_for(state='visible', timeout=8000)
    await pg_page.fill('#loginGateEmail', credentials['email'])
    await pg_page.fill('#loginGatePassword', credentials['password'])

    async with pg_page.expect_response(lambda r: '/auth/login' in r.url, timeout=10000) as resp_info:
        await pg_page.click('.login-gate-submit')
    resp = await resp_info.value
    login_status = resp.status

    try:
        await gate.wait_for(state='hidden', timeout=12000)
    except Exception as e:
        pytest.fail(
            f'Gate still visible after login (HTTP {login_status}). '
            f'Console: {logs}\n{e}'
        )

    await pg_page.reload()
    await pg_page.wait_for_selector('#topNav', state='visible', timeout=8000)
    assert not await gate.is_visible(), f'Gate shown after valid session reload. Console: {logs}'


async def test_settings_postgres_option_reloads_to_gate(base_url):
    """Selecting Postgres in Settings and clicking Done reloads to login gate."""
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context()
        # Pre-populate localStorage so app has existing data → _isFirstRun is
        # false → setup wizard does not appear and block clicks.
        await ctx.add_init_script("""
            window.localStorage.setItem('debtTrackerData', JSON.stringify({
                debts:[], accounts:[], incomes:[], bills:[], expenses:[],
                ledgerAmountOverrides:{}, recurringTemplates:[], emergencyFunds:[],
                sinkingFunds:[], reconciliations:[], settings:[], monthlySnapshots:[],
                netWorthMilestonesAwarded:[], perMonthStimulus:[],
                monthlyPayment:null, strategy:null,
                ledgerSettings:{accountFilter:'all',dateRange:'all',sortKey:'date',sortDir:'desc'},
                forecastSettings:{rangeMonths:1,accountId:'total',notableThresholdPct:130},
                timestamp:'2026-01-01T00:00:00.000Z'
            }));
        """)
        page = await ctx.new_page()
        logs = _capture_console(page)
        await page.goto(base_url)
        await page.wait_for_selector('#topNav', state='visible', timeout=8000)

        await page.click('#settingsBtn')
        await page.wait_for_selector('#settingsModal', state='visible', timeout=5000)

        await page.select_option('#settingStorageBackend', 'postgres')
        # Accept the one-way lock confirm dialog that fires when switching to Postgres
        page.on("dialog", lambda d: d.accept())
        await page.click('#settingsModalDoneBtn')

        gate = page.locator('#loginGate')
        await gate.wait_for(state='visible', timeout=10000)
        assert await gate.is_visible(), f'Gate not visible after switching to postgres. Console: {logs}'
        await browser.close()
