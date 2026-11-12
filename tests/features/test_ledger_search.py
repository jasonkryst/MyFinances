#!/usr/bin/env python3
"""
Ledger free-text search (issue #586).

The search box filters rows by name, category (stored or translated label) or
memo. Memo is not on ledger rows: it is looked up from manual transactions and
one-off transfers. The term is session-only view state and must never reach
browser storage.
"""

from datetime import date

import pytest

from tests.conftest import seed_state

pytestmark = pytest.mark.feature

ROWS = '#ledgerTableContainer .ledger-table tbody tr'
EMPTY_TEXT = 'No transactions match your filters'


def _seed(page):
    today = date.today().isoformat()
    seed_state(page, {
        'version': '3.0',
        'accounts': [
            {'id': 1, 'name': 'Search Checking', 'type': 'Checking', 'startingBalance': 1000},
            {'id': 2, 'name': 'Search Savings', 'type': 'Savings', 'startingBalance': 500},
        ],
        'manualTransactions': [
            {'id': 1, 'accountId': 1, 'date': today, 'amount': -25, 'name': 'Corner Bakery',
             'category': 'Food', 'memo': 'birthday cake'},
            {'id': 2, 'accountId': 1, 'date': today, 'amount': -40, 'name': 'Gas station',
             'category': 'Transport', 'memo': ''},
        ],
        'transfers': [
            {'id': 1, 'fromAccountId': 1, 'toAccountId': 2, 'amount': 100, 'date': today,
             'memo': 'rainy day fund'},
        ],
    })


def _open_ledger(page):
    page.click('button[data-page="ledger"]')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)
    page.wait_for_selector('#ledgerSearchInput', state='attached', timeout=5000)
    # Show every date so the seeded rows are always in range.
    page.select_option('#ledgerDateRange', 'all')
    page.wait_for_selector('#ledgerSearchInput', state='attached')


def _search(page, term):
    """Fill the box and wait for the debounced re-render to apply it."""
    page.fill('#ledgerSearchInput', term)
    page.wait_for_function(
        "(t) => window.app._ledgerSearch === t", arg=term, timeout=5000)
    page.wait_for_selector('#ledgerSearchInput', state='attached')


def _table_text(page):
    return page.inner_text('#ledgerTableContainer')


def _names(page):
    return page.eval_on_selector_all(
        ROWS, "rows => rows.map(r => r.innerText.replace(/\\s+/g, ' ').trim())")


def test_search_by_name(app_page):
    page = app_page
    _seed(page)
    _open_ledger(page)
    _search(page, 'bakery')
    text = _table_text(page)
    assert 'Corner Bakery' in text
    assert 'Gas station' not in text
    assert EMPTY_TEXT not in text


def test_search_is_case_insensitive_and_trimmed(app_page):
    page = app_page
    _seed(page)
    _open_ledger(page)
    _search(page, '  GAS STAT  ')
    text = _table_text(page)
    assert 'Gas station' in text
    assert 'Corner Bakery' not in text


def test_search_by_category(app_page):
    page = app_page
    _seed(page)
    _open_ledger(page)
    _search(page, 'transport')
    text = _table_text(page)
    assert 'Gas station' in text
    assert 'Corner Bakery' not in text


def test_search_by_manual_transaction_memo(app_page):
    page = app_page
    _seed(page)
    _open_ledger(page)
    _search(page, 'birthday')
    text = _table_text(page)
    assert 'Corner Bakery' in text, 'memo is not on the row; it comes from the source record'
    assert 'Gas station' not in text


def test_search_by_transfer_memo_matches_both_legs(app_page):
    page = app_page
    _seed(page)
    _open_ledger(page)
    _search(page, 'rainy day')
    rows = _names(page)
    assert len(rows) == 2, rows
    assert all('Transfer' in r for r in rows), rows
    assert 'Corner Bakery' not in _table_text(page)


