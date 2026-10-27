"""
Tests for issue #329's shared date-range helpers in src/utils.js:
getReportRangeMonths, reportRangeMonthsList, getPriorEquivalentRangeEnd,
and formatReportRangeLabel. These are consumed by both the Spending and
Variance reports to generalize their existing single-month comparison into
an N-month range ending at the currently-navigated report month.
"""

import pytest


@pytest.mark.feature
def test_report_range_months_list_single_month(app_page):
    """rangeMonths=1 returns just the one (year, month) pair."""
    page = app_page
    result = page.evaluate("""async () => {
        const mod = await import('/src/utils.js');
        return mod.reportRangeMonthsList(2026, 5, 1);
    }""")
    assert result == [{'year': 2026, 'month': 5}]


@pytest.mark.feature
def test_report_range_months_list_crosses_year_boundary(app_page):
    """A 3-month range ending in February correctly walks back through
    January into December of the prior year, oldest-first."""
    page = app_page
    result = page.evaluate("""async () => {
        const mod = await import('/src/utils.js');
        return mod.reportRangeMonthsList(2026, 1, 3);
    }""")
    assert result == [
        {'year': 2025, 'month': 11},
        {'year': 2026, 'month': 0},
        {'year': 2026, 'month': 1},
    ]


@pytest.mark.feature
def test_prior_equivalent_range_end_same_year(app_page):
    """For a 3-month range ending in September, the prior equivalent range
    ends in June (Jul-Sep vs Apr-Jun)."""
    page = app_page
    result = page.evaluate("""async () => {
        const mod = await import('/src/utils.js');
        return mod.getPriorEquivalentRangeEnd(2026, 8, 3);
    }""")
    assert result == {'year': 2026, 'month': 5}


@pytest.mark.feature
def test_prior_equivalent_range_end_crosses_year_boundary(app_page):
    """A 6-month range ending in February's prior range ends in August of
    the previous year."""
    page = app_page
    result = page.evaluate("""async () => {
        const mod = await import('/src/utils.js');
        return mod.getPriorEquivalentRangeEnd(2026, 1, 6);
    }""")
    assert result == {'year': 2025, 'month': 7}


@pytest.mark.feature
def test_format_report_range_label_single_month_unchanged(app_page):
    """rangeMonths<=1 keeps the original full month-name + year format."""
    page = app_page
    result = page.evaluate("""async () => {
        const mod = await import('/src/utils.js');
        return mod.formatReportRangeLabel(2026, 8, 1);
    }""")
    assert result == 'September 2026'


@pytest.mark.feature
def test_format_report_range_label_multi_month_same_year(app_page):
    """A range within one calendar year shows '<start short> - <end short year>'."""
    page = app_page
    result = page.evaluate("""async () => {
        const mod = await import('/src/utils.js');
        return mod.formatReportRangeLabel(2026, 8, 3);
    }""")
    assert result == 'Jul – Sep 2026'


@pytest.mark.feature
def test_format_report_range_label_crosses_year(app_page):
    """A range crossing a year boundary spells out the year on both ends."""
    page = app_page
    result = page.evaluate("""async () => {
        const mod = await import('/src/utils.js');
        return mod.formatReportRangeLabel(2026, 1, 3);
    }""")
    assert result == 'Dec 2025 – Feb 2026'


# ─────────────────────────── negative tests ───────────────────────────

@pytest.mark.feature
def test_get_report_range_months_defaults_to_one(app_page):
    """An app with no _reportRangeMonths set (or an invalid <=1 value)
    behaves as single-month mode."""
    page = app_page
    result = page.evaluate("""async () => {
        const mod = await import('/src/utils.js');
        return {
            unset: mod.getReportRangeMonths({}),
            zero: mod.getReportRangeMonths({ _reportRangeMonths: 0 }),
            negative: mod.getReportRangeMonths({ _reportRangeMonths: -3 }),
            valid: mod.getReportRangeMonths({ _reportRangeMonths: 6 }),
        };
    }""")
    assert result == {'unset': 1, 'zero': 1, 'negative': 1, 'valid': 6}
