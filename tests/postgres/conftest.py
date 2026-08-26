import os
import pytest


BASE_URL = os.environ.get('POSTGRES_TEST_BASE_URL', 'http://localhost:5500')
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
        # Runs before the app's JS on every navigation.
        # Sets the backend preference and seeds a minimal debtTrackerData stub so
        # the first-run setup wizard doesn't appear when the postgres DB is empty.
        await ctx.add_init_script("""
            window.localStorage.setItem('debtTrackerStorageBackend', 'postgres');
            if (!window.localStorage.getItem('debtTrackerData')) {
                window.localStorage.setItem('debtTrackerData', JSON.stringify({
                    debts:[],accounts:[],incomes:[],bills:[],expenses:[],
                    ledgerAmountOverrides:{},recurringTemplates:[],emergencyFunds:[],
                    sinkingFunds:[],reconciliations:[],settings:[],monthlySnapshots:[],
                    netWorthMilestonesAwarded:[],perMonthStimulus:[],
                    monthlyPayment:null,strategy:null,
                    ledgerSettings:{accountFilter:'all',dateRange:'all',sortKey:'date',sortDir:'desc'},
                    forecastSettings:{rangeMonths:1,accountId:'total',notableThresholdPct:130},
                    timestamp:'2026-01-01T00:00:00.000Z'
                }));
            }
        """)
        page = await ctx.new_page()
        yield page
        await browser.close()
