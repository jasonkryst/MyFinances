"""Phone bottom tab bar (#731).

At phone width (max-width: 768px) a fixed bottom bar replaces the hamburger:
Health, Ledger, Plan, Reports and More. The desktop navigation is unchanged.
"""

from datetime import date

import pytest
from playwright.sync_api import expect

from tests.conftest import BASE_URL, seed_state, wait_for_app_ready
from tests.ui.contrast_utils import text_contrast

BASE = BASE_URL if BASE_URL.endswith("/") else BASE_URL + "/"
PHONE = {"width": 390, "height": 844}
DESKTOP = {"width": 1280, "height": 800}
TAB_PAGES = ("health", "ledger", "strategy", "reports")
BAR = "#phoneTabBar"


def _tab(page, name):
    return page.locator(f'{BAR} .phone-tab[data-page="{name}"]')


def _bar_top(page):
    return page.evaluate("() => document.getElementById('phoneTabBar').getBoundingClientRect().top")


def _current_tabs(page):
    return page.evaluate("""() => [...document.querySelectorAll('#phoneTabBar .phone-tab')]
        .filter(b => b.getAttribute('aria-current') === 'page')
        .map(b => b.dataset.page || b.id)""")


@pytest.mark.ui
def test_tab_bar_visible_on_phone_only(app_page):
    page = app_page
    page.set_viewport_size(PHONE)
    bar = page.locator(BAR)
    bar.wait_for(state="visible", timeout=5000)
    assert page.locator("#navToggle").is_hidden()
    assert page.locator("#navMenu").is_hidden()
    assert bar.get_attribute("aria-label"), "the bar is a named landmark"
    labels = [t.strip() for t in page.locator(f"{BAR} .phone-tab").all_inner_texts()]
    assert labels == ["Health", "Ledger", "Plan", "Reports", "More"], labels
    box = bar.bounding_box()
    assert abs(box["y"] + box["height"] - PHONE["height"]) <= 1, f"bar is not at the bottom: {box}"
    for b in page.locator(f"{BAR} .phone-tab").all():
        bb = b.bounding_box()
        assert bb["height"] >= 44 and bb["width"] >= 44, bb

    page.set_viewport_size(DESKTOP)
    bar.wait_for(state="hidden", timeout=5000)
    for name in ("health", "accounts", "ledger", "retirement"):
        assert page.locator(f'#navMenu .page-button[data-page="{name}"]').is_visible()


@pytest.mark.ui
def test_tab_navigates_and_marks_current(app_page):
    page = app_page
    page.set_viewport_size(PHONE)
    _tab(page, "ledger").click()
    page.wait_for_selector("#ledgerSection.active", timeout=5000)
    assert page.evaluate("() => location.pathname") == "/ledger"
    assert _tab(page, "ledger").get_attribute("aria-current") == "page"
    assert _current_tabs(page) == ["ledger"]
    assert page.locator("#phoneMoreBtn").get_attribute("aria-current") == "false"
    # The desktop button for the same page is marked too.
    assert page.locator('#navMenu .page-button[data-page="ledger"]').get_attribute("aria-current") == "page"

    _tab(page, "strategy").click()
    page.wait_for_selector("#strategySection.active", timeout=5000)
    assert page.evaluate("() => location.pathname") == "/plan"
    assert _current_tabs(page) == ["strategy"]


@pytest.mark.ui
def test_more_is_current_for_sheet_pages(app_page):
    page = app_page
    page.set_viewport_size(PHONE)
    page.goto(BASE + "accounts", wait_until="networkidle", timeout=60000)
    wait_for_app_ready(page)
    page.wait_for_selector("#accountsSection.active", timeout=5000)
    more = page.locator("#phoneMoreBtn")
    assert more.get_attribute("aria-current") == "page"
    assert more.get_attribute("aria-haspopup") == "dialog"
    assert more.get_attribute("aria-controls") == "phoneMoreSheet"
    assert _current_tabs(page) == ["phoneMoreBtn"]

    _tab(page, "health").click()
    page.wait_for_selector("#healthSection.active", timeout=5000)
    assert more.get_attribute("aria-current") == "false"
    assert _current_tabs(page) == ["health"]


