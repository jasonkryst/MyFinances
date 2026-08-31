"""
Postgres Phase 2c migration integration tests.

Tests local-to-Postgres data migration UX and the one-way lock.
Require docker-compose stack running; run with:
    pytest tests/postgres/test_postgres_migration.py -v
"""
import json
import pytest

pytestmark = pytest.mark.asyncio

SAMPLE_LOCAL_DATA = {
    "debts": [{"id": 1, "name": "Test Debt", "debtType": "creditCard",
               "accountBalance": 1000, "interestRate": 15, "minimumPayment": 50, "dueDate": 1}],
    "accounts": [{"id": 2, "name": "Migration Checking", "type": "Checking", "startingBalance": 500}],
    "incomes": [], "bills": [], "expenses": [], "recurringTemplates": [],
    "emergencyFunds": [], "sinkingFunds": [], "reconciliations": [],
    "settings": [], "monthlySnapshots": [], "ledgerAmountOverrides": {},
    "netWorthMilestonesAwarded": [], "perMonthStimulus": [],
    "monthlyPayment": None, "strategy": None,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _wait_for_app_ready(page):
    await page.wait_for_function(
        "() => window.app && window.app._currentPage === 'health'",
        timeout=15000
    )


async def _csrf(page):
    return await page.evaluate(
        "document.cookie.split('; ').find(r => r.startsWith('csrf='))?.split('=')[1] || ''"
    )


async def _api_get(page, base_url, path):
    return await page.request.get(f"{base_url}{path}")


async def _api_post(page, base_url, path, body):
    csrf = await _csrf(page)
    return await page.request.post(f"{base_url}{path}", data=body,
                                   headers={"X-CSRF-Token": csrf})


async def _wipe_all(page, base_url):
    """Clear all Postgres data for test isolation."""
    csrf = await _csrf(page)
    for path in [
        "/api/debts", "/api/accounts", "/api/incomes", "/api/bonuses",
        "/api/bills", "/api/expenses", "/api/recurring-templates",
        "/api/emergency-funds", "/api/sinking-funds", "/api/reconciliations",
        "/api/ledger-overrides", "/api/net-worth-snapshots", "/api/settings",
    ]:
        await page.request.delete(f"{base_url}{path}", headers={"X-CSRF-Token": csrf})
    await page.request.delete(f"{base_url}/api/plan-settings/milestones",
                              headers={"X-CSRF-Token": csrf})
    await page.request.patch(
        f"{base_url}/api/plan-settings",
        data={"strategy": None, "monthlyPayment": None, "perMonthStimulus": []},
        headers={"X-CSRF-Token": csrf},
    )


def _capture_console(page):
    """Collect browser console messages for diagnostic output on failure."""
    messages = []
    page.on("console", lambda m: messages.append(f"[{m.type}] {m.text}"))
    return messages


async def _login_with_local_data(page, base_url, credentials, local_data=None):
    """Navigate to app, optionally inject local data, then complete login."""
    if local_data is not None:
        # Inject via init_script so the data is present in localStorage before
        # any of the app's own JavaScript runs.  Using page.evaluate() after
        # page.goto() risks a race: the app's init() may read localJson before
        # Playwright's CDP evaluate message is processed by the browser.
        # add_init_script() runs synchronously before the page's scripts on
        # every navigation in this context, so localJson is guaranteed to be
        # non-null when init() reaches the migration check.
        await page.context.add_init_script(
            f"window.localStorage.setItem('debtTrackerData', "
            f"{repr(json.dumps(local_data))});"
        )
    await page.goto(base_url)
    await page.locator("#loginGate").wait_for(state="visible", timeout=8000)
    await page.fill("#loginGateEmail", credentials["email"])
    await page.fill("#loginGatePassword", credentials["password"])
    async with page.expect_response(lambda r: "/auth/login" in r.url, timeout=10000):
        await page.click(".login-gate-submit")
    await page.locator("#loginGate").wait_for(state="hidden", timeout=12000)


# ---------------------------------------------------------------------------
# Fixture: clean Postgres state before every migration test
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
async def wipe_postgres_before_each_migration_test(base_url, credentials):
    """Wipe all Postgres data before each migration test for a guaranteed clean slate.

    Prior test files (e.g. test_postgres_import.py) may leave accounts or other
    records behind.  If even one record exists, postgresIsEmpty is false and
    showPgMigrationModal is never called, silently breaking all migration tests.
    """
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context()
        await ctx.add_init_script(
            "window.localStorage.setItem('debtTrackerStorageBackend', 'postgres');"
        )
        page = await ctx.new_page()
        await page.goto(base_url)
        await page.locator('#loginGate').wait_for(state='visible', timeout=8000)
        await page.fill('#loginGateEmail', credentials['email'])
        await page.fill('#loginGatePassword', credentials['password'])
        async with page.expect_response(lambda r: '/auth/login' in r.url, timeout=10000):
            await page.click('.login-gate-submit')
        await page.locator('#loginGate').wait_for(state='hidden', timeout=12000)
        await _wipe_all(page, base_url)
        await browser.close()
    yield


# ---------------------------------------------------------------------------
# Positive: migration is offered
# ---------------------------------------------------------------------------

async def test_migration_modal_shown_when_local_data_and_postgres_empty(
    pg_page, base_url, credentials
):
    """Migration modal appears after login when local data exists and Postgres is empty."""
    logs = _capture_console(pg_page)
    await _login_with_local_data(pg_page, base_url, credentials, SAMPLE_LOCAL_DATA)
    try:
        await pg_page.locator("#pgMigrationModal").wait_for(state="visible", timeout=15000)
    except Exception as exc:
        await pg_page.wait_for_timeout(300)
        pytest.fail(
            f"#pgMigrationModal never became visible.\nConsole:\n"
            + "\n".join(logs[-30:]) + f"\n{exc}"
        )
    assert await pg_page.locator("#pgMigrationModal").is_visible()
    counts_text = await pg_page.locator("#pgMigrationCounts").text_content()
    assert "debt" in counts_text.lower() or "account" in counts_text.lower(), \
        f"Counts text missing expected labels: {counts_text}"

    # Cleanup: skip and clear injected data
    await pg_page.click("#pgMigrationSkipBtn")
    await pg_page.evaluate("localStorage.removeItem('debtTrackerData')")


async def test_migration_transfer_copies_data_to_postgres(pg_page, base_url, credentials):
    """Transfer copies all local records to Postgres and clears localStorage."""
    logs = _capture_console(pg_page)
    await _login_with_local_data(pg_page, base_url, credentials, SAMPLE_LOCAL_DATA)
    try:
        await pg_page.locator("#pgMigrationModal").wait_for(state="visible", timeout=15000)
    except Exception as exc:
        await pg_page.wait_for_timeout(300)
        pytest.fail(
            f"#pgMigrationModal never became visible.\nConsole:\n"
            + "\n".join(logs[-30:]) + f"\n{exc}"
        )

    async with pg_page.expect_response(
        lambda r: "/api/accounts" in r.url and r.request.method == "POST",
        timeout=15000,
    ):
        await pg_page.click("#pgMigrationTransferBtn")

    await pg_page.locator("#pgMigrationModal").wait_for(state="hidden", timeout=10000)
    await _wait_for_app_ready(pg_page)

    accounts = await (await _api_get(pg_page, base_url, "/api/accounts")).json()
    debts = await (await _api_get(pg_page, base_url, "/api/debts")).json()
    assert any(a["name"] == "Migration Checking" for a in accounts), \
        f"Migrated account not found: {accounts}"
    assert any(d["name"] == "Test Debt" for d in debts), \
        f"Migrated debt not found: {debts}"

    local_data = await pg_page.evaluate("localStorage.getItem('debtTrackerData')")
    assert local_data is None, "localStorage not cleared after successful migration"

    await _wipe_all(pg_page, base_url)


async def test_migration_skip_preserves_local_data(pg_page, base_url, credentials):
    """Skip leaves localStorage intact and Postgres stays empty."""
    logs = _capture_console(pg_page)
    await _login_with_local_data(pg_page, base_url, credentials, SAMPLE_LOCAL_DATA)
    try:
        await pg_page.locator("#pgMigrationModal").wait_for(state="visible", timeout=15000)
    except Exception as exc:
        await pg_page.wait_for_timeout(300)
        pytest.fail(
            f"#pgMigrationModal never became visible.\nConsole:\n"
            + "\n".join(logs[-30:]) + f"\n{exc}"
        )
    await pg_page.click("#pgMigrationSkipBtn")
    await pg_page.locator("#pgMigrationModal").wait_for(state="hidden", timeout=5000)
    await _wait_for_app_ready(pg_page)

    local_data = await pg_page.evaluate("localStorage.getItem('debtTrackerData')")
    assert local_data is not None, "localStorage cleared despite user clicking Skip"

    debts = await (await _api_get(pg_page, base_url, "/api/debts")).json()
    assert len(debts) == 0, f"Postgres not empty after Skip: {debts}"

    await pg_page.evaluate("localStorage.removeItem('debtTrackerData')")


async def test_migration_skip_re_prompts_on_next_page_load(pg_page, base_url, credentials):
    """After Skip, migration modal re-appears on next load if Postgres is still empty."""
    logs = _capture_console(pg_page)
    await _login_with_local_data(pg_page, base_url, credentials, SAMPLE_LOCAL_DATA)
    try:
        await pg_page.locator("#pgMigrationModal").wait_for(state="visible", timeout=15000)
    except Exception as exc:
        await pg_page.wait_for_timeout(300)
        pytest.fail(
            f"#pgMigrationModal never became visible (first load).\nConsole:\n"
            + "\n".join(logs[-30:]) + f"\n{exc}"
        )
    await pg_page.click("#pgMigrationSkipBtn")
    await pg_page.locator("#pgMigrationModal").wait_for(state="hidden", timeout=5000)

    # Reload: session still valid, Postgres still empty, local data still present
    # (add_init_script re-sets debtTrackerData on every navigation including this reload)
    await pg_page.reload()
    try:
        await pg_page.locator("#pgMigrationModal").wait_for(state="visible", timeout=15000)
    except Exception as exc:
        await pg_page.wait_for_timeout(300)
        pytest.fail(
            f"#pgMigrationModal not re-shown after reload.\nConsole:\n"
            + "\n".join(logs[-30:]) + f"\n{exc}"
        )
    assert await pg_page.locator("#pgMigrationModal").is_visible(), \
        "Migration modal not re-shown after reload when Postgres still empty"

    # Cleanup
    await pg_page.click("#pgMigrationSkipBtn")
    await pg_page.evaluate("localStorage.removeItem('debtTrackerData')")


# ---------------------------------------------------------------------------
# Negative: migration is NOT offered
# ---------------------------------------------------------------------------

async def test_migration_not_shown_when_no_local_data(pg_page, base_url, credentials):
    """No migration modal when localStorage has no debtTrackerData."""
    await _login_with_local_data(pg_page, base_url, credentials, local_data=None)
    await _wait_for_app_ready(pg_page)
    assert not await pg_page.locator("#pgMigrationModal").is_visible(), \
        "Migration modal shown unexpectedly when no local data present"


async def test_migration_not_shown_when_postgres_not_empty(pg_page, base_url, credentials):
    """No migration modal when Postgres already has data."""
    # Establish session, seed Postgres
    await _login_with_local_data(pg_page, base_url, credentials, local_data=None)
    await _wait_for_app_ready(pg_page)
    seed = await _api_post(pg_page, base_url, "/api/accounts",
                           {"name": "Existing", "type": "Checking", "startingBalance": 0})
    assert seed.status == 201

    # Inject local data then reload — Postgres is not empty so modal must not appear
    await pg_page.evaluate(
        f"localStorage.setItem('debtTrackerData', {repr(json.dumps(SAMPLE_LOCAL_DATA))})"
    )
    await pg_page.reload()
    await _wait_for_app_ready(pg_page)
    assert not await pg_page.locator("#pgMigrationModal").is_visible(), \
        "Migration modal shown even though Postgres had existing data"

    await _wipe_all(pg_page, base_url)
    await pg_page.evaluate("localStorage.removeItem('debtTrackerData')")


# ---------------------------------------------------------------------------
# One-way lock UX
# ---------------------------------------------------------------------------

async def test_settings_select_hidden_when_on_postgres(pg_page, base_url, credentials):
    """Storage select is hidden and lock note is visible in Settings when on Postgres."""
    await _login_with_local_data(pg_page, base_url, credentials, local_data=None)
    await _wait_for_app_ready(pg_page)
    await pg_page.click("#settingsBtn")
    await pg_page.locator("#settingsModal").wait_for(state="visible", timeout=5000)

    assert not await pg_page.locator("#settingStorageBackend").is_visible(), \
        "Storage select should be hidden when backend is already Postgres"
    assert await pg_page.locator("#settingsStoragePostgresNote").is_visible(), \
        "Postgres lock note should be visible when backend is Postgres"

    await pg_page.click("#settingsModalDoneBtn")


async def test_one_way_lock_confirm_shown_on_switch_to_postgres(base_url, credentials):
    """Confirm dialog appears (and blocks reload) when user first selects Postgres."""
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context()
        # No postgres backend pre-set — app runs in local storage mode.
        # Pre-populate debtTrackerData so _isFirstRun is false and the
        # setup wizard does not intercept clicks on #settingsBtn.
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

        await page.goto(base_url)
        await page.wait_for_function(
            "() => window.app && window.app._currentPage === 'health'",
            timeout=15000,
        )

        await page.click("#settingsBtn")
        await page.locator("#settingsModal").wait_for(state="visible", timeout=5000)
        await page.select_option("#settingStorageBackend", "postgres")

        dialog_messages = []

        async def handle_dialog(dialog):
            dialog_messages.append(dialog.message)
            await dialog.dismiss()  # cancel so we do not actually switch

        page.on("dialog", handle_dialog)
        await page.click("#settingsModalDoneBtn")
        await page.wait_for_timeout(1000)

        assert dialog_messages, "No confirm dialog shown when switching to Postgres"
        assert "permanent" in dialog_messages[0].lower(), \
            f"Dialog missing 'permanent' warning: {dialog_messages[0]}"
        assert "not be able to switch back" in dialog_messages[0].lower(), \
            f"Dialog missing switch-back warning: {dialog_messages[0]}"

        await browser.close()
