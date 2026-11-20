#!/usr/bin/env python3
"""
Emergency Fund balance history chart (#307): the linked Savings account's
balance-history entries, month-end (last entry on or before the month end,
carried forward, nothing before the first entry) for the trailing 12 months,
with an accessible data table, and a message instead of the chart when there is
no linked account or fewer than 2 points.

Most tests inject records in memory; the Savings page renders from app.* directly.
The edit test goes through the real UI and server.
"""

import datetime

import pytest

from tests.conftest import seed_state, wait_for_api

RENDER_JS = """async (opts) => {
    const app = window.app;
    const iso = (monthsAgo, day) => {
        const d = new Date(new Date().getFullYear(), new Date().getMonth() - monthsAgo, day);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    app.accounts = [{ id: 9001, name: 'EF Savings', type: 'Savings', startingBalance: 1800 }];
    app.incomes = []; app.bonuses = []; app.expenses = []; app.debts = []; app.bills = [];
    app.recurringTemplates = []; app.sinkingFunds = [];
    app.emergencyFunds = opts.linked
        ? [{ id: 1, accountId: 9001, targetAmount: 5000, currentAmount: 1000, monthlyContribution: 0 }]
        : [];
    app.balanceHistory = (opts.entries || []).map((e, i) => ({
        id: 500 + i, debtId: null, accountId: 9001, date: iso(e.monthsAgo, e.day || 10), balance: e.balance, minimumPayment: 0
    }));
    app.savingsSubTab = 'emergency';
    app.switchPage('savings');
    app.renderSavingsPage();
}"""

HISTORY = [
    {"monthsAgo": 5, "balance": 1000},
    {"monthsAgo": 2, "balance": 1500, "day": 3},
    {"monthsAgo": 2, "balance": 1600, "day": 20},  # last entry of its month wins
    {"monthsAgo": 0, "balance": 1800},
]


def _render(page, linked=True, entries=None):
    page.evaluate(RENDER_JS, {"linked": linked, "entries": entries if entries is not None else HISTORY})
    page.wait_for_selector('#efBalanceHistoryCard', state='attached')


def _sr_rows(page):
    return page.locator('#efBalanceHistoryChart-sr-table tbody tr')


@pytest.mark.feature
def test_balance_history_chart_plots_history_entries(app_page):
    """Positive: month-end values from the history entries, carried forward, 12 rows."""
    page = app_page
    _render(page)

    assert page.is_visible('#efBalanceHistoryChart')
    assert 'hidden' in page.get_attribute('#efBalanceHistoryMsg', 'class')
    rows = _sr_rows(page)
    assert rows.count() == 12
    assert page.locator('#efBalanceHistoryChart-sr-table thead th').all_text_contents() == ['Month', 'EF Savings']
    values = [rows.nth(i).locator('td').nth(1).text_content() for i in range(12)]
    # 12 months ending now: 5 months ago is index 6; nothing before the first entry.
    assert values[:6] == ['—'] * 6
    assert values[6] == '$1,000.00' and values[7] == '$1,000.00' and values[8] == '$1,000.00'
    assert values[9] == '$1,600.00' and values[10] == '$1,600.00'  # two entries in a month: last wins
    assert values[11] == '$1,800.00'
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
def test_balance_history_message_without_history_entries(app_page):
    """Negative: a linked account with no history entries has nothing to plot."""
    page = app_page
    _render(page, entries=[])

    assert page.locator('#efBalanceHistoryMsg').is_visible()
    assert 'Not enough balance history yet' in page.locator('#efBalanceHistoryMsg').text_content()
    assert not page.is_visible('#efBalanceHistoryChart')


@pytest.mark.feature
def test_balance_history_message_for_single_current_month_entry(app_page):
    """Negative: one entry in the current month is a single point, so no chart."""
    page = app_page
    _render(page, entries=[{"monthsAgo": 0, "balance": 1800}])

    assert page.locator('#efBalanceHistoryMsg').is_visible()
    assert not page.is_visible('#efBalanceHistoryChart')
    assert page.locator('#efBalanceHistoryChart-sr-table').count() == 0


@pytest.mark.feature
def test_editing_linked_savings_balance_records_history_and_updates_chart(app_page):
    """Editing the linked Savings account's balance records a new entry; the chart shows it."""
    page = app_page
    three_months_ago = (datetime.date.today().replace(day=1) - datetime.timedelta(days=75)).isoformat()
    seed_state(page, {
        'accounts': [{'id': 1, 'name': 'EF Savings', 'type': 'Savings', 'startingBalance': 1000}],
        'emergencyFunds': [{'id': 1, 'accountId': 1, 'targetAmount': 5000, 'currentAmount': 1000, 'monthlyContribution': 0}],
        'balanceHistory': [{'id': 1, 'debtId': None, 'accountId': 1, 'date': three_months_ago, 'balance': 1000, 'minimumPayment': 0}],
    })
    page.wait_for_function("() => window.app && window.app.accounts.length === 1")
    acct_id = page.evaluate("() => window.app.accounts[0].id")

    page.evaluate("() => window.app.switchPage('accounts')")
    page.click(f'[data-account-action="edit"][data-account-id="{acct_id}"]')
    # The Minimum payment field is for Credit Card / Loan only.
    assert page.locator(f'#ac-minpay-group-{acct_id}').is_hidden()
    page.fill(f'#ac-bal-{acct_id}', '2000')
    page.click(f'[data-account-action="save"][data-account-id="{acct_id}"]')

    wait_for_api(page, '/api/balance-history', lambda rows: len(rows) == 2 and any(r['balance'] == 2000 for r in rows))
    assert page.evaluate(f"() => window.app.balanceHistory.filter(h => h.accountId === {acct_id}).length") == 2

    page.evaluate("() => { window.app.savingsSubTab = 'emergency'; window.app.switchPage('savings'); window.app.renderSavingsPage(); }")
    page.wait_for_selector('#efBalanceHistoryChart', state='visible')
    last = _sr_rows(page).last.locator('td').nth(1).text_content()
    assert last == '$2,000.00'