def _seed_ledger(page, n=40):
    today = date.today().isoformat()
    seed_state(page, {
        "version": "3.0",
        "accounts": [{"id": 1, "name": "Tab Checking", "type": "Checking", "startingBalance": 5000}],
        "manualTransactions": [
            {"id": i, "accountId": 1, "date": today, "amount": -(i + 1), "name": f"Row {i}",
             "category": "Food", "memo": ""}
            for i in range(1, n + 1)
        ],
    })
    wait_for_app_ready(page)


@pytest.mark.ui
def test_last_row_clears_bar(app_page):
    page = app_page
    _seed_ledger(page)
    page.set_viewport_size(PHONE)
    _tab(page, "ledger").click()
    page.wait_for_selector("#ledgerTableContainer .ledger-table tbody tr", timeout=10000)
    assert page.evaluate("() => document.documentElement.scrollHeight > innerHeight"), "Ledger must scroll"
    page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
    page.wait_for_function("() => Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight - 1")
    bar_top = _bar_top(page)
    last_row = page.evaluate("""() => {
        const rows = document.querySelectorAll('#ledgerTableContainer .ledger-table tbody tr');
        return rows[rows.length - 1].getBoundingClientRect().bottom;
    }""")
    assert last_row <= bar_top, f"last Ledger row ends at {last_row}, bar starts at {bar_top}"
    footer = page.evaluate("() => document.querySelector('.app-footer').getBoundingClientRect().bottom")
    assert footer <= bar_top, f"footer ends at {footer}, bar starts at {bar_top}"


@pytest.mark.ui
def test_long_list_page_clears_bar(app_page):
    """A page in <main> (Accounts with many cards) also ends above the bar."""
    page = app_page
    seed_state(page, {
        "version": "3.0",
        "accounts": [{"id": i, "name": f"Acct {i}", "type": "Checking", "startingBalance": 100}
                     for i in range(1, 16)],
    })
    wait_for_app_ready(page)
    page.set_viewport_size(PHONE)
    page.evaluate("() => window.app.switchPage('accounts')")
    page.wait_for_selector("#accountsSection.active", timeout=5000)
    page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
    page.wait_for_function("() => Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight - 1")
    bar_top = _bar_top(page)
    last = page.evaluate("""() => {
        const s = document.getElementById('accountsSection');
        const kids = [...s.querySelectorAll('*')].filter(e => e.getClientRects().length);
        return Math.max(...kids.map(e => e.getBoundingClientRect().bottom));
    }""")
    assert last <= bar_top, f"Accounts content ends at {last}, bar starts at {bar_top}"


@pytest.mark.ui
def test_fixed_bottom_ui_sits_above_bar(app_page):
    page = app_page
    page.set_viewport_size(PHONE)
    page.locator(BAR).wait_for(state="visible", timeout=5000)
    page.evaluate("() => document.getElementById('syncErrorBanner').classList.remove('hidden')")
    bar_top = _bar_top(page)
    banner = page.evaluate("() => document.getElementById('syncErrorBanner').getBoundingClientRect().bottom")
    assert banner <= bar_top, f"sync banner ends at {banner}, bar starts at {bar_top}"
    for sel in (".undo-toast-region", ".sw-update-banner", ".email-test-toast", ".recon-result-region"):
        bottom = page.evaluate("""(sel) => {
            const el = document.createElement('div');
            el.className = sel.slice(1);
            document.body.appendChild(el);
            const b = parseFloat(getComputedStyle(el).bottom);
            el.remove();
            return b;
        }""", sel)
        assert bottom >= PHONE["height"] - bar_top, f"{sel} bottom {bottom}px is under the bar"


@pytest.mark.ui
def test_bar_hides_while_typing(app_page):
    page = app_page
    page.set_viewport_size(PHONE)
    _tab(page, "ledger").click()
    page.wait_for_selector("#ledgerFiltersToggle", state="visible", timeout=10000)
    page.click("#ledgerFiltersToggle")
    page.wait_for_selector("#ledgerSearchInput", state="visible")
    bar = page.locator(BAR)
    page.focus("#ledgerSearchInput")
    bar.wait_for(state="hidden", timeout=5000)
    assert "phone-tab-bar--hidden" in (bar.get_attribute("class") or "")
    page.evaluate("() => document.activeElement.blur()")
    bar.wait_for(state="visible", timeout=5000)

    # A non-text control does not hide it.
    _tab(page, "health").focus()
    assert bar.is_visible()

    # Above the breakpoint the listener leaves the (hidden) bar alone.
    page.set_viewport_size(DESKTOP)
    page.evaluate("() => window.app.switchPage('ledger')")
    page.wait_for_selector("#ledgerSearchInput", state="attached", timeout=10000)
    page.evaluate("() => document.getElementById('ledgerSearchInput').focus()")
    assert "phone-tab-bar--hidden" not in (bar.get_attribute("class") or "")


