#!/usr/bin/env python3
"""
Guide Theme Tests
guide.html's externalized src/guideTheme.js (added to satisfy the strict
CSP's no-inline-script rule) applies dark mode based on the same
'debtTrackerTheme' localStorage key the main app uses, so the guide
visually matches whatever theme the user left the app in.
"""

import pytest


@pytest.mark.ui
def test_guide_page_applies_dark_mode_from_localstorage(app_page):
    """guide.html applies dark-mode when debtTrackerTheme is 'dark'."""
    page = app_page
    page.evaluate("() => localStorage.setItem('debtTrackerTheme', 'dark')")

    with page.expect_popup() as popup_info:
        page.locator('#helpBtn').click()
    popup = popup_info.value
    popup.wait_for_load_state('domcontentloaded')

    is_dark = popup.evaluate("() => document.body.classList.contains('dark-mode')")
    assert is_dark, "guide.html should apply dark-mode class when debtTrackerTheme is 'dark'"
    popup.close()


@pytest.mark.ui
def test_guide_page_stays_light_without_saved_theme(app_page):
    """guide.html does not force dark mode when no theme preference is saved."""
    page = app_page
    page.evaluate("() => localStorage.removeItem('debtTrackerTheme')")

    with page.expect_popup() as popup_info:
        page.locator('#helpBtn').click()
    popup = popup_info.value
    popup.wait_for_load_state('domcontentloaded')

    is_dark = popup.evaluate("() => document.body.classList.contains('dark-mode')")
    assert not is_dark, "guide.html should not apply dark-mode class without a saved 'dark' theme"
    popup.close()


@pytest.mark.ui
def test_guide_page_stays_light_with_explicit_light_theme(app_page):
    """guide.html stays light when debtTrackerTheme is explicitly 'light'."""
    page = app_page
    page.evaluate("() => localStorage.setItem('debtTrackerTheme', 'light')")

    with page.expect_popup() as popup_info:
        page.locator('#helpBtn').click()
    popup = popup_info.value
    popup.wait_for_load_state('domcontentloaded')

    is_dark = popup.evaluate("() => document.body.classList.contains('dark-mode')")
    assert not is_dark, "guide.html should not apply dark-mode class when debtTrackerTheme is 'light'"
    popup.close()
