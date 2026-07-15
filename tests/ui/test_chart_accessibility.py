#!/usr/bin/env python3
"""
Chart Screen-Reader Data-Table Fallback Tests
Every Chart.js canvas (Health gauges, Spending pie/bar, Forecast line, Net
Worth trend) must have a visually-hidden <table> equivalent next to it so
screen-reader users get the same information sighted users get from the chart.
"""

import pytest

from tests.conftest import assert_no_errors, current_month_iso


def _assert_sr_table(page, canvas_id, min_rows=1):
    table = page.query_selector(f'#{canvas_id}-sr-table')
    assert table is not None, f"Expected a screen-reader data table for #{canvas_id}"

    is_sr_only = table.evaluate('(el) => el.classList.contains("sr-only")')
    assert is_sr_only, f"#{canvas_id}-sr-table should be visually hidden via .sr-only"

    row_count = table.evaluate('(el) => el.querySelectorAll("tbody tr").length')
    assert row_count >= min_rows, f"Expected at least {min_rows} row(s) in #{canvas_id}-sr-table, got {row_count}"

    caption = table.evaluate('(el) => el.querySelector("caption")?.textContent')
    assert caption, f"#{canvas_id}-sr-table should have a non-empty <caption>"


@pytest.mark.ui
def test_health_gauges_have_sr_tables(app_page, account_data, income_data):
    page = app_page
    page.click('button[data-page="accounts"]')
    page.fill('#accountName', account_data["name"])
    page.select_option('#accountType', label=account_data["type"])
    page.fill('#accountStartingBalance', account_data["balance"])
    page.click('#accountFormSubmit')
    page.wait_for_timeout(300)

    page.click('button[data-page="health"]')
    page.wait_for_timeout(300)

    _assert_sr_table(page, 'healthDtiGauge')
    _assert_sr_table(page, 'healthSavingsGauge')
    assert_no_errors(page)


@pytest.mark.ui
def test_spending_charts_have_sr_tables(app_page):
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)
    page.evaluate("""(dates) => {
        const app = window.app;
        app.expenses = [
            { id: 9101, name: 'Rent', category: 'Housing', budgetAmount: 950, date: dates.rent, accountId: null },
            { id: 9102, name: 'Groceries', category: 'Food', budgetAmount: 180, date: dates.groceries, accountId: null }
        ];
        app.bills = []; app.recurringTemplates = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.incomes = []; app.bonuses = []; app.accounts = [];
        app.ledgerAmountOverrides = {};
        app._reportMonthOffset = 0;
        app.renderReportsPage();
    }""", {"rent": current_month_iso(1), "groceries": current_month_iso(10)})
    page.click('[data-rptab="spending"]')
    page.wait_for_timeout(400)

    _assert_sr_table(page, 'rptSpendingPieChart')
    _assert_sr_table(page, 'rptSpendingBarChart')
    assert_no_errors(page)


@pytest.mark.ui
def test_forecast_chart_has_sr_table(app_page, account_data):
    page = app_page
    page.click('button[data-page="accounts"]')
    page.fill('#accountName', account_data["name"])
    page.select_option('#accountType', label=account_data["type"])
    page.fill('#accountStartingBalance', account_data["balance"])
    page.click('#accountFormSubmit')
    page.wait_for_timeout(300)

    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)
    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(400)

    _assert_sr_table(page, 'cfForecastChart')
    assert_no_errors(page)


@pytest.mark.ui
def test_networth_trend_chart_has_sr_table(app_page, account_data):
    page = app_page
    page.click('button[data-page="accounts"]')
    page.fill('#accountName', account_data["name"])
    page.select_option('#accountType', label=account_data["type"])
    page.fill('#accountStartingBalance', account_data["balance"])
    page.click('#accountFormSubmit')
    page.wait_for_timeout(300)

    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)
    page.click('[data-rptab="networth"]')
    page.wait_for_timeout(400)

    _assert_sr_table(page, 'rptNetWorthTrendChart')
    assert_no_errors(page)
