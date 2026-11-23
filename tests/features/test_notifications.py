"""Notifications (issue #211): the toolbar bell, Settings -> Notifications and the
per-account low-balance alert amount.

The alert rules themselves are unit-tested (tests/unit/notificationsCore.test.js)
and the job, email and routes server-side (server/test/notificationsJob.test.js).
Here the CI stack runs with JOBS_ENABLED=false and no SMTP, so alerts are raised
on demand through Settings -> Check now (POST /api/notifications/check). Only
date-independent alerts (an account at $0) are used, so the result never depends
on the server's time zone.
"""
import pytest

from tests.conftest import seed_state, submit_account_form, wait_for_api, wait_for_app_ready

pytestmark = pytest.mark.feature

ZERO_ACCOUNT_STATE = {
    'accounts': [
        {'id': 1, 'name': 'Overdrawn Checking', 'type': 'Checking', 'startingBalance': -25},
        {'id': 2, 'name': 'Card', 'type': 'Credit Card', 'startingBalance': -500, 'lowBalanceThreshold': 100},
        # Sits at exactly $0 on purpose: not overdrawn, so it never alerts.
        {'id': 3, 'name': 'Parked Savings', 'type': 'Savings', 'startingBalance': 0},
    ],
    'debts': [],
}


def _open_notifications_settings(page):
    page.click('#accountMenuBtn')
    page.click('#accountMenuSettingsBtn')
    page.wait_for_selector('#settingsModal:not(.hidden)')
    page.evaluate("() => window.app.openSettings({ page: 'notifications' })")
    page.wait_for_selector('#settingsPage-notifications')


def _check_now(page):
    # Clear the last result first, so the wait below can't read a stale one.
    page.evaluate("document.getElementById('settingNotifyCheckStatus').textContent = ''")
    page.click('#settingNotifyCheckNowBtn')
    page.wait_for_function(
        "() => { const s = document.getElementById('settingNotifyCheckStatus').textContent;"
        " return s && !s.includes('…'); }")
    return page.text_content('#settingNotifyCheckStatus')


def _close_settings(page):
    page.click('#settingsModalCloseBtn')
    page.wait_for_selector('#settingsModal', state='hidden')


def _api_notifications(page):
    return page.evaluate("async () => (await fetch('/api/notifications')).json()")


def test_bell_is_labelled_and_shows_the_empty_state(app_page):
    page = app_page
    btn = page.locator('#notificationsBtn')
    assert btn.get_attribute('aria-label') == 'Notifications'
    assert btn.get_attribute('aria-expanded') == 'false'
    page.wait_for_function("() => document.documentElement.dataset.notificationsLoaded === 'true'")
    assert page.locator('#notificationsBadge').is_hidden()

    btn.click()
    assert btn.get_attribute('aria-expanded') == 'true'
    page.wait_for_selector('#notificationsPanel:not(.hidden)')
    # The bell lists unread alerts by default (#649).
    assert 'No unread alerts' in page.text_content('#notificationsList')
    assert page.locator('#notificationsMarkAllBtn').is_disabled()

    page.keyboard.press('Escape')
    page.wait_for_selector('#notificationsPanel', state='hidden')
    assert btn.get_attribute('aria-expanded') == 'false'
    assert page.evaluate("document.activeElement.id") == 'notificationsBtn'


