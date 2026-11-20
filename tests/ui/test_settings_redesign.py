#!/usr/bin/env python3
"""Settings redesign (7.20.0): grouped list, drill-in pages, two panes when wide,
save on change, Backup & Restore page, About group. See
docs/superpowers/specs/2026-11-20-settings-redesign-design.md."""

import pytest

from tests.conftest import open_settings, open_settings_page

WIDE = {'width': 1280, 'height': 800}
NARROW = {'width': 390, 'height': 844}


def _active_id(page):
    return page.evaluate("document.activeElement && document.activeElement.id")


@pytest.mark.ui
def test_wide_shows_two_panes_with_appearance_selected(app_page):
    app_page.set_viewport_size(WIDE)
    open_settings(app_page)
    assert app_page.locator('#settingsNav').is_visible()
    assert app_page.locator('#settingsPage-appearance').is_visible()
    assert app_page.locator('[data-settings-page="appearance"]').get_attribute('aria-current') == 'page'
    assert app_page.locator('#settingsPage-advanced').is_hidden()


@pytest.mark.ui
def test_narrow_list_then_drill_in_and_back(app_page):
    page = app_page
    page.set_viewport_size(NARROW)
    open_settings(page)
    assert page.locator('#settingsNav').is_visible()
    assert page.locator('.settings-page:visible').count() == 0
    page.click('[data-settings-page="notifications"]')
    assert page.locator('#settingsPage-notifications').is_visible()
    assert page.locator('#settingsNav').is_hidden()
    assert _active_id(page) == 'settingsPageTitle-notifications'
    page.click('#settingsBackBtn')
    assert page.locator('#settingsNav').is_visible()
    assert page.evaluate("document.activeElement.getAttribute('data-settings-page')") == 'notifications'


@pytest.mark.ui
def test_escape_on_narrow_subpage_goes_back_then_closes(app_page):
    page = app_page
    page.set_viewport_size(NARROW)
    open_settings(page)
    page.click('[data-settings-page="advanced"]')
    page.keyboard.press('Escape')
    assert page.locator('#settingsNav').is_visible()
    assert page.locator('#settingsModal').is_visible()
    page.keyboard.press('Escape')
    assert page.locator('#settingsModal').is_hidden()


@pytest.mark.ui
def test_arrow_keys_move_between_rows(app_page):
    page = app_page
    page.set_viewport_size(WIDE)
    open_settings(page)
    page.focus('[data-settings-page="appearance"]')
    page.keyboard.press('ArrowDown')
    assert page.evaluate("document.activeElement.getAttribute('data-settings-page')") == 'language'
    page.keyboard.press('Enter')
    assert page.locator('#settingsPage-language').is_visible()


@pytest.mark.ui
def test_tab_never_leaves_settings(app_page):
    page = app_page
    page.set_viewport_size(WIDE)
    open_settings(page)
    for _ in range(40):
        page.keyboard.press('Tab')
        assert page.evaluate("document.getElementById('settingsModal').contains(document.activeElement)")


@pytest.mark.ui
def test_resize_keeps_current_page(app_page):
    page = app_page
    page.set_viewport_size(WIDE)
    open_settings_page(page, 'security')
    page.set_viewport_size(NARROW)
    page.wait_for_function("document.getElementById('settingsNav').offsetParent === null")
    assert page.locator('#settingsPage-security').is_visible()
    page.set_viewport_size(WIDE)
    page.wait_for_function("document.getElementById('settingsNav').offsetParent !== null")
    assert page.locator('#settingsPage-security').is_visible()
    assert page.locator('[data-settings-page="security"]').get_attribute('aria-current') == 'page'


@pytest.mark.ui
def test_open_settings_deep_link_narrow_opens_drilled_in(app_page):
    page = app_page
    page.set_viewport_size(NARROW)
    open_settings_page(page, 'backup')
    assert page.locator('#settingsNav').is_hidden()
    page.click('#settingsBackBtn')
    assert page.locator('#settingsNav').is_visible()


@pytest.mark.ui
def test_focus_returns_to_opener_on_close(app_page):
    page = app_page
    page.set_viewport_size(WIDE)
    page.focus('#accountMenuBtn')
    open_settings(page)
    page.click('#settingsModalCloseBtn')
    assert page.locator('#settingsModal').is_hidden()
    assert _active_id(page) == 'accountMenuBtn'
