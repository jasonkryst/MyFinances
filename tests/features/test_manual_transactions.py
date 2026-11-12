"""Manual one-off transactions in the Ledger (issue #584).

Covers adding, editing and deleting through the Ledger modal, validation,
Cleared-by-default, no override, balances, Reports, persistence, export and
import, and Clear All Data.
"""
import json

import pytest

from tests.conftest import seed_state, wait_for_api

pytestmark = pytest.mark.feature

def _seed_accounts(page):
    seed_state(page, {'accounts': [
        {'id': 1, 'name': 'MT Checking', 'type': 'Checking', 'startingBalance': 1000},
        {'id': 2, 'name': 'MT Savings', 'type': 'Savings', 'startingBalance': 500},
    ]})
    return page.evaluate("""() => ({
        a: window.app.accounts.find(a => a.name === 'MT Checking').id,
        b: window.app.accounts.find(a => a.name === 'MT Savings').id,
    })""")


def _local_today(page):
    return page.evaluate("""() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }""")


def _open_ledger(page):
    page.click('[data-page="ledger"]')
    page.wait_for_selector('#ledgerAddTransactionBtn')


def _fill_modal(page, *, account=None, income=False, amount='', date=None, name='', category='', memo=''):
    if account is not None:
        page.select_option('#manualTxAccount', str(account))
    page.check('#manualTxIncome' if income else '#manualTxExpense')
    page.fill('#manualTxAmount', amount)
    if date is not None:
        page.fill('#manualTxDate', date)
    page.fill('#manualTxName', name)
    page.fill('#manualTxCategory', category)
    page.fill('#manualTxMemo', memo)


def _wait_saved(page, count):
    page.wait_for_function(f"() => window.app.manualTransactions.length === {count}")
    page.wait_for_selector('#manualTxModal.hidden', state='attached')


def test_add_expense_from_ledger_modal(app_page):
    page = app_page
    ids = _seed_accounts(page)
    _open_ledger(page)
    page.click('#ledgerAddTransactionBtn')
    page.wait_for_selector('#manualTxModal:not(.hidden)')
    today = _local_today(page)
    _fill_modal(page, account=ids['a'], amount='42.10', date=today, name='Hardware store', category='Home', memo='paint')
    page.click('#manualTxConfirmBtn')
    _wait_saved(page, 1)

    rec = page.evaluate("() => window.app.manualTransactions[0]")
    assert rec['amount'] == -42.10
    assert rec['accountId'] == ids['a']
    assert rec['name'] == 'Hardware store'
    assert rec['category'] == 'Home'
    assert rec['memo'] == 'paint'
    assert rec['date'] == today
    assert isinstance(rec['id'], int)

    rows = wait_for_api(page, '/api/manual-transactions', lambda r: len(r) == 1)
    assert rows[0]['amount'] == -42.1

    # Shown in the Ledger with the Manual badge, Cleared, and no override button.
    row = page.locator('#ledgerTableContainer tr', has_text='Hardware store')
    row.first.wait_for()
    assert row.first.locator('.ledger-manual-badge').count() == 1
    key = f"manual|{rec['id']}|{ids['a']}|{today}"
    assert page.evaluate(f"() => !!window.app.ledgerClearedTransactions['{key}']")
    assert row.first.locator('[data-ledger-override]').count() == 0
    assert row.first.locator('.ledger-cleared-checkbox').is_checked()


def test_add_income_is_positive_and_raises_balance(app_page):
    page = app_page
    ids = _seed_accounts(page)
    before = page.evaluate(f"() => window.app.computeAccountBalance({ids['b']})")
    _open_ledger(page)
    page.click('#ledgerAddTransactionBtn')
    _fill_modal(page, account=ids['b'], income=True, amount='75', date=_local_today(page), name='Refund')
    page.click('#manualTxConfirmBtn')
    _wait_saved(page, 1)
    rec = page.evaluate("() => window.app.manualTransactions[0]")
    assert rec['amount'] == 75
    assert rec['category'] == 'Income'  # default for income with no category
    after = page.evaluate(f"() => window.app.computeAccountBalance({ids['b']})")
    assert after == pytest.approx(before + 75, abs=0.01)


@pytest.mark.parametrize('field,value,message_key', [
    ('amount', '0', 'manualTx.errAmount'),
    ('amount', '', 'manualTx.errAmount'),
    ('amount', '-5', 'manualTx.errAmount'),
    ('name', '   ', 'manualTx.errName'),
    ('account', '', 'manualTx.errAccount'),
])
def test_modal_rejects_invalid_input_inline(app_page, field, value, message_key):
    page = app_page
    ids = _seed_accounts(page)
    _open_ledger(page)
    page.click('#ledgerAddTransactionBtn')
    good = {'account': ids['a'], 'amount': '10', 'name': 'Valid', 'date': _local_today(page)}
    good[field] = value
    _fill_modal(page, account=good['account'], amount=good['amount'], name=good['name'], date=good['date'])
    page.click('#manualTxConfirmBtn')  # submit-no-wait: validation rejects before any save
    page.wait_for_selector('#manualTxError:not(.hidden)')
    expected = page.evaluate(f"async () => (await import('/src/i18n.js')).t('{message_key}')")
    assert page.text_content('#manualTxError') == expected
    assert page.is_visible('#manualTxModal')
    assert page.evaluate("() => window.app.manualTransactions.length") == 0
    assert wait_for_api(page, '/api/manual-transactions', lambda r: r == []) == []


