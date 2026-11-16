"""Undo for deletes and archives (issue #577).

Undo of a delete re-creates the record (new server id) and must carry its
Ledger overrides, Cleared flags and (for a debt) balance history over to the
new id. Undo of an archive flips it back.
"""
import pytest

from tests.conftest import BASE_URL, ensure_session, reset_server_state, seed_state, wait_for_api, wait_for_app_ready

pytestmark = pytest.mark.feature

KEY_DATE = '2026-11-15'

STATE = {
    'accounts': [{'id': 10, 'name': 'Checking', 'type': 'Checking', 'startingBalance': 1000}],
    'debts': [
        {'id': 1, 'name': 'Visa', 'debtType': 'creditCard', 'accountBalance': 900, 'interestRate': 20,
         'minimumPayment': 40, 'dueDate': 15, 'accountId': 10},
        {'id': 2, 'name': 'Store Card', 'debtType': 'creditCard', 'accountBalance': 300, 'interestRate': 25,
         'minimumPayment': 20, 'dueDate': 20, 'accountId': 10},
    ],
    'balanceHistory': [
        {'id': 1, 'debtId': 1, 'date': '2026-10-01', 'balance': 1000, 'minimumPayment': 40},
        {'id': 2, 'debtId': 1, 'date': '2026-11-01', 'balance': 900, 'minimumPayment': 40},
    ],
    'incomes': [{'id': 1, 'name': 'Salary', 'amount': 3000, 'frequency': 'monthly', 'firstPayDate': '2026-01-01', 'accountId': 10}],
    'bonuses': [{'id': 1, 'name': 'Year-end', 'amount': 2000, 'date': '2026-12-15', 'accountId': 10}],
    'recurringTemplates': [{'id': 1, 'name': 'Netflix', 'type': 'subscription', 'amount': 15, 'frequency': 'monthly',
                            'dayOfMonth': 5, 'accountId': 10}],
    'ledgerClearedTransactions': {
        f'debt|1|10|{KEY_DATE}': {'clearedAt': '2026-11-15T10:00:00.000Z'},
        'recurring|1|10|2026-11-05': {'clearedAt': '2026-11-05T10:00:00.000Z'},
    },
    'ledgerAmountOverrides': {f'debt|1|10|{KEY_DATE}': {'amount': -55, 'originalAmount': -40}},
}


def _get(page, path):
    return page.evaluate("async (p) => (await fetch(p)).json()", path)


def _seed(page):
    seed_state(page, STATE)
    wait_for_app_ready(page)


def _go(page, name, section):
    page.click(f'button[data-page="{name}"]')
    page.wait_for_selector(f'#{section}.active')


def _toast_visible(page):
    page.wait_for_selector('#undoToast:not(.hidden)')


def _ids(page, collection, name):
    return page.evaluate("([c, n]) => window.app[c].filter(r => r.name === n).map(r => r.id)", [collection, name])


def _delete_visa(page):
    _go(page, 'liabilities', 'liabilitiesSection')
    old_id = _ids(page, 'debts', 'Visa')[0]
    page.click(f'[data-debt-action="delete"][data-debt-id="{old_id}"]')
    page.click('#deleteConfirmBtn')
    _toast_visible(page)
    wait_for_api(page, '/api/debts', lambda rows: not any(r['name'] == 'Visa' for r in rows))
    return old_id


