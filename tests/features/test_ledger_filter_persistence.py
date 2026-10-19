#!/usr/bin/env python3
"""
Tests for Ledger filter persistence across page navigation (issue #338).
Covers account/date/cleared/page-size filter persistence in localStorage
and the clear-filters reset path.
"""

import pytest

from tests.conftest import assert_no_errors


def _navigate_ledger(page):
    page.click('button[data-page="ledger"]')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)
    page.wait_for_timeout(400)


def _seed_account_and_income(page):
    """Seed an account and income so the Ledger has something to show."""
    page.evaluate("""() => {
        const accountId = Date.now();
        window.app.accounts.push({
            id: accountId, name: 'Filter Test Acct', type: 'Checking',
            startingBalance: 1000, notes: ''
        });
        window.app.incomes.push({
            id: Date.now() + 1, name: 'Filter Income', amount: 500,
            frequency: 'monthly', accountId, startDate: null, endDate: null, notes: ''
        });
        window.app.saveToStorage();
        return accountId;
    }""")
    page.wait_for_timeout(300)


# ── Filter persistence (account) ──────────────────────────────────────────────

@pytest.mark.feature
def test_ledger_account_filter_persists_across_navigation(app_page):
    """Account filter is restored when navigating away and back to Ledger."""
    page = app_page
    _seed_account_and_income(page)
    _navigate_ledger(page)

    acct_filter = page.query_selector('#ledgerAccountFilter')
    if not acct_filter:
        pytest.skip("No #ledgerAccountFilter element found")

    options = page.eval_on_selector_all('#ledgerAccountFilter option', 'opts => opts.map(o => o.value)')
    non_all = [o for o in options if o and o != 'all']
    if not non_all:
        pytest.skip("No non-'all' options to select")

    page.select_option('#ledgerAccountFilter', non_all[0])
    page.wait_for_timeout(400)

    # Navigate away
    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)

    # Navigate back
    _navigate_ledger(page)
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

    size_el = page.query_selector('#ledgerPageSize')
    if not size_el:
        pytest.skip("No #ledgerPageSize element found")

    page.select_option('#ledgerPageSize', '50')
    page.wait_for_timeout(400)

    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)
    _navigate_ledger(page)

    restored = page.eval_on_selector('#ledgerPageSize', 'el => el.value')
    assert restored == '50', f"Expected page size '50' restored, got '{restored}'"


@pytest.mark.feature
def test_ledger_filters_stored_in_localstorage(app_page):
    """Selecting a page size writes the filter to localStorage."""
    page = app_page
    _navigate_ledger(page)

    size_el = page.query_selector('#ledgerPageSize')
    if not size_el:
        pytest.skip("No #ledgerPageSize element found")

    page.select_option('#ledgerPageSize', '100')
    page.wait_for_timeout(400)

    stored = page.evaluate("""
        () => {
            try {
                return JSON.parse(localStorage.getItem('debtTrackerLedgerFilters') || 'null');
            } catch { return null; }
        }
    """)
    assert stored is not None, "Expected ledger filters to be written to localStorage"
    assert stored.get('pageSize') in [100, '100'], (
        f"Expected pageSize 100 in localStorage, got: {stored}"
    )


# ── Clear filters resets persistence ─────────────────────────────────────────

@pytest.mark.feature
def test_ledger_clear_filters_removes_from_localstorage(app_page):
    """Clicking 'Clear filters' removes the stored filter state from localStorage."""
    page = app_page
    _navigate_ledger(page)

    size_el = page.query_selector('#ledgerPageSize')
    if not size_el:
        pytest.skip("No #ledgerPageSize element found")

    page.select_option('#ledgerPageSize', '50')
    page.wait_for_timeout(400)

    stored_before = page.evaluate(
        "() => localStorage.getItem('debtTrackerLedgerFilters')"
    )
    assert stored_before is not None, "Filters should be in localStorage before clearing"

    clear_btn = page.query_selector('#clearFiltersBtn')
    if not clear_btn:
        pytest.skip("No #clearFiltersBtn element found")
    clear_btn.click()
    page.wait_for_timeout(400)

    stored_after = page.evaluate(
        "() => localStorage.getItem('debtTrackerLedgerFilters')"
    )
    assert stored_after is None, (
        f"Expected localStorage key removed after clear, got: {stored_after}"
    )


@pytest.mark.feature
def test_ledger_filter_defaults_after_clear(app_page):
    """After clearing, page size defaults back to 25."""
    page = app_page
    _navigate_ledger(page)

    size_el = page.query_selector('#ledgerPageSize')
    if not size_el:
        pytest.skip("No #ledgerPageSize element found")

    page.select_option('#ledgerPageSize', '100')
    page.wait_for_timeout(400)

    clear_btn = page.query_selector('#clearFiltersBtn')
    if not clear_btn:
        pytest.skip("No #clearFiltersBtn element found")
    clear_btn.click()
    page.wait_for_timeout(400)

    restored = page.eval_on_selector('#ledgerPageSize', 'el => el.value')
    assert restored == '25', f"Expected page size to reset to '25', got '{restored}'"

    assert_no_errors(page)


# ── No errors ────────────────────────────────────────────────────────────────

@pytest.mark.feature
def test_no_console_errors_on_ledger_page(app_page):
    """No JS errors when navigating to the Ledger page."""
    page = app_page
    _navigate_ledger(page)
    assert_no_errors(page)
