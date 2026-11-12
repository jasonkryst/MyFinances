#!/usr/bin/env python3
"""
Shared pytest fixtures and configuration for MyFinances test suite.
Provides common browser setup, test data, and utility functions.
"""

import asyncio
import json
import os
import urllib.error
import urllib.request
from datetime import date

import pytest
from playwright.sync_api import sync_playwright, Browser, Page
from playwright.async_api import async_playwright

# Configuration — override with TEST_BASE_URL env var when Docker occupies port 32900.
BASE_URL = os.environ.get("TEST_BASE_URL", "http://localhost:32900/")
HEADLESS = True


def current_month_iso(day=1):
    """ISO date string for `day` in the real current calendar month.

    Report rendering (e.g. renderReportsSpending) derives "this month" from
    the browser's live `new Date()`, not from seeded fixture data. Tests that
    hardcode a fixed year-month (e.g. '2026-06-01') for data meant to land in
    "this month" silently start failing once the wall clock passes that month.
    Use this helper instead for any seed data that must fall in the current
    report month.
    """
    today = date.today()
    return f"{today.year:04d}-{today.month:02d}-{day:02d}"


# Sync fixtures
@pytest.fixture
def browser() -> Browser:
    """Create a browser instance for sync tests."""
    playwright = sync_playwright().start()
    browser = playwright.chromium.launch(headless=HEADLESS)
    yield browser
    browser.close()
    playwright.stop()


@pytest.fixture
def page(browser) -> Page:
    """Create a new page instance for each test."""
    page = browser.new_page()
    
    # Track console errors and page errors
    page.console_errors = []
    page.page_errors = []
    
    def on_console(msg):
        if msg.type == "error":
            text = msg.text or ""
            if "favicon" not in text.lower():
                page.console_errors.append(text)
    
    page.on("console", on_console)
    page.on("pageerror", lambda e: page.page_errors.append(str(e)))
    page.on("dialog", lambda d: d.accept())
    
    yield page
    page.close()


# ---------------------------------------------------------------------------
# Real-stack harness (v7.0.0): the app has no local storage mode, so every
# browser test runs against the real nginx + Node + Postgres stack, signed in as
# the single test user. `app_page` wipes server data, so NEVER point tests at a
# deployment holding real data.
# ---------------------------------------------------------------------------
TEST_EMAIL = os.environ.get("TEST_EMAIL") or os.environ.get("POSTGRES_TEST_EMAIL", "testuser@example.com")
TEST_PASSWORD = os.environ.get("TEST_PASSWORD") or os.environ.get(
    "POSTGRES_TEST_PASSWORD", "ci-Test-Passphrase-2026!"
)

_API_ROOT = BASE_URL.rstrip("/")
_SESSION_COOKIES: dict = {}  # name -> value; module-level so every fixture shares one login


def _http_json(method, path, body=None, cookies=None):
    """Tiny urllib client. Returns (status, parsed_json_or_None, response_headers)."""
    headers = {"Content-Type": "application/json"}
    if cookies:
        headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in cookies.items())
        if method not in ("GET", "HEAD") and cookies.get("csrf"):
            headers["X-CSRF-Token"] = cookies["csrf"]
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(_API_ROOT + path, data=data, method=method, headers=headers)
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        status = resp.status
    except urllib.error.HTTPError as e:
        resp = e
        status = e.code
    raw = resp.read()
    try:
        parsed = json.loads(raw) if raw else None
    except ValueError:
        parsed = None
    return status, parsed, resp.headers


def _cookies_from(headers):
    out = {}
    for line in headers.get_all("Set-Cookie") or []:
        name, _, rest = line.partition("=")
        if name in ("session", "csrf"):
            out[name] = rest.split(";", 1)[0]
    return out


def _session_cache_path():
    import hashlib
    import tempfile
    key = hashlib.sha256(f"{_API_ROOT}|{TEST_EMAIL}".encode()).hexdigest()[:16]
    return os.path.join(tempfile.gettempdir(), f"myfinances-test-session-{key}.json")


