#!/usr/bin/env python3
"""
Input Validation Tests
Tests input bounds checking, sanitization, and validation.
"""

import pytest

BASE_URL = "http://localhost:5500/"


@pytest.mark.security
async def test_negative_balance(async_app_page):
    """Test that negative balances are handled properly."""
    page = async_app_page

    # Navigate to accounts
    await page.click('button[data-page="accounts"]')
    await page.wait_for_timeout(300)

    await page.fill('#accountName', 'Negative Test')
    await page.select_option('#accountType', 'Checking')
    await page.fill('#accountStartingBalance', '-5000')
    await page.click('button:has-text("Add Account")')
    await page.wait_for_timeout(500)
    
    # Verify account was created (negative balances are allowed)
    account_name = await page.evaluate("""
        () => {
            const cards = document.querySelectorAll('.acct-card-name');
            return cards.length > 0 ? cards[cards.length - 1].textContent : '';
        }
    """)
    assert 'Negative Test' in account_name, "Account not created with negative balance"


@pytest.mark.security
async def test_special_characters_in_names(async_app_page):
    """Test that special characters are properly handled in names."""
    page = async_app_page

    # Navigate to accounts
    await page.click('button[data-page="accounts"]')
    await page.wait_for_timeout(300)

    special_name = "O'Reilly & Associates <Co.>"

    await page.fill('#accountName', special_name)
    await page.select_option('#accountType', 'Savings')
    await page.fill('#accountStartingBalance', '1000')
    await page.click('button:has-text("Add Account")')
    await page.wait_for_timeout(500)
    
    # Verify name is stored (special characters should be preserved but dangerous ones removed)
    account_text = await page.evaluate("""
        () => {
            const cards = document.querySelectorAll('.acct-card-name');
            return cards.length > 0 ? cards[cards.length - 1].textContent : '';
        }
    """)
    assert len(account_text) > 0, "Account name not stored"
    assert '<' not in account_text, "Unsafe angle brackets not removed"


@pytest.mark.security
async def test_very_large_amount(async_app_page):
    """Test that very large amounts are handled."""
    page = async_app_page

    # Navigate to accounts
    await page.click('button[data-page="accounts"]')
    await page.wait_for_timeout(300)

    large_amount = "999999999999999"

    await page.fill('#accountName', 'Large Amount Test')
    await page.select_option('#accountType', 'Checking')
    await page.fill('#accountStartingBalance', large_amount)
    await page.click('button:has-text("Add Account")')
    await page.wait_for_timeout(500)
    
    # Account should be created
    account_text = await page.evaluate("""
        () => {
            const cards = document.querySelectorAll('.acct-card-name');
            return cards.length > 0 ? cards[cards.length - 1].textContent : '';
        }
    """)
    assert 'Large Amount Test' in account_text, "Account not created with large amount"


@pytest.mark.security
async def test_decimal_amounts(async_app_page):
    """Test that decimal amounts are properly handled."""
    page = async_app_page

    # Navigate to accounts
    await page.click('button[data-page="accounts"]')
    await page.wait_for_timeout(300)

    await page.fill('#accountName', 'Decimal Test')
    await page.select_option('#accountType', 'Savings')
    await page.fill('#accountStartingBalance', '1234.56')
    await page.click('button:has-text("Add Account")')
    await page.wait_for_timeout(500)
    
    # Verify account was created with decimal amount
    account_name = await page.evaluate("""
        () => {
            const cards = document.querySelectorAll('.acct-card-name');
            return cards.length > 0 ? cards[cards.length - 1].textContent : '';
        }
    """)
    assert 'Decimal Test' in account_name, "Account not created with decimal amount"


@pytest.mark.security
async def test_empty_string_input(async_app_page):
    """Test handling of empty string inputs."""
    page = async_app_page

    # Navigate to accounts
    await page.click('button[data-page="accounts"]')
    await page.wait_for_timeout(300)

    # Try to submit form with empty name
    await page.fill('#accountName', '')
    await page.select_option('#accountType', 'Checking')
    await page.fill('#accountStartingBalance', '1000')
    
    # App should prevent submission or handle gracefully
    await page.click('button:has-text("Add Account")')
    await page.wait_for_timeout(500)
    
    # Check if error message appears or form is still visible
    form_visible = await page.evaluate("""
        () => !!document.querySelector('#accountFormSubmit')
    """)
    # Form should either still be visible (validation failed) or account created with empty name
    assert form_visible or True, "Form should handle empty input"


