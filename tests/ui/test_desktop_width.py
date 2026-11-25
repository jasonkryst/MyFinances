#!/usr/bin/env python3
"""
Desktop width (#363): the app card uses about 80% of a large window.

`.container` is `max-width: clamp(1200px, 80vw, 2200px)`: laptops keep the old
1200px card, 1920/2560px monitors get 80% of the window, ultra-wide monitors
stop at 2200px, and phones are unchanged. Dialogs that hold lists, split rows
or long prose widen with it; confirms and short forms keep the 460px column.
"""

import pytest

PHONE = {"width": 390, "height": 844}


def _container_width(page, viewport):
    page.set_viewport_size(viewport)
    return page.evaluate("() => document.querySelector('.container').getBoundingClientRect().width")


def _modal_width(page, modal_id):
    """Show a dialog's overlay directly (no open flow needed) and measure its panel."""
    return page.evaluate(
        """(id) => {
            const overlay = document.getElementById(id);
            overlay.classList.remove('hidden');
            const w = overlay.querySelector('.modal-content').getBoundingClientRect().width;
            overlay.classList.add('hidden');
            return w;
        }""",
        modal_id,
    )


@pytest.mark.ui
@pytest.mark.parametrize("width,expected", [(1920, 1536), (2560, 2048)], ids=["1920", "2560"])
def test_container_is_80_percent_of_a_large_window(app_page, width, expected):
    got = _container_width(app_page, {"width": width, "height": 1080})
    assert abs(got - expected) <= 2, f"container at {width}px window is {got}px, expected ~{expected}px (80%)"


@pytest.mark.ui
def test_container_stops_at_2200px_on_ultra_wide(app_page):
    got = _container_width(app_page, {"width": 3440, "height": 1440})
    assert abs(got - 2200) <= 1, f"container at 3440px window is {got}px, expected the 2200px cap"


@pytest.mark.ui
@pytest.mark.parametrize("width", [1280, 1440], ids=["1280", "1440"])
def test_laptop_width_is_unchanged(app_page, width):
    # Never narrower than the old 1200px cap: 80% of a laptop would shrink it.
    got = _container_width(app_page, {"width": width, "height": 900})
    assert abs(got - min(1200, width - 40)) <= 1, f"container at {width}px window is {got}px, expected the old width"


@pytest.mark.ui
def test_phone_layout_is_unchanged(app_page):
    page = app_page
    got = _container_width(page, PHONE)
    assert got <= PHONE["width"], f"container {got}px overflows a {PHONE['width']}px phone"
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth"), "phone has horizontal scroll"


@pytest.mark.ui
@pytest.mark.parametrize("page_name", ["health", "liabilities", "ledger", "accounts", "reports", "strategy", "savings"])
def test_wide_window_pages_have_no_horizontal_scroll(app_page, page_name):
    page = app_page
    page.set_viewport_size({"width": 2560, "height": 1440})
    page.evaluate("(p) => window.app.switchPage(p)", page_name)
    page.wait_for_selector(f'.top-nav [data-page="{page_name}"][aria-current="page"]', state="attached", timeout=10000)
    page.wait_for_load_state("networkidle")
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth"), \
        f"{page_name} page scrolls horizontally at 2560px"


@pytest.mark.ui
@pytest.mark.parametrize("modal_id,expected", [
    ("manualTxModal", 680),
    ("spendingDrilldownModal", 680),
    ("acctBreakdownModal", 680),
    ("calendarDayModal", 680),
    ("keyboardShortcutsModal", 680),
    ("whatsNewModal", 680),
    ("balanceHistoryModal", 960),
    ("settingsModal", 1080),
])
def test_content_dialogs_widen_on_desktop(app_page, modal_id, expected):
    page = app_page
    page.set_viewport_size({"width": 1920, "height": 1080})
    got = _modal_width(page, modal_id)
    assert abs(got - expected) <= 1, f"#{modal_id} panel is {got}px at 1920px, expected {expected}px"


@pytest.mark.ui
@pytest.mark.parametrize("modal_id,cap", [
    ("deleteConfirmModal", 460),
    ("alertModal", 460),
    ("archiveConfirmModal", 460),
    ("updateBalanceModal", 460),
    ("ledgerOverrideModal", 440),
])
def test_confirms_and_short_forms_stay_narrow(app_page, modal_id, cap):
    # Negative case: a yes/no prompt stretched to 680px+ reads worse, so these keep their column.
    page = app_page
    page.set_viewport_size({"width": 2560, "height": 1440})
    got = _modal_width(page, modal_id)
    assert got <= cap + 1, f"#{modal_id} panel is {got}px at 2560px, expected at most {cap}px"


@pytest.mark.ui
@pytest.mark.parametrize("modal_id", ["manualTxModal", "balanceHistoryModal", "whatsNewModal"])
def test_wide_dialogs_still_fit_a_phone(app_page, modal_id):
    page = app_page
    page.set_viewport_size(PHONE)
    got = _modal_width(page, modal_id)
    assert got <= PHONE["width"] * 0.92 + 1, f"#{modal_id} panel is {got}px on a {PHONE['width']}px phone"
