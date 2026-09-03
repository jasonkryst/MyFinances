import pytest
from playwright.async_api import async_playwright, expect

pytestmark = pytest.mark.asyncio

MAILPIT_API = 'http://localhost:8025/api/v1'


async def _clear_mailpit(page):
    await page.request.delete(f'{MAILPIT_API}/messages')


async def _latest_mailpit_message(page):
    res = await page.request.get(f'{MAILPIT_API}/messages')
    data = await res.json()
    messages = data.get('messages', [])
    return messages[0] if messages else None


async def _login(page, base_url, credentials):
    await page.goto(base_url)
    gate = page.locator('#loginGate')
    await gate.wait_for(state='visible', timeout=8000)
    await page.fill('#loginGateEmail', credentials['email'])
    await page.fill('#loginGatePassword', credentials['password'])
    async with page.expect_response(lambda r: '/auth/login' in r.url, timeout=10000):
        await page.click('.login-gate-submit')
    await gate.wait_for(state='hidden', timeout=12000)
    await page.wait_for_selector('#topNav', state='visible', timeout=8000)
    # #topNav becomes visible before app.init() finishes awaiting
    # loadFromPostgres()'s 15-endpoint fan-out and wiring up the settings
    # modal's click handlers (initSettingsModalFeature); wait for the
    # network to go quiet so #settingsBtn is actually interactive.
    await page.wait_for_load_state('networkidle', timeout=15000)


async def test_send_test_email_button_hidden_for_non_postgres_backend(base_url):
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context()
        # Pre-populate localStorage so app has existing data → _isFirstRun is
        # false → the first-run setup wizard does not appear and block the
        # #settingsBtn click (same pattern as
        # test_postgres_bootstrap.test_settings_postgres_option_reloads_to_gate).
        await ctx.add_init_script("""
            window.localStorage.setItem('debtTrackerData', JSON.stringify({
                debts:[], accounts:[], incomes:[], bills:[], expenses:[],
                ledgerAmountOverrides:{}, ledgerClearedTransactions:{}, recurringTemplates:[], emergencyFunds:[],
                sinkingFunds:[], reconciliations:[], settings:[], monthlySnapshots:[],
                netWorthMilestonesAwarded:[], perMonthStimulus:[],
                monthlyPayment:null, strategy:null,
                ledgerSettings:{accountFilter:'all',dateRange:'all',sortKey:'date',sortDir:'desc'},
                forecastSettings:{rangeMonths:1,accountId:'total',notableThresholdPct:130},
                timestamp:'2026-01-01T00:00:00.000Z'
            }));
        """)
        page = await ctx.new_page()
        await page.goto(base_url)
        await page.wait_for_selector('#topNav', state='visible', timeout=8000)
        await page.click('#settingsBtn')
        await page.wait_for_selector('#settingsModal', state='visible', timeout=5000)
        assert not await page.locator('#settingsEmailTestGroup').is_visible()
        await browser.close()


async def test_send_test_email_delivers_to_mailpit(pg_page, base_url, credentials):
    await _clear_mailpit(pg_page)
    await _login(pg_page, base_url, credentials)

    await pg_page.click('#settingsBtn')
    await pg_page.wait_for_selector('#settingsModal', state='visible', timeout=5000)

    group = pg_page.locator('#settingsEmailTestGroup')
    await expect(group).to_be_visible()

    async with pg_page.expect_response(
        lambda r: '/api/notifications/test-email' in r.url, timeout=10000
    ) as resp_info:
        await pg_page.click('#settingsSendTestEmailBtn')
    resp = await resp_info.value
    assert resp.status == 200

    toast = pg_page.locator('#emailTestToast')
    await expect(toast).to_be_visible(timeout=5000)
    toast_text = (await toast.text_content() or '').lower()
    assert 'sent' in toast_text

    message = await _latest_mailpit_message(pg_page)
    assert message is not None, 'Mailpit received no message'
    to_addresses = [t.get('Address', '') for t in message.get('To', [])]
    assert credentials['email'] in to_addresses
