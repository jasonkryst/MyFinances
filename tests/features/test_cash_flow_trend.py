#!/usr/bin/env python3
"""
Cash Flow Trend chart tests (GitHub issue #76).

getCashFlowTrendSeries(app, months) computes income/outflow/net per month,
oldest-first, ending at the currently-viewed report month
(getReportDate(app), which respects app._reportMonthOffset). These tests
exercise the data layer directly via window.app.getCashFlowTrendSeries
before any DOM rendering exists (Task 1), then the rendered widget once
renderReportsCashFlowTrend is wired in (Task 2).
"""

import pytest


@pytest.mark.feature
def test_cash_flow_trend_series_multi_month_totals(app_page):
    """getCashFlowTrendSeries(3) should return correct income/outflow/net
    per month, oldest-first, for three distinct one-time expenses landing
    in three consecutive months ending at the current report month."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth();
        const fmtMonth = (year, month) => `${year}-${String(month + 1).padStart(2, '0')}-05`;
        const d2 = new Date(y, m - 2, 1);
        const d1 = new Date(y, m - 1, 1);

        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        app.incomes = []; app.bills = []; app.debts = []; app.recurringTemplates = [];
        app.emergencyFunds = []; app.sinkingFunds = []; app.monthlySnapshots = [];
        app.expenses = [
            { id: 1, name: 'Groceries', budgetAmount: 100, date: fmtMonth(d2.getFullYear(), d2.getMonth()), category: 'Food', accountId: 1 },
            { id: 2, name: 'Groceries', budgetAmount: 200, date: fmtMonth(d1.getFullYear(), d1.getMonth()), category: 'Food', accountId: 1 },
            { id: 3, name: 'Groceries', budgetAmount: 300, date: fmtMonth(y, m), category: 'Food', accountId: 1 }
        ];
        app._reportMonthOffset = 0;
    }""")

    series = page.evaluate("() => window.app.getCashFlowTrendSeries(3)")
    assert len(series) == 3
    assert [round(mo['outflow'], 2) for mo in series] == [100, 200, 300]
    assert [round(mo['income'], 2) for mo in series] == [0, 0, 0]
    assert [round(mo['net'], 2) for mo in series] == [-100, -200, -300]


@pytest.mark.feature
def test_cash_flow_trend_series_respects_report_month_offset_year_boundary(app_page):
    """Walking the report month forward across a Dec->Jan year boundary
    should shift the 3-month trend window correctly, with no off-by-one
    on month index or year."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = []; app.debts = []; app.bills = []; app.expenses = [];
        app.incomes = []; app.recurringTemplates = []; app.emergencyFunds = [];
        app.sinkingFunds = []; app.monthlySnapshots = [];
        app._reportMonthOffset = 0;
        app.switchPage('reports');

        const now = new Date();
        window.__stepsToJan = (12 - now.getMonth()) % 12;
        if (window.__stepsToJan === 0) window.__stepsToJan = 12;
    }""")

    steps = page.evaluate('() => window.__stepsToJan')
    for _ in range(steps):
        page.click('#rptNextMonth')
        page.wait_for_timeout(150)

    series = page.evaluate("() => window.app.getCashFlowTrendSeries(3)")
    # series[2] is the anchor (report) month, which is now January.
    assert series[2]['month'] == 0
    # series[1] is the month before it: December of the prior year.
    assert series[1]['month'] == 11
    assert series[1]['year'] == series[2]['year'] - 1
