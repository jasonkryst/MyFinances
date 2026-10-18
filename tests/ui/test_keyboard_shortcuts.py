#!/usr/bin/env python3
"""
Keyboard Shortcuts help panel tests (issue #283, X-01).

Covers the two entry points (command palette command, account menu item),
the panel being generated from the single KEYBOARD_SHORTCUTS constant,
keyboard-only operation (focus on open, Tab trap, Escape + focus restore),
and CSP-safe rendering.
"""

import pytest

from tests.conftest import assert_no_errors

MODAL = '#keyboardShortcutsModal'
OPEN = f'{MODAL}.flex-visible'


def _shortcut_count(page):
    return page.evaluate("""async () => {
        const mod = await import('/src/keyboardShortcuts.js');
        return mod.KEYBOARD_SHORTCUTS.reduce((n, group) => n + group.items.length, 0);
    }""")


def _open_via_api(page):
    page.wait_for_function("() => window.app && typeof window.app.openKeyboardShortcuts === 'function'", timeout=10000)
    page.evaluate("() => window.app.openKeyboardShortcuts()")
    page.wait_for_selector(OPEN, timeout=5000)


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------

@pytest.mark.ui
def test_command_palette_lists_and_opens_shortcuts(app_page):
    """'Keyboard shortcuts' is a command palette entry; Enter on it opens the panel."""
    page = app_page
    page.keyboard.press('Control+k')
    page.wait_for_selector('#commandPaletteOverlay:not(.hidden)', timeout=5000)

    page.fill('#commandPaletteInput', 'keyboard')
    labels = page.locator('#commandPaletteList .cmdpal-item-label').all_text_contents()
    assert 'Keyboard shortcuts' in labels

    page.keyboard.press('Enter')
    page.wait_for_selector(OPEN, timeout=5000)
    assert page.is_hidden('#commandPaletteOverlay'), "Palette should close when the command runs"
    assert_no_errors(page)


@pytest.mark.ui
def test_account_menu_item_opens_shortcuts(app_page):
    """The account (overflow) menu has a Keyboard Shortcuts item that opens the panel and closes the menu."""
    page = app_page
    page.click('#accountMenuBtn')
    item = page.locator('#accountMenuShortcutsBtn')
    assert item.is_visible()
    assert item.get_attribute('role') == 'menuitem'
    assert 'Keyboard Shortcuts' in item.text_content()

    item.click()
    page.wait_for_selector(OPEN, timeout=5000)
    assert page.locator('#accountMenuDropdown').is_hidden()


@pytest.mark.ui
def test_question_mark_key_does_not_open_panel(app_page):
    """No '?' hotkey was requested — pressing it must not open the panel."""
    page = app_page
    page.keyboard.press('Shift+Slash')
    page.wait_for_timeout(150)
    assert page.locator(MODAL).is_hidden()


# ---------------------------------------------------------------------------
# Content: single source of truth
# ---------------------------------------------------------------------------

@pytest.mark.ui
def test_panel_rows_match_constant(app_page):
    """Every KEYBOARD_SHORTCUTS item renders exactly one row; nothing is hard-coded in markup."""
    page = app_page
    _open_via_api(page)

    rows = page.locator('#keyboardShortcutsList .kbd-row')
    assert rows.count() == _shortcut_count(page)
    assert rows.count() > 0


@pytest.mark.ui
def test_panel_lists_command_palette_shortcut(app_page):
    """The panel documents Ctrl/⌘+K and Escape, rendered as <kbd> keys."""
    page = app_page
    _open_via_api(page)

    text = page.locator('#keyboardShortcutsList').text_content()
    assert 'command palette' in text.lower()
    kbd_keys = page.locator('#keyboardShortcutsList kbd').all_text_contents()
    for key in ('Ctrl', '⌘', 'K', 'Esc'):
        assert key in kbd_keys, f"Expected a <kbd>{key}</kbd> key in the panel"


@pytest.mark.ui
def test_constant_is_well_formed(app_page):
    """Every entry has a group name, at least one non-empty key combo, and a description."""
    problems = app_page.evaluate("""async () => {
        const { KEYBOARD_SHORTCUTS } = await import('/src/keyboardShortcuts.js');
        const bad = [];
        for (const group of KEYBOARD_SHORTCUTS) {
            if (!group.group) bad.push('group without name');
            for (const item of group.items) {
                const combosOk = Array.isArray(item.keys) && item.keys.length > 0
                    && item.keys.every(c => Array.isArray(c) && c.length > 0 && c.every(k => typeof k === 'string' && k));
                if (!combosOk || !item.description) bad.push(JSON.stringify(item));
            }
        }
        return bad;
    }""")
    assert problems == []


