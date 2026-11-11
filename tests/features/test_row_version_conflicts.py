#!/usr/bin/env python3
"""
Optimistic concurrency with a row version (#578) and stale full-record PATCHes
(#563).

Every record PATCH now sends only the fields this tab changed, diffed against
the last server-confirmed copy, plus the rowVersion it saw. The server answers
409 with its current row when the version moved. Edits to different fields are
merged and resent; edits to the same field ask the user (#syncConflictModal).

Edits go through the real postgresSync.pgPatch with the live in-memory record,
exactly as the feature modules call it.
"""

import pytest

from tests.conftest import BASE_URL, ensure_session, seed_state, wait_for_api, wait_for_app_ready

DEBTS = '/api/debts'

STATE = {
    'version': '3.0',
    'accounts': [{'id': 1, 'name': 'RV Checking', 'type': 'Checking', 'startingBalance': 1000}],
    'debts': [{'id': 1, 'name': 'Car Loan', 'debtType': 'personal', 'accountBalance': 5000,
               'interestRate': 6, 'minimumPayment': 200, 'dueDate': 10, 'accountId': 1}],
}


def _open_second_tab(page):
    """A second signed-in tab in its own context (like another device), loaded
    now so it goes stale when the first tab writes."""
    context = page.context.browser.new_context()
    ensure_session(context)
    other = context.new_page()
    other.goto(BASE_URL)
    wait_for_app_ready(other)
    return other


def _record_patches(page):
    bodies = []
    page.on('request', lambda req: bodies.append(req.post_data_json)
            if req.method == 'PATCH' and '/api/debts/' in req.url else None)
    return bodies


# Mutate the in-memory debt, then pgPatch it like the feature modules do.
# `wait` false returns before the PATCH settles (for prompts / rapid edits).
_EDIT_JS = """async ({ changes, wait }) => {
    const sync = await import('/src/postgresSync.js');
    const d = window.app.debts.find(x => x.name === 'Car Loan' || x.id === window.__rvId);
    window.__rvId = d.id;
    Object.assign(d, changes);
    const p = sync.pgPatch(window.app, `/api/debts/${d.id}`, d);
    if (wait) await p; else window.__rvPending = p;
    return d.id;
}"""


def _edit(page, changes, wait=True):
    return page.evaluate(_EDIT_JS, {'changes': changes, 'wait': wait})


def _server_debt(page):
    rows = wait_for_api(page, DEBTS, lambda d: len(d) == 1)
    return rows[0]


def _local_debt(page):
    return page.evaluate("() => window.app.debts.find(x => x.id === window.__rvId) || window.app.debts[0]")


# ─── Positive ────────────────────────────────────────────────────────────────

@pytest.mark.feature
def test_stale_tab_edits_of_different_fields_both_survive(app_page):
    """Acceptance (#563): tab A renames a debt; stale tab B edits its balance;
    after a reload both changes are present, with no prompt."""
    page_a = app_page
    seed_state(page_a, STATE)
    page_b = _open_second_tab(page_a)
    try:
        _edit(page_a, {'name': 'Auto Loan'})
        bodies_b = _record_patches(page_b)
        page_b.evaluate("() => { window.__rvId = window.app.debts[0].id; }")
        _edit(page_b, {'accountBalance': 4000})

        assert not page_b.locator('#syncConflictModal').is_visible()
        # B sent only its own field, never the stale name.
        assert bodies_b and all('name' not in b for b in bodies_b), bodies_b
        row = wait_for_api(page_a, DEBTS, lambda d: d[0]['accountBalance'] == 4000)[0]
        assert row['name'] == 'Auto Loan', row
        # B picked up A's rename locally while merging.
        assert _local_debt(page_b)['name'] == 'Auto Loan'

        page_b.reload()
        wait_for_app_ready(page_b)
        debt = page_b.evaluate("() => window.app.debts[0]")
        assert (debt['name'], debt['accountBalance']) == ('Auto Loan', 4000)
    finally:
        page_b.context.close()


@pytest.mark.feature
def test_patch_sends_only_changed_fields_and_version(app_page):
    """Diff-only bodies (#563): a whole-record pgPatch sends just the changed
    field plus rowVersion; an archive call sends only its fields."""
    page = app_page
    seed_state(page, STATE)
    bodies = _record_patches(page)
    _edit(page, {'notes': 'call the bank'})
    assert bodies[-1] == {'notes': 'call the bank', 'rowVersion': 1}, bodies
    page.evaluate("""async () => {
        const sync = await import('/src/postgresSync.js');
        await sync.pgPatch(window.app, `/api/debts/${window.__rvId}`, { archived: true });
    }""")
    assert bodies[-1] == {'archived': True, 'rowVersion': 2}, bodies
    row = _server_debt(page)
    assert row['notes'] == 'call the bank' and row['archived'] is True and row['rowVersion'] == 3


@pytest.mark.feature
def test_unchanged_record_sends_no_request(app_page):
    page = app_page
    seed_state(page, STATE)
    bodies = _record_patches(page)
    _edit(page, {})
    assert bodies == [], bodies


