#!/usr/bin/env python3
"""
Balance history tests — debts and Credit Card / Loan accounts.
See docs/superpowers/specs/2026-09-28-balance-history-design.md.
"""
import json
import pytest

from tests.conftest import assert_no_errors, create_debt


def _reload_app(page):
    page.reload(wait_until="networkidle")
    page.wait_for_function("() => window.app && window.app._currentPage === 'health'", timeout=15000)


def _history(page):
    return page.evaluate("() => window.app.balanceHistory")


@pytest.mark.feature
def test_legacy_data_is_seeded_on_load(app_page):
    """Stored data with no balanceHistory gets entries seeded for debts and tracked accounts."""
    page = app_page
    page.evaluate("""() => {
        localStorage.setItem('debtTrackerData', JSON.stringify({
            debts: [
                { id: 1, name: 'Visa', debtType: 'creditCard', accountBalance: 800, minimumPayment: 30,
                  originalBalance: 1000, originalMinimumPayment: 40, debtStartDate: '2026-01-15', updatedAt: '2026-09-01',
                  interestRate: 20, dueDate: 5 },
                { id: 2, name: 'Daycare', debtType: 'fixedAmount', fixedAmount: 900, minimumPayment: 900,
                  fixedStartDate: '2026-01-01', fixedEndDate: '2027-01-01', updatedAt: '2026-09-01' }
            ],
            accounts: [
                { id: 7, name: 'Car Loan', type: 'Loan', startingBalance: -9000, minimumPayment: 210 },
                { id: 8, name: 'Checking', type: 'Checking', startingBalance: 500 }
            ]
        }));
    }""")
    _reload_app(page)
    history = _history(page)
    visa = sorted([h for h in history if h['debtId'] == 1], key=lambda h: h['date'])
    assert [(h['date'], h['balance'], h['minimumPayment']) for h in visa] == [
        ('2026-01-15', 1000, 40), ('2026-09-01', 800, 30)]
    daycare = [h for h in history if h['debtId'] == 2]
    assert len(daycare) == 1 and daycare[0]['balance'] is None and daycare[0]['minimumPayment'] == 900
    loan = [h for h in history if h['accountId'] == 7]
    assert len(loan) == 1 and loan[0]['balance'] == -9000 and loan[0]['minimumPayment'] == 210
    assert not [h for h in history if h['accountId'] == 8]


@pytest.mark.feature
def test_seeding_is_idempotent_and_history_persists(app_page):
    page = app_page
    page.evaluate("""() => {
        localStorage.setItem('debtTrackerData', JSON.stringify({
            debts: [{ id: 1, name: 'Visa', debtType: 'creditCard', accountBalance: 800, minimumPayment: 30, interestRate: 20, dueDate: 5 }]
        }));
    }""")
    _reload_app(page)
    first = _history(page)
    assert len(first) == 1
    _reload_app(page)
    assert _history(page) == first


@pytest.mark.feature
def test_clear_all_data_resets_history(app_page):
    page = app_page
    page.evaluate("""() => {
        window.app.balanceHistory = [{ id: 1, debtId: 1, accountId: null, date: '2026-09-01', balance: 1, minimumPayment: 1 }];
        window.app.saveToStorage();
    }""")
    page.evaluate("() => import('/src/storage.js').then(m => m.clearAllData(window.app))")
    assert _history(page) == []


def _debt_history(page, debt_id):
    return page.evaluate(f"() => window.app.getBalanceHistory({{ kind: 'debt', id: {debt_id} }})")


def _only_debt_id(page):
    return page.evaluate("() => window.app.debts[0].id")


@pytest.mark.feature
def test_adding_debt_records_first_entry(app_page, debt_data):
    page = app_page
    create_debt(page, debt_data)
    debt_id = _only_debt_id(page)
    history = _debt_history(page, debt_id)
    assert len(history) == 1
    assert history[0]['balance'] == 2500 and history[0]['minimumPayment'] == 100


