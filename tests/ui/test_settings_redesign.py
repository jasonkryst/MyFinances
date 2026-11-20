#!/usr/bin/env python3
"""Settings redesign (7.20.0): grouped list, drill-in pages, two panes when wide,
save on change, Backup & Restore page, About group. See
docs/superpowers/specs/2026-11-20-settings-redesign-design.md."""

import pytest

from tests.conftest import open_settings, open_settings_page, wait_for_api

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


# ── Task 2: save on change ──────────────────────────────────────────────────

def _setting(rows, key):
    for row in rows:
        if row.get('key') == key:
            return row.get('value')
    return None


@pytest.mark.ui
def test_advanced_switch_saves_on_change_without_done(app_page):
    page = app_page
    open_settings_page(page, 'advanced')
    assert page.locator('#settingsModalDoneBtn').count() == 0
    page.click('#settingShowArchivedDebts')
    wait_for_api(page, '/api/settings', lambda rows: _setting(rows, 'showArchivedDebts') is True)


@pytest.mark.ui
def test_close_does_not_revert(app_page):
    page = app_page
    open_settings_page(page, 'advanced')
    page.select_option('#settingZeroAmountPolicy', 'warn')
    page.click('#settingsModalCloseBtn')
    wait_for_api(page, '/api/settings', lambda rows: _setting(rows, 'zeroAmountPolicy') == 'warn')
    open_settings_page(page, 'advanced')
    assert page.input_value('#settingZeroAmountPolicy') == 'warn'


@pytest.mark.ui
@pytest.mark.parametrize('bad', ['99', '-1', 'abc', ''])
def test_invalid_days_ahead_not_saved(app_page, bad):
    page = app_page
    open_settings_page(page, 'notifications')
    page.fill('#settingNotifyDaysAhead', bad)
    page.keyboard.press('Tab')
    assert page.locator('#settingNotifyDaysAheadError').is_visible()
    assert page.get_attribute('#settingNotifyDaysAhead', 'aria-invalid') == 'true'
    page.wait_for_timeout(1000)
    rows = page.evaluate("async () => (await fetch('/api/settings')).json()")
    assert _setting(rows, 'notifyDaysAhead') in (None, 3)
    page.fill('#settingNotifyDaysAhead', '5')
    page.keyboard.press('Tab')
    assert page.locator('#settingNotifyDaysAheadError').is_hidden()
    assert page.get_attribute('#settingNotifyDaysAhead', 'aria-invalid') == 'false'
    wait_for_api(page, '/api/settings', lambda rows: _setting(rows, 'notifyDaysAhead') == 5)


@pytest.mark.ui
def test_rapid_toggle_ends_at_final_value(app_page):
    page = app_page
    open_settings_page(page, 'notifications')
    # Default is on; two quick clicks end on again. Turn it off first so the
    # final state differs from the default.
    page.click('#settingNotifyBillDue')
    wait_for_api(page, '/api/settings', lambda rows: _setting(rows, 'notifyBillDue') is False)
    page.click('#settingNotifyBillDue')
    page.click('#settingNotifyBillDue')
    page.click('#settingNotifyBillDue')
    # three clicks from "on" (after the first off then...) -> compute: off, on, off, on => final on
    wait_for_api(page, '/api/settings', lambda rows: _setting(rows, 'notifyBillDue') is True)
    page.wait_for_timeout(1000)
    rows = page.evaluate("async () => (await fetch('/api/settings')).json()")
    assert _setting(rows, 'notifyBillDue') is True


@pytest.mark.ui
def test_language_change_keeps_page_and_focus(app_page):
    page = app_page
    open_settings_page(page, 'language')
    page.select_option('#settingLocale', 'es')
    page.wait_for_function("document.getElementById('settingsPageTitle-language').textContent !== 'Language & Region'")
    assert page.locator('#settingsPage-language').is_visible()
    expected = page.evaluate("async () => (await import('/src/locales/es.js')).default['settings.pageLanguage']")
    assert page.text_content('#settingsPageTitle-language') == expected
    assert _active_id(page) == 'settingLocale'


