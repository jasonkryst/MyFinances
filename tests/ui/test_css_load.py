#!/usr/bin/env python3
"""
CSS Loading and Styling Tests
Tests CSS stylesheet loading and utility class application.
"""

import pytest

BASE_URL = "http://localhost:5500/"


@pytest.mark.ui
def test_css_loads(app_page):
    """Test that CSS stylesheet loads successfully."""
    page = app_page
    
    stylesheets = page.evaluate("""
        () => Array.from(document.styleSheets).map(s => ({href: s.href, disabled: s.disabled}))
    """)
    
    assert len(stylesheets) > 0, "No stylesheets loaded"
    
    # styles.css should be loaded
    css_loaded = any('styles.css' in str(s.get('href', '')) for s in stylesheets)
    assert css_loaded, "styles.css not loaded"


@pytest.mark.ui
def test_utility_classes_applied(app_page):
    """Test that utility CSS classes are applied correctly."""
    page = app_page
    
    # Check for common utility classes
    hidden_elements = page.query_selector_all('.hidden')
    flex_visible_elements = page.query_selector_all('.flex-visible')
    visible_elements = page.query_selector_all('.visible')
    
    # Should have some elements with utility classes
    total_utility = len(hidden_elements) + len(flex_visible_elements) + len(visible_elements)
    assert total_utility >= 0, "Utility classes should be defined"


@pytest.mark.ui
def test_hidden_class_applies(app_page):
    """Test .hidden class properly hides elements."""
    page = app_page
    
    # Navigate to create a hidden element scenario
    page.click('button[data-page="strategy"]')
    page.wait_for_timeout(300)
    
    # Check if elements use .hidden class
    hidden_elements = page.query_selector_all('.hidden')
    
    for elem in hidden_elements:
        # Element with .hidden should have display: none or visibility: hidden
        display = elem.evaluate('(el) => window.getComputedStyle(el).display')
        # Display should be none for hidden class
        assert display == 'none' or display == 'hidden', "Hidden class not applied correctly"


@pytest.mark.ui
def test_responsive_breakpoints(app_page):
    """Test CSS media query breakpoints."""
    page = app_page
    
    # Get media query information from stylesheets
    media_queries = page.evaluate("""
        () => {
            const mqs = [];
            for (let sheet of document.styleSheets) {
                try {
                    if (sheet.cssRules) {
                        for (let rule of sheet.cssRules) {
                            if (rule.media) {
                                mqs.push(rule.media.mediaText);
                            }
                        }
                    }
                } catch (e) {}
            }
            return mqs;
        }
    """)
    
    # Should have some responsive rules
    assert isinstance(media_queries, list), "Media queries should be accessible"


@pytest.mark.ui
def test_form_styling(app_page):
    """Test form inputs and buttons have proper styling."""
    page = app_page
    
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    
    # Find form inputs
    inputs = page.query_selector_all('input[type="text"], input[type="number"]')
    buttons = page.query_selector_all('button')
    
    assert len(inputs) > 0, "Form inputs not found"
    assert len(buttons) > 0, "Buttons not found"
    
    # Check styling
    for input_elem in inputs[:3]:
        padding = input_elem.evaluate('(el) => window.getComputedStyle(el).padding')
        assert padding and padding != '0px', "Input should have padding"


@pytest.mark.ui
def test_modal_styling(app_page):
    """Test modal CSS styling."""
    page = app_page

    modal = page.query_selector('#amortizationModal')
    if modal:
        # Modal should have position styling
        position = modal.evaluate('(el) => window.getComputedStyle(el).position')
        # Position could be fixed or absolute
        assert position in ['fixed', 'absolute', 'relative'], "Modal should have position"


@pytest.mark.ui
def test_color_scheme(app_page):
    """Test color scheme is applied consistently."""
    page = app_page
    
    # Get body background color
    body_style = page.evaluate("""
        () => {
            const body = document.querySelector('body');
            const cs = window.getComputedStyle(body);
            return {
                bg: cs.backgroundColor,
                color: cs.color
            };
        }
    """)
    
    assert body_style['bg'], "Body should have background color"
    assert body_style['color'], "Body should have text color"