def _read_session_cache():
    """Cookies saved by an earlier pytest process, if the server still accepts them.

    The server's login limiter allows 5 sign-ins per 15 minutes, and every pytest process used
    to log in once, so a few quick invocations locked the harness out. Sharing the session
    across processes (it is the same single test user) avoids that.
    """
    try:
        with open(_session_cache_path(), encoding="utf-8") as f:
            cookies = json.load(f)
    except (OSError, ValueError):
        return None
    if not isinstance(cookies, dict) or "session" not in cookies:
        return None
    status, _, _ = _http_json("GET", "/api/plan-settings", cookies=cookies)
    return cookies if status == 200 else None


def _write_session_cache(cookies):
    try:
        with open(_session_cache_path(), "w", encoding="utf-8") as f:
            json.dump(cookies, f)
    except OSError:
        pass


def _login_or_register():
    """Sign in once and cache the cookies.

    Registers only when the server reports `needsSetup: true` (an empty users
    table). Any other state logs in with TEST_EMAIL/TEST_PASSWORD; if that fails
    the whole session aborts and nothing is wiped, so a real deployment with
    different credentials can never be reset by this harness.
    """
    cached = _read_session_cache()
    if cached:
        _SESSION_COOKIES.clear()
        _SESSION_COOKIES.update(cached)
        return _SESSION_COOKIES
    status, body, _ = _http_json("GET", "/auth/setup-status")
    creds = {"email": TEST_EMAIL, "password": TEST_PASSWORD}
    if status == 200 and isinstance(body, dict) and body.get("needsSetup") is True:
        status, body, headers = _http_json("POST", "/auth/register", creds)
        if status >= 300:
            pytest.exit(f"Test harness: POST /auth/register failed ({status}): {body}", returncode=2)
    else:
        status, body, headers = _http_json("POST", "/auth/login", creds)
        if status >= 300:
            pytest.exit(
                f"Test harness: login as {TEST_EMAIL} failed ({status}): {body}. "
                "Set POSTGRES_TEST_EMAIL/POSTGRES_TEST_PASSWORD for this stack. Nothing was modified.",
                returncode=2,
            )
    cookies = _cookies_from(headers)
    if "session" not in cookies:
        pytest.exit("Test harness: auth response carried no session cookie", returncode=2)
    _SESSION_COOKIES.clear()
    _SESSION_COOKIES.update(cookies)
    _write_session_cache(cookies)
    return _SESSION_COOKIES


@pytest.fixture(scope="session")
def stack_user():
    """Cookies (`session`, `csrf`) for the test user, logged in once per pytest session."""
    return _login_or_register()


def _valid_session_cookies():
    """Cached cookies, after re-logging in if the server answers 401 (blocking I/O)."""
    if not _SESSION_COOKIES:
        _login_or_register()
    status, _, _ = _http_json("GET", "/api/plan-settings", cookies=_SESSION_COOKIES)
    if status == 401:
        _login_or_register()
    return [{"name": n, "value": v, "url": BASE_URL} for n, v in _SESSION_COOKIES.items()]


def ensure_session(context) -> None:
    """Install the cached auth cookies into a browser context.

    If the server no longer accepts the cached session (401 on a cheap
    authenticated GET) it logs in again and refreshes the cache first.
    """
    context.add_cookies(_valid_session_cookies())


async def ensure_session_async(context) -> None:
    """Async twin of ensure_session (the blocking HTTP runs in a worker thread)."""
    cookies = await asyncio.to_thread(_valid_session_cookies)
    await context.add_cookies(cookies)


_RESET_JS = """
    async () => {
        const { pgDeleteAll } = await import('/src/postgresSync.js');
        await pgDeleteAll(window.app);
        const csrf = (document.cookie.split('; ').find(c => c.startsWith('csrf=')) || '').slice(5);
        const r = await fetch('/api/settings/reconciliationAdjustsBalance', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
            body: JSON.stringify({ value: false }),
        });
        if (!r.ok) throw new Error('settings PUT failed: ' + r.status);
    }
"""

_SEED_JS = """
    async ({ state, seedAdjusts }) => {
        const { sanitizeParsedState } = await import('/src/sanitizers.js');
        const { replaceForPostgres } = await import('/src/postgresImport.js');
        const input = { ...state };
        if (seedAdjusts) {
            input.settings = [...(state.settings || []), { key: 'reconciliationAdjustsBalance', value: false }];
        }
        const clean = sanitizeParsedState(input);
        await replaceForPostgres(window.app, clean, {
            paymentStrategy: state.strategy,
            monthlyPayment: state.monthlyPayment,
        });
    }
"""


def reset_server_state(page) -> None:
    """Wipe all server data (awaited, not fire-and-forget), keep the wizard from
    blocking, then reload so the app re-reads the now-empty server."""
    page.evaluate(_RESET_JS)
    page.reload()
    # Idempotent: a wrapped reload already waited, an unwrapped one has not.
    wait_for_app_ready(page)


def seed_state(page, state: dict, *, reload=True) -> None:
    """Replace all server data with `state` (same shape as a JSON export) through
    the real import path, then reload so the app loads it back from the server."""
    has_adjust = any(
        isinstance(s, dict) and s.get("key") == "reconciliationAdjustsBalance"
        for s in (state.get("settings") or [])
    )
    page.evaluate(_SEED_JS, {"state": state, "seedAdjusts": not has_adjust})
    if reload:
        page.reload()


async def reset_server_state_async(page) -> None:
    """Async twin of reset_server_state (wipe the server, then reload)."""
    await page.evaluate(_RESET_JS)
    await page.reload()
    await page.wait_for_selector('html[data-app-ready="true"]', state="attached", timeout=30000)
    await page.wait_for_function('() => !!window.app', timeout=30000)


async def seed_state_async(page, state: dict, *, reload=True) -> None:
    """Async twin of seed_state for async_app_page tests."""
    has_adjust = any(
        isinstance(s, dict) and s.get("key") == "reconciliationAdjustsBalance"
        for s in (state.get("settings") or [])
    )
    await page.evaluate(_SEED_JS, {"state": state, "seedAdjusts": not has_adjust})
    if reload:
        await page.reload()
        await page.wait_for_selector('html[data-app-ready="true"]', state="attached", timeout=30000)
        await page.wait_for_function('() => !!window.app', timeout=30000)


_APP_STATE_KEYS = (
    "accounts", "persons", "debts", "incomes", "bonuses", "bills", "expenses",
    "ledgerAmountOverrides", "ledgerClearedTransactions", "recurringTemplates",
    "emergencyFunds", "sinkingFunds", "reconciliations", "planHistory",
    "retirementSnapshots", "transfers", "manualTransactions", "balanceHistory", "retirementTargetDate",
    "homePurchasePlan", "budgetCategories", "monthlySnapshots",
    "netWorthMilestonesAwarded", "perMonthStimulus",
)


def seed_state_from_app(page) -> None:
    """Persist whatever a test just built in `window.app.*` (in-memory) to the server.

    For tests whose seed is a JS snippet that assigns `app.accounts = [...]` etc.: snapshot
    those collections (same keys as a JSON export), push them through `seed_state`, and
    reload so the app re-reads the server's copy. Dates are serialized by JSON.stringify.
    """
    import json as _json
    raw = page.evaluate(
        "(keys) => JSON.stringify(Object.fromEntries(keys.map(k => [k, window.app[k]])))",
        list(_APP_STATE_KEYS))
    seed_state(page, _json.loads(raw))


_LOCAL_PARENT_IDS = iter(range(1_900_000_000, 2_000_000_000))


