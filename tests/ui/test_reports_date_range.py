#!/usr/bin/env python3
"""
Reports: custom date range for Spending and Variance reports (issue #329).

Both #reportsSpending and #reportsVariance gained their own "Range" <select>
(#spendingRangeMonths / #varianceRangeMonths - distinct ids, since Reports
sub-tab panels stay in the DOM, just class-hidden, after being visited once
in a session, so two selects sharing one id would collide). Both read/write
the single shared app._reportRangeMonths, so switching tabs keeps the same
selection; navigating away from and back to Reports resets it to 1, exactly
like the pre-existing app._reportMonthOffset reset.
"""

import pytest


def _seed_spending_data(page):
    """The Spending report renders an empty-state (no range selector at all)
    with zero outflow transactions, so every test below needs at least one
    to see the selector."""
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [];
        app.expenses = [{ id: 1, name: 'Groceries', category: 'Food', budgetAmount: 50, date: new Date().toISOString().slice(0, 10), accountId: null }];
        app.bills = []; app.recurringTemplates = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.incomes = []; app.bonuses = [];
        app.ledgerAmountOverrides = {};
        app.switchPage('reports');
    }""")


@pytest.mark.ui
def test_spending_range_selector_present_and_defaults_to_single_month(app_page):
    """Positive: the Spending tab's range selector exists and defaults to
    'Single Month' (1), leaving existing single-month behavior unchanged."""
    page = app_page
    _seed_spending_data(page)
    page.click('[data-rptab="spending"]')
    page.wait_for_selector('#rptPanel-spending.rpt-tab-panel--active', timeout=5000)

    select = page.query_selector('#spendingRangeMonths')
    assert select is not None
    assert select.input_value() == '1'


@pytest.mark.ui
def test_changing_spending_range_updates_label_and_persists_across_tab_switch(app_page):
    """Positive: picking a 3-month range on the Spending tab changes its
    displayed label, and the Variance tab's selector reflects the same
    shared app._reportRangeMonths when switched to."""
    page = app_page
    _seed_spending_data(page)
    page.click('[data-rptab="spending"]')
    page.wait_for_selector('#rptPanel-spending.rpt-tab-panel--active', timeout=5000)

    page.select_option('#spendingRangeMonths', '3')
    page.wait_for_function("() => window.app._reportRangeMonths === 3", timeout=3000)

    # The summary strip's label switches from a single month name to a
    # "<short> - <short year>" range once a multi-month range is selected.
    summary_text = page.query_selector('.spending-summary-strip').text_content()
    assert '–' in summary_text, f"Expected an en-dash range label, got: {summary_text}"

    page.click('[data-rptab="variance"]')
    page.wait_for_selector('#rptPanel-variance.rpt-tab-panel--active', timeout=5000)
    assert page.query_selector('#varianceRangeMonths').input_value() == '3'
    variance_text = page.query_selector('#reportsVariance').text_content()
    assert 'Period-to-Period Comparison' in variance_text


@pytest.mark.ui
def test_changing_variance_range_persists_back_to_spending(app_page):
    """Positive: the reverse direction also stays in sync - setting the
    range from the Variance tab is reflected back on Spending."""
    page = app_page
    _seed_spending_data(page)
    page.click('[data-rptab="variance"]')
    page.wait_for_selector('#rptPanel-variance.rpt-tab-panel--active', timeout=5000)

    page.select_option('#varianceRangeMonths', '6')
    page.wait_for_function("() => window.app._reportRangeMonths === 6", timeout=3000)

    page.click('[data-rptab="spending"]')
    page.wait_for_selector('#rptPanel-spending.rpt-tab-panel--active', timeout=5000)
    assert page.query_selector('#spendingRangeMonths').input_value() == '6'


# ─────────────────────────── negative tests ───────────────────────────

@pytest.mark.ui
def test_range_resets_to_single_month_on_page_navigation(app_page):
    """Negative: navigating away from Reports and back resets the shared
    range back to 1 (Single Month), matching the existing
    app._reportMonthOffset reset-on-navigation convention."""
    page = app_page
    _seed_spending_data(page)
    page.click('[data-rptab="spending"]')
    page.wait_for_selector('#rptPanel-spending.rpt-tab-panel--active', timeout=5000)

    page.select_option('#spendingRangeMonths', '12')
    page.wait_for_function("() => window.app._reportRangeMonths === 12", timeout=3000)

    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)
    page.click('button[data-page="reports"]')
    page.wait_for_selector('#reportsSection.active', timeout=5000)

    range_months = page.evaluate('() => window.app._reportRangeMonths')
    assert range_months == 1

    page.click('[data-rptab="spending"]')
    page.wait_for_selector('#rptPanel-spending.rpt-tab-panel--active', timeout=5000)
    assert page.query_selector('#spendingRangeMonths').input_value() == '1'


@pytest.mark.ui
def test_invalid_range_select_value_falls_back_to_one(app_page):
    """Negative: a malformed/unparseable value never results in
    app._reportRangeMonths becoming NaN or falsy-but-not-1."""
    page = app_page
    _seed_spending_data(page)
    page.click('[data-rptab="spending"]')
    page.wait_for_selector('#rptPanel-spending.rpt-tab-panel--active', timeout=5000)

    result = page.evaluate("""() => {
        const app = window.app;
        const select = document.getElementById('spendingRangeMonths');
        const opt = document.createElement('option');
        opt.value = 'not-a-number';
        opt.textContent = 'bogus';
        select.appendChild(opt);
        select.value = 'not-a-number';
        select.dispatchEvent(new Event('change'));
        return app._reportRangeMonths;
    }""")
    assert result == 1
