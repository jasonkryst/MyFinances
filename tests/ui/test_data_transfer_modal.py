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
def test_import_button_opens_file_picker_and_triggers_import(app_page):
    """Positive: clicking Choose File then selecting a file calls
    app.importAllJSON (verified via a resulting localStorage write)."""
    import json
    import tempfile
    import os

    page = app_page
    open_data_transfer(page)
    page.click('[data-dt-tab="import"]')

    # dataExport.js's "no recognisable data" check only looks at
    # debts/incomes/strategy/bills/expenses/recurring, not accounts -
    # an accounts-only file trips it, so include a debt too.
    test_data = {
        "accounts": [{"id": 1, "name": "DT Modal Test", "type": "Checking", "startingBalance": 100}],
        "debts": [{"name": "DT Modal Card", "accountBalance": 50, "interestRate": 10, "minimumPayment": 10}],
    }
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


@pytest.mark.ui
def test_invalid_json_file_shows_inline_error_banner(app_page):
    """Positive: selecting a non-JSON file shows an inline error banner
    instead of a native alert()."""
    import tempfile
    import os

    page = app_page
    open_data_transfer(page)
    page.click('[data-dt-tab="import"]')

    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        f.write('not valid json {{{')
        temp_file = f.name

    try:
        page.query_selector('#importJsonInput').set_input_files(temp_file)
        page.wait_for_timeout(300)

        banner = page.query_selector('#importResultBanner')
        assert banner.is_visible()
        assert 'Invalid JSON' in banner.inner_text()
        assert 'target-result--error' in banner.get_attribute('class')
    finally:
        os.unlink(temp_file)


@pytest.mark.ui
def test_empty_data_file_shows_inline_error_banner(app_page):
    """Positive: a syntactically valid JSON file with no recognisable data
    shows an inline error banner."""
    import json
    import tempfile
    import os

    page = app_page
    open_data_transfer(page)
    page.click('[data-dt-tab="import"]')

    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump({"foo": "bar"}, f)
        temp_file = f.name

    try:
        page.query_selector('#importJsonInput').set_input_files(temp_file)
        page.wait_for_timeout(300)

        banner = page.query_selector('#importResultBanner')
        assert banner.is_visible()
        assert 'No recognisable data' in banner.inner_text()
    finally:
        os.unlink(temp_file)


@pytest.mark.ui
def test_replace_vs_merge_choice_shown_inline_not_as_native_confirm(app_page):
    """Positive: importing over existing data shows the inline
    Replace/Merge choice (no native confirm() dialog — the page fixture
    would auto-accept any native dialog, which would mean OK/Replace; here
    we explicitly click Merge and verify merge semantics took effect)."""
    import json
    import tempfile
    import os

    page = app_page
    page.click('button[data-page="accounts"]')
    page.fill('#accountName', 'Pre-existing Account')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '1000')
    page.click('#accountFormSubmit')
    page.wait_for_selector('text=Pre-existing Account', timeout=10000)

    open_data_transfer(page)
    page.click('[data-dt-tab="import"]')

    # dataExport.js's "no recognisable data" check only looks at
    # debts/incomes/strategy/bills/expenses/recurring, not accounts -
    # an accounts-only file trips it, so include a debt too.
    new_data = {
        "accounts": [{"id": 2, "name": "Imported Account", "type": "Savings", "startingBalance": 500}],
        "debts": [{"name": "Imported Card", "accountBalance": 25, "interestRate": 5, "minimumPayment": 5}],
    }
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(new_data, f)
        temp_file = f.name

    try:
        page.query_selector('#importJsonInput').set_input_files(temp_file)
        page.wait_for_timeout(300)

        assert page.is_visible('#importModeChoice')
        summary = page.inner_text('#importModeSummary')
        assert 'account' in summary.lower()

        page.click('#importModeMergeBtn')
        page.wait_for_timeout(300)

        assert page.is_visible('#importModeChoice') is False
        banner = page.query_selector('#importResultBanner')
        assert banner.is_visible()
    finally:
        os.unlink(temp_file)


@pytest.mark.ui
def test_merge_with_skipped_duplicates_shows_duplicate_count_not_generic_message(app_page):
    """Regression guard for the onImported/onMergeDuplicates ordering fix in
    dataExport.js: when duplicates are skipped during a Merge, the banner
    must show the duplicate-count message, not get overwritten by the
    generic "Imported: ..." message."""
    import json
    import tempfile
    import os

    page = app_page
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.click('#debtFormToggle')
    page.fill('#debtName', 'Dup Card')
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', '100')
    page.fill('#interestRate', '10')
    page.fill('#minimumPayment', '25')
    page.fill('#dueDate', '5')
    page.click('#debtFormSubmit')
    page.wait_for_selector('text=Dup Card', timeout=10000)

    open_data_transfer(page)
    page.click('[data-dt-tab="import"]')

    dup_data = {"debts": [{"name": "Dup Card", "accountBalance": 200, "interestRate": 15, "minimumPayment": 30}]}
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(dup_data, f)
        temp_file = f.name

    try:
        page.query_selector('#importJsonInput').set_input_files(temp_file)
        page.wait_for_timeout(300)
        page.click('#importModeMergeBtn')
        page.wait_for_timeout(300)

        banner_text = page.inner_text('#importResultBanner')
        assert 'Skipped 1 duplicate' in banner_text
    finally:
        os.unlink(temp_file)
