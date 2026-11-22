"""Settings > Change history (#580): the audit rows the server writes for every
create/update/delete, listed newest first, filtered, paged, and erased by
Clear All Data. Positive and negative cases."""
import json

import pytest

from tests.conftest import open_settings_page, seed_state

pytestmark = pytest.mark.feature

API_JS = """async ([method, path, body]) => {
    const csrf = (document.cookie.match(/csrf=([^;]+)/) || [])[1];
    const res = await fetch(path, {
        method, credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: body === null ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
}"""


def api(page, method, path, body=None):
    return page.evaluate(API_JS, [method, path, body])


def clear_log(page):
    assert api(page, 'DELETE', '/api/audit-log')['status'] == 204


def open_history(page):
    open_settings_page(page, 'history')
    page.wait_for_function(
        "() => { const s = document.getElementById('changeHistoryStatus');"
        " return s && !/Loading/.test(s.textContent); }", timeout=5000)


def items(page):
    return page.locator('#changeHistoryList > li.change-history-item')


def test_lists_create_change_delete_newest_first(app_page):
    page = app_page
    clear_log(page)
    acct = api(page, 'POST', '/api/accounts', {'name': 'Audit Checking', 'type': 'Checking', 'startingBalance': 100})
    assert acct['status'] == 201
    acct_id = acct['body']['id']
    assert api(page, 'PATCH', f'/api/accounts/{acct_id}', {'startingBalance': 250})['status'] == 200
    assert api(page, 'DELETE', f'/api/accounts/{acct_id}')['status'] == 204

    open_history(page)
    rows = items(page)
    assert rows.count() == 3
    ops = [rows.nth(i).locator('.change-history-op').inner_text() for i in range(3)]
    assert ops == ['Deleted', 'Changed', 'Created']
    for i in range(3):
        assert rows.nth(i).locator('.change-history-type').inner_text() == 'Account'
        assert rows.nth(i).locator('.change-history-name').inner_text() == 'Audit Checking'
        assert rows.nth(i).locator('time').get_attribute('datetime')
    changed = rows.nth(1).locator('.change-history-field')
    assert changed.count() == 1
    assert changed.first.inner_text().replace('\n', '') == 'startingBalance: 100 → 250'
    # Creates and deletes carry no field list.
    assert rows.nth(0).locator('.change-history-fields').count() == 0
    assert rows.nth(2).locator('.change-history-fields').count() == 0
    assert page.locator('#changeHistoryMoreBtn').is_hidden()


def test_empty_history_shows_message(app_page):
    page = app_page
    clear_log(page)
    open_history(page)
    assert items(page).count() == 0
    assert page.locator('#changeHistoryList').is_hidden()
    assert page.inner_text('#changeHistoryStatus') == 'No changes recorded yet.'


def test_filter_by_record_type(app_page):
    page = app_page
    clear_log(page)
    api(page, 'POST', '/api/persons', {'name': 'Audit Person'})
    api(page, 'POST', '/api/accounts', {'name': 'Audit Savings', 'type': 'Savings'})
    open_history(page)
    assert items(page).count() == 2
    page.select_option('#changeHistoryFilter', 'persons')
    page.wait_for_function("() => document.querySelectorAll('#changeHistoryList > li').length === 1")
    assert items(page).first.locator('.change-history-name').inner_text() == 'Audit Person'
    # A type with no entries shows the filtered empty message.
    page.select_option('#changeHistoryFilter', 'transfers')
    page.wait_for_function(
        "() => document.getElementById('changeHistoryStatus').textContent"
        " === 'No changes recorded for this record type.'")
    assert items(page).count() == 0


def test_load_more_pages_older_entries(app_page):
    page = app_page
    clear_log(page)
    page.evaluate("""async () => {
        const csrf = document.cookie.match(/csrf=([^;]+)/)[1];
        for (let i = 0; i < 53; i++) {
            await fetch('/api/persons', { method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                body: JSON.stringify({ name: 'P' + i }) });
        }
    }""")
    open_history(page)
    assert items(page).count() == 50
    more = page.locator('#changeHistoryMoreBtn')
    assert more.is_visible()
    more.click()
    page.wait_for_function("() => document.querySelectorAll('#changeHistoryList > li').length === 53")
    assert more.is_hidden()
    names = [items(page).nth(i).locator('.change-history-name').inner_text() for i in (0, 52)]
    assert names == ['P52', 'P0']


