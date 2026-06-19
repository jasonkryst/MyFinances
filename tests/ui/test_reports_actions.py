#!/usr/bin/env python3
"""
Reports Page Action Tests
Tests the Net Worth "Capture Snapshot Now" button.
"""

import pytest


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
