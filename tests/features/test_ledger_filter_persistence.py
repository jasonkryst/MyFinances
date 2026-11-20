#!/usr/bin/env python3
"""
Tests for Ledger filter persistence across page navigation (issue #338).
Covers account/date/cleared/page-size filter persistence and the
clear-filters reset path. Since #571 the filters live on the server
(plan_settings.ledger_settings); localStorage only holds a pre-#571 copy that
is migrated once (see test_ledger_filters_server.py for the cross-browser case).

Issue #544: the clear-filters tests looked for #clearFiltersBtn (the app's id
is #ledgerClearFiltersBtn) and skipped whenever an element was missing, so they
never ran. A missing control now fails the test.
"""

from datetime import date

import pytest

from tests.conftest import assert_no_errors, seed_state, wait_for_api

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


def _server_ledger(page, check):
    """Wait until the server's ledgerSettings satisfy check(), and return them."""
    return wait_for_api(page, '/api/plan-settings',
                        lambda b: check(b.get('ledgerSettings') or {}))['ledgerSettings']


def _clear_filters(page):
    """Click Clear filters (it only renders while a filter is active) and wait
    until the server copy is back to the defaults."""
    page.locator('#ledgerClearFiltersBtn').click()
    _server_ledger(page, lambda l: l.get('pageSize') == 25 and l.get('clearedFilter') == 'all'
                   and l.get('categoryFilter') == 'all' and l.get('dateRange') == 'around7')


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
    _server_ledger(page, lambda l: l.get('pageSize') == 50)

    _away_and_back(page)
    restored = page.eval_on_selector('#ledgerPageSize', 'el => el.value')
    assert restored == '50', f"Expected page size '50' restored, got '{restored}'"


@pytest.mark.feature
def test_ledger_filters_stored_on_server_not_in_localstorage(app_page):
    """Selecting a page size saves it on the server (#571) and writes nothing
    to localStorage."""
    page = app_page
    _navigate_ledger(page)

    page.select_option('#ledgerPageSize', '100')
    saved = _server_ledger(page, lambda l: l.get('pageSize') == 100)
    assert saved['categoryFilter'] == 'all'
    assert _stored(page) is None, "Filters must no longer be written to localStorage"


# ── Clear filters resets persistence ─────────────────────────────────────────

@pytest.mark.feature
def test_clear_filters_button_hidden_without_active_filters(app_page):
    """Negative: with only defaults selected there is nothing to clear."""
    page = app_page
    _navigate_ledger(page)
    assert page.locator('#ledgerClearFiltersBtn').count() == 0


@pytest.mark.feature
def test_ledger_clear_filters_resets_server_copy(app_page):
    """Clicking 'Clear filters' resets every saved filter on the server, the
    page size included (#571)."""
    page = app_page
    _seed_account_and_income(page)
    _navigate_ledger(page)

    page.select_option('#ledgerPageSize', '50')
    page.select_option('#ledgerDateRange', 'all')   # an active filter shows the button
    page.wait_for_selector('#ledgerClearFiltersBtn', timeout=5000)
    before = _server_ledger(page, lambda l: l.get('pageSize') == 50 and l.get('dateRange') == 'all')
    assert before['categoryFilter'] == 'all'

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


# ── First-visit restore through cross-navigation links (#645) ────────────────
# Accounts' and Spending's "View in Ledger" set their own filters. Since #571
# the saved filters are the server's, already in app state at boot.

SAVED = {'accountFilter': 'ACCT', 'dateRange': 'next30', 'clearedFilter': 'cleared',
         'pageSize': 50, 'categoryFilter': 'Housing'}


def _seed_cross_nav(page):
    """Seed an account (id 9301) and a categorised expense, save non-default
    filters on the SERVER, and reload so the next Ledger visit is the session's
    first. Returns (account id, the saved filters)."""
    seed_state(page, {
        'version': '3.0',
        'accounts': [{'id': 9301, 'name': 'Cross Nav Acct', 'type': 'Checking', 'startingBalance': 1000}],
        'expenses': [{'id': 9302, 'name': 'Rent', 'category': 'Food', 'budgetAmount': 100,
                      'date': date.today().replace(day=1).isoformat(), 'accountId': 9301}],
    })
    acct_id = str(page.evaluate("() => app.accounts[0].id"))
    saved = dict(SAVED, accountFilter=acct_id)
    page.evaluate("""(s) => {
        app._ledgerAccountFilter = s.accountFilter; app._ledgerDateRange = s.dateRange;
        app._ledgerClearedFilter = s.clearedFilter; app._ledgerPageSize = s.pageSize;
        app._ledgerCategoryFilter = s.categoryFilter;
        app.saveToStorage(['ledgerSettings']);
    }""", saved)
    _server_ledger(page, lambda l: l.get('categoryFilter') == 'Housing' and l.get('pageSize') == 50)
    page.reload()
    return acct_id, saved