@pytest.mark.ui
def test_reopening_does_not_duplicate_rows(app_page):
    """Opening the panel repeatedly re-renders rather than appending duplicates."""
    page = app_page
    expected = _shortcut_count(page)
    for _ in range(3):
        _open_via_api(page)
        page.keyboard.press('Escape')
        page.wait_for_selector(MODAL, state='hidden', timeout=5000)
    _open_via_api(page)
    assert page.locator('#keyboardShortcutsList .kbd-row').count() == expected


# ---------------------------------------------------------------------------
# Keyboard accessibility
# ---------------------------------------------------------------------------

@pytest.mark.ui
def test_dialog_semantics_and_initial_focus(app_page):
    """The panel is a labelled modal dialog and moves focus inside on open."""
    page = app_page
    _open_via_api(page)
    modal = page.locator(MODAL)
    assert modal.get_attribute('role') == 'dialog'
    assert modal.get_attribute('aria-modal') == 'true'
    title_id = modal.get_attribute('aria-labelledby')
    assert page.locator(f'#{title_id}').text_content().strip() == 'Keyboard Shortcuts'

    page.wait_for_function(
        "() => document.getElementById('keyboardShortcutsModal').contains(document.activeElement)",
        timeout=2000
    )


@pytest.mark.ui
def test_escape_closes_and_restores_focus(app_page):
    """Escape closes the panel and returns focus to the element that opened it."""
    page = app_page
    page.focus('#commandPaletteBtn')
    _open_via_api(page)
    page.wait_for_function(
        "() => document.getElementById('keyboardShortcutsModal').contains(document.activeElement)",
        timeout=2000
    )

    page.keyboard.press('Escape')
    page.wait_for_selector(MODAL, state='hidden', timeout=5000)
    assert page.evaluate("() => document.activeElement.id") == 'commandPaletteBtn'


@pytest.mark.ui
def test_account_menu_open_restores_focus_to_menu_button(app_page):
    """Closing a panel opened from the account menu returns focus to the (visible) menu trigger."""
    page = app_page
    page.click('#accountMenuBtn')
    page.click('#accountMenuShortcutsBtn')
    page.wait_for_selector(OPEN, timeout=5000)
    page.keyboard.press('Escape')
    page.wait_for_selector(MODAL, state='hidden', timeout=5000)
    assert page.evaluate("() => document.activeElement.id") == 'accountMenuBtn'


@pytest.mark.ui
def test_tab_focus_is_trapped_inside_panel(app_page):
    """Tab and Shift+Tab cycle within the panel instead of escaping to the page behind it."""
    page = app_page
    _open_via_api(page)
    page.wait_for_function(
        "() => document.getElementById('keyboardShortcutsModal').contains(document.activeElement)",
        timeout=2000
    )
    inside = "() => document.getElementById('keyboardShortcutsModal').contains(document.activeElement)"
    for _ in range(4):
        page.keyboard.press('Tab')
        assert page.evaluate(inside), "Tab moved focus outside the shortcuts panel"
    for _ in range(4):
        page.keyboard.press('Shift+Tab')
        assert page.evaluate(inside), "Shift+Tab moved focus outside the shortcuts panel"


@pytest.mark.ui
@pytest.mark.parametrize('closer', ['#keyboardShortcutsCloseBtn', '#keyboardShortcutsDoneBtn'])
def test_close_buttons_close_panel(app_page, closer):
    """Both the × and Done buttons close the panel."""
    page = app_page
    _open_via_api(page)
    page.click(closer)
    page.wait_for_selector(MODAL, state='hidden', timeout=5000)


@pytest.mark.ui
def test_backdrop_click_closes_but_content_click_does_not(app_page):
    """Clicking the dimmed backdrop closes the panel; clicking inside the content does not."""
    page = app_page
    _open_via_api(page)
    page.click('#keyboardShortcutsList')
    assert page.locator(MODAL).is_visible()

    page.mouse.click(5, 5)
    page.wait_for_selector(MODAL, state='hidden', timeout=5000)


@pytest.mark.ui
def test_escape_when_closed_is_harmless(app_page):
    """Escape with the panel closed neither opens it nor throws."""
    page = app_page
    page.keyboard.press('Escape')
    assert page.locator(MODAL).is_hidden()
    assert_no_errors(page)


# ---------------------------------------------------------------------------
# CSP
# ---------------------------------------------------------------------------

@pytest.mark.ui
def test_panel_has_no_inline_styles_or_handlers(app_page):
    """Rendered panel uses no inline style/on* attributes (strict CSP) and logs no errors."""
    page = app_page
    _open_via_api(page)
    offenders = page.evaluate("""() => {
        const root = document.getElementById('keyboardShortcutsModal');
        return [root, ...root.querySelectorAll('*')]
            .filter(el => el.hasAttribute('style') || [...el.attributes].some(a => a.name.startsWith('on')))
            .map(el => el.outerHTML.slice(0, 80));
    }""")
    assert offenders == []
    assert_no_errors(page)
