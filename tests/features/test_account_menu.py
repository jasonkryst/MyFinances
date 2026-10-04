"""
Tests for the Account menu (issue #221).

The Account menu button (person icon) opens a dropdown that contains:
  - Backup & Restore (opens the data-transfer modal)
  - Settings (opens the settings modal)
  - Sign Out (visible only in Postgres mode)
  - User email (visible only when a userEmail is set on app)

The toolbar no longer shows standalone Backup/Restore or Settings buttons;
those are hidden proxy elements kept only for backward-compat `.click()` wiring.
"""

import pytest

from tests.conftest import assert_no_errors


# ─── helpers ────────────────────────────────────────────────────────────────

def _open_account_menu(page):
    page.click('#accountMenuBtn')
    page.wait_for_selector('#accountMenuDropdown:not(.hidden)', timeout=3000)


def _close_account_menu(page):
    page.keyboard.press('Escape')


# ─── positive tests ──────────────────────────────────────────────────────────

@pytest.mark.feature
def test_account_menu_btn_exists_in_toolbar(app_page):
    """The Account menu button is present in the toolbar."""
    page = app_page
    btn = page.query_selector('#accountMenuBtn')
    assert btn is not None, "Account menu button should be in the toolbar"
    assert_no_errors(page)


@pytest.mark.feature
def test_account_menu_opens_on_click(app_page):
    """Clicking the Account button reveals the dropdown."""
    page = app_page
    assert page.query_selector('#accountMenuDropdown.hidden') is not None, \
        "Dropdown should start hidden"
    _open_account_menu(page)
    dropdown = page.query_selector('#accountMenuDropdown')
    assert dropdown is not None
    is_hidden = page.evaluate("() => document.getElementById('accountMenuDropdown').classList.contains('hidden')")
    assert not is_hidden, "Dropdown should be visible after clicking"
    assert_no_errors(page)


@pytest.mark.feature
def test_account_menu_closes_on_escape(app_page):
    """Pressing Escape closes the dropdown."""
    page = app_page
    _open_account_menu(page)
    page.keyboard.press('Escape')
    is_hidden = page.evaluate("() => document.getElementById('accountMenuDropdown').classList.contains('hidden')")
    assert is_hidden, "Dropdown should close on Escape"
    assert_no_errors(page)


@pytest.mark.feature
def test_account_menu_closes_on_outside_click(app_page):
    """Clicking outside the account menu wrapper closes the dropdown."""
    page = app_page
    _open_account_menu(page)
    page.click('h1')  # click outside the menu area
    is_hidden = page.evaluate("() => document.getElementById('accountMenuDropdown').classList.contains('hidden')")
    assert is_hidden, "Dropdown should close when clicking outside"
    assert_no_errors(page)


@pytest.mark.feature
def test_account_menu_backup_item_opens_data_transfer_modal(app_page):
    """Clicking Backup & Restore in the Account menu opens the data-transfer modal."""
    page = app_page
    _open_account_menu(page)
    page.click('#accountMenuBackupBtn')
    page.wait_for_selector('#dataTransferModal.flex-visible', timeout=5000)
    assert page.query_selector('#dataTransferModal.flex-visible'), \
        "Data-transfer modal should open after clicking Backup & Restore"
    assert_no_errors(page)


@pytest.mark.feature
def test_account_menu_settings_item_opens_settings_modal(app_page):
    """Clicking Settings in the Account menu opens the settings modal."""
    page = app_page
    _open_account_menu(page)
    page.click('#accountMenuSettingsBtn')
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)
    assert page.query_selector('#settingsModal.flex-visible'), \
        "Settings modal should open after clicking Settings"
    assert_no_errors(page)


@pytest.mark.feature
def test_standalone_settings_button_hidden_from_toolbar(app_page):
    """The standalone settingsBtn is no longer visible in the toolbar (moved to Account menu)."""
    page = app_page
    is_visible = page.evaluate("""() => {
        const btn = document.getElementById('settingsBtn');
        if (!btn) return false;
        const style = window.getComputedStyle(btn);
        return style.display !== 'none' && !btn.classList.contains('hidden');
    }""")
    assert not is_visible, "settingsBtn should be hidden (moved into Account menu)"
    assert_no_errors(page)


