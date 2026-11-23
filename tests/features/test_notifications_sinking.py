"""Sinking fund behind notifications (issue #701).

A target-date fund alerts when its live required monthly amount is at least
10% above its planned pace, or when its date has passed with money still to
save. Funded funds, small slips and funds without a target date never alert;
the open alert resolves when the fund catches up; the setting turns it off.
CI stacks run with jobs off, so the check is called through
POST /api/notifications/check.
"""
import datetime

import pytest

from tests.conftest import seed_state, wait_for_api

SINKING_URL = '/api/notifications?status=all&type=sinking'
ACTIVE_URL = '/api/notifications?status=active&type=sinking'


def _month_start(offset):
    today = datetime.date.today()
    index = today.year * 12 + (today.month - 1) + offset
    return datetime.date(index // 12, index % 12 + 1, 1).isoformat()


def _fund(fund_id, name, **extra):
    fund = {'id': fund_id, 'name': name, 'allocationMethod': 'target_date', 'monthlyAllocation': 200,
            'targetAmount': 3000, 'currentAmount': 1200, 'accountId': 10, 'autoContribute': False,
            'targetDate': _month_start(6)}
    fund.update(extra)
    return fund


def _state(*funds):
    return {
        'accounts': [{'id': 10, 'name': 'Savings', 'type': 'Savings', 'startingBalance': 5000}],
        'sinkingFunds': list(funds),
    }


def _api(page, method, path, body=None):
    return page.evaluate("""async ([method, path, body]) => {
        const csrf = document.cookie.match(/csrf=([^;]+)/)[1];
        const r = await fetch(path, { method, headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
            body: body === null ? undefined : JSON.stringify(body) });
        await r.text();
        return r.status;
    }""", [method, path, body])


def _check(page):
    assert _api(page, 'POST', '/api/notifications/check') == 200


def _alerts(page, url=SINKING_URL):
    return wait_for_api(page, url, lambda body: 'notifications' in body)['notifications']


def _message(page, params):
    return page.evaluate("""async (p) => {
        const nc = await import('/src/notificationsCenter.js');
        return nc.notificationMessage('sinkingBehind', p);
    }""", params)


@pytest.mark.feature
def test_behind_and_past_due_funds_alert_with_text(app_page):
    page = app_page
    seed_state(page, _state(
        _fund(1, 'Vacation'),                                        # 1800 / 6 = 300 vs planned 200
        _fund(2, 'Old Car', targetDate=(datetime.date.today() - datetime.timedelta(days=40)).isoformat()),
        _fund(3, 'Small Slip', monthlyAllocation=290),               # 300 vs 290: under 10%
        _fund(4, 'Done', currentAmount=3000),                        # funded
        _fund(5, 'Plain', allocationMethod='fixed', targetDate=None),  # no target date
    ))
    _check(page)
    alerts = wait_for_api(page, SINKING_URL, lambda body: len(body.get('notifications', [])) >= 2)['notifications']
    assert len(alerts) == 2, alerts
    by_name = {a['params']['name']: a for a in alerts}
    assert set(by_name) == {'Vacation', 'Old Car'}

    behind = by_name['Vacation']['params']
    assert behind['kind'] == 'behind' and behind['required'] == 300 and behind['planned'] == 200
    text = _message(page, behind)
    assert text.startswith('Vacation is behind: $300.00/mo now needed (planned $200.00) to reach $3,000.00 by '), text

    past = by_name['Old Car']['params']
    assert past['kind'] == 'pastDue' and past['remaining'] == 1800
    text = _message(page, past)
    assert text.startswith('Old Car passed its target date ('), text
    assert text.endswith('with $1,800.00 still to save.'), text

    # A repeat check raises nothing new.
    _check(page)
    assert len(_alerts(page)) == 2

    # The Notifications page lists them, filterable by the new type.
    page.evaluate("async () => { window.app.switchPage('notifications'); await window.app.renderNotificationsPage(); }")
    page.wait_for_selector('#notificationsPage:has-text("Vacation is behind")', timeout=10000)
    assert page.locator('#notifFilterType option[value="sinking"]').count() == 1


@pytest.mark.feature
def test_alert_resolves_when_fund_catches_up(app_page):
    page = app_page
    seed_state(page, _state(_fund(1, 'Vacation')))
    _check(page)
    assert len(wait_for_api(page, ACTIVE_URL, lambda b: len(b.get('notifications', [])) == 1)['notifications']) == 1

    funds = wait_for_api(page, '/api/sinking-funds', lambda rows: len(rows) == 1)
    assert _api(page, 'PATCH', f"/api/sinking-funds/{funds[0]['id']}", {'currentAmount': 2400}) == 200
    _check(page)
    wait_for_api(page, ACTIVE_URL, lambda b: len(b.get('notifications', [])) == 0)
    resolved = _alerts(page)
    assert len(resolved) == 1 and resolved[0]['resolvedAt']


@pytest.mark.feature
def test_setting_off_stops_and_resolves_alerts(app_page):
    page = app_page
    seed_state(page, _state(_fund(1, 'Vacation')))
    page.evaluate("() => window.app.openSettings({ page: 'notifications' })")
    toggle = page.locator('#settingNotifySinkingBehind')
    toggle.wait_for(state='visible', timeout=5000)
    assert toggle.is_checked(), 'on by default'

    _check(page)
    wait_for_api(page, ACTIVE_URL, lambda b: len(b.get('notifications', [])) == 1)

    toggle.uncheck()
    wait_for_api(page, '/api/settings',
                 lambda rows: any(r.get('key') == 'notifySinkingBehind' and r.get('value') is False for r in rows))
    _check(page)
    wait_for_api(page, ACTIVE_URL, lambda b: len(b.get('notifications', [])) == 0)
    assert len(_alerts(page)) == 1, 'the old alert stays as resolved history, nothing new'
