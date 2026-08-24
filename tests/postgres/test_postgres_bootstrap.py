import pytest
from playwright.async_api import async_playwright

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
    # Nav exists in DOM but the gate (z-index: 2000, position: fixed, inset: 0)
    # covers the entire viewport — verify no interaction is possible with the nav
    # by confirming the gate overlay itself is blocking (aria-modal=true on gate).
    assert await pg_page.get_attribute('#loginGate', 'aria-modal') == 'true'


async def test_wrong_password_shows_error_gate_stays(pg_page, base_url, credentials):
    """Wrong password → error message shown, gate remains visible."""
    logs = _capture_console(pg_page)
    await pg_page.goto(base_url)
    await pg_page.locator('#loginGate').wait_for(state='visible', timeout=8000)

    await pg_page.fill('#loginGateEmail', credentials['email'])
    await pg_page.fill('#loginGatePassword', 'definitely-wrong-password-xyz')
    await pg_page.click('.login-gate-submit')

    # Wait for non-empty error text (the error element has min-height so it's
    # always in Playwright's "visible" state — wait on text content instead)
    await pg_page.wait_for_function(
        "document.getElementById('loginGateError').textContent.trim() !== ''",
        timeout=6000
    )
    text = await pg_page.locator('#loginGateError').text_content()
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
    await pg_page.click('.login-gate-submit')

    await gate.wait_for(state='hidden', timeout=12000)
    assert not await gate.is_visible(), f'Gate still visible. Console: {logs}'
    await pg_page.wait_for_selector('#topNav', state='visible', timeout=8000)


async def test_valid_session_skips_gate(pg_page, base_url, credentials):
    """After login, page reload with valid session cookie skips gate entirely."""
    logs = _capture_console(pg_page)
    await pg_page.goto(base_url)
    gate = pg_page.locator('#loginGate')
    await gate.wait_for(state='visible', timeout=8000)
    await pg_page.fill('#loginGateEmail', credentials['email'])
    await pg_page.fill('#loginGatePassword', credentials['password'])
    await pg_page.click('.login-gate-submit')
    await gate.wait_for(state='hidden', timeout=12000)

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
        await page.click('#settingsModalDoneBtn')

        gate = page.locator('#loginGate')
        await gate.wait_for(state='visible', timeout=10000)
        assert await gate.is_visible(), f'Gate not visible after switching to postgres. Console: {logs}'
        await browser.close()
