#!/usr/bin/env python3
"""
CSP Compliance Tests
Verifies Content Security Policy compliance and no unsafe-inline violations.
"""

import pytest

BASE_URL = "http://localhost:5500/"


@pytest.mark.security
def test_csp_compliance(app_page):
    """Test that page complies with strict CSP policy."""
    page = app_page
    
    csp_errors = []
    
    def handle_console_msg(msg):
        if msg.type == "error" and ("style-src" in msg.text or "script-src" in msg.text):
            csp_errors.append(msg.text)
    
    page.on("console", handle_console_msg)
    
    # Trigger various interactions that toggle display
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    
    page.click('button[data-page="income"]')
    page.wait_for_timeout(300)
    
    page.click('button[data-page="liabilities"]')
    page.wait_for_timeout(300)
    
    page.click('button[data-page="savings"]')
    page.wait_for_timeout(300)
    
    page.click('button[data-page="strategy"]')
    page.wait_for_timeout(300)
    
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(300)
    
    # Verify no CSP errors were logged
    assert len(csp_errors) == 0, f"CSP violations detected: {csp_errors}"


@pytest.mark.security
def test_css_load_no_csp_violation(app_page):
    """Verify external CSS loads without CSP violations."""
    page = app_page
    
    # Check that styles.css was successfully loaded
    stylesheets = page.evaluate("""
        () => Array.from(document.styleSheets).map(s => s.href || 'inline')
    """)
    
    assert len(stylesheets) > 0, "No stylesheets loaded"
    assert any('styles.css' in str(s) for s in stylesheets), "styles.css not loaded"


@pytest.mark.security
def test_no_inline_styles_in_html(app_page):
    """Verify no inline style attributes present in HTML."""
    page = app_page
    
    # Check for inline style attributes
    inline_styles_count = page.evaluate("""
        () => document.querySelectorAll('[style]').length
    """)
    
    assert inline_styles_count == 0, \
        f"Found {inline_styles_count} elements with inline style attributes"


@pytest.mark.security
def test_modal_display_uses_classes_not_styles(app_page):
    """Verify modals use CSS classes, not inline styles."""
    page = app_page
    
    # Open a modal that would previously use inline styles
    page.click('button[data-page="strategy"]')
    page.wait_for_timeout(300)
    page.click('#debtFormToggle')
    page.wait_for_timeout(300)
    
    # Get modal element
    modal = page.query_selector('#debtFormModal')
    assert modal is not None, "Modal not found"
    
    # Check that modal uses classes, not style attribute
    style_attr = modal.evaluate('(el) => el.getAttribute("style")')
    has_class = modal.evaluate('(el) => el.className')
    
    # Modal should use classes (flex-visible, hidden) not inline styles
    assert not style_attr or 'display' not in style_attr, \
        "Modal uses inline style instead of CSS classes"


@pytest.mark.security
def test_security_headers_present(app_page):
    """Verify security headers are present in document."""
    page = app_page
    
    # Check for CSP meta tag
    csp_meta = page.query_selector('meta[http-equiv="Content-Security-Policy"]')
    assert csp_meta is not None, "CSP meta tag not found"
    
    # Check for X-Content-Type-Options
    xcontentype_meta = page.query_selector('meta[http-equiv="X-Content-Type-Options"]')
    assert xcontentype_meta is not None, "X-Content-Type-Options meta tag not found"
    
    # Check for X-Frame-Options
    xframe_meta = page.query_selector('meta[http-equiv="X-Frame-Options"]')
    assert xframe_meta is not None, "X-Frame-Options meta tag not found"
    
    # Verify CSP content
    csp_content = csp_meta.evaluate('(el) => el.getAttribute("content")')
    assert "script-src 'self'" in csp_content, "CSP missing strict script-src"
    assert "unsafe-inline" not in csp_content, "CSP contains unsafe-inline"
