#!/usr/bin/env python3
"""
Health and Reports label which income they show (issue #572).

Health's Cash Flow card shows PLANNED income (salary and bonuses after
withholding, plus recurring inflows). Reports (Summary and Income vs Expenses)
shows ACTUAL Ledger income, which also holds interest earned, one-off
transactions and Ledger overrides. The numbers are unchanged; both are labelled
and Reports carries a help line explaining why they can differ.
"""

from datetime import date

import pytest

from tests.conftest import seed_state

TODAY = date.today()
FIRST = TODAY.replace(day=1).isoformat()


def _seed(page, manual_inflow=None):
    state = {
        'version': '3.0',
        'accounts': [{'id': 1, 'name': 'Label Checking', 'type': 'Checking', 'startingBalance': 1000}],
        'incomes': [{'id': 1, 'name': 'Label Salary', 'amount': 3000, 'frequency': 'monthly',
                     'firstPayDate': FIRST, 'accountId': 1}],
    }
    if manual_inflow:
        state['manualTransactions'] = [{
            'id': 1, 'accountId': 1, 'date': FIRST, 'amount': manual_inflow,
            'name': 'Sold a bike', 'category': 'Income', 'memo': '',
        }]
    seed_state(page, state)


def _health_income(page):
    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)
    page.wait_for_selector('#healthSection .health-cashflow-row', timeout=5000)
    return page.evaluate("""() => {
        const rows = [...document.querySelectorAll('#healthSection .health-cashflow-row')];
        const row = rows.find(r => r.querySelector('.health-cf-income'));
        return {
            label: row.children[0].textContent.trim(),
            value: row.querySelector('.health-cf-income').textContent.trim(),
            note: (document.querySelector('#healthSection .health-planned-note') || {}).textContent || '',
        };
    }""")


def _open_report(page, tab):
    page.click('button[data-page="reports"]')
    page.wait_for_selector('#reportsSection.active', timeout=5000)
    page.click(f'[data-rptab="{tab}"]')
    page.wait_for_selector(f'#rptPanel-{tab}.rpt-tab-panel--active', timeout=5000)


def _summary_income_row(page):
    _open_report(page, 'summary')
    page.wait_for_selector('#rptSummaryIncomeHelp', timeout=5000)
    return page.evaluate("""() => {
        const row = document.querySelector('#reportsSummary table tbody tr');
        return {
            label: row.children[0].textContent.trim(),
            value: row.children[1].textContent.trim(),
            help: document.getElementById('rptSummaryIncomeHelp').textContent,
        };
    }""")


@pytest.mark.feature
def test_health_says_planned_and_reports_says_actual_with_help(app_page):
    """Positive: with a one-off inflow, Health stays at the planned $3,000 and is
    labelled planned; Reports shows $3,040 labelled as including interest and
    one-off transactions, with a help line saying why they differ."""
    page = app_page
    _seed(page, manual_inflow=40)

    health = _health_income(page)
    assert health['label'] == 'Income (planned)'
    assert '3,000' in health['value']
    assert 'planned' in health['note'].lower() and 'Ledger' in health['note']

    summary = _summary_income_row(page)
    assert summary['label'] == 'Income (incl. interest & one-off)'
    assert '3,040' in summary['value']
    assert 'interest' in summary['help'] and 'planned income' in summary['help']

    _open_report(page, 'incomeexp')
    page.wait_for_selector('#rptIncomeExpHelp', timeout=5000)
    # .rpt-stat-label is text-transform: uppercase, which inner_text() reflects.
    label = page.locator('#reportsIncomeExp .rpt-stat--income .rpt-stat-label').first.text_content()
    assert 'incl. interest & one-off' in label.lower()
    assert 'planned income' in page.locator('#rptIncomeExpHelp').inner_text()


@pytest.mark.feature
def test_numbers_unchanged_without_interest_or_one_off(app_page):
    """Negative: with only salary, both pages still show their labels and the
    two figures are equal and unchanged ($3,000.00), so no math moved."""
    page = app_page
    _seed(page)

    health = _health_income(page)
    assert health['label'] == 'Income (planned)'
    assert health['value'] == '$3,000.00'

    summary = _summary_income_row(page)
    assert summary['label'] == 'Income (incl. interest & one-off)'
    assert summary['value'] == '$3,000.00'
    assert summary['help']
