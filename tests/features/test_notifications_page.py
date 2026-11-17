"""Notifications page (#643): view every alert, filter, bulk mark read, Undo and
View deep links.

Alerts are raised on demand through POST /api/notifications/check (the CI stack
runs with JOBS_ENABLED=false). Only balance alerts are seeded, since they do not
depend on the date or the server's time zone: three overdrawn accounts raise
zeroBalance, one account under its alert amount raises lowBalance, and a muted
overdrawn account raises nothing. Bill alerts' Ledger deep link is covered by
Jest (notificationViewTarget) plus one test that injects a bill alert into the
page's state.
"""
import re

import pytest

from tests.conftest import BASE_URL, ensure_session, seed_state, wait_for_api, wait_for_app_ready

pytestmark = pytest.mark.feature

STATE = {
    'accounts': [
        {'id': 1, 'name': 'Overdrawn A', 'type': 'Checking', 'startingBalance': -10},
        {'id': 2, 'name': 'Overdrawn B', 'type': 'Checking', 'startingBalance': -20},
        {'id': 3, 'name': 'Overdrawn C', 'type': 'Savings', 'startingBalance': -30},
        {'id': 4, 'name': 'Low Checking', 'type': 'Checking', 'startingBalance': 50, 'lowBalanceThreshold': 100},
        {'id': 5, 'name': 'Muted Overdrawn', 'type': 'Checking', 'startingBalance': -40, 'muteBalanceAlerts': True},
    ],
    'debts': [],
}

ROWS = '#notificationsPageList .notif-row'


def _seed_alerts(page):
    seed_state(page, STATE)
    wait_for_app_ready(page)
    page.evaluate("async () => { const r = await import('/src/notificationsCenter.js'); await r.runNotificationCheck(); }")
    page.wait_for_function("() => document.getElementById('notificationsBadge').textContent === '4'")


def _api(page):
    return page.evaluate("async () => (await fetch('/api/notifications?limit=500')).json()")


def _wait_rows(page, n):
    page.wait_for_function(
        "(n) => document.documentElement.dataset.notificationsPageReady === 'true'"
        " && document.querySelectorAll('#notificationsPageList .notif-row').length === n", arg=n)


def _open_page(page, rows=None):
    page.evaluate("() => window.app.switchPage('notifications')")
    page.wait_for_selector('#notificationsPage.active')
    if rows is not None:
        _wait_rows(page, rows)


def _row(page, name):
    # Messages start with the account or bill name. has_text is a
    # case-insensitive substring, and "Overdrawn A" would also match
    # "Overdrawn C is overdrawn at", so match the start of the message.
    text = page.locator('.notif-row-text', has_text=re.compile('^' + re.escape(name) + r'( |$)'))
    return page.locator(ROWS).filter(has=text)


def _badge(page):
    badge = page.locator('#notificationsBadge')
    return 0 if 'hidden' in (badge.get_attribute('class') or '') else int(badge.text_content())


def test_view_all_opens_page(app_page):
    page = app_page
    _seed_alerts(page)
    page.click('#notificationsBtn')
    page.click('#notificationsViewAllBtn')
    page.wait_for_selector('#notificationsPage.active')
    page.wait_for_selector('#notificationsPanel', state='hidden')
    _wait_rows(page, 4)
    assert _row(page, 'Muted Overdrawn').count() == 0
    assert '4 unread' in page.text_content('#notifSummary')
    assert page.locator('#notificationsPageList .notif-group-heading').first.text_content() == 'Today'
    # Every row's controls name the alert.
    row = _row(page, 'Low Checking')
    msg = row.locator('.notif-row-text').text_content()
    assert row.locator('.notif-row-view').get_attribute('aria-label') == f'View: {msg}'
    assert row.locator('.notif-row-read').get_attribute('aria-label') == f'Mark read: {msg}'
    assert row.locator('.notif-row-select').get_attribute('aria-label') == f'Select: {msg}'


def test_palette_opens_page(app_page):
    page = app_page
    _seed_alerts(page)
    page.click('#commandPaletteBtn')
    page.fill('#commandPaletteInput', 'Notifications')
    page.keyboard.press('Enter')
    page.wait_for_selector('#notificationsPage.active')
    _wait_rows(page, 4)


def test_status_filter_default_unread_and_all(app_page):
    page = app_page
    _seed_alerts(page)
    _open_page(page, 4)
    assert page.input_value('#notifFilterStatus') == 'unread'
    _row(page, 'Overdrawn A').locator('.notif-row-read').click()
    _wait_rows(page, 3)
    assert _row(page, 'Overdrawn A').count() == 0
    wait_for_api(page, '/api/notifications', lambda d: d['unreadCount'] == 3)

    page.select_option('#notifFilterStatus', 'all')
    _wait_rows(page, 4)
    row = _row(page, 'Overdrawn A')
    assert 'notif-row--read' in row.get_attribute('class')
    assert row.locator('.notif-row-read').text_content() == 'Mark unread'
    page.select_option('#notifFilterStatus', 'read')
    _wait_rows(page, 1)