def test_undo_debt_delete_restores_record_ledger_keys_and_history(app_page):
    page = app_page
    _seed(page)
    acct = page.evaluate("window.app.accounts[0].id")
    # Seeding creates the debts concurrently, so Visa is not always first;
    # Undo must put it back wherever it was.
    old_index = page.evaluate("window.app.debts.findIndex(d => d.name === 'Visa')")
    assert old_index in (0, 1)
    old_id = _delete_visa(page)
    assert 'Visa' in page.text_content('#undoToastMessage')
    assert page.evaluate("document.activeElement.id") == 'undoToastBtn', 'focus moves to Undo when the deleted button is gone'

    page.click('#undoToastBtn')
    page.wait_for_selector('#undoToast', state='hidden')
    page.wait_for_function("() => document.getElementById('undoToastAnnounce').textContent === 'Restored.'")

    debts = wait_for_api(page, '/api/debts', lambda rows: any(r['name'] == 'Visa' for r in rows))
    new = next(r for r in debts if r['name'] == 'Visa')
    assert new['id'] != old_id
    assert new['minimumPayment'] == 40 and new['accountBalance'] == 900
    # The server can hold the row before the page has handled the POST reply
    # and moved the record back into place, so wait for the local list.
    page.wait_for_function("([id, i]) => window.app.debts[i] && window.app.debts[i].id === id",
                           arg=[new['id'], old_index], timeout=5000)
    assert page.evaluate("window.app.debts.length") == 2, 'restored once, at its old place in the list'

    old_key = f'debt|{old_id}|{acct}|{KEY_DATE}'
    new_key = f'debt|{new["id"]}|{acct}|{KEY_DATE}'
    cleared = wait_for_api(page, '/api/ledger-cleared', lambda rows: any(r['clearedKey'] == new_key for r in rows))
    assert not any(r['clearedKey'] == old_key for r in cleared)
    overrides = wait_for_api(page, '/api/ledger-overrides', lambda rows: any(r['overrideKey'] == new_key for r in rows))
    assert next(r for r in overrides if r['overrideKey'] == new_key)['amount'] == -55
    assert not any(r['overrideKey'] == old_key for r in overrides)

    history = wait_for_api(page, '/api/balance-history',
                           lambda rows: len([r for r in rows if r.get('debtId') == new['id']]) == 2)
    assert sorted(r['date'] for r in history if r.get('debtId') == new['id']) == ['2026-10-01', '2026-11-01']

    # Survives a reload with the Ledger state attached to the new id.
    page.reload()
    assert page.evaluate(f"!!window.app.ledgerClearedTransactions['{new_key}']")
    assert page.evaluate(f"window.app.ledgerAmountOverrides['{new_key}'].amount") == -55


def test_undo_income_delete_with_ctrl_z(app_page):
    page = app_page
    _seed(page)
    _go(page, 'income', 'incomeSection')
    page.click('[data-income-action="delete"]')
    _toast_visible(page)
    assert 'Salary' in page.text_content('#undoToastMessage')
    wait_for_api(page, '/api/incomes', lambda rows: rows == [])
    page.keyboard.press('Control+z')
    wait_for_api(page, '/api/incomes', lambda rows: [r['name'] for r in rows] == ['Salary'])
    page.wait_for_selector('#incomeList >> text=Salary')


def test_ctrl_z_is_ignored_while_typing_in_a_field(app_page):
    page = app_page
    _seed(page)
    _go(page, 'income', 'incomeSection')
    page.click('[data-bonus-action="delete"]')
    _toast_visible(page)
    page.click('#incomeName')
    page.keyboard.press('Control+z')
    page.wait_for_timeout(500)
    assert page.is_visible('#undoToast')
    assert _get(page, '/api/bonuses') == []
    page.click('#undoToastBtn')
    wait_for_api(page, '/api/bonuses', lambda rows: [r['name'] for r in rows] == ['Year-end'])


def test_undo_recurring_delete_moves_its_cleared_key(app_page):
    page = app_page
    _seed(page)
    acct = page.evaluate("window.app.accounts[0].id")
    _go(page, 'recurring', 'recurringSection')
    old_id = _ids(page, 'recurringTemplates', 'Netflix')[0]
    page.click(f'[data-recurring-action="delete"][data-recurring-id="{old_id}"]')
    page.click('#deleteConfirmBtn')
    _toast_visible(page)
    wait_for_api(page, '/api/recurring-templates', lambda rows: rows == [])
    page.click('#undoToastBtn')
    rows = wait_for_api(page, '/api/recurring-templates', lambda rows: len(rows) == 1)
    new_id = rows[0]['id']
    assert rows[0]['name'] == 'Netflix' and rows[0]['amount'] == 15
    wait_for_api(page, '/api/ledger-cleared',
                 lambda r: any(x['clearedKey'] == f'recurring|{new_id}|{acct}|2026-11-05' for x in r)
                 and not any(x['clearedKey'] == f'recurring|{old_id}|{acct}|2026-11-05' for x in r))


def test_dismiss_keeps_the_delete_and_returns_focus_to_the_page(app_page):
    page = app_page
    _seed(page)
    _go(page, 'income', 'incomeSection')
    page.click('[data-income-action="delete"]')
    _toast_visible(page)
    page.click('#undoToastClose')
    page.wait_for_selector('#undoToast', state='hidden')
    assert page.evaluate("document.activeElement.id") != 'undoToastClose'
    wait_for_api(page, '/api/incomes', lambda rows: rows == [])
    page.keyboard.press('Control+z')  # nothing pending any more
    page.wait_for_timeout(500)
    assert _get(page, '/api/incomes') == []


