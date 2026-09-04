#!/usr/bin/env python3
"""
Strategy Payment Calendar Tests
Verifies the Strategy > Schedule > Calendar View mini-calendar surfaces debt
payments, paydays, bill due-dates, and (added 2026-09-03, closing a11y/features
audit finding "unclear if intentional") expense and bonus days as well.
"""

import pytest

from tests.conftest import create_debt, current_month_iso, assert_no_errors


def _calculate_plan_and_open_calendar(page, debt_data):
    create_debt(page, debt_data)
    page.click('button[data-page="strategy"]')
    page.wait_for_timeout(300)
    page.fill('#monthlyPayment', '200')
    page.select_option('#paymentStrategy', 'avalanche')
    page.click('#calculateBtn')
    page.wait_for_timeout(500)

    page.click('[data-rtab="schedule"]')
    page.wait_for_timeout(150)
    page.click('button[data-tab="calendar"]')
    page.wait_for_timeout(300)


@pytest.mark.ui
def test_calendar_shows_bill_due_date(app_page, debt_data):
    """A bill with a dueDay produces a .cal-bill-event chip on the calendar."""
    page = app_page
    _calculate_plan_and_open_calendar(page, debt_data)

    page.evaluate("""() => {
        window.app.bills = [{ id: 1, name: 'Internet', amount: 60, dueDay: 10, category: 'Internet / Phone', accountId: null }];
        window.app.renderCalendarView(0);
    }""")
    page.wait_for_timeout(200)

    chip = page.query_selector('.cal-bill-event')
    assert chip is not None, "Expected a .cal-bill-event chip for the seeded bill"
    assert 'Internet' in chip.inner_text()
    assert_no_errors(page)


@pytest.mark.ui
def test_calendar_shows_expense_day(app_page, debt_data):
    """An expense with a date produces a .cal-expense-event chip on the calendar."""
    page = app_page
    _calculate_plan_and_open_calendar(page, debt_data)

    page.evaluate("""(dateIso) => {
        window.app.expenses = [{ id: 1, name: 'Groceries', budgetAmount: 300, date: new Date(dateIso + 'T00:00:00'), category: 'Food', accountId: null }];
        window.app.renderCalendarView(0);
    }""", current_month_iso(12))
    page.wait_for_timeout(200)

    chip = page.query_selector('.cal-expense-event')
    assert chip is not None, "Expected a .cal-expense-event chip for the seeded expense"
    assert 'Groceries' in chip.inner_text()

    legend_item = page.query_selector('.cal-legend-swatch--expense')
    assert legend_item is not None, "Expected the calendar legend to include an Expense entry"
    assert_no_errors(page)


@pytest.mark.ui
def test_calendar_shows_bonus_day(app_page, debt_data):
    """A bonus with a date produces a .cal-bonus-event chip on the calendar."""
    page = app_page
    _calculate_plan_and_open_calendar(page, debt_data)

    page.evaluate("""(dateIso) => {
        window.app.bonuses = [{ id: 1, name: 'Tax Refund', amount: 1500, date: dateIso, category: 'Other', accountId: null, purpose: null }];
        window.app.renderCalendarView(0);
    }""", current_month_iso(20))
    page.wait_for_timeout(200)

    chip = page.query_selector('.cal-bonus-event')
    assert chip is not None, "Expected a .cal-bonus-event chip for the seeded bonus"
    assert 'Tax Refund' in chip.inner_text()

    legend_item = page.query_selector('.cal-legend-swatch--bonus')
    assert legend_item is not None, "Expected the calendar legend to include a Bonus entry"
    assert_no_errors(page)


@pytest.mark.ui
def test_calendar_hides_expense_bonus_legend_when_none_exist(app_page, debt_data):
    """The Expense/Bonus legend entries only appear when there's matching data (mirrors existing income/bill behavior)."""
    page = app_page
    _calculate_plan_and_open_calendar(page, debt_data)

    page.evaluate("""() => {
        window.app.expenses = [];
        window.app.bonuses = [];
        window.app.renderCalendarView(0);
    }""")
    page.wait_for_timeout(200)

    assert page.query_selector('.cal-legend-swatch--expense') is None
    assert page.query_selector('.cal-legend-swatch--bonus') is None
    assert_no_errors(page)