def test_check_now_raises_an_alert_listed_under_the_bell(app_page):
    page = app_page
    seed_state(page, ZERO_ACCOUNT_STATE)
    wait_for_app_ready(page)

    _open_notifications_settings(page)
    assert _check_now(page) == '1 new alert.'
    # The Credit Card account is never alerted on, despite its threshold, and
    # the $0 account is not overdrawn.
    data = _api_notifications(page)
    assert [n['type'] for n in data['notifications']] == ['zeroBalance']
    assert data['notifications'][0]['params']['accountName'] == 'Overdrawn Checking'
    # Checking again raises nothing new.
    assert _check_now(page) == 'No new alerts.'
    _close_settings(page)

    page.wait_for_selector('#notificationsBadge:not(.hidden)')
    assert page.text_content('#notificationsBadge') == '1'
    assert page.text_content('#notificationsUnreadSr') == '1 unread'
    page.click('#notificationsBtn')
    item = page.locator('#notificationsList .notifications-item')
    item.wait_for()
    assert 'Overdrawn Checking is overdrawn at -$25.00.' in item.text_content()
    assert 'notifications-item--unread' in item.get_attribute('class')

    # Clicking the alert opens Accounts and marks it read on the server.
    item.click()
    page.wait_for_selector('#accountsSection.active')
    page.wait_for_selector('#notificationsPanel', state='hidden')
    assert page.locator('#notificationsBadge').is_hidden()
    wait_for_api(page, '/api/notifications', lambda d: d['unreadCount'] == 0)


def test_mark_all_read_survives_a_reload(app_page):
    page = app_page
    seed_state(page, ZERO_ACCOUNT_STATE)
    wait_for_app_ready(page)
    page.evaluate("async () => { const r = await import('/src/notificationsCenter.js'); await r.runNotificationCheck(); }")
    page.wait_for_selector('#notificationsBadge:not(.hidden)')

    page.click('#notificationsBtn')
    page.click('#notificationsMarkAllBtn')
    assert page.locator('#notificationsBadge').is_hidden()
    wait_for_api(page, '/api/notifications', lambda d: d['unreadCount'] == 0)
    page.reload()
    page.wait_for_function("() => document.documentElement.dataset.notificationsLoaded === 'true'")
    assert page.locator('#notificationsBadge').is_hidden()
    page.click('#notificationsBtn')
    # The bell lists unread alerts by default (#649), so the read alert is
    # gone from it; the server still holds it, read.
    page.wait_for_function("() => document.getElementById('notificationsList').textContent.includes('No unread alerts')")
    assert page.locator('#notificationsList .notifications-item').count() == 0
    rows = page.evaluate("async () => (await (await fetch('/api/notifications?status=all')).json()).notifications")
    assert len(rows) == 1 and rows[0]['readAt'] is not None


def test_preferences_default_and_persist(app_page):
    page = app_page
    _open_notifications_settings(page)
    # Defaults: every type on, 3 days, both channels, one email per alert.
    for box in ('#settingNotifyBillDue', '#settingNotifyLowBalance', '#settingNotifyZeroBalance', '#settingNotifyProjectedLow',
                '#settingNotifyPromoEnding'):
        assert page.is_checked(box), box
    assert page.input_value('#settingNotifyDaysAhead') == '3'
    assert page.input_value('#settingNotifyChannel') == 'both'
    assert page.input_value('#settingNotifyDelivery') == 'perEvent'
    # The CI stack has no SMTP, so the note says email is off.
    page.wait_for_selector('#settingNotifyEmailOff:not(.hidden)')

    page.uncheck('#settingNotifyLowBalance')
    page.fill('#settingNotifyDaysAhead', '7')
    page.select_option('#settingNotifyChannel', 'inApp')
    page.select_option('#settingNotifyDelivery', 'digest')
    _close_settings(page)
    wait_for_api(page, '/api/settings', lambda rows: {
        r['key']: r['value'] for r in rows if r['key'].startswith('notify')
    } == {'notifyLowBalance': False, 'notifyDaysAhead': 7, 'notifyChannel': 'inApp', 'notifyDelivery': 'digest'})

    page.reload()
    wait_for_app_ready(page)
    _open_notifications_settings(page)
    assert not page.is_checked('#settingNotifyLowBalance')
    assert page.is_checked('#settingNotifyBillDue')
    assert page.input_value('#settingNotifyDaysAhead') == '7'
    assert page.input_value('#settingNotifyChannel') == 'inApp'
    assert page.input_value('#settingNotifyDelivery') == 'digest'


