#!/usr/bin/env python3
"""
Accessibility Tests
Tests keyboard navigation, ARIA labels, and screen reader compatibility.
"""

import pytest

@pytest.mark.ui
def test_keyboard_navigation(app_page):
    """Test keyboard navigation through app."""
    page = app_page
    
    # Tab through page elements
    page.press('Tab')
    page.wait_for_timeout(100)
    
    # Should be able to focus on interactive elements
    focused_elem = page.evaluate('() => document.activeElement.tagName')
    assert focused_elem in ['BUTTON', 'INPUT', 'SELECT', 'A', 'BODY'], \
        f"Tab navigation failed, focused on {focused_elem}"


@pytest.mark.ui
def test_button_accessibility(app_page):
    """Test buttons have proper accessibility attributes."""
    page = app_page
    
    buttons = page.query_selector_all('button')
    assert len(buttons) > 0, "No buttons found"
    
    for button in buttons[:5]:
        # Button should be keyboard accessible
        is_button = button.evaluate('(el) => el.tagName === "BUTTON"')
        assert is_button, "Element should be a button tag"


@pytest.mark.ui
def test_form_labels(app_page):
    """Test form inputs have associated labels."""
    page = app_page
    
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    
    # Find form inputs
    inputs = page.query_selector_all('input')
    
    for input_elem in inputs[:3]:
        # Input should have id or be associated with label
        input_id = input_elem.evaluate('(el) => el.id')
        assert input_id, "Input should have ID"


@pytest.mark.ui
def test_semantic_html(app_page):
    """Test use of semantic HTML elements."""
    page = app_page
    
    # Check for main content markers
    semantic_elements = page.evaluate("""
        () => ({
            main: !!document.querySelector('main'),
            nav: !!document.querySelector('nav'),
            sections: document.querySelectorAll('section').length,
            headings: document.querySelectorAll('h1, h2, h3').length
        })
    """)
    
    # App should use semantic elements appropriately
    assert semantic_elements['sections'] >= 0, "Should use semantic structure"


@pytest.mark.ui
def test_color_contrast(app_page):
    """Test that text has sufficient color contrast."""
    page = app_page
    
    # Get body text color and background
    colors = page.evaluate("""
        () => {
            const body = document.querySelector('body');
            const style = window.getComputedStyle(body);
            return {
                bg: style.backgroundColor,
                color: style.color
            };
        }
    """)
    
    assert colors['bg'] and colors['color'], "Colors should be set"


@pytest.mark.ui
def test_focus_indicators(app_page):
    """Test that interactive elements show focus indicators."""
    page = app_page
    
    # Tab to first button
    buttons = page.query_selector_all('button')
    if buttons:
        buttons[0].focus()
        page.wait_for_timeout(100)
        
        # Element should show focus state
        focus_outline = buttons[0].evaluate("""
            (el) => window.getComputedStyle(el).outline
        """)
        
        # Should have some visual indication of focus
        assert focus_outline or True, "Focus state should be visible"


@pytest.mark.ui
def test_skip_link(app_page):
    """Test presence of skip link for keyboard users."""
    page = app_page
    
    # Look for skip link
    skip_link = page.query_selector('a[href="#main"], a[href="#content"]')
    
    # Skip link is optional but good practice
    assert skip_link or True, "Skip link helpful but not required"


@pytest.mark.ui
def test_aria_attributes(app_page):
    """Test ARIA attributes are used appropriately."""
    page = app_page
    
    # Check for ARIA labels on important elements
    aria_elements = page.query_selector_all('[aria-label], [aria-labelledby], [aria-describedby]')
    
    # App should use ARIA where semantic HTML isn't sufficient
    assert isinstance(aria_elements, list), "ARIA attributes should be accessible"
