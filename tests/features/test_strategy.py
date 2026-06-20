#!/usr/bin/env python3
"""
Strategy/Payment-Plan Tests
Tests strategy switching (Avalanche/Snowball/Priority) and the per-month
stimulus input on the payment schedule table.
"""

import pytest

from tests.conftest import create_debt, assert_no_errors


def _create_two_debts(page):
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Strategy Account')
    page.select_option('#accountType', label='Credit Card')
    page.fill('#accountStartingBalance', '0')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(300)

    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)

    debts = [
        ('High Interest Debt', '2000', '24', '100'),
        ('Low Interest Debt', '5000', '6', '150'),
    ]
    for name, balance, rate, min_pmt in debts:
        page.click('#debtFormToggle')
        page.wait_for_timeout(200)
        page.fill('#debtName', name)
        page.select_option('#debtType', 'creditCard')
        page.fill('#accountBalance', balance)
        page.fill('#interestRate', rate)
        page.fill('#minimumPayment', min_pmt)
        page.fill('#dueDate', '15')
        page.click('#debtFormSubmit')
        page.wait_for_timeout(300)


def _calculate(page, strategy):
    page.click('button[data-page="strategy"]')
    page.wait_for_timeout(300)
    page.fill('#monthlyPayment', '500')
    page.select_option('#paymentStrategy', strategy)
    page.click('#calculateBtn')
    page.wait_for_timeout(500)


@pytest.mark.feature
def test_strategy_switch_recalculates_without_error(app_page):
    """Switching between Avalanche, Snowball, and Priority strategies and
    recalculating each time produces a fresh plan with no console errors.
    """
    page = app_page
    _create_two_debts(page)

    for strategy in ['avalanche', 'snowball', 'priority-lowest', 'priority-highest']:
        _calculate(page, strategy)
        assert_no_errors(page)

    months_to_payoff = page.evaluate(
        "() => window.app.lastSummary ? window.app.lastSummary.monthsToPayOff : null"
    )
    assert months_to_payoff and months_to_payoff > 0, \
        "Expected a positive monthsToPayOff after the final strategy calculation"


@pytest.mark.feature
def test_strategy_comparison_panel_shows_all_strategies(app_page):
    """The Strategy Comparison panel lists all 4 strategies once a plan is calculated."""
    page = app_page
    _create_two_debts(page)
    _calculate(page, 'avalanche')

    page.click('[data-rtab="overview"]')
    page.wait_for_timeout(200)

    row_count = page.evaluate(
        "() => document.querySelectorAll('#interestComparison .comparison-table tbody tr').length"
    )
    assert row_count == 4, f"Expected 4 strategy rows in the comparison table, got {row_count}"


@pytest.mark.feature
def test_stimulus_input_increases_month_total_paid(app_page):
    """Entering a per-month stimulus amount recalculates and raises that month's total paid."""
    page = app_page
    _create_two_debts(page)
    _calculate(page, 'avalanche')

    page.click('[data-rtab="schedule"]')
    page.wait_for_timeout(200)
    page.click('button[data-tab="tabular"]')
    page.wait_for_timeout(200)

    total_before = page.evaluate("""
        () => {
            const row = document.querySelector('#paymentTableBody tr');
            return row ? row.querySelector('.amount-total').textContent : null;
        }
    """)
    assert total_before is not None, "Expected at least one row in the payment schedule table"

    page.fill('#stimulus-input-0', '300')
    page.dispatch_event('#stimulus-input-0', 'change')
    page.wait_for_timeout(500)

    total_after = page.evaluate("""
        () => {
            const row = document.querySelector('#paymentTableBody tr');
            return row ? row.querySelector('.amount-total').textContent : null;
        }
    """)
    assert total_after is not None and total_after != total_before, \
        f"Expected month-1 total paid to change after applying a stimulus (before={total_before!r}, after={total_after!r})"


@pytest.mark.feature
def test_stimulus_non_numeric_input_falls_back_to_zero(app_page):
    """A non-numeric stimulus value is stored as 0, not NaN, and doesn't break recalculation."""
    page = app_page
    _create_two_debts(page)
    _calculate(page, 'avalanche')

    page.click('[data-rtab="schedule"]')
    page.wait_for_timeout(200)
    page.click('button[data-tab="tabular"]')
    page.wait_for_timeout(200)

    page.evaluate("""
        () => {
            const input = document.getElementById('stimulus-input-0');
            input.value = 'abc';
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
    """)
    page.wait_for_timeout(300)

    stored_value = page.evaluate("() => window.app.perMonthStimulus[0]")
    assert stored_value == 0, f"Expected non-numeric stimulus input to fall back to 0, got {stored_value!r}"
    assert_no_errors(page)
