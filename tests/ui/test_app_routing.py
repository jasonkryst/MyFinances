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


# ── Task 4: sub-tab addresses ───────────────────────────────────────────────


def _goto(page, path):
    page.goto(BASE + path, wait_until="networkidle", timeout=60000)
    wait_for_app_ready(page)


def _liab_tab(page, name):
    page.click(f'#liabilitiesSection .liabilities-subtab-btn[data-liabilities-subtab="{name}"]')
    page.wait_for_selector(f'#liabilitiesSection [data-subtab="{name}"].visible', timeout=5000)


def _savings_tab(page, name):
    page.click(f'#savingsSection .savings-subtab-btn[data-savings-subtab="{name}"]')
    page.wait_for_selector(f'#savingsSection .savings-subtab-btn.active[data-savings-subtab="{name}"]', timeout=5000)


def _reports_tab(page, name):
    page.click(f'#reportsSection .rpt-tab-btn[data-rptab="{name}"]')
    page.wait_for_selector(f'#rptPanel-{name}.rpt-tab-panel--active', timeout=5000)


def test_sub_tab_click_sets_address(app_page):
    page = app_page
    _nav(page, "liabilities", "liabilitiesSection")
    _liab_tab(page, "expenses")
    assert _path(page) == "/liabilities/expenses"
    _nav(page, "savings", "savingsSection")
    _savings_tab(page, "sinking")
    assert _path(page) == "/savings/sinking"
    _nav(page, "reports", "reportsSection")
    _reports_tab(page, "networth")
    assert _path(page) == "/reports/networth"


def test_deep_link_opens_sub_tab(app_page):
    page = app_page
    _goto(page, "liabilities/expenses")
    page.wait_for_selector("#expensesPanel.visible", timeout=5000)
    assert page.is_hidden("#debtsPanel")
    assert _path(page) == "/liabilities/expenses"

    _goto(page, "savings/home")
    page.wait_for_selector('#savingsSection .savings-subtab-btn.active[data-savings-subtab="home"]', timeout=5000)
    assert _path(page) == "/savings/home"

    _goto(page, "reports/variance")
    page.wait_for_selector("#rptPanel-variance.rpt-tab-panel--active", timeout=5000)
    assert page.get_attribute('.rpt-tab-btn[data-rptab="variance"]', "aria-selected") == "true"
    assert _path(page) == "/reports/variance"


def test_deep_link_sub_tab_survives_lazy_render(app_page_no_sw):
    # Review Focus 2: the page renders only once appFeatures.js arrives; that
    # deferred render must keep the sub-tab the address names. The handler holds
    # the request until the Liabilities section is already showing, checks that
    # nothing has rendered yet, then lets it through (no polling, no sleeping).
    page = app_page_no_sw
    seen = {}

    def hold_until_section_shows(route):
        page.wait_for_selector("#liabilitiesSection.active", timeout=30000)
        seen["rendered_early"] = page.evaluate("() => !!document.querySelector('#expensesPanel.visible')")
        route.continue_()

    page.route("**/src/appFeatures.js*", hold_until_section_shows)
    page.goto(BASE + "liabilities/expenses", wait_until="commit", timeout=60000)
    page.wait_for_selector("#expensesPanel.visible", timeout=30000)
    page.unroute("**/src/appFeatures.js*")
    assert seen.get("rendered_early") is False, \
        f"appFeatures.js should be requested and held, and nothing renders before it arrives: {seen}"
    wait_for_app_ready(page)
    page.wait_for_selector("#expensesPanel.visible", timeout=10000)
    assert page.is_hidden("#debtsPanel")
    assert _path(page) == "/liabilities/expenses"


def test_back_between_sub_tabs(app_page):
    page = app_page
    _nav(page, "reports", "reportsSection")
    assert _path(page) == "/reports/calendar"
    _reports_tab(page, "spending")
    assert _path(page) == "/reports/spending"
    page.go_back()
    page.wait_for_selector("#rptPanel-calendar.rpt-tab-panel--active", timeout=5000)
    assert _path(page) == "/reports/calendar"
    assert page.get_attribute('.rpt-tab-btn[data-rptab="calendar"]', "aria-selected") == "true"

    # Liabilities: Back to Debts, then Forward to Expenses re-applies it.
    _nav(page, "liabilities", "liabilitiesSection")
    _liab_tab(page, "expenses")
    page.go_back()
    page.wait_for_selector("#debtsPanel.visible", timeout=5000)
    assert _path(page) == "/liabilities/debts"
    page.go_forward()
    page.wait_for_selector("#expensesPanel.visible", timeout=5000)
    assert _path(page) == "/liabilities/expenses"


