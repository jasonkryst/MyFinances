#!/usr/bin/env python3
"""
Theme selector relocation tests (GitHub issue #71).

The 3-way Light/Dark/High Contrast #themeSwitcher <select> used to live
directly in the always-visible header toolbar (see test_high_contrast_theme.py
for its selection/persistence behavior, which is unchanged by this move). It
now lives inside the Settings modal (#settingsModal), grouped with the other
device-preference controls (Data Storage, Language) added by #35/#59-era
work. This file only covers the *location* change: where the control lives,
that it's reachable/labeled once Settings is open, and that opening/closing
Settings has no side effect on the currently-applied theme.
"""

import pytest

from tests.conftest import assert_no_errors, close_settings, open_settings


@pytest.mark.ui
def test_theme_switcher_lives_inside_settings_modal(app_page):
    """Positive: #themeSwitcher's containing modal is #settingsModal, not
    the header toolbar it used to live in."""
    page = app_page

    container_id = page.evaluate(
        "() => document.getElementById('themeSwitcher').closest('.modal')?.id"
    )
    assert container_id == 'settingsModal'

    in_toolbar = page.evaluate(
        "() => document.querySelector('.header-toolbar')"
        ".contains(document.getElementById('themeSwitcher'))"
    )
    assert in_toolbar is False, "Theme select must no longer be a toolbar child"


@pytest.mark.ui
def test_theme_switcher_hidden_until_settings_opened(app_page):
    """Negative: before Settings is opened, the theme select is not visible
    or interactable (it's inside the hidden modal, not floating in the
    always-visible toolbar the way it used to)."""
    page = app_page

    assert page.is_visible('#themeSwitcher') is False

    with pytest.raises(Exception):
        page.select_option('#themeSwitcher', 'dark', timeout=1000)


@pytest.mark.ui
def test_theme_switcher_visible_and_labeled_once_settings_open(app_page):
    """Positive: opening Settings makes the theme select visible, with a
    real associated <label> (accessible name), matching the Data
    Storage/Language controls next to it."""
    page = app_page
    open_settings(page)

    assert page.is_visible('#themeSwitcher') is True

    label_text = page.evaluate("""
        () => {
            const select = document.getElementById('themeSwitcher');
            const label = document.querySelector(`label[for="${select.id}"]`);
            return label ? label.textContent.trim() : null;
        }
    """)
    assert label_text, "themeSwitcher should have an associated <label for=...>"
    assert_no_errors(page)


@pytest.mark.ui
def test_selecting_theme_from_settings_modal_applies_immediately(app_page):
    """Positive: choosing a theme from within Settings applies it right
    away (no separate Done/Save step needed for the theme itself, matching
    its pre-move behavior of applying on `change`)."""
    page = app_page
    open_settings(page)

    page.select_option('#themeSwitcher', 'dark')
    page.wait_for_timeout(200)

    classes = page.evaluate("() => document.body.className")
    assert 'dark-mode' in classes


@pytest.mark.ui
def test_closing_settings_without_changing_theme_leaves_it_untouched(app_page):
    """Negative/regression: merely opening and closing Settings (Done
    button) must not itself change or reset the currently-applied theme."""
    page = app_page
    open_settings(page)
    page.select_option('#themeSwitcher', 'high-contrast')
    page.wait_for_timeout(150)
    close_settings(page)

    classes_after_close = page.evaluate("() => document.body.className")
    assert 'dark-mode' in classes_after_close
    assert 'high-contrast-mode' in classes_after_close

    # Re-opening Settings again (without touching the select) must not
    # reset it back to the default either.
    open_settings(page)
    value = page.evaluate("() => document.getElementById('themeSwitcher').value")
    assert value == 'high-contrast'
    assert_no_errors(page)


@pytest.mark.ui
def test_settings_modal_theme_select_has_three_options(app_page):
    """Positive regression guard: the move didn't drop an option — Settings
    still exposes exactly Light/Dark/High Contrast."""
    page = app_page
    open_settings(page)

    values = page.eval_on_selector_all(
        '#themeSwitcher option', 'opts => opts.map(o => o.value)'
    )
    assert values == ['light', 'dark', 'high-contrast']
