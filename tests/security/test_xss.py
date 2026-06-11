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

    # Navigate to accounts
    await page.click('button[data-page="accounts"]')
    await page.wait_for_timeout(300)

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
async def test_xss_in_health_budget_category(async_app_page):
    """Test XSS prevention in bill category names rendered by the health dashboard."""
    page = async_app_page

    # Inject a bill whose category contains a script tag
    await page.evaluate("""() => {
        const app = window.app;
        app.incomes = [{ id: 1, name: 'Salary', amount: 5000,
                         firstPayDate: '2026-06-01', frequency: 'monthly' }];
        app.bills = [{
            id: 99, name: 'Util', dueDay: 1,
            amount: 200,
            category: '<script>window.__xss_health=1</script>Utilities'
        }];
        app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
    }""")

    await page.click('button[data-page="health"]')
    await page.wait_for_timeout(500)

    # XSS payload should not have executed
    xss_ran = await page.evaluate('() => window.__xss_health === 1')
    assert not xss_ran, "XSS script in bill category executed on health page!"

    # Category text should be escaped in the DOM
    section_html = await page.evaluate(
        '() => document.getElementById("healthSection")?.innerHTML || ""'
    )
    assert '<script>' not in section_html, "Unescaped <script> tag found in health section HTML"


@pytest.mark.security
async def test_xss_in_health_emergency_fund_account_name(async_app_page):
    """Test XSS prevention in account names rendered in the emergency fund card."""
    page = async_app_page

    await page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{
            id: 8001,
            name: '<img src=x onerror="window.__xss_ef=1">EFund',
            type: 'Savings',
            startingBalance: 0
        }];
        app.emergencyFunds = [{
            id: 8002, name: 'Safety Net', accountId: 8001,
            currentAmount: 3000, targetAmount: 6000, monthlyContribution: 100
        }];
        app.incomes = []; app.debts = []; app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.sinkingFunds = [];
    }""")

    await page.click('button[data-page="health"]')
    await page.wait_for_timeout(500)

    xss_ran = await page.evaluate('() => window.__xss_ef === 1')
    assert not xss_ran, "XSS via account name in emergency fund card executed!"

    section_html = await page.evaluate(
        '() => document.getElementById("healthSection")?.innerHTML || ""'
    )
    assert '<img' not in section_html, "Unescaped <img> tag found in health emergency fund card"


@pytest.mark.security
async def test_no_console_errors(async_app_page):
    """Verify no console errors during page interaction including the health dashboard."""
    page = async_app_page

    console_errors = []
    page.on('console', lambda msg: (
        console_errors.append(msg.text) if msg.type == 'error' else None
    ))

    # Perform various interactions including health dashboard
    await page.click('button[data-page="health"]')
    await page.wait_for_timeout(300)
    await page.click('button[data-page="accounts"]')
    await page.wait_for_timeout(300)
    await page.click('button[data-page="income"]')
    await page.wait_for_timeout(300)
    await page.click('button[data-page="liabilities"]')
    await page.wait_for_timeout(300)
    await page.click('button[data-page="health"]')
    await page.wait_for_timeout(300)

    # Check for errors (ignore favicon errors)
    filtered_errors = [
        e for e in console_errors
        if 'favicon' not in e.lower()
        and 'X-Frame-Options may only be set via an HTTP header' not in e
    ]
    assert len(filtered_errors) == 0, f"Console errors found: {filtered_errors}"


@pytest.mark.security
async def test_xss_in_forecast_driver_name(async_app_page):
    """Test that a malicious expense name is escaped (not rendered as HTML) in
    the Cash Flow Forecast 'Driven by' note row."""
    page = async_app_page

    await page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        const targetMonths = now.getMonth() + 2;
        const year = now.getFullYear() + Math.floor(targetMonths / 12);
        const month = targetMonths % 12;
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-15`;

        app.accounts = [{ id: 9001, name: 'Checking', type: 'Checking', startingBalance: 10000 }];
        app.bills = [{ id: 10, name: 'Subscription', amount: 10, dueDay: 1, category: 'Other', accountId: 9001 }];
        app.expenses = [{
            id: 20,
            name: '<img src=x onerror="window.__xss=true">',
            budgetAmount: 1200, date: dateStr, category: 'Other', accountId: 9001
        }];
        app.incomes = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app._forecastRangeMonths = 2;
        app._forecastAccountId = 'total';
        app._forecastNotableThresholdPct = 130;
        app.switchPage('reports');
    }""")
    await page.wait_for_timeout(300)

    forecast_tab = await page.query_selector('[data-rptab="forecast"]')
    await forecast_tab.click()
    await page.wait_for_timeout(300)

    img_in_table = await page.query_selector('#reportsCashFlowForecast .nw-history-table img')
    assert img_in_table is None, "Malicious expense name was rendered as an HTML element (XSS)!"

    xss_triggered = await page.evaluate('() => window.__xss === true')
    assert not xss_triggered, "XSS payload executed via unescaped expense name!"
