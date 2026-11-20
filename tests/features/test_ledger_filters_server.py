#!/usr/bin/env python3
"""
Ledger filters live on the server (issue #571).

The server (plan_settings.ledger_settings) is the single source of truth for
account, date range, sort, Status, category and page size. A second browser
signed in as the same user must see the same filters. The pre-#571 device copy
(localStorage debtTrackerLedgerFilters) is migrated once and then removed.
"""

from datetime import date

import pytest

from tests.conftest import BASE_URL, ensure_session, seed_state, wait_for_api, wait_for_app_ready

KEY = 'debtTrackerLedgerFilters'


def _seed(page):
    seed_state(page, {
        'version': '3.0',
        'accounts': [{'id': 1, 'name': 'Sync Acct', 'type': 'Checking', 'startingBalance': 1000}],
        'incomes': [{'id': 1, 'name': 'Sync Income', 'amount': 500, 'frequency': 'monthly',
                     'firstPayDate': date.today().replace(day=1).isoformat(), 'accountId': 1,
                     'category': 'Salary'}],
        'expenses': [{'id': 2, 'name': 'Sync Rent', 'category': 'Housing', 'budgetAmount': 100,
                      'date': date.today().replace(day=1).isoformat(), 'accountId': 1}],
    })


def _open_ledger(page):
    page.click('button[data-page="ledger"]')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)
    page.wait_for_selector('#ledgerPageSize', timeout=5000)


def _ledger_dom(page):
    return page.evaluate("""() => ({
        size: document.getElementById('ledgerPageSize').value,
        cleared: document.getElementById('ledgerClearedFilter').value,
        category: document.getElementById('ledgerCategoryFilter').value,
    })""")


def _server_ledger(page, check):
    return wait_for_api(page, '/api/plan-settings',
                        lambda b: check(b.get('ledgerSettings') or {}))['ledgerSettings']


def _second_context_page(browser):
    """A second browser context (own localStorage) signed in as the same user."""
    context = browser.new_context()
    ensure_session(context)
    page2 = context.new_page()
    page2.goto(BASE_URL, wait_until='domcontentloaded')
    wait_for_app_ready(page2)
    return context, page2


@pytest.mark.feature
def test_filters_set_in_one_browser_restore_in_another(app_page, browser):
    """Acceptance criterion: category, page size and Status chosen in context A
    are what context B's Ledger shows."""
    page = app_page
    _seed(page)
    _open_ledger(page)
    page.select_option('#ledgerCategoryFilter', 'Housing')
    page.select_option('#ledgerPageSize', '50')
    page.select_option('#ledgerClearedFilter', 'uncleared')
    saved = _server_ledger(page, lambda l: l.get('pageSize') == 50 and l.get('categoryFilter') == 'Housing'
                           and l.get('clearedFilter') == 'uncleared')
    assert saved['categoryFilter'] == 'Housing'

    context, page2 = _second_context_page(browser)
    try:
        _open_ledger(page2)
        assert _ledger_dom(page2) == {'size': '50', 'cleared': 'uncleared', 'category': 'Housing'}
        assert page2.evaluate(f"() => localStorage.getItem('{KEY}')") is None
    finally:
        context.close()


@pytest.mark.feature
def test_defaults_when_nothing_was_saved_in_another_browser(app_page, browser):
    """Negative: with no filters saved, the second browser shows the defaults
    (nothing leaks from the first browser's unsaved state)."""
    page = app_page
    _seed(page)
    context, page2 = _second_context_page(browser)
    try:
        _open_ledger(page2)
        assert _ledger_dom(page2) == {'size': '25', 'cleared': 'all', 'category': 'all'}
    finally:
        context.close()


@pytest.mark.feature
def test_legacy_device_copy_is_migrated_once_then_removed(app_page):
    """A pre-#571 localStorage blob is applied on the first Ledger visit, sent to
    the server once, and the key is removed."""
    page = app_page
    _seed(page)
    page.evaluate("""() => localStorage.setItem('debtTrackerLedgerFilters', JSON.stringify({
        accountFilter: 'all', dateRange: 'next30', clearedFilter: 'cleared', pageSize: 100, categoryFilter: 'Housing'
    }))""")
    page.reload()
    _open_ledger(page)
    assert _ledger_dom(page) == {'size': '100', 'cleared': 'cleared', 'category': 'Housing'}
    saved = _server_ledger(page, lambda l: l.get('pageSize') == 100)
    assert (saved['dateRange'], saved['clearedFilter'], saved['categoryFilter']) == ('next30', 'cleared', 'Housing')
    assert page.evaluate(f"() => localStorage.getItem('{KEY}')") is None


@pytest.mark.feature
def test_server_value_wins_over_a_blob_that_arrives_after_migration(app_page, browser):
    """After the one-time migration the server copy rules. Context B migrates a
    blob (pageSize 10); context A then saves 100. B reloading shows 100: the
    removed blob cannot override the server, and B never writes the key again."""
    page = app_page
    _seed(page)
    context, page2 = _second_context_page(browser)
    try:
        page2.evaluate("""() => localStorage.setItem('debtTrackerLedgerFilters', JSON.stringify({ pageSize: 10 }))""")
        page2.reload()
        _open_ledger(page2)
        assert _ledger_dom(page2)['size'] == '10'
        _server_ledger(page2, lambda l: l.get('pageSize') == 10)
        assert page2.evaluate(f"() => localStorage.getItem('{KEY}')") is None

        _open_ledger(page)
        page.select_option('#ledgerPageSize', '100')
        _server_ledger(page, lambda l: l.get('pageSize') == 100)

        page2.reload()
        _open_ledger(page2)
        assert _ledger_dom(page2)['size'] == '100'
        page2.select_option('#ledgerCategoryFilter', 'Housing')
        _server_ledger(page2, lambda l: l.get('categoryFilter') == 'Housing')
        assert page2.evaluate(f"() => localStorage.getItem('{KEY}')") is None
    finally:
        context.close()


@pytest.mark.feature
def test_invalid_legacy_values_are_sanitized_on_migration(app_page):
    """Negative: a tampered blob (page size 7, unknown Status, oversized
    category) falls back to defaults instead of being sent to the server."""
    page = app_page
    _seed(page)
    page.evaluate("""() => localStorage.setItem('debtTrackerLedgerFilters', JSON.stringify({
        pageSize: 7, clearedFilter: 'bogus', categoryFilter: 'x'.repeat(500), dateRange: 'next30'
    }))""")
    page.reload()
    _open_ledger(page)
    saved = _server_ledger(page, lambda l: l.get('dateRange') == 'next30')
    assert saved['pageSize'] == 25
    assert saved['clearedFilter'] == 'all'
    assert len(saved['categoryFilter']) <= 40
    assert page.evaluate(f"() => localStorage.getItem('{KEY}')") is None
