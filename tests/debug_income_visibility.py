#!/usr/bin/env python3
"""Debug income page form visibility."""
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
    
    # Check income section visibility
    income_section = page.query_selector('#incomeSection')
    print(f"Income section exists: {income_section is not None}")
    if income_section:
        is_active = page.evaluate('() => document.getElementById("incomeSection").classList.contains("active")')
        print(f"Income section is active: {is_active}")
    
    # Check income form visibility
    income_form = page.query_selector('#incomeForm')
    print(f"Income form exists: {income_form is not None}")
    if income_form:
        display = page.evaluate('() => window.getComputedStyle(document.getElementById("incomeForm")).display')
        visibility = page.evaluate('() => window.getComputedStyle(document.getElementById("incomeForm")).visibility')
        print(f"Income form display: {display}")
        print(f"Income form visibility: {visibility}")
    
    # Check income name input
    income_name = page.query_selector('#incomeName')
    print(f"Income name input exists: {income_name is not None}")
    if income_name:
        display = page.evaluate('() => window.getComputedStyle(document.getElementById("incomeName")).display')
        visibility = page.evaluate('() => window.getComputedStyle(document.getElementById("incomeName")).visibility')
        is_visible = page.evaluate('() => document.getElementById("incomeName").offsetParent !== null')
        print(f"Income name input display: {display}")
        print(f"Income name input visibility: {visibility}")
        print(f"Income name input is visible (offsetParent check): {is_visible}")
    
    # Check if page sections are properly positioned
    print("\nPage sections status:")
    for page_name in ['accounts', 'income', 'liabilities', 'savings', 'strategy', 'reports']:
        section_id = {
            'accounts': 'accountsSection',
            'income': 'incomeSection',
            'liabilities': 'liabilitiesSection',
            'savings': 'savingsSection',
            'strategy': 'strategySection',
            'reports': 'reportsSection'
        }.get(page_name)
        
        if section_id:
            is_active = page.evaluate(f'() => document.getElementById("{section_id}").classList.contains("active")')
            display = page.evaluate(f'() => window.getComputedStyle(document.getElementById("{section_id}")).display')
            print(f"  {section_id}: active={is_active}, display={display}")
    
    browser.close()