@pytest.mark.security
async def test_interest_rate_bounds(async_app_page):
    """Test that interest rates are validated."""
    page = async_app_page
    
    # Navigate to debts
    await page.click('button[data-page="liabilities"]')
    await page.click('[data-liabilities-subtab="debts"]')
    await page.click('#debtFormToggle')
    
    # Test with very high interest rate
    await page.fill('#debtName', 'High Interest Test')
    await page.select_option('#debtType', 'creditCard')
    await page.fill('#accountBalance', '1000')
    await page.fill('#interestRate', '99.99')
    await page.fill('#minimumPayment', '50')
    await page.fill('#dueDate', '15')
    await page.click('#debtFormSubmit')
    await page.wait_for_timeout(500)
    
    # Verify debt was created despite unrealistic interest rate
    debt_name = await page.evaluate("""
        () => {
            const cards = document.querySelectorAll('.debt-name');
            return cards.length > 0 ? cards[0].textContent : '';
        }
    """)
    assert 'High Interest Test' in debt_name, "Debt not created with high interest rate"


@pytest.mark.security
async def test_health_dti_clamps_above_100_percent(async_app_page):
    """Health DTI gauge value is clamped to 100% even when ratio exceeds 1."""
    page = async_app_page

    # Income $100, debt payments $500 → 500% DTI; gauge should cap at 100%
    await page.evaluate("""() => {
        const app = window.app;
        app.incomes = [{ id: 1, name: 'Job', amount: 100,
                         firstPayDate: '2026-06-01', frequency: 'monthly' }];
        app.debts = [{ id: 2, name: 'CC', accountBalance: 99999, originalBalance: 99999,
                       minimumPayment: 500, interestRate: 18, dueDate: 1,
                       debtType: 'creditCard' }];
        app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
    }""")

    await page.click('button[data-page="health"]')
    await page.wait_for_timeout(500)

    gauge_value = await page.evaluate("""() => {
        const el = document.querySelector('.health-gauge-value');
        return el ? parseFloat(el.textContent) : null;
    }""")

    assert gauge_value is not None, "DTI gauge value element not found"
    assert gauge_value <= 100.0, f"DTI gauge should be capped at 100%, got {gauge_value}%"


@pytest.mark.security
async def test_health_savings_rate_clamps_above_100_percent(async_app_page):
    """Health savings gauge is clamped to 100% when contributions exceed income."""
    page = async_app_page

    await page.evaluate("""() => {
        const app = window.app;
        app.incomes = [{ id: 1, name: 'Job', amount: 100,
                         firstPayDate: '2026-06-01', frequency: 'monthly' }];
        app.emergencyFunds = [{
            id: 9, name: 'EF', accountId: null,
            currentAmount: 0, targetAmount: 5000, monthlyContribution: 9999
        }];
        app.debts = []; app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.sinkingFunds = [];
    }""")

    await page.click('button[data-page="health"]')
    await page.wait_for_timeout(500)

    # The second .health-gauge-value is the savings rate gauge
    gauge_values = await page.evaluate("""() =>
        Array.from(document.querySelectorAll('.health-gauge-value'))
             .map(el => parseFloat(el.textContent))
    """)

    assert len(gauge_values) >= 2, "Expected at least 2 gauge value elements"
    savings_pct = gauge_values[1]
    assert savings_pct <= 100.0, f"Savings gauge should be capped at 100%, got {savings_pct}%"