def test_unchanged_preferences_are_not_written(app_page):
    page = app_page
    _open_notifications_settings(page)
    _close_settings(page)
    page.wait_for_timeout(300)
    rows = page.evaluate("async () => (await fetch('/api/settings')).json()")
    assert [r['key'] for r in rows if r['key'].startswith('notify')] == []


@pytest.mark.parametrize('bad', ['31', '-1', '2.5', ''])
def test_invalid_days_ahead_shows_error_and_saves_nothing(app_page, bad):
    page = app_page
    _open_notifications_settings(page)
    page.fill('#settingNotifyDaysAhead', bad)
    page.keyboard.press('Tab')
    page.wait_for_selector('#settingNotifyDaysAheadError:not(.hidden)')
    assert page.is_visible('#settingsModal')
    assert page.get_attribute('#settingNotifyDaysAhead', 'aria-invalid') == 'true'
    page.wait_for_timeout(300)
    rows = page.evaluate("async () => (await fetch('/api/settings')).json()")
    assert [r['key'] for r in rows if r['key'].startswith('notify')] == []

    # Fixing it saves the value.
    page.fill('#settingNotifyDaysAhead', '0')
    _close_settings(page)
    wait_for_api(page, '/api/settings', lambda rows: {
        r['key']: r['value'] for r in rows if r['key'].startswith('notify')
    } == {'notifyDaysAhead': 0})


def test_a_switched_off_type_raises_nothing(app_page):
    page = app_page
    seed_state(page, ZERO_ACCOUNT_STATE)
    wait_for_app_ready(page)
    _open_notifications_settings(page)
    page.uncheck('#settingNotifyZeroBalance')
    # The switch saved on change, so Check now checks with the new preferences.
    assert _check_now(page) == 'No new alerts.'
    assert _api_notifications(page)['notifications'] == []


def test_account_low_balance_threshold_add_edit_and_clear(app_page):
    page = app_page
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active')
    page.fill('#accountName', 'Bills Account')
    page.select_option('#accountType', 'Checking')
    page.fill('#accountStartingBalance', '1000')
    page.fill('#accountLowBalanceThreshold', '150')
    submit_account_form(page)
    accounts = wait_for_api(page, '/api/accounts', lambda rows: any(r['name'] == 'Bills Account' for r in rows))
    acct = next(r for r in accounts if r['name'] == 'Bills Account')
    assert acct['lowBalanceThreshold'] == 150
    assert page.input_value('#accountLowBalanceThreshold') == '', 'the form resets'
    badge = page.locator('#accountList .acct-lowbal-badge')
    assert 'Alert at $150.00' in badge.text_content()

    # Edit: change it, then clear it.
    page.click(f'[data-account-action="edit"][data-account-id="{acct["id"]}"]')
    assert page.input_value(f'#ac-lowbal-{acct["id"]}') == '150'
    page.fill(f'#ac-lowbal-{acct["id"]}', '75.5')
    page.click(f'[data-account-action="save"][data-account-id="{acct["id"]}"]')
    wait_for_api(page, '/api/accounts', lambda rows: any(r['id'] == acct['id'] and r['lowBalanceThreshold'] == 75.5 for r in rows))
    page.click(f'[data-account-action="edit"][data-account-id="{acct["id"]}"]')
    page.fill(f'#ac-lowbal-{acct["id"]}', '')
    page.click(f'[data-account-action="save"][data-account-id="{acct["id"]}"]')
    wait_for_api(page, '/api/accounts', lambda rows: any(r['id'] == acct['id'] and r['lowBalanceThreshold'] is None for r in rows))
    assert page.locator('#accountList .acct-lowbal-badge').count() == 0


def test_negative_low_balance_threshold_is_rejected(app_page):
    page = app_page
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active')
    page.fill('#accountName', 'Bad Threshold')
    page.fill('#accountStartingBalance', '10')
    page.fill('#accountLowBalanceThreshold', '-5')
    page.click('#accountFormSubmit')  # submit-no-wait: validation rejects it before any save
    page.wait_for_selector('#alertModalOkBtn', state='visible')
    assert 'low-balance alert amount' in page.text_content('#alertModal')
    page.click('#alertModalOkBtn')
    page.wait_for_timeout(300)
    rows = page.evaluate("async () => (await fetch('/api/accounts')).json()")
    assert not any(r['name'] == 'Bad Threshold' for r in rows)