# Firefox and iOS Safari fire no focusout when the focused field is removed;
# Chromium does. To reproduce that here, a window capture listener swallows
# every focusout before the app's document listener sees it, so only the
# pointerdown / switchPage re-check can bring the bar back.
_FOCUS_DOOMED_FIELD = """() => {
    window.addEventListener('focusout', e => e.stopImmediatePropagation(), true);
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'doomedField';
    // Not inside the active page section: Health re-renders its section's innerHTML shortly
    // after boot (_finishBoot), which on a slow runner removed this field and re-showed the bar.
    document.querySelector('.container').prepend(input);
    input.focus();
}"""


def _remove_doomed_field(page):
    page.locator(BAR).wait_for(state="hidden", timeout=5000)
    page.evaluate("() => document.getElementById('doomedField').remove()")
    assert page.evaluate("() => document.activeElement === document.body")
    # Proof that focusout was suppressed: nothing has re-shown the bar yet.
    assert "phone-tab-bar--hidden" in (page.locator(BAR).get_attribute("class") or "")


@pytest.mark.ui
def test_bar_returns_on_tap_after_focused_field_is_removed(app_page):
    page = app_page
    page.set_viewport_size(PHONE)
    page.locator(BAR).wait_for(state="visible", timeout=5000)
    page.evaluate(_FOCUS_DOOMED_FIELD)
    _remove_doomed_field(page)
    # Tap plain, non-focusable content (the footer), so no focusin fires.
    page.locator("#appVersion").click()
    page.locator(BAR).wait_for(state="visible", timeout=5000)
    assert page.evaluate("() => document.activeElement === document.body"), "the tap must not move focus"


@pytest.mark.ui
def test_bar_returns_on_switch_page_after_focused_field_is_removed(app_page):
    page = app_page
    page.set_viewport_size(PHONE)
    page.locator(BAR).wait_for(state="visible", timeout=5000)
    page.evaluate(_FOCUS_DOOMED_FIELD)
    _remove_doomed_field(page)
    page.evaluate("() => window.app.switchPage('ledger')")
    page.locator(BAR).wait_for(state="visible", timeout=5000)


@pytest.mark.ui
def test_bar_returns_when_back_cancels_inline_edit(app_page):
    """Back cancelling an inline edit removes the focused field; with no
    focusout (Firefox, iOS Safari) the popstate re-check brings the bar back."""
    page = app_page
    seed_state(page, {"version": "3.0", "persons": [{"id": 1, "name": "Bar Person"}]})
    wait_for_app_ready(page)
    page.set_viewport_size(PHONE)
    page.evaluate("() => window.app.switchPage('ledger')")
    page.evaluate("() => window.app.switchPage('people')")
    page.wait_for_selector("#peopleSection.active", timeout=5000)
    person_id = page.evaluate("() => window.app.persons[0].id")
    page.click(f'[data-person-action="edit"][data-person-id="{person_id}"]')
    field = page.locator(f"#pe-name-{person_id}")
    expect(field).to_be_visible(timeout=5000)
    page.evaluate("() => window.addEventListener('focusout', e => e.stopImmediatePropagation(), true)")
    field.focus()
    page.locator(BAR).wait_for(state="hidden", timeout=5000)
    page.go_back()
    expect(field).to_have_count(0, timeout=5000)
    assert page.evaluate("() => document.getElementById('peopleSection').classList.contains('active')")
    page.locator(BAR).wait_for(state="visible", timeout=5000)


