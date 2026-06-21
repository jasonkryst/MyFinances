#!/usr/bin/env python3
"""
Reports Page Action Tests
Tests the Net Worth "Capture Snapshot Now" button, and the Reports Calendar
day-detail modal (compact dot indicators + click/keyboard-triggered modal).
"""

import pytest


def _seed_calendar_day(page):
    """Seed a single income event landing on the 5th of the current report month."""
    page.evaluate("""() => {
        const app = window.app;
        const rptDate = new Date();
        const isoDay = String(5).padStart(2, '0');
        const isoMonth = String(rptDate.getMonth() + 1).padStart(2, '0');
        app.accounts = [{ id: 9201, name: 'Cal Checking', type: 'Checking', startingBalance: 1000 }];
        app.incomes = [{
            id: 9202, name: 'Cal Paycheck', amount: 1500, accountId: 9201,
            frequency: 'monthly', firstDate: `${rptDate.getFullYear()}-${isoMonth}-${isoDay}`
        }];
        app.debts = []; app.bills = []; app.expenses = []; app.bonuses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.monthlySnapshots = [];
        app.switchPage('reports');
    }""")
    page.wait_for_timeout(300)


@pytest.mark.ui
def test_calendar_day_with_events_is_clickable_and_shows_dots(app_page):
    """A day with events renders compact dot indicators and is keyboard/click reachable."""
    page = app_page
    _seed_calendar_day(page)

    cell = page.query_selector('.rpt-cal-cell.rpt-cal-has-events')
    assert cell, "Expected at least one day cell with events"
    assert cell.get_attribute('role') == 'button'
    assert cell.get_attribute('tabindex') == '0'
    dots = cell.query_selector_all('.rpt-cal-dot')
    assert len(dots) >= 1, "Day cell should render at least one compact event dot"

    # The old inline per-event chip markup should no longer be rendered in the cell itself.
    assert cell.query_selector('.rpt-cal-evt') is None


@pytest.mark.ui
def test_calendar_day_click_opens_modal_with_full_event_details(app_page):
    """Clicking a day cell with events opens the day-detail modal showing the full event list."""
    page = app_page
    _seed_calendar_day(page)

    cell = page.query_selector('.rpt-cal-cell.rpt-cal-has-events')
    cell.click()
    page.wait_for_timeout(200)

    modal = page.query_selector('#calendarDayModal')
    assert modal
    assert 'flex-visible' in (modal.get_attribute('class') or '')

    body_text = page.query_selector('#calendarDayModalBody').text_content()
    assert 'Cal Paycheck' in body_text
    assert '$1,500.00' in body_text

    page.keyboard.press('Escape')
    page.wait_for_timeout(200)
    modal = page.query_selector('#calendarDayModal')
    assert 'hidden' in (modal.get_attribute('class') or '')


@pytest.mark.ui
def test_calendar_day_keyboard_enter_opens_modal(app_page):
    """Enter/Space on a focused day cell opens the modal (keyboard parity with click)."""
    page = app_page
    _seed_calendar_day(page)

    cell = page.query_selector('.rpt-cal-cell.rpt-cal-has-events')
    cell.focus()
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)

    modal = page.query_selector('#calendarDayModal')
    assert 'flex-visible' in (modal.get_attribute('class') or '')


@pytest.mark.ui
def test_net_worth_capture_snapshot_button(app_page):
    """Test the Capture Snapshot Now button creates and updates a net worth snapshot."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 9101, name: 'Snapshot Test', type: 'Checking', startingBalance: 1000 }];
        app.debts = []; app.bills = []; app.expenses = []; app.incomes = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.monthlySnapshots = [];
        app.switchPage('reports');
    }""")
    page.wait_for_timeout(300)

    page.click('[data-rptab="networth"]')
    page.wait_for_timeout(300)

    capture_btn = page.query_selector('#captureSnapshotBtn')
    assert capture_btn, "Expected a Capture Snapshot Now button"
    capture_btn.click()
    page.wait_for_timeout(300)

    snapshot_count = page.evaluate('() => (window.app.monthlySnapshots || []).length')
    assert snapshot_count == 1, "Capturing a snapshot should add one entry"

    net_worth_text = page.evaluate("""() => {
        const stats = Array.from(document.querySelectorAll('#reportsNetWorth .nw-report-stat'));
        const stat = stats.find(el => el.textContent.includes('Current Net Worth'));
        return stat ? stat.querySelector('strong')?.textContent : '';
    }""")
    assert '$1,000.00' in net_worth_text, f"Expected net worth of $1,000.00, got {net_worth_text}"

    # Increase the account balance and re-capture; the same-month snapshot should update in place
    page.evaluate('() => { window.app.accounts[0].startingBalance = 2000; }')

    page.click('#captureSnapshotBtn')
    page.wait_for_timeout(300)

    snapshot_count = page.evaluate('() => (window.app.monthlySnapshots || []).length')
    assert snapshot_count == 1, "Re-capturing within the same month should update, not duplicate, the snapshot"

    net_worth_text = page.evaluate("""() => {
        const stats = Array.from(document.querySelectorAll('#reportsNetWorth .nw-report-stat'));
        const stat = stats.find(el => el.textContent.includes('Current Net Worth'));
        return stat ? stat.querySelector('strong')?.textContent : '';
    }""")
    assert '$2,000.00' in net_worth_text, f"Expected net worth of $2,000.00, got {net_worth_text}"

    widget_text = page.evaluate('() => document.getElementById("netWorthWidget")?.textContent || ""')
    assert '$2,000.00' in widget_text, "Net worth widget should reflect the updated snapshot"


@pytest.mark.ui
def test_report_tab_switching_toggles_panel_visibility(app_page):
    """Clicking each report tab (data-rptab) should activate its panel and
    deactivate the others, mirroring the schedule-tab pattern used elsewhere."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = []; app.debts = []; app.bills = []; app.expenses = [];
        app.incomes = []; app.recurringTemplates = []; app.emergencyFunds = [];
        app.sinkingFunds = []; app.monthlySnapshots = [];
        app.switchPage('reports');
    }""")
    page.wait_for_timeout(300)

    tabs = ['calendar', 'spending', 'incomeexp', 'moneyflow', 'variance', 'networth', 'forecast']

    for tab in tabs:
        page.click(f'[data-rptab="{tab}"]')
        page.wait_for_timeout(200)

        active_panel = page.query_selector(f'#rptPanel-{tab}')
        assert active_panel, f"Panel for tab '{tab}' should exist"
        assert 'rpt-tab-panel--active' in active_panel.get_attribute('class'), \
            f"Panel '{tab}' should be active after clicking its tab"

        active_btn = page.query_selector(f'[data-rptab="{tab}"]')
        assert 'rpt-tab-btn--active' in active_btn.get_attribute('class'), \
            f"Tab button '{tab}' should be marked active"
        assert active_btn.get_attribute('aria-selected') == 'true', \
            f"Tab button '{tab}' should have aria-selected=true"

        # All other panels should be inactive (hidden)
        for other in tabs:
            if other == tab:
                continue
            other_panel = page.query_selector(f'#rptPanel-{other}')
            assert 'rpt-tab-panel--active' not in other_panel.get_attribute('class'), \
                f"Panel '{other}' should not be active while '{tab}' is selected"
