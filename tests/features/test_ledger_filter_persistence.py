#!/usr/bin/env python3
"""
Tests for Ledger filter persistence across page navigation (issue #338).
Covers account/date/cleared/page-size filter persistence in localStorage
and the clear-filters reset path.

Issue #544: the clear-filters tests looked for #clearFiltersBtn (the app's id
is #ledgerClearFiltersBtn) and skipped whenever an element was missing, so they
never ran. A missing control now fails the test.
"""

from datetime import date

import pytest

from tests.conftest import assert_no_errors, seed_state

STORE_KEY = 'debtTrackerLedgerFilters'


def _navigate_ledger(page):
    page.click('button[data-page="ledger"]')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)
    page.wait_for_selector('#ledgerPageSize', timeout=5000)


def _away_and_back(page):
    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)
    _navigate_ledger(page)


def _seed_account_and_income(page):
    """An account with a monthly income, so the Ledger has rows and the
    account filter has a non-'all' option."""
    seed_state(page, {
        'version': '3.0',
        'accounts': [{'id': 1, 'name': 'Filter Test Acct', 'type': 'Checking', 'startingBalance': 1000}],
        'incomes': [{'id': 1, 'name': 'Filter Income', 'amount': 500, 'frequency': 'monthly',
                     'firstPayDate': date.today().replace(day=1).isoformat(), 'accountId': 1}],
    })


def _stored(page):
    return page.evaluate(f"() => JSON.parse(localStorage.getItem('{STORE_KEY}') || 'null')")


def _clear_filters(page):
    """Click Clear filters. It only renders while a filter is active."""
    page.locator('#ledgerClearFiltersBtn').click()
    page.wait_for_function(f"() => localStorage.getItem('{STORE_KEY}') === null", timeout=5000)


# ── Filter persistence (account) ──────────────────────────────────────────────

@pytest.mark.feature
def test_ledger_account_filter_persists_across_navigation(app_page):
    """Account filter is restored when navigating away and back to Ledger."""
    page = app_page
    _seed_account_and_income(page)
    _navigate_ledger(page)

    options = page.eval_on_selector_all('#ledgerAccountFilter option', 'opts => opts.map(o => o.value)')
    non_all = [o for o in options if o and o != 'all']
    assert non_all, f"the seeded account should be a filter option, got {options}"

    page.select_option('#ledgerAccountFilter', non_all[0])
    page.wait_for_function("(v) => document.getElementById('ledgerAccountFilter').value === v", arg=non_all[0])

    _away_and_back(page)
    restored = page.eval_on_selector('#ledgerAccountFilter', 'el => el.value')
    assert restored == non_all[0], (
        f"Expected account filter '{non_all[0]}' to be restored, got '{restored}'"
    )


# ── Filter persistence (page size) ────────────────────────────────────────────

@pytest.mark.feature
def test_ledger_page_size_persists_across_navigation(app_page):
    """Page size selection is restored when returning to the Ledger."""
    page = app_page
    _navigate_ledger(page)

    page.select_option('#ledgerPageSize', '50')
    page.wait_for_function("() => (JSON.parse(localStorage.getItem('debtTrackerLedgerFilters') || '{}')).pageSize == 50")

    _away_and_back(page)
    restored = page.eval_on_selector('#ledgerPageSize', 'el => el.value')
    assert restored == '50', f"Expected page size '50' restored, got '{restored}'"


@pytest.mark.feature
def test_ledger_filters_stored_in_localstorage(app_page):
    """Selecting a page size writes the filter to localStorage."""
    page = app_page
    _navigate_ledger(page)

    page.select_option('#ledgerPageSize', '100')
    page.wait_for_function(f"() => localStorage.getItem('{STORE_KEY}') !== null")

    stored = _stored(page)
    assert stored is not None, "Expected ledger filters to be written to localStorage"
    assert stored.get('pageSize') in [100, '100'], (
        f"Expected pageSize 100 in localStorage, got: {stored}"
    )


# ── Clear filters resets persistence ─────────────────────────────────────────

@pytest.mark.feature
def test_clear_filters_button_hidden_without_active_filters(app_page):
    """Negative: with only defaults selected there is nothing to clear."""
    page = app_page
    _navigate_ledger(page)
    assert page.locator('#ledgerClearFiltersBtn').count() == 0


@pytest.mark.feature
def test_ledger_clear_filters_removes_from_localstorage(app_page):
    """Clicking 'Clear filters' removes the stored filter state from localStorage."""
    page = app_page
    _seed_account_and_income(page)
    _navigate_ledger(page)

    page.select_option('#ledgerPageSize', '50')
    page.select_option('#ledgerDateRange', 'all')   # an active filter shows the button
    page.wait_for_selector('#ledgerClearFiltersBtn', timeout=5000)
    assert _stored(page) is not None, "Filters should be in localStorage before clearing"

    _clear_filters(page)
    assert _stored(page) is None
    assert page.eval_on_selector('#ledgerDateRange', 'el => el.value') == 'around7'
    assert page.locator('#ledgerClearFiltersBtn').count() == 0


@pytest.mark.feature
def test_ledger_filter_defaults_after_clear(app_page):
    """After clearing, the filters and page size are back to their defaults,
    and they stay that way across navigation."""
    page = app_page
    _seed_account_and_income(page)
    _navigate_ledger(page)

    page.select_option('#ledgerPageSize', '100')
    page.select_option('#ledgerClearedFilter', 'uncleared')
    page.wait_for_selector('#ledgerClearFiltersBtn', timeout=5000)

    _clear_filters(page)
    assert page.eval_on_selector('#ledgerClearedFilter', 'el => el.value') == 'all'
    assert page.eval_on_selector('#ledgerPageSize', 'el => el.value') == '25'

    _away_and_back(page)
    assert page.eval_on_selector('#ledgerClearedFilter', 'el => el.value') == 'all'
    assert page.eval_on_selector('#ledgerPageSize', 'el => el.value') == '25'

    assert_no_errors(page)


# ── No errors ────────────────────────────────────────────────────────────────

@pytest.mark.feature
def test_no_console_errors_on_ledger_page(app_page):
    """Navigating to the Ledger page should not produce console errors."""
    page = app_page
    _navigate_ledger(page)
    assert_no_errors(page)