@pytest.mark.feature
def test_update_balance_same_day_updates_and_new_day_inserts(app_page, debt_data):
    page = app_page
    create_debt(page, debt_data)
    debt_id = _only_debt_id(page)

    page.evaluate(f"() => window.app.updateDebtBalance({debt_id}, 2300, 95)")
    history = _debt_history(page, debt_id)
    assert len(history) == 1 and history[0]['balance'] == 2300 and history[0]['minimumPayment'] == 95

    # Backdate the existing entry so the next update lands on a new day.
    page.evaluate("() => { window.app.balanceHistory[0].date = '2026-01-01'; }")
    page.evaluate(f"() => window.app.updateDebtBalance({debt_id}, 2100, 90)")
    history = _debt_history(page, debt_id)
    assert [(h['balance'], h['minimumPayment']) for h in history] == [(2300, 95), (2100, 90)]


@pytest.mark.feature
def test_inline_edit_records_and_unchanged_save_does_not(app_page, debt_data):
    page = app_page
    create_debt(page, debt_data)
    debt_id = _only_debt_id(page)
    page.evaluate("() => { window.app.balanceHistory[0].date = '2026-01-01'; }")

    # Save with no value change -> no new entry.
    page.evaluate(f"() => window.app.startEdit({debt_id})")
    page.evaluate(f"() => window.app.saveInlineEdit({debt_id})")
    assert len(_debt_history(page, debt_id)) == 1

    page.evaluate(f"() => window.app.startEdit({debt_id})")
    page.fill(f'#inline-balance-{debt_id}', '1999')
    page.evaluate(f"() => window.app.saveInlineEdit({debt_id})")
    history = _debt_history(page, debt_id)
    assert len(history) == 2 and history[-1]['balance'] == 1999


@pytest.mark.feature
def test_fixed_amount_change_is_recorded(app_page):
    page = app_page
    page.evaluate("""() => {
        window.app.debts = [{ id: 42, name: 'Daycare', debtType: 'fixedAmount', fixedAmount: 900, minimumPayment: 900,
                              fixedStartDate: '2026-01-01', fixedEndDate: '2027-01-01' }];
        window.app.balanceHistory = [{ id: 1, debtId: 42, accountId: null, date: '2026-01-01', balance: null, minimumPayment: 900 }];
        window.app.updateUI();
    }""")
    page.click('button[data-page="liabilities"]')
    page.evaluate("() => window.app.startEdit(42)")
    page.fill('#inline-fixed-amount-42', '950')
    page.evaluate("() => window.app.saveInlineEdit(42)")
    history = _debt_history(page, 42)
    assert [(h['balance'], h['minimumPayment']) for h in history] == [(None, 900), (None, 950)]


@pytest.mark.feature
def test_original_balance_of_zero_is_preserved(app_page):
    page = app_page
    page.evaluate("""() => {
        window.app.debts = [{ id: 43, name: 'New Card', debtType: 'creditCard', accountBalance: 0, originalBalance: 0,
                              minimumPayment: 0, originalMinimumPayment: 0, interestRate: 20, dueDate: 1 }];
        window.app.updateUI();
    }""")
    page.evaluate("() => window.app.updateDebtBalance(43, 300, 25)")
    assert page.evaluate("() => window.app.debts[0].originalBalance") == 0


@pytest.mark.feature
def test_deleting_debt_removes_its_history(app_page, debt_data):
    page = app_page
    create_debt(page, debt_data)
    debt_id = _only_debt_id(page)
    page.evaluate("""() => {
        window.app.balanceHistory.push({ id: 5, debtId: null, accountId: 777, date: '2026-01-01', balance: 1, minimumPayment: 1 });
    }""")
    page.click(f'[data-debt-action="delete"][data-debt-id="{debt_id}"]')
    # showDeleteConfirmModal is an in-app modal (#deleteConfirmModal), not a native dialog.
    page.click('#deleteConfirmBtn')
    page.wait_for_function(f"() => !window.app.debts.some(d => d.id === {debt_id})")
    history = _history(page)
    assert all(h['debtId'] != debt_id for h in history)
    assert any(h['accountId'] == 777 for h in history)


