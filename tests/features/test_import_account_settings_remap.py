#!/usr/bin/env python3
"""
Import remaps account-id settings (issue #651).

`surplusAccountId` and `notifyFilterAccount` hold an account id. Accounts get
new ids on import, so both must follow their account through the same old->new
map as every other account reference. A `notifyFilterAccount` that doesn't
resolve is dropped, like an unresolved `surplusAccountId` (a merge keeps the
existing server value; a replace leaves the default). Dropped values are
reported as import warnings.
"""

import json

import pytest

from tests.conftest import seed_state, wait_for_api


def _import(page, payload, replace):
    """Run a JSON import; returns {status, warnings}."""
    return page.evaluate(
        """([json, replace]) => new Promise((resolve) => {
            const app = window.app;
            let warnings = [];
            const orig = app.refreshCurrentPageData;
            app.refreshCurrentPageData = function (...args) {
                app.refreshCurrentPageData = orig;
                const r = orig.apply(app, args);
                setTimeout(() => resolve({ status: 'imported', warnings }), 0);
                return r;
            };
            const file = new File([new Blob([json], { type: 'application/json' })], 'b.json', { type: 'application/json' });
            import('/src/dataExport.js').then(({ importAllJSON }) => {
                importAllJSON(app, file, {
                    requestImportMode: async () => replace,
                    onImported: (parts, w) => { warnings = w || []; },
                    onMergeDuplicates: (skipped, w) => { warnings = w || []; },
                    onNoData: () => resolve({ status: 'no-data', warnings }),
                    onInvalidJSON: () => resolve({ status: 'invalid', warnings }),
                    onImportError: () => resolve({ status: 'error', warnings })
                });
            });
        })""",
        [json.dumps(payload), replace])


def _account(acc_id, name):
    return {"id": acc_id, "name": name, "type": "Checking", "startingBalance": 100}


def _settings(page):
    """Server-side settings as {key: value}, read back through GET /api/settings."""
    rows = page.evaluate("async () => { const r = await fetch('/api/settings'); return r.ok ? await r.json() : null; }")
    assert rows is not None
    return {s['key']: s['value'] for s in rows}


def _server_account_id(page, name):
    return page.evaluate("(n) => window.app.accounts.find(a => a.name === n)?.id ?? null", name)


def _app_setting(page, key):
    return page.evaluate("(k) => (window.app.settings || []).find(s => s.key === k)?.value ?? null", key)


def _file_with_settings(**settings):
    return {
        "accounts": [_account(5, "Checking"), _account(6, "Savings")],
        "settings": [{"key": k, "value": v} for k, v in settings.items()],
    }


def _setting_warnings(r):
    return [w for w in r['warnings'] if w.get('recordType') == 'Setting']


@pytest.mark.feature
def test_replace_import_remaps_both_settings_by_account(app_page):
    page = app_page
    r = _import(page, _file_with_settings(surplusAccountId=6, notifyFilterAccount=5), True)
    assert r['status'] == 'imported'
    savings = _server_account_id(page, "Savings")
    checking = _server_account_id(page, "Checking")
    assert savings is not None and checking is not None
    assert _app_setting(page, 'surplusAccountId') == savings
    assert _app_setting(page, 'notifyFilterAccount') == checking
    wait_for_api(page, '/api/settings', lambda rows: any(s['key'] == 'surplusAccountId' for s in rows))
    server = _settings(page)
    assert server['surplusAccountId'] == savings
    assert server['notifyFilterAccount'] == checking
    # A plain remap is not a warning.
    assert not _setting_warnings(r)


@pytest.mark.feature
def test_replace_import_unresolved_settings_dropped_and_warn(app_page):
    page = app_page
    r = _import(page, _file_with_settings(surplusAccountId=99, notifyFilterAccount=99), True)
    assert r['status'] == 'imported'
    assert _app_setting(page, 'notifyFilterAccount') is None
    assert _app_setting(page, 'surplusAccountId') is None
    server = _settings(page)
    assert 'notifyFilterAccount' not in server
    assert 'surplusAccountId' not in server
    by_key = {w['recordName']: w for w in _setting_warnings(r)}
    assert by_key['notifyFilterAccount']['kind'] == 'rejected'
    assert by_key['surplusAccountId']['kind'] == 'rejected'


@pytest.mark.feature
def test_replace_import_notify_filter_zero_stays_without_warning(app_page):
    page = app_page
    r = _import(page, _file_with_settings(notifyFilterAccount=0), True)
    assert r['status'] == 'imported'
    assert _app_setting(page, 'notifyFilterAccount') == 0
    assert not _setting_warnings(r)


@pytest.mark.feature
def test_merge_import_maps_resolved_settings_to_the_right_accounts(app_page):
    page = app_page
    seed_state(page, {"accounts": [_account(777, "Checking"), _account(778, "Other")]})
    existing_checking = _server_account_id(page, "Checking")
    r = _import(page, _file_with_settings(surplusAccountId=5, notifyFilterAccount=6), False)
    assert r['status'] == 'imported'
    created_savings = _server_account_id(page, "Savings")
    assert created_savings is not None
    assert _app_setting(page, 'surplusAccountId') == existing_checking  # name-matched
    assert _app_setting(page, 'notifyFilterAccount') == created_savings  # newly created
    wait_for_api(page, '/api/settings',
                 lambda rows: any(s['key'] == 'notifyFilterAccount' and s['value'] == created_savings for s in rows))
    assert _settings(page)['surplusAccountId'] == existing_checking


@pytest.mark.feature
def test_merge_import_unresolved_settings_keep_existing_server_values(app_page):
    page = app_page
    seed_state(page, {
        "accounts": [_account(777, "Checking"), _account(778, "Other")],
        "settings": [{"key": "surplusAccountId", "value": 778}, {"key": "notifyFilterAccount", "value": 777}],
    })
    other = _server_account_id(page, "Other")
    checking = _server_account_id(page, "Checking")
    wait_for_api(page, '/api/settings',
                 lambda rows: any(s['key'] == 'notifyFilterAccount' and s['value'] == checking for s in rows))
    r = _import(page, _file_with_settings(surplusAccountId=99, notifyFilterAccount=99), False)
    assert r['status'] == 'imported'
    assert _app_setting(page, 'surplusAccountId') == other
    assert _settings(page)['surplusAccountId'] == other
    assert _app_setting(page, 'notifyFilterAccount') == checking
    assert _settings(page)['notifyFilterAccount'] == checking
    kinds = {w['recordName']: w['kind'] for w in _setting_warnings(r)}
    assert kinds == {'surplusAccountId': 'rejected', 'notifyFilterAccount': 'rejected'}


@pytest.mark.feature
def test_merge_import_without_the_settings_leaves_existing_ones(app_page):
    page = app_page
    seed_state(page, {
        "accounts": [_account(777, "Checking"), _account(778, "Other")],
        "settings": [{"key": "surplusAccountId", "value": 778}, {"key": "notifyFilterAccount", "value": 777}],
    })
    other = _server_account_id(page, "Other")
    checking = _server_account_id(page, "Checking")
    wait_for_api(page, '/api/settings',
                 lambda rows: any(s['key'] == 'notifyFilterAccount' and s['value'] == checking for s in rows))
    r = _import(page, {"accounts": [_account(5, "Brand New")]}, False)
    assert r['status'] == 'imported'
    assert _app_setting(page, 'surplusAccountId') == other
    assert _app_setting(page, 'notifyFilterAccount') == checking
    server = _settings(page)
    assert server['surplusAccountId'] == other
    assert server['notifyFilterAccount'] == checking
    assert not _setting_warnings(r)