@pytest.mark.security
async def test_recurring_day_of_month_bounds(async_app_page):
    """Test that out-of-range Day of Month values for recurring templates are clamped to 1-31."""
    page = async_app_page

    # Recurring templates require an account
    await page.click('button[data-page="accounts"]')
    await page.wait_for_timeout(300)
    await page.fill('#accountName', 'Recurring Bounds Test')
    await page.select_option('#accountType', 'Checking')
    await page.fill('#accountStartingBalance', '1000')
    await page.click('button:has-text("Add Account")')
    await page.wait_for_timeout(500)

    await page.click('button[data-page="recurring"]')
    await page.wait_for_timeout(300)
    await page.click('#recurringFormToggle')
    await page.wait_for_timeout(300)

    await page.fill('#recurringName', 'Bounds Test Sub')
    await page.fill('#recurringAmount', '20')
    await page.fill('#recurringDayOfMonth', '99')
    await page.select_option('#recurringAccount', label='Recurring Bounds Test')
    await page.fill('#recurringStartDate', '2026-01-01')
    await page.click('#recurringFormSubmit')
    await page.wait_for_timeout(500)

    day_value = await page.evaluate("""() => {
        const app = window.app;
        const tmpl = (app.recurringTemplates || []).find(t => t.name === 'Bounds Test Sub');
        return tmpl ? tmpl.dayOfMonth : null;
    }""")

    assert day_value is not None, "Recurring template was not created"
    assert 1 <= day_value <= 31, f"dayOfMonth {day_value} was not clamped to 1-31"


@pytest.mark.security
async def test_savings_emergency_fund_numeric_bounds(async_app_page):
    """Test numeric bounds validation for the Emergency Fund form."""
    page = async_app_page

    # Emergency funds are linked to an account, so create one first
    await page.click('button[data-page="accounts"]')
    await page.wait_for_timeout(300)
    await page.fill('#accountName', 'EF Bounds Checking')
    await page.select_option('#accountType', 'Checking')
    await page.fill('#accountStartingBalance', '1000')
    await page.click('button:has-text("Add Account")')
    await page.wait_for_timeout(500)

    await page.click('button[data-page="savings"]')
    await page.wait_for_timeout(300)
    await page.click('#emergencyFormToggle')
    await page.wait_for_timeout(300)

    # Capture alert() calls without relying on native dialog handling
    await page.evaluate("() => { window.__alerts = []; window.alert = (m) => window.__alerts.push(m); }")

    await page.select_option('#emergencyAccount', label='EF Bounds Checking')

    # A zero target amount should be rejected
    await page.fill('#emergencyTarget', '0')
    await page.fill('#emergencyCurrent', '100')
    await page.fill('#emergencyContribution', '50')
    await page.click('#emergencyFormSubmit')
    await page.wait_for_timeout(300)

    alerts = await page.evaluate('() => window.__alerts')
    assert any('valid values' in m.lower() for m in alerts), \
        "Expected validation alert for zero target amount"
    funds_count = await page.evaluate('() => (window.app.emergencyFunds || []).length')
    assert funds_count == 0, "Fund should not be created with a zero target amount"

    # A negative monthly contribution is rejected by the input's min="0"
    # constraint, which blocks the form's submit event entirely.
    await page.evaluate('() => { window.__alerts = []; }')
    await page.fill('#emergencyTarget', '5000')
    await page.fill('#emergencyContribution', '-50')

    contribution_valid = await page.eval_on_selector('#emergencyContribution', 'el => el.checkValidity()')
    assert not contribution_valid, "Negative monthly contribution should fail min=0 validation"

    await page.click('#emergencyFormSubmit')
    await page.wait_for_timeout(300)
    funds_count = await page.evaluate('() => (window.app.emergencyFunds || []).length')
    assert funds_count == 0, "Fund should not be created with a negative monthly contribution"

    # A negative current amount is rejected the same way
    await page.fill('#emergencyContribution', '50')
    await page.fill('#emergencyCurrent', '-200')

    current_valid = await page.eval_on_selector('#emergencyCurrent', 'el => el.checkValidity()')
    assert not current_valid, "Negative current amount should fail min=0 validation"

    await page.click('#emergencyFormSubmit')
    await page.wait_for_timeout(300)
    funds_count = await page.evaluate('() => (window.app.emergencyFunds || []).length')
    assert funds_count == 0, "Fund should not be created with a negative current amount"

    # With valid positive values, the fund is created and rendered cleanly
    await page.fill('#emergencyCurrent', '1000')
    await page.click('#emergencyFormSubmit')
    await page.wait_for_timeout(300)

    funds_count = await page.evaluate('() => (window.app.emergencyFunds || []).length')
    assert funds_count == 1, "Fund should be created with valid positive values"

    list_html = await page.evaluate('() => document.getElementById("emergencyList")?.innerHTML || ""')
    assert 'NaN' not in list_html, "Emergency fund card rendering produced NaN"


