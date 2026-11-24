"""Split a manual one-off transaction across several categories (issue #688).

Covers the modal's Split editor (remaining helper, save blocked while
unbalanced, remove back to one category), persistence, the one-row Ledger
display with its badge, the category filter, Spending / Budget vs. Actual
attribution, inflow splits, edit, CSV export and import rejection.
"""
import json

import pytest

from tests.conftest import seed_state, wait_for_api

pytestmark = pytest.mark.feature


def _seed_account(page):
    seed_state(page, {'accounts': [
        {'id': 1, 'name': 'SP Checking', 'type': 'Checking', 'startingBalance': 1000},
    ]})
    return page.evaluate("() => window.app.accounts[0].id")


def _local_today(page):
    return page.evaluate("""() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }""")


def _t(page, key):
    return page.evaluate("async (k) => (await import('/src/i18n.js')).t(k)", key)


def _open_modal(page):
    page.click('[data-page="ledger"]')
    page.wait_for_selector('#ledgerAddTransactionBtn')
    page.click('#ledgerAddTransactionBtn')
    page.wait_for_selector('#manualTxModal:not(.hidden)')
    page.wait_for_selector('#manualTxAccount:focus')


def _fill_head(page, account, amount, name, income=False):
    page.select_option('#manualTxAccount', str(account))
    page.check('#manualTxIncome' if income else '#manualTxExpense')
    page.fill('#manualTxAmount', amount)
    page.fill('#manualTxDate', _local_today(page))
    page.fill('#manualTxName', name)


def _fill_split(page, index, category, amount, memo=''):
    page.fill(f'#manualTxSplitCat{index}', category)
    page.fill(f'#manualTxSplitAmt{index}', amount)
    if memo:
        page.fill(f'#manualTxSplitMemo{index}', memo)


def _save_split_receipt(page, account, name='Store receipt'):
    """Open the modal and save 60 + 30 + 10 = 100 across three categories."""
    _open_modal(page)
    _fill_head(page, account, '100', name)
    page.click('#manualTxSplitToggle')
    page.click('#manualTxSplitAdd')
    _fill_split(page, 0, 'Groceries', '60')
    _fill_split(page, 1, 'Household', '30')
    _fill_split(page, 2, 'Gifts', '10', memo='for Sam')
    page.click('#manualTxConfirmBtn')
    page.wait_for_function("() => window.app.manualTransactions.length === 1")
    page.wait_for_selector('#manualTxModal.hidden', state='attached')


def test_split_expense_saves_signed_splits_and_shows_one_ledger_row(app_page):
    page = app_page
    acct = _seed_account(page)
    _save_split_receipt(page, acct)

    rec = page.evaluate("() => window.app.manualTransactions[0]")
    assert rec['amount'] == -100
    assert rec['splits'] == [
        {'category': 'Groceries', 'amount': -60},
        {'category': 'Household', 'amount': -30},
        {'category': 'Gifts', 'amount': -10, 'memo': 'for Sam'},
    ]
    rows = wait_for_api(page, '/api/manual-transactions', lambda r: len(r) == 1 and r[0]['splits'])
    assert rows[0]['splits'][2]['memo'] == 'for Sam'

    # One Ledger row for the whole transaction, with the split badge and one Cleared box.
    row = page.locator('#ledgerTableContainer tr', has_text='Store receipt')
    row.first.wait_for()
    assert row.count() == 1
    badge = row.first.locator('.ledger-split-badge')
    assert badge.count() == 1
    assert 'Split (3)' in badge.text_content()
    for category in ('Groceries', 'Household', 'Gifts'):
        assert category in badge.text_content()
    assert row.first.locator('.ledger-cleared-checkbox').count() == 1
    assert page.evaluate("() => window.app.computeAccountBalance(window.app.accounts[0].id)") == pytest.approx(900, abs=0.01)

    # Persists across a reload with the splits intact.
    page.reload()
    assert page.evaluate("() => window.app.manualTransactions[0].splits.length") == 3


def test_remaining_helper_and_save_blocked_while_unbalanced(app_page):
    page = app_page
    acct = _seed_account(page)
    _open_modal(page)
    _fill_head(page, acct, '100', 'Unbalanced')
    page.click('#manualTxSplitToggle')
    assert page.get_attribute('#manualTxSplitToggle', 'aria-pressed') == 'true'
    assert not page.is_visible('#manualTxCategory')
    _fill_split(page, 0, 'Food', '60')
    _fill_split(page, 1, 'Fun', '30')
    remaining = page.locator('#manualTxSplitRemaining')
    remaining.filter(has_text='10.00').wait_for()

    page.click('#manualTxConfirmBtn')  # submit-no-wait: validation rejects before any save
    page.wait_for_selector('#manualTxError:not(.hidden)')
    assert '10.00' in page.text_content('#manualTxError')
    assert page.locator('#manualTxSplitRows [aria-invalid="true"]').count() == 1
    assert page.is_visible('#manualTxModal')
    assert page.evaluate("() => window.app.manualTransactions.length") == 0
    assert wait_for_api(page, '/api/manual-transactions', lambda r: r == []) == []

    # Over-allocating is blocked too, and the helper says so.
    page.fill('#manualTxSplitAmt1', '60')
    page.locator('#manualTxSplitRemaining').filter(has_text='20.00').wait_for()
    page.click('#manualTxConfirmBtn')  # submit-no-wait: validation rejects before any save
    page.wait_for_selector('#manualTxError:not(.hidden)')
    assert page.evaluate("() => window.app.manualTransactions.length") == 0

    # Balancing it clears the helper and saves.
    page.fill('#manualTxSplitAmt1', '40')
    assert page.text_content('#manualTxSplitRemaining') == _t(page, 'manualTx.splitBalanced')
    page.click('#manualTxConfirmBtn')
    page.wait_for_function("() => window.app.manualTransactions.length === 1")


