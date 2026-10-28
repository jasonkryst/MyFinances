#!/usr/bin/env python3
"""
Dynamic import() code-splitting tests (GitHub issue #278).

src/app.js previously imported every feature module statically, so the whole
module graph -- including pages most sessions never visit (Retirement,
Reconciliation, several Reports sub-tabs, the Strategy page's Calendar
sub-tab) -- was fetched and evaluated before DOMContentLoaded fired.
src/lazyModules.js now wraps native ES module dynamic import() with a
cache-once-per-key loader, and the entry-point render methods on
DebtTrackerApp (renderRetirementPage, renderReconciliationPage,
openReconcileModal, renderCalendarView, reports.js's renderReportsPage for
its five lazy sub-tabs) await it before delegating.

See docs/superpowers/specs/2026-10-25-dynamic-import-code-splitting-design.md
for the full design, including why reportsNetWorth.js/forecast.js/spending.js
were deliberately kept static.
"""

import pytest


LAZY_MODULE_PATHS = [
    'src/retirement.js',
    'src/retirementCalculator.js',
    'src/reconciliation.js',
    'src/strategyCalendar.js',
    'src/reportsCalendar.js',
    'src/reportsMoneyFlowSankey.js',
    'src/reportsCashFlow.js',
    'src/reportsVariance.js',
    'src/reportsSummary.js',
]


def _resource_urls(page):
    return page.evaluate("() => performance.getEntriesByType('resource').map(e => e.name)")