def test_type_filter(app_page):
    page = app_page
    _seed_alerts(page)
    _open_page(page, 4)
    page.select_option('#notifFilterType', 'lowBalance')
    _wait_rows(page, 1)
    assert _row(page, 'Low Checking').count() == 1
    page.select_option('#notifFilterType', 'overdrawn')
    _wait_rows(page, 3)
    page.select_option('#notifFilterType', 'bill')
    page.wait_for_selector('#notificationsPageList .notif-empty--nomatch')


def test_account_filter(app_page):
    page = app_page
    _seed_alerts(page)
    _open_page(page, 4)
    options = page.eval_on_selector_all('#notifFilterAccount option', 'os => os.map(o => o.textContent)')
    assert options[0] == 'All accounts'
    assert 'Overdrawn B' in options
    page.select_option('#notifFilterAccount', label='Overdrawn B')
    _wait_rows(page, 1)
    assert _row(page, 'Overdrawn B').count() == 1


def test_date_filter_excludes(app_page):
    page = app_page
    _seed_alerts(page)
    _open_page(page, 4)
    tomorrow = page.evaluate("""() => {
        const d = new Date(); d.setDate(d.getDate() + 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }""")
    page.fill('#notifFilterFrom', tomorrow)
    page.dispatch_event('#notifFilterFrom', 'change')
    page.wait_for_selector('#notificationsPageList .notif-empty--nomatch')
    assert 'No alerts match these filters.' in page.text_content('#notificationsPageList')
    page.click('#notifEmptyClearBtn')
    _wait_rows(page, 4)
    assert page.input_value('#notifFilterFrom') == ''

    # The filter bar's own Clear does the same.
    page.select_option('#notifFilterType', 'lowBalance')
    _wait_rows(page, 1)
    page.click('#notifFilterClear')
    _wait_rows(page, 4)
    assert page.input_value('#notifFilterType') == 'all'


def test_bulk_mark_selected_read_updates_badge(app_page):
    page = app_page
    _seed_alerts(page)
    _open_page(page, 4)
    assert page.is_disabled('#notifMarkSelectedBtn')
    before = _badge(page)
    _row(page, 'Overdrawn A').locator('.notif-row-select').check()
    _row(page, 'Overdrawn B').locator('.notif-row-select').check()
    assert page.text_content('#notifSelectedCount') == '2 selected'
    page.dblclick('#notifMarkSelectedBtn')
    _wait_rows(page, 2)
    assert _badge(page) == before - 2
    data = wait_for_api(page, '/api/notifications', lambda d: d['unreadCount'] == 2)
    page.wait_for_timeout(300)
    assert _api(page)['unreadCount'] == 2, 'the double click marked nothing extra'
    assert sorted(n['params']['accountName'] for n in data['notifications'] if n['readAt']) == ['Overdrawn A', 'Overdrawn B']
    assert page.text_content('#undoToastMessage') == 'Marked 2 alerts read'
    assert page.text_content('#notifSelectedCount') == ''


def test_select_all_visible(app_page):
    page = app_page
    _seed_alerts(page)
    _open_page(page, 4)
    page.select_option('#notifFilterType', 'overdrawn')
    _wait_rows(page, 3)
    page.check('#notifSelectAll')
    assert page.locator(f'{ROWS} .notif-row-select:checked').count() == 3
    assert page.text_content('#notifSelectedCount') == '3 selected'
    page.uncheck('#notifSelectAll')
    assert page.locator(f'{ROWS} .notif-row-select:checked').count() == 0


def test_mark_all_matching(app_page):
    page = app_page
    _seed_alerts(page)
    _open_page(page, 4)
    page.select_option('#notifFilterType', 'overdrawn')
    _wait_rows(page, 3)
    page.click('#notifMarkMatchingBtn')
    page.wait_for_selector('#notificationsPageList .notif-empty--nomatch')
    wait_for_api(page, '/api/notifications', lambda d: d['unreadCount'] == 1)
    assert _badge(page) == 1
    assert page.text_content('#undoToastMessage') == 'Marked 3 alerts read'
    assert page.is_disabled('#notifMarkMatchingBtn')


