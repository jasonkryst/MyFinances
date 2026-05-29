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
        page.wait_for_timeout(1500)
        
        # Check if savingsSection exists
        savings_section = page.query_selector('#savingsSection')
        if savings_section:
            content = page.text_content('#savingsSection')
            print(f'Savings section content length: {len(content) if content else 0}')
            if content and 'Emergency Fund' in content:
                print('✓ Emergency Fund text found')
            if content and 'Sinking Funds' in content:
                print('✓ Sinking Funds text found')
        else:
            print('✗ Savings section not found')
            
        # Check console for errors
        errors = []
        def log_msg(msg):
            if msg.type in ['error', 'warning']:
                errors.append(f'{msg.type}: {msg.text}')
        page.on('console', log_msg)
        page.wait_for_timeout(500)
        
        if errors:
            print(f'Console: {errors[:3]}')
        else:
            print('✓ No console errors')
        
        browser.close()
        print('✓ Test completed!')

if __name__ == '__main__':
    test_savings_tab()
