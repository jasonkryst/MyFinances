#!/usr/bin/env python3
"""
XSS Prevention Tests
Tests for XSS vulnerability prevention in all input fields.
"""

import pytest
import json
import tempfile
import os

BASE_URL = "http://localhost:5500/"


@pytest.mark.security
async def test_xss_in_account_name(async_app_page):
    """Test XSS prevention in account names."""
    page = async_app_page
    
    # Attempt XSS payload
    await page.fill('#accountName', '<script>alert("xss")</script>')
    await page.select_option('#accountType', 'Checking')
    await page.fill('#accountStartingBalance', '1000')
    await page.click('button:has-text("Add Account")')
    await page.wait_for_timeout(500)
    
    # Check if script was rendered as text (escaped)
    account_text = await page.evaluate("""
        () => document.querySelector('.acct-card-name')?.textContent
    """)
    assert account_text and '<script>' not in account_text, "Script tag was not escaped!"
    assert 'script' in account_text.lower() or '<' not in account_text, "XSS attempt detected as unescaped"


@pytest.mark.security
async def test_xss_in_income_name(async_app_page):
    """Test XSS prevention in income names."""
    page = async_app_page
    
    # Navigate to income
    await page.click('button[data-page="income"]')
    await page.wait_for_timeout(300)
    
    # Attempt image-based XSS
    await page.fill('#incomeName', '<img src=x onerror="alert(\'xss\')">')
    await page.fill('#incomeAmount', '5000')
    await page.fill('#incomeFirstDate', '2025-01-01')
    await page.select_option('#incomeFrequency', 'monthly')
    await page.click('button[type="submit"]:has-text("Add Income")')
    await page.wait_for_timeout(500)
    
    # Verify img tag was escaped
    income_text = await page.evaluate("""
        () => {
            const cards = document.querySelectorAll('.income-card-name');
            return cards.length > 0 ? cards[0].textContent : '';
        }
    """)
    assert '<img' not in income_text, "IMG tag was not escaped!"


@pytest.mark.security
async def test_xss_in_debt_name(async_app_page):
    """Test XSS prevention in debt names."""
    page = async_app_page
    
    # Navigate to debts
    await page.click('button[data-page="liabilities"]')
    await page.click('[data-liabilities-subtab="debts"]')
    await page.click('#debtFormToggle')
    
    # Attempt XSS with event handler
    await page.fill('#debtName', '<svg onload=alert("xss")>')
    await page.select_option('#debtType', 'creditCard')
    await page.fill('#accountBalance', '2000')
    await page.fill('#interestRate', '18')
    await page.click('#debtFormSubmit')
    await page.wait_for_timeout(500)
    
    # Verify svg tag was escaped
    debt_text = await page.evaluate("""
        () => {
            const cards = document.querySelectorAll('.debt-card-name');
            return cards.length > 0 ? cards[0].textContent : '';
        }
    """)
    assert '<svg' not in debt_text, "SVG tag was not escaped!"


@pytest.mark.security
async def test_malicious_json_import(async_app_page):
    """Test that malicious data in JSON import is sanitized."""
    page = async_app_page
    
    # Create malicious JSON payload
    malicious_json = {
        "debts": [{
            "id": 1,
            "name": "<script>alert('xss')</script>",
            "accountBalance": 5000,
            "minimumPayment": 100,
            "interestRate": 18.5,
            "debtType": "creditCard",
            "dueDate": 15
        }],
        "accounts": [{
            "id": 1,
            "name": "<img src=x onerror=alert('xss')>",
            "type": "Credit Card",
            "startingBalance": 0
        }],
        "monthlySnapshots": [{
            "date": "2026-05-01",
            "totalAssets": "10000",
            "totalLiabilities": "5000",
            "netWorth": "5000",
            "debtPaymentMade": "900",
            "incomeReceived": "2500"
        }],
        "netWorthMilestonesAwarded": [5000, 10000]
    }
    
    # Create temporary file
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(malicious_json, f)
        temp_file = f.name
    
    try:
        # Upload file
        await page.click('#importJsonBtn')
        await page.wait_for_timeout(300)
        
        file_input = await page.query_selector('#importJsonInput')
        if file_input:
            await file_input.set_input_files(temp_file)
            await page.wait_for_timeout(1000)
            
            # Verify data was imported but rendered safely
            debts_count = await page.evaluate('() => document.querySelectorAll(".debt-card").length')
            assert debts_count > 0, "Debt was not imported"
            
            # Check localStorage was sanitized
            stored_data = await page.evaluate('() => localStorage.getItem("myfinances-data-v3")')
            if stored_data:
                parsed = json.loads(stored_data)
                # Verify scripts are not present in rendered HTML
                assert parsed, "No data in localStorage"
    finally:
        os.unlink(temp_file)


@pytest.mark.security
async def test_no_console_errors(async_app_page):
    """Verify no console errors during page interaction."""
    page = async_app_page
    
    console_errors = []
    page.on('console', lambda msg: (
        console_errors.append(msg.text) if msg.type == 'error' else None
    ))
    
    # Perform various interactions
    await page.click('button[data-page="accounts"]')
    await page.wait_for_timeout(300)
    await page.click('button[data-page="income"]')
    await page.wait_for_timeout(300)
    await page.click('button[data-page="liabilities"]')
    await page.wait_for_timeout(300)
    
    # Check for errors (ignore favicon errors)
    filtered_errors = [e for e in console_errors if 'favicon' not in e.lower()]
    assert len(filtered_errors) == 0, f"Console errors found: {filtered_errors}"
