#!/usr/bin/env python3
"""Test mobile menu functionality."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    
    print("Testing Mobile Menu Functionality\n")
    print("=" * 50)
    
    # Load at desktop size first
    page.set_viewport_size({"width": 1024, "height": 768})
    page.goto('http://localhost:5600/', timeout=10000)
    page.wait_for_timeout(500)
    
    # Check desktop menu state
    print("✓ Desktop (1024px):")
    nav_toggle = page.query_selector('#navToggle')
    nav_menu = page.query_selector('#navMenu')
    page_buttons = page.query_selector_all('.page-button')
    
    nav_toggle_visible = page.evaluate('() => window.getComputedStyle(document.getElementById("navToggle")).display !== "none"')
    print(f"  - Nav toggle visible: {nav_toggle_visible} (should be false)")
    print(f"  - Page buttons found: {len(page_buttons)}")
    
    # Set to tablet size
    print("\n✓ Tablet (768px):")
    page.set_viewport_size({"width": 768, "height": 1024})
    page.wait_for_timeout(500)
    
    nav_toggle_visible = page.evaluate('() => window.getComputedStyle(document.getElementById("navToggle")).display !== "none"')
    print(f"  - Nav toggle visible: {nav_toggle_visible} (should be true)")
    
    # Check if menu is closed initially
    menu_open = page.evaluate('() => document.getElementById("topNav").classList.contains("menu-open")')
    print(f"  - Menu open initially: {menu_open} (should be false)")
    
    # Click the toggle button
    print("\n✓ Testing menu toggle:")
    page.click('#navToggle')
    page.wait_for_timeout(300)
    
    menu_open = page.evaluate('() => document.getElementById("topNav").classList.contains("menu-open")')
    aria_expanded = page.evaluate('() => document.getElementById("navToggle").getAttribute("aria-expanded")')
    nav_menu_display = page.evaluate('() => window.getComputedStyle(document.getElementById("navMenu")).display')
    
    print(f"  - Menu open after click: {menu_open} (should be true)")
    print(f"  - aria-expanded: {aria_expanded} (should be 'true')")
    print(f"  - nav-menu display: {nav_menu_display} (should be flex)")
    
    # Test closing by clicking a page button
    print("\n✓ Testing menu close on page button click:")
    page.click('[data-page="income"]')
    page.wait_for_timeout(300)
    
    menu_open = page.evaluate('() => document.getElementById("topNav").classList.contains("menu-open")')
    aria_expanded = page.evaluate('() => document.getElementById("navToggle").getAttribute("aria-expanded")')
    
    print(f"  - Menu open after page click: {menu_open} (should be false)")
    print(f"  - aria-expanded: {aria_expanded} (should be 'false')")
    
    # Test mobile size
    print("\n✓ Mobile (480px):")
    page.set_viewport_size({"width": 480, "height": 800})
    page.wait_for_timeout(500)
    
    nav_toggle_visible = page.evaluate('() => window.getComputedStyle(document.getElementById("navToggle")).display !== "none"')
    nav_toggle_size = page.evaluate('() => {const el = document.getElementById("navToggle"); return {width: el.offsetWidth, height: el.offsetHeight}}')
    
    print(f"  - Nav toggle visible: {nav_toggle_visible} (should be true)")
    print(f"  - Nav toggle size: {nav_toggle_size}px (should be 44x44)")
    
    # Test all page buttons are accessible
    print("\n✓ Testing page buttons accessibility on mobile:")
    page.click('#navToggle')
    page.wait_for_timeout(300)
    
    buttons = page.query_selector_all('.page-button')
    print(f"  - Total page buttons: {len(buttons)}")
    
    for i, btn in enumerate(buttons):
        text = page.evaluate(f'(i) => document.querySelectorAll(".page-button")[i].textContent', i)
        is_visible = page.evaluate(f'(i) => document.querySelectorAll(".page-button")[i].offsetHeight > 0', i)
        min_height = page.evaluate(f'(i) => document.querySelectorAll(".page-button")[i].offsetHeight', i)
        print(f"  - Button {i+1}: {text.strip()} (visible: {is_visible}, height: {min_height}px)")
    
    # Check for console errors
    errors = []
    page.on('console', lambda msg: errors.append(f"[{msg.type}] {msg.text}") if msg.type == 'error' else None)
    page.wait_for_timeout(500)
    
    if errors:
        print(f"\n✗ Console errors found: {errors}")
    else:
        print(f"\n✓ No console errors")
    
    print("\n" + "=" * 50)
    print("Mobile menu testing complete!")
    
    browser.close()
