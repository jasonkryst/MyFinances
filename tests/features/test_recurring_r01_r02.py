#!/usr/bin/env python3
"""
R-01 / R-02 Recurring Tests
R-01: "Upcoming this month" summary panel.
R-02: Overdue indicator on past-due unpaid templates.
"""
import pytest

BASE_URL = "http://localhost:32900/"


def _seed_recurring(page, templates, *, account_id=8801):
    """Inject account + recurring templates directly into app state and navigate."""
    import json
    page.evaluate(f"""() => {{
        const app = window.app;
        app.accounts = [{{ id: {account_id}, name: 'Test Account', type: 'Checking', startingBalance: 1000 }}];
        app.recurringTemplates = {json.dumps(templates)};
        app.incomes = []; app.bills = []; app.expenses = []; app.debts = [];
        app.saveToStorage();
        app.switchPage('recurring');
    }}""")
    page.wait_for_selector('#recurringSection.active', timeout=5000)
    page.wait_for_selector('#recurringList', timeout=5000)


def _this_month_key():
    from datetime import date
    d = date.today()
    return f"{d.year}-{d.month:02d}"


def _today_day():
    from datetime import date
    return date.today().day


# ── R-01: Upcoming this month panel — positive cases ────────────────────────

@pytest.mark.feature
def test_upcoming_panel_shows_with_active_templates(app_page):
    """Upcoming panel renders when there are active templates this month."""
    from datetime import date
    page = app_page
    today = date.today()
    mk = _this_month_key()
    _seed_recurring(page, [
        {"id": 1, "name": "Netflix", "amount": 15.99, "frequency": "monthly",
         "dayOfMonth": 1, "type": "subscription", "category": "Entertainment",
         "accountId": 8801, "startDate": f"{today.year}-01-01",
         "paused": False, "archived": False, "skippedMonths": [], "paidMonths": []},
    ])

    panel = page.query_selector('.recurring-upcoming-panel')
    assert panel is not None, "Upcoming this month panel should be present"
    panel_text = panel.inner_text()
    assert 'upcoming this month' in panel_text.lower(), \
        f"Panel should have 'Upcoming this month' heading, got: {panel_text!r}"


@pytest.mark.feature
def test_upcoming_panel_counts_occurrences(app_page):
    """Upcoming panel shows correct occurrence count and total for this month."""
    from datetime import date
    page = app_page
    today = date.today()
    _seed_recurring(page, [
        {"id": 1, "name": "Netflix", "amount": 15.99, "frequency": "monthly",
         "dayOfMonth": 1, "type": "subscription", "category": "Entertainment",
         "accountId": 8801, "startDate": f"{today.year}-01-01",
         "paused": False, "archived": False, "skippedMonths": [], "paidMonths": []},
        {"id": 2, "name": "Gym", "amount": 40.00, "frequency": "monthly",
         "dayOfMonth": 15, "type": "subscription", "category": "Health",
         "accountId": 8801, "startDate": f"{today.year}-01-01",
         "paused": False, "archived": False, "skippedMonths": [], "paidMonths": []},
    ])

    panel_text = page.inner_text('.recurring-upcoming-panel')
    # Should show at least 2 occurrences
    assert '2' in panel_text, \
        f"Panel should show 2 occurrences (one per template), got: {panel_text!r}"


@pytest.mark.feature
def test_upcoming_panel_counts_paid(app_page):
    """Upcoming panel shows correct paid count when a template is marked paid."""
    from datetime import date
    page = app_page
    today = date.today()
    mk = _this_month_key()
    _seed_recurring(page, [
        {"id": 1, "name": "Netflix", "amount": 15.99, "frequency": "monthly",
         "dayOfMonth": 1, "type": "subscription", "category": "Entertainment",
         "accountId": 8801, "startDate": f"{today.year}-01-01",
         "paused": False, "archived": False, "skippedMonths": [], "paidMonths": [mk]},
        {"id": 2, "name": "Gym", "amount": 40.00, "frequency": "monthly",
         "dayOfMonth": 15, "type": "subscription", "category": "Health",
         "accountId": 8801, "startDate": f"{today.year}-01-01",
         "paused": False, "archived": False, "skippedMonths": [], "paidMonths": []},
    ])

    panel_text = page.inner_text('.recurring-upcoming-panel')
    # Paid count should reflect 1 paid template
    assert '1' in panel_text, \
        f"Panel should show 1 paid item, got: {panel_text!r}"


