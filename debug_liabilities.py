#!/usr/bin/env python3
"""Debug liabilities page functionality."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    
    # Capture all errors
    errors = []
    def on_console(msg):
        if msg.type in ['error', 'warning']:
            errors.append(f"[{msg.type}] {msg.text}")
    
    page.on('console', on_console)
    page.on('pageerror', lambda exc: print(f"[PAGE ERROR] {exc}"))
    
    print("Loading page...")
    page.goto('http://localhost:5600/', timeout=10000)
    page.wait_for_timeout(500)
    
    print("✓ Page loaded")
    
    # Check if window.app exists
    has_app = page.evaluate('() => !!window.app')
    print(f"✓ window.app exists: {has_app}")
    
    # Check if liabilities button exists
    liab_btn = page.query_selector('button[data-page="liabilities"]')
    print(f"✓ Liabilities button found: {liab_btn is not None}")
    
    # Click liabilities button
    print("\nClicking Liabilities button...")
    page.click('button[data-page="liabilities"]')
    page.wait_for_timeout(500)
    
    # Check if liabilities section is visible
    liab_section = page.query_selector('#liabilitiesSection')
    print(f"✓ Liabilities section found: {liab_section is not None}")
    
    # Check if debts panel is visible
    debts_panel = page.query_selector('#debtsPanel')
    print(f"✓ Debts panel found: {debts_panel is not None}")
    if debts_panel:
        display = page.evaluate('() => window.getComputedStyle(document.getElementById("debtsPanel")).display')
        print(f"  - Debts panel display: {display}")
    
    # Check if expenses panel exists
    expenses_panel = page.query_selector('#expensesPanel')
    print(f"✓ Expenses panel found: {expenses_panel is not None}")
    if expenses_panel:
        display = page.evaluate('() => window.getComputedStyle(document.getElementById("expensesPanel")).display')
        print(f"  - Expenses panel display: {display}")
    
    # Check liabilities subtab buttons
    subtab_btns = page.query_selector_all('[data-liabilities-subtab]')
    print(f"\n✓ Found {len(subtab_btns)} liabilities subtab buttons")
    for i, btn in enumerate(subtab_btns):
        text = page.evaluate(f'(i) => document.querySelectorAll("[data-liabilities-subtab]")[i].textContent', i)
        active = page.evaluate(f'(i) => document.querySelectorAll("[data-liabilities-subtab]")[i].classList.contains("active")', i)
        print(f"  - Button {i}: active={active}")
    
    # Check if debt form toggle is visible
    debt_form_toggle = page.query_selector('#debtFormToggle')
    print(f"\n✓ Debt form toggle found: {debt_form_toggle is not None}")
    if debt_form_toggle:
        display = page.evaluate('() => window.getComputedStyle(document.getElementById("debtFormToggle")).display')
        print(f"  - Display: {display}")
    
    # Check if debt form is hidden
    debt_form_body = page.query_selector('#debtFormBody')
    print(f"✓ Debt form body found: {debt_form_body is not None}")
    if debt_form_body:
        hidden = page.evaluate('() => document.getElementById("debtFormBody").hidden')
        print(f"  - Hidden: {hidden}")
    
    # Check switchLiabilitiesSubTab method exists
    has_method = page.evaluate('() => !!window.app.switchLiabilitiesSubTab')
    print(f"\n✓ switchLiabilitiesSubTab method exists: {has_method}")
    
    # Test switching tabs
    print("\nTesting tab switching...")
    page.evaluate('() => window.app.switchLiabilitiesSubTab("expenses")')
    page.wait_for_timeout(300)
    
    expenses_display = page.evaluate('() => window.getComputedStyle(document.getElementById("expensesPanel")).display')
    debts_display = page.evaluate('() => window.getComputedStyle(document.getElementById("debtsPanel")).display')
    print(f"✓ After switching to expenses:")
    print(f"  - Debts panel: {debts_display}")
    print(f"  - Expenses panel: {expenses_display}")
    
    # Switch back to debts
    page.evaluate('() => window.app.switchLiabilitiesSubTab("debts")')
    page.wait_for_timeout(300)
    
    expenses_display = page.evaluate('() => window.getComputedStyle(document.getElementById("expensesPanel")).display')
    debts_display = page.evaluate('() => window.getComputedStyle(document.getElementById("debtsPanel")).display')
    print(f"✓ After switching back to debts:")
    print(f"  - Debts panel: {debts_display}")
    print(f"  - Expenses panel: {expenses_display}")
    
    # Check for errors
    if errors:
        print(f"\n✗ Found {len(errors)} errors:")
        for err in errors:
            print(f"  - {err}")
    else:
        print("\n✓ No console errors found")
    
    browser.close()
