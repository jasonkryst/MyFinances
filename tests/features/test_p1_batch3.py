#!/usr/bin/env python3
"""
P1 Batch 3 — Tests for issues #294 #382 #383

Coverage:
  #294  Debt payoff celebration modal (mirrors #308 sinking fund completion flow)
  #382  Upcoming-due urgency badge on recurring cards (red <3d, yellow <7d)
  #383  Health page stale-plan nudge banner (30+ days without a debt/income edit)
"""

import pytest

from tests.conftest import reset_server_state, seed_state

BASE_URL = "http://localhost:32900/"

# ─── #294 Debt payoff celebration modal ──────────────────────────────────────


def _paid_off_debt(debt_id, name, archived=False):
    return {
        'id': debt_id, 'name': name, 'category': '', 'debtType': 'creditCard',
        'accountBalance': 0, 'originalBalance': 1000, 'interestRate': 18,
        'minimumPayment': 25, 'originalMinimumPayment': 25, 'dueDate': 15,
        'debtStartDate': None, 'fixedAmount': 0, 'fixedStartDate': None, 'fixedEndDate': None,
        'updatedAt': None, 'priority': None, 'accountId': None, 'archived': archived,
    }


def _seed_paid_off_debt(page, *, debt_id=9301, name='Celebration Card'):
    """Seed a paid-off debt through the server; returns the id the server assigned."""
    seed_state(page, {'debts': [_paid_off_debt(debt_id, name)]})
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_selector('#debtsList .debt-card', timeout=5000)
    return page.evaluate("() => window.app.debts[0].id")


@pytest.mark.feature
def test_celebration_modal_shows_debt_name_and_message(app_page):
    """#294 — Celebration modal shows the paid-off debt's name and congratulatory copy."""
    page = app_page
    debt_id = _seed_paid_off_debt(page)

    page.click(f'[data-debt-action="celebrate"][data-debt-id="{debt_id}"]')
    page.wait_for_selector('#debtPaidOffTitle', timeout=5000)

    assert page.query_selector('text=🎉 Debt paid off!') is not None
    assert page.query_selector('text=Celebration Card') is not None
    assert page.query_selector('#dpoArchiveBtn') is not None
    assert page.query_selector('#dpoKeepBtn') is not None


@pytest.mark.feature
def test_celebration_modal_escape_closes_without_archiving(app_page):
    """#294 — Pressing Escape closes the celebration modal and leaves the debt untouched."""
    page = app_page
    debt_id = _seed_paid_off_debt(page)

    page.click(f'[data-debt-action="celebrate"][data-debt-id="{debt_id}"]')
    page.wait_for_selector('#debtPaidOffTitle', timeout=5000)
    page.wait_for_selector('#dpoArchiveBtn:focus', timeout=5000)  # modal auto-focuses via setTimeout
    page.keyboard.press('Escape')
    page.wait_for_selector('#debtPaidOffTitle', state='hidden', timeout=5000)

    archived = page.evaluate("(id) => window.app.debts.find(d => d.id === id)?.archived", debt_id)
    assert archived is False


@pytest.mark.feature
def test_celebration_button_absent_for_archived_debt(app_page):
    """#294 — An already-archived paid-off debt does not show the celebration button."""
    page = app_page
    seed_state(page, {'debts': [_paid_off_debt(9302, 'Already Archived Paid Off', archived=True)]})
    from tests.conftest import open_settings, close_settings
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    open_settings(page)
    page.click('[data-settings-tab="advanced"]')  # #322: archived-debts toggle now lives on the Advanced tab
    page.check('#settingShowArchivedDebts')
    close_settings(page)
    page.wait_for_selector('text=Already Archived Paid Off', timeout=5000)

    assert page.query_selector('[data-debt-action="celebrate"]') is None


# ─── #382 Upcoming-due urgency badge on recurring cards ──────────────────────


def _seed_recurring_template(page, *, template_id, day_of_month, name='Streaming Sub',
                              paused=False, archived=False, skipped_months=None, paid_months=None):
    skipped_months = skipped_months or []
    paid_months = paid_months or []
    from datetime import date
    start_date = date.today().replace(day=1).isoformat()
    seed_state(page, {'recurringTemplates': [{
        'id': template_id, 'name': name, 'type': 'subscription', 'amount': 15,
        'frequency': 'monthly', 'dayOfMonth': day_of_month, 'category': 'Subscription',
        'accountId': None, 'startDate': start_date, 'endDate': None, 'paused': paused,
        'archived': archived, 'skippedMonths': skipped_months,
        'paidMonths': paid_months, 'paidAmounts': {},
    }]})
    page.click('button[data-page="recurring"]')
    page.wait_for_selector('#recurringSection.active', timeout=5000)
    # The server assigns the id; return it so callers can target the card.
    real_id = page.evaluate("() => window.app.recurringTemplates[0].id")
    page.wait_for_selector(f'#recurring-card-{real_id}', timeout=5000)
    return real_id


def _due_day_in(offset_days):
    """A dayOfMonth that is `offset_days` ahead of today, within the current month.
    Skips the test if today is too close to month-end for that offset to exist."""
    from datetime import date
    import calendar
    today = date.today()
    _, last_day = calendar.monthrange(today.year, today.month)
    target_day = today.day + offset_days
    if target_day > last_day:
        pytest.skip(f"No day {offset_days} days out available this month (today is day {today.day})")
    return target_day


