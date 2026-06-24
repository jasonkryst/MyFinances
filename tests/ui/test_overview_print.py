#!/usr/bin/env python3
"""
Overview Print Tests
Verifies the Health, Accounts, and Income pages each expose a working Print
button, and that the @media print stylesheet hides their data-entry forms
(and Health's in-app nav links) so only read-only content is printed.
"""

import pytest

from tests.conftest import create_account, assert_no_errors


@pytest.mark.ui
def test_health_print_button_calls_window_print(app_page):
    """The Health page Print button invokes window.print()."""
    page = app_page
    page.click('button[data-page="health"]')
    page.wait_for_timeout(200)

    page.evaluate("() => { window.__printCalled = false; window.print = () => { window.__printCalled = true; }; }")
    page.click('#healthPrintBtn')
    page.wait_for_timeout(100)

    assert page.evaluate('() => window.__printCalled') is True
    assert_no_errors(page)


@pytest.mark.ui
def test_accounts_print_button_calls_window_print(app_page):
    """The Accounts page Print button invokes window.print()."""
    page = app_page
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(200)

    page.evaluate("() => { window.__printCalled = false; window.print = () => { window.__printCalled = true; }; }")
    page.click('#accountsPrintBtn')
    page.wait_for_timeout(100)

    assert page.evaluate('() => window.__printCalled') is True
    assert_no_errors(page)


@pytest.mark.ui
def test_income_print_button_calls_window_print(app_page):
    """The Income page Print button invokes window.print()."""
    page = app_page
    page.click('button[data-page="income"]')
    page.wait_for_timeout(200)

    page.evaluate("() => { window.__printCalled = false; window.print = () => { window.__printCalled = true; }; }")
    page.click('#incomePrintBtn')
    page.wait_for_timeout(100)

    assert page.evaluate('() => window.__printCalled') is True
    assert_no_errors(page)


@pytest.mark.ui
def test_health_print_buttons_have_accessible_labels(app_page):
    """Each Overview print button must expose an accessible label for screen readers."""
    page = app_page

    page.click('button[data-page="health"]')
    page.wait_for_timeout(200)
    assert page.get_attribute('#healthPrintBtn', 'aria-label')

    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(200)
    assert page.get_attribute('#accountsPrintBtn', 'aria-label')

    page.click('button[data-page="income"]')
    page.wait_for_timeout(200)
    assert page.get_attribute('#incomePrintBtn', 'aria-label')


@pytest.mark.ui
def test_accounts_form_card_hidden_when_printing(app_page, account_data):
    """The Accounts data-entry form must be hidden under print media, not just its inputs."""
    page = app_page
    create_account(page, account_data)
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(200)

    page.emulate_media(media="print")
    hidden = page.evaluate(
        "() => getComputedStyle(document.querySelector('.account-form-card')).display === 'none'"
    )
    page.emulate_media(media="screen")

    assert hidden, "Expected .account-form-card to be hidden under @media print"


@pytest.mark.ui
def test_income_form_and_bonus_card_hidden_when_printing(app_page, account_data, income_data):
    """The Income data-entry form and one-time bonus card must be hidden under print media."""
    page = app_page
    create_account(page, account_data)
    page.click('button[data-page="income"]')
    page.wait_for_timeout(200)
    page.fill('#incomeName', income_data["name"])
    page.fill('#incomeAmount', income_data["amount"])
    page.fill('#incomeFirstDate', income_data["first_date"])
    page.select_option('#incomeFrequency', income_data["frequency"])
    page.select_option('#incomeAccount', index=1)
    page.click('#incomeFormSubmit')
    page.wait_for_selector(f'text={income_data["name"]}', timeout=10000)

    page.emulate_media(media="print")
    form_hidden = page.evaluate(
        "() => getComputedStyle(document.querySelector('.income-form-card')).display === 'none'"
    )
    bonus_hidden = page.evaluate(
        "() => getComputedStyle(document.querySelector('.bonus-section')).display === 'none'"
    )
    page.emulate_media(media="screen")

    assert form_hidden, "Expected .income-form-card to be hidden under @media print"
    assert bonus_hidden, "Expected .bonus-section to be hidden under @media print"


@pytest.mark.ui
def test_health_links_hidden_when_printing(app_page):
    """Health's in-app nav links (.health-link) must be hidden under print media."""
    page = app_page
    page.click('button[data-page="health"]')
    page.wait_for_timeout(200)

    page.emulate_media(media="print")
    any_visible = page.evaluate("""
        () => Array.from(document.querySelectorAll('.health-link'))
            .some(el => getComputedStyle(el).display !== 'none')
    """)
    page.emulate_media(media="screen")

    assert not any_visible, "Expected all .health-link elements to be hidden under @media print"
