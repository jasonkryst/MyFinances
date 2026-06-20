#!/usr/bin/env python3
"""
Command Palette / Quick-Jump (Ctrl+K) Tests
Covers opening via keyboard shortcut and the toolbar button, filtering,
keyboard navigation, activation, and focus restoration.
"""

import pytest

from tests.conftest import assert_no_errors


@pytest.mark.ui
def test_ctrl_k_opens_palette(app_page):
    """Ctrl+K opens the command palette and focuses its search input."""
    page = app_page
    page.keyboard.press('Control+k')
    page.wait_for_timeout(200)

    assert page.is_visible('#commandPaletteOverlay'), "Command palette should be visible after Ctrl+K"
    focused_id = page.evaluate('() => document.activeElement.id')
    assert focused_id == 'commandPaletteInput', "Search input should be focused on open"
    assert_no_errors(page)


@pytest.mark.ui
def test_toolbar_button_opens_palette(app_page):
    """Clicking the header quick-jump button opens the command palette."""
    page = app_page
    page.click('#commandPaletteBtn')
    page.wait_for_timeout(200)

    assert page.is_visible('#commandPaletteOverlay')


@pytest.mark.ui
def test_escape_closes_palette_and_restores_focus(app_page):
    """Escape closes the palette and returns focus to the previously focused element."""
    page = app_page
    page.focus('#commandPaletteBtn')
    page.keyboard.press('Control+k')
    page.wait_for_timeout(200)

    page.keyboard.press('Escape')
    page.wait_for_timeout(200)

    assert not page.is_visible('#commandPaletteOverlay'), "Escape should close the palette"
    focused_id = page.evaluate('() => document.activeElement.id')
    assert focused_id == 'commandPaletteBtn', "Focus should return to the toolbar button"


@pytest.mark.ui
def test_filters_commands_by_typed_text(app_page):
    """Typing filters the visible command list to matching labels only."""
    page = app_page
    page.keyboard.press('Control+k')
    page.wait_for_timeout(200)

    page.fill('#commandPaletteInput', 'ledger')
    page.wait_for_timeout(150)

    labels = page.eval_on_selector_all('.cmdpal-item-label', 'els => els.map(e => e.textContent)')
    assert labels == ['Ledger'], f"Expected only 'Ledger' to match, got {labels}"


@pytest.mark.ui
def test_no_match_shows_empty_state(app_page):
    """An unmatched query shows the empty-state message instead of any items."""
    page = app_page
    page.keyboard.press('Control+k')
    page.wait_for_timeout(200)

    page.fill('#commandPaletteInput', 'zzz-not-a-real-command')
    page.wait_for_timeout(150)

    empty = page.query_selector('.cmdpal-empty')
    items = page.query_selector_all('.cmdpal-item')
    assert empty is not None, "Expected the empty-state message"
    assert len(items) == 0


@pytest.mark.ui
def test_enter_navigates_to_selected_page(app_page):
    """Selecting a page command via Enter navigates to that page and closes the palette."""
    page = app_page
    page.keyboard.press('Control+k')
    page.wait_for_timeout(200)

    page.fill('#commandPaletteInput', 'reports')
    page.wait_for_timeout(150)
    page.keyboard.press('Enter')
    page.wait_for_timeout(300)

    assert not page.is_visible('#commandPaletteOverlay')
    active_page = page.evaluate(
        '() => document.querySelector(".page-section.active")?.id'
    )
    assert active_page == 'reportsSection', f"Expected reportsSection active, got {active_page}"
    assert_no_errors(page)


@pytest.mark.ui
def test_arrow_keys_move_active_selection(app_page):
    """ArrowDown moves the active selection to the next item in the list."""
    page = app_page
    page.keyboard.press('Control+k')
    page.wait_for_timeout(200)

    first_active = page.evaluate(
        '() => document.querySelector(".cmdpal-item--active")?.getAttribute("data-index")'
    )
    page.keyboard.press('ArrowDown')
    page.wait_for_timeout(100)
    second_active = page.evaluate(
        '() => document.querySelector(".cmdpal-item--active")?.getAttribute("data-index")'
    )

    assert first_active == '0'
    assert second_active == '1', f"Expected ArrowDown to move selection to index 1, got {second_active}"


@pytest.mark.ui
def test_clicking_overlay_backdrop_closes_palette(app_page):
    """Clicking the dimmed backdrop (outside the panel) closes the palette."""
    page = app_page
    page.keyboard.press('Control+k')
    page.wait_for_timeout(200)

    page.click('#commandPaletteOverlay', position={'x': 5, 'y': 5})
    page.wait_for_timeout(200)

    assert not page.is_visible('#commandPaletteOverlay')


@pytest.mark.ui
def test_toggle_theme_action_runs_and_closes_palette(app_page):
    """The 'Toggle dark / light mode' action executes and closes the palette."""
    page = app_page
    was_dark = page.evaluate("() => document.body.classList.contains('dark-mode')")

    page.keyboard.press('Control+k')
    page.wait_for_timeout(200)
    page.fill('#commandPaletteInput', 'Toggle dark')
    page.wait_for_timeout(150)
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)

    is_dark = page.evaluate("() => document.body.classList.contains('dark-mode')")
    assert is_dark != was_dark, "Theme should have toggled"
    assert not page.is_visible('#commandPaletteOverlay')