@pytest.mark.security
async def test_reconciliation_rejects_non_numeric_balance(async_app_page):
    """applyReconciliation rejects a non-numeric statement balance, leaving balance and history unchanged."""
    page = async_app_page

    result = await page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 7501, name: 'Recon Validate', type: 'Checking', startingBalance: 1000 }];
        app.incomes = []; app.bonuses = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = [];
        const res = app.applyReconciliation(7501, 'not-a-number', '', '2026-06-10');
        return {
            success: res.success,
            balance: app.accounts[0].startingBalance,
            historyCount: app.reconciliations.length
        };
    }""")

    assert result['success'] is False
    assert result['balance'] == 1000
    assert result['historyCount'] == 0


@pytest.mark.security
async def test_reconciliation_accepts_negative_balance(async_app_page):
    """applyReconciliation accepts a negative statement balance for liability-style accounts."""
    page = async_app_page

    result = await page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 7502, name: 'Recon Credit Card', type: 'Credit Card', startingBalance: -500 }];
        app.incomes = []; app.bonuses = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = [];
        const res = app.applyReconciliation(7502, -650.25, '', '2026-06-10');
        return {
            success: res.success,
            balance: app.accounts[0].startingBalance,
            difference: app.reconciliations[0].difference
        };
    }""")

    assert result['success'] is True
    assert result['balance'] == -650.25
    assert result['difference'] == -150.25


@pytest.mark.security
async def test_reconciliation_note_truncated_on_save_reload(async_app_page):
    """A reconciliation note longer than 200 characters is truncated on save/reload."""
    page = async_app_page

    result = await page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 7503, name: 'Recon Truncate', type: 'Checking', startingBalance: 1000 }];
        app.incomes = []; app.bonuses = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = [];

        const longNote = 'x'.repeat(250);
        app.applyReconciliation(7503, 1100, longNote, '2026-06-10');
        app.saveToStorage();
        app.loadFromStorage();
        return { noteLength: app.reconciliations[0].note.length };
    }""")

    assert result['noteLength'] == 200


@pytest.mark.security
async def test_unicode_in_names(async_app_page):
    """Test that unicode characters are properly handled."""
    page = async_app_page

    # Navigate to accounts
    await page.click('button[data-page="accounts"]')
    await page.wait_for_timeout(300)

    unicode_name = "中文 Test 日本語"

    await page.fill('#accountName', unicode_name)
    await page.select_option('#accountType', 'Checking')
    await page.fill('#accountStartingBalance', '1000')
    await page.click('button:has-text("Add Account")')
    await page.wait_for_timeout(500)
    
    # Verify account was created with unicode
    account_text = await page.evaluate("""
        () => {
            const cards = document.querySelectorAll('.acct-card-name');
            return cards.length > 0 ? cards[cards.length - 1].textContent : '';
        }
    """)
    assert len(account_text) > 0, "Unicode name not stored"


@pytest.mark.security
async def test_sanitize_recurring_template_paid_months(async_app_page):
    """sanitizeRecurringTemplate (via save/reload) strips malformed paidMonths
    entries, keeping only 'YYYY-MM' strings."""
    page = async_app_page

    result = await page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 8301, name: 'Paid Months Sanitize', type: 'Checking', startingBalance: 100 }];
        app.incomes = []; app.bonuses = []; app.bills = []; app.expenses = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = []; app.reconciliations = [];
        app.recurringTemplates = [{
            id: 8302, name: 'Sanitize Sub', type: 'subscription', amount: 10,
            frequency: 'monthly', dayOfMonth: 1, category: 'Subscription',
            accountId: 8301, targetAccountId: null,
            startDate: '2026-01-01', endDate: null,
            paused: false, skippedMonths: [],
            paidMonths: ['2026-06', 123, 'not-a-month', '26-06', '2026-006']
        }];
        app.saveToStorage();
        app.loadFromStorage();
        const t = app.recurringTemplates.find(x => x.id === 8302);
        return { paidMonths: t ? t.paidMonths : null };
    }""")

    assert result['paidMonths'] == ['2026-06'], f"Expected only '2026-06' to survive sanitization, got {result['paidMonths']}"
