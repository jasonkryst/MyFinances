#!/usr/bin/env python3
"""
Interest Income end-to-end workflow (Issue #30):
create an interest-bearing account through the UI, then verify the
auto-generated deposit flows to the Ledger, Reports income, and the
account's projected balance.
"""

import pytest


@pytest.mark.integration
def test_interest_income_end_to_end(app_page):
    page = app_page

    # 1. Create the account through the real form
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'HY Savings')
    page.select_option('#accountType', label='Savings')
    page.fill('#accountStartingBalance', '1000')
    page.fill('#accountInterestRate', '12')
    page.click('#accountFormSubmit')
    page.wait_for_selector('text=HY Savings', timeout=10000)

    # 2. Accounts page: projected balance includes the $10 deposit
    acct_id = page.evaluate("() => window.app.accounts.find(a => a.name === 'HY Savings').id")
    projected = page.evaluate(f"() => window.app.computeAccountBalance({acct_id})")
    assert abs(projected - 1010.00) < 0.001, f"Projected balance missing interest: {projected}"

    # 3. Ledger page: an 'Interest' row exists
    page.evaluate("() => window.app.switchPage('ledger')")
    page.wait_for_selector('.ledger-table')
    page.select_option('#ledgerDateRange', 'all')
    page.wait_for_selector('text=Interest', timeout=10000)
    assert page.query_selector('.ledger-table >> text=Interest'), \
        "Interest transaction not visible in the Ledger"

    # 4. Reports page: income stat includes the interest
    page.evaluate("() => window.app.switchPage('reports')")
    page.wait_for_timeout(300)
    income_text = page.evaluate("""() => {
        const strip = document.querySelector('#reportsIncomeExp');
        if (!strip) return '';
        const card = strip.querySelector('.rpt-stat--income');
        return card ? card.textContent : '';
    }""")
    assert '10.00' in income_text, f"Reports income missing interest: {income_text}"

    # 5. Survives reload
    page.reload(wait_until="networkidle")
    rate = page.evaluate("() => window.app.accounts.find(a => a.name === 'HY Savings').interestRate")
    assert rate == 12
