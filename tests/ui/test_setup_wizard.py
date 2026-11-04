#!/usr/bin/env python3
"""
First-Run Setup Wizard and Settings Modal Tests
The setup wizard (src/setupWizard.js) appears on a true first run, which
since v7.0.0 means "the reconciliationAdjustsBalance setting is absent on the
server after load" (spec §5 step 6). It lets the user choose whether
reconciliations adjust the tracked balance or are visible-only. The Settings
modal (gear icon) lets that choice be changed later.

The harness's reset seeds that setting so the wizard never blocks other tests;
the `first_run_page` fixture below deletes it again to simulate a first run.
"""

import pytest

from tests.conftest import seed_state, wait_for_api

_DELETE_ADJUSTS_SETTING_JS = """
    async () => {
        const csrf = (document.cookie.split('; ').find(c => c.startsWith('csrf=')) || '').slice(5);
        const r = await fetch('/api/settings/reconciliationAdjustsBalance', {
            method: 'DELETE',
            headers: { 'X-CSRF-Token': csrf },
        });
        if (!r.ok && r.status !== 404) throw new Error('settings DELETE failed: ' + r.status);
    }
"""


def _adjusts_setting(rows):
    entry = next((r for r in rows if r.get('key') == 'reconciliationAdjustsBalance'), None)
    return entry['value'] if entry else None


def _wizard_classes(page):
    return page.get_attribute('#setupWizardModal', 'class') or ''


@pytest.fixture
def first_run_page(app_page):
    """Signed-in page on an empty server with no reconciliationAdjustsBalance
    setting, reloaded so boot sees a first run and opens the wizard."""
    page = app_page
    page.evaluate(_DELETE_ADJUSTS_SETTING_JS)
    page.reload()
    page.wait_for_selector('#setupWizardModal.flex-visible', timeout=10000)
    return page


@pytest.mark.ui
def test_setup_wizard_shows_on_true_first_run(first_run_page):
    """With the setting absent on the server, the wizard appears on load."""
    classes = _wizard_classes(first_run_page)
    assert 'flex-visible' in classes
    assert 'hidden' not in classes


@pytest.mark.ui
def test_setup_wizard_does_not_show_once_setting_exists(app_page):
    """app_page's reset seeds the setting, so a reload must not show the wizard,
    even with an otherwise empty dataset."""
    page = app_page
    page.reload()
    classes = _wizard_classes(page)
    assert 'hidden' in classes
    assert 'flex-visible' not in classes


@pytest.mark.ui
def test_setup_wizard_not_shown_for_existing_data_without_setting(app_page):
    """An existing user who never opened Settings has data but no
    reconciliationAdjustsBalance setting. That is not a first run: no wizard,
    and What's New is not silently marked seen."""
    page = app_page
    seed_state(page, {'accounts': [{'id': 1, 'name': 'Existing Checking', 'type': 'Checking',
                                    'startingBalance': 100}]})
    page.evaluate("() => localStorage.removeItem('debtTrackerLastSeenVersion')")
    page.evaluate(_DELETE_ADJUSTS_SETTING_JS)
    page.reload()
    assert page.evaluate("() => window.app.accounts.length") == 1
    assert page.evaluate("() => window.app.getSetting('reconciliationAdjustsBalance', null)") is None
    assert 'hidden' in _wizard_classes(page)
    assert page.evaluate("() => localStorage.getItem('debtTrackerLastSeenVersion')") is None, \
        "What's New must not be silently marked seen for an existing user"


@pytest.mark.ui
def test_choosing_adjust_balance_persists_setting_and_closes_modal(first_run_page):
    """Selecting 'adjust balance' sets reconciliationAdjustsBalance=true on the
    server and hides the modal."""
    page = first_run_page
    page.click('#setupWizardAdjustBtn')
    page.wait_for_selector('#setupWizardModal', state='hidden', timeout=5000)

    assert page.evaluate("() => window.app.getSetting('reconciliationAdjustsBalance', null)") is True
    wait_for_api(page, '/api/settings', lambda rows: _adjusts_setting(rows) is True)


@pytest.mark.ui
def test_choosing_visible_only_persists_setting_and_closes_modal(first_run_page):
    """Selecting 'visible only' sets reconciliationAdjustsBalance=false on the
    server and hides the modal."""
    page = first_run_page
    page.click('#setupWizardVisibleBtn')
    page.wait_for_selector('#setupWizardModal', state='hidden', timeout=5000)

    assert page.evaluate("() => window.app.getSetting('reconciliationAdjustsBalance', null)") is False
    wait_for_api(page, '/api/settings', lambda rows: _adjusts_setting(rows) is False)


