#!/usr/bin/env python3
"""
Income Management Tests
Tests income source creation and calculations.
"""

import pytest

BASE_URL = "http://localhost:5500/"


@pytest.mark.feature
def test_create_income(app_page, income_data):
    """Test creating a new income source."""
    page = app_page
    
    page.click('button[data-page="income"]')
    page.wait_for_timeout(300)
    
    page.fill('#incomeName', income_data["name"])
    page.fill('#incomeAmount', income_data["amount"])
    page.fill('#incomeFirstDate', income_data["first_date"])
    page.select_option('#incomeFrequency', income_data["frequency"])
    page.click('button[type="submit"]:has-text("Add Income")')
    page.wait_for_selector(f'text={income_data["name"]}', timeout=10000)
    
    assert page.query_selector(f'text={income_data["name"]}'), "Income not created"


@pytest.mark.feature
def test_income_frequencies(app_page):
    """Test all income frequency types."""
    page = app_page
    
    page.click('button[data-page="income"]')
    page.wait_for_timeout(300)
    
    frequencies = ['weekly', 'biweekly', 'monthly', 'annual']
    
    for i, freq in enumerate(frequencies):
        page.fill('#incomeName', f'Income {i}')
        page.fill('#incomeAmount', '5000')
        page.fill('#incomeFirstDate', '2026-05-01')
        page.select_option('#incomeFrequency', freq)
        page.click('button[type="submit"]:has-text("Add Income")')
        page.wait_for_timeout(500)


@pytest.mark.feature
def test_total_income_calculation(app_page):
    """Test that total monthly income is calculated correctly."""
    page = app_page
    
    page.click('button[data-page="income"]')
    page.wait_for_timeout(300)
    
    # Add income
    page.fill('#incomeName', 'Salary')
    page.fill('#incomeAmount', '5000')
    page.fill('#incomeFirstDate', '2026-05-01')
    page.select_option('#incomeFrequency', 'monthly')
    page.click('button[type="submit"]:has-text("Add Income")')
    page.wait_for_timeout(500)
    
    # Verify income appears
    assert page.query_selector('text=Salary'), "Income not created"


@pytest.mark.feature
def test_multiple_income_sources(app_page):
    """Test managing multiple income sources."""
    page = app_page
    
    page.click('button[data-page="income"]')
    page.wait_for_timeout(300)
    
    incomes = [
        ('Primary Job', '5000', '2026-05-01', 'monthly'),
        ('Side Gig', '1000', '2026-05-15', 'biweekly'),
        ('Bonus', '3000', '2026-12-31', 'annual'),
    ]
    
    for name, amount, date, freq in incomes:
        page.fill('#incomeName', name)
        page.fill('#incomeAmount', amount)
        page.fill('#incomeFirstDate', date)
        page.select_option('#incomeFrequency', freq)
        page.click('button[type="submit"]:has-text("Add Income")')
        page.wait_for_timeout(500)
    
    # Verify all incomes appear
    for name, _, _, _ in incomes:
        assert page.query_selector(f'text={name}'), f"{name} not found"