def accept_creates_for_local_parents(page, *patterns):
    """For tests that inject in-memory-only parent records (e.g. an account the server
    never saw) and then create a child of it. Each POST to `patterns` goes to the real
    server first; only when the server rejects it with 400 (the parent id isn't one it
    owns) is it answered as a successful create, echoing the body with a fresh id.

    Since #460 a create the server rejects is never added to app.*, so without this the
    child would vanish. A POST with real parents still persists for real. Prefer
    seed_state for new tests; this keeps the older in-memory tests testing client logic.
    """
    def handler(route):
        request = route.request
        if request.method != 'POST':
            route.continue_()
            return
        response = route.fetch()
        if response.status != 400:
            route.fulfill(response=response)
            return
        body = dict(request.post_data_json or {})
        body['id'] = next(_LOCAL_PARENT_IDS)
        body['rowVersion'] = 1
        route.fulfill(status=201, content_type='application/json', body=json.dumps(body))

    for pattern in patterns:
        page.route(pattern, handler)


def wait_for_api(page, path, check, timeout=10.0):
    """Poll an authenticated GET `path` from the page until `check(json)` is truthy.

    Mutations are fire-and-forget PUT/PATCH calls; a test that reloads right after
    one can race it. Call this first to be sure the server holds the change (the
    predicate runs in Python because the app's CSP forbids eval in the page).
    Returns the matching payload.
    """
    import time
    deadline = time.monotonic() + timeout
    data = None
    while time.monotonic() < deadline:
        data = page.evaluate(
            "async (p) => { const r = await fetch(p); return r.ok ? await r.json() : null; }", path)
        if data is not None and check(data):
            return data
        page.wait_for_timeout(100)
    raise AssertionError(f"{path} never satisfied the expected condition; last response: {data!r}")


def _wrap_reload(page):
    # ~100 tests reload after seeding; make every reload wait for init too,
    # rather than patching each call site.
    original = page.reload

    def _reload_and_wait(*args, **kwargs):
        response = original(*args, **kwargs)
        wait_for_app_ready(page)
        return response

    page.reload = _reload_and_wait


@pytest.fixture
def app_page(page, stack_user) -> Page:
    """Signed-in page on the real stack with an empty server."""
    ensure_session(page.context)
    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
    wait_for_app_ready(page)
    _wrap_reload(page)
    reset_server_state(page)
    return page


def wait_for_app_ready(page, timeout=30000):
    """Wait until src/app.js has finished `await window.app.init()` (issue #422).

    window.app is assigned *before* init() resolves, and networkidle can fire before
    the DOMContentLoaded handler even runs under load — so waiting on either alone
    races. Call this after any page.reload()/goto() too.
    """
    page.wait_for_selector('html[data-app-ready="true"]', state='attached', timeout=timeout)
    page.wait_for_function('() => !!window.app', timeout=timeout)


# Async fixtures
@pytest.fixture
async def async_browser():
    """Create a browser instance for async tests."""
    playwright = await async_playwright().start()
    browser = await playwright.chromium.launch(headless=HEADLESS)
    yield browser
    await browser.close()
    await playwright.stop()


@pytest.fixture
async def async_page(async_browser):
    """Create a new page instance for async tests."""
    page = await async_browser.new_page()
    
    # Track console and page errors
    page.console_errors = []
    page.page_errors = []
    
    def on_console(msg):
        if msg.type == "error":
            text = msg.text or ""
            if "favicon" not in text.lower():
                page.console_errors.append(text)
    
    page.on("console", on_console)
    page.on("pageerror", lambda e: page.page_errors.append(str(e)))
    page.on("dialog", lambda d: d.accept())
    
    yield page
    await page.close()


@pytest.fixture
async def async_app_page(async_page, stack_user):
    """Signed-in async page on the real stack with an empty server."""
    ready = 'html[data-app-ready="true"]'
    await ensure_session_async(async_page.context)
    await async_page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
    await async_page.wait_for_selector(ready, state="attached", timeout=30000)
    await async_page.evaluate(_RESET_JS)
    await async_page.reload()
    await async_page.wait_for_selector(ready, state="attached", timeout=30000)
    return async_page


# Test data fixtures
@pytest.fixture
def account_data():
    """Standard account test data."""
    return {
        "name": "Test Checking",
        "type": "Checking",
        "balance": "5000"
    }


