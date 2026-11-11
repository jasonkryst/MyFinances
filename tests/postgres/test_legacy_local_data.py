"""
Legacy browser-only data (v7.0.0, spec section 5 step 4).

Browsers that used the old local mode still hold localStorage.debtTrackerData.
On boot: an empty server dataset offers to import it; a non-empty one offers a
JSON backup download or removal. The key is removed on import, decline,
download and remove, and kept on an import failure or an Escape dismiss.

Once-only seeding: the legacy key is set with page.evaluate() on an already
loaded page, then the page is reloaded. No add_init_script is used, so the key
is written exactly once and "key is gone after reload" assertions are real.

Require the docker-compose stack; run with:
    pytest tests/postgres/test_legacy_local_data.py -v
"""
import json
import re

import pytest

from tests.conftest import reset_server_state_async, seed_state_async
from tests.postgres.conftest import sign_in

pytestmark = pytest.mark.asyncio

LEGACY = {
    "debts": [{"id": 1, "name": "Legacy Debt", "debtType": "creditCard",
               "accountBalance": 1000, "interestRate": 15, "minimumPayment": 50, "dueDate": 1}],
    "accounts": [{"id": 2, "name": "Legacy Checking", "type": "Checking", "startingBalance": 500}],
    "incomes": [], "bills": [], "expenses": [], "recurringTemplates": [],
    "emergencyFunds": [], "sinkingFunds": [], "reconciliations": [],
    "settings": [], "monthlySnapshots": [], "ledgerAmountOverrides": {},
    "ledgerClearedTransactions": {},
    "netWorthMilestonesAwarded": [], "perMonthStimulus": [],
    "monthlyPayment": None, "strategy": None,
}


async def _boot_with_legacy(page, base_url, raw, *, server_has_data=False):
    await sign_in(page, base_url, wipe=True)
    if server_has_data:
        await seed_state_async(page, {"accounts": [
            {"id": 9, "name": "Server Account", "type": "Checking", "startingBalance": 10}]})
    await page.evaluate("v => localStorage.setItem('debtTrackerData', v)", raw)
    await page.reload()
    await page.wait_for_selector('html[data-app-ready="true"]', state="attached", timeout=30000)


async def _key(page):
    return await page.evaluate("localStorage.getItem('debtTrackerData')")


async def _accounts(page, base_url):
    return await (await page.request.get(f"{base_url}/api/accounts")).json()


async def test_empty_db_shows_migration_modal(pg_page, base_url):
    await _boot_with_legacy(pg_page, base_url, json.dumps(LEGACY))
    await pg_page.locator("#pgMigrationModal").wait_for(state="visible", timeout=15000)
    assert await pg_page.locator("#pgMigrationTransferBtn").is_visible()
    counts = await pg_page.locator("#pgMigrationCounts").text_content()
    assert "debt" in counts.lower() and "account" in counts.lower(), counts
    # The wizard must not stack on top of the prompt.
    assert not await pg_page.locator("#setupWizardModal").is_visible()


LEGACY_INCOME = {"id": 3, "name": "Legacy Pay", "amount": 1000, "firstPayDate": "2026-01-01",
                 "frequency": "monthly", "accountId": 2}


async def test_migration_counts_use_a_localized_list(pg_page, base_url):
    """#513: the counts read as a sentence ("X and Y"), not a bare comma join."""
    await _boot_with_legacy(pg_page, base_url, json.dumps(LEGACY))
    await pg_page.locator("#pgMigrationModal").wait_for(state="visible", timeout=15000)
    counts = await pg_page.locator("#pgMigrationCounts").text_content()
    assert counts.strip() == "Found: 1 debt and 1 account.", counts


async def test_migration_counts_list_of_three(pg_page, base_url):
    legacy = {**LEGACY, "incomes": [LEGACY_INCOME]}
    await _boot_with_legacy(pg_page, base_url, json.dumps(legacy))
    await pg_page.locator("#pgMigrationModal").wait_for(state="visible", timeout=15000)
    counts = await pg_page.locator("#pgMigrationCounts").text_content()
    assert counts.strip() == "Found: 1 debt, 1 account, and 1 income record.", counts


async def test_migration_counts_list_follows_the_locale(pg_page, base_url):
    """The conjunction is the active locale's, never an English "and" in Spanish."""
    await _boot_with_legacy(pg_page, base_url, json.dumps(LEGACY))
    await pg_page.evaluate("localStorage.setItem('debtTrackerLocale', 'es')")
    await pg_page.reload()
    await pg_page.wait_for_selector('html[data-app-ready="true"]', state="attached", timeout=30000)
    await pg_page.locator("#pgMigrationModal").wait_for(state="visible", timeout=15000)
    try:
        counts = await pg_page.locator("#pgMigrationCounts").text_content()
        assert counts.strip() == "Encontrado: 1 deuda y 1 cuenta.", counts
        assert " and " not in counts
    finally:
        await pg_page.evaluate("localStorage.removeItem('debtTrackerLocale')")


