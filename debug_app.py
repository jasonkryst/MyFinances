#!/usr/bin/env python3
"""Debug why app is not created."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    
    # Capture all errors
    errors = []
    def on_console(msg):
        print(f"[{msg.type}] {msg.text}")
        if msg.type in ['error', 'warning']:
            errors.append(msg.text)
    
    page.on('console', on_console)
    page.on('pageerror', lambda exc: print(f"[PAGE ERROR] {exc}"))
    
    print("Loading page...")
    try:
        page.goto('http://localhost:5600/', timeout=10000)
    except Exception as e:
        print(f"Navigation error: {e}")
    
    # Wait for DOMContentLoaded
    page.wait_for_timeout(2000)
    
    print("\nChecking if module loaded...")
    result = page.evaluate('() => typeof window.app')
    print(f"typeof window.app: {result}")
    
    print("\nChecking if scripts loaded...")
    scripts = page.locator('script').count()
    print(f"Number of script tags: {scripts}")
    
    print(f"\nTotal errors captured: {len(errors)}")
    for err in errors[:5]:
        print(f"  - {err}")
    
    browser.close()