def test_popstate_to_current_sub_tab_does_not_rerender(app_page):
    # Carried from Task 3 review: applying /liabilities/expenses while it is
    # already showing must compare against the real sub-tab, not Debts.
    page = app_page
    _goto(page, "liabilities/expenses")
    page.wait_for_selector("#expensesPanel.visible", timeout=5000)
    page.evaluate("""() => {
        window.__switches = 0;
        const orig = app.switchPage.bind(app);
        app.switchPage = (...a) => { window.__switches++; return orig(...a); };
        window.dispatchEvent(new PopStateEvent('popstate'));
    }""")
    assert page.evaluate("() => window.__switches") == 0
    assert _path(page) == "/liabilities/expenses"


def test_nav_button_keeps_remembered_sub_tab(app_page):
    page = app_page
    _nav(page, "reports", "reportsSection")
    _reports_tab(page, "spending")
    _nav(page, "ledger", "ledgerSection")
    _nav(page, "reports", "reportsSection")
    assert _path(page) == "/reports/spending"
    page.wait_for_selector("#rptPanel-spending.rpt-tab-panel--active", timeout=5000)

    _nav(page, "liabilities", "liabilitiesSection")
    _liab_tab(page, "expenses")
    _nav(page, "ledger", "ledgerSection")
    _nav(page, "liabilities", "liabilitiesSection")
    page.wait_for_selector("#debtsPanel.visible", timeout=5000)
    assert _path(page) == "/liabilities/debts"


def test_reclick_active_sub_tab_adds_no_history(app_page):
    page = app_page
    _nav(page, "liabilities", "liabilitiesSection")
    _liab_tab(page, "expenses")
    before = _history_length(page)
    _liab_tab(page, "expenses")
    assert _history_length(page) == before

    _nav(page, "savings", "savingsSection")
    _savings_tab(page, "sinking")
    before = _history_length(page)
    _savings_tab(page, "sinking")
    assert _history_length(page) == before

    _nav(page, "reports", "reportsSection")
    _reports_tab(page, "networth")
    before = _history_length(page)
    _reports_tab(page, "networth")
    assert _history_length(page) == before
    assert _path(page) == "/reports/networth"


def test_back_to_spending_sets_address(app_page):
    from tests.ui.test_spending_ui import _seed_linked_and_navigate

    page = app_page
    _seed_linked_and_navigate(page)
    page.click('[data-spending-cat="Food"]')
    page.wait_for_selector("#spendingDrilldownModal:not(.hidden)", timeout=5000)
    page.click("#spendingDrilldownViewLedgerBtn")
    page.wait_for_selector("#ledgerSection.active", timeout=5000)
    # Another Reports tab is remembered by the time Back to Spending is used.
    # The Reports tab buttons stay in the DOM behind the Ledger; clicking one runs its real
    # handler without leaving the Ledger (leaving it would clear the Back to Spending link).
    page.locator('.rpt-tab-btn[data-rptab="networth"]').dispatch_event("click")
    page.wait_for_selector("#rptPanel-networth.rpt-tab-panel--active", state="attached", timeout=5000)
    before = _history_length(page)
    page.click("#ledgerCrossNavBackBtn")
    page.wait_for_selector("#rptPanel-spending.rpt-tab-panel--active", timeout=5000)
    assert _path(page) == "/reports/spending"
    assert _history_length(page) == before + 1


# ── Task 5: Settings address ────────────────────────────────────────────────

NARROW = {"width": 390, "height": 844}


def _settings_open(page):
    return page.evaluate("() => !document.getElementById('settingsModal').classList.contains('hidden')")


def _shown_settings_page(page):
    return page.evaluate("""() => {
        const el = document.querySelector('#settingsModal .settings-page--active');
        return el ? el.id.replace('settingsPage-', '') : null;
    }""")


