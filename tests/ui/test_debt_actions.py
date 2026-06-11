#!/usr/bin/env python3
"""
Debt Inline Edit Tests
Tests the inline edit/save flow for debt cards.
"""

import pytest


@pytest.mark.ui
def test_debt_inline_edit_and_save(app_page):
    """Test editing a debt's name, balance, and interest rate inline."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 6201, name: 'Debt Edit Checking', type: 'Checking', startingBalance: 1000 }];
        app.debts = [{
            id: 95, name: 'Visa', debtType: 'creditCard',
            accountBalance: 2000, originalBalance: 2000,
            interestRate: 18, minimumPayment: 50, dueDate: 15,
            accountId: 6201, category: 'Credit Card'
        }];
        app.incomes = []; app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('liabilities');
    }""")
    page.wait_for_timeout(300)

    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)

    edit_btn = page.query_selector('[data-debt-action="edit"][data-debt-id="95"]')
    assert edit_btn, "Expected an Edit button on the debt card"
    edit_btn.click()
    page.wait_for_timeout(300)

    name_input = page.query_selector('#inline-name-95')
    balance_input = page.query_selector('#inline-balance-95')
    interest_input = page.query_selector('#inline-interest-95')
    assert name_input and balance_input and interest_input, "Inline edit fields should be present"

    page.fill('#inline-name-95', 'Visa Platinum')
    page.fill('#inline-balance-95', '1500')
    page.fill('#inline-interest-95', '12.5')

    save_btn = page.query_selector('[data-debt-action="save-inline"][data-debt-id="95"]')
    assert save_btn, "Expected a Save button while editing"
    save_btn.click()
    page.wait_for_timeout(300)

    card_text = page.evaluate('() => document.querySelector("#debtsList .debt-name")?.textContent || ""')
    assert 'Visa Platinum' in card_text, "Edited debt name should be reflected in the card"

    detail_text = page.evaluate('() => document.getElementById("debtsList")?.innerText || ""')
    assert '$1,500.00' in detail_text, "Edited balance should be reflected in the card"
    assert '12.50%' in detail_text, "Edited interest rate should be reflected in the card"
