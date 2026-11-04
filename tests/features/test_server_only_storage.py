"""Server-only storage (v7.0.0): the app boots against the PostgreSQL server and
nothing else. Covers the boot probe (spec §5 step 1), the "Can't reach your
server" gate, the stale backend preference cleanup and the Settings storage line.
"""
import json
import os
import tempfile

import pytest

from tests.conftest import (
    BASE_URL, open_data_transfer, open_settings, reset_server_state, seed_state,
    switch_settings_tab, wait_for_api, wait_for_app_ready,
)

ACCOUNT = {"id": 1, "name": "Server Checking", "type": "Checking", "balance": 1200}
DEBT = {"id": 1, "name": "Server Visa", "balance": 900, "interestRate": 19.9,
        "minimumPayment": 35, "debtType": "creditCard"}


def _seed_basic(page):
    seed_state(page, {"accounts": [ACCOUNT], "debts": [DEBT]})


def _goto_accounts(page):
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountList .acct-card', timeout=10000)


@pytest.mark.feature
def test_added_account_persists_across_reload(app_page):
    page = app_page
    page.click('button[data-page="accounts"]')
    if not page.is_visible('#accountName'):
        page.click('#accountFormToggle')
    page.fill('#accountName', 'Reload Savings')
    page.select_option('#accountType', label='Savings')
    page.fill('#accountStartingBalance', '4321')
    page.click('#accountFormSubmit')
    page.wait_for_selector('#accountList >> text=Reload Savings', timeout=10000)

    page.reload()
    _goto_accounts(page)
    assert 'Reload Savings' in page.inner_text('#accountList')


@pytest.mark.feature
def test_json_export_import_round_trip(app_page):
    page = app_page
    _seed_basic(page)

    with page.expect_download() as dl:
        page.evaluate("() => window.app.exportAllJSON()")
    path = dl.value.path()
    with open(path, encoding="utf-8") as f:
        exported = json.load(f)
    assert [a["name"] for a in exported["accounts"]] == ["Server Checking"]

    reset_server_state(page)
    assert page.evaluate("() => window.app.accounts.length") == 0

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(exported, f)
        temp_file = f.name
    try:
        open_data_transfer(page)
        page.click('[data-dt-tab="import"]')
        page.click('#importJsonBtn')
        page.wait_for_selector('#importJsonInput', state='attached', timeout=5000)
        page.set_input_files('#importJsonInput', temp_file)
        page.wait_for_selector('#importModeChoice:not(.hidden), #importResultBanner:not(.hidden)', timeout=5000)
        if page.is_visible('#importModeChoice'):
            page.click('#importModeReplaceBtn')
        page.wait_for_selector('#importResultBanner:not(.hidden)', timeout=15000)
        assert 'target-result--error' not in (page.get_attribute('#importResultBanner', 'class') or ''), \
            page.inner_text('#importResultBanner')
    finally:
        os.unlink(temp_file)

    # The server, not just memory, holds the imported records.
    page.reload()
    assert page.evaluate("() => window.app.accounts.map(a => a.name)") == ["Server Checking"]
    assert page.evaluate("() => window.app.debts.map(d => d.name)") == ["Server Visa"]


@pytest.mark.feature
def test_settings_shows_server_storage_only(app_page):
    page = app_page
    open_settings(page)
    switch_settings_tab(page, 'data')
    assert page.is_visible('#settingStorageInfo')
    assert 'PostgreSQL' in page.inner_text('#settingStorageInfo')
    assert page.locator('#settingStorageBackend').count() == 0
    assert page.locator('#pgSwitchConfirmModal').count() == 0


@pytest.mark.feature
@pytest.mark.parametrize("stale", ["local", "session"])
def test_stale_backend_preference_ignored_and_removed(app_page, stale):
    page = app_page
    _seed_basic(page)
    page.context.add_init_script(
        "try { localStorage.setItem('debtTrackerStorageBackend', %s); } catch (e) {}" % json.dumps(stale))
    page.reload()
    assert page.evaluate("() => window.app.accounts.map(a => a.name)") == ["Server Checking"]
    assert page.evaluate("() => localStorage.getItem('debtTrackerStorageBackend')") is None
    assert page.is_hidden('#serverUnreachableGate')
    assert page.is_hidden('#loginGate')