@pytest.mark.ui
def test_bar_stays_for_pickers(app_page):
    """A select or a date/time picker raises no keyboard, so the bar stays;
    on Android the picker closes but keeps focus (#731 final review)."""
    page = app_page
    page.set_viewport_size(PHONE)
    page.locator(BAR).wait_for(state="visible", timeout=5000)
    hidden_for = page.evaluate("""() => {
        const host = document.querySelector('.page-section.active');
        const make = (tag, type) => {
            const el = document.createElement(tag);
            if (type) el.type = type;
            if (tag === 'select') el.append(new Option('One', '1'), new Option('Two', '2'));
            host.prepend(el);
            return el;
        };
        const bar = document.getElementById('phoneTabBar');
        const out = {};
        for (const [tag, type] of [['select', null], ['input', 'date'], ['input', 'month'], ['input', 'week'],
                                   ['input', 'time'], ['input', 'datetime-local'], ['input', 'text']]) {
            const el = make(tag, type);
            el.focus();
            out[type || tag] = bar.classList.contains('phone-tab-bar--hidden');
            el.blur();
            el.remove();
        }
        return out;
    }""")
    assert hidden_for == {"select": False, "date": False, "month": False, "week": False, "time": False,
                          "datetime-local": False, "text": True}, hidden_for
    page.locator(BAR).wait_for(state="visible", timeout=5000)


@pytest.mark.ui
def test_more_is_not_current_off_the_sheet(app_page):
    """Notifications is a page but not in the More sheet (#navMenu)."""
    page = app_page
    page.set_viewport_size(PHONE)
    page.evaluate("() => window.app.switchPage('notifications')")
    page.wait_for_selector("#notificationsPage.active", timeout=5000)
    assert page.locator("#phoneMoreBtn").get_attribute("aria-current") == "false"
    assert _current_tabs(page) == []


@pytest.mark.ui
@pytest.mark.parametrize("dark", [False, True], ids=["light", "dark"])
def test_tab_bar_contrast(app_page, dark):
    page = app_page
    page.set_viewport_size(PHONE)
    if dark:
        page.evaluate("() => { document.body.classList.add('dark-mode'); "
                      "document.documentElement.setAttribute('data-theme','dark'); }")
    _tab(page, "ledger").click()
    page.wait_for_selector("#ledgerSection.active", timeout=5000)
    active = text_contrast(page.locator(f'{BAR} .phone-tab[data-page="ledger"] .phone-tab-label'))
    inactive = text_contrast(page.locator(f'{BAR} .phone-tab[data-page="reports"] .phone-tab-label'))
    more = text_contrast(page.locator(f"{BAR} #phoneMoreBtn .phone-tab-label"))
    for name, res in (("active", active), ("inactive", inactive), ("more", more)):
        assert res["ratio"] >= 4.5, f"{name} tab label contrast {res['ratio']:.2f} ({res})"
    assert active["fg"] != inactive["fg"], "the active tab must look different"


# ── More sheet (Task 4) ──────────────────────────────────────────────────────

SHEET = "#phoneMoreSheet"
SHEET_GROUPS = ["Overview", "Manage", "Analyze"]
SHEET_PAGES = ["Accounts", "Income", "People", "Liabilities", "Recurring", "Savings", "Reconcile", "Retirement"]


def _open_sheet(page):
    page.set_viewport_size(PHONE)
    page.locator("#phoneMoreBtn").click()
    page.locator(SHEET).wait_for(state="visible", timeout=5000)
    page.wait_for_function(
        "() => document.getElementById('phoneMoreSheet').contains(document.activeElement)", timeout=5000)


def _sheet_labels(page):
    # textContent: the group labels are uppercased by CSS only.
    groups = [t.strip() for t in page.locator(f"{SHEET} .nav-group-label").all_text_contents()]
    pages = [t.strip() for t in page.locator(f"{SHEET} .page-button[data-page]").all_text_contents()]
    return groups, pages


def _inert_ids(page):
    return page.evaluate("""() => [...document.querySelectorAll('[inert]')]
        .map(e => e.id || e.className || e.tagName)""")


