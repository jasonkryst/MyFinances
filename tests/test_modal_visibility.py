#!/usr/bin/env python3
"""Test that modals are properly hidden when the page loads."""

from playwright.sync_api import sync_playwright
import time

def test_modal_visibility():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto('http://localhost:5500', wait_until='networkidle')
        
        # Wait a moment for page to fully load
        time.sleep(1)
        
        # Get the computed display style for each modal
        update_modal_display = page.evaluate('''
            () => window.getComputedStyle(document.getElementById('updateBalanceModal')).display
        ''')
        
        ledger_modal_display = page.evaluate('''
            () => window.getComputedStyle(document.getElementById('ledgerOverrideModal')).display
        ''')
        
        print(f"Update Balance Modal display: {update_modal_display}")
        print(f"Ledger Override Modal display: {ledger_modal_display}")
        
        # Check the HTML classes
        update_modal_classes = page.evaluate('''
            () => document.getElementById('updateBalanceModal').className
        ''')
        
        ledger_modal_classes = page.evaluate('''
            () => document.getElementById('ledgerOverrideModal').className
        ''')
        
        print(f"Update Balance Modal classes: {update_modal_classes}")
        print(f"Ledger Override Modal classes: {ledger_modal_classes}")
        
        # Verify both are hidden
        if update_modal_display == 'none' and ledger_modal_display == 'none':
            print("✓ PASS: Both modals are properly hidden")
        else:
            print("✗ FAIL: Modals are not properly hidden")
            if update_modal_display != 'none':
                print(f"  - Update modal is showing with display: {update_modal_display}")
            if ledger_modal_display != 'none':
                print(f"  - Ledger modal is showing with display: {ledger_modal_display}")
        
        browser.close()

if __name__ == '__main__':
    test_modal_visibility()