@pytest.mark.ui
def test_toggles_are_switches(app_page):
    page = app_page
    boxes = page.evaluate("""() => Array.from(document.querySelectorAll('#settingsModal input[type=checkbox]')).map(b => ({
        id: b.id, role: b.getAttribute('role'),
        name: (document.querySelector('label[for="' + b.id + '"]') || {}).textContent || ''
    }))""")
    assert boxes
    for b in boxes:
        assert b['role'] == 'switch', b
        assert b['name'].strip(), b


# ── Task 3: Backup & Restore page and entry points ──────────────────────────

@pytest.mark.ui
def test_account_menu_backup_opens_backup_page(app_page):
    page = app_page
    page.click('#accountMenuBtn')
    page.click('#accountMenuBackupBtn')
    page.wait_for_selector('#settingsPage-backup', state='visible', timeout=5000)


@pytest.mark.ui
def test_command_palette_import_opens_backup_page(app_page):
    page = app_page
    page.keyboard.press('Control+k')
    page.fill('#commandPaletteInput', 'Import')
    page.keyboard.press('Enter')
    page.wait_for_selector('#settingsPage-backup', state='visible', timeout=5000)
    page.wait_for_function("document.activeElement && document.activeElement.id === 'importJsonBtn'")


@pytest.mark.ui
def test_data_transfer_modal_is_gone(app_page):
    page = app_page
    assert page.locator('#dataTransferModal').count() == 0
    assert page.locator('[data-dt-tab]').count() == 0


@pytest.mark.ui
def test_backup_result_cleared_on_reopen(app_page):
    page = app_page
    open_settings_page(page, 'backup')
    page.evaluate("""async () => {
        const m = await import('/src/dataTransferModal.js');
        m.showImportResult('error', 'x', [{ recordType: 'debt', recordName: 'd', kind: 'rejected', reason: 'r' }]);
    }""")
    assert page.locator('#importResultBanner').is_visible()
    page.click('#settingsModalCloseBtn')
    open_settings_page(page, 'backup')
    assert page.locator('#importResultBanner').is_hidden()
    assert page.locator('#importWarningsList').inner_html() == ''


# ── Task 4: About page, row values, icons ───────────────────────────────────

@pytest.mark.ui
def test_row_values_show_theme_and_language(app_page):
    page = app_page
    page.set_viewport_size(WIDE)
    open_settings(page)
    value = page.text_content('#settingsRowValue-language')
    assert '·' in value and 'USD' in value
    page.select_option('#themeSwitcher', 'dark')
    selected = page.evaluate("document.getElementById('themeSwitcher').selectedOptions[0].textContent.trim()")
    assert page.text_content('#settingsRowValue-appearance').strip() == selected
    label = page.get_attribute('[data-settings-page="appearance"]', 'aria-label')
    assert label.startswith('Appearance') and selected in label


@pytest.mark.ui
def test_about_shows_version(app_page):
    page = app_page
    open_settings_page(page, 'about')
    version = page.evaluate("async () => (await import('/src/utils.js')).APP_VERSION")
    assert page.text_content('#settingsAboutVersion').strip() == version


@pytest.mark.ui
@pytest.mark.parametrize('btn,modal', [
    ('#settingsAboutShortcutsBtn', '#keyboardShortcutsModal'),
    ('#settingsAboutWhatsNewBtn', '#whatsNewModal'),
])
def test_about_modal_escape_returns_to_settings(app_page, btn, modal):
    page = app_page
    page.set_viewport_size(WIDE)
    open_settings_page(page, 'about')
    page.click(btn)
    page.wait_for_selector(modal, state='visible', timeout=5000)
    page.keyboard.press('Escape')
    page.wait_for_selector(modal, state='hidden', timeout=5000)
    assert page.locator('#settingsModal').is_visible()
    assert page.locator('#settingsPage-about').is_visible()
    assert _active_id(page) == btn[1:]


@pytest.mark.ui
def test_clear_all_data_row_still_confirms(app_page):
    page = app_page
    page.set_viewport_size(WIDE)
    open_settings(page)
    page.click('#clearDataBtn')
    page.wait_for_selector('#deleteConfirmModal', state='visible', timeout=5000)
    # Nothing is cleared until the confirm is accepted; cancel leaves Settings open.
    page.click('#deleteConfirmCancelBtn')
    page.wait_for_selector('#deleteConfirmModal', state='hidden', timeout=5000)
    assert page.locator('#settingsModal').is_visible()
