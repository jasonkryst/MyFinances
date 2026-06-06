#!/usr/bin/env python3
"""
CSP Compliance Tests
Verifies Content Security Policy compliance and no unsafe-inline violations.
"""

import pytest

BASE_URL = "http://localhost:5500/"


@pytest.mark.security
def test_csp_compliance(page):
    """Test that page load and navigation produce no CSP violations.

    Uses the bare `page` fixture (not `app_page`) so the listener is registered
    before goto() — catching any violations raised during initial page parse/load.
    """
    csp_errors = []

    def handle_console_msg(msg):
        if msg.type == "error" and ("script-src" in msg.text or "style-src" in msg.text):
            csp_errors.append(msg.text)

    page.on("console", handle_console_msg)
    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)

    # Trigger all page sections so dynamic rendering runs
    for nav in ["accounts", "income", "liabilities", "savings", "strategy", "reports"]:
        page.click(f'button[data-page="{nav}"]')
        page.wait_for_timeout(300)

    assert len(csp_errors) == 0, f"CSP violations detected: {csp_errors}"


@pytest.mark.security
def test_css_load_no_csp_violation(app_page):
    """Verify both external stylesheets load without CSP violations."""
    page = app_page

    stylesheets = page.evaluate("""
        () => Array.from(document.styleSheets).map(s => s.href || 'inline')
    """)

    assert len(stylesheets) > 0, "No stylesheets loaded"
    assert any('styles.css' in str(s) for s in stylesheets), "styles.css not loaded"
    assert any('styles-csp-classes.css' in str(s) for s in stylesheets), \
        "styles-csp-classes.css not loaded — CSP utility classes will be missing"


@pytest.mark.security
def test_no_inline_styles_in_html(app_page):
    """Verify no regular CSS properties are set via inline style attributes.

    CSS custom properties (--var-name) set by CSSOM setProperty() are CSP-safe and
    expected. Regular properties (e.g. display:none, width:50%) in a style attribute
    indicate an HTML-source inline style that would be blocked by style-src 'self'.
    """
    page = app_page

    # Navigate all sections so JS renders dynamic content (debt cards, savings bars, etc.)
    for nav in ["accounts", "income", "liabilities", "savings", "strategy", "reports"]:
        page.click(f'button[data-page="{nav}"]')
        page.wait_for_timeout(200)

    violations = page.evaluate("""
        () => {
            // Exclude <canvas> — Chart.js sets display/box-sizing/dimensions on its own
            // canvas elements via CSSOM. That is CSP-safe and outside our control.
            const elements = document.querySelectorAll('[style]:not(canvas)');
            const bad = [];
            for (const el of elements) {
                const decls = el.getAttribute('style')
                    .split(';')
                    .map(s => s.trim())
                    .filter(s => s.length > 0);
                for (const decl of decls) {
                    if (!decl.startsWith('--')) {
                        bad.push({
                            tag: el.tagName,
                            cls: el.className,
                            decl,
                        });
                    }
                }
            }
            return bad;
        }
    """)

    assert len(violations) == 0, (
        f"Found {len(violations)} non-custom-property inline style declaration(s) — "
        f"these would be blocked by style-src 'self': {violations}"
    )


@pytest.mark.security
def test_modal_display_uses_classes_not_styles(app_page):
    """Verify modals use CSS classes, not inline styles."""
    page = app_page
    
    # Open debt form panel
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)
    page.click('#debtFormToggle')
    page.wait_for_timeout(300)

    panel = page.query_selector('#debtFormBody')
    assert panel is not None, "Debt form panel not found"

    # Check that panel uses classes/hidden attr, not style attribute
    style_attr = panel.evaluate('(el) => el.getAttribute("style")')

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
    assert "style-src 'self'" in csp_content, "CSP missing strict style-src"
    assert "unsafe-inline" not in csp_content, "CSP contains unsafe-inline"
