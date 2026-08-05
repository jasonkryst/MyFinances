#!/usr/bin/env python3
"""
Consolidated Export/Import "Backup & Restore" modal tests.

The toolbar's separate Export/Import icon buttons were replaced with one
#dataTransferBtn that opens a two-tab modal (#dataTransferModal). Import's
former alert()/confirm() feedback (invalid file, no data, too large, read
error, Replace-vs-Merge choice) now renders inline in the Import tab
instead. #exportJsonBtn/#importJsonBtn/#importJsonInput kept their ids,
just moved inside the modal.
"""

import pytest

from tests.conftest import open_data_transfer, close_data_transfer, assert_no_errors


@pytest.mark.ui
def test_toolbar_no_longer_has_separate_export_import_buttons(app_page):
    """Negative: the old standalone toolbar buttons are gone."""
    page = app_page
    assert page.query_selector('.header-toolbar > #exportJsonBtn') is None
    assert page.query_selector('.header-toolbar > #importJsonBtn') is None
    assert page.query_selector('#dataTransferBtn') is not None


@pytest.mark.ui
def test_data_transfer_modal_hidden_until_opened(app_page):
    """Negative: the modal (and everything in it) is not visible/interactable
    before the toolbar button is clicked."""
    page = app_page
    assert page.is_visible('#dataTransferModal') is False
    assert page.is_visible('#exportJsonBtn') is False
    assert page.is_visible('#importJsonBtn') is False


@pytest.mark.ui
def test_opening_modal_defaults_to_export_tab(app_page):
    """Positive: Export is the default active tab (lower-risk, more
    frequently used action)."""
    page = app_page
    open_data_transfer(page)

    assert page.is_visible('#exportJsonBtn') is True
    assert page.is_visible('#importJsonBtn') is False
    export_selected = page.get_attribute('[data-dt-tab="export"]', 'aria-selected')
    import_selected = page.get_attribute('[data-dt-tab="import"]', 'aria-selected')
    assert export_selected == 'true'
    assert import_selected == 'false'
    assert_no_errors(page)


@pytest.mark.ui
def test_switching_to_import_tab_shows_import_panel(app_page):
    """Positive: clicking the Import tab swaps visible panels and
    aria-selected state."""
    page = app_page
    open_data_transfer(page)

    page.click('[data-dt-tab="import"]')
    page.wait_for_timeout(100)

    assert page.is_visible('#importJsonBtn') is True
    assert page.is_visible('#exportJsonBtn') is False
    export_selected = page.get_attribute('[data-dt-tab="export"]', 'aria-selected')
    import_selected = page.get_attribute('[data-dt-tab="import"]', 'aria-selected')
    assert export_selected == 'false'
    assert import_selected == 'true'


@pytest.mark.ui
def test_close_button_hides_modal(app_page):
    """Positive: the × close button hides the modal again."""
    page = app_page
    open_data_transfer(page)
    close_data_transfer(page)

    assert page.is_visible('#dataTransferModal') is False


@pytest.mark.ui
def test_export_button_triggers_download(app_page):
    """Positive: clicking Export Backup in the modal downloads a JSON file
    (same underlying app.exportAllJSON(), just relocated)."""
    page = app_page
    open_data_transfer(page)

    with page.expect_download() as download_info:
        page.click('#exportJsonBtn')
    download = download_info.value
    assert download.suggested_filename.startswith('debt-tracker-backup-')


@pytest.mark.ui
@pytest.mark.skip(reason="inline Replace/Merge choice wired in Task 4")
def test_import_button_opens_file_picker_and_triggers_import(app_page):
    """Positive: clicking Choose File then selecting a file calls
    app.importAllJSON (verified via a resulting localStorage write)."""
    import json
    import tempfile
    import os

    page = app_page
    open_data_transfer(page)
    page.click('[data-dt-tab="import"]')

    test_data = {"accounts": [{"id": 1, "name": "DT Modal Test", "type": "Checking", "startingBalance": 100}], "debts": []}
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(test_data, f)
        temp_file = f.name

    try:
        file_input = page.query_selector('#importJsonInput')
        assert file_input, "Expected #importJsonInput inside the Import panel"
        file_input.set_input_files(temp_file)
        page.wait_for_timeout(500)
        # A valid, unambiguous single-account file still triggers the
        # Replace/Merge choice (app.js always supplies requestImportMode) -
        # picking either completes the import; Replace is simplest to assert.
        page.click('#importModeReplaceBtn')
        page.wait_for_timeout(300)

        stored = page.evaluate('() => localStorage.getItem(window.app?.storageKey || "debtTrackerData")')
        assert stored and 'DT Modal Test' in stored
    finally:
        os.unlink(temp_file)