@pytest.mark.ui
def test_more_sheet_lists_other_pages(app_page):
    page = app_page
    more = page.locator("#phoneMoreBtn")
    assert more.get_attribute("aria-expanded") == "false"
    _open_sheet(page)
    sheet = page.locator(SHEET)
    assert sheet.get_attribute("role") == "dialog"
    assert sheet.get_attribute("aria-modal") == "true"
    title_id = sheet.get_attribute("aria-labelledby")
    assert title_id and page.locator(f"#{title_id}").inner_text().strip(), "the sheet is named by its title"
    assert more.get_attribute("aria-expanded") == "true"
    groups, pages = _sheet_labels(page)
    assert groups == SHEET_GROUPS, groups
    assert pages == SHEET_PAGES, pages
    for b in page.locator(f"{SHEET} .page-button[data-page]").all():
        assert b.is_visible()
        bb = b.bounding_box()
        assert bb["height"] >= 44, bb
    # Cloned, not moved: the desktop nav keeps its buttons, and no id is duplicated.
    assert page.locator('#navMenu .page-button[data-page="accounts"]').count() == 1
    dup = page.evaluate("""() => {
        const ids = [...document.querySelectorAll('[id]')].map(e => e.id);
        return ids.filter((id, i) => ids.indexOf(id) !== i);
    }""")
    assert dup == [], f"duplicate ids: {dup}"


@pytest.mark.ui
def test_more_sheet_focus_and_escape(app_page):
    page = app_page
    _open_sheet(page)
    assert page.evaluate("() => document.querySelector('.container').hasAttribute('inert')"), \
        "the page behind the sheet is inert"
    assert not page.evaluate("() => document.getElementById('phoneMoreSheet').closest('[inert]')")
    # Tab and Shift+Tab stay inside the sheet.
    for key in ["Tab"] * 12 + ["Shift+Tab"] * 12:
        page.keyboard.press(key)
        assert page.evaluate(
            "() => document.getElementById('phoneMoreSheet').contains(document.activeElement)"), key
    page.keyboard.press("Escape")
    page.locator(SHEET).wait_for(state="hidden", timeout=5000)
    assert _inert_ids(page) == []
    page.wait_for_function("() => document.activeElement === document.getElementById('phoneMoreBtn')",
                           timeout=5000)
    assert page.locator("#phoneMoreBtn").get_attribute("aria-expanded") == "false"
    # Escape on the sheet opened nothing else.
    assert page.locator("#commandPaletteOverlay").is_hidden()


def _click_sheet_title(page):
    # A non-focusable part of the panel: focus must not drop out of the sheet's reach.
    page.locator("#phoneMoreSheetTitle").click()


@pytest.mark.ui
def test_more_sheet_escape_after_tapping_title(app_page):
    page = app_page
    _open_sheet(page)
    _click_sheet_title(page)
    page.keyboard.press("Escape")
    page.locator(SHEET).wait_for(state="hidden", timeout=5000)
    assert _inert_ids(page) == []
    page.wait_for_function("() => document.activeElement === document.getElementById('phoneMoreBtn')",
                           timeout=5000)


@pytest.mark.ui
@pytest.mark.parametrize("focus_on_body", [False, True], ids=["title", "body"])
def test_more_sheet_ctrl_k_opens_usable_palette(app_page, focus_on_body):
    page = app_page
    _open_sheet(page)
    _click_sheet_title(page)
    if focus_on_body:
        # Even with focus on <body>, the open sheet still handles the keys.
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
    page.keyboard.press("Control+k")
    page.locator(SHEET).wait_for(state="hidden", timeout=5000)
    expect(page.locator("#commandPaletteOverlay")).to_be_visible(timeout=5000)
    page.wait_for_function(
        "() => document.activeElement === document.getElementById('commandPaletteInput')", timeout=5000)
    assert _inert_ids(page) == []
    # A field in a modal dialog does not hide the bar (the dialog covers it),
    # so the palette can return focus to More when it closes.
    assert "phone-tab-bar--hidden" not in (page.locator(BAR).get_attribute("class") or "")
    page.keyboard.press("Escape")
    expect(page.locator("#commandPaletteOverlay")).to_be_hidden(timeout=5000)
    page.wait_for_function("() => document.activeElement === document.getElementById('phoneMoreBtn')",
                           timeout=5000)