async def test_legacy_import_moves_data_and_removes_key(pg_page, base_url):
    await _boot_with_legacy(pg_page, base_url, json.dumps(LEGACY))
    await pg_page.locator("#pgMigrationModal").wait_for(state="visible", timeout=15000)
    await pg_page.click("#pgMigrationTransferBtn")
    await pg_page.locator("#pgMigrationModal").wait_for(state="hidden", timeout=15000)
    await pg_page.reload()
    await pg_page.wait_for_selector('html[data-app-ready="true"]', state="attached", timeout=30000)
    assert any(a["name"] == "Legacy Checking" for a in await _accounts(pg_page, base_url))
    assert await _key(pg_page) is None


async def test_legacy_decline_downloads_backup_then_removes_key(pg_page, base_url):
    await _boot_with_legacy(pg_page, base_url, json.dumps(LEGACY))
    await pg_page.locator("#pgMigrationModal").wait_for(state="visible", timeout=15000)
    async with pg_page.expect_download() as info:
        await pg_page.click("#pgMigrationSkipBtn")
    download = await info.value
    assert re.fullmatch(r"myfinances-browser-backup-\d{4}-\d{2}-\d{2}\.json", download.suggested_filename)
    with open(await download.path(), encoding="utf-8") as f:
        assert json.load(f) == LEGACY
    await pg_page.locator("#pgMigrationModal").wait_for(state="hidden", timeout=5000)
    assert await _key(pg_page) is None
    assert await _accounts(pg_page, base_url) == []
    await pg_page.reload()
    await pg_page.wait_for_selector('html[data-app-ready="true"]', state="attached", timeout=30000)
    assert not await pg_page.locator("#pgMigrationModal").is_visible()


async def test_legacy_import_failure_keeps_key(pg_page, base_url):
    await _boot_with_legacy(pg_page, base_url, json.dumps(LEGACY))
    await pg_page.locator("#pgMigrationModal").wait_for(state="visible", timeout=15000)

    async def fail_post(route):
        if route.request.method == "POST":
            await route.fulfill(status=500, content_type="application/json", body='{"error":"boom"}')
        else:
            await route.continue_()

    await pg_page.route("**/api/accounts", fail_post)
    await pg_page.click("#pgMigrationTransferBtn")
    await pg_page.locator("#pgMigrationError").wait_for(state="visible", timeout=15000)
    assert await pg_page.locator("#pgMigrationModal").is_visible()
    assert await _key(pg_page) is not None


async def test_legacy_import_failure_returns_focus_to_transfer(pg_page, base_url):
    """#490: the Transfer button is disabled while loading, which drops focus to
    <body>. After a failure focus is back on it, so Enter retries."""
    await _boot_with_legacy(pg_page, base_url, json.dumps(LEGACY))
    await pg_page.locator("#pgMigrationModal").wait_for(state="visible", timeout=15000)

    async def fail_post(route):
        if route.request.method == "POST":
            await route.fulfill(status=500, content_type="application/json", body='{"error":"boom"}')
        else:
            await route.continue_()

    await pg_page.route("**/api/accounts", fail_post)
    await pg_page.focus("#pgMigrationTransferBtn")
    await pg_page.keyboard.press("Enter")
    await pg_page.locator("#pgMigrationError").wait_for(state="visible", timeout=15000)

    active = await pg_page.evaluate("() => document.activeElement && document.activeElement.id")
    assert active == "pgMigrationTransferBtn", f"focus was lost to {active!r}"
    assert await pg_page.evaluate("() => document.activeElement !== document.body")
    assert await pg_page.locator("#pgMigrationTransferBtn").is_enabled()

    # Enter now retries from where the user is.
    await pg_page.unroute("**/api/accounts", fail_post)
    await pg_page.keyboard.press("Enter")
    await pg_page.locator("#pgMigrationModal").wait_for(state="hidden", timeout=15000)
    assert await _key(pg_page) is None
    assert any(a["name"] == "Legacy Checking" for a in await _accounts(pg_page, base_url))


async def test_nonempty_db_shows_cleanup_variant(pg_page, base_url):
    await _boot_with_legacy(pg_page, base_url, json.dumps(LEGACY), server_has_data=True)
    await pg_page.locator("#pgLegacyDownloadBtn").wait_for(state="visible", timeout=15000)
    assert await pg_page.locator("#pgLegacyRemoveBtn").is_visible()
    assert not await pg_page.locator("#pgMigrationTransferBtn").is_visible()