def _ledger_state(page):
    return page.evaluate("""() => ({
        account: app._ledgerAccountFilter, date: app._ledgerDateRange, cleared: app._ledgerClearedFilter,
        pageSize: app._ledgerPageSize, category: app._ledgerCategoryFilter,
        domSize: document.getElementById('ledgerPageSize')?.value,
        domCleared: document.getElementById('ledgerClearedFilter')?.value,
    })""")


def _open_spending_drilldown(page):
    page.click('button[data-page="reports"]')
    page.wait_for_selector('#reportsSection.active', timeout=5000)
    page.evaluate("async () => { app.renderReportsPage && await app.renderReportsPage(); }")
    page.click('[data-rptab="spending"]')
    page.wait_for_selector('#rptPanel-spending.rpt-tab-panel--active', timeout=5000)
    page.click('[data-spending-cat="Food"]')
    page.wait_for_selector('#spendingDrilldownModal:not(.hidden)', timeout=5000)
    page.click('#spendingDrilldownViewLedgerBtn')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)
    page.wait_for_selector('#ledgerPageSize', timeout=5000)


@pytest.mark.feature
def test_accounts_view_in_ledger_first_visit_with_saved_filters(app_page):
    """Accounts' link forces account/category/date and shows every Status; the
    server's saved page size still applies, and the saved copy is untouched."""
    page = app_page
    acct_id, saved = _seed_cross_nav(page)
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)
    page.click(f'[data-account-action="breakdown"][data-account-id="{acct_id}"]')
    page.wait_for_selector('#acctBreakdownModal:not(.hidden)', timeout=5000)
    page.click('#acctBreakdownViewLedgerBtn')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)
    page.wait_for_selector('#ledgerPageSize', timeout=5000)

    s = _ledger_state(page)
    assert (str(s['account']), s['date'], s['category']) == (acct_id, 'all', 'all')
    assert s['domCleared'] == 'all', s
    assert s['domSize'] == '50', s
    server = _server_ledger(page, lambda l: True)
    assert (server['accountFilter'], server['dateRange'], server['categoryFilter']) == (acct_id, 'next30', 'Housing')
    assert _stored(page) is None


@pytest.mark.feature
def test_spending_view_in_ledger_first_visit_with_saved_filters(app_page):
    """Spending's link forces category/account/date/Status; the saved
    account/date/category survive as the pre-cross-nav values and on the
    server when an unrelated control is re-saved."""
    page = app_page
    acct_id, _ = _seed_cross_nav(page)
    _open_spending_drilldown(page)

    s = _ledger_state(page)
    assert (s['account'], s['date'], s['category']) == ('all', 'all', 'Food')
    assert s['domCleared'] == 'all', s
    pre = page.evaluate("() => [app._ledgerPreCrossNavAccount, app._ledgerPreCrossNavDateRange, app._ledgerPreCrossNavCategory]")
    assert pre == [acct_id, 'next30', 'Housing']
    # Touching an unrelated control re-saves: the saved account/date/category stay.
    page.select_option('#ledgerPageSize', '10')
    stored = _server_ledger(page, lambda l: l.get('pageSize') == 10)
    assert (stored['accountFilter'], stored['dateRange'], stored['categoryFilter']) == (acct_id, 'next30', 'Housing')


@pytest.mark.feature
def test_ledger_first_visit_applies_every_server_filter(app_page):
    """Negative control: a plain first Ledger visit shows the whole server copy,
    so the cross-nav overrides above are deliberate, not a broken restore."""
    page = app_page
    acct_id, _ = _seed_cross_nav(page)
    _navigate_ledger(page)
    s = _ledger_state(page)
    assert (s['account'], s['date'], s['cleared'], s['category']) == (acct_id, 'next30', 'cleared', 'Housing')
    assert s['domSize'] == '50'
