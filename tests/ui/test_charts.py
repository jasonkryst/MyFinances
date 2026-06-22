#!/usr/bin/env python3
"""
Chart Lifecycle Tests
Verifies Chart.js instances are destroyed before being re-created on re-render,
so re-rendering a page never throws "Canvas is already in use" or leaks chart instances.
"""

import pytest

from tests.conftest import create_debt, create_income, assert_no_errors


def _calculate_plan(page, debt_data):
    create_debt(page, debt_data)
    page.click('button[data-page="strategy"]')
    page.wait_for_timeout(300)
    page.fill('#monthlyPayment', '200')
    page.select_option('#paymentStrategy', 'avalanche')
    page.click('#calculateBtn')
    page.wait_for_timeout(500)


@pytest.mark.ui
def test_balance_chart_survives_repeated_recalculation(app_page, debt_data):
    """Recalculating the payment plan multiple times must not throw or leak Chart.js instances."""
    page = app_page
    _calculate_plan(page, debt_data)

    page.click('[data-rtab="schedule"]')
    page.wait_for_timeout(150)
    page.click('button[data-tab="chart"]')
    page.wait_for_timeout(300)

    for _ in range(3):
        page.click('#calculateBtn')
        page.wait_for_timeout(300)

    assert_no_errors(page)

    chart_attached = page.evaluate(
        "() => !!Chart.getChart(document.getElementById('balanceChart'))"
    )
    assert chart_attached, "Expected exactly one live Chart.js instance attached to #balanceChart"


@pytest.mark.ui
def test_health_dti_chart_survives_repeated_rerender(app_page, account_data):
    """Re-rendering the Health page repeatedly must not throw or leak Chart.js instances."""
    page = app_page
    page.click('button[data-page="accounts"]')
    page.fill('#accountName', account_data["name"])
    page.select_option('#accountType', label=account_data["type"])
    page.fill('#accountStartingBalance', account_data["balance"])
    page.click('#accountFormSubmit')
    page.wait_for_timeout(300)

    for _ in range(3):
        page.click('button[data-page="health"]')
        page.wait_for_timeout(300)
        page.click('button[data-page="accounts"]')
        page.wait_for_timeout(150)

    page.click('button[data-page="health"]')
    page.wait_for_timeout(300)

    assert_no_errors(page)

    canvas_exists = page.evaluate(
        "() => !!document.getElementById('healthDtiGauge')"
    )
    if canvas_exists:
        chart_attached = page.evaluate(
            "() => !!Chart.getChart(document.getElementById('healthDtiGauge'))"
        )
        assert chart_attached, "Expected exactly one live Chart.js instance attached to #healthDtiGauge"


@pytest.mark.ui
def test_networth_trend_chart_survives_repeated_rerender(app_page, account_data):
    """Re-rendering the Reports > Net Worth tab repeatedly must not throw or leak Chart.js instances."""
    page = app_page
    page.click('button[data-page="accounts"]')
    page.fill('#accountName', account_data["name"])
    page.select_option('#accountType', label=account_data["type"])
    page.fill('#accountStartingBalance', account_data["balance"])
    page.click('#accountFormSubmit')
    page.wait_for_timeout(300)

    page.click('button[data-page="reports"]')
    page.wait_for_timeout(300)

    for _ in range(3):
        page.click('[data-rptab="networth"]')
        page.wait_for_timeout(300)
        page.click('[data-rptab="calendar"]')
        page.wait_for_timeout(150)

    page.click('[data-rptab="networth"]')
    page.wait_for_timeout(300)

    assert_no_errors(page)

    canvas_exists = page.evaluate(
        "() => !!document.getElementById('rptNetWorthTrendChart')"
    )
    if canvas_exists:
        chart_attached = page.evaluate(
            "() => !!Chart.getChart(document.getElementById('rptNetWorthTrendChart'))"
        )
        assert chart_attached, "Expected exactly one live Chart.js instance attached to #rptNetWorthTrendChart"


@pytest.mark.ui
def test_forecast_chart_survives_repeated_rerender(app_page, account_data):
    """Re-rendering the Cash Flow Forecast chart repeatedly must not throw or leak Chart.js instances."""
    page = app_page
    page.click('button[data-page="accounts"]')
    page.fill('#accountName', account_data["name"])
    page.select_option('#accountType', label=account_data["type"])
    page.fill('#accountStartingBalance', account_data["balance"])
    page.click('#accountFormSubmit')
    page.wait_for_timeout(300)

    page.click('button[data-page="reports"]')
    page.wait_for_timeout(300)

    for _ in range(3):
        page.click('[data-rptab="forecast"]')
        page.wait_for_timeout(300)
        page.click('[data-rptab="calendar"]')
        page.wait_for_timeout(150)

    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(300)

    assert_no_errors(page)

    canvas_exists = page.evaluate(
        "() => !!document.getElementById('cfForecastChart')"
    )
    if canvas_exists:
        chart_attached = page.evaluate(
            "() => !!Chart.getChart(document.getElementById('cfForecastChart'))"
        )
        assert chart_attached, "Expected exactly one live Chart.js instance attached to #cfForecastChart"