def test_undo_restores_unread(app_page):
    page = app_page
    _seed_alerts(page)
    _open_page(page, 4)
    _row(page, 'Overdrawn C').locator('.notif-row-select').check()
    page.click('#notifMarkSelectedBtn')
    _wait_rows(page, 3)
    wait_for_api(page, '/api/notifications', lambda d: d['unreadCount'] == 3)
    page.click('#undoToastBtn')
    _wait_rows(page, 4)
    wait_for_api(page, '/api/notifications', lambda d: d['unreadCount'] == 4)
    assert _badge(page) == 4
    assert _row(page, 'Overdrawn C').count() == 1


def test_view_balance_alert_scrolls_to_account(app_page):
    page = app_page
    _seed_alerts(page)
    _open_page(page, 4)
    acct_id = page.evaluate("window.app.accounts.find(a => a.name === 'Low Checking').id")
    _row(page, 'Low Checking').locator('.notif-row-view').click()
    page.wait_for_selector('#accountsSection.active')
    card = page.locator('#accountsSection .acct-card.notif-highlight')
    card.wait_for()
    assert card.locator(f'[data-account-id="{acct_id}"]').count() > 0
    data = wait_for_api(page, '/api/notifications', lambda d: d['unreadCount'] == 3)
    low = next(n for n in data['notifications'] if n['type'] == 'lowBalance')
    assert low['readAt'] is not None
    # The highlight is temporary.
    page.wait_for_selector('#accountsSection .acct-card.notif-highlight', state='detached', timeout=5000)


def test_view_with_deleted_account_still_navigates(app_page):
    page = app_page
    _seed_alerts(page)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    acct_id = page.evaluate("window.app.accounts.find(a => a.name === 'Overdrawn C').id")
    status = page.evaluate("""async (id) => {
        const { getCsrfCookie } = await import('/src/storage.js');
        const r = await fetch('/api/accounts/' + id, { method: 'DELETE', headers: { 'X-CSRF-Token': getCsrfCookie() } });
        return r.status;
    }""", acct_id)
    assert status in (200, 204), status
    page.reload()
    wait_for_app_ready(page)
    _open_page(page, 4)
    _row(page, 'Overdrawn C').locator('.notif-row-view').click()
    page.wait_for_selector('#accountsSection.active')
    page.wait_for_timeout(300)
    assert page.locator('.notif-highlight').count() == 0
    assert errors == []


def test_view_bill_alert_opens_filtered_ledger(app_page):
    """Bill alerts depend on today's date, so one is injected into the page's state."""
    page = app_page
    _seed_alerts(page)
    _open_page(page, 4)
    acct_id = page.evaluate("window.app.accounts.find(a => a.name === 'Overdrawn B').id")
    page.evaluate("""async (accountId) => {
        const nc = await import('/src/notificationsCenter.js');
        const s = nc.getNotificationsState();
        s.all.unshift({ id: 999999, type: 'billDueToday', params: { name: 'Rent', amount: 900, accountId },
                        createdAt: new Date().toISOString(), readAt: null, resolvedAt: null });
        nc.renderNotificationsCenter();
    }""", acct_id)
    _wait_rows(page, 5)
    _row(page, 'Rent').locator('.notif-row-view').click()
    page.wait_for_selector('#ledgerSection.active')
    assert page.evaluate('window.app._ledgerAccountFilter') == acct_id
    assert page.input_value('#ledgerAccountFilter') == str(acct_id)


def test_empty_state(app_page):
    page = app_page
    _open_page(page)
    page.wait_for_function("() => document.documentElement.dataset.notificationsPageReady === 'true'")
    assert 'No alerts yet' in page.text_content('#notificationsPageList')
    assert page.is_disabled('#notifMarkMatchingBtn')
    assert page.is_disabled('#notifMarkSelectedBtn')


def test_load_failed_shows_retry(browser, stack_user):
    context = browser.new_context(service_workers='block')
    try:
        ensure_session(context)
        page = context.new_page()
        fail = {'on': True}

        def handler(route):
            if fail['on']:
                route.fulfill(status=500, content_type='application/json', body='{"error":"boom"}')
            else:
                route.continue_()

        page.route('**/api/notifications?limit=500', handler)
        page.goto(BASE_URL)
        wait_for_app_ready(page)
        page.evaluate("() => window.app.switchPage('notifications')")
        page.wait_for_selector('#notifRetryBtn')
        assert "Couldn't load notifications." in page.text_content('#notificationsPageList')
        fail['on'] = False
        page.click('#notifRetryBtn')
        page.wait_for_selector('#notifRetryBtn', state='detached')
        page.wait_for_function("() => document.documentElement.dataset.notificationsPageReady === 'true'")
        assert "Couldn't load" not in page.text_content('#notificationsPageList')
    finally:
        context.close()