@pytest.mark.feature
def test_standalone_data_transfer_button_hidden_from_toolbar(app_page):
    """The standalone dataTransferBtn is no longer visible in the toolbar (moved to Account menu)."""
    page = app_page
    is_visible = page.evaluate("""() => {
        const btn = document.getElementById('dataTransferBtn');
        if (!btn) return false;
        const style = window.getComputedStyle(btn);
        return style.display !== 'none' && !btn.classList.contains('hidden');
    }""")
    assert not is_visible, "dataTransferBtn should be hidden (moved into Account menu)"
    assert_no_errors(page)


@pytest.mark.feature
def test_calendar_feed_button_still_in_toolbar(app_page):
    """The Calendar feed button remains directly in the toolbar (not moved to Account menu)."""
    page = app_page
    is_visible = page.evaluate("""() => {
        const btn = document.getElementById('calendarFeedBtn');
        if (!btn) return false;
        const style = window.getComputedStyle(btn);
        return style.display !== 'none' && !btn.classList.contains('hidden');
    }""")
    assert is_visible, "calendarFeedBtn should still be visible directly in the toolbar"
    assert_no_errors(page)


# ─── negative / edge cases ───────────────────────────────────────────────────

@pytest.mark.feature
def test_logout_item_hidden_in_local_storage_mode(app_page):
    """Sign Out item is hidden when the storage backend is localStorage (no Postgres session)."""
    page = app_page
    # Default app_page fixture uses localStorage backend
    _open_account_menu(page)
    logout_hidden = page.evaluate(
        "() => document.getElementById('accountMenuLogoutBtn')?.classList.contains('hidden') ?? true"
    )
    assert logout_hidden, "Sign Out should be hidden in local-storage mode"
    assert_no_errors(page)


@pytest.mark.feature
def test_email_hidden_when_no_user_email_set(app_page):
    """The email display line is hidden when app.userEmail is not set."""
    page = app_page
    # app_page is local-storage mode — userEmail is not set
    email_el_hidden = page.evaluate("""() => {
        const el = document.getElementById('accountMenuEmail');
        return !el || el.classList.contains('hidden') || el.textContent.trim() === '';
    }""")
    assert email_el_hidden, "Email display should be empty/hidden when no userEmail is set"
    assert_no_errors(page)


@pytest.mark.feature
def test_email_shown_when_user_email_set(app_page):
    """When app.userEmail is set, updateAccountMenuEmail populates the email display."""
    page = app_page
    # Set userEmail and call updateAccountMenuEmail to refresh the display
    page.evaluate("""async () => {
        window.app.userEmail = 'test@example.com';
        const { updateAccountMenuEmail } = await import('/src/ui.js');
        updateAccountMenuEmail(window.app);
    }""")
    page.wait_for_timeout(200)
    email_text = page.evaluate("() => document.getElementById('accountMenuEmail')?.textContent?.trim() ?? ''")
    assert 'test@example.com' in email_text, \
        f"Email should appear in the menu header when userEmail is set, got: '{email_text}'"
    assert_no_errors(page)


@pytest.mark.feature
def test_command_palette_settings_command_still_works(app_page):
    """The 'Settings' command in the command palette still opens the settings modal."""
    page = app_page
    # Open command palette via keyboard shortcut
    page.keyboard.press('Control+k')
    page.wait_for_selector('#commandPaletteOverlay:not(.hidden)', timeout=3000)
    page.fill('#commandPaletteInput', 'Settings')
    page.wait_for_selector('#commandPaletteList .cmdpal-item', timeout=3000)
    page.keyboard.press('Enter')
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)
    assert page.query_selector('#settingsModal.flex-visible'), \
        "Settings command palette entry should still open the settings modal"
    assert_no_errors(page)