def test_search_matches_translated_category_label(app_page):
    page = app_page
    _seed(page)
    page.evaluate("() => localStorage.setItem('debtTrackerLocale', 'es')")
    page.reload()
    labels = page.evaluate(
        "async () => { const m = await import('/src/i18n.js'); return { es: m.categoryLabel('Food'), en: 'Food' }; }")
    assert labels['es'] != labels['en'], 'Food must be translated in es for this test to mean anything'
    _open_ledger(page)
    _search(page, labels['es'][:4])
    text = _table_text(page)
    assert 'Corner Bakery' in text
    assert 'Gas station' not in text
    page.evaluate("() => localStorage.removeItem('debtTrackerLocale')")


def test_no_match_shows_empty_state_and_clearing_restores_rows(app_page):
    page = app_page
    _seed(page)
    _open_ledger(page)
    before = len(_names(page))
    assert before >= 4
    _search(page, 'zzz-nothing-matches')
    assert EMPTY_TEXT in _table_text(page)
    _search(page, '')
    text = _table_text(page)
    assert EMPTY_TEXT not in text
    assert len(_names(page)) == before
    assert 'Corner Bakery' in text and 'Gas station' in text


def test_typing_keeps_focus_in_the_input(app_page):
    page = app_page
    _seed(page)
    _open_ledger(page)
    page.click('#ledgerSearchInput')
    page.keyboard.type('bak', delay=40)
    page.wait_for_function("() => window.app._ledgerSearch === 'bak'", timeout=5000)
    assert page.evaluate("() => document.activeElement && document.activeElement.id") == 'ledgerSearchInput'
    # Keep typing after the re-render: nothing is lost and the caret is at the end.
    page.keyboard.type('ery', delay=40)
    page.wait_for_function("() => window.app._ledgerSearch === 'bakery'", timeout=5000)
    assert page.input_value('#ledgerSearchInput') == 'bakery'
    assert page.evaluate("() => document.activeElement.id") == 'ledgerSearchInput'


def test_term_is_not_written_to_browser_storage(app_page):
    page = app_page
    _seed(page)
    _open_ledger(page)
    _search(page, 'secret-payee-name')
    dump = page.evaluate(
        "() => JSON.stringify({ l: Object.entries(localStorage), s: Object.entries(sessionStorage) })")
    assert 'secret-payee-name' not in dump
    stored = page.evaluate("() => localStorage.getItem('debtTrackerLedgerFilters') || ''")
    assert 'search' not in stored.lower()


def test_clear_filters_clears_the_search(app_page):
    page = app_page
    _seed(page)
    _open_ledger(page)
    _search(page, 'bakery')
    page.locator('#ledgerClearFiltersBtn').click()
    page.wait_for_function("() => window.app._ledgerSearch === ''", timeout=5000)
    assert page.input_value('#ledgerSearchInput') == ''


def test_search_resets_to_page_one(app_page):
    page = app_page
    _seed(page)
    _open_ledger(page)
    page.evaluate("() => { window.app._ledgerPage = 3; }")
    _search(page, 'bakery')
    assert page.evaluate("() => window.app._ledgerPage") == 1


def test_search_counts_as_an_active_filter_on_phone(app_page):
    page = app_page
    _seed(page)
    page.set_viewport_size({'width': 390, 'height': 844})
    # The nav is behind a toggle on a phone, so switch pages through the app.
    page.evaluate("() => window.app.switchPage('ledger')")
    page.wait_for_selector('#ledgerFiltersToggle', state='visible', timeout=5000)
    before = page.inner_text('#ledgerFiltersToggle')
    page.click('#ledgerFiltersToggle')
    page.wait_for_selector('#ledgerSearchInput', state='visible')
    page.fill('#ledgerSearchInput', 'bakery')
    page.wait_for_function("() => window.app._ledgerSearch === 'bakery'", timeout=5000)
    toggle = page.locator('#ledgerFiltersToggle')
    toggle.wait_for()
    after = toggle.inner_text()
    assert after != before
    assert '1' in after, after
    assert 'filters-disclosure-toggle--active' in (toggle.get_attribute('class') or '')


def test_search_input_has_an_accessible_label(app_page):
    page = app_page
    _seed(page)
    _open_ledger(page)
    assert page.locator('label[for="ledgerSearchInput"]').inner_text().strip()
    assert page.get_attribute('#ledgerSearchInput', 'type') == 'search'