@pytest.mark.feature
def test_urgency_badge_red_when_due_within_two_days(app_page):
    """#382 — Red urgency badge shown when the next occurrence is due in < 3 days."""
    page = app_page
    dom = _due_day_in(2)
    tid = _seed_recurring_template(page, template_id=9401, day_of_month=dom)

    badge = page.query_selector(f'#recurring-card-{tid} .recurring-urgency-badge--red')
    assert badge is not None, "Expected red urgency badge for occurrence due within 2 days"


@pytest.mark.feature
def test_urgency_badge_yellow_when_due_within_six_days(app_page):
    """#382 — Yellow urgency badge shown when the next occurrence is due in 3-6 days."""
    page = app_page
    dom = _due_day_in(5)
    tid = _seed_recurring_template(page, template_id=9402, day_of_month=dom)

    badge = page.query_selector(f'#recurring-card-{tid} .recurring-urgency-badge--yellow')
    assert badge is not None, "Expected yellow urgency badge for occurrence due within 5 days"


@pytest.mark.feature
def test_urgency_badge_absent_when_due_far_out(app_page):
    """#382 — No urgency badge when the next occurrence is more than 6 days away."""
    page = app_page
    dom = _due_day_in(10)
    tid = _seed_recurring_template(page, template_id=9403, day_of_month=dom)

    assert page.query_selector(f'#recurring-card-{tid} .recurring-urgency-badge') is None


@pytest.mark.feature
def test_urgency_badge_absent_when_paused(app_page):
    """#382 — No urgency badge on a paused template even if the occurrence is due soon."""
    page = app_page
    dom = _due_day_in(1)
    tid = _seed_recurring_template(page, template_id=9404, day_of_month=dom, paused=True)

    assert page.query_selector(f'#recurring-card-{tid} .recurring-urgency-badge') is None


@pytest.mark.feature
def test_urgency_badge_absent_when_paid_this_month(app_page):
    """#382 — No urgency badge once the occurrence has already been marked paid this month."""
    page = app_page
    from datetime import date
    month_key = date.today().strftime('%Y-%m')
    dom = _due_day_in(1)
    tid = _seed_recurring_template(page, template_id=9405, day_of_month=dom, paid_months=[month_key])

    assert page.query_selector(f'#recurring-card-{tid} .recurring-urgency-badge') is None


# ─── #383 Health page stale-plan nudge banner ────────────────────────────────


def _stale_debt(debt_id, name, updated_at):
    return {
        'id': debt_id, 'name': name, 'category': '', 'debtType': 'creditCard',
        'accountBalance': 500, 'originalBalance': 1000, 'interestRate': 18,
        'minimumPayment': 25, 'originalMinimumPayment': 25, 'dueDate': 15,
        'debtStartDate': None, 'fixedAmount': 0, 'fixedStartDate': None, 'fixedEndDate': None,
        'updatedAt': updated_at, 'priority': None, 'accountId': None, 'archived': False,
    }


def _seed_debt_with_updated_at(page, *, days_ago):
    from datetime import date, timedelta
    # Local-date ISO, matching health.js's local-midnight math.
    iso = (date.today() - timedelta(days=days_ago)).isoformat()
    seed_state(page, {'debts': [_stale_debt(9501, 'Stale Test Debt', iso)], 'incomes': []})
    # The server owns debts' updatedAt (it stamps "now" on write), so backdate it in memory
    # (no write) before Health renders.
    page.evaluate("(iso) => { window.app.debts.forEach(d => { d.updatedAt = iso; }); }", iso)
    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)


@pytest.mark.feature
def test_stale_banner_shown_after_30_days_without_edit(app_page):
    """#383 — Stale-plan nudge banner shown when the most recent debt/income edit is 30+ days old."""
    page = app_page
    _seed_debt_with_updated_at(page, days_ago=35)

    banner = page.query_selector('.health-stale-banner')
    assert banner is not None, "Stale banner should be shown when data hasn't changed in 35 days"
    assert '35 days' in banner.inner_text()


@pytest.mark.feature
def test_stale_banner_absent_when_recently_edited(app_page):
    """#383 — Stale-plan nudge banner absent when the data was edited recently."""
    page = app_page
    _seed_debt_with_updated_at(page, days_ago=2)

    assert page.query_selector('.health-stale-banner') is None


@pytest.mark.feature
def test_stale_banner_absent_for_legacy_data_with_no_timestamps(app_page):
    """#383 — No false-positive stale banner for legacy debts that predate updatedAt tracking."""
    page = app_page
    seed_state(page, {'debts': [_stale_debt(9502, 'Legacy Debt', None)], 'incomes': []})
    # Server stamps updatedAt on write; drop it in memory to model a pre-tracking legacy debt.
    page.evaluate("() => { window.app.debts.forEach(d => { d.updatedAt = null; }); }")
    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)

    assert page.query_selector('.health-stale-banner') is None


@pytest.mark.feature
def test_stale_banner_absent_when_no_data_at_all(app_page):
    """#383 — Empty-state banner (not the stale-plan nudge) shows when there's no data at all."""
    page = app_page
    reset_server_state(page)  # nothing on the server
    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)

    assert page.query_selector('#healthEmptyStateCta') is not None
    assert page.query_selector('.health-stale-banner') is None
