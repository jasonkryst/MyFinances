#!/usr/bin/env python3
"""
Tests for the plan stale warning banner on the Strategy page (issue #325).
Covers banner absent before calculation, absent immediately after calculation,
and visible after debt data changes post-calculation.
"""

import pytest

from tests.conftest import assert_no_errors


def _add_debt(page, name="Test Debt", balance="5000", rate="15", min_payment="100"):
    page.click('button[data-page="liabilities"]')
    page.wait_for_selector('#liabilitiesSection.active', timeout=5000)
    page.fill('#debtName', name)
    page.fill('#debtBalance', balance)
    page.fill('#debtInterestRate', rate)
    page.fill('#debtMinPayment', min_payment)
    page.click('#debtFormSubmit')
    page.wait_for_timeout(300)


def _navigate_to_strategy(page):
    page.click('button[data-page="strategy"]')
    page.wait_for_selector('#strategySection.active', timeout=5000)
    page.wait_for_timeout(300)


def _run_plan(page, monthly="500"):
    page.fill('#monthlyPayment', monthly)
    page.click('#calculateBtn')
    page.wait_for_selector('#resultsSection:not(.hidden)', timeout=10000)
    page.wait_for_timeout(300)


# ── Banner absent before plan is run ─────────────────────────────────────────

@pytest.mark.feature
def test_stale_banner_hidden_before_plan_run(app_page):
    """Stale warning banner is hidden when no plan has been calculated yet."""
    page = app_page
    _add_debt(page)
    _navigate_to_strategy(page)

    banner = page.query_selector('#planStaleWarning')
    assert banner, "#planStaleWarning element should exist in DOM"
    assert not banner.is_visible(), "Stale banner should be hidden before any plan is run"


# ── Banner absent immediately after calculation ──────────────────────────────

@pytest.mark.feature
def test_stale_banner_hidden_after_fresh_calculation(app_page):
    """Stale warning banner is hidden immediately after running a plan."""
    page = app_page
    _add_debt(page)
    _navigate_to_strategy(page)
    _run_plan(page)

    banner = page.query_selector('#planStaleWarning')
    assert banner, "#planStaleWarning element not found"
    assert not banner.is_visible(), "Stale banner should be hidden immediately after calculation"

    assert_no_errors(page)


# ── Banner appears after debt data changes ────────────────────────────────────

@pytest.mark.feature
def test_stale_banner_visible_after_debt_balance_change(app_page):
    """Stale banner appears when a debt's balance is changed after the plan is run."""
    page = app_page
    _add_debt(page, name="Stale Test Debt", balance="5000")
    _navigate_to_strategy(page)
    _run_plan(page)

    # Mutate a debt balance to make the fingerprint stale
    page.evaluate("""() => {
        const d = window.app.debts.find(d => d.name === 'Stale Test Debt');
        if (d) {
            d.accountBalance = 4500;
            window.app.saveToStorage();
        }
    }""")
    _navigate_to_strategy(page)
    page.wait_for_timeout(400)

    banner = page.query_selector('#planStaleWarning')
    assert banner and banner.is_visible(), (
        "Stale banner should appear after debt balance changed post-calculation"
    )


@pytest.mark.feature
def test_stale_banner_visible_after_new_debt_added(app_page):
    """Stale banner appears when a new debt is added after running a plan."""
    page = app_page
    _add_debt(page, name="Original Debt")
    _navigate_to_strategy(page)
    _run_plan(page)

    # Add another debt
    _add_debt(page, name="New Debt After Plan")
    _navigate_to_strategy(page)
    page.wait_for_timeout(400)

    banner = page.query_selector('#planStaleWarning')
    assert banner and banner.is_visible(), (
        "Stale banner should appear when a new debt is added after plan calculation"
    )


# ── Recalculate button clears the banner ─────────────────────────────────────

@pytest.mark.feature
def test_stale_banner_clears_after_recalculate(app_page):
    """Clicking Recalculate on the stale banner re-runs the plan and hides the banner."""
    page = app_page
    _add_debt(page, name="RC Debt", balance="5000")
    _navigate_to_strategy(page)
    _run_plan(page)

    page.evaluate("""() => {
        const d = window.app.debts.find(d => d.name === 'RC Debt');
        if (d) { d.accountBalance = 4000; window.app.saveToStorage(); }
    }""")
    _navigate_to_strategy(page)
    page.wait_for_timeout(400)

    banner = page.query_selector('#planStaleWarning')
    assert banner and banner.is_visible(), "Banner should be visible before recalculating"

    page.click('#planStaleRecalcBtn')
    page.wait_for_selector('#resultsSection:not(.hidden)', timeout=10000)
    page.wait_for_timeout(300)

    assert not banner.is_visible(), "Stale banner should be hidden after clicking Recalculate"
    assert_no_errors(page)


# ── No banner when no debts ──────────────────────────────────────────────────

@pytest.mark.feature
def test_stale_banner_not_shown_with_no_debts(app_page):
    """Stale banner is not shown when there are no debts at all."""
    page = app_page
    _navigate_to_strategy(page)

    banner = page.query_selector('#planStaleWarning')
    assert banner is None or not banner.is_visible(), (
        "Stale banner should not appear when there are no debts"
    )
