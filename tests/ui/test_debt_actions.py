#!/usr/bin/env python3
"""
Debt Inline Edit Tests
Tests the inline edit/save flow for debt cards.
"""

import pytest

from tests.conftest import seed_state


@pytest.mark.ui
def test_debt_inline_edit_and_save(app_page):
    """Test editing a debt's name, balance, and interest rate inline."""
    page = app_page

    seed_state(page, {
        'accounts': [{'id': 6201, 'name': 'Debt Edit Checking', 'type': 'Checking', 'startingBalance': 1000}],
        'debts': [{
            'id': 95, 'name': 'Visa', 'debtType': 'creditCard',
            'accountBalance': 2000, 'originalBalance': 2000,
            'interestRate': 18, 'minimumPayment': 50, 'dueDate': 15,
            'accountId': 6201, 'category': 'Credit Card',
        }],
    })
    page.evaluate("() => window.app.switchPage('liabilities')")

    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_selector('[data-liabilities-subtab="debts"].active', timeout=5000)

    # The server assigns the id; look the debt up by name.
    debt_id = page.evaluate("() => window.app.debts.find(d => d.name === 'Visa').id")
    edit_btn = page.query_selector(f'[data-debt-action="edit"][data-debt-id="{debt_id}"]')
    assert edit_btn, "Expected an Edit button on the debt card"
    edit_btn.click()

    name_input = page.query_selector(f'#inline-name-{debt_id}')
    balance_input = page.query_selector(f'#inline-balance-{debt_id}')
    interest_input = page.query_selector(f'#inline-interest-{debt_id}')
    assert name_input and balance_input and interest_input, "Inline edit fields should be present"

    page.fill(f'#inline-name-{debt_id}', 'Visa Platinum')
    page.fill(f'#inline-balance-{debt_id}', '1500')
    page.fill(f'#inline-interest-{debt_id}', '12.5')

    save_btn = page.query_selector(f'[data-debt-action="save-inline"][data-debt-id="{debt_id}"]')
    assert save_btn, "Expected a Save button while editing"
    save_btn.click()

    card_text = page.evaluate('() => document.querySelector("#debtsList .debt-name")?.textContent || ""')
    assert 'Visa Platinum' in card_text, "Edited debt name should be reflected in the card"

    detail_text = page.evaluate('() => document.getElementById("debtsList")?.innerText || ""')
    assert '$1,500.00' in detail_text, "Edited balance should be reflected in the card"
    assert '12.50%' in detail_text, "Edited interest rate should be reflected in the card"
