"""Phone bottom tab bar (#731).

At phone width (max-width: 768px) a fixed bottom bar replaces the hamburger:
Health, Ledger, Plan, Reports and More. The desktop navigation is unchanged.
"""

from datetime import date

import pytest

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
    document.querySelector('.page-section.active').prepend(input);
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