def test_clear_all_data_removes_notifications(app_page):
    page = app_page
    seed_state(page, ZERO_ACCOUNT_STATE)
    wait_for_app_ready(page)
    page.evaluate("async () => { const r = await import('/src/notificationsCenter.js'); await r.runNotificationCheck(); }")
    assert len(_api_notifications(page)['notifications']) == 1
    page.evaluate("async () => { const s = await import('/src/postgresSync.js'); await s.pgDeleteAll(window.app); }")
    assert _api_notifications(page)['notifications'] == []


def _accounts_page(page):
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active')


def test_dont_notify_checkbox_add_and_edit_persists(app_page):
    page = app_page
    _accounts_page(page)
    page.fill('#accountName', 'Quiet Account')
    page.select_option('#accountType', 'Checking')
    page.fill('#accountStartingBalance', '0')
    page.check('#accountMuteBalanceAlerts')
    submit_account_form(page)
    accounts = wait_for_api(page, '/api/accounts', lambda rows: any(r['name'] == 'Quiet Account' for r in rows))
    acct = next(r for r in accounts if r['name'] == 'Quiet Account')
    assert acct['muteBalanceAlerts'] is True
    assert not page.is_checked('#accountMuteBalanceAlerts'), 'the form resets'
    card = page.locator('#accountList .acct-mute-badge')
    assert 'Alerts off' in card.text_content()

    page.click(f'[data-account-action="edit"][data-account-id="{acct["id"]}"]')
    assert page.is_checked(f'#ac-mute-{acct["id"]}')
    page.uncheck(f'#ac-mute-{acct["id"]}')
    page.click(f'[data-account-action="save"][data-account-id="{acct["id"]}"]')
    wait_for_api(page, '/api/accounts', lambda rows: any(r['id'] == acct['id'] and r['muteBalanceAlerts'] is False for r in rows))
    assert page.locator('#accountList .acct-mute-badge').count() == 0


def test_an_unticked_account_is_saved_unmuted(app_page):
    page = app_page
    _accounts_page(page)
    page.fill('#accountName', 'Loud Account')
    page.fill('#accountStartingBalance', '10')
    submit_account_form(page)
    accounts = wait_for_api(page, '/api/accounts', lambda rows: any(r['name'] == 'Loud Account' for r in rows))
    assert next(r for r in accounts if r['name'] == 'Loud Account')['muteBalanceAlerts'] is False
    assert page.locator('#accountList .acct-mute-badge').count() == 0


def test_muting_an_overdrawn_account_closes_its_alert(app_page):
    page = app_page
    seed_state(page, ZERO_ACCOUNT_STATE)
    wait_for_app_ready(page)
    page.evaluate("async () => { const r = await import('/src/notificationsCenter.js'); await r.runNotificationCheck(); }")
    alert = _api_notifications(page)['notifications'][0]
    assert alert['type'] == 'zeroBalance' and alert['resolvedAt'] is None

    _accounts_page(page)
    acct_id = page.evaluate("window.app.accounts.find(a => a.name === 'Overdrawn Checking').id")
    page.click(f'[data-account-action="edit"][data-account-id="{acct_id}"]')
    page.check(f'#ac-mute-{acct_id}')
    page.click(f'[data-account-action="save"][data-account-id="{acct_id}"]')
    # Saving a newly muted account runs the check, which resolves the alert.
    wait_for_api(page, '/api/notifications',
                 lambda d: len(d['notifications']) == 1 and d['notifications'][0]['resolvedAt'] is not None)
    page.evaluate("async () => { const r = await import('/src/notificationsCenter.js'); await r.runNotificationCheck(); }")
    assert len(_api_notifications(page)['notifications']) == 1, 'no new alert while muted'
