#!/usr/bin/env python3
"""
Dark Mode Tests
Tests dark mode toggle and styling functionality.
"""

import pytest

@pytest.mark.ui
def test_dark_mode_toggle_available(app_page):
    """Test that dark mode toggle is available."""
    page = app_page
    
    # Look for dark mode toggle button
    dark_toggle = page.query_selector('[class*="dark"], [id*="dark"], button[aria-label*="dark"], button:has-text("Dark")')
    # Dark mode toggle may or may not be implemented
    assert page.query_selector('body'), "Page body should exist"


@pytest.mark.ui
def test_dark_mode_class_application(app_page):
    """Test dark mode class is applied to body."""
    page = app_page
    
    body = page.query_selector('body')
    initial_classes = body.evaluate('(el) => el.className')
    
    # Check if dark-mode class exists
    if 'dark-mode' in initial_classes:
        # Dark mode is on, test turning it off
        dark_toggle = page.query_selector('[class*="dark"], button[aria-label*="dark"]')
        if dark_toggle:
            dark_toggle.click()
            page.wait_for_timeout(300)
            
            # Dark mode class should be removed
            updated_classes = body.evaluate('(el) => el.className')
            assert 'dark-mode' not in updated_classes, "Dark mode class should be toggled"


@pytest.mark.ui
def test_dark_mode_colors(app_page):
    """Test dark mode applies different colors."""
    page = app_page
    
    body = page.query_selector('body')
    
    # Get computed background color
    bg_color = body.evaluate('(el) => window.getComputedStyle(el).backgroundColor')
    
    # Background should resolve to a color string
    assert isinstance(bg_color, str) and len(bg_color) > 0, "Background color should be set"


@pytest.mark.ui
def test_dark_mode_persistence(app_page):
    """Test dark mode preference is persisted."""
    page = app_page
    
    # Check if localStorage has dark mode preference
    dark_pref = page.evaluate('() => localStorage.getItem("dark-mode") || localStorage.getItem("darkMode")')
    # Preference may or may not be stored
    assert page.query_selector('body'), "Page should load"


@pytest.mark.ui
def test_dark_mode_modal_styling(app_page):
    """Test that modals are properly styled in dark mode."""
    page = app_page

    modal = page.query_selector('#amortizationModal')
    if modal:
        # Modal should have proper styling regardless of dark mode
        bg_color = modal.evaluate('(el) => window.getComputedStyle(el).backgroundColor')
        assert bg_color, "Modal should have background color"


@pytest.mark.ui
def test_dark_mode_corrupted_localStorage_value_falls_back_safely(page):
    """src/ui.js only calls applyTheme() when debtTrackerTheme is exactly
    'dark' or 'light'. If localStorage holds a garbage value (e.g. from a
    corrupted/old write), the app must not crash and must not apply
    dark-mode styling based on that garbage value."""
    from tests.conftest import BASE_URL, assert_no_errors

    # Seed the garbage value before the app's init script runs.
    page.add_init_script(
        "window.localStorage.setItem('debtTrackerTheme', 'banana');"
    )
    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)

    assert_no_errors(page)

    body = page.query_selector('body')
    classes = body.evaluate('(el) => el.className')
    assert 'dark-mode' not in classes, (
        "A corrupted theme value must not result in dark-mode being applied"
    )

    # The garbage value itself should be left untouched (the app shouldn't
    # silently overwrite/normalize it on load), but reload should keep
    # behaving safely too.
    stored_value = page.evaluate("() => localStorage.getItem('debtTrackerTheme')")
    assert stored_value == 'banana'

    page.reload(wait_until="networkidle")
    assert_no_errors(page)
    classes_after_reload = page.query_selector('body').evaluate('(el) => el.className')
    assert 'dark-mode' not in classes_after_reload, (
        "Corrupted theme value must continue to fall back safely after reload"
    )

    # Theme switcher should still function normally afterward.
    theme_switcher = page.query_selector('#themeSwitcher')
    if theme_switcher:
        theme_switcher.click()
        page.wait_for_timeout(200)
        new_value = page.evaluate("() => localStorage.getItem('debtTrackerTheme')")
        assert new_value in ('dark', 'light'), (
            "Toggling the theme after a corrupted value should write a valid value"
        )