def test_split_needs_a_category_on_every_row(app_page):
    page = app_page
    acct = _seed_account(page)
    _open_modal(page)
    _fill_head(page, acct, '50', 'No category')
    page.click('#manualTxSplitToggle')
    _fill_split(page, 0, 'Food', '30')
    _fill_split(page, 1, '', '20')
    page.click('#manualTxConfirmBtn')  # submit-no-wait: validation rejects before any save
    page.wait_for_selector('#manualTxError:not(.hidden)')
    assert page.text_content('#manualTxError') == _t(page, 'manualTx.errSplitCategory')
    assert page.get_attribute('#manualTxSplitCat1', 'aria-invalid') == 'true'
    assert page.evaluate("() => window.app.manualTransactions.length") == 0


def test_removing_splits_restores_the_single_category_field(app_page):
    page = app_page
    acct = _seed_account(page)
    _open_modal(page)
    _fill_head(page, acct, '40', 'Back to one')
    page.fill('#manualTxCategory', 'Food')
    page.click('#manualTxSplitToggle')
    # The first split starts with the single category's value.
    assert page.input_value('#manualTxSplitCat0') == 'Food'
    # Each remove button names its row.
    assert page.get_attribute('[data-split-remove="1"]', 'aria-label') == page.evaluate(
        "async () => (await import('/src/i18n.js')).t('manualTx.splitRemoveAria', { n: 2 })")
    page.click('[data-split-remove="1"]')
    assert page.is_visible('#manualTxCategory')
    assert page.input_value('#manualTxCategory') == 'Food'
    assert not page.is_visible('#manualTxSplitEditor')
    assert page.get_attribute('#manualTxSplitToggle', 'aria-pressed') == 'false'

    page.click('#manualTxConfirmBtn')
    page.wait_for_function("() => window.app.manualTransactions.length === 1")
    rec = page.evaluate("() => window.app.manualTransactions[0]")
    assert rec['category'] == 'Food'
    assert rec['splits'] is None
    wait_for_api(page, '/api/manual-transactions', lambda r: len(r) == 1 and r[0]['splits'] is None)


def test_inflow_split_is_positive_and_not_spending(app_page):
    page = app_page
    acct = _seed_account(page)
    _open_modal(page)
    _fill_head(page, acct, '250', 'Deposit', income=True)
    page.click('#manualTxSplitToggle')
    _fill_split(page, 0, 'Salary', '200')
    _fill_split(page, 1, 'Bonus', '50')
    page.click('#manualTxConfirmBtn')
    page.wait_for_function("() => window.app.manualTransactions.length === 1")
    rec = page.evaluate("() => window.app.manualTransactions[0]")
    assert rec['amount'] == 250
    assert rec['splits'] == [{'category': 'Salary', 'amount': 200}, {'category': 'Bonus', 'amount': 50}]
    wait_for_api(page, '/api/manual-transactions', lambda r: len(r) == 1 and r[0]['splits'] and r[0]['splits'][0]['amount'] == 200)
    result = page.evaluate("""async () => {
        const now = new Date();
        const sp = await import('/src/spending.js');
        const cf = await import('/src/reportsCashFlow.js');
        return { spending: sp.computeSpendingByCategory(window.app, now.getFullYear(), now.getMonth()),
                 totals: cf.computeMonthCashFlowTotals(window.app, now.getFullYear(), now.getMonth()) };
    }""")
    assert result['spending'] == []
    assert result['totals']['income'] == pytest.approx(250, abs=0.01)


def test_spending_and_budget_vs_actual_attribute_each_split(app_page):
    page = app_page
    acct = _seed_account(page)
    _save_split_receipt(page, acct)
    result = page.evaluate("""async () => {
        const now = new Date();
        const sp = await import('/src/spending.js');
        const cb = await import('/src/categoryBudgets.js');
        const spending = sp.computeSpendingByCategory(window.app, now.getFullYear(), now.getMonth());
        const budgets = cb.computeCategoryBudgets(window.app, now.getFullYear(), now.getMonth(), 1);
        return {
            spending: Object.fromEntries(spending.map(r => [r.category, r.total])),
            actual: Object.fromEntries(budgets.map(r => [r.category, r.actual])),
        };
    }""")
    assert result['spending'] == {'Groceries': 60, 'Household': 30, 'Gifts': 10}
    assert result['actual']['Groceries'] == 60
    assert result['actual']['Household'] == 30
    assert result['actual']['Gifts'] == 10