def _add_account(page, name, acct_type, balance, min_payment=None):
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)
    page.fill('#accountName', name)
    page.select_option('#accountType', label=acct_type)
    page.fill('#accountStartingBalance', balance)
    if min_payment is not None:
        page.fill('#accountMinimumPayment', min_payment)
    page.click('#accountFormSubmit')
    page.wait_for_selector(f'text={name}', timeout=10000)
    return page.evaluate(f"() => window.app.accounts.find(a => a.name === {json.dumps(name)}).id")


def _account_history(page, account_id):
    return page.evaluate(f"() => window.app.getBalanceHistory({{ kind: 'account', id: {account_id} }})")


@pytest.mark.feature
def test_min_payment_field_visibility_follows_type(app_page):
    page = app_page
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)
    group = page.locator('#accountMinimumPaymentGroup')
    page.select_option('#accountType', label='Checking')
    assert group.is_hidden()
    page.select_option('#accountType', label='Credit Card')
    assert group.is_visible()
    page.select_option('#accountType', label='Loan')
    assert group.is_visible()


@pytest.mark.feature
def test_credit_card_account_add_and_edit_record_history(app_page):
    page = app_page
    acct_id = _add_account(page, 'Amex', 'Credit Card', '-1200', '40')
    assert page.evaluate(f"() => window.app.accounts.find(a => a.id === {acct_id}).minimumPayment") == 40
    history = _account_history(page, acct_id)
    assert len(history) == 1 and history[0]['balance'] == -1200 and history[0]['minimumPayment'] == 40

    page.evaluate("() => { window.app.balanceHistory.forEach(h => { h.date = '2026-01-01'; }); }")
    page.click(f'[data-account-action="edit"][data-account-id="{acct_id}"]')
    page.fill(f'#ac-bal-{acct_id}', '-1000')
    page.fill(f'#ac-minpay-{acct_id}', '35')
    page.click(f'[data-account-action="save"][data-account-id="{acct_id}"]')
    page.wait_for_function(f"() => window.app.balanceHistory.filter(h => h.accountId === {acct_id}).length === 2")
    history = _account_history(page, acct_id)
    assert (history[-1]['balance'], history[-1]['minimumPayment']) == (-1000, 35)
    assert page.locator(f'[data-account-action="history"][data-account-id="{acct_id}"]').count() == 1


@pytest.mark.feature
def test_checking_account_records_nothing_and_has_no_history_button(app_page):
    page = app_page
    acct_id = _add_account(page, 'Everyday', 'Checking', '500')
    assert _account_history(page, acct_id) == []
    assert page.locator(f'[data-account-action="history"][data-account-id="{acct_id}"]').count() == 0


@pytest.mark.feature
def test_account_changed_to_credit_card_starts_recording(app_page):
    page = app_page
    acct_id = _add_account(page, 'Switcher', 'Checking', '0')
    page.click(f'[data-account-action="edit"][data-account-id="{acct_id}"]')
    page.select_option(f'#ac-type-{acct_id}', 'Credit Card')
    assert page.locator(f'#ac-minpay-group-{acct_id}').is_visible()
    page.fill(f'#ac-minpay-{acct_id}', '15')
    page.click(f'[data-account-action="save"][data-account-id="{acct_id}"]')
    page.wait_for_function(f"() => window.app.balanceHistory.some(h => h.accountId === {acct_id})")
    assert _account_history(page, acct_id)[0]['minimumPayment'] == 15
    assert page.locator(f'[data-account-action="history"][data-account-id="{acct_id}"]').count() == 1


@pytest.mark.feature
def test_deleting_account_removes_its_history(app_page):
    page = app_page
    acct_id = _add_account(page, 'Old Loan', 'Loan', '-500', '50')
    assert len(_account_history(page, acct_id)) == 1
    page.click(f'[data-account-action="delete"][data-account-id="{acct_id}"]')
    page.click('#deleteConfirmBtn')
    page.wait_for_function(f"() => !window.app.accounts.some(a => a.id === {acct_id})")
    assert _account_history(page, acct_id) == []