@pytest.mark.feature
def test_reload_does_not_hit_setup_status(app_page):
    page = app_page
    seen = []
    page.on("request", lambda r: seen.append(r.url) if "/auth/setup-status" in r.url else None)
    page.reload()
    page.wait_for_load_state("networkidle")
    assert seen == [], f"signed-in boot must not call the rate-limited setup-status: {seen}"


# Routes are installed on the context, not the page: after the first load the
# service worker controls the page and proxies /api fetches, and page.route()
# does not see requests a service worker makes.


def _assert_gate_up_without_data(page):
    page.wait_for_selector('#serverUnreachableGate', state='visible', timeout=15000)
    assert page.locator('html[data-app-ready="true"]').count() == 1
    assert page.locator('#debtsList .debt-card').count() == 0
    assert page.locator('#accountList .acct-card').count() == 0
    assert page.is_hidden('#loginGate')
    gate = page.locator('#serverUnreachableGate')
    assert gate.get_attribute('role') == 'alertdialog'
    assert gate.get_attribute('aria-labelledby')
    assert page.is_visible('#serverUnreachableRetryBtn')


@pytest.mark.feature
def test_unreachable_when_probe_aborted(app_page):
    page = app_page
    _seed_basic(page)
    page.context.route('**/api/plan-settings', lambda route: route.abort())
    page.reload()
    _assert_gate_up_without_data(page)

    page.context.unroute('**/api/plan-settings')
    page.click('#serverUnreachableRetryBtn')
    page.wait_for_selector('#serverUnreachableGate', state='hidden', timeout=15000)
    page.wait_for_function("() => window.app.accounts.length === 1", timeout=10000)
    _goto_accounts(page)
    assert 'Server Checking' in page.inner_text('#accountList')


@pytest.mark.feature
def test_retry_while_still_unreachable_keeps_gate(app_page):
    page = app_page
    page.context.route('**/api/plan-settings', lambda route: route.abort())
    page.reload()
    _assert_gate_up_without_data(page)
    page.click('#serverUnreachableRetryBtn')
    page.wait_for_function(
        "() => document.getElementById('serverUnreachableStatus').textContent.trim().length > 0",
        timeout=10000)
    assert page.is_visible('#serverUnreachableGate')
    assert page.locator('#serverUnreachableRetryBtn').is_enabled()
    assert page.get_attribute('#serverUnreachableStatus', 'aria-live') == 'polite'


@pytest.mark.feature
def test_unreachable_on_502(app_page):
    page = app_page
    _seed_basic(page)
    page.context.route('**/api/plan-settings',
               lambda route: route.fulfill(status=502, content_type='text/html', body='<html>Bad Gateway</html>'))
    page.reload()
    _assert_gate_up_without_data(page)


@pytest.mark.feature
def test_unreachable_when_load_fails(app_page):
    page = app_page
    _seed_basic(page)
    page.context.route('**/api/debts', lambda route: route.fulfill(
        status=500, content_type='application/json', body='{"error":"INTERNAL"}'))
    page.reload()
    _assert_gate_up_without_data(page)

    page.context.unroute('**/api/debts')
    page.click('#serverUnreachableRetryBtn')
    page.wait_for_selector('#serverUnreachableGate', state='hidden', timeout=15000)
    page.wait_for_function("() => window.app.debts.length === 1", timeout=10000)


@pytest.mark.feature
def test_session_expiring_during_load_shows_login_gate(app_page):
    """A 401 from the load (session expired after the probe) re-probes and
    shows the login gate, not "Can't reach your server"."""
    page = app_page
    _seed_basic(page)
    state = {"done": False}

    def expire_once(route):
        if state["done"]:
            route.continue_()
            return
        state["done"] = True
        page.context.clear_cookies()  # the session really is gone from here on
        route.fulfill(status=401, content_type='application/json', body='{"error":"UNAUTHENTICATED"}')

    page.context.route('**/api/debts', expire_once)
    page.reload()
    page.wait_for_selector('#loginGate', state='visible', timeout=15000)
    assert page.is_hidden('#serverUnreachableGate')
    assert page.locator('#accountList .acct-card').count() == 0


