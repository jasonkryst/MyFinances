"""The harness's HTTP wipe (#550) must leave the server exactly as the app's own
pgDeleteAll() does, since app_page now uses it instead of wiping through the app.
"""
import os
import re

import pytest

from tests.conftest import (
    _PLAN_SETTINGS_DEFAULTS, _RESET_EXTRA_CALLS, _RESET_JS, _resource_deletion_layers,
    reset_server_state_http, seed_state, wait_for_app_ready,
)

pytestmark = pytest.mark.feature

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def _pg_delete_all_body():
    src = _read('src/postgresSync.js')
    m = re.search(r'export async function pgDeleteAll\(app\) \{(.*?)\n\}', src, re.S)
    assert m, 'pgDeleteAll not found in src/postgresSync.js'
    return src, m.group(1)


def test_extra_calls_match_pg_delete_all():
    _, body = _pg_delete_all_body()
    js_calls = set(re.findall(r"pgFetch\(app, '(\w+)', '(/api/[\w/-]+)'", body))
    assert js_calls == {(m, p) for m, p, _ in _RESET_EXTRA_CALLS}


def test_plan_settings_defaults_match_pg_delete_all():
    src, _ = _pg_delete_all_body()
    m = re.search(r'const DEFAULT_PLAN_SETTINGS = \{(.*?)\n\};', src, re.S)
    assert m, 'DEFAULT_PLAN_SETTINGS not found'
    js_keys = re.findall(r'^\s{4}(\w+):', m.group(1), re.M)
    assert js_keys == list(_PLAN_SETTINGS_DEFAULTS)


def test_layers_cover_every_collection_children_first():
    layers = _resource_deletion_layers()
    flat = [p for layer in layers for p in layer]
    tables = re.findall(r"'(/api/[\w-]+)':", re.search(
        r'export const RESOURCE_TABLES = \{(.*?)\n\};', _read('src/resourceDeletion.js'), re.S).group(1))
    assert sorted(flat) == sorted(tables) and len(flat) == len(set(flat))
    assert flat.index('/api/balance-history') < flat.index('/api/debts') < flat.index('/api/accounts')


STATE = {
    'accounts': [{'id': 1, 'name': 'Checking', 'type': 'Checking', 'startingBalance': 0}],
    'persons': [{'id': 1, 'name': 'Alex'}],
    'debts': [{'id': 1, 'name': 'Visa', 'accountBalance': 500, 'interestRate': 20, 'minimumPayment': 25,
               'dueDate': 10, 'accountId': 1}],
    'incomes': [{'id': 1, 'name': 'Pay', 'amount': 1000, 'frequency': 'monthly', 'firstPayDate': '2026-01-01',
                 'accountId': 1, 'personId': 1}],
    'recurringTemplates': [{'id': 1, 'name': 'Gym', 'type': 'subscription', 'amount': 30, 'frequency': 'monthly',
                            'dayOfMonth': 3, 'accountId': 1}],
    'ledgerClearedTransactions': {'debt|1|1|2026-11-10': {'clearedAt': '2026-11-10T00:00:00.000Z'}},
    'settings': [{'key': 'showArchivedDebts', 'value': True}],
    'strategy': 'snowball',
    'monthlyPayment': 400,
}

COLLECTIONS = [p for layer in _resource_deletion_layers() for p in layer]


def _server_state(page):
    out = {}
    for path in COLLECTIONS + ['/api/notifications', '/api/plan-settings']:
        out[path] = page.evaluate("async (p) => (await fetch(p)).json()", path)
    out['/api/notifications'] = out['/api/notifications']['notifications']
    plan = out['/api/plan-settings']
    out['/api/plan-settings'] = {k: v for k, v in plan.items() if k not in ('updatedAt', 'rowVersion')}
    return out


def test_http_reset_equals_the_app_reset(app_page):
    page = app_page

    def seed():
        seed_state(page, STATE)
        wait_for_app_ready(page)
        page.evaluate("async () => { const r = await import('/src/notificationsCenter.js'); await r.runNotificationCheck(); }")
        assert page.evaluate("async () => (await fetch('/api/debts')).json()"), 'seeded'

    seed()
    page.evaluate(_RESET_JS)
    via_app = _server_state(page)

    seed()
    reset_server_state_http()
    via_http = _server_state(page)

    assert via_http == via_app
    for path in COLLECTIONS:
        if path == '/api/settings':
            assert via_http[path] == [{'key': 'reconciliationAdjustsBalance', 'value': False}]
        else:
            assert via_http[path] == [], path
    assert via_http['/api/notifications'] == []