@pytest.mark.feature
def test_rapid_edits_in_one_tab_do_not_conflict_with_each_other(app_page):
    """Two edits fired back to back are queued per record, so the second uses
    the version the first produced instead of 409ing against it."""
    page = app_page
    seed_state(page, STATE)
    bodies = _record_patches(page)
    page.evaluate("""async () => {
        const sync = await import('/src/postgresSync.js');
        const d = window.app.debts[0];
        window.__rvId = d.id;
        d.name = 'First';
        const p1 = sync.pgPatch(window.app, `/api/debts/${d.id}`, d);
        d.accountBalance = 1234;
        const p2 = sync.pgPatch(window.app, `/api/debts/${d.id}`, d);
        await Promise.all([p1, p2]);
    }""")
    assert not page.locator('#syncConflictModal').is_visible()
    row = _server_debt(page)
    assert (row['name'], row['accountBalance']) == ('First', 1234), row
    assert all(b.get('rowVersion') for b in bodies), bodies
    assert len({b['rowVersion'] for b in bodies}) == len(bodies), f'versions must advance: {bodies}'


@pytest.mark.feature
def test_same_field_conflict_keep_mine_overwrites(app_page):
    page_a = app_page
    seed_state(page_a, STATE)
    page_b = _open_second_tab(page_a)
    try:
        _edit(page_a, {'name': 'Auto Loan'})
        page_b.evaluate("() => { window.__rvId = window.app.debts[0].id; }")
        _edit(page_b, {'name': 'Truck Loan'}, wait=False)
        modal = page_b.locator('#syncConflictModal')
        modal.wait_for(state='visible')
        assert 'Truck Loan' in page_b.locator('#syncConflictMessage').text_content()
        page_b.click('#syncConflictKeepBtn')
        page_b.evaluate("() => window.__rvPending")
        modal.wait_for(state='hidden')
        assert wait_for_api(page_a, DEBTS, lambda d: d[0]['name'] == 'Truck Loan')[0]['name'] == 'Truck Loan'
        assert _local_debt(page_b)['name'] == 'Truck Loan'
    finally:
        page_b.context.close()


@pytest.mark.feature
def test_same_field_conflict_use_theirs_keeps_server_value(app_page):
    page_a = app_page
    seed_state(page_a, STATE)
    page_b = _open_second_tab(page_a)
    try:
        _edit(page_a, {'name': 'Auto Loan'})
        page_b.evaluate("() => { window.__rvId = window.app.debts[0].id; }")
        _edit(page_b, {'name': 'Truck Loan'}, wait=False)
        page_b.locator('#syncConflictModal').wait_for(state='visible')
        page_b.click('#syncConflictTheirsBtn')
        page_b.evaluate("() => window.__rvPending")
        assert _local_debt(page_b)['name'] == 'Auto Loan'
        assert _server_debt(page_a)['name'] == 'Auto Loan'
    finally:
        page_b.context.close()


# ─── Negative ────────────────────────────────────────────────────────────────

@pytest.mark.feature
def test_escape_on_conflict_never_overwrites(app_page):
    """Dismissing the prompt is the safe choice: the other version stays."""
    page_a = app_page
    seed_state(page_a, STATE)
    page_b = _open_second_tab(page_a)
    try:
        _edit(page_a, {'name': 'Auto Loan'})
        page_b.evaluate("() => { window.__rvId = window.app.debts[0].id; }")
        _edit(page_b, {'name': 'Truck Loan'}, wait=False)
        page_b.locator('#syncConflictModal').wait_for(state='visible')
        page_b.keyboard.press('Escape')
        page_b.evaluate("() => window.__rvPending")
        assert _server_debt(page_a)['name'] == 'Auto Loan'
        assert _local_debt(page_b)['name'] == 'Auto Loan'
    finally:
        page_b.context.close()


@pytest.mark.feature
def test_stale_version_is_never_written_silently(app_page):
    """A raw PATCH carrying an old version is refused by the server (409) and
    the row is unchanged."""
    page = app_page
    seed_state(page, STATE)
    _edit(page, {'name': 'Auto Loan'})
    res = page.evaluate("""async () => {
        const csrf = document.cookie.split('; ').find(r => r.startsWith('csrf='))?.split('=')[1] || '';
        const r = await fetch(`/api/debts/${window.__rvId}`, { method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
            body: JSON.stringify({ name: 'Stale', rowVersion: 1 }) });
        return { status: r.status, body: await r.json() };
    }""")
    assert res['status'] == 409 and res['body']['current']['name'] == 'Auto Loan', res
    assert _server_debt(page)['name'] == 'Auto Loan'


@pytest.mark.feature
def test_server_error_still_shows_sync_banner_not_conflict_prompt(app_page):
    page = app_page
    seed_state(page, STATE)
    page.route('**/api/debts/*', lambda route: route.fulfill(
        status=500, content_type='application/json', body='{"error":"boom"}')
        if route.request.method == 'PATCH' else route.continue_())
    _edit(page, {'name': 'Boom'})
    page.locator('#syncErrorBanner').wait_for(state='visible')
    assert not page.locator('#syncConflictModal').is_visible()