@pytest.fixture
def debt_data():
    """Standard debt test data."""
    return {
        "name": "Test Credit Card",
        "type": "creditCard",
        "balance": "2500",
        "interest_rate": "18.5",
        "min_payment": "100",
        "category": "Credit Card"
    }


@pytest.fixture
def income_data():
    """Standard income test data."""
    return {
        "name": "Salary",
        "amount": "5000",
        "first_date": "2026-05-01",
        "frequency": "monthly"
    }


@pytest.fixture
def expense_data():
    """Standard expense test data — date uses the current month so it appears in the default month view."""
    today = date.today()
    return {
        "name": "Groceries",
        "amount": "300",
        "date": today.strftime("%Y-%m-15"),
        "category": "Food"
    }


@pytest.fixture
def recurring_data():
    """Standard recurring transaction test data."""
    return {
        "name": "Netflix",
        "amount": "15.99",
        "type": "Subscription",
        "frequency": "monthly",
        "start_date": "2026-05-01"
    }


@pytest.fixture
def health_data():
    """App state for exercising all six health dashboard metric cards.

    Inject via page.evaluate before calling app.switchPage('health').
    Produces: ~4% DTI (Healthy), Surplus cash flow, no emergency fund.
    """
    return {
        "income": {"id": 1, "name": "Salary", "amount": 5000,
                   "firstPayDate": "2026-06-01", "frequency": "monthly"},
        "debt": {"id": 2, "name": "Credit Card", "accountBalance": 2500,
                 "originalBalance": 2500, "minimumPayment": 200,
                 "interestRate": 18, "dueDate": 15, "debtType": "creditCard"},
        "bill": {"id": 3, "name": "Rent", "amount": 1200,
                 "dueDay": 1, "category": "Housing"},
    }


# Utility functions
def open_settings(page):
    """Open the Settings modal (#71: theme, storage backend, and language
    all live here now) and wait for it to be visible before interacting
    with any control inside it."""
    page.evaluate("() => document.getElementById('settingsBtn').click()")
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)


def close_settings(page):
    """Close the Settings modal via its Done button."""
    page.click('#settingsModalDoneBtn')
    page.wait_for_selector('#settingsModal', state='hidden', timeout=5000)


def switch_settings_tab(page, tab):
    """Click a Settings modal tab (#322/#456: 'appearance'/'data'/'notifications'/'advanced'/'security')."""
    page.click(f'[data-settings-tab="{tab}"]')


def open_data_transfer(page):
    """Open the Backup & Restore modal (#exportJsonBtn/#importJsonBtn live
    here now) and wait for it to be visible before interacting with any
    control inside it."""
    page.evaluate("() => document.getElementById('dataTransferBtn').click()")
    page.wait_for_selector('#dataTransferModal.flex-visible', timeout=5000)


def close_data_transfer(page):
    """Close the Backup & Restore modal via its × close button."""
    page.click('#dataTransferModalCloseBtn')
    page.wait_for_selector('#dataTransferModal', state='hidden', timeout=5000)


def assert_no_errors(page):
    """Assert that page has no console or page errors."""
    assert len(page.console_errors) == 0, f"Console errors: {page.console_errors}"
    assert len(page.page_errors) == 0, f"Page errors: {page.page_errors}"


# ── Async add-form submits (issue #592) ──────────────────────────────────────
# Since v7, addAccount/addDebt push the record with a temporary Date.now() id,
# then await the server POST before swapping in the real id, re-rendering and
# resetting the form. A test that acts straight after clicking Submit can pick
# the temporary id in a dropdown (the server then 400s the linked record) or
# toggle the still-open debt form shut. These helpers click Submit and wait for
# the end of the add, signalled by state that changes only after the awaits:
#   - accounts: addAccount resets #accountForm, so #accountName is empty again;
#   - debts: addDebt and saveEdit both end in cancelEdit(), which resets the
#     form and hides #debtFormBody.
# tests/features/test_async_submit_guard.py fails CI when a raw Submit click on
# either form is not followed by a wait.
ACCOUNT_SUBMIT_SETTLED_JS = "() => document.getElementById('accountName')?.value === ''"
DEBT_SUBMIT_SETTLED_JS = (
    "() => document.getElementById('debtFormBody')?.hidden === true"
    " && document.getElementById('debtName')?.value === ''"
)


