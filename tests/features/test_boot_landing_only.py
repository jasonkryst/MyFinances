#!/usr/bin/env python3
"""
Boot renders only the landing page (issue #525).
Hidden pages (the Liabilities debt list, the Plan results) are rendered on
their first visit instead of during boot. No timing assertions: the checks
are DOM state, not durations.
"""

import pytest

from tests.conftest import create_debt, wait_for_api, wait_for_app_ready


def _seed_debt_and_plan(page):
    create_debt(page, {
        "name": "Boot Debt", "type": "creditCard",
        "balance": "2000", "interest_rate": "15", "min_payment": "50"
    })
    page.click('button[data-page="strategy"]')
    page.wait_for_selector('#strategySection.active', timeout=5000)
    page.fill('#monthlyPayment', '200')
    page.select_option('#paymentStrategy', 'avalanche')
    page.click('#calculateBtn')
    page.wait_for_selector('#resultsSection.visible', timeout=10000)
    wait_for_api(page, '/api/plan-settings', lambda j: j.get('monthlyPayment'))
    page.reload()
    page.wait_for_selector('#healthSection.active', timeout=10000)


@pytest.mark.feature
def test_boot_does_not_render_hidden_pages(app_page):
    page = app_page
    _seed_debt_and_plan(page)
    state = page.evaluate("""() => ({
        debtCards: document.querySelectorAll('#debtsList .debt-card').length,
        resultsVisible: document.getElementById('resultsSection').classList.contains('visible'),
        planCalculated: !!window.app.lastSummary,
        debts: window.app.debts.length,
    })""")
    assert state["debts"] == 1
    # The plan is computed at boot (Health reads its summary) ...
    assert state["planCalculated"]
    # ... but the hidden pages' DOM is not built.
    assert state["debtCards"] == 0
    assert state["resultsVisible"] is False


@pytest.mark.feature
def test_first_visit_renders_liabilities_and_plan(app_page):
    page = app_page
    _seed_debt_and_plan(page)
    page.click('button[data-page="liabilities"]')
    page.wait_for_selector('#debtsList .debt-card', timeout=5000)
    assert 'Boot Debt' in page.inner_text('#debtsList')
    page.click('button[data-page="strategy"]')
    page.wait_for_selector('#resultsSection.visible', timeout=5000)
    assert page.evaluate("() => !!window.app.lastSummary") is True
    assert page.locator('#resultsSection').inner_text().strip() != ''


@pytest.mark.feature
def test_mutation_on_other_page_shows_on_liabilities(app_page):
    """Regression: a debt added while another page is open still shows up."""
    page = app_page
    _seed_debt_and_plan(page)
    page.click('button[data-page="accounts"]')
    page.evaluate("() => { window.app.debts[0].name = 'Renamed Debt'; window.app.updateUI(); }")
    page.click('button[data-page="liabilities"]')
    page.wait_for_selector('#debtsList .debt-card', timeout=5000)
    assert 'Renamed Debt' in page.inner_text('#debtsList')
    assert 'Boot Debt' not in page.inner_text('#debtsList')


@pytest.mark.feature
def test_empty_boot_still_ready_on_health(app_page):
    """Negative: with no data nothing is deferred and the app is still ready."""
    page = app_page
    wait_for_app_ready(page)
    assert page.evaluate("() => window.app._planDisplayPending !== true")
    assert page.locator('#healthSection.active').count() == 1
