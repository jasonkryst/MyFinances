#!/usr/bin/env python3
"""Debug parent element visibility chain."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    
    print("Loading page...")
    page.goto('http://localhost:5600/', timeout=10000)
    page.wait_for_timeout(500)
    
    # Click on income page
    print("Clicking income button...")
    page.click('button[data-page="income"]')
    page.wait_for_timeout(500)
    
    # Check parent chain
    print("\nChecking parent element chain for #incomeName:")
    info = page.evaluate('''() => {
        const el = document.getElementById("incomeName");
        if (!el) return "element not found";
        
        let current = el;
        let depth = 0;
        let chain = [];
        
        while (current && depth < 10) {
            const style = window.getComputedStyle(current);
            chain.push({
                tag: current.tagName,
                id: current.id || 'none',
                class: current.className || 'none',
                display: style.display,
                visibility: style.visibility,
                position: style.position,
                offsetParent: current.offsetParent !== null ? 'yes' : 'null'
            });
            current = current.parentElement;
            depth++;
        }
        
        return chain;
    }''')
    
    for i, elem in enumerate(info):
        print(f"  Level {i}: {elem['tag']}#{elem['id']}.{elem['class']} - display:{elem['display']}, vis:{elem['visibility']}, pos:{elem['position']}, offsetParent:{elem['offsetParent']}")
    
    # Try clicking the element
    print("\nAttempting to click income name input...")
    try:
        page.click('#incomeName', timeout=1000)
        print("✓ Successfully clicked")
    except Exception as e:
        print(f"✗ Failed: {e}")
    
    # Try typing with force
    print("\nAttempting to fill with force=True...")
    try:
        page.fill('#incomeName', 'Test', force=True, timeout=1000)
        print("✓ Successfully filled")
    except Exception as e:
        print(f"✗ Failed: {e}")
    
    # Check if we can use locator instead
    print("\nAttempting with locator...")
    try:
        locator = page.locator('#incomeName')
        locator.fill('Test', timeout=1000)
        print("✓ Successfully filled via locator")
    except Exception as e:
        print(f"✗ Failed: {e}")
    
    browser.close()