@pytest.mark.feature
def test_no_session_shows_login_gate(app_page):
    page = app_page
    page.context.clear_cookies()
    page.goto(BASE_URL)
    wait_for_app_ready(page)
    page.wait_for_selector('#loginGate', state='visible', timeout=15000)
    assert page.is_hidden('#serverUnreachableGate')


# Device-preference / transient-UI keys that may live in browser storage (spec section 3).
# Collapsible open-state is held in memory by utils.js (no storage key), so there is no
# prefix to match. Mirrors ALLOWED_KEYS in tests/security/test_no_browser_financial_storage.py.
ALLOWED_LOCAL_KEYS = {
    'debtTrackerTheme', 'debtTrackerLocale', 'debtTrackerCurrency',
    'debtTrackerLastSeenVersion', 'debtTrackerLedgerFilters', 'ledgerHiddenColumns',
    'debtTrackerReconInProgress',
}


@pytest.mark.feature
def test_no_financial_keys_after_crud_pass(app_page):
    from tests.conftest import create_account, create_debt

    page = app_page
    create_account(page, {"name": "Storage Checking", "type": "Checking", "balance": "5000"})
    create_debt(page, {"name": "Storage Visa", "type": "creditCard", "balance": "2500",
                       "interest_rate": "18.5", "min_payment": "100"})
    page.click('button[data-page="income"]')
    page.wait_for_selector('#incomeSection.active', timeout=5000)
    page.fill('#incomeName', 'Storage Salary')
    page.fill('#incomeAmount', '5000')
    page.fill('#incomeFirstDate', '2026-05-01')
    page.select_option('#incomeFrequency', 'monthly')
    page.select_option('#incomeAccount', index=1)
    page.click('#incomeFormSubmit')
    page.wait_for_selector('#incomeList >> text=Storage Salary', timeout=10000)

    # Recurring template
    page.click('button[data-page="recurring"]')
    page.wait_for_selector('#recurringSection.active', timeout=5000)
    page.click('#recurringFormToggle')
    page.wait_for_selector('#recurringFormBody:not([hidden])', timeout=5000)
    acct_id = page.evaluate("() => String(window.app.accounts.find(a => a.name === 'Storage Checking').id)")
    page.fill('#recurringName', 'Storage Netflix')
    page.select_option('#recurringType', 'subscription')
    page.fill('#recurringAmount', '15.99')
    page.select_option('#recurringFrequency', 'monthly')
    page.fill('#recurringStartDate', '2026-05-01')
    page.select_option('#recurringAccount', acct_id)
    page.click('#recurringFormSubmit')
    page.wait_for_selector('#recurringList .recurring-card-name', timeout=10000)

    # Emergency fund
    page.click('button[data-page="savings"]')
    page.wait_for_selector('#savingsSection.active', timeout=5000)
    page.click('.savings-subtab-btn[data-savings-subtab="emergency"]')
    toggle = page.query_selector('#emergencyFormToggle')
    if toggle:
        toggle.click()
        page.wait_for_selector('#emergencyFormBody.visible', timeout=3000)
    page.select_option('#emergencyAccount', value=acct_id)
    page.fill('#emergencyTarget', '10000')
    page.fill('#emergencyCurrent', '1000')
    page.fill('#emergencyContribution', '500')
    page.click('#emergencyFormSubmit')
    wait_for_api(page, '/api/emergency-funds', lambda rows: len(rows) > 0)

    # Every record must be on the server, not just rendered from memory.
    for path, name in (('/api/accounts', 'Storage Checking'), ('/api/debts', 'Storage Visa'),
                       ('/api/incomes', 'Storage Salary'),
                       ('/api/recurring-templates', 'Storage Netflix')):
        wait_for_api(page, path, lambda rows, n=name: any(r.get('name') == n for r in rows))

    def check_storage():
        # A non-empty localStorage keeps the allowlist check from passing vacuously.
        page.evaluate("() => localStorage.setItem('debtTrackerLocale', 'en')")
        keys = set(page.evaluate("() => Object.keys(localStorage)"))
        assert keys, "localStorage unexpectedly empty"
        assert keys <= ALLOWED_LOCAL_KEYS, f"unexpected localStorage keys: {sorted(keys - ALLOWED_LOCAL_KEYS)}"
        assert page.evaluate("() => sessionStorage.length") == 0

    check_storage()
    page.reload()
    check_storage()