def test_failed_save_keeps_modal_open_and_adds_nothing(app_page):
    page = app_page
    ids = _seed_accounts(page)
    _open_ledger(page)
    page.route('**/api/manual-transactions', lambda route: route.fulfill(status=500, body='{}')
               if route.request.method == 'POST' else route.continue_())
    page.click('#ledgerAddTransactionBtn')
    _fill_modal(page, account=ids['a'], amount='9', name='Will fail', date=_local_today(page))
    page.click('#manualTxConfirmBtn')  # submit-no-wait: the POST is made to fail on purpose
    page.wait_for_selector('#syncErrorBanner:not(.hidden)', state='attached')
    assert page.is_visible('#manualTxModal')
    assert page.input_value('#manualTxName') == 'Will fail'
    assert page.evaluate("() => window.app.manualTransactions.length") == 0


def test_edit_changes_amount_and_carries_cleared_to_new_date(app_page):
    page = app_page
    ids = _seed_accounts(page)
    today = _local_today(page)
    page.evaluate(f"""async () => {{
        await window.app.addManualTransaction({{ accountId: {ids['a']}, direction: 'expense', amount: 20,
            date: '{today}', name: 'Groceries', category: 'Food', memo: '' }});
    }}""")
    rec = page.evaluate("() => window.app.manualTransactions[0]")
    _open_ledger(page)
    page.click(f'[data-ledger-manual-edit="{rec["id"]}"]')
    page.wait_for_selector('#manualTxModal:not(.hidden)')
    assert page.input_value('#manualTxAmount') == '20'
    assert page.is_checked('#manualTxExpense')
    assert page.text_content('#manualTxModalTitle') == page.evaluate("async () => (await import('/src/i18n.js')).t('manualTx.editTitle')")
    # Another day in the same month, built locally to avoid UTC shifts.
    new_date = page.evaluate(f"""() => {{ const d = new Date('{today}T00:00:00'); d.setDate(d.getDate() === 1 ? 2 : 1);
        return `${{d.getFullYear()}}-${{String(d.getMonth() + 1).padStart(2, '0')}}-${{String(d.getDate()).padStart(2, '0')}}`; }}""")
    page.fill('#manualTxAmount', '25.5')
    page.fill('#manualTxDate', new_date)
    page.click('#manualTxConfirmBtn')
    page.wait_for_selector('#manualTxModal.hidden', state='attached')
    updated = page.evaluate("() => window.app.manualTransactions[0]")
    assert updated['amount'] == -25.5
    assert updated['date'] == new_date
    old_key = f"manual|{rec['id']}|{ids['a']}|{today}"
    new_key = f"manual|{rec['id']}|{ids['a']}|{new_date}"
    assert page.evaluate(f"() => !window.app.ledgerClearedTransactions['{old_key}']")
    assert page.evaluate(f"() => !!window.app.ledgerClearedTransactions['{new_key}']")
    wait_for_api(page, '/api/manual-transactions', lambda r: len(r) == 1 and r[0]['amount'] == -25.5)


def test_delete_asks_first_and_cancel_keeps_it(app_page):
    page = app_page
    ids = _seed_accounts(page)
    page.evaluate(f"""async () => {{
        await window.app.addManualTransaction({{ accountId: {ids['a']}, direction: 'expense', amount: 12,
            date: '{_local_today(page)}', name: 'Taxi', category: 'Transport', memo: '' }});
    }}""")
    rec_id = page.evaluate("() => window.app.manualTransactions[0].id")
    _open_ledger(page)

    page.click(f'[data-ledger-manual-delete="{rec_id}"]')
    page.wait_for_selector('#deleteConfirmModal:not(.hidden)')
    page.click('#deleteConfirmCancelBtn')
    assert page.evaluate("() => window.app.manualTransactions.length") == 1

    page.click(f'[data-ledger-manual-delete="{rec_id}"]')
    page.wait_for_selector('#deleteConfirmModal:not(.hidden)')
    page.click('#deleteConfirmBtn')
    page.wait_for_function("() => window.app.manualTransactions.length === 0")
    wait_for_api(page, '/api/manual-transactions', lambda r: r == [])
    assert page.evaluate("() => Object.keys(window.app.ledgerClearedTransactions).filter(k => k.startsWith('manual|')).length") == 0