async def test_cleanup_download_saves_file_and_removes_key(pg_page, base_url):
    raw = json.dumps(LEGACY)
    await _boot_with_legacy(pg_page, base_url, raw, server_has_data=True)
    await pg_page.locator("#pgLegacyDownloadBtn").wait_for(state="visible", timeout=15000)
    async with pg_page.expect_download() as info:
        await pg_page.click("#pgLegacyDownloadBtn")
    download = await info.value
    assert re.fullmatch(r"myfinances-browser-backup-\d{4}-\d{2}-\d{2}\.json", download.suggested_filename)
    path = await download.path()
    with open(path, encoding="utf-8") as f:
        assert json.load(f) == LEGACY
    await pg_page.locator("#pgMigrationModal").wait_for(state="hidden", timeout=5000)
    assert await _key(pg_page) is None


async def test_cleanup_remove_removes_key(pg_page, base_url):
    await _boot_with_legacy(pg_page, base_url, json.dumps(LEGACY), server_has_data=True)
    await pg_page.locator("#pgLegacyRemoveBtn").wait_for(state="visible", timeout=15000)
    await pg_page.click("#pgLegacyRemoveBtn")
    await pg_page.locator("#pgMigrationModal").wait_for(state="hidden", timeout=5000)
    assert await _key(pg_page) is None


async def test_cleanup_escape_keeps_key(pg_page, base_url):
    await _boot_with_legacy(pg_page, base_url, json.dumps(LEGACY), server_has_data=True)
    await pg_page.locator("#pgLegacyRemoveBtn").wait_for(state="visible", timeout=15000)
    await pg_page.keyboard.press("Escape")
    await pg_page.locator("#pgMigrationModal").wait_for(state="hidden", timeout=5000)
    assert await _key(pg_page) is not None


async def test_unparseable_legacy_key_removed_silently(pg_page, base_url):
    await _boot_with_legacy(pg_page, base_url, "{not json")
    assert not await pg_page.locator("#pgMigrationModal").is_visible()
    assert await _key(pg_page) is None


async def test_legacy_import_remaps_ledger_keys(pg_page, base_url):
    """#520: the legacy transfer goes through replaceForPostgres, so v6 keys
    built from local ids are rewritten to the new server ids and still apply;
    a key whose record isn't in the data is dropped, not stored as an orphan."""
    import copy
    import datetime
    today = datetime.date.today()
    day = f"{today.year}-{today.month:02d}-15"
    legacy = copy.deepcopy(LEGACY)
    legacy["recurringTemplates"] = [{
        "id": 3, "name": "Legacy Rent", "amount": 1500, "frequency": "monthly", "dayOfMonth": 15,
        "type": "subscription", "category": "Housing", "accountId": 2}]
    legacy["ledgerAmountOverrides"] = {
        f"recurring|3|2|{day}": {"amount": -1900, "originalAmount": -1500, "accountId": 2, "date": day},
        f"recurring|999|2|{day}": {"amount": -1, "originalAmount": -1, "accountId": 2, "date": day},
    }
    legacy["ledgerClearedTransactions"] = {f"recurring|3|2|{day}": {"clearedAt": "2025-11-01T12:00:00.000Z"}}

    await _boot_with_legacy(pg_page, base_url, json.dumps(legacy))
    await pg_page.locator("#pgMigrationModal").wait_for(state="visible", timeout=15000)
    await pg_page.click("#pgMigrationTransferBtn")
    await pg_page.locator("#pgMigrationModal").wait_for(state="hidden", timeout=15000)
    await pg_page.reload()
    await pg_page.wait_for_selector('html[data-app-ready="true"]', state="attached", timeout=30000)

    acct_id = next(a["id"] for a in await _accounts(pg_page, base_url) if a["name"] == "Legacy Checking")
    tmpl_id = next(t["id"] for t in await (await pg_page.request.get(f"{base_url}/api/recurring-templates")).json()
                   if t["name"] == "Legacy Rent")
    expected = f"recurring|{tmpl_id}|{acct_id}|{day}"
    overrides = [o["overrideKey"] for o in await (await pg_page.request.get(f"{base_url}/api/ledger-overrides")).json()]
    cleared = [c["clearedKey"] for c in await (await pg_page.request.get(f"{base_url}/api/ledger-cleared")).json()]
    assert overrides == [expected], overrides
    assert cleared == [expected], cleared

    row = await pg_page.evaluate("""async key => {
        const mod = await import('/src/ledgerTransactions.js');
        const r = mod.getLedgerTransactions(window.app).find(t => t.transactionId === key);
        return r ? { amount: r.amount, hasOverride: r.hasOverride, cleared: r.cleared } : null;
    }""", expected)
    assert row == {"amount": -1900, "hasOverride": True, "cleared": True}, row