def test_ledger_category_filter_matches_any_split(app_page):
    page = app_page
    acct = _seed_account(page)
    _save_split_receipt(page, acct)
    page.evaluate(f"""async () => {{
        await window.app.addManualTransaction({{ accountId: {acct}, direction: 'expense', amount: 5,
            date: '{_local_today(page)}', name: 'Plain coffee', category: 'Dining', memo: '' }});
    }}""")
    page.evaluate("() => { window.app._ledgerCategoryFilter = 'Household'; window.app.refreshCurrentPageData(); }")
    container = page.locator('#ledgerTableContainer')
    container.locator('tr', has_text='Store receipt').first.wait_for()
    assert container.locator('tr', has_text='Plain coffee').count() == 0
    # The Category dropdown lists every split's category.
    options = page.evaluate("() => [...document.querySelectorAll('#ledgerCategoryFilter option')].map(o => o.value)")
    assert {'Groceries', 'Household', 'Gifts', 'Dining'} <= set(options)


def test_edit_split_then_clear_it(app_page):
    page = app_page
    acct = _seed_account(page)
    _save_split_receipt(page, acct)
    rec_id = page.evaluate("() => window.app.manualTransactions[0].id")
    page.click(f'[data-ledger-manual-edit="{rec_id}"]')
    page.wait_for_selector('#manualTxModal:not(.hidden)')
    assert page.get_attribute('#manualTxSplitToggle', 'aria-pressed') == 'true'
    assert page.input_value('#manualTxSplitCat2') == 'Gifts'
    assert page.input_value('#manualTxSplitAmt0') == '60'
    assert page.input_value('#manualTxSplitMemo2') == 'for Sam'
    assert page.text_content('#manualTxSplitRemaining') == _t(page, 'manualTx.splitBalanced')

    # Change the total: the splits no longer balance, so it cannot be saved.
    page.fill('#manualTxAmount', '120')
    page.click('#manualTxConfirmBtn')  # submit-no-wait: validation rejects before any save
    page.wait_for_selector('#manualTxError:not(.hidden)')
    assert page.evaluate("() => window.app.manualTransactions[0].amount") == -100

    # Turn splitting off: the record becomes a single-category transaction.
    page.click('#manualTxSplitToggle')
    assert page.is_visible('#manualTxCategory')
    page.fill('#manualTxCategory', 'Shopping')
    page.click('#manualTxConfirmBtn')
    page.wait_for_selector('#manualTxModal.hidden', state='attached')
    updated = page.evaluate("() => window.app.manualTransactions[0]")
    assert updated['splits'] is None
    assert updated['category'] == 'Shopping'
    assert updated['amount'] == -120
    wait_for_api(page, '/api/manual-transactions', lambda r: len(r) == 1 and r[0]['splits'] is None and r[0]['amount'] == -120)


def test_ledger_csv_export_keeps_one_row_with_joined_categories(app_page):
    page = app_page
    acct = _seed_account(page)
    _save_split_receipt(page, acct)
    page.evaluate("() => { window.app._ledgerDateRange = 'all'; }")
    with page.expect_download() as dl:
        page.evaluate("async () => (await import('/src/dataExport.js')).exportLedgerToCSV(window.app, ['name', 'amount', 'category'])")
    with open(dl.value.path(), encoding='utf-8') as fh:
        lines = [ln for ln in fh.read().splitlines() if 'Store receipt' in ln]
    assert len(lines) == 1
    assert 'Groceries; Household; Gifts' in lines[0]
    assert '-100.00' in lines[0]


def test_import_rejects_an_unbalanced_split_and_keeps_the_rest(app_page):
    page = app_page
    state = {
        'accounts': [{'id': 1, 'name': 'SP Checking', 'type': 'Checking', 'startingBalance': 0}],
        'manualTransactions': [
            {'id': 1, 'accountId': 1, 'date': '2026-06-10', 'amount': -100, 'name': 'Bad split', 'category': 'A',
             'splits': [{'category': 'A', 'amount': -40}, {'category': 'B', 'amount': -50}]},
            {'id': 2, 'accountId': 1, 'date': '2026-06-10', 'amount': -100, 'name': 'Good split', 'category': 'A',
             'splits': [{'category': 'A', 'amount': -40}, {'category': 'B', 'amount': -60}]},
        ],
    }
    warnings = page.evaluate("""async (state) => {
        const s = await import('/src/sanitizers.js');
        const warnings = [];
        s.sanitizeParsedState(state, warnings);
        return warnings;
    }""", state)
    assert any(w['kind'] == 'rejected' and w['recordName'] == 'Bad split' for w in warnings) or \
        any('Bad split' in json.dumps(w) for w in warnings)

    seed_state(page, state)
    names = wait_for_api(page, '/api/manual-transactions', lambda r: len(r) == 1)
    assert [m['name'] for m in names] == ['Good split']
    assert names[0]['splits'] == [{'category': 'A', 'amount': -40}, {'category': 'B', 'amount': -60}]
