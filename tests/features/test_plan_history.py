#!/usr/bin/env python3
"""
Plan History Tests (issue #162)
Submitting a payment plan calculation records a read-only history entry,
capped at the 20 most recent submissions, and the last plan silently
restores/displays on the next load.
"""

import pytest

from tests.conftest import create_debt, assert_no_errors


def _create_debt(page):
    create_debt(page, {
        "name": "History Debt", "type": "creditCard",
        "balance": "2000", "interest_rate": "15", "min_payment": "50"
    })


def _calculate(page, monthly_payment="200", strategy="avalanche"):
    page.click('button[data-page="strategy"]')
    page.wait_for_timeout(300)
    page.fill('#monthlyPayment', monthly_payment)
    page.select_option('#paymentStrategy', strategy)
    page.click('#calculateBtn')
    page.wait_for_timeout(500)


@pytest.mark.feature
def test_calculate_records_plan_history_entry(app_page):
    """Submitting Calculate appends one entry to app.planHistory and the table."""
    page = app_page
    _create_debt(page)
    _calculate(page)

    history = page.evaluate("() => window.app.planHistory")
    assert len(history) == 1
    assert history[0]["strategy"] == "avalanche"
    assert history[0]["monthlyPayment"] == 200

    row_count = page.evaluate("() => document.querySelectorAll('#planHistoryBody tr').length")
    assert row_count == 1
    assert_no_errors(page)


@pytest.mark.feature
def test_repeated_calculations_show_newest_first(app_page):
    """Multiple Calculate submissions append multiple entries, newest first in the table."""
    page = app_page
    _create_debt(page)
    _calculate(page, monthly_payment="200", strategy="avalanche")
    _calculate(page, monthly_payment="250", strategy="snowball")

    history = page.evaluate("() => window.app.planHistory")
    assert len(history) == 2

    first_row_payment = page.evaluate(
        "() => document.querySelector('#planHistoryBody tr td:nth-child(2)').textContent"
    )
    assert "250" in first_row_payment, f"Expected newest entry (250) first, got {first_row_payment!r}"


@pytest.mark.feature
def test_plan_history_caps_at_twenty_entries(app_page):
    """Plan history keeps only the 20 most recent entries, trimming the oldest."""
    page = app_page
    _create_debt(page)

    # Seed 20 synthetic entries directly, then submit one real Calculate --
    # avoids 21 slow UI round-trips through the Calculate button.
    page.evaluate("""
        () => {
            window.app.planHistory = Array.from({ length: 20 }, (_, i) => ({
                id: i + 1, monthlyPayment: 100, strategy: 'avalanche',
                totalInterest: 10, monthsToPayOff: 5, payoffDate: null,
                totalDebt: 500, createdAt: new Date(2020, 0, i + 1).toISOString()
            }));
        }
    """)
    _calculate(page, monthly_payment="300", strategy="snowball")

    history = page.evaluate("() => window.app.planHistory")
    assert len(history) == 20, f"Expected history capped at 20 entries, got {len(history)}"
    assert history[-1]["strategy"] == "snowball", "Newest entry should survive the trim"
    assert history[0]["id"] == 2, "Oldest seeded entry (id=1) should have been trimmed"


@pytest.mark.feature
def test_target_payoff_calculator_does_not_record_history(app_page):
    """The Target Payoff Date back-calculator is exploratory and shouldn't add history entries."""
    page = app_page
    _create_debt(page)

    page.click('button[data-page="strategy"]')
    page.wait_for_timeout(300)
    page.click('#targetDateToggle')
    page.wait_for_timeout(200)
    page.fill('#targetPayoffDate', '2027-01-01')
    page.select_option('#targetPayoffStrategy', 'avalanche')
    page.click('#calcTargetBtn')
    page.wait_for_timeout(500)

    history = page.evaluate("() => window.app.planHistory")
    assert history == [], "Target Payoff Date calculator should not record plan history"


@pytest.mark.feature
def test_reload_restores_last_plan_results(app_page):
    """Reloading the app silently shows the previous plan's Results section
    without needing to click Calculate again (issue #162)."""
    page = app_page
    _create_debt(page)
    _calculate(page)

    page.reload(wait_until="networkidle")
    page.wait_for_timeout(500)
    page.click('button[data-page="strategy"]')
    page.wait_for_timeout(300)

    is_visible = page.evaluate(
        "() => document.getElementById('resultsSection').classList.contains('visible')"
    )
    assert is_visible, "Expected Results section to auto-show after reload with a saved plan"
    assert_no_errors(page)
