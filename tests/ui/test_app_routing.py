"""Path-address routing (#730): nested deep links must load the app.

Later routing tasks append to this file. Shared helpers live at the top.
"""

from tests.conftest import BASE_URL, wait_for_app_ready

BASE = BASE_URL if BASE_URL.endswith("/") else BASE_URL + "/"


def test_nested_path_boots_without_errors(app_page):
    page = app_page
    errors = []
    bad_scripts = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))

    def check_response(resp):
        if "/src/" in resp.url and resp.url.endswith(".js") and resp.status == 200:
            ctype = resp.headers.get("content-type", "")
            if "javascript" not in ctype:
                bad_scripts.append((resp.url, resp.status, ctype))

    page.on("response", check_response)
    page.goto(BASE + "liabilities/expenses", wait_until="networkidle", timeout=60000)
    wait_for_app_ready(page)

    assert page.evaluate("() => !!window.app")
    assert page.evaluate("() => location.pathname") == "/liabilities/expenses", "boot must not rewrite the address"
    css = page.evaluate("""() => Promise.all([...document.querySelectorAll('link[rel=stylesheet]')]
        .map(l => fetch(l.href).then(r => r.headers.get('content-type'))))""")
    assert css and all("text/css" in (c or "") for c in css), f"stylesheet content types: {css}"
    assert not bad_scripts, f"non-JavaScript src responses: {bad_scripts}"
    assert not errors, f"console errors on a nested path: {errors}"


def test_skip_link_stays_on_nested_path(app_page):
    page = app_page
    page.goto(BASE + "liabilities/expenses", wait_until="networkidle", timeout=60000)
    wait_for_app_ready(page)
    page.focus(".skip-link")
    page.keyboard.press("Enter")
    assert page.evaluate("() => location.pathname") == "/liabilities/expenses"
    assert page.evaluate("() => document.activeElement && document.activeElement.id") == "main"


# ── Task 3: page addresses, Back/Forward, boot ──────────────────────────────


def _path(page):
    return page.evaluate("() => location.pathname + location.search")


def _active(page, section_id):
    return page.evaluate("(id) => !!document.getElementById(id)?.classList.contains('active')", section_id)


def _history_length(page):
    return page.evaluate("() => history.length")


def _nav(page, name, section_id):
    page.click(f'.page-button[data-page="{name}"]')
    page.wait_for_selector(f'#{section_id}.active', timeout=5000)


def test_nav_click_sets_address(app_page):
    page = app_page
    _nav(page, "strategy", "strategySection")
    assert page.url.endswith("/plan")


def test_back_and_forward_between_pages(app_page):
    page = app_page
    _nav(page, "ledger", "ledgerSection")
    _nav(page, "reports", "reportsSection")
    assert _path(page) == "/reports/calendar"
    page.go_back()
    page.wait_for_selector("#ledgerSection.active", timeout=5000)
    assert _path(page) == "/ledger"
    page.go_forward()
    page.wait_for_selector("#reportsSection.active", timeout=5000)
    assert _path(page) == "/reports/calendar"
    assert not _active(page, "ledgerSection")


def test_refresh_keeps_page(app_page):
    page = app_page
    _nav(page, "ledger", "ledgerSection")
    page.reload()
    wait_for_app_ready(page)
    page.wait_for_selector("#ledgerSection.active", timeout=5000)
    assert _path(page) == "/ledger"
    assert not _active(page, "healthSection")


def test_same_page_click_adds_no_history(app_page):
    page = app_page
    _nav(page, "ledger", "ledgerSection")
    before = _history_length(page)
    assert _path(page) == "/ledger"
    _nav(page, "ledger", "ledgerSection")
    assert _history_length(page) == before
    assert _path(page) == "/ledger"


def test_forward_survives_back(app_page):
    page = app_page
    _nav(page, "ledger", "ledgerSection")
    _nav(page, "reports", "reportsSection")
    length = _history_length(page)
    page.go_back()
    page.wait_for_selector("#ledgerSection.active", timeout=5000)
    assert _history_length(page) == length, "applying a popped address must not push"
    page.go_forward()
    page.wait_for_selector("#reportsSection.active", timeout=5000)
    assert _path(page) == "/reports/calendar"


def test_legacy_page_param_redirects(app_page):
    page = app_page
    before = _history_length(page)
    page.goto(BASE + "?page=strategy", wait_until="networkidle", timeout=60000)
    wait_for_app_ready(page)
    page.wait_for_selector("#strategySection.active", timeout=5000)
    page.wait_for_function("() => location.pathname === '/plan'", timeout=5000)
    assert page.url.endswith("/plan")
    # The goto adds one entry; the rewrite to /plan replaces it.
    assert _history_length(page) == before + 1


def test_unknown_path_goes_home(app_page):
    page = app_page
    page.goto(BASE + "nope", wait_until="networkidle", timeout=60000)
    wait_for_app_ready(page)
    page.wait_for_function("() => location.pathname === '/'", timeout=5000)
    assert _path(page) == "/"
    assert _active(page, "healthSection")


def test_back_from_ledger_clears_breadcrumb(app_page):
    from tests.ui.test_spending_ui import _seed_linked_and_navigate

    page = app_page
    _seed_linked_and_navigate(page)
    page.click('[data-spending-cat="Food"]')
    page.wait_for_selector("#spendingDrilldownModal:not(.hidden)", timeout=5000)
    page.click("#spendingDrilldownViewLedgerBtn")
    page.wait_for_selector("#ledgerSection.active", timeout=5000)
    assert page.evaluate("() => app._ledgerCrossNavLabel") is not None
    assert _path(page) == "/ledger"
    page.go_back()
    page.wait_for_selector("#reportsSection.active", timeout=5000)
    assert page.evaluate("() => app._ledgerCrossNavLabel") is None


def test_signed_out_deep_link_lands_after_sign_in(browser, stack_user):
    from tests.conftest import TEST_EMAIL, TEST_PASSWORD

    context = browser.new_context(service_workers="block")
    try:
        page = context.new_page()
        page.goto(BASE + "ledger", wait_until="networkidle", timeout=60000)
        page.wait_for_selector("#loginGateEmail", state="visible", timeout=30000)
        page.fill("#loginGateEmail", TEST_EMAIL)
        page.fill("#loginGatePassword", TEST_PASSWORD)
        page.click("#loginGateSubmit")
        page.wait_for_selector("#loginGate", state="hidden", timeout=15000)
        wait_for_app_ready(page)
        page.wait_for_selector("#ledgerSection.active", timeout=10000)
        assert _path(page) == "/ledger"
    finally:
        context.close()

    context = browser.new_context(service_workers="block")
    try:
        page = context.new_page()
        page.goto(BASE + "?reset_token=x", wait_until="networkidle", timeout=60000)
        page.wait_for_selector("#loginGateResetForm", state="visible", timeout=30000)
        assert page.is_hidden("#loginGateForm")
    finally:
        context.close()


def test_command_palette_navigation_pushes(app_page):
    page = app_page
    _nav(page, "ledger", "ledgerSection")
    page.keyboard.press("Control+k")
    page.wait_for_selector("#commandPaletteOverlay:not(.hidden)", timeout=5000)
    page.fill("#commandPaletteInput", "accounts")
    page.wait_for_selector("#commandPaletteList", timeout=5000)
    page.keyboard.press("Enter")
    page.wait_for_selector("#accountsSection.active", timeout=5000)
    assert _path(page) == "/accounts"
    page.go_back()
    page.wait_for_selector("#ledgerSection.active", timeout=5000)
    assert _path(page) == "/ledger"
