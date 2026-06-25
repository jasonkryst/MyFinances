#!/usr/bin/env python3
"""
Remaining Pages Print Tests
Verifies the Liabilities, Recurring, Strategy (Plan), Savings, Ledger, and
Reconcile pages each expose a working Print button, and that the
@media print stylesheet hides their data-entry forms/controls so only
read-only content is printed.
"""

import pytest

from tests.conftest import create_account, assert_no_errors

PAGES = [
    ("liabilities", "liabilitiesPrintBtn"),
    ("recurring", "recurringPrintBtn"),
    ("strategy", "strategyPrintBtn"),
    ("savings", "savingsPrintBtn"),
    ("ledger", "ledgerPrintBtn"),
    ("reconcile", "reconcilePrintBtn"),
]


@pytest.mark.ui
@pytest.mark.parametrize("page_name,btn_id", PAGES)
def test_print_button_calls_window_print(app_page, page_name, btn_id):
    """Each remaining page's Print button invokes window.print()."""
    page = app_page
    page.click(f'button[data-page="{page_name}"]')
    page.wait_for_timeout(200)

    page.evaluate("() => { window.__printCalled = false; window.print = () => { window.__printCalled = true; }; }")
    page.click(f'#{btn_id}')
    page.wait_for_timeout(100)

    assert page.evaluate('() => window.__printCalled') is True
    assert_no_errors(page)


@pytest.mark.ui
@pytest.mark.parametrize("page_name,btn_id", PAGES)
def test_print_button_has_accessible_label(app_page, page_name, btn_id):
    """Each remaining page's Print button must expose an accessible label."""
    page = app_page
    page.click(f'button[data-page="{page_name}"]')
    page.wait_for_timeout(200)

    assert page.get_attribute(f'#{btn_id}', 'aria-label')


@pytest.mark.ui
def test_liabilities_form_cards_hidden_when_printing(app_page):
    """The Debts and Budget add-forms must be hidden under print media."""
    page = app_page
    page.click('button[data-page="liabilities"]')
    page.wait_for_timeout(200)

    page.emulate_media(media="print")
    debts_hidden = page.evaluate(
        "() => getComputedStyle(document.querySelector('.debts-form-card')).display === 'none'"
    )
    page.emulate_media(media="screen")

    page.click('[data-liabilities-subtab="expenses"]')

    page.emulate_media(media="print")
    budget_hidden = page.evaluate(
        "() => getComputedStyle(document.querySelector('.budget-form-card')).display === 'none'"
    )
    page.emulate_media(media="screen")

    assert debts_hidden, "Expected .debts-form-card to be hidden under @media print"
    assert budget_hidden, "Expected .budget-form-card to be hidden under @media print"


@pytest.mark.ui
def test_recurring_form_card_hidden_when_printing(app_page):
    """The Recurring add-form must be hidden under print media."""
    page = app_page
    page.click('button[data-page="recurring"]')
    page.wait_for_timeout(200)

    page.emulate_media(media="print")
    hidden = page.evaluate(
        "() => getComputedStyle(document.querySelector('.recurring-form-card')).display === 'none'"
    )
    page.emulate_media(media="screen")

    assert hidden, "Expected .recurring-form-card to be hidden under @media print"


@pytest.mark.ui
def test_strategy_controls_hidden_when_printing(app_page):
    """The Strategy controls and target-date panel must be hidden under print media."""
    page = app_page
    page.click('button[data-page="strategy"]')
    page.wait_for_timeout(200)

    page.emulate_media(media="print")
    controls_hidden = page.evaluate(
        "() => getComputedStyle(document.querySelector('.strategy-controls')).display === 'none'"
    )
    target_hidden = page.evaluate(
        "() => getComputedStyle(document.querySelector('.target-date-panel')).display === 'none'"
    )
    page.emulate_media(media="screen")

    assert controls_hidden, "Expected .strategy-controls to be hidden under @media print"
    assert target_hidden, "Expected .target-date-panel to be hidden under @media print"


@pytest.mark.ui
def test_savings_emergency_form_card_hidden_when_printing(app_page):
    """The Savings Emergency Fund add-form must be hidden under print media."""
    page = app_page
    page.click('button[data-page="savings"]')
    page.wait_for_timeout(200)

    page.emulate_media(media="print")
    hidden = page.evaluate(
        "() => getComputedStyle(document.querySelector('.emergency-form-card')).display === 'none'"
    )
    page.emulate_media(media="screen")

    assert hidden, "Expected .emergency-form-card to be hidden under @media print"


@pytest.mark.ui
def test_reconcile_form_grid_hidden_when_printing(app_page, account_data):
    """The per-account reconcile inputs must be hidden under print media."""
    page = app_page
    create_account(page, account_data)
    page.click('button[data-page="reconcile"]')
    page.wait_for_timeout(200)

    page.emulate_media(media="print")
    hidden = page.evaluate(
        "() => getComputedStyle(document.querySelector('.recon-form-grid')).display === 'none'"
    )
    page.emulate_media(media="screen")

    assert hidden, "Expected .recon-form-grid to be hidden under @media print"