@pytest.mark.ui
def test_balance_chart_has_png_export_button(app_page, debt_data):
    """The debt balance chart on the Strategy page shows a PNG export
    button that triggers a download when clicked."""
    page = app_page
    _calculate_plan(page, debt_data)

    # Navigate to the chart tab to render the balance chart
    page.click('[data-rtab="schedule"]')
    page.wait_for_timeout(150)
    page.click('button[data-tab="chart"]')
    page.wait_for_timeout(300)

    btn = page.query_selector('#balanceChart-export-btn')
    assert btn, "Expected a PNG export button next to the balance chart"
    assert btn.get_attribute('aria-label')

    with page.expect_download() as download_info:
        btn.click()
    download = download_info.value
    assert download.suggested_filename.endswith('.png')


@pytest.mark.ui
def test_cashflow_donut_chart_has_png_export_button(app_page, account_data, income_data):
    """The Budget page's cash flow donut chart has a PNG export button."""
    page = app_page

    # First create an account (required for income)
    page.click('button[data-page="accounts"]')
    page.fill('#accountName', account_data["name"])
    page.select_option('#accountType', label=account_data["type"])
    page.fill('#accountStartingBalance', account_data["balance"])
    page.click('#accountFormSubmit')
    page.wait_for_timeout(300)

    # Create income
    page.click('button[data-page="income"]')
    page.fill('#incomeName', income_data["name"])
    page.fill('#incomeAmount', income_data["amount"])
    page.fill('#incomeFirstDate', income_data["first_date"])
    page.select_option('#incomeFrequency', income_data["frequency"])
    page.select_option('#incomeAccount', index=1)
    page.click('#incomeFormSubmit')
    page.wait_for_selector(f'text={income_data["name"]}', timeout=10000)

    # Navigate to the Expenses tab to see the cash flow summary and charts
    page.click('button[data-page="liabilities"]')
    page.click('button[data-liabilities-subtab="expenses"]')
    page.wait_for_timeout(300)
    charts_tab = page.query_selector('.cashflow-tab[data-tab="charts"]')
    if charts_tab:
        charts_tab.click()
        page.wait_for_timeout(300)

    # Check for the donut chart export button
    btn = page.query_selector('#cashflowDonutChart-export-btn')
    assert btn, "Expected a PNG export button next to the cash flow donut chart"


@pytest.mark.ui
def test_reports_income_chart_has_png_export_button(app_page, account_data, income_data):
    """The Reports > Income vs Expenses panel's income chart has a PNG export button."""
    page = app_page

    # First create an account (required for income)
    page.click('button[data-page="accounts"]')
    page.fill('#accountName', account_data["name"])
    page.select_option('#accountType', label=account_data["type"])
    page.fill('#accountStartingBalance', account_data["balance"])
    page.click('#accountFormSubmit')
    page.wait_for_timeout(300)

    # Create income
    page.click('button[data-page="income"]')
    page.fill('#incomeName', income_data["name"])
    page.fill('#incomeAmount', income_data["amount"])
    page.fill('#incomeFirstDate', income_data["first_date"])
    page.select_option('#incomeFrequency', income_data["frequency"])
    page.select_option('#incomeAccount', index=1)
    page.click('#incomeFormSubmit')
    page.wait_for_selector(f'text={income_data["name"]}', timeout=10000)

    page.click('button[data-page="reports"]')
    page.click('[data-rptab="incomeexp"]')
    page.wait_for_timeout(300)

    btn = page.query_selector('#rptIncomeChart-export-btn')
    assert btn, "Expected a PNG export button next to the Reports income chart"


@pytest.mark.ui
def test_health_dti_gauge_has_png_export_button(app_page, health_data):
    """The Health dashboard's Debt-to-Income gauge has a PNG export button."""
    page = app_page
    page.evaluate("""(data) => {
        const app = window.app;
        app.incomes = [data.income];
        app.debts = [data.debt];
        app.bills = [data.bill];
        app.accounts = [];
        app.switchPage('health');
    }""", health_data)
    page.wait_for_timeout(300)

    btn = page.query_selector('#healthDtiGauge-export-btn')
    assert btn, "Expected a PNG export button next to the DTI gauge"