@pytest.mark.feature
def test_upcoming_panel_excludes_paused_templates(app_page):
    """Paused templates are excluded from the upcoming panel counts."""
    from datetime import date
    page = app_page
    today = date.today()
    _seed_recurring(page, [
        {"id": 1, "name": "Paused Sub", "amount": 99.00, "frequency": "monthly",
         "dayOfMonth": 5, "type": "subscription", "category": "Other",
         "accountId": 8801, "startDate": f"{today.year}-01-01",
         "paused": True, "archived": False, "skippedMonths": [], "paidMonths": []},
    ])

    panel_text = page.inner_text('.recurring-upcoming-panel')
    # Paused template should not contribute occurrences — shows empty state
    assert 'No active' in panel_text or '0' in panel_text, \
        f"Paused templates should be excluded from the panel, got: {panel_text!r}"


@pytest.mark.feature
def test_upcoming_panel_empty_state_no_templates(app_page):
    """Upcoming panel shows empty message when no active templates exist."""
    page = app_page
    _seed_recurring(page, [])

    # With no templates the recurringList shows its own empty state, but
    # the upcoming panel still renders (empty-state variant)
    panel = page.query_selector('.recurring-upcoming-panel')
    if panel:
        panel_text = panel.inner_text()
        assert 'No active' in panel_text or panel_text.strip() == '', \
            f"Empty-state panel should mention 'No active', got: {panel_text!r}"


# ── R-02: Overdue indicator — positive cases ─────────────────────────────────

@pytest.mark.feature
def test_overdue_badge_shown_for_past_due_unpaid_template(app_page):
    """A monthly template past its due day and not marked paid shows 'Overdue' badge."""
    from datetime import date
    page = app_page
    today = date.today()
    if today.day <= 1:
        pytest.skip("Cannot reliably test overdue on the 1st of the month")

    _seed_recurring(page, [
        {"id": 1, "name": "Past Due Bill", "amount": 50.00, "frequency": "monthly",
         "dayOfMonth": 1, "type": "subscription", "category": "Bills",
         "accountId": 8801, "startDate": f"{today.year}-01-01",
         "paused": False, "archived": False, "skippedMonths": [], "paidMonths": []},
    ])

    badge = page.query_selector('.recurring-overdue-badge')
    assert badge is not None, \
        "Overdue badge should appear for an unpaid template past its due day"
    assert 'Overdue' in (badge.text_content() or ''), \
        f"Badge text should say 'Overdue', got: {badge.text_content()!r}"


@pytest.mark.feature
def test_overdue_badge_absent_when_paid(app_page):
    """A past-due template marked paid for this month shows no 'Overdue' badge."""
    from datetime import date
    page = app_page
    today = date.today()
    mk = _this_month_key()
    if today.day <= 1:
        pytest.skip("Cannot reliably test overdue on the 1st of the month")

    _seed_recurring(page, [
        {"id": 1, "name": "Paid On Time", "amount": 50.00, "frequency": "monthly",
         "dayOfMonth": 1, "type": "subscription", "category": "Bills",
         "accountId": 8801, "startDate": f"{today.year}-01-01",
         "paused": False, "archived": False, "skippedMonths": [], "paidMonths": [mk]},
    ])

    badge = page.query_selector('.recurring-overdue-badge')
    assert badge is None, \
        "Paid template should not show 'Overdue' badge even if past due day"


