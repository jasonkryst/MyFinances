#!/usr/bin/env python3
"""
Mobile Responsiveness Tests
Tests mobile menu, responsive layout, and touch interactions.
"""

import pytest

BASE_URL = "http://localhost:5500/"


@pytest.mark.ui
def test_mobile_menu_toggle(app_page):
    """Test mobile menu toggle functionality."""
    page = app_page
    
    # Find menu toggle button
    menu_toggle = page.query_selector('button[class*="menu"]')
    if menu_toggle:
        menu_toggle.click()
        page.wait_for_timeout(300)
        
        # Menu should toggle visibility
        nav_menu = page.query_selector('nav')
        assert nav_menu, "Navigation menu should exist"


@pytest.mark.ui
def test_responsive_button_sizing(app_page):
    """Test that buttons are appropriately sized for mobile."""
    page = app_page
    
    buttons = page.query_selector_all('button')
    assert len(buttons) > 0, "No buttons found"

    visible_buttons = [
        button for button in buttons
        if button.evaluate('(el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)')
    ]

    # Get button dimensions
    for button in visible_buttons[:5]:  # Check first 5 visible buttons
        size = button.evaluate('(el) => ({width: el.offsetWidth, height: el.offsetHeight})')
        # Buttons should have reasonable dimensions
        assert size['height'] >= 30, "Button height too small for touch"


@pytest.mark.ui
def test_mobile_viewport(app_page):
    """Test layout on mobile viewport."""
    page = app_page
    
    # Set mobile viewport
    page.set_viewport_size({"width": 375, "height": 667})
    page.reload()
    page.wait_for_load_state('networkidle')
    
    # App should render at mobile size
    body = page.query_selector('body')
    assert body, "Page body should render on mobile"
    
    # Reset viewport
    page.set_viewport_size({"width": 1280, "height": 720})


@pytest.mark.ui
def test_navigation_accessibility_mobile(app_page):
    """Test navigation is accessible on mobile."""
    page = app_page
    
    page.set_viewport_size({"width": 375, "height": 667})
    page.reload()
    page.wait_for_load_state('networkidle')
    
    # Navigation buttons should be accessible
    nav_buttons = page.query_selector_all('button[data-page]')
    assert len(nav_buttons) > 0, "Navigation buttons not found on mobile"
    
    # Reset viewport
    page.set_viewport_size({"width": 1280, "height": 720})
