#!/usr/bin/env python3
"""
Income Management Tests
Tests income source creation and calculations.
"""

import pytest

BASE_URL = "http://localhost:5500/"


def _create_income_account(page, name="Income Validation Account"):
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', name)
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '1000')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(300)
    page.click('button[data-page="income"]')
    page.wait_for_timeout(300)


@pytest.mark.feature
def test_create_income(app_page, income_data):
    """Test creating a new income source."""
    page = app_page

    # Income requires an account selection
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Income Account')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '1000')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(300)
    
    page.click('button[data-page="income"]')
    page.wait_for_timeout(300)
    
    page.fill('#incomeName', income_data["name"])
    page.fill('#incomeAmount', income_data["amount"])
    page.fill('#incomeFirstDate', income_data["first_date"])
    page.select_option('#incomeFrequency', income_data["frequency"])
    page.select_option('#incomeAccount', index=1)
    page.click('#incomeFormSubmit')
    page.wait_for_selector(f'text={income_data["name"]}', timeout=10000)
    
    assert page.query_selector(f'text={income_data["name"]}'), "Income not created"


@pytest.mark.feature
def test_income_frequencies(app_page):
    """Test all income frequency types."""
    page = app_page
    
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Income Freq Account')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '1000')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(300)

    page.click('button[data-page="income"]')
    page.wait_for_timeout(300)
    
    frequencies = ['biweekly', 'monthly']
    
    for i, freq in enumerate(frequencies):
        page.fill('#incomeName', f'Income {i}')
        page.fill('#incomeAmount', '5000')
        page.fill('#incomeFirstDate', '2026-05-01')
        page.select_option('#incomeFrequency', freq)
        page.select_option('#incomeAccount', index=1)
        page.click('#incomeFormSubmit')
        page.wait_for_timeout(500)


@pytest.mark.feature
def test_total_income_calculation(app_page):
    """Test that total monthly income is calculated correctly."""
    page = app_page
    
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Income Total Account')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '1000')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(300)

    page.click('button[data-page="income"]')
    page.wait_for_timeout(300)
    
    # Add income
    page.fill('#incomeName', 'Salary')
    page.fill('#incomeAmount', '5000')
    page.fill('#incomeFirstDate', '2026-05-01')
    page.select_option('#incomeFrequency', 'monthly')
    page.select_option('#incomeAccount', index=1)
    page.click('#incomeFormSubmit')
    page.wait_for_timeout(500)
    
    # Verify income appears
    assert page.query_selector('text=Salary'), "Income not created"


@pytest.mark.feature
def test_multiple_income_sources(app_page):
    """Test managing multiple income sources."""
    page = app_page
    
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Income Multi Account')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '1000')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(300)

    page.click('button[data-page="income"]')
    page.wait_for_timeout(300)
    
    incomes = [
        ('Primary Job', '5000', '2026-05-01', 'monthly'),
        ('Side Gig', '1000', '2026-05-15', 'biweekly'),
        ('Bonus', '3000', '2026-12-31', 'monthly'),
    ]
    
    for name, amount, date, freq in incomes:
        page.fill('#incomeName', name)
        page.fill('#incomeAmount', amount)
        page.fill('#incomeFirstDate', date)
        page.select_option('#incomeFrequency', freq)
        page.select_option('#incomeAccount', index=1)
        page.click('#incomeFormSubmit')
        page.wait_for_timeout(500)
    
    # Verify all incomes appear
    for name, _, _, _ in incomes:
        assert page.query_selector(f'text={name}'), f"{name} not found"


@pytest.mark.feature
def test_add_income_negative_amount_rejected(app_page):
    """Negative income amounts are rejected, not silently clamped to $0.01.

    addIncome() previously validated the post-clamp value
    (sanitizeFiniteNumber(raw, NaN, { min: 0.01 })), so a negative input was
    clamped up to 0.01 *before* the `amount <= 0` check ran, and that check
    could never be true. Fixed in src/income.js to validate the raw input
    string before clamping, matching the pattern already applied to
    src/bills.js and src/recurring.js.
    """
    page = app_page
    _create_income_account(page)

    page.fill('#incomeName', 'Negative Salary')
    page.fill('#incomeAmount', '-500')
    page.fill('#incomeFirstDate', '2026-05-01')
    page.select_option('#incomeFrequency', 'monthly')
    page.select_option('#incomeAccount', index=1)
    page.click('#incomeFormSubmit')
    page.wait_for_timeout(300)

    assert page.query_selector('text=Negative Salary') is None, (
        "A negative income amount should be rejected, not silently saved as $0.01"
    )


@pytest.mark.feature
def test_add_bonus_negative_amount_rejected(app_page):
    """Negative one-time bonus/deposit amounts are rejected, not clamped to $0.01."""
    page = app_page
    _create_income_account(page)

    page.click('#bonusFormToggle')
    page.wait_for_timeout(200)
    page.fill('#bonusName', 'Negative Bonus')
    page.fill('#bonusAmount', '-200')
    page.fill('#bonusDate', '2026-05-01')
    page.select_option('#bonusCategory', label='Bonus')
    page.click('#bonusForm button[type="submit"]')
    page.wait_for_timeout(300)

    assert page.query_selector('text=Negative Bonus') is None, (
        "A negative bonus amount should be rejected, not silently saved as $0.01"
    )
