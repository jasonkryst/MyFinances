#!/usr/bin/env python3
"""
Money Flow Sankey diagram tests (GitHub issue #79).

computeMoneyFlowSankeyData(app, year, month) groups a month's ledger
transactions into Sankey nodes/links: income sources -> a single "Account"
hub -> outflow categories (bills/expenses/recurring by category, debts/
savings by name). These tests exercise the data layer directly via
window.app.computeMoneyFlowSankeyData before any DOM rendering exists
(Task 1). DOM-level rendering tests are in the same file, added by Task 2.
"""

import pytest


def _find_node(nodes, label):
    return next((n for n in nodes if n['label'] == label), None)


def _link_amount(data, source_label, target_label):
    source_id = next((n['id'] for n in data['nodes'] if n['label'] == source_label), None)
    target_id = next((n['id'] for n in data['nodes'] if n['label'] == target_label), None)
    link = next((l for l in data['links']
                 if l['sourceId'] == source_id and l['targetId'] == target_id), None)
    return link['amount'] if link else None


@pytest.mark.feature
def test_money_flow_sankey_data_groups_by_category(app_page):
    """Income groups by source name; bills/expenses group by category;
    debts/savings group by name. Each leaf node gets exactly one link
    to/from the single Account hub, and income > outflow produces a
    Surplus node/link for the difference."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        app.incomes = [
            { id: 1, name: 'Salary', amount: 3000, accountId: 1, frequency: 'monthly', firstPayDate: `${y}-${m}-01` },
            { id: 2, name: 'Freelance', amount: 500, accountId: 1, frequency: 'monthly', firstPayDate: `${y}-${m}-15` }
        ];
        app.bills = [{ id: 1, name: 'Rent', amount: 1200, dueDay: 1, accountId: 1, category: 'Housing' }];
        app.expenses = [{ id: 1, name: 'Groceries', budgetAmount: 300, date: `${y}-${m}-05`, accountId: 1, category: 'Food' }];
        app.debts = [{ id: 1, name: 'Credit Card', minimumPayment: 100, dueDate: 10, accountId: 1 }];
        app.recurringTemplates = [];
        app.emergencyFunds = [];
        app.sinkingFunds = [{ id: 1, name: 'Vacation Fund', accountId: 1, autoContribute: true, monthlyAllocation: 150, currentAmount: 0, targetAmount: 5000 }];
        app.monthlySnapshots = [];
        app._reportMonthOffset = 0;
        window.__y = y; window.__m = now.getMonth();
    }""")

    data = page.evaluate("() => window.app.computeMoneyFlowSankeyData(window.__y, window.__m)")

    assert data['hasData'] is True

    account = next(n for n in data['nodes'] if n['column'] == 1)
    assert account['label'] == 'Account'
    assert round(account['amount'], 2) == 3500.0

    salary = _find_node(data['nodes'], 'Salary')
    freelance = _find_node(data['nodes'], 'Freelance')
    assert salary and round(salary['amount'], 2) == 3000.0
    assert freelance and round(freelance['amount'], 2) == 500.0

    housing = _find_node(data['nodes'], '🧾 Housing')
    food = _find_node(data['nodes'], '💸 Food')
    debt = _find_node(data['nodes'], '💳 Credit Card')
    savings = _find_node(data['nodes'], '💰 Vacation Fund')
    assert housing and round(housing['amount'], 2) == 1200.0
    assert food and round(food['amount'], 2) == 300.0
    assert debt and round(debt['amount'], 2) == 100.0
    assert savings and round(savings['amount'], 2) == 150.0

    surplus = _find_node(data['nodes'], 'Surplus')
    assert surplus and round(surplus['amount'], 2) == 1750.0
    assert _find_node(data['nodes'], 'Shortfall') is None

    assert round(_link_amount(data, 'Salary', 'Account'), 2) == 3000.0
    assert round(_link_amount(data, 'Account', '🧾 Housing'), 2) == 1200.0
    assert round(_link_amount(data, 'Account', 'Surplus'), 2) == 1750.0


@pytest.mark.feature
def test_money_flow_sankey_data_shortfall_when_outflow_exceeds_income(app_page):
    """When outflow > income, a Shortfall node/link (Shortfall -> Account)
    covers the gap instead of a Surplus node."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        app.incomes = [{ id: 1, name: 'Salary', amount: 1000, accountId: 1, frequency: 'monthly', firstPayDate: `${y}-${m}-01` }];
        app.bills = [{ id: 1, name: 'Rent', amount: 1500, dueDay: 1, accountId: 1, category: 'Housing' }];
        app.expenses = []; app.debts = []; app.recurringTemplates = [];
        app.emergencyFunds = []; app.sinkingFunds = []; app.monthlySnapshots = [];
        app._reportMonthOffset = 0;
        window.__y = y; window.__m = now.getMonth();
    }""")

    data = page.evaluate("() => window.app.computeMoneyFlowSankeyData(window.__y, window.__m)")

    assert data['hasData'] is True
    shortfall = _find_node(data['nodes'], 'Shortfall')
    assert shortfall and round(shortfall['amount'], 2) == 500.0
    assert _find_node(data['nodes'], 'Surplus') is None
    assert round(_link_amount(data, 'Shortfall', 'Account'), 2) == 500.0

    account = next(n for n in data['nodes'] if n['column'] == 1)
    assert round(account['amount'], 2) == 1500.0


@pytest.mark.feature
def test_money_flow_sankey_data_balanced_month_has_no_extra_node(app_page):
    """When income exactly equals outflow, no Surplus/Shortfall node or
    link is added."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        app.incomes = [{ id: 1, name: 'Salary', amount: 1000, accountId: 1, frequency: 'monthly', firstPayDate: `${y}-${m}-01` }];
        app.bills = [{ id: 1, name: 'Rent', amount: 1000, dueDay: 1, accountId: 1, category: 'Housing' }];
        app.expenses = []; app.debts = []; app.recurringTemplates = [];
        app.emergencyFunds = []; app.sinkingFunds = []; app.monthlySnapshots = [];
        app._reportMonthOffset = 0;
        window.__y = y; window.__m = now.getMonth();
    }""")

    data = page.evaluate("() => window.app.computeMoneyFlowSankeyData(window.__y, window.__m)")

    assert data['hasData'] is True
    assert _find_node(data['nodes'], 'Surplus') is None
    assert _find_node(data['nodes'], 'Shortfall') is None
    assert len(data['links']) == 2  # Salary->Account, Account->Housing only


@pytest.mark.feature
def test_money_flow_sankey_data_empty_state(app_page):
    """With no income/expense/bill/debt/recurring data at all, hasData is
    false."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        app.accounts = []; app.debts = []; app.bills = []; app.expenses = [];
        app.incomes = []; app.recurringTemplates = []; app.emergencyFunds = [];
        app.sinkingFunds = []; app.monthlySnapshots = [];
        app._reportMonthOffset = 0;
        window.__y = now.getFullYear(); window.__m = now.getMonth();
    }""")

    data = page.evaluate("() => window.app.computeMoneyFlowSankeyData(window.__y, window.__m)")
    assert data['hasData'] is False
