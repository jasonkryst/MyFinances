"""The toolbar bell follows the Notifications page's saved filters (#649).

The page's Type, Status and Account choices are saved as the settings
notifyFilterType / notifyFilterStatus / notifyFilterAccount, and the bell's
list and badge fetch with them. Seeded like test_notifications_page.py: three
overdrawn accounts (zeroBalance) and one account under its alert amount
(lowBalance), so 4 unread alerts.
"""
import pytest

from tests.conftest import seed_state, wait_for_api, wait_for_app_ready
from tests.features.test_notifications_page import (
    STATE, _api, _badge, _open_page, _run_check, _seed_alerts, _wait_rows,
)

pytestmark = pytest.mark.feature

BELL_ITEMS = '#notificationsList .notifications-item'

_REFRESH_JS = ("async () => { const r = await import('/src/notificationsCenter.js');"
               " await r.refreshNotifications({ force: true }); }")


def _settings_value(data, key):
    rows = data if isinstance(data, list) else data.get('settings', [])
    for row in rows:
        if row.get('key') == key:
            return row.get('value')
    return None


def _wait_setting(page, key, value):
    wait_for_api(page, '/api/settings', lambda d: _settings_value(d, key) == value)


def _set_setting(page, key, value):
    page.evaluate(
        "async ([k, v]) => { const s = await import('/src/settings.js'); s.setSetting(window.app, k, v); }",
        [key, value])
    _wait_setting(page, key, value)


def _wait_badge(page, n):
    if n == 0:
        page.wait_for_selector('#notificationsBadge.hidden', state='attached')
    else:
        page.wait_for_function(
            "(n) => { const b = document.getElementById('notificationsBadge');"
            " return !b.classList.contains('hidden') && b.textContent === String(n); }", arg=n)


def _open_bell(page):
    if page.locator('#notificationsPanel').is_hidden():
        page.click('#notificationsBtn')
    page.wait_for_selector('#notificationsPanel:not(.hidden)')


def _account_id(page, name):
    return page.evaluate("(n) => window.app.accounts.find(a => a.name === n).id", name)


def test_type_filter_on_page_drives_bell_and_survives_reload(app_page):
    page = app_page
    _seed_alerts(page)
    _open_page(page, 4)
    page.select_option('#notifFilterType', 'overdrawn')
    _wait_rows(page, 3)
    _wait_setting(page, 'notifyFilterType', 'overdrawn')
    _wait_badge(page, 3)
    _open_bell(page)
    page.wait_for_function("() => document.querySelectorAll('#notificationsList .notifications-item').length === 3")
    assert all('overdrawn' in t for t in page.locator(BELL_ITEMS).all_text_contents())

    page.reload()
    page.wait_for_function("() => document.documentElement.dataset.notificationsLoaded === 'true'")
    _wait_badge(page, 3)
    _open_bell(page)
    assert page.locator(BELL_ITEMS).count() == 3
    assert page.locator('#notificationsFilterNote').is_visible()


def test_low_balance_filter_ignores_new_overdrawn_alerts(app_page):
    # Negative case: the three overdrawn alerts raised after choosing Low
    # balance never reach the bell's badge or list.
    page = app_page
    seed_state(page, STATE)
    wait_for_app_ready(page)
    _set_setting(page, 'notifyFilterType', 'lowBalance')
    _run_check(page)
    page.evaluate(_REFRESH_JS)
    _wait_badge(page, 1)
    assert _api(page)['unreadCount'] == 4
    _open_bell(page)
    items = page.locator(BELL_ITEMS)
    assert items.count() == 1
    assert 'Low Checking' in items.first.text_content()


def test_filtered_line_and_clear_from_bell_resets_bell_and_page(app_page):
    page = app_page
    _seed_alerts(page)
    _open_bell(page)
    # Default filters: no filtered line.
    assert page.locator('#notificationsFilterNote').is_hidden()
    page.keyboard.press('Escape')

    _open_page(page, 4)
    page.select_option('#notifFilterType', 'overdrawn')
    page.select_option('#notifFilterAccount', str(_account_id(page, 'Overdrawn A')))
    _wait_rows(page, 1)
    _wait_setting(page, 'notifyFilterAccount', _account_id(page, 'Overdrawn A'))
    _wait_badge(page, 1)

    _open_bell(page)
    note = page.locator('#notificationsFilterNote')
    note.wait_for(state='visible')
    assert 'Filtered: Overdrawn · Unread · Overdrawn A' in note.text_content()
    assert page.locator('#notificationsViewAllBtn').is_visible()

    page.click('#notificationsFilterClearBtn')
    assert page.evaluate("document.activeElement && document.activeElement.id") == 'notificationsPanelTitle'
    _wait_badge(page, 4)
    page.wait_for_selector('#notificationsFilterNote', state='hidden')
    assert page.locator(BELL_ITEMS).count() == 4
    _wait_setting(page, 'notifyFilterType', 'all')
    _wait_setting(page, 'notifyFilterAccount', 0)
    assert page.input_value('#notifFilterType') == 'all'
    assert page.input_value('#notifFilterAccount') == 'all'
    assert page.input_value('#notifFilterStatus') == 'unread'
    _wait_rows(page, 4)


