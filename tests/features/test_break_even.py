#!/usr/bin/env python3
"""
Break-Even Analysis Tests
Tests per-debt payoff comparison badge, accelerate modal, and plan table columns.
"""
import pytest
from tests.conftest import create_debt

BASE_URL = "http://localhost:5500/"


def _nav_debts(page):
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)


def _create_cc_debt(page, name="Visa", balance="2400", rate="18.5", min_pay="100"):
    _nav_debts(page)
    page.click('#debtFormToggle')
    page.wait_for_timeout(200)
    page.fill('#debtName', name)
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', balance)
    page.fill('#interestRate', rate)
    page.fill('#minimumPayment', min_pay)
    page.fill('#dueDate', '15')
    page.click('#debtFormSubmit')
    page.wait_for_selector(f'text={name}', timeout=10000)


def _run_plan(page, payment="450"):
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="plan"]')
    page.wait_for_timeout(300)
    page.fill('#monthlyPayment', payment)
    page.click('#calculateBtn')
    page.wait_for_selector('#resultsSection.visible', timeout=10000)


@pytest.mark.feature
def test_placeholder():
    """Placeholder — replaced by real tests in Task 6."""
    assert True
