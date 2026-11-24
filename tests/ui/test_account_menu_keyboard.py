#!/usr/bin/env python3
"""
Account menu keyboard model (issue #494): the WAI-ARIA menu button pattern.

Enter/Space/ArrowDown on #accountMenuBtn open the menu onto the first item,
ArrowUp onto the last; inside, ArrowDown/ArrowUp move with wrap-around and
Home/End jump; Escape closes and returns focus to the button; Tab closes and
lets focus continue; the items use a roving tabindex.
"""

import pytest

from tests.conftest import assert_no_errors

BTN = '#accountMenuBtn'
DROPDOWN = '#accountMenuDropdown'
OPEN = f'{DROPDOWN}:not(.hidden)'
CLOSED = f'{DROPDOWN}.hidden'
FIRST = 'accountMenuWhatsNewBtn'
SECOND = 'accountMenuCalendarFeedBtn'
LAST = 'accountMenuLogoutBtn'


def _focused_id(page):
    return page.evaluate("() => document.activeElement && document.activeElement.id")


def _expanded(page):
    return page.get_attribute(BTN, 'aria-expanded')


def _focus_button(page):
    page.focus(BTN)
    assert _focused_id(page) == 'accountMenuBtn'


def _show_logout(page):
    # The Sign Out item is revealed once the account email is known.
    page.evaluate("() => window.app.userEmail = window.app.userEmail || 'testuser@example.com'")
    page.evaluate("async () => (await import('/src/ui.js')).updateAccountMenuEmail(window.app)")
    page.wait_for_selector(f'#{LAST}:not(.hidden)', state='attached', timeout=5000)


# --- positive ----------------------------------------------------------------

@pytest.mark.ui
@pytest.mark.parametrize('key', ['Enter', 'Space', 'ArrowDown'])
def test_opening_keys_focus_first_item(app_page, key):
    page = app_page
    _focus_button(page)
    page.keyboard.press(key)
    page.wait_for_selector(OPEN, timeout=3000)
    assert _expanded(page) == 'true'
    assert _focused_id(page) == FIRST
    assert_no_errors(page)


@pytest.mark.ui
def test_arrow_up_opens_onto_last_item(app_page):
    page = app_page
    _show_logout(page)
    _focus_button(page)
    page.keyboard.press('ArrowUp')
    page.wait_for_selector(OPEN, timeout=3000)
    assert _focused_id(page) == LAST
    assert_no_errors(page)


@pytest.mark.ui
def test_arrows_move_and_wrap(app_page):
    page = app_page
    _show_logout(page)
    _focus_button(page)
    page.keyboard.press('ArrowDown')
    assert _focused_id(page) == FIRST
    page.keyboard.press('ArrowDown')
    assert _focused_id(page) == SECOND
    page.keyboard.press('ArrowUp')
    assert _focused_id(page) == FIRST
    page.keyboard.press('ArrowUp')   # wraps to the last item
    assert _focused_id(page) == LAST
    page.keyboard.press('ArrowDown')  # wraps to the first item
    assert _focused_id(page) == FIRST
    assert_no_errors(page)


@pytest.mark.ui
def test_home_and_end_jump(app_page):
    page = app_page
    _show_logout(page)
    _focus_button(page)
    page.keyboard.press('ArrowDown')
    page.keyboard.press('End')
    assert _focused_id(page) == LAST
    page.keyboard.press('Home')
    assert _focused_id(page) == FIRST
    assert_no_errors(page)


@pytest.mark.ui
def test_escape_closes_and_returns_focus_to_button(app_page):
    page = app_page
    _focus_button(page)
    page.keyboard.press('ArrowDown')
    page.wait_for_selector(OPEN, timeout=3000)
    page.keyboard.press('Escape')
    page.wait_for_selector(CLOSED, state='attached', timeout=3000)
    assert _expanded(page) == 'false'
    assert _focused_id(page) == 'accountMenuBtn'
    assert_no_errors(page)


@pytest.mark.ui
def test_items_use_roving_tabindex(app_page):
    page = app_page
    values = page.evaluate("""() => [...document.querySelectorAll('#accountMenuDropdown [role="menuitem"]')]
        .map(el => el.getAttribute('tabindex'))""")
    assert values and all(v == '-1' for v in values), values
    assert_no_errors(page)


@pytest.mark.ui
def test_item_activation_still_works_from_keyboard(app_page):
    page = app_page
    _focus_button(page)
    page.keyboard.press('ArrowDown')
    page.keyboard.press('ArrowDown')
    assert _focused_id(page) == SECOND
    page.keyboard.press('Enter')   # Calendar Feed opens its modal and the menu closes
    page.wait_for_selector('#calendarFeedModal.flex-visible', timeout=5000)
    page.wait_for_selector(CLOSED, state='attached', timeout=3000)
    assert_no_errors(page)


@pytest.mark.ui
def test_sign_out_item_is_reachable_with_the_keyboard(app_page):
    page = app_page
    _show_logout(page)
    _focus_button(page)
    page.keyboard.press('ArrowUp')
    assert _focused_id(page) == LAST
    assert page.inner_text(f'#{LAST}').strip()
    assert_no_errors(page)


@pytest.mark.ui
def test_click_outside_closes_menu(app_page):
    page = app_page
    page.click(BTN)
    page.wait_for_selector(OPEN, timeout=3000)
    page.mouse.click(5, 400)
    page.wait_for_selector(CLOSED, state='attached', timeout=3000)
    assert _expanded(page) == 'false'
    assert_no_errors(page)


# --- negative ----------------------------------------------------------------

@pytest.mark.ui
def test_escape_when_closed_does_nothing(app_page):
    page = app_page
    _focus_button(page)
    page.keyboard.press('Escape')
    assert page.query_selector(CLOSED) is not None
    assert _expanded(page) == 'false'
    assert _focused_id(page) == 'accountMenuBtn'
    assert_no_errors(page)


@pytest.mark.ui
def test_other_keys_on_closed_button_do_not_open(app_page):
    page = app_page
    _focus_button(page)
    for key in ('Home', 'End', 'a', 'ArrowLeft', 'ArrowRight'):
        page.keyboard.press(key)
    assert page.query_selector(CLOSED) is not None
    assert _expanded(page) == 'false'
    assert_no_errors(page)


@pytest.mark.ui
def test_menu_keys_do_nothing_while_closed_elsewhere(app_page):
    page = app_page
    page.focus('body')
    page.keyboard.press('ArrowDown')
    page.keyboard.press('End')
    assert page.query_selector(CLOSED) is not None
    assert_no_errors(page)


@pytest.mark.ui
@pytest.mark.parametrize('combo', ['Tab', 'Shift+Tab'])
def test_tab_closes_menu_and_moves_focus_out_of_it(app_page, combo):
    page = app_page
    _focus_button(page)
    page.keyboard.press('ArrowDown')
    page.wait_for_selector(OPEN, timeout=3000)
    page.keyboard.press(combo)
    page.wait_for_selector(CLOSED, state='attached', timeout=3000)
    assert _expanded(page) == 'false'
    inside = page.evaluate("() => document.getElementById('accountMenuDropdown').contains(document.activeElement)")
    assert not inside, 'focus must leave the closed menu'
    assert_no_errors(page)
