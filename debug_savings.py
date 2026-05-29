#!/usr/bin/env python3
"""Debug Savings tab rendering."""
from playwright.sync_api import sync_playwright
import json

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto('http://localhost:5600/')
    
    # Collect all console messages
    console_messages = []
    page.on('console', lambda msg: console_messages.append({
        'type': msg.type,
        'text': msg.text,
        'location': msg.location
    }))
    
    # Wait and click
    page.wait_for_selector('button[data-page="savings"]', timeout=5000)
    print("✓ Found Savings button")
    
    # Check if app object exists
    app_exists = page.evaluate('() => typeof window.app !== "undefined"')
    print(f"App object exists: {app_exists}")
    
    # Check what app has
    if app_exists:
        methods = page.evaluate('''() => {
            const app = window.app;
            return {
                hasRenderSavingsPage: typeof app.renderSavingsPage === 'function',
                hasSavingsSubTab: 'savingsSubTab' in app,
                emergencyFundsCount: (app.emergencyFunds || []).length,
                sinkingFundsCount: (app.sinkingFunds || []).length
            }
        }''')
        print(f"App state: {json.dumps(methods, indent=2)}")
    
    # Try to call render manually
    page.click('button[data-page="savings"]')
    page.wait_for_timeout(1000)
    
    # Check section content
    content = page.text_content('#savingsSection')
    print(f"Section content length: {len(content) if content else 0}")
    print(f"Section innerHTML length: {len(page.locator('#savingsSection').inner_html())}")
    
    # Print console messages
    print(f"\nConsole messages ({len(console_messages)}):")
    for msg in console_messages[-10:]:
        print(f"  [{msg['type']}] {msg['text'][:100]}")
    
    browser.close()
