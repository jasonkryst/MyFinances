"""Leftovers from the 8.8.4 review of the routing follow-ups (#747)."""

import pytest
from playwright.sync_api import expect

from tests.conftest import BASE_URL, wait_for_app_ready

BASE = BASE_URL if BASE_URL.endswith("/") else BASE_URL + "/"


@pytest.mark.ui
def test_settings_address_keeps_unrelated_query_parameters(app_page):
    """Opening Settings rewrites the address with ?settings=<page>; other parameters stay."""
    page = app_page
    page.goto(BASE + "ledger?settings=security&foo=1")
    wait_for_app_ready(page)
    page.wait_for_selector("#settingsModal.flex-visible", timeout=10000)
    # Opening from the address must not drop foo (the apply-time rewrite used to).
    assert page.evaluate("() => new URLSearchParams(location.search).get('foo')") == "1"
    assert page.evaluate("() => new URLSearchParams(location.search).get('settings')") == "security"
    page.click("#settingsModalCloseBtn")
    expect(page.locator("#settingsModal")).to_be_hidden()
    assert page.evaluate("() => location.pathname + location.search") == "/ledger?foo=1"


@pytest.mark.ui
def test_opening_one_popover_closes_the_other(app_page):
    page = app_page
    wait_for_app_ready(page)
    page.click("#notificationsBtn")
    expect(page.locator("#notificationsPanel")).to_be_visible()
    page.click("#accountMenuBtn")
    expect(page.locator("#accountMenuDropdown")).to_be_visible()
    expect(page.locator("#notificationsPanel")).to_be_hidden()
    assert page.get_attribute("#notificationsBtn", "aria-expanded") == "false"
    # And the other way round, with focus staying on the button just clicked.
    page.click("#notificationsBtn")
    expect(page.locator("#notificationsPanel")).to_be_visible()
    expect(page.locator("#accountMenuDropdown")).to_be_hidden()
    assert page.evaluate("() => document.activeElement && document.activeElement.id") == "notificationsBtn"


@pytest.mark.ui
def test_popover_opened_by_keyboard_gets_focus_back_after_back(app_page):
    """A mouse click already leaves focus on the trigger, so only a keyboard open proves the
    restore: Enter opens the menu onto its first item, and Back must return focus to the button."""
    page = app_page
    page.goto(BASE + "ledger")
    wait_for_app_ready(page)
    page.click('.page-button[data-page="accounts"]')
    page.wait_for_selector("#accountsSection.active", timeout=5000)
    page.focus("#accountMenuBtn")
    page.keyboard.press("Enter")
    expect(page.locator("#accountMenuDropdown")).to_be_visible()
    assert page.evaluate("() => document.getElementById('accountMenuDropdown').contains(document.activeElement)")
    page.go_back()
    expect(page.locator("#accountMenuDropdown")).to_be_hidden()
    # The router undoes the Back with an asynchronous history.go, so wait for the address.
    page.wait_for_function("() => location.pathname === '/accounts'", timeout=5000)
    assert page.evaluate("() => location.pathname") == "/accounts"
    assert page.evaluate("() => document.activeElement && document.activeElement.id") == "accountMenuBtn"
