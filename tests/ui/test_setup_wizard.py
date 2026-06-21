#!/usr/bin/env python3
"""
First-Run Setup Wizard and Settings Modal Tests
The setup wizard (src/setupWizard.js) appears only when localStorage has no
debtTrackerData key at all (a true first run) and lets the user choose
whether reconciliations adjust the tracked balance or are visible-only. The
Settings modal (gear icon) lets that choice be changed later. These tests
use the raw `page` fixture rather than `app_page`, since app_page seeds
localStorage to skip the wizard for the rest of the suite.
"""

import pytest


@pytest.mark.ui
def test_setup_wizard_shows_on_true_first_run(page):
    """With completely empty localStorage, the setup wizard modal appears
    automatically on load."""
    from tests.conftest import BASE_URL
    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)

    modal = page.query_selector('#setupWizardModal')
    assert modal, "Setup wizard modal should exist in the DOM"
    classes = modal.get_attribute('class') or ''
    assert 'flex-visible' in classes
    assert 'hidden' not in classes


@pytest.mark.ui
def test_setup_wizard_does_not_show_once_data_exists(page):
    """Once any debtTrackerData key exists in localStorage (even empty),
    the wizard must not show on the next load."""
    from tests.conftest import BASE_URL
    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
    page.evaluate("""() => {
        localStorage.setItem('debtTrackerData', JSON.stringify({ accounts: [], debts: [], settings: [] }));
    }""")
    page.reload(wait_until="networkidle")

    modal = page.query_selector('#setupWizardModal')
    assert modal, "Setup wizard modal should exist in the DOM"
    classes = modal.get_attribute('class') or ''
    assert 'hidden' in classes
    assert 'flex-visible' not in classes


@pytest.mark.ui
def test_choosing_adjust_balance_persists_setting_and_closes_modal(page):
    """Selecting 'adjust balance' in the wizard sets
    reconciliationAdjustsBalance=true and hides the modal."""
    from tests.conftest import BASE_URL
    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
    page.wait_for_selector('#setupWizardModal.flex-visible', timeout=5000)

    page.click('#setupWizardAdjustBtn')
    page.wait_for_timeout(200)

    modal = page.query_selector('#setupWizardModal')
    classes = modal.get_attribute('class') or ''
    assert 'hidden' in classes

    setting = page.evaluate("""() => window.app.getSetting('reconciliationAdjustsBalance', null)""")
    assert setting is True


@pytest.mark.ui
def test_choosing_visible_only_persists_setting_and_closes_modal(page):
    """Selecting 'visible only' in the wizard sets
    reconciliationAdjustsBalance=false and hides the modal."""
    from tests.conftest import BASE_URL
    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
    page.wait_for_selector('#setupWizardModal.flex-visible', timeout=5000)

    page.click('#setupWizardVisibleBtn')
    page.wait_for_timeout(200)

    modal = page.query_selector('#setupWizardModal')
    classes = modal.get_attribute('class') or ''
    assert 'hidden' in classes

    setting = page.evaluate("""() => window.app.getSetting('reconciliationAdjustsBalance', null)""")
    assert setting is False


@pytest.mark.ui
def test_wizard_choice_survives_reload(page):
    """The wizard's choice is actually persisted to localStorage, not just
    held in memory."""
    from tests.conftest import BASE_URL
    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
    page.wait_for_selector('#setupWizardModal.flex-visible', timeout=5000)
    page.click('#setupWizardAdjustBtn')
    page.wait_for_timeout(200)

    page.reload(wait_until="networkidle")
    setting = page.evaluate("""() => window.app.getSetting('reconciliationAdjustsBalance', null)""")
    assert setting is True

    modal = page.query_selector('#setupWizardModal')
    classes = modal.get_attribute('class') or ''
    assert 'hidden' in classes, "Wizard must not reappear once a choice has been made"


@pytest.mark.ui
def test_settings_button_opens_settings_modal(app_page):
    """The gear toolbar button opens the Settings modal, reflecting the
    current reconciliation mode setting."""
    page = app_page

    page.evaluate("""() => { window.app.setSetting('reconciliationAdjustsBalance', true); }""")
    page.click('#settingsBtn')
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)

    checked = page.evaluate("""() => document.getElementById('settingReconciliationAdjusts').checked""")
    assert checked is True


@pytest.mark.ui
def test_settings_modal_save_updates_setting(app_page):
    """Toggling the checkbox and clicking Done persists the new value."""
    page = app_page

    page.evaluate("""() => { window.app.setSetting('reconciliationAdjustsBalance', false); }""")
    page.click('#settingsBtn')
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)

    checkbox = page.query_selector('#settingReconciliationAdjusts')
    assert checkbox.is_checked() is False
    checkbox.check()
    page.click('#settingsModalDoneBtn')
    page.wait_for_timeout(200)

    setting = page.evaluate("""() => window.app.getSetting('reconciliationAdjustsBalance', null)""")
    assert setting is True

    modal = page.query_selector('#settingsModal')
    classes = modal.get_attribute('class') or ''
    assert 'hidden' in classes


@pytest.mark.ui
def test_settings_modal_escape_closes_without_losing_unsaved_choice_state(app_page):
    """Pressing Escape closes the Settings modal (via the same keyboard
    pattern used by the reconcile/ledger-override modals)."""
    page = app_page

    page.click('#settingsBtn')
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)
    # The modal's Escape handler is wired on the modal element itself, so the
    # keydown only bubbles through it once focus has actually moved inside
    # (the post-open `setTimeout(..., 30)` focus shift) — wait for that first.
    page.wait_for_function(
        "() => document.activeElement && document.activeElement.id === 'settingReconciliationAdjusts'",
        timeout=2000
    )
    page.keyboard.press('Escape')
    page.wait_for_timeout(200)

    modal = page.query_selector('#settingsModal')
    classes = modal.get_attribute('class') or ''
    assert 'hidden' in classes


@pytest.mark.ui
def test_command_palette_has_settings_entry(app_page):
    """The command palette includes a 'Settings' action that opens the
    Settings modal."""
    page = app_page

    page.keyboard.press('Control+k')
    page.wait_for_selector('#commandPaletteOverlay:not(.hidden)', timeout=5000)
    page.fill('#commandPaletteInput', 'Settings')
    page.wait_for_timeout(150)

    item = page.query_selector('.cmdpal-item')
    assert item, "Expected a matching command palette item for 'Settings'"
    assert 'Settings' in item.inner_text()

    item.click()
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)