def test_a_new_delete_replaces_the_previous_undo(app_page):
    page = app_page
    _seed(page)
    _go(page, 'income', 'incomeSection')
    page.click('[data-income-action="delete"]')
    _toast_visible(page)
    page.click('[data-bonus-action="delete"]')
    page.wait_for_function("() => document.getElementById('undoToastMessage').textContent.includes('Year-end')")
    page.click('#undoToastBtn')
    wait_for_api(page, '/api/bonuses', lambda rows: [r['name'] for r in rows] == ['Year-end'])
    page.wait_for_timeout(300)
    assert _get(page, '/api/incomes') == [], 'only the latest delete is undoable'


def test_notice_times_out_and_pauses_while_hovered(app_page):
    page = app_page
    _seed(page)
    _go(page, 'income', 'incomeSection')
    page.clock.install()
    page.click('[data-income-action="delete"]')
    _toast_visible(page)
    page.mouse.move(1, 1)
    page.clock.fast_forward(9000)
    assert page.is_visible('#undoToast')
    page.hover('#undoToastMessage')
    page.clock.fast_forward(20000)
    assert page.is_visible('#undoToast'), 'paused while hovered'
    page.mouse.move(1, 1)
    page.clock.fast_forward(11000)
    page.wait_for_selector('#undoToast', state='hidden')
    page.keyboard.press('Control+z')
    page.wait_for_timeout(300)
    assert _get(page, '/api/incomes') == []


def test_undo_account_archive_and_recurring_archive(app_page):
    page = app_page
    _seed(page)
    acct = page.evaluate("window.app.accounts[0].id")
    _go(page, 'accounts', 'accountsSection')
    page.click(f'[data-account-action="archive"][data-account-id="{acct}"]')
    _toast_visible(page)
    assert 'archived' in page.text_content('#undoToastMessage')
    wait_for_api(page, '/api/accounts', lambda rows: rows[0]['archived'] is True)
    page.click('#undoToastBtn')
    wait_for_api(page, '/api/accounts', lambda rows: rows[0]['archived'] is False)

    _go(page, 'recurring', 'recurringSection')
    page.click('[data-recurring-action="archive"]')
    _toast_visible(page)
    wait_for_api(page, '/api/recurring-templates', lambda rows: rows[0]['archived'] is True)
    page.click('#undoToastBtn')
    wait_for_api(page, '/api/recurring-templates', lambda rows: rows[0]['archived'] is False)


def test_undo_debt_unarchive(app_page):
    page = app_page
    _seed(page)
    debt_id = _ids(page, 'debts', 'Store Card')[0]
    page.evaluate("(id) => { const d = window.app.debts.find(x => x.id === id); d.archived = true; }", debt_id)
    page.evaluate("(id) => window.app.unarchiveDebt(id)", debt_id)
    _toast_visible(page)
    assert 'moved out of the archive' in page.text_content('#undoToastMessage')
    page.click('#undoToastBtn')
    wait_for_api(page, '/api/debts', lambda rows: next(r for r in rows if r['id'] == debt_id)['archived'] is True)


@pytest.fixture
def sw_blocked_page(browser, stack_user):
    """page.route() must see /api requests, so the service worker is blocked."""
    context = browser.new_context(service_workers='block')
    page = context.new_page()
    ensure_session(context)
    page.goto(BASE_URL, wait_until='networkidle', timeout=60000)
    wait_for_app_ready(page)
    reset_server_state(page)
    yield page
    context.close()


def test_a_failed_undo_says_so_and_restores_nothing(sw_blocked_page):
    page = sw_blocked_page
    _seed(page)
    _delete_visa(page)
    page.route('**/api/debts', lambda route: route.fulfill(status=500, body='{}')
               if route.request.method == 'POST' else route.continue_())
    page.click('#undoToastBtn')
    page.wait_for_function("() => document.getElementById('undoToastMessage').textContent.startsWith(\"Couldn't undo\")")
    page.unroute('**/api/debts')
    assert not any(r['name'] == 'Visa' for r in _get(page, '/api/debts'))
    assert not page.evaluate("window.app.debts.some(d => d.name === 'Visa')")