@pytest.mark.ui
def test_more_sheet_backdrop_closes(app_page):
    page = app_page
    _open_sheet(page)
    # Tap above the panel, on the backdrop.
    page.mouse.click(PHONE["width"] // 2, 20)
    page.locator(SHEET).wait_for(state="hidden", timeout=5000)
    assert _inert_ids(page) == []
    assert page.locator("#phoneMoreBtn").get_attribute("aria-expanded") == "false"


@pytest.mark.ui
def test_more_sheet_navigates(app_page):
    page = app_page
    page.set_viewport_size(PHONE)
    _tab(page, "ledger").click()
    page.wait_for_selector("#ledgerSection.active", timeout=5000)
    before = page.evaluate("() => history.length")
    _open_sheet(page)
    page.locator(f'{SHEET} .page-button[data-page="savings"]').click()
    page.locator(SHEET).wait_for(state="hidden", timeout=5000)
    page.wait_for_selector("#savingsSection.active", timeout=5000)
    expect(page).to_have_url(BASE + "savings/emergency", timeout=5000)
    assert page.locator("#phoneMoreBtn").get_attribute("aria-current") == "page"
    assert page.locator(f'{SHEET} .page-button[data-page="savings"]').get_attribute("aria-current") == "page"
    assert _inert_ids(page) == []
    # One history entry for the page, none for the sheet: one Back returns to the Ledger.
    assert page.evaluate("() => history.length") == before + 1
    page.go_back()
    page.wait_for_selector("#ledgerSection.active", timeout=5000)
    expect(page).to_have_url(BASE + "ledger", timeout=5000)


@pytest.mark.ui
def test_back_closes_more_sheet(app_page):
    page = app_page
    page.set_viewport_size(PHONE)
    _tab(page, "health").click()
    _tab(page, "ledger").click()
    page.wait_for_selector("#ledgerSection.active", timeout=5000)
    _open_sheet(page)
    page.go_back()
    page.locator(SHEET).wait_for(state="hidden", timeout=5000)
    expect(page).to_have_url(BASE + "ledger", timeout=5000)
    assert page.evaluate("() => document.getElementById('ledgerSection').classList.contains('active')")
    assert _inert_ids(page) == []


@pytest.mark.ui
def test_gate_closes_more_sheet(app_page):
    """A 401 while the sheet is open shows the sign-in gate over a closed
    sheet; the sheet's `inert` on the gate must not leave the page dead."""
    page = app_page
    _open_sheet(page)
    page.route("**/api/**", lambda r: r.fulfill(status=401, body="{}", content_type="application/json"))
    page.evaluate("""() => { import('/src/postgresSync.js')
        .then(m => m.pgPost(window.app, '/api/persons', { name: 'Gate Person' })); }""")
    expect(page.locator("#loginGate")).to_be_visible(timeout=15000)
    page.locator(SHEET).wait_for(state="hidden", timeout=5000)
    assert page.locator("#phoneMoreBtn").get_attribute("aria-expanded") == "false"
    assert not page.evaluate("() => Boolean(document.getElementById('loginGate').closest('[inert]'))"), \
        "the gate must not be inert"
    assert page.evaluate("() => document.querySelector('.container').hasAttribute('inert')"), \
        "the app behind the gate stays inert"
    page.wait_for_function("() => document.activeElement === document.getElementById('loginGateEmail')",
                           timeout=5000)
    page.keyboard.type("someone@example.com")
    assert page.input_value("#loginGateEmail") == "someone@example.com"


@pytest.mark.ui
def test_tab_labels_follow_language(app_page):
    # Review Focus 4.
    page = app_page
    page.set_viewport_size(PHONE)
    page.evaluate("() => window.app.openSettings({ page: 'language' })")
    page.wait_for_selector("#settingsModal.flex-visible", timeout=5000)
    page.select_option("#settingLocale", "es")
    page.click("#settingsModalCloseBtn")
    page.wait_for_selector("#settingsModal", state="hidden", timeout=5000)
    es = page.evaluate("async () => (await import('/src/locales/es.js')).default")
    tabs = [t.strip() for t in page.locator(f"{BAR} .phone-tab").all_inner_texts()]
    assert tabs == [es[k] for k in ("nav.health", "nav.ledger", "nav.strategy", "nav.reports", "nav.more")], tabs
    assert page.locator(BAR).get_attribute("aria-label") == es["nav.phoneTabsAria"]
    _open_sheet(page)
    groups, pages = _sheet_labels(page)
    assert groups == [es[k] for k in ("nav.overview", "nav.manage", "nav.analyze")], groups
    assert pages == [es[f"nav.{k}"] for k in ("accounts", "income", "people", "liabilities", "recurring",
                                              "savings", "reconcile", "retirement")], pages
    title_id = page.locator(SHEET).get_attribute("aria-labelledby")
    assert page.locator(f"#{title_id}").inner_text().strip() == es["nav.moreSheetTitle"]


@pytest.mark.ui
def test_sheet_closes_when_widened(app_page):
    # Review Focus 5.
    page = app_page
    _open_sheet(page)
    page.set_viewport_size(DESKTOP)
    page.locator(SHEET).wait_for(state="hidden", timeout=5000)
    assert _inert_ids(page) == []
    assert page.locator("#phoneMoreBtn").get_attribute("aria-expanded") == "false"
    assert page.locator('#navMenu .page-button[data-page="accounts"]').is_visible()


@pytest.mark.ui
@pytest.mark.parametrize("dark", [False, True], ids=["light", "dark"])
def test_more_sheet_contrast(app_page, dark):
    page = app_page
    page.set_viewport_size(PHONE)
    if dark:
        page.evaluate("() => { document.body.classList.add('dark-mode'); "
                      "document.documentElement.setAttribute('data-theme','dark'); }")
    page.evaluate("() => window.app.switchPage('accounts')")
    page.wait_for_selector("#accountsSection.active", timeout=5000)
    _open_sheet(page)
    checks = {
        "title": f"{SHEET} #phoneMoreSheetTitle",
        "group": f"{SHEET} .nav-group-label",
        "page": f'{SHEET} .page-button[data-page="income"]',
        "active": f'{SHEET} .page-button[data-page="accounts"]',
    }
    res = {name: text_contrast(page.locator(sel)) for name, sel in checks.items()}
    for name, r in res.items():
        assert r["ratio"] >= 4.5, f"{name} contrast {r['ratio']:.2f} ({r})"
    assert res["active"]["fg"] != res["page"]["fg"], "the current page must look different"


# ── Header menus stay above the sticky Reports tab strip ─────────────────────

_TOP_OF_MENU_JS = """(sel) => {
    const menu = document.querySelector(sel);
    const r = menu.getBoundingClientRect();
    // Sample the centre of every row (items and the divider-separated groups) down the menu.
    const probes = [...menu.querySelectorAll('button, a, li, [role=menuitem], .account-menu-item')];
    const offenders = [];
    for (const el of probes) {
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) continue;
        const x = Math.min(Math.max(b.left + b.width / 2, 0), innerWidth - 1);
        const y = Math.min(Math.max(b.top + b.height / 2, 0), innerHeight - 1);
        const hit = document.elementFromPoint(x, y);
        if (hit && !menu.contains(hit)) {
            offenders.push((el.textContent || '').trim().slice(0, 24) + ' covered by ' +
                (hit.id ? '#' + hit.id : hit.tagName.toLowerCase() + '.' + String(hit.className).split(' ')[0]));
        }
    }
    return { count: probes.length, offenders };
}"""


@pytest.mark.ui
@pytest.mark.parametrize("viewport", [PHONE, DESKTOP], ids=["phone", "desktop"])
@pytest.mark.parametrize("trigger,menu", [
    ("#accountMenuBtn", "#accountMenuWrap .account-menu-dropdown"),
    ("#notificationsBtn", "#notificationsPanel"),
], ids=["account-menu", "notifications"])
def test_header_menus_above_reports_tab_strip(app_page, viewport, trigger, menu):
    """The toolbar's menus open over the sticky Reports tab strip, not under it. Both are
    z-index 20 siblings otherwise, so the later one (the strip) painted over the menu."""
    page = app_page
    page.set_viewport_size(viewport)
    page.goto(BASE + "reports/calendar")
    wait_for_app_ready(page)
    page.wait_for_selector(".rpt-tab-bar", state="visible", timeout=15000)
    page.click(trigger)
    expect(page.locator(menu)).to_be_visible()
    result = page.evaluate(_TOP_OF_MENU_JS, menu)
    assert result["count"] > 0, "the menu had no rows to probe"
    assert not result["offenders"], f"menu rows covered by other elements: {result['offenders']}"
