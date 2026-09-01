#!/usr/bin/env python3
"""
Delete Confirm Modal Tests

All destructive delete operations previously used native browser confirm()
dialogs. Chrome can suppress these if the user checked "Prevent this page
from creating additional dialogs", causing silent failures. The themed
#deleteConfirmModal replaces every confirm() call with a Promise-based
modal. These tests verify correct show/hide behaviour, cancellation, and
that confirmation actually performs the delete.
"""

import pytest


@pytest.mark.ui
def test_delete_confirm_modal_exists_in_dom(app_page):
    """The #deleteConfirmModal element is present in the page and starts hidden."""
    page = app_page
    modal = page.query_selector('#deleteConfirmModal')
    assert modal, "#deleteConfirmModal must exist in the DOM"
    classes = modal.get_attribute('class') or ''
    assert 'hidden' in classes, "Modal should start hidden"
    assert 'flex-visible' not in classes


@pytest.mark.ui
def test_delete_debt_shows_themed_modal(app_page):
    """Clicking Delete on a debt card opens the themed #deleteConfirmModal,
    not a native browser dialog."""
    page = app_page

    page.evaluate("""() => {
        window.app.debts = [{
            id: 9001, name: 'Modal Test Debt', accountId: null,
            accountBalance: 500, minimumPayment: 25, interestRate: 15,
            debtType: 'creditCard', dueDate: 1
        }];
        window.app.updateUI();
    }""")

    page.click('button[data-page="liabilities"]')
    page.wait_for_selector('[data-debt-action="delete"]', timeout=5000)

    dialog_triggered = []
    page.once('dialog', lambda d: (dialog_triggered.append(True), d.dismiss()))
    page.click('[data-debt-action="delete"]')
    page.wait_for_timeout(300)

    assert not dialog_triggered, "Native browser dialog should not appear -- use themed modal"

    modal = page.query_selector('#deleteConfirmModal')
    classes = modal.get_attribute('class') or ''
    assert 'flex-visible' in classes, "#deleteConfirmModal should be visible after clicking Delete"
    assert 'hidden' not in classes


@pytest.mark.ui
def test_delete_debt_cancel_keeps_debt(app_page):
    """Clicking Cancel in the themed confirm modal does not delete the debt."""
    page = app_page

    page.evaluate("""() => {
        window.app.debts = [{
            id: 9002, name: 'Stay Alive Debt', accountId: null,
            accountBalance: 300, minimumPayment: 15, interestRate: 10,
            debtType: 'creditCard', dueDate: 1
        }];
        window.app.updateUI();
    }""")

    page.click('button[data-page="liabilities"]')
    page.wait_for_selector('[data-debt-action="delete"]', timeout=5000)
    page.click('[data-debt-action="delete"]')
    page.wait_for_selector('#deleteConfirmModal:not(.hidden)', timeout=5000)

    page.click('#deleteConfirmCancelBtn')
    page.wait_for_timeout(300)

    modal = page.query_selector('#deleteConfirmModal')
    classes = modal.get_attribute('class') or ''
    assert 'hidden' in classes, "Modal should close after Cancel"

    debt_count = page.evaluate("() => window.app.debts.filter(d => d.id === 9002).length")
    assert debt_count == 1, "Debt should NOT be deleted after Cancel"


@pytest.mark.ui
def test_delete_debt_confirm_removes_debt(app_page):
    """Clicking the Confirm button in the modal deletes the debt and closes the modal."""
    page = app_page

    page.evaluate("""() => {
        window.app.debts = [{
            id: 9003, name: 'Goodbye Debt', accountId: null,
            accountBalance: 200, minimumPayment: 10, interestRate: 8,
            debtType: 'creditCard', dueDate: 1
        }];
        window.app.updateUI();
    }""")

    page.click('button[data-page="liabilities"]')
    page.wait_for_selector('[data-debt-action="delete"]', timeout=5000)
    page.click('[data-debt-action="delete"]')
    page.wait_for_selector('#deleteConfirmModal:not(.hidden)', timeout=5000)
    page.click('#deleteConfirmBtn')
    page.wait_for_timeout(500)

    modal = page.query_selector('#deleteConfirmModal')
    classes = modal.get_attribute('class') or ''
    assert 'hidden' in classes, "Modal should close after Confirm"

    debt_count = page.evaluate("() => window.app.debts.filter(d => d.id === 9003).length")
    assert debt_count == 0, "Debt should be deleted after Confirm"


@pytest.mark.ui
def test_delete_confirm_modal_closes_on_escape(app_page):
    """Pressing Escape while the modal is open dismisses it without deleting."""
    page = app_page

    page.evaluate("""() => {
        window.app.debts = [{
            id: 9004, name: 'Escape Safe Debt', accountId: null,
            accountBalance: 100, minimumPayment: 5, interestRate: 5,
            debtType: 'creditCard', dueDate: 1
        }];
        window.app.updateUI();
    }""")

    page.click('button[data-page="liabilities"]')
    page.wait_for_selector('[data-debt-action="delete"]', timeout=5000)
    page.click('[data-debt-action="delete"]')
    page.wait_for_selector('#deleteConfirmModal:not(.hidden)', timeout=5000)

    page.keyboard.press('Escape')
    page.wait_for_timeout(300)

    modal = page.query_selector('#deleteConfirmModal')
    classes = modal.get_attribute('class') or ''
    assert 'hidden' in classes, "Modal should close on Escape"

    debt_count = page.evaluate("() => window.app.debts.filter(d => d.id === 9004).length")
    assert debt_count == 1, "Debt should survive Escape key dismissal"


@pytest.mark.ui
def test_clear_all_data_uses_themed_modal(app_page):
    """Clear All Data on the Strategy page opens the themed modal, not a native dialog."""
    page = app_page

    page.click('button[data-page="strategy"]')
    page.wait_for_selector('#clearDataBtn', timeout=10000)

    dialog_triggered = []
    page.once('dialog', lambda d: (dialog_triggered.append(True), d.dismiss()))
    page.click('#clearDataBtn')
    page.wait_for_timeout(300)

    assert not dialog_triggered, "Clear All Data must use themed modal, not native confirm()"

    modal = page.query_selector('#deleteConfirmModal')
    classes = modal.get_attribute('class') or ''
    assert 'flex-visible' in classes, "#deleteConfirmModal should be visible after Clear All Data click"

    page.click('#deleteConfirmCancelBtn')
    page.wait_for_timeout(200)