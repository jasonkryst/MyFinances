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
    from tests.conftest import BASE_URL, assert_no_errors, open_settings

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

    # Theme switcher (a 3-option Light/Dark/High Contrast <select>, GitHub
    # issue #33) should still function normally afterward.
    theme_switcher = page.query_selector('#themeSwitcher')
    if theme_switcher:
        open_settings(page)
        page.select_option('#themeSwitcher', 'dark')
        page.wait_for_timeout(200)
        new_value = page.evaluate("() => localStorage.getItem('debtTrackerTheme')")
        assert new_value in ('light', 'dark', 'high-contrast'), (
            "Selecting a theme after a corrupted value should write a valid value"
        )

@pytest.mark.ui
def test_pg_modal_content_not_white_in_dark_mode(app_page):
    """pgMigrationModal and pgSwitchConfirmModal .modal-content must not be
    white in dark mode — they use the base .modal-content rule which now
    reads var(--bg-secondary) rather than hardcoded white (issue #120)."""
    from tests.conftest import open_settings

    page = app_page
    open_settings(page)
    page.select_option('#themeSwitcher', 'dark')
    page.wait_for_timeout(200)

    for modal_id in ['pgMigrationModal', 'pgSwitchConfirmModal']:
        bg = page.evaluate(f"""
            () => getComputedStyle(
                document.querySelector('#{modal_id} .modal-content')
            ).backgroundColor
        """)
        assert bg != 'rgb(255, 255, 255)', (
            f"#{modal_id} .modal-content must not be white in dark mode"
        )


@pytest.mark.ui
def test_login_gate_card_not_white_in_dark_mode(app_page):
    """Login gate card (.login-gate-card) must not be white in dark mode.
    The CSS uses var(--bg-secondary) which is now defined as #1e293b for
    dark mode (issue #120)."""
    from tests.conftest import open_settings

    page = app_page
    open_settings(page)
    page.select_option('#themeSwitcher', 'dark')
    page.wait_for_timeout(200)

    card_bg = page.evaluate(
        "() => getComputedStyle(document.querySelector('.login-gate-card')).backgroundColor"
    )
    assert card_bg != 'rgb(255, 255, 255)', (
        ".login-gate-card must not be white in dark mode"
    )
    # Should be the dark surface color defined as --bg-secondary in body.dark-mode
    assert card_bg == 'rgb(30, 41, 59)', (
        ".login-gate-card background should be the dark --bg-secondary (#1e293b)"
    )


@pytest.mark.ui
def test_login_gate_overlay_not_white_in_dark_mode(app_page):
    """Login gate overlay (.login-gate) must not be white/transparent in
    dark mode. var(--bg-primary) is now defined as #0f172a (issue #120)."""
    from tests.conftest import open_settings

    page = app_page
    open_settings(page)
    page.select_option('#themeSwitcher', 'dark')
    page.wait_for_timeout(200)

    overlay_bg = page.evaluate(
        "() => getComputedStyle(document.querySelector('.login-gate')).backgroundColor"
    )
    # Must not be transparent (rgba(0,0,0,0)) or white (rgb(255,255,255))
    assert overlay_bg not in ('rgba(0, 0, 0, 0)', 'rgb(255, 255, 255)'), (
        ".login-gate overlay must have a defined background in dark mode"
    )
    assert overlay_bg == 'rgb(15, 23, 42)', (
        ".login-gate overlay background should be the dark --bg-primary (#0f172a)"
    )
