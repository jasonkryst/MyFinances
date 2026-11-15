#!/usr/bin/env python3
"""
Net Worth report before any snapshot (issues #574, #585).

- With accounts/debts but no snapshots the report shows a live current point and the projection.
- Months without a snapshot are estimated from balance history (dashed, labelled, in the SR table).
- A user with no data still sees the empty state.
- First run turns the monthly auto snapshot on; existing users are left alone.
"""

import datetime

import pytest

from tests.conftest import seed_state, wait_for_api

TREND_CANVAS = '#rptNetWorthTrendChart'
SR_TABLE = '#rptNetWorthTrendChart-sr-table'


def _month_start(months_back):
    today = datetime.date.today()
    idx = today.year * 12 + (today.month - 1) - months_back
    return datetime.date(idx // 12, idx % 12 + 1, 1).isoformat()


def _open_net_worth(page):
    page.evaluate("""async () => {
        window.app.switchPage('reports');
        const tab = document.getElementById('rptTab-networth');
        if (tab) tab.click();
        await window.app.renderReportsPage();
    }""")
    page.wait_for_selector('#reportsNetWorth', timeout=10000)


def _sr_rows(page):
    return page.evaluate("""() => [...document.querySelectorAll('#rptNetWorthTrendChart-sr-table tbody tr')]
        .map(tr => [...tr.children].map(td => td.textContent))""")


def _debt_state(snapshots=None):
    return {
        'debts': [
            {'id': 1, 'name': 'Visa', 'debtType': 'creditCard', 'accountBalance': 800, 'minimumPayment': 30,
             'originalBalance': 1000, 'originalMinimumPayment': 40, 'debtStartDate': _month_start(4),
             'updatedAt': _month_start(0), 'interestRate': 20, 'dueDate': 5},
        ],
        'accounts': [{'id': 8, 'name': 'Checking', 'type': 'Checking', 'startingBalance': 5000}],
        'balanceHistory': [
            {'id': 1, 'debtId': 1, 'accountId': None, 'date': _month_start(3), 'balance': 1000, 'minimumPayment': 40},
            {'id': 2, 'debtId': 1, 'accountId': None, 'date': _month_start(1), 'balance': 900, 'minimumPayment': 35},
            {'id': 3, 'debtId': 1, 'accountId': None, 'date': _month_start(0), 'balance': 800, 'minimumPayment': 30},
        ],
        'monthlySnapshots': snapshots or [],
    }


@pytest.mark.feature
def test_estimated_trend_from_balance_history_without_snapshots(app_page):
    """Balance history but no snapshots: estimated months are marked in the SR table and the legend."""
    page = app_page
    seed_state(page, _debt_state())
    _open_net_worth(page)
    page.wait_for_selector(SR_TABLE, state='attached', timeout=10000)

    headers = page.evaluate("() => [...document.querySelectorAll('#rptNetWorthTrendChart-sr-table thead th')].map(th => th.textContent)")
    assert headers[-1] == 'Estimated'
    rows = [r for r in _sr_rows(page) if r[3] == 'No']  # not projected
    estimated = [r for r in rows if r[4] == 'Yes']
    live = [r for r in rows if r[4] == 'No']
    assert len(estimated) >= 3, rows       # three months back, through last month
    assert len(live) == 1, rows            # the current month is the live point
    # Visa 1000 in month-3, carried to month-2, 900 in month-1; checking 5000 held flat.
    assert estimated[0][1] == '$4,000.00'
    assert estimated[1][1] == '$4,000.00'
    assert estimated[2][1] == '$4,100.00'
    assert live[0][1] == '$4,200.00'

    datasets = page.evaluate("() => window.app._rptNetWorthTrendChart.data.datasets.map(d => d.label)")
    assert 'Net Worth (estimated)' in datasets
    est = page.evaluate("() => window.app._rptNetWorthTrendChart.data.datasets.find(d => d.label === 'Net Worth (estimated)').borderDash")
    assert est, "estimated dataset must be dashed"
    assert page.locator('#netWorthHistoryTable .nw-estimated-tag').count() >= 3
    assert page.locator('.nw-estimated-note').count() == 1
    # Rendering never persisted anything.
    assert page.evaluate("() => window.app.monthlySnapshots.length") == 0


@pytest.mark.feature
def test_real_snapshot_wins_over_estimate_for_its_month(app_page):
    page = app_page
    snap_date = _month_start(2)[:8] + '15'
    seed_state(page, _debt_state([
        {'date': snap_date, 'totalAssets': 9000, 'totalLiabilities': 1000, 'netWorth': 8000,
         'debtPaymentMade': 0, 'incomeReceived': 0, 'source': 'auto'},
    ]))
    _open_net_worth(page)
    page.wait_for_selector(SR_TABLE, state='attached', timeout=10000)
    rows = [r for r in _sr_rows(page) if r[3] == 'No']
    assert any(r[1] == '$8,000.00' and r[4] == 'No' for r in rows), rows
    # The months before the snapshot are estimated; the snapshot's own month is not.
    assert [r[4] for r in rows][:2] == ['Yes', 'No'], rows
    # With a snapshot present there is no live point: the latest snapshot is the headline.
    assert page.locator('.nw-report-stat strong').first.inner_text() == '$8,000.00'


@pytest.mark.feature
def test_live_point_and_projection_without_snapshots_or_history(app_page):
    """Accounts and debts but no snapshots: the report shows today's net worth and a projection, not the empty state."""
    page = app_page
    seed_state(page, {
        'accounts': [{'id': 8, 'name': 'Checking', 'type': 'Checking', 'startingBalance': 5000}],
        'debts': [{'id': 1, 'name': 'Loan', 'debtType': 'loan', 'accountBalance': 1200, 'minimumPayment': 50,
                   'interestRate': 5, 'dueDate': 5, 'updatedAt': _month_start(0)}],
    })
    page.evaluate("() => { window.app.balanceHistory = []; }")
    _open_net_worth(page)
    page.wait_for_selector(TREND_CANVAS, timeout=10000)
    assert page.locator('.rpt-empty-msg').count() == 0
    assert page.locator('.nw-report-stat strong').first.inner_text() == '$3,800.00'
    assert 'live' in page.locator('.nw-snapshot-note').first.inner_text().lower()
    labels = page.evaluate("() => window.app._rptNetWorthTrendChart.data.datasets.map(d => d.label)")
    assert 'Net Worth (projected)' in labels
    assert 'Net Worth (estimated)' not in labels
    projected = [r for r in _sr_rows(page) if r[3] == 'Yes']
    assert len(projected) == 36
    # Merely rendering must not write a snapshot.
    assert page.evaluate("() => window.app.monthlySnapshots.length") == 0
    api = page.evaluate("async () => (await (await fetch('/api/net-worth-snapshots')).json()).length")
    assert api == 0


@pytest.mark.feature
def test_empty_state_without_any_data(app_page):
    page = app_page
    _open_net_worth(page)
    assert page.locator('.rpt-empty-msg').count() == 1
    assert page.locator(TREND_CANVAS).count() == 0


@pytest.mark.feature
def test_first_run_enables_auto_snapshot(app_page):
    """A brand-new user (no wizard setting, no data) gets autoNwSnapshot = true, and no $0 snapshot is captured."""
    page = app_page
    page.evaluate("async () => { const m = await import('/src/postgresSync.js'); await m.pgDelete(window.app, '/api/settings/reconciliationAdjustsBalance'); }")
    wait_for_api(page, '/api/settings', lambda rows: not any(r['key'] == 'reconciliationAdjustsBalance' for r in rows))
    page.reload()
    rows = wait_for_api(page, '/api/settings',
                        lambda rows: any(r['key'] == 'autoNwSnapshot' and r['value'] is True for r in rows))
    assert rows
    assert page.evaluate("() => window.app.monthlySnapshots.length") == 0


@pytest.mark.feature
def test_existing_user_keeps_auto_snapshot_default(app_page):
    """A user with data who never set the option is not switched on, even if the wizard setting is missing."""
    page = app_page
    seed_state(page, {'accounts': [{'id': 8, 'name': 'Checking', 'type': 'Checking', 'startingBalance': 100}]})
    page.evaluate("async () => { const m = await import('/src/postgresSync.js'); await m.pgDelete(window.app, '/api/settings/reconciliationAdjustsBalance'); }")
    wait_for_api(page, '/api/settings', lambda rows: not any(r['key'] == 'reconciliationAdjustsBalance' for r in rows))
    page.reload()
    page.wait_for_timeout(500)
    rows = page.evaluate("async () => (await fetch('/api/settings')).json()")
    assert not any(r['key'] == 'autoNwSnapshot' for r in rows)
    assert page.evaluate("() => window.app.getSetting('autoNwSnapshot', false)") is False


@pytest.mark.feature
def test_first_run_stored_choice_is_not_overwritten(app_page):
    """A user who already turned the option off keeps it off."""
    page = app_page
    page.evaluate("() => window.app.setSetting('autoNwSnapshot', false)")
    wait_for_api(page, '/api/settings', lambda rows: any(r['key'] == 'autoNwSnapshot' and r['value'] is False for r in rows))
    page.evaluate("async () => { const m = await import('/src/postgresSync.js'); await m.pgDelete(window.app, '/api/settings/reconciliationAdjustsBalance'); }")
    wait_for_api(page, '/api/settings', lambda rows: not any(r['key'] == 'reconciliationAdjustsBalance' for r in rows))
    page.reload()
    page.wait_for_timeout(500)
    rows = page.evaluate("async () => (await fetch('/api/settings')).json()")
    assert [r['value'] for r in rows if r['key'] == 'autoNwSnapshot'] == [False]
