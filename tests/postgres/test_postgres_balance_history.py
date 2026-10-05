"""
Balance history Postgres integration tests -- require docker-compose stack.
Run: pytest tests/postgres/test_postgres_balance_history.py -v
"""
import json
import pytest

from tests.postgres.test_postgres_mutations import _login, _api_get, _api_post, _wait_for_app_ready

pytestmark = pytest.mark.asyncio


async def _reset(page, base_url):
    await page.evaluate("() => import('/src/postgresSync.js').then(m => m.pgDeleteAll(window.app))")
    await page.reload()
    await _wait_for_app_ready(page)


async def _import(page, payload, replace):
    return await page.evaluate(
        """([json, replace]) => new Promise((resolve) => {
            // Resolve on refreshCurrentPageData(), the last step of a successful
            // import (onImported is skipped when merge reports name duplicates).
            const app = window.app;
            const origRefresh = app.refreshCurrentPageData;
            app.refreshCurrentPageData = function (...args) {
                app.refreshCurrentPageData = origRefresh;
                const result = origRefresh.apply(app, args);
                resolve('imported');
                return result;
            };
            const file = new File([new Blob([json], { type: 'application/json' })], 'b.json', { type: 'application/json' });
            import('/src/dataExport.js').then(({ importAllJSON }) => importAllJSON(app, file, {
                requestImportMode: async () => replace,
                onImportError: () => resolve('error'),
                onNoData: () => resolve('no-data')
            }));
        })""",
        [json.dumps(payload), replace])


BACKUP = {
    "accounts": [{"id": 700, "name": "Car Loan", "type": "Loan", "startingBalance": -9000, "minimumPayment": 210}],
    "debts": [{"id": 100, "name": "Visa", "debtType": "creditCard", "accountBalance": 800, "minimumPayment": 30,
               "interestRate": 20, "dueDate": 5}],
    "balanceHistory": [
        {"id": 1, "debtId": 100, "date": "2026-01-01", "balance": 1000, "minimumPayment": 40},
        {"id": 2, "debtId": 100, "date": "2026-05-01", "balance": 800, "minimumPayment": 30},
        {"id": 3, "accountId": 700, "date": "2026-02-01", "balance": -9500, "minimumPayment": 210}
    ]
}


async def test_update_balance_persists_history(pg_page, base_url, credentials):
    await _login(pg_page, base_url, credentials)
    await _reset(pg_page, base_url)
    r = await _api_post(pg_page, base_url, '/api/debts', {
        'name': 'PG Visa', 'debtType': 'creditCard', 'accountBalance': 500, 'minimumPayment': 25, 'interestRate': 20, 'dueDate': 1})
    debt_id = (await r.json())['id']
    await pg_page.reload()
    await _wait_for_app_ready(pg_page)  # load-time seeding POSTs the first entry

    # Backdate the in-memory entry so updateDebtBalance treats today as a new
    # date and inserts a second entry rather than overwriting the seeded one.
    await pg_page.evaluate("() => { window.app.balanceHistory.forEach(h => { h.date = '2026-01-01'; }); }")
    rows = await (await _api_get(pg_page, base_url, '/api/balance-history')).json()
    seeded = [h for h in rows if h['debtId'] == debt_id]
    assert len(seeded) == 1

    await pg_page.evaluate(f"() => window.app.updateDebtBalance({debt_id}, 400, 20)")
    rows = await (await _api_get(pg_page, base_url, '/api/balance-history')).json()
    assert sorted(h['balance'] for h in rows if h['debtId'] == debt_id) == [400, 500]


async def test_replace_import_remaps_to_server_ids(pg_page, base_url, credentials):
    await _login(pg_page, base_url, credentials)
    await _reset(pg_page, base_url)
    assert await _import(pg_page, BACKUP, True) == 'imported'
    debts = await (await _api_get(pg_page, base_url, '/api/debts')).json()
    accounts = await (await _api_get(pg_page, base_url, '/api/accounts')).json()
    rows = await (await _api_get(pg_page, base_url, '/api/balance-history')).json()
    assert accounts[0]['minimumPayment'] == 210
    assert sorted(h['balance'] for h in rows if h['debtId'] == debts[0]['id']) == [800, 1000]
    assert [h['balance'] for h in rows if h['accountId'] == accounts[0]['id']] == [-9500]
    assert len(rows) == 3


async def test_merge_import_maps_to_existing_debt(pg_page, base_url, credentials):
    await _login(pg_page, base_url, credentials)
    await _reset(pg_page, base_url)
    r = await _api_post(pg_page, base_url, '/api/debts', {
        'name': 'Visa', 'debtType': 'creditCard', 'accountBalance': 700, 'minimumPayment': 28, 'interestRate': 20, 'dueDate': 5})
    debt_id = (await r.json())['id']
    await _api_post(pg_page, base_url, '/api/balance-history', {'debtId': debt_id, 'date': '2026-05-01', 'balance': 777, 'minimumPayment': 28})
    await pg_page.reload()
    await _wait_for_app_ready(pg_page)

    assert await _import(pg_page, BACKUP, False) == 'imported'
    rows = await (await _api_get(pg_page, base_url, '/api/balance-history')).json()
    visa = sorted([(h['date'], h['balance']) for h in rows if h['debtId'] == debt_id])
    assert visa == [('2026-01-01', 1000), ('2026-05-01', 777)]


async def test_seeding_persists_to_db_and_shows_no_toast(pg_page, base_url, credentials):
    """Regression for #232: seeding on first load must POST entries to the DB and
    must not trigger a sync error toast. Covers the case where debt.updatedAt is
    a full ISO timestamp from the Postgres API (not a bare YYYY-MM-DD)."""
    await _login(pg_page, base_url, credentials)
    await _reset(pg_page, base_url)
    r = await _api_post(pg_page, base_url, '/api/debts', {
        'name': 'Seed Regression Debt', 'debtType': 'creditCard', 'accountBalance': 750,
        'minimumPayment': 30, 'interestRate': 20, 'dueDate': 10})
    debt_id = (await r.json())['id']

    await pg_page.reload()
    await _wait_for_app_ready(pg_page)

    # Seeding must have persisted the entry to the DB
    rows = await (await _api_get(pg_page, base_url, '/api/balance-history')).json()
    seeded = [h for h in rows if h['debtId'] == debt_id]
    assert len(seeded) == 1, f"expected 1 seeded entry in DB, got {len(seeded)}"
    # date must be YYYY-MM-DD, not a full timestamp
    assert len(seeded[0]['date']) == 10 and 'T' not in seeded[0]['date']

    # No sync error toast should appear (issue #232)
    toast = await pg_page.query_selector('#pgErrorToast')
    assert toast is None, "sync error toast appeared during load-time seeding (issue #232)"