def test_values_render_as_text_not_html(app_page):
    """Negative: markup in a stored name or value is shown literally. The
    server's sanitizers strip angle brackets from names, so the response is
    stubbed to prove the page itself never parses entry text as HTML."""
    page = app_page
    evil = '<img src=x onerror="window.__auditXss=1">'
    page.evaluate("""evil => {
        const orig = window.fetch;
        const body = { hasMore: false, entries: [{
            id: 2, table: 'accounts', rowId: '7', op: 'update', at: new Date().toISOString(),
            before: { id: 7, name: evil, notes: 'a' }, after: { id: 7, name: evil, notes: evil }
        }] };
        window.fetch = (url, opts) => String(url).startsWith('/api/audit-log')
            ? Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }))
            : orig(url, opts);
    }""", evil)
    open_history(page)
    assert page.locator('#changeHistoryList img').count() == 0
    item = items(page).first
    assert item.locator('.change-history-name').inner_text() == evil
    assert evil in item.locator('.change-history-field').inner_text()
    assert page.evaluate('window.__auditXss') is None


def test_server_strips_markup_from_logged_names(app_page):
    """Negative: what reaches the log is the sanitized record, never raw input."""
    page = app_page
    clear_log(page)
    api(page, 'POST', '/api/accounts', {'name': '<b>Bold</b>', 'type': 'Checking'})
    entry = api(page, 'GET', '/api/audit-log')['body']['entries'][0]
    assert '<' not in entry['after']['name'] and '>' not in entry['after']['name']


def test_load_failure_shows_error(app_page):
    """Negative: a failed read shows the error text instead of an empty list."""
    page = app_page
    page.evaluate("""() => {
        const orig = window.fetch;
        window.fetch = (url, opts) => String(url).startsWith('/api/audit-log')
            ? Promise.resolve(new Response('{}', { status: 500 })) : orig(url, opts);
    }""")
    open_history(page)
    assert page.inner_text('#changeHistoryStatus') == 'Could not load the change history. Try again later.'
    assert items(page).count() == 0


def test_view_filter_changes_are_not_logged(app_page):
    """Negative: Ledger filter state in plan settings is view state, not history."""
    page = app_page
    clear_log(page)
    assert api(page, 'PATCH', '/api/plan-settings', {'ledgerSettings': {'accountFilter': 'all', 'pageSize': 50}})['status'] == 200
    assert api(page, 'GET', '/api/audit-log')['body']['entries'] == []
    assert api(page, 'PATCH', '/api/plan-settings', {'strategy': 'snowball'})['status'] == 200
    entries = api(page, 'GET', '/api/audit-log')['body']['entries']
    assert [(e['table'], e['op']) for e in entries] == [('plan_settings', 'update')]


def test_clear_all_data_erases_history(app_page):
    page = app_page
    api(page, 'POST', '/api/persons', {'name': 'Before Clear'})
    assert api(page, 'GET', '/api/audit-log')['body']['entries']
    page.evaluate('async () => { await window.app.clearAllData(); }')
    entries = api(page, 'GET', '/api/audit-log')['body']['entries']
    assert not any(e['table'] == 'persons' for e in entries), json.dumps(entries)[:500]
    assert not any(e['op'] == 'delete' for e in entries)


def test_replace_import_keeps_history(app_page):
    """A replace import wipes the data but not the history of it."""
    page = app_page
    clear_log(page)
    api(page, 'POST', '/api/persons', {'name': 'Kept Person'})
    seed_state(page, {'accounts': [{'id': 1, 'name': 'Imported', 'type': 'Checking', 'startingBalance': 0}]})
    entries = api(page, 'GET', '/api/audit-log?limit=200')['body']['entries']
    summary = {(e['table'], e['op'], (e['after'] or e['before'] or {}).get('name')) for e in entries}
    assert ('persons', 'create', 'Kept Person') in summary
    assert ('persons', 'delete', 'Kept Person') in summary
    assert ('accounts', 'create', 'Imported') in summary