@pytest.mark.ui
def test_wizard_pre_saves_default_before_user_clicks(first_run_page):
    """The wizard writes a default (false) to the server as soon as it shows,
    before either button is clicked, so a refresh does not re-show it."""
    page = first_run_page
    wait_for_api(page, '/api/settings', lambda rows: _adjusts_setting(rows) is False)

    page.reload()
    assert 'hidden' in _wizard_classes(page), "Wizard must not reappear after a reload when pre-save fired"


@pytest.mark.ui
def test_wizard_escape_closes_modal(first_run_page):
    """Escape closes the wizard without a button click (the pre-saved default
    stands)."""
    page = first_run_page
    # Wait for focus to land on the Adjust button (setTimeout 30ms in open())
    page.wait_for_function(
        "() => document.activeElement && document.activeElement.id === 'setupWizardAdjustBtn'",
        timeout=2000
    )
    page.keyboard.press('Escape')

    classes = _wizard_classes(page)
    assert 'hidden' in classes, "Wizard must close on Escape"
    assert 'flex-visible' not in classes


@pytest.mark.ui
def test_wizard_backdrop_click_closes_modal(first_run_page):
    """Clicking the backdrop (outside the content box) closes the wizard."""
    page = first_run_page
    # Top-left corner: inside the overlay, outside the centred .modal-content.
    page.mouse.click(10, 10)

    classes = _wizard_classes(page)
    assert 'hidden' in classes, "Wizard must close when backdrop is clicked"
    assert 'flex-visible' not in classes


@pytest.mark.ui
def test_wizard_choice_survives_reload(first_run_page):
    """The wizard's choice is persisted on the server, not just held in memory."""
    page = first_run_page
    page.click('#setupWizardAdjustBtn')
    wait_for_api(page, '/api/settings', lambda rows: _adjusts_setting(rows) is True)

    page.reload()
    assert page.evaluate("() => window.app.getSetting('reconciliationAdjustsBalance', null)") is True
    assert 'hidden' in _wizard_classes(page), "Wizard must not reappear once a choice has been made"


@pytest.mark.ui
def test_settings_button_opens_settings_modal(app_page):
    """The gear toolbar button opens the Settings modal, reflecting the
    current reconciliation mode setting."""
    page = app_page

    page.evaluate("""() => { window.app.setSetting('reconciliationAdjustsBalance', true); }""")
    page.evaluate("() => document.getElementById('settingsBtn').click()")
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)
    page.click('[data-settings-tab="advanced"]')  # #322: Reconciliation toggle now lives on the Advanced tab

    checked = page.evaluate("""() => document.getElementById('settingReconciliationAdjusts').checked""")
    assert checked is True


@pytest.mark.ui
def test_settings_modal_save_updates_setting(app_page):
    """Toggling the checkbox and clicking Done persists the new value."""
    page = app_page

    page.evaluate("""() => { window.app.setSetting('reconciliationAdjustsBalance', false); }""")
    page.evaluate("() => document.getElementById('settingsBtn').click()")
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)
    page.click('[data-settings-tab="advanced"]')  # #322: Reconciliation toggle now lives on the Advanced tab

    checkbox = page.query_selector('#settingReconciliationAdjusts')
    assert checkbox.is_checked() is False
    checkbox.check()
    page.click('#settingsModalDoneBtn')
    page.wait_for_selector('#settingsModal', state='hidden', timeout=5000)

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

    page.evaluate("() => document.getElementById('settingsBtn').click()")
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)
    # The modal's Escape handler is wired on the modal element itself, so the
    # keydown only bubbles through it once focus has actually moved inside
    # (the post-open `setTimeout(..., 30)` focus shift) — wait for that first.
    # #322: the auto-focused control is now the first one on the default
    # (Appearance) tab, i.e. the theme select.
    page.wait_for_function(
        "() => document.activeElement && document.activeElement.id === 'themeSwitcher'",
        timeout=2000
    )
    page.keyboard.press('Escape')

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
    page.wait_for_selector('#commandPaletteList', timeout=5000)

    item = page.query_selector('.cmdpal-item')
    assert item, "Expected a matching command palette item for 'Settings'"
    assert 'Settings' in item.inner_text()

    item.click()
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)
