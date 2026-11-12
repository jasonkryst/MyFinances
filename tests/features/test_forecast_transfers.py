#!/usr/bin/env python3
"""
Forecast total view and transfers between own accounts (issue #616).

A one-off or recurring transfer between two forecast asset accounts must not
count as Income or Outflow in the total view, nor appear as a notable-month
driver. A transfer to a liability account is still a real outflow, and the
single-account view is unchanged.
"""

import pytest

BASE_URL = "http://localhost:32900/"

SEED_JS = """() => {
    const app = window.app;
    const now = new Date();
    const at = (n, day) => {
        const tm = now.getMonth() + n;
        const y = now.getFullYear() + Math.floor(tm / 12);
        const m = tm % 12;
        return `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    };
    app.accounts = [
        { id: 9201, name: 'Checking', type: 'Checking', startingBalance: 10000 },
        { id: 9202, name: 'Savings', type: 'Savings', startingBalance: 1000 },
        { id: 9203, name: 'Visa', type: 'Credit Card', startingBalance: 0 }
    ];
    app.incomes = [
        { id: 1, name: 'Salary', amount: 2000, firstPayDate: at(1, 1), frequency: 'monthly', accountId: 9201 }
    ];
    app.transfers = [
        { id: 'x1', fromAccountId: 9201, toAccountId: 9202, amount: 300, date: at(1, 10), memo: '' },
        { id: 'x2', fromAccountId: 9201, toAccountId: 9203, amount: 125, date: at(1, 12), memo: '' },
        { id: 'x3', fromAccountId: 9201, toAccountId: 9202, amount: 900, date: at(3, 10), memo: '' }
    ];
    app.recurringTemplates = [
        { id: 'r1', name: 'Auto save', type: 'transfer', amount: 200, accountId: 9201, targetAccountId: 9202,
          frequency: 'monthly', dayOfMonth: 15 },
        { id: 'r2', name: 'Pay Visa', type: 'transfer', amount: 75, accountId: 9201, targetAccountId: 9203,
          frequency: 'monthly', dayOfMonth: 16 }
    ];
    app.expenses = [
        { id: 20, name: 'Property Tax', budgetAmount: 3000, date: at(3, 20), category: 'Other', accountId: 9201 }
    ];
    app.bills = []; app.debts = []; app.emergencyFunds = []; app.sinkingFunds = [];
    app._forecastRangeMonths = 3;
    app._forecastAccountId = 'total';
    app._forecastNotableThresholdPct = 130;
    app.switchPage('reports');
}"""

SERIES_JS = """async (setting) => {
    const { computeForecastSeries } = await import('/src/forecast.js');
    return computeForecastSeries(window.app, setting, 3)
        .map(e => ({ income: e.income, outflow: e.outflow, net: e.net, balance: e.balance }));
}"""


def _open_forecast(page):
    page.evaluate(SEED_JS)
    page.click('[data-rptab="forecast"]')
    page.wait_for_selector('#rptPanel-forecast.rpt-tab-panel--active', timeout=5000)
    page.wait_for_selector('#reportsCashFlowForecast table', timeout=5000)


@pytest.mark.feature
def test_forecast_total_excludes_internal_transfers(app_page):
    page = app_page
    _open_forecast(page)

    total = page.evaluate(SERIES_JS, 'total')
    # Month 0 is a balance-only row.
    assert total[0] == {'income': 0, 'outflow': 0, 'net': 0, 'balance': 11000}
    # Salary 2000 a month. Only the Visa transfers (125 one-off in month 1, 75 monthly) leave the asset total.
    assert total[1]['income'] == 2000, "Savings inflows must not count as Income"
    assert total[1]['outflow'] == 200, "Only the two Visa transfers are real outflow"
    assert total[2]['income'] == 2000
    assert total[2]['outflow'] == 75
    # Month 3 adds the 3000 tax; the 900 internal transfer stays out.
    assert total[3]['outflow'] == 75 + 3000
    # Net and balance still move by the real cash only.
    assert total[1]['net'] == 2000 - 200
    assert total[1]['balance'] == 11000 + 1800
    assert total[3]['balance'] == 11000 + 1800 + 1925 + (2000 - 3075)


@pytest.mark.feature
def test_forecast_single_account_view_counts_transfers_as_outflow(app_page):
    page = app_page
    _open_forecast(page)

    checking = page.evaluate(SERIES_JS, 9201)
    assert checking[1]['outflow'] == 300 + 125 + 200 + 75
    savings = page.evaluate(SERIES_JS, 9202)
    assert savings[1]['income'] == 300 + 200
    assert savings[1]['outflow'] == 0


@pytest.mark.feature
def test_forecast_drivers_never_name_internal_transfers(app_page):
    page = app_page
    _open_forecast(page)

    text = page.query_selector('#reportsCashFlowForecast').text_content()
    assert 'Driven by' in text, "Month 3 (property tax) should be notable"
    assert 'Property Tax' in text
    assert 'Transfer to Savings' not in text, "Internal transfer must not be a driver"
    assert 'Auto save' not in text, "Recurring internal transfer must not be a driver"
    assert 'Pay Visa' in text, "A transfer to a credit card is a real outflow driver"
