#!/usr/bin/env python3
"""Test CSP compliance - verify no inline style violations in console"""

from playwright.sync_api import sync_playwright
import time
import sys

def test_csp_compliance():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        csp_errors = []
        declaration_errors = []
        
        def handle_console_msg(msg):
            if "style-src" in msg.text and "CSP" in msg.text:
                csp_errors.append(msg.text)
            if "Identifier" in msg.text and "already been declared" in msg.text:
                declaration_errors.append(msg.text)
        
        page.on("console", handle_console_msg)
        page.on("pageerror", lambda e: declaration_errors.append(str(e)))
        
        # Navigate to app
        page.goto("http://localhost:5500/index.html", wait_until="networkidle")
        time.sleep(2)
        
        # Trigger various interactions that use display toggles
        # Click to different tabs/pages
        accounts_btn = page.query_selector('[data-page="accounts"]')
        if accounts_btn:
            accounts_btn.click()
            time.sleep(0.5)
        
        income_btn = page.query_selector('[data-page="income"]')
        if income_btn:
            income_btn.click()
            time.sleep(0.5)
        
        liabilities_btn = page.query_selector('[data-page="liabilities"]')
        if liabilities_btn:
            liabilities_btn.click()
            time.sleep(0.5)
        
        # Try to trigger form toggles if available
        debt_form_toggle = page.query_selector('[id*="debtForm"]')
        if debt_form_toggle:
            # Look for a button that toggles forms
            buttons = page.query_selector_all('button')
            for btn in buttons[:5]:  # Try first 5 buttons
                if btn.is_visible():
                    try:
                        btn.click()
                        time.sleep(0.3)
                    except:
                        pass
        
        time.sleep(1)
        
        # Check for CSP errors
        print(f"\nCSP Compliance Test Results:")
        print(f"=" * 50)
        print(f"CSP inline style violations found: {len(csp_errors)}")
        print(f"Declaration errors: {len(declaration_errors)}")
        
        if csp_errors:
            print(f"\nCSP Violations (first 5):")
            for err in csp_errors[:5]:
                print(f"  - {err[:100]}...")
        
        if declaration_errors:
            print(f"\nDeclaration Errors:")
            for err in declaration_errors:
                print(f"  - {err}")
        
        browser.close()
        
        # Return success if no CSP or declaration errors
        success = len(csp_errors) == 0 and len(declaration_errors) == 0
        print(f"\n{'✓ PASSED' if success else '✗ FAILED'}: CSP Compliance")
        return success

if __name__ == "__main__":
    try:
        success = test_csp_compliance()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"Test error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