def test_persists_across_reload(app_page):
    page = app_page
    ids = _seed_accounts(page)
    page.evaluate(f"""async () => {{
        await window.app.addManualTransaction({{ accountId: {ids['a']}, direction: 'income', amount: 300,
            date: '2026-03-04', name: 'Sold bike', category: 'Income', memo: 'craigslist' }});
    }}""")
    wait_for_api(page, '/api/manual-transactions', lambda r: len(r) == 1)
    page.reload()
    rec = page.evaluate("() => window.app.manualTransactions[0]")
    assert rec['name'] == 'Sold bike'
    assert rec['amount'] == 300
    assert rec['memo'] == 'craigslist'


def test_reports_count_inflow_as_income_and_outflow_as_spending(app_page):
    page = app_page
    ids = _seed_accounts(page)
    result = page.evaluate(f"""async () => {{
        const app = window.app;
        const now = new Date();
        const iso = d => `${{now.getFullYear()}}-${{String(now.getMonth() + 1).padStart(2, '0')}}-${{String(d).padStart(2, '0')}}`;
        await app.addManualTransaction({{ accountId: {ids['a']}, direction: 'expense', amount: 60, date: iso(5), name: 'Dinner', category: 'Dining', memo: '' }});
        await app.addManualTransaction({{ accountId: {ids['a']}, direction: 'income', amount: 40, date: iso(6), name: 'Cashback', category: 'Income', memo: '' }});
        const cf = await import('/src/reportsCashFlow.js');
        const sp = await import('/src/spending.js');
        const totals = cf.computeMonthCashFlowTotals(app, now.getFullYear(), now.getMonth());
        const spending = sp.computeSpendingByCategory(app, now.getFullYear(), now.getMonth());
        return {{ totals, spending }};
    }}""")
    assert result['totals']['income'] == pytest.approx(40, abs=0.01)
    assert result['totals']['expenses'] == pytest.approx(60, abs=0.01)
    dining = json.dumps(result['spending'])
    assert 'Dining' in dining
    assert 'Cashback' not in dining


def test_export_import_round_trip_and_clear_all(app_page):
    page = app_page
    ids = _seed_accounts(page)
    page.evaluate(f"""async () => {{
        await window.app.addManualTransaction({{ accountId: {ids['b']}, direction: 'expense', amount: 15,
            date: '2026-02-03', name: 'Bank fee', category: 'Fees', memo: '' }});
    }}""")
    # The real JSON export carries the collection...
    with page.expect_download() as dl:
        page.evaluate("async () => (await import('/src/dataExport.js')).exportAllJSON(window.app)")
    with open(dl.value.path(), encoding='utf-8') as fh:
        state = json.load(fh)
    assert [m['name'] for m in state['manualTransactions']] == ['Bank fee']

    # ...and a replace-mode import through the real path restores it, with the
    # account id remapped to the newly created account.
    seed_state(page, state)
    after = page.evaluate("() => ({ txs: window.app.manualTransactions, acct: window.app.accounts.find(a => a.name === 'MT Savings').id })")
    assert len(after['txs']) == 1
    assert after['txs'][0]['name'] == 'Bank fee'
    assert after['txs'][0]['accountId'] == after['acct']

    page.evaluate("async () => { const pg = await import('/src/postgresSync.js'); await pg.pgDeleteAll(window.app); }")
    assert wait_for_api(page, '/api/manual-transactions', lambda r: r == []) == []


def test_modal_keyboard_escape_closes_and_enter_submits(app_page):
    page = app_page
    ids = _seed_accounts(page)
    _open_ledger(page)
    page.focus('#ledgerAddTransactionBtn')
    page.keyboard.press('Enter')
    page.wait_for_selector('#manualTxModal:not(.hidden)')
    # The modal moves focus inside itself 30 ms after opening; its key
    # handler only sees keys pressed from inside it.
    page.wait_for_selector('#manualTxAccount:focus')
    page.keyboard.press('Escape')
    page.wait_for_selector('#manualTxModal.hidden', state='attached')
    assert page.evaluate("() => document.activeElement.id") == 'ledgerAddTransactionBtn'

    page.click('#ledgerAddTransactionBtn')
    page.wait_for_selector('#manualTxAccount:focus')  # let the auto-focus settle first
    _fill_modal(page, account=ids['a'], amount='3.25', name='Parking', date=_local_today(page))
    page.focus('#manualTxName')
    page.keyboard.press('Enter')
    _wait_saved(page, 1)
    assert page.evaluate("() => window.app.manualTransactions[0].amount") == -3.25


def test_add_button_preselects_the_filtered_account(app_page):
    page = app_page
    ids = _seed_accounts(page)
    _open_ledger(page)
    page.evaluate(f"() => {{ window.app._ledgerAccountFilter = '{ids['b']}'; window.app.refreshCurrentPageData(); }}")
    page.click('#ledgerAddTransactionBtn')
    page.wait_for_selector('#manualTxModal:not(.hidden)')
    assert page.input_value('#manualTxAccount') == str(ids['b'])
