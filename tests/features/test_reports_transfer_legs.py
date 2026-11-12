#!/usr/bin/env python3
"""
Recurring transfer legs are neither income nor spending in Reports (issue #566).

A recurring template of type 'transfer' generates a negative leg on the source
account and a positive leg on the target, both type 'recurring' and flagged
isTransferLeg. Reports must skip them, while account balances still move.
"""

from datetime import date

import pytest

from tests.conftest import seed_state


def _tmpl(tid, name, ttype, amount, day, category, account=9001, target=None):
    return {
        'id': tid, 'name': name, 'type': ttype, 'amount': amount, 'frequency': 'monthly',
        'dayOfMonth': day, 'startDate': '2026-01-01', 'endDate': None, 'category': category,
        'accountId': account, 'targetAccountId': target, 'paused': False, 'archived': False,
        'skippedMonths': [], 'paidMonths': [], 'paidAmounts': {},
    }


def _seed(page):
    today = date.today()
    ym = f"{today.year}-{today.month:02d}"
    seed_state(page, {
        'accounts': [
            {'id': 9001, 'name': 'TL Checking', 'type': 'Checking', 'startingBalance': 5000},
            {'id': 9002, 'name': 'TL Savings', 'type': 'Savings', 'startingBalance': 1000},
        ],
        'incomes': [{'id': 9201, 'name': 'Salary', 'amount': 3000, 'accountId': 9001,
                     'frequency': 'monthly', 'firstPayDate': f'{ym}-01'}],
        'recurringTemplates': [
            _tmpl(9101, 'Savings Sweep', 'transfer', 300, 15, 'Savings', target=9002),
            _tmpl(9102, 'Sub Streaming', 'subscription', 50, 10, 'Entertainment'),
            _tmpl(9103, 'Side Gig', 'income', 100, 12, 'Income'),
        ],
    })


_PRELUDE = """
    const app = window.app;
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const led = await import('/src/ledgerTransactions.js');
"""


@pytest.mark.feature
def test_ledger_legs_are_flagged_and_balances_still_move(app_page):
    page = app_page
    _seed(page)
    res = page.evaluate("async () => {" + _PRELUDE + """
        const txs = led.getLedgerTransactionsForMonth(app, y, m);
        const chk = app.accounts.find(a => a.name === 'TL Checking').id;
        const sav = app.accounts.find(a => a.name === 'TL Savings').id;
        const acctName = id => app.accounts.find(a => a.id === id).name;
        return {
            legs: txs.filter(t => t.name === 'Savings Sweep').map(t => [t.account, t.amount, t.isTransferLeg]),
            sub: txs.filter(t => t.name === 'Sub Streaming').map(t => t.isTransferLeg),
            chk: app.computeAccountBalance(chk, y, m),
            sav: app.computeAccountBalance(sav, y, m),
        };
    }""")
    assert sorted(res['legs']) == [['TL Checking', -300, True], ['TL Savings', 300, True]]
    assert res['sub'] == [False]
    # Checking: 5000 + 3000 salary + 100 side gig - 50 sub - 300 sweep; savings: 1000 + 300
    assert res['chk'] == pytest.approx(7750)
    assert res['sav'] == pytest.approx(1300)


@pytest.mark.feature
def test_reports_totals_exclude_transfer(app_page):
    page = app_page
    _seed(page)
    res = page.evaluate("async () => {" + _PRELUDE + """
        const cf = (await import('/src/reportsCashFlow.js')).computeMonthCashFlowTotals(app, y, m);
        const sm = (await import('/src/reportsSummary.js')).computeReportsSummaryMetrics(app, 'month', new Date(y, m, 1)).cashFlow;
        const vr = (await import('/src/reportsVariance.js'))._classifyMonthTotals(led.getLedgerTransactionsForMonth(app, y, m));
        return { cf, sm, vr };
    }""")
    # 3000 salary + 100 side gig; the only recurring cost is the $50 subscription.
    for key in ('cf', 'sm', 'vr'):
        assert res[key]['income'] == pytest.approx(3100), key
        assert res[key]['recurring'] == pytest.approx(50), key


@pytest.mark.feature
def test_reports_income_equals_health_cash_flow_income_plus_interest(app_page):
    page = app_page
    _seed(page)
    res = page.evaluate("async () => {" + _PRELUDE + """
        const utils = await import('/src/utils.js');
        const rec = await import('/src/recurring.js');
        const cf = (await import('/src/reportsCashFlow.js')).computeMonthCashFlowTotals(app, y, m);
        const health = utils.computeMonthlyIncomeForMonth(app.incomes, app.bonuses, y, m).monthlyTotal + rec.computeRecurringCashFlowForMonth(app, y, m).inflow;
        const interest = led.getLedgerTransactionsForMonth(app, y, m)
            .filter(t => t.type === 'interest').reduce((s, t) => s + t.amount, 0);
        return { reports: cf.income, health, interest };
    }""")
    assert res['health'] == pytest.approx(3100)
    assert res['reports'] == pytest.approx(res['health'] + res['interest'])


@pytest.mark.feature
def test_spending_and_budgets_exclude_transfer_but_keep_subscription(app_page):
    page = app_page
    _seed(page)
    res = page.evaluate("async () => {" + _PRELUDE + """
        const cats = (await import('/src/spending.js')).computeSpendingByCategory(app, y, m);
        const budget = (await import('/src/categoryBudgets.js')).computeDerivedBudgetByCategory(app, y, m);
        return { cats: cats.map(c => [c.category, c.total]), budget: Object.fromEntries(budget) };
    }""")
    names = [c[0] for c in res['cats']]
    assert 'Savings' not in names and 'Transfer' not in names
    assert 'Entertainment' in names
    assert dict(res['cats'])['Entertainment'] == pytest.approx(50)
    assert 'Savings' not in res['budget'] and 'Transfer' not in res['budget']
    assert res['budget'].get('Entertainment') == pytest.approx(50)


@pytest.mark.feature
def test_sankey_has_no_node_for_transfer_template(app_page):
    page = app_page
    _seed(page)
    data = page.evaluate("async () => {" + _PRELUDE + """
        return (await import('/src/reportsMoneyFlowSankey.js')).computeMoneyFlowSankeyData(app, y, m);
    }""")
    labels = [n['label'] for n in data['nodes']]
    assert 'Savings Sweep' not in labels
    assert not any('Savings' in l or 'Transfer' in l for l in labels)
    # Negative control: the real income sources and the subscription's category stay.
    assert 'Salary' in labels and 'Side Gig' in labels
    assert any('Entertainment' in l for l in labels)


@pytest.mark.feature
def test_spending_tab_renders_subscription_without_transfer(app_page):
    page = app_page
    _seed(page)
    page.evaluate("async () => { window.app.switchPage('reports'); await window.app.renderReportsPage(); }")
    page.click('[data-rptab="spending"]')
    page.wait_for_selector('#rptPanel-spending.rpt-tab-panel--active', timeout=5000)
    page.wait_for_function(
        "() => (document.querySelector('#reportsSpending')?.textContent || '').includes('Entertainment')",
        timeout=10000)
    text = page.inner_text('#reportsSpending')
    assert 'Savings' not in text and 'Transfer' not in text
