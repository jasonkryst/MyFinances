#!/usr/bin/env python3
"""
First-paint split tests (GitHub issue #713).

src/app.js statically imports only what Health (the landing page) needs; the
page renderers, forms and modals come from src/appFeatures.js, which boot
imports once Health has painted (tests/unit/firstPaintModules.test.js budgets
the static graph itself). These tests cover the browser behaviour: the
modules are requested after the landing page, every page still renders, and a
failed load degrades to the in-page error instead of an unhandled rejection.
"""

import pytest

from tests.conftest import wait_for_app_ready

# (page name, section id that must become active)
PAGES = [
    ('accounts', 'accountsSection'),
    ('liabilities', 'liabilitiesSection'),
    ('income', 'incomeSection'),
    ('savings', 'savingsSection'),
    ('strategy', 'strategySection'),
    ('reports', 'reportsSection'),
    ('ledger', 'ledgerSection'),
    ('recurring', 'recurringSection'),
    ('people', 'peopleSection'),
]


@pytest.fixture
def blocked_page(app_page_no_sw):
    """Service workers blocked so page.route() is in charge."""
    return app_page_no_sw


@pytest.mark.feature
def test_every_page_renders_after_the_split(app_page):
    page = app_page
    for name, section in PAGES:
        page.evaluate("name => window.app.switchPage(name)", name)
        page.wait_for_selector(f'#{section}.active', timeout=10000)
        assert page.locator(f'#{section} .lazy-load-error').count() == 0, name
    assert page.page_errors == [], f"Unexpected page errors: {page.page_errors}"


@pytest.mark.feature
def test_feature_modules_load_after_the_landing_page(app_page):
    page = app_page
    names = page.evaluate(
        "() => performance.getEntriesByType('resource')"
        ".filter(r => r.name.includes('/src/')).map(r => r.name.split('/').pop())")
    assert 'appFeatures.js' in names
    assert 'health.js' in names
    start = {n: page.evaluate(
        "n => performance.getEntriesByType('resource').find(r => r.name.endsWith('/src/' + n)).startTime", n)
        for n in ('health.js', 'appFeatures.js', 'ledger.js')}
    assert start['appFeatures.js'] > start['health.js']
    assert start['ledger.js'] > start['appFeatures.js']


@pytest.mark.feature
def test_failed_feature_load_shows_in_page_error_and_keeps_the_app_up(blocked_page):
    page = blocked_page
    page.route("**/src/appFeatures.js", lambda route: route.abort())
    page.reload()
    wait_for_app_ready(page)
    page.wait_for_selector('#healthSection .lazy-load-error', timeout=10000)

    page.evaluate("() => window.app.switchPage('ledger')")
    page.wait_for_selector('#ledgerSection .lazy-load-error', timeout=10000)
    assert page.page_errors == [], f"Unexpected page errors: {page.page_errors}"

    # Once the network is back, visiting the page loads it (a failure is not cached).
    page.unroute("**/src/appFeatures.js")
    page.evaluate("() => window.app.switchPage('accounts')")
    page.wait_for_selector('#accountsSection.active', timeout=10000)
    page.wait_for_function(
        "() => document.querySelector('#accountsSection .lazy-load-error') === null", timeout=10000)