def test_default_unread_bell_after_mark_all_read_shows_no_unread_state(app_page):
    page = app_page
    _seed_alerts(page)
    _open_bell(page)
    assert page.locator(BELL_ITEMS).count() == 4
    page.click('#notificationsMarkAllBtn')
    _wait_badge(page, 0)
    page.wait_for_function(
        "() => document.getElementById('notificationsList').textContent.includes('No unread alerts')")
    assert page.locator(BELL_ITEMS).count() == 0
    assert page.locator('#notificationsMarkAllBtn').is_disabled()
    wait_for_api(page, '/api/notifications', lambda d: d['unreadCount'] == 0)


def test_filtered_mark_all_read_leaves_hidden_alerts_unread(app_page):
    page = app_page
    _seed_alerts(page)
    _set_setting(page, 'notifyFilterType', 'overdrawn')
    page.evaluate(_REFRESH_JS)
    _wait_badge(page, 3)
    _open_bell(page)
    page.click('#notificationsMarkAllBtn')
    _wait_badge(page, 0)
    data = wait_for_api(page, '/api/notifications?limit=500', lambda d: d['unreadCount'] == 1)
    unread = [n for n in data['notifications'] if not n['readAt']]
    assert [n['type'] for n in unread] == ['lowBalance']
    page.wait_for_function(
        "() => document.getElementById('notificationsList').textContent.includes('No alerts match your filters')")


def test_saved_account_deleted_falls_back_to_all(app_page):
    page = app_page
    _seed_alerts(page)
    acct = _account_id(page, 'Overdrawn A')
    _set_setting(page, 'notifyFilterAccount', acct)
    page.evaluate(_REFRESH_JS)
    _wait_badge(page, 1)

    # Delete the account on the server and in memory, the way another device would.
    page.evaluate("""async (id) => {
        const { getCsrfCookie } = await import('/src/storage.js');
        const res = await fetch('/api/accounts/' + id, { method: 'DELETE', credentials: 'same-origin',
            headers: { 'X-CSRF-Token': getCsrfCookie() } });
        if (!res.ok) throw new Error('delete failed ' + res.status);
        window.app.accounts = window.app.accounts.filter(a => a.id !== id);
    }""", acct)
    urls = []
    page.on('request', lambda r: urls.append(r.url) if '/api/notifications' in r.url else None)
    page.evaluate(_REFRESH_JS)
    _wait_badge(page, 4)
    bell_urls = list(urls)  # captured before the test's own _api fetch
    expected = _api(page)['unreadCount']
    assert expected > 1 and expected == 4
    assert bell_urls and all('account=' not in u for u in bell_urls), bell_urls


def test_badge_stays_filtered_after_page_load_and_bulk_marks(app_page):
    page = app_page
    _seed_alerts(page)
    _set_setting(page, 'notifyFilterType', 'overdrawn')
    page.evaluate(_REFRESH_JS)
    _wait_badge(page, 3)

    # The page loads 500 rows unfiltered; the badge keeps the bell's count.
    _open_page(page, 3)
    page.wait_for_function("() => document.documentElement.dataset.notificationsAllLoaded === 'true'")
    page.wait_for_timeout(200)
    assert _badge(page) == 3
    assert '4 unread' in page.text_content('#notifSummary')

    # A single mark: the /read response carries the unfiltered count (3).
    page.locator('#notificationsPageList .notif-row').first.locator('.notif-row-read').click()
    _wait_rows(page, 2)
    _wait_badge(page, 2)
    page.wait_for_timeout(300)
    assert _badge(page) == 2
    page.wait_for_function("() => document.getElementById('notifSummary').textContent.includes('3 unread')")

    page.click('#notifMarkMatchingBtn')
    _wait_badge(page, 0)
    wait_for_api(page, '/api/notifications', lambda d: d['unreadCount'] == 1)
    page.wait_for_timeout(300)
    assert _badge(page) == 0
    page.wait_for_function("() => document.getElementById('notifSummary').textContent.includes('1 unread')")


def test_settings_changed_elsewhere_refetch_bell_on_live_refresh(app_page):
    page = app_page
    _seed_alerts(page)
    # Another device saves Type = Overdrawn.
    page.evaluate("""async () => {
        const { getCsrfCookie } = await import('/src/storage.js');
        const res = await fetch('/api/settings/notifyFilterType', { method: 'PUT', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfCookie() },
            body: JSON.stringify({ value: 'overdrawn' }) });
        if (!res.ok) throw new Error('put failed ' + res.status);
    }""")
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    page.evaluate("async () => { await window.app.refreshFromServer(); }")
    _wait_badge(page, 3)
