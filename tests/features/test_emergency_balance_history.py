#!/usr/bin/env python3
"""
Emergency Fund balance history chart (#307): the linked account's month-end
balance for the trailing 12 months, with an accessible data table, and a
message instead of the chart when there is nothing meaningful to plot.

Records are injected in memory; the Savings page renders from app.* directly.
"""

import pytest

RENDER_JS = """async (opts) => {
    const app = window.app;
    app.accounts = [{ id: 9001, name: 'EF Savings', type: 'Savings', startingBalance: 1000 }];
    app.bills = opts.withActivity
        ? [{ id: 91, name: 'Monthly fee', dueDay: 5, amount: 20, category: 'Other', accountId: 9001 }]
        : [];
    app.incomes = []; app.bonuses = []; app.expenses = []; app.debts = [];
    app.recurringTemplates = []; app.sinkingFunds = [];
    app.emergencyFunds = opts.linked
        ? [{ id: 1, accountId: 9001, targetAmount: 5000, currentAmount: 1000, monthlyContribution: 0 }]
        : [];
    app.savingsSubTab = 'emergency';
    app.switchPage('savings');
    app.renderSavingsPage();
}"""


def _render(page, linked=True, with_activity=True):
    page.evaluate(RENDER_JS, {"linked": linked, "withActivity": with_activity})
    page.wait_for_selector('#efBalanceHistoryCard', state='attached')


@pytest.mark.feature
def test_balance_history_chart_renders_with_table(app_page):
    """Positive: a linked account with monthly activity charts 12 months and has an SR table."""
    page = app_page
    _render(page)

    assert page.is_visible('#efBalanceHistoryChart')
    assert 'hidden' in page.get_attribute('#efBalanceHistoryMsg', 'class')
    assert page.locator('#efBalanceHistoryChart-sr-table tbody tr').count() == 12
    headers = page.locator('#efBalanceHistoryChart-sr-table thead th').all_text_contents()
    assert headers == ['Month', 'EF Savings']
    # 1000 starting balance minus the $20 monthly fee
    assert '$980.00' in page.locator('#efBalanceHistoryChart-sr-table tbody tr').last.text_content()
    assert page.evaluate("() => !!window.app._efBalanceChart") is True


@pytest.mark.feature
def test_balance_history_rerender_replaces_chart(app_page):
    """Re-rendering destroys the previous Chart instance and keeps a single SR table."""
    page = app_page
    _render(page)
    page.evaluate("() => { window.__firstChart = window.app._efBalanceChart; }")
    _render(page)
    assert page.evaluate("() => window.app._efBalanceChart !== window.__firstChart") is True
    assert page.locator('#efBalanceHistoryChart-sr-table').count() == 1


@pytest.mark.feature
def test_balance_history_message_without_linked_account(app_page):
    """Negative: no emergency fund / linked account shows the message and no canvas."""
    page = app_page
    _render(page, linked=False)

    msg = page.locator('#efBalanceHistoryMsg')
    assert msg.is_visible()
    assert msg.text_content() == 'Link an account to see balance history.'
    assert not page.is_visible('#efBalanceHistoryChart')
    assert page.locator('#efBalanceHistoryChart-sr-table').count() == 0
    assert page.evaluate("() => window.app._efBalanceChart") is None


@pytest.mark.feature
def test_balance_history_message_for_fresh_account(app_page):
    """Negative: a linked account with no activity has fewer than 2 points, so no chart."""
    page = app_page
    _render(page, linked=True, with_activity=False)

    msg = page.locator('#efBalanceHistoryMsg')
    assert msg.is_visible()
    assert 'Not enough history yet' in msg.text_content()
    assert not page.is_visible('#efBalanceHistoryChart')
    assert page.locator('#efBalanceHistoryChart-sr-table').count() == 0
