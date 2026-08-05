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
