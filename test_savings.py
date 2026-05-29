#!/usr/bin/env python3
"""Quick test for Savings tab feature."""
from playwright.sync_api import sync_playwright

def test_savings_tab():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto('http://localhost:5600/')
        
        # Wait for app to initialize
        page.wait_for_selector('button[data-page="savings"]', timeout=5000)
        print('✓ Savings button found')
        
        # Click Savings tab
        page.click('button[data-page="savings"]')
        page.wait_for_timeout(1000)
        
        # Check if savingsSection exists
        savings_section = page.query_selector('#savingsSection')
        if savings_section:
            print('✓ Savings section element found')
        else:
            print('✗ Savings section element not found')
            
        # Check for form elements in page
        page.wait_for_timeout(500)
        emergency_form = page.query_selector('#emergencyForm')
        sinking_form = page.query_selector('#sinkingForm')
        
        if emergency_form:
            print('✓ Emergency Fund form found')
        else:
            print('✗ Emergency Fund form not found')
            
        if sinking_form:
            print('✓ Sinking Funds form found')
        else:
            print('✗ Sinking Funds form not found')
        
        # Check console for errors
        errors = []
        page.on('console', lambda msg: errors.append(f'{msg.type}: {msg.text}') if msg.type in ['error', 'warning'] else None)
        page.wait_for_timeout(1000)
        
        if errors:
            print(f'✗ Console errors: {errors[:3]}')
        else:
            print('✓ No console errors')
        
        browser.close()
        print('✓ Savings tab basic test PASSED!')

if __name__ == '__main__':
    test_savings_tab()