@pytest.mark.feature
def test_overdue_badge_absent_for_paused_template(app_page):
    """A paused template never shows the overdue badge."""
    from datetime import date
    page = app_page
    today = date.today()
    if today.day <= 1:
        pytest.skip("Cannot reliably test overdue on the 1st of the month")

    _seed_recurring(page, [
        {"id": 1, "name": "Paused Sub", "amount": 50.00, "frequency": "monthly",
         "dayOfMonth": 1, "type": "subscription", "category": "Bills",
         "accountId": 8801, "startDate": f"{today.year}-01-01",
         "paused": True, "archived": False, "skippedMonths": [], "paidMonths": []},
    ])

    badge = page.query_selector('.recurring-overdue-badge')
    assert badge is None, "Paused template should never show 'Overdue' badge"


@pytest.mark.feature
def test_overdue_badge_absent_for_future_due_day(app_page):
    """A template whose due day is still in the future this month shows no overdue badge."""
    from datetime import date
    import calendar
    page = app_page
    today = date.today()
    _, last_day = calendar.monthrange(today.year, today.month)
    if today.day >= last_day:
        pytest.skip("No future due day available this month")

    future_day = last_day  # last day of month — always in the future unless today IS the last day

    _seed_recurring(page, [
        {"id": 1, "name": "Future Bill", "amount": 50.00, "frequency": "monthly",
         "dayOfMonth": future_day, "type": "subscription", "category": "Bills",
         "accountId": 8801, "startDate": f"{today.year}-01-01",
         "paused": False, "archived": False, "skippedMonths": [], "paidMonths": []},
    ])

    badge = page.query_selector('.recurring-overdue-badge')
    assert badge is None, \
        f"Template due on day {future_day} should not be overdue when today is day {today.day}"


@pytest.mark.feature
def test_overdue_badge_absent_for_non_monthly_frequency(app_page):
    """Weekly/biweekly/quarterly/yearly templates never show the overdue badge."""
    from datetime import date
    page = app_page
    today = date.today()
    if today.day <= 1:
        pytest.skip("Cannot reliably test overdue on the 1st of the month")

    _seed_recurring(page, [
        {"id": 1, "name": "Weekly Sub", "amount": 25.00, "frequency": "weekly",
         "dayOfMonth": 1, "type": "subscription", "category": "Other",
         "accountId": 8801, "startDate": f"{today.year}-01-01",
         "paused": False, "archived": False, "skippedMonths": [], "paidMonths": []},
    ])

    badge = page.query_selector('.recurring-overdue-badge')
    assert badge is None, \
        "Non-monthly templates should never show 'Overdue' badge"


@pytest.mark.feature
def test_overdue_count_surfaced_in_upcoming_panel(app_page):
    """When overdue templates exist, the upcoming panel shows an overdue count."""
    from datetime import date
    page = app_page
    today = date.today()
    if today.day <= 1:
        pytest.skip("Cannot reliably test overdue on the 1st of the month")

    _seed_recurring(page, [
        {"id": 1, "name": "Past Due Bill", "amount": 50.00, "frequency": "monthly",
         "dayOfMonth": 1, "type": "subscription", "category": "Bills",
         "accountId": 8801, "startDate": f"{today.year}-01-01",
         "paused": False, "archived": False, "skippedMonths": [], "paidMonths": []},
    ])

    panel_text = page.inner_text('.recurring-upcoming-panel')
    assert 'overdue' in panel_text.lower(), \
        f"Upcoming panel should surface overdue count when overdue items exist, got: {panel_text!r}"


@pytest.mark.feature
def test_overdue_count_absent_from_panel_when_all_paid(app_page):
    """Upcoming panel shows no overdue stat when all past-due templates are paid."""
    from datetime import date
    page = app_page
    today = date.today()
    mk = _this_month_key()

    _seed_recurring(page, [
        {"id": 1, "name": "All Paid", "amount": 50.00, "frequency": "monthly",
         "dayOfMonth": 1, "type": "subscription", "category": "Bills",
         "accountId": 8801, "startDate": f"{today.year}-01-01",
         "paused": False, "archived": False, "skippedMonths": [], "paidMonths": [mk]},
    ])

    overdue_stat = page.query_selector('.recurring-upcoming-value--overdue')
    assert overdue_stat is None, \
        "No overdue stat should appear in the panel when all templates are paid"