def _seed_minimal(page):
    """One account + one debt so pages that branch on empty state still render
    their normal (non-empty) markup, matching pre-change behavior."""
    page.wait_for_function("() => window.app && window.app.accounts !== undefined", timeout=20000)
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 9101, name: 'CS Checking', type: 'Checking', startingBalance: 500 }];
        app.debts = [];
        app.incomes = []; app.bonuses = []; app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = [];
    }""")


def _track_requests(page, substring):
    hits = []
    page.on('request', lambda req: hits.append(req.url) if substring in req.url else None)
    return hits


# ---------------------------------------------------------------------------
# Positive: not fetched until needed
# ---------------------------------------------------------------------------

@pytest.mark.feature
def test_lazy_modules_not_fetched_before_navigation(app_page):
    """None of the lazy-loaded modules should appear in the resource timing
    list captured right after initial load, before any page navigation."""
    page = app_page
    urls = _resource_urls(page)
    fetched = [p for p in LAZY_MODULE_PATHS if any(u.endswith('/' + p) or u.endswith(p) for u in urls)]
    assert fetched == [], f"These lazy modules were fetched on initial load: {fetched}"


@pytest.mark.feature
def test_retirement_module_fetched_once_across_repeated_navigations(app_page):
    page = app_page
    _seed_minimal(page)
    hits = _track_requests(page, 'src/retirement.js')

    page.evaluate("() => window.app.switchPage('retirement')")
    page.wait_for_selector('#retirementSection', state='visible', timeout=10000)
    page.wait_for_timeout(200)

    page.evaluate("() => window.app.switchPage('health')")
    page.evaluate("() => window.app.switchPage('retirement')")
    page.wait_for_timeout(200)

    assert len(hits) == 1, f"Expected retirement.js fetched exactly once, got {len(hits)}: {hits}"


@pytest.mark.feature
def test_reconciliation_module_fetched_once_across_repeated_navigations(app_page):
    page = app_page
    _seed_minimal(page)
    hits = _track_requests(page, 'src/reconciliation.js')

    page.evaluate("() => window.app.switchPage('reconcile')")
    page.wait_for_selector('#reconcileSection', state='visible', timeout=10000)
    page.wait_for_timeout(200)

    page.evaluate("() => window.app.switchPage('health')")
    page.evaluate("() => window.app.switchPage('reconcile')")
    page.wait_for_timeout(200)

    assert len(hits) == 1, f"Expected reconciliation.js fetched exactly once, got {len(hits)}: {hits}"


@pytest.mark.feature
def test_reports_calendar_submodule_fetched_once_across_repeated_navigations(app_page):
    """Reports page defaults to the Calendar sub-tab, which is one of the five
    lazily-loaded Reports sub-modules."""
    page = app_page
    _seed_minimal(page)
    hits = _track_requests(page, 'src/reportsCalendar.js')

    page.evaluate("() => window.app.switchPage('reports')")
    page.wait_for_timeout(300)

    page.evaluate("() => window.app.switchPage('health')")
    page.evaluate("() => window.app.switchPage('reports')")
    page.wait_for_timeout(300)

    assert len(hits) == 1, f"Expected reportsCalendar.js fetched exactly once, got {len(hits)}: {hits}"


@pytest.mark.feature
def test_reports_page_renders_calendar_tab_content(app_page):
    """Content parity check -- the lazily-loaded Reports Calendar tab still
    renders its normal markup (day-of-week headers), not a blank panel."""
    page = app_page
    _seed_minimal(page)
    page.evaluate("() => window.app.switchPage('reports')")
    page.wait_for_function(
        "() => { const el = document.getElementById('reportsCalendar'); return el && el.textContent.includes('Sun'); }",
        timeout=10000
    )


@pytest.mark.feature
def test_strategy_calendar_module_fetched_on_calendar_subtab(app_page):
    page = app_page
    _seed_minimal(page)
    hits = _track_requests(page, 'src/strategyCalendar.js')

    page.evaluate("() => window.app.switchPage('strategy')")
    page.wait_for_timeout(200)
    assert len(hits) == 0, "strategyCalendar.js should not load just from visiting the Strategy page"

    page.evaluate("() => window.app.switchTab('calendar')")
    page.wait_for_timeout(300)
    assert len(hits) == 1, f"Expected strategyCalendar.js fetched exactly once, got {len(hits)}: {hits}"

    # Switching tabs away and back must not re-fetch.
    page.evaluate("() => window.app.switchTab('tabular')")
    page.evaluate("() => window.app.switchTab('calendar')")
    page.wait_for_timeout(200)
    assert len(hits) == 1, f"Expected strategyCalendar.js still fetched only once, got {len(hits)}: {hits}"


@pytest.mark.feature
def test_ledger_reconcile_button_loads_reconciliation_module_cold(app_page):
    """The Ledger page's "Reconcile this account" button is a second cold
    entry point into reconciliation.js -- it must work even if the user has
    never visited the Reconcile nav page."""
    page = app_page
    _seed_minimal(page)
    hits = _track_requests(page, 'src/reconciliation.js')

    page.evaluate("() => window.app.switchPage('ledger')")
    page.wait_for_selector('#ledgerAccountFilter', timeout=10000)
    page.select_option('#ledgerAccountFilter', '9101')
    page.wait_for_selector('#reconcileFromLedgerBtn', timeout=10000)

    assert len(hits) == 0, "reconciliation.js should not be fetched just from viewing Ledger"

    page.click('#reconcileFromLedgerBtn')
    page.wait_for_selector('#reconcileModal.flex-visible', timeout=10000)
    page.wait_for_selector('#reconcileModalBalance:focus', timeout=5000)  # 30ms autofocus (see #422)
    page.wait_for_timeout(200)
    assert len(hits) == 1, f"Expected reconciliation.js fetched exactly once, got {len(hits)}: {hits}"


# ---------------------------------------------------------------------------
# Negative: a failed import() degrades gracefully
# ---------------------------------------------------------------------------

@pytest.mark.feature
def test_retirement_module_load_failure_shows_in_page_error(app_page):
    page = app_page
    _seed_minimal(page)
    page.route("**/src/retirement.js", lambda route: route.abort())

    page.evaluate("() => window.app.switchPage('retirement')")
    page.wait_for_selector('#retirementSection .lazy-load-error', timeout=10000)

    text = page.inner_text('#retirementSection .lazy-load-error')
    assert 'retirement' in text.lower() or "couldn't load" in text.lower()

    # No uncaught exception/unhandled rejection should have reached the page.
    assert page.page_errors == [], f"Unexpected page errors: {page.page_errors}"

    # The app must stay usable -- switching to an unrelated page still works.
    page.evaluate("() => window.app.switchPage('health')")
    page.wait_for_selector('#healthSection', state='visible', timeout=10000)


@pytest.mark.feature
def test_reconciliation_module_load_failure_shows_in_page_error(app_page):
    page = app_page
    _seed_minimal(page)
    page.route("**/src/reconciliation.js", lambda route: route.abort())

    page.evaluate("() => window.app.switchPage('reconcile')")
    page.wait_for_selector('#reconcileSection .lazy-load-error', timeout=10000)

    assert page.page_errors == [], f"Unexpected page errors: {page.page_errors}"

    page.evaluate("() => window.app.switchPage('accounts')")
    page.wait_for_selector('#accountsSection', state='visible', timeout=10000)


@pytest.mark.feature
def test_reconciliation_module_load_failure_via_ledger_shows_alert(app_page):
    """The Ledger cross-page entry point has no Reconcile-page DOM to host an
    inline error, so a failed import shows the alert-modal error path instead."""
    page = app_page
    _seed_minimal(page)
    page.route("**/src/reconciliation.js", lambda route: route.abort())

    page.evaluate("() => window.app.switchPage('ledger')")
    page.wait_for_selector('#ledgerAccountFilter', timeout=10000)
    page.select_option('#ledgerAccountFilter', '9101')
    page.wait_for_selector('#reconcileFromLedgerBtn', timeout=10000)
    page.click('#reconcileFromLedgerBtn')

    page.wait_for_selector('text=/.*check your connection.*/i', timeout=10000)
    assert page.page_errors == [], f"Unexpected page errors: {page.page_errors}"


@pytest.mark.feature
def test_reports_calendar_tab_load_failure_shows_error_in_its_own_panel(app_page):
    page = app_page
    _seed_minimal(page)
    page.route("**/src/reportsCalendar.js", lambda route: route.abort())

    page.evaluate("() => window.app.switchPage('reports')")
    page.wait_for_selector('#rptPanel-calendar .lazy-load-error', timeout=10000)

    assert page.page_errors == [], f"Unexpected page errors: {page.page_errors}"

    # The rest of the app stays usable.
    page.evaluate("() => window.app.switchPage('accounts')")
    page.wait_for_selector('#accountsSection', state='visible', timeout=10000)
    page.evaluate("() => window.app.switchPage('reports')")
    # A second failed attempt (still blocked) must not throw either -- the
    # cache-clear-on-failure retry path is exercised again cleanly.
    page.wait_for_selector('#rptPanel-calendar .lazy-load-error', timeout=10000)
    assert page.page_errors == [], f"Unexpected page errors after retry: {page.page_errors}"