def _open_settings_from_menu(page):
    page.click("#accountMenuBtn")
    page.click("#accountMenuSettingsBtn")
    page.wait_for_selector("#settingsModal.flex-visible", timeout=5000)


def _wait_path(page, expected):
    page.wait_for_function("(p) => location.pathname + location.search === p", arg=expected, timeout=5000)


def _wait_settings_closed(page):
    page.wait_for_selector("#settingsModal", state="hidden", timeout=5000)


def test_open_settings_pushes_and_back_closes(app_page):
    page = app_page
    _nav(page, "ledger", "ledgerSection")
    before = _history_length(page)
    _open_settings_from_menu(page)
    shown = _shown_settings_page(page)
    assert shown
    assert _path(page) == f"/ledger?settings={shown}"
    assert _history_length(page) == before + 1, "opening Settings pushes one entry"
    page.go_back()
    _wait_settings_closed(page)
    _wait_path(page, "/ledger")
    assert _active(page, "ledgerSection")


def test_settings_row_replaces(app_page):
    page = app_page
    _nav(page, "ledger", "ledgerSection")
    _open_settings_from_menu(page)
    opened = _history_length(page)
    page.click('#settingsModal .settings-row[data-settings-page="security"]')
    page.wait_for_selector("#settingsPage-security", state="visible", timeout=5000)
    assert _path(page) == "/ledger?settings=security"
    assert _history_length(page) == opened, "moving inside Settings replaces"
    page.go_back()
    _wait_settings_closed(page)
    _wait_path(page, "/ledger")


def test_close_button_restores_address(app_page):
    page = app_page
    _nav(page, "ledger", "ledgerSection")
    _open_settings_from_menu(page)
    page.click("#settingsModalCloseBtn")
    _wait_settings_closed(page)
    _wait_path(page, "/ledger")
    origin = page.evaluate("() => location.origin")
    page.go_back()
    page.wait_for_load_state()
    assert page.evaluate("() => location.origin") == origin
    assert not _settings_open(page)


def test_settings_deep_link_opens_modal(app_page):
    page = app_page
    _goto(page, "reports/spending?settings=backup")
    page.wait_for_selector("#settingsPage-backup", state="visible", timeout=10000)
    assert _active(page, "reportsSection")
    assert page.evaluate("() => document.getElementById('rptPanel-spending').classList.contains('rpt-tab-panel--active')")
    assert _path(page) == "/reports/spending?settings=backup"


def test_close_bookmarked_settings_stays_in_app(app_page):
    # Review Focus 3: Settings opened from the address (refresh, bookmark) has
    # no pushed entry of its own, so closing it must not go back in history.
    page = app_page
    _goto(page, "ledger?settings=security")
    page.wait_for_selector("#settingsPage-security", state="visible", timeout=10000)
    origin = page.evaluate("() => location.origin")
    page.evaluate("""() => {
        window.__backCalls = 0;
        const orig = history.back.bind(history);
        history.back = () => { window.__backCalls++; return orig(); };
    }""")
    page.keyboard.press("Escape")
    _wait_settings_closed(page)
    _wait_path(page, "/ledger")
    assert page.evaluate("() => window.__backCalls") == 0
    assert page.evaluate("() => location.origin") == origin
    assert _active(page, "ledgerSection")


def test_narrow_settings_list_address(app_page):
    page = app_page
    _nav(page, "ledger", "ledgerSection")
    page.set_viewport_size(NARROW)
    page.evaluate("() => document.getElementById('settingsBtn').click()")
    page.wait_for_selector("#settingsModal.flex-visible", timeout=5000)
    assert _path(page) == "/ledger?settings"
    page.click('#settingsModal .settings-row[data-settings-page="notifications"]')
    page.wait_for_selector("#settingsPage-notifications", state="visible", timeout=5000)
    assert _path(page) == "/ledger?settings=notifications"
    page.click("#settingsBackBtn")
    page.wait_for_selector("#settingsNav", state="visible", timeout=5000)
    assert _path(page) == "/ledger?settings"
    page.go_back()
    _wait_settings_closed(page)
    _wait_path(page, "/ledger")