def submit_account_form(page, timeout=10000):
    """Click Add Account and wait until the account is saved and has its server id."""
    page.click('#accountFormSubmit')
    page.wait_for_function(ACCOUNT_SUBMIT_SETTLED_JS, timeout=timeout)


async def submit_account_form_async(page, timeout=10000):
    """Async twin of submit_account_form."""
    await page.click('#accountFormSubmit')
    await page.wait_for_function(ACCOUNT_SUBMIT_SETTLED_JS, timeout=timeout)


def submit_debt_form(page, timeout=10000):
    """Click the debt form's Submit (add or edit) and wait until the save finishes and the form closes."""
    page.click('#debtFormSubmit')
    page.wait_for_function(DEBT_SUBMIT_SETTLED_JS, timeout=timeout)


async def submit_debt_form_async(page, timeout=10000):
    """Async twin of submit_debt_form."""
    await page.click('#debtFormSubmit')
    await page.wait_for_function(DEBT_SUBMIT_SETTLED_JS, timeout=timeout)


def open_debt_form(page, timeout=5000):
    """Open the Add Debt form if it is closed. Never clicks the toggle when it is already open,
    since a click on an open form closes it."""
    if page.locator('#debtFormBody[hidden]').count():
        page.click('#debtFormToggle')
    page.wait_for_selector('#debtFormBody:not([hidden])', timeout=timeout)


async def open_debt_form_async(page, timeout=5000):
    """Async twin of open_debt_form."""
    if await page.locator('#debtFormBody[hidden]').count():
        await page.click('#debtFormToggle')
    await page.wait_for_selector('#debtFormBody:not([hidden])', timeout=timeout)


def create_account(page, account_data):
    """Helper to create an account via UI."""
    page.click('button[data-page="accounts"]')
    page.fill('#accountName', account_data["name"])
    page.select_option('#accountType', label=account_data["type"])
    page.fill('#accountStartingBalance', account_data["balance"])
    submit_account_form(page)
    page.wait_for_selector(f'#accountList >> text={account_data["name"]}', timeout=10000)


def create_debt(page, debt_data):
    """Helper to create a debt via UI."""
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    open_debt_form(page)
    page.fill('#debtName', debt_data["name"])
    page.select_option('#debtType', debt_data["type"])
    page.fill('#accountBalance', debt_data["balance"])
    page.fill('#interestRate', debt_data["interest_rate"])
    page.fill('#minimumPayment', debt_data["min_payment"])
    if debt_data["type"] == "creditCard":
        page.fill('#dueDate', '15')
    submit_debt_form(page)
    page.wait_for_selector(f'#debtsList >> text={debt_data["name"]}', timeout=10000)


def create_income(page, income_data):
    """Helper to create income source via UI."""
    page.click('button[data-page="income"]')
    page.fill('#incomeName', income_data["name"])
    page.fill('#incomeAmount', income_data["amount"])
    page.fill('#incomeFirstDate', income_data["first_date"])
    page.select_option('#incomeFrequency', income_data["frequency"])
    page.click('#incomeFormSubmit')
    page.wait_for_selector(f'#incomeList >> text={income_data["name"]}', timeout=10000)


# Pytest configuration hooks
def pytest_configure(config):
    """Configure pytest."""
    config.addinivalue_line(
        "markers", 
        "security: security tests (XSS, CSP, validation)"
    )
    config.addinivalue_line(
        "markers",
        "feature: feature-specific tests"
    )
    config.addinivalue_line(
        "markers",
        "ui: UI/UX tests (mobile, modals, dark mode)"
    )
    config.addinivalue_line(
        "markers",
        "integration: end-to-end workflow tests"
    )
    config.addinivalue_line(
        "markers",
        "slow: slow running tests"
    )
    config.addinivalue_line(
        "markers",
        "a11y: standalone accessibility audit checks (run_a11y_audit.py findings)"
    )
