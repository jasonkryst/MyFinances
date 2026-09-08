#!/usr/bin/env python3
"""
Login Gate Theme Tests
Verifies the login gate overlay (#loginGate) matches the site's default
(light-mode) visual theme: gradient backdrop matching <body>, a header band
matching the real <header>'s blue gradient with the goal logo, and a flat
card body. Dark-mode and high-contrast variants are covered in
test_dark_mode.py and test_high_contrast_theme.py respectively.
"""

import pytest


@pytest.mark.ui
def test_login_gate_overlay_matches_body_gradient(app_page):
    """.login-gate overlay gradient should match the light-mode body
    backdrop gradient (#667eea -> #764ba2)."""
    page = app_page

    bg_image = page.evaluate(
        "() => getComputedStyle(document.querySelector('.login-gate')).backgroundImage"
    )
    assert 'gradient' in bg_image, ".login-gate overlay should have a gradient background"
    for stop in ('102, 126, 234', '118, 75, 162'):
        assert stop in bg_image, (
            f".login-gate overlay gradient should include rgb({stop}), got: {bg_image}"
        )


@pytest.mark.ui
def test_login_gate_header_band_present_with_logo(app_page):
    """The login gate should have a header band with the goal logo and
    title, matching the real site header's structure."""
    page = app_page

    header = page.query_selector('.login-gate-header')
    assert header is not None, ".login-gate-header band should exist"

    logo = page.query_selector('.login-gate-header .logo-svg')
    assert logo is not None, ".login-gate-header should include the goal logo SVG"

    title = page.query_selector('#loginGateTitle')
    assert title is not None
    assert title.evaluate("(el) => el.closest('.login-gate-header') !== null"), (
        "#loginGateTitle should live inside .login-gate-header"
    )


@pytest.mark.ui
def test_login_gate_header_band_matches_header_gradient(app_page):
    """.login-gate-header gradient should match the real <header>'s
    light-mode blue gradient (#2563eb -> #1d4ed8)."""
    page = app_page

    bg_image = page.evaluate(
        "() => getComputedStyle(document.querySelector('.login-gate-header')).backgroundImage"
    )
    for stop in ('37, 99, 235', '29, 78, 216'):
        assert stop in bg_image, (
            f".login-gate-header gradient should include rgb({stop}), got: {bg_image}"
        )


@pytest.mark.ui
def test_login_gate_card_stays_flat_and_opaque(app_page):
    """The card itself (not the overlay/header band) should stay a flat,
    opaque surface so form content stays readable regardless of the
    gradient backdrop behind it."""
    page = app_page

    card = page.evaluate("""
        () => {
            const style = getComputedStyle(document.querySelector('.login-gate-card'));
            return { backgroundImage: style.backgroundImage, backgroundColor: style.backgroundColor };
        }
    """)
    assert card['backgroundImage'] == 'none', ".login-gate-card should not have a gradient"
    assert card['backgroundColor'] not in ('rgba(0, 0, 0, 0)', 'transparent'), (
        ".login-gate-card should have an opaque background"
    )