# ── Final review: Back/Forward between sub-tabs keeps the page's view state ──


def test_back_between_reports_tabs_keeps_month(app_page):
    page = app_page
    _nav(page, "reports", "reportsSection")
    _reports_tab(page, "spending")
    start = page.text_content("#rptMonthLabel")
    page.click("#rptPrevMonth")
    page.wait_for_function("(s) => document.getElementById('rptMonthLabel').textContent !== s", arg=start)
    page.click("#rptPrevMonth")
    page.wait_for_function("() => app._reportMonthOffset === -2")
    moved = page.text_content("#rptMonthLabel")
    assert moved != start
    _reports_tab(page, "variance")
    page.go_back()
    page.wait_for_selector("#rptPanel-spending.rpt-tab-panel--active", timeout=5000)
    assert _path(page) == "/reports/spending"
    assert page.evaluate("() => app._reportMonthOffset") == -2
    assert page.text_content("#rptMonthLabel") == moved


def test_back_between_liabilities_tabs_keeps_expense_month(app_page):
    page = app_page
    _nav(page, "liabilities", "liabilitiesSection")
    _liab_tab(page, "expenses")
    label = "#expenseList .expense-month-label"
    start = page.text_content(label)
    page.click('#expenseList [data-expense-month-nav="prev"]')
    page.wait_for_function("() => app._expenseMonthOffset === -1")
    moved = page.text_content(label)
    assert moved != start
    _liab_tab(page, "debts")
    page.go_back()
    page.wait_for_selector("#expensesPanel.visible", timeout=5000)
    assert _path(page) == "/liabilities/expenses"
    assert page.evaluate("() => app._expenseMonthOffset") == -1
    assert page.text_content(label) == moved


# ── #734 Task 2: router hardening ───────────────────────────────────────────

WIDE = {"width": 1280, "height": 900}


def test_render_error_still_records_address(app_page):
    # Review Focus 5: a page whose render throws still gets its address, and
    # the error still reaches the caller.
    page = app_page
    _nav(page, "ledger", "ledgerSection")
    thrown = page.evaluate("""() => {
        const orig = app.renderPeopleList;
        app.renderPeopleList = function () {
            app.renderPeopleList = orig;
            throw new Error('render boom');
        };
        try { app.switchPage('people'); return null; } catch (e) { return e.message; }
    }""")
    assert thrown == "render boom", "the render error must propagate"
    assert _active(page, "peopleSection")
    assert _path(page) == "/people"
    page.go_back()
    page.wait_for_selector("#ledgerSection.active", timeout=5000)
    assert _path(page) == "/ledger"


def test_bare_settings_on_wide_screen_is_canonicalised(app_page):
    page = app_page
    page.set_viewport_size(WIDE)
    _goto(page, "?settings")
    page.wait_for_selector("#settingsModal.flex-visible", timeout=10000)
    shown = _shown_settings_page(page)
    assert shown
    _wait_path(page, f"/?settings={shown}")

    # A name that is no Settings page shows the default page, and says so.
    _goto(page, "ledger?settings=nope")
    page.wait_for_selector("#settingsModal.flex-visible", timeout=10000)
    shown = _shown_settings_page(page)
    assert shown and shown != "nope"
    _wait_path(page, f"/ledger?settings={shown}")


def test_resize_narrow_to_wide_updates_settings_address(app_page):
    page = app_page
    _nav(page, "ledger", "ledgerSection")
    page.set_viewport_size(NARROW)
    page.evaluate("() => document.getElementById('settingsBtn').click()")
    page.wait_for_selector("#settingsModal.flex-visible", timeout=5000)
    assert _path(page) == "/ledger?settings"
    before = _history_length(page)
    page.set_viewport_size(WIDE)
    page.wait_for_function("() => location.search.startsWith('?settings=')", timeout=5000)
    shown = _shown_settings_page(page)
    assert _path(page) == f"/ledger?settings={shown}"
    # Back on a narrow screen the list shows again, and so does the address.
    page.set_viewport_size(NARROW)
    _wait_path(page, "/ledger?settings")
    assert _history_length(page) == before, "a width change replaces the address"
    page.go_back()
    _wait_settings_closed(page)
    _wait_path(page, "/ledger")
