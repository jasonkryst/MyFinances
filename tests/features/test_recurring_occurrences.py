#!/usr/bin/env python3
"""
Recurring Occurrence Edge Case Tests
Tests getRecurringOccurrencesInMonth (src/recurring.js) directly via dynamic
import for quarterly/yearly cadences and month-boundary day clamping.
"""

import pytest


def _occurrences(page, template, year, month):
    """Return ISO date strings for occurrences of `template` in the given year/month (0-indexed)."""
    return page.evaluate("""async ([template, year, month]) => {
        const mod = await import('/src/recurring.js');
        const dates = mod.getRecurringOccurrencesInMonth(template, year, month);
        return dates.map(d => d.toISOString());
    }""", [template, year, month])


@pytest.mark.feature
def test_quarterly_recurrence_only_on_three_month_intervals(app_page):
    """A quarterly template starting in January only occurs in Jan/Apr/Jul/Oct."""
    page = app_page

    template = {
        'name': 'Quarterly Fee', 'type': 'subscription', 'frequency': 'quarterly',
        'amount': 30, 'dayOfMonth': 1, 'startDate': '2026-01-01', 'endDate': None,
        'paused': False, 'skippedMonths': []
    }

    assert len(_occurrences(page, template, 2026, 0)) == 1, "Expected an occurrence in January (start month)"
    assert len(_occurrences(page, template, 2026, 1)) == 0, "Expected no occurrence in February"
    assert len(_occurrences(page, template, 2026, 2)) == 0, "Expected no occurrence in March"
    assert len(_occurrences(page, template, 2026, 3)) == 1, "Expected an occurrence in April (start + 3 months)"
    assert len(_occurrences(page, template, 2026, 6)) == 1, "Expected an occurrence in July (start + 6 months)"


@pytest.mark.feature
def test_yearly_recurrence_only_in_start_month(app_page):
    """A yearly template only occurs in the calendar month of its start date, every year."""
    page = app_page

    template = {
        'name': 'Annual Renewal', 'type': 'subscription', 'frequency': 'yearly',
        'amount': 120, 'dayOfMonth': 15, 'startDate': '2026-03-15', 'endDate': None,
        'paused': False, 'skippedMonths': []
    }

    assert len(_occurrences(page, template, 2026, 1)) == 0, "Expected no occurrence in February 2026"
    march_2026 = _occurrences(page, template, 2026, 2)
    assert len(march_2026) == 1, "Expected one occurrence in March 2026 (start month)"
    assert len(_occurrences(page, template, 2026, 3)) == 0, "Expected no occurrence in April 2026"

    # Recurs again the following year in the same month
    march_2027 = _occurrences(page, template, 2027, 2)
    assert len(march_2027) == 1, "Expected the yearly template to recur in March 2027"

    # Before the start date entirely, no occurrence
    assert len(_occurrences(page, template, 2025, 2)) == 0, "Expected no occurrence before the start date"


@pytest.mark.feature
def test_monthly_day_of_month_clamped_at_month_boundary(app_page):
    """A monthly template with dayOfMonth=31 clamps to the last day of shorter months."""
    page = app_page

    template = {
        'name': 'End of Month Bill', 'type': 'subscription', 'frequency': 'monthly',
        'amount': 50, 'dayOfMonth': 31, 'startDate': '2026-01-01', 'endDate': None,
        'paused': False, 'skippedMonths': []
    }

    # February 2026 has 28 days; occurrence should clamp to Feb 28, not roll into March
    feb_dates = _occurrences(page, template, 2026, 1)
    assert len(feb_dates) == 1, "Expected exactly one occurrence in February"
    assert feb_dates[0].startswith('2026-02-28'), f"Expected occurrence clamped to Feb 28, got {feb_dates[0]}"

    # January 2026 has 31 days; occurrence should land on Jan 31
    jan_dates = _occurrences(page, template, 2026, 0)
    assert jan_dates[0].startswith('2026-01-31'), f"Expected occurrence on Jan 31, got {jan_dates[0]}"

    # April 2026 has 30 days; occurrence should clamp to Apr 30
    apr_dates = _occurrences(page, template, 2026, 3)
    assert apr_dates[0].startswith('2026-04-30'), f"Expected occurrence clamped to Apr 30, got {apr_dates[0]}"


@pytest.mark.feature
def test_quarterly_recurrence_respects_end_date(app_page):
    """A quarterly template stops producing occurrences after its end date."""
    page = app_page

    template = {
        'name': 'Limited Quarterly', 'type': 'subscription', 'frequency': 'quarterly',
        'amount': 30, 'dayOfMonth': 1, 'startDate': '2026-01-01', 'endDate': '2026-03-31',
        'paused': False, 'skippedMonths': []
    }

    assert len(_occurrences(page, template, 2026, 0)) == 1, "Expected an occurrence in January (within range)"
    assert len(_occurrences(page, template, 2026, 3)) == 0, "Expected no occurrence in April (past end date)"
