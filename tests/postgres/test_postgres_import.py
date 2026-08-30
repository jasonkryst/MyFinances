"""
Postgres import integration tests (issue #95) — require docker-compose stack.
Run: pytest tests/postgres/test_postgres_import.py -v
"""
import json
import pytest

pytestmark = pytest.mark.asyncio


def _capture_console(page):
    messages = []
    page.on('console', lambda m: messages.append(f'[{m.type}] {m.text}'))
    return messages


async def _wait_for_app_ready(page):
    await page.wait_for_function(
        "() => window.app && window.app._currentPage === 'health'",
        timeout=15000
    )


async def _login(page, base_url, credentials):
    await page.goto(base_url)
    await page.locator('#loginGate').wait_for(state='visible', timeout=8000)
    await page.fill('#loginGateEmail', credentials['email'])
    await page.fill('#loginGatePassword', credentials['password'])
    async with page.expect_response(lambda r: '/auth/login' in r.url, timeout=10000):
        await page.click('.login-gate-submit')
    await page.locator('#loginGate').wait_for(state='hidden', timeout=12000)
    await _wait_for_app_ready(page)


async def _csrf(page):
    return await page.evaluate(
        "document.cookie.split('; ').find(r => r.startsWith('csrf='))?.split('=')[1] || ''"
    )


async def _api_post(page, base_url, path, body):
    csrf = await _csrf(page)
    return await page.request.post(f'{base_url}{path}', data=body, headers={'X-CSRF-Token': csrf})


async def _api_delete(page, base_url, path):
    csrf = await _csrf(page)
    return await page.request.delete(f'{base_url}{path}', headers={'X-CSRF-Token': csrf})


async def _api_get(page, base_url, path):
    return await page.request.get(f'{base_url}{path}')


async def _capture_export(page):
    """Intercept exportAllJSON's blob and return it as a JSON string."""
    return await page.evaluate("""async () => {
        const mod = await import('/src/dataExport.js');
        let blob = null;
        const origCreate = URL.createObjectURL;
        URL.createObjectURL = b => { blob = b; return 'blob:mock'; };
        try { mod.exportAllJSON(window.app); } finally { URL.createObjectURL = origCreate; }
        return blob ? await blob.text() : null;
    }""")


async def _run_import(page, json_str, replace=True):
    """Call importAllJSON via page.evaluate; returns {ok, parts} or {ok, reason}."""
    return await page.evaluate("""async (jsonStr, shouldReplace) => {
        const app = window.app;
        const mod = await import('/src/dataExport.js');
        const file = new File([jsonStr], 'backup.json', { type: 'application/json' });
        return new Promise(resolve => {
            mod.importAllJSON(app, file, {
                requestImportMode: () => shouldReplace,
                onImported:    parts  => resolve({ ok: true, parts }),
                onInvalidJSON: ()     => resolve({ ok: false, reason: 'invalid_json' }),
                onNoData:      ()     => resolve({ ok: false, reason: 'no_data' }),
                onTooLarge:    ()     => resolve({ ok: false, reason: 'too_large' }),
                onReadError:   ()     => resolve({ ok: false, reason: 'read_error' }),
            });
        });
    }""", json_str, replace)


async def _wipe_all(page, base_url):
    """Delete all resources via API to give each test a clean slate."""
    csrf = await _csrf(page)
    paths = [
        '/api/debts', '/api/accounts', '/api/incomes', '/api/bonuses',
        '/api/bills', '/api/expenses', '/api/recurring-templates',
        '/api/emergency-funds', '/api/sinking-funds', '/api/reconciliations',
        '/api/ledger-overrides', '/api/net-worth-snapshots', '/api/settings',
        '/api/plan-settings/milestones',
    ]
    import asyncio
    await asyncio.gather(*[
        page.request.delete(f'{base_url}{p}', headers={'X-CSRF-Token': csrf})
        for p in paths
    ])
    # Reset plan-settings scalars
    await page.request.patch(
        f'{base_url}/api/plan-settings',
        data={'strategy': None, 'monthlyPayment': None, 'perMonthStimulus': []},
        headers={'X-CSRF-Token': csrf}
    )


# ─── Positive tests ──────────────────────────────────────────────────────────

async def test_postgres_replace_import_survives_reload(pg_page, base_url, credentials):
    """Full replace-mode import: data is still present after a page reload."""
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)
    await _wipe_all(pg_page, base_url)

    # Seed an account + debt via API
    acct = await _api_post(pg_page, base_url, '/api/accounts', {
        'name': 'Import Checking', 'type': 'Checking', 'startingBalance': 1000
    })
    assert acct.status == 201, f'Seed account failed: {await acct.text()}'
    acct_id = (await acct.json())['id']

    debt = await _api_post(pg_page, base_url, '/api/debts', {
        'name': 'Import Visa', 'debtType': 'creditCard',
        'accountBalance': 3000, 'interestRate': 19.99,
        'minimumPayment': 80, 'dueDate': 15, 'accountId': acct_id
    })
    assert debt.status == 201, f'Seed debt failed: {await debt.text()}'

    # Reload so app.* reflects DB state
    await pg_page.reload()
    await _wait_for_app_ready(pg_page)

    exported_json = await _capture_export(pg_page)
    assert exported_json, f'Export produced no blob. Console: {logs}'

    # Wipe server then import the backup
    await _wipe_all(pg_page, base_url)
    await pg_page.reload()
    await _wait_for_app_ready(pg_page)

    result = await _run_import(pg_page, exported_json, replace=True)
    assert result['ok'], f'Import failed: {result}. Console: {logs}'

    # Allow parallel pgPost calls to settle
    await pg_page.wait_for_timeout(2000)

    # Reload → loadFromPostgres re-reads DB
    await pg_page.reload()
    await _wait_for_app_ready(pg_page)

    accounts = await (await _api_get(pg_page, base_url, '/api/accounts')).json()
    debts    = await (await _api_get(pg_page, base_url, '/api/debts')).json()
    assert any(a['name'] == 'Import Checking' for a in accounts), \
        f'Account lost after replace import + reload. Accounts: {accounts}. Console: {logs}'
    assert any(d['name'] == 'Import Visa' for d in debts), \
        f'Debt lost after replace import + reload. Debts: {debts}. Console: {logs}'

    # Cleanup
    await _wipe_all(pg_page, base_url)


async def test_postgres_replace_import_remaps_account_fk(pg_page, base_url, credentials):
    """After replace import, debt's accountId points to the newly-assigned server ID."""
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)
    await _wipe_all(pg_page, base_url)

    acct = await _api_post(pg_page, base_url, '/api/accounts', {
        'name': 'FK Account', 'type': 'Checking', 'startingBalance': 500
    })
    acct_id = (await acct.json())['id']
    debt = await _api_post(pg_page, base_url, '/api/debts', {
        'name': 'FK Debt', 'debtType': 'personal',
        'accountBalance': 200, 'interestRate': 5, 'minimumPayment': 10,
        'dueDate': 1, 'accountId': acct_id
    })
    assert debt.status == 201

    await pg_page.reload()
    await _wait_for_app_ready(pg_page)
    exported_json = await _capture_export(pg_page)

    await _wipe_all(pg_page, base_url)
    await pg_page.reload()
    await _wait_for_app_ready(pg_page)

    result = await _run_import(pg_page, exported_json, replace=True)
    assert result['ok'], f'Import failed: {result}. Console: {logs}'
    await pg_page.wait_for_timeout(2000)

    new_accounts = await (await _api_get(pg_page, base_url, '/api/accounts')).json()
    new_debts    = await (await _api_get(pg_page, base_url, '/api/debts')).json()
    new_acct_id  = next((a['id'] for a in new_accounts if a['name'] == 'FK Account'), None)
    fk_debt      = next((d for d in new_debts if d['name'] == 'FK Debt'), None)
    assert new_acct_id is not None, f'Account not found after import: {new_accounts}'
    assert fk_debt is not None, f'Debt not found after import: {new_debts}'
    assert fk_debt.get('accountId') == new_acct_id, \
        f"Debt accountId {fk_debt.get('accountId')} != new account id {new_acct_id}. Console: {logs}"

    await _wipe_all(pg_page, base_url)


async def test_postgres_merge_import_adds_without_clobbering(pg_page, base_url, credentials):
    """Merge mode: new records are added; existing same-name records are left alone."""
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)
    await _wipe_all(pg_page, base_url)

    # Pre-existing debt
    existing = await _api_post(pg_page, base_url, '/api/debts', {
        'name': 'Pre-existing Debt', 'debtType': 'personal',
        'accountBalance': 100, 'interestRate': 3, 'minimumPayment': 5, 'dueDate': 1
    })
    assert existing.status == 201
    existing_id = (await existing.json())['id']

    # Build a minimal import payload with a new debt and a duplicate-named debt
    import_payload = json.dumps({
        'accounts': [],
        'debts': [
            {'id': 999001, 'name': 'Pre-existing Debt', 'debtType': 'personal',
             'accountBalance': 999, 'interestRate': 99, 'minimumPayment': 99, 'dueDate': 28},
            {'id': 999002, 'name': 'Brand New Debt', 'debtType': 'creditCard',
             'accountBalance': 500, 'interestRate': 18, 'minimumPayment': 20, 'dueDate': 15},
        ],
        'incomes': [], 'bonuses': [], 'bills': [], 'expenses': [],
        'ledgerAmountOverrides': {}, 'recurringTemplates': [],
        'emergencyFunds': [], 'sinkingFunds': [], 'reconciliations': [],
        'settings': [], 'monthlySnapshots': [], 'netWorthMilestonesAwarded': [],
        'perMonthStimulus': [],
        'strategy': {'monthlyPayment': None, 'paymentStrategy': None},
        'ledgerSettings': {'accountFilter': 'all', 'dateRange': 'all', 'sortKey': 'date', 'sortDir': 'desc'},
        'forecastSettings': {'rangeMonths': 1, 'accountId': 'total', 'notableThresholdPct': 130}
    })

    await pg_page.reload()
    await _wait_for_app_ready(pg_page)

    result = await _run_import(pg_page, import_payload, replace=False)
    assert result['ok'], f'Merge import failed: {result}. Console: {logs}'
    await pg_page.wait_for_timeout(2000)

    await pg_page.reload()
    await _wait_for_app_ready(pg_page)

    debts = await (await _api_get(pg_page, base_url, '/api/debts')).json()
    names = [d['name'] for d in debts]
    assert 'Brand New Debt' in names, f'New debt not added in merge. Debts: {names}. Console: {logs}'
    assert names.count('Pre-existing Debt') == 1, f'Duplicate created in merge. Debts: {names}. Console: {logs}'

    # Original debt should be unchanged (balance 100, not 999)
    orig = next(d for d in debts if d['name'] == 'Pre-existing Debt')
    assert orig['id'] == existing_id or orig['accountBalance'] == 100, \
        f'Pre-existing debt was mutated by merge. Debt: {orig}. Console: {logs}'

    await _wipe_all(pg_page, base_url)


async def test_postgres_replace_import_restores_milestones(pg_page, base_url, credentials):
    """Milestones in the export are re-created on the server after replace import."""
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)
    await _wipe_all(pg_page, base_url)

    csrf = await _csrf(pg_page)
    # Seed a milestone
    r = await pg_page.request.post(
        f'{base_url}/api/plan-settings/milestones',
        data={'milestone': 10000},
        headers={'X-CSRF-Token': csrf}
    )
    assert r.status == 201

    await pg_page.reload()
    await _wait_for_app_ready(pg_page)
    exported_json = await _capture_export(pg_page)

    await _wipe_all(pg_page, base_url)
    await pg_page.reload()
    await _wait_for_app_ready(pg_page)

    result = await _run_import(pg_page, exported_json, replace=True)
    assert result['ok'], f'Import failed: {result}. Console: {logs}'
    await pg_page.wait_for_timeout(2000)

    plan = await (await _api_get(pg_page, base_url, '/api/plan-settings')).json()
    assert 10000 in plan.get('netWorthMilestonesAwarded', []), \
        f'Milestone not restored after import. Plan-settings: {plan}. Console: {logs}'

    await _wipe_all(pg_page, base_url)


async def test_postgres_clear_all_wipes_plan_settings(pg_page, base_url, credentials):
    """clearAllData (pgDeleteAll) resets plan-settings and removes milestones (Q4 fix)."""
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)

    csrf = await _csrf(pg_page)
    # Set a strategy and milestone
    await pg_page.request.patch(
        f'{base_url}/api/plan-settings',
        data={'strategy': 'avalanche', 'monthlyPayment': 500},
        headers={'X-CSRF-Token': csrf}
    )
    await pg_page.request.post(
        f'{base_url}/api/plan-settings/milestones',
        data={'milestone': 5000},
        headers={'X-CSRF-Token': csrf}
    )

    # Trigger clearAllData via JS
    await pg_page.evaluate("() => window.app.clearAllData()")
    await pg_page.wait_for_timeout(2000)

    plan = await (await _api_get(pg_page, base_url, '/api/plan-settings')).json()
    assert plan.get('strategy') is None, \
        f'Strategy not cleared after clearAllData. Plan: {plan}. Console: {logs}'
    assert plan.get('monthlyPayment') is None, \
        f'MonthlyPayment not cleared after clearAllData. Plan: {plan}. Console: {logs}'
    assert plan.get('netWorthMilestonesAwarded', []) == [], \
        f'Milestones not cleared after clearAllData. Plan: {plan}. Console: {logs}'


# ─── Negative tests ───────────────────────────────────────────────────────────

async def test_postgres_import_oversized_file_rejected(pg_page, base_url, credentials):
    """Files > 2 MB trigger onTooLarge before any server call is made."""
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)

    result = await pg_page.evaluate("""async () => {
        const mod = await import('/src/dataExport.js');
        const bigContent = 'x'.repeat(2 * 1024 * 1024 + 1);
        const file = new File([bigContent], 'huge.json', { type: 'application/json' });
        return new Promise(resolve => {
            mod.importAllJSON(window.app, file, {
                onTooLarge: () => resolve({ tooLarge: true }),
            });
            setTimeout(() => resolve({ tooLarge: false }), 500);
        });
    }""")
    assert result['tooLarge'], f'Oversized file not rejected. Console: {logs}'


async def test_postgres_import_malformed_json_rejected(pg_page, base_url, credentials):
    """Malformed JSON triggers onInvalidJSON; existing server data is untouched."""
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)
    await _wipe_all(pg_page, base_url)

    acct = await _api_post(pg_page, base_url, '/api/accounts', {
        'name': 'Pre-malformed Account', 'type': 'Checking', 'startingBalance': 200
    })
    assert acct.status == 201
    acct_id = (await acct.json())['id']

    result = await pg_page.evaluate("""async () => {
        const mod = await import('/src/dataExport.js');
        const file = new File(['{ this is not json'], 'bad.json', { type: 'application/json' });
        return new Promise(resolve => {
            mod.importAllJSON(window.app, file, {
                onInvalidJSON: () => resolve({ invalid: true }),
            });
            setTimeout(() => resolve({ invalid: false }), 500);
        });
    }""")
    assert result['invalid'], f'onInvalidJSON not fired. Console: {logs}'

    accounts = await (await _api_get(pg_page, base_url, '/api/accounts')).json()
    assert any(a['id'] == acct_id for a in accounts), \
        f'Existing account wiped by failed import. Console: {logs}'

    await _api_delete(pg_page, base_url, f'/api/accounts/{acct_id}')


async def test_postgres_import_replace_rollback_on_failure(pg_page, base_url, credentials):
    """If a mid-import POST fails (CSRF stripped), server rolls back to pre-import state."""
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)
    await _wipe_all(pg_page, base_url)

    # Seed one account so there is something to preserve
    seed = await _api_post(pg_page, base_url, '/api/accounts', {
        'name': 'Rollback Preserved', 'type': 'Checking', 'startingBalance': 750
    })
    assert seed.status == 201
    seed_id = (await seed.json())['id']

    await pg_page.reload()
    await _wait_for_app_ready(pg_page)
    exported_json = await _capture_export(pg_page)

    # Strip CSRF cookie so every pgPost inside replaceForPostgres returns 403 (after wipe)
    cookies = await pg_page.context.cookies()
    non_csrf = [c for c in cookies if c['name'] != 'csrf']
    await pg_page.context.clear_cookies()
    await pg_page.context.add_cookies(non_csrf)

    # Import — replaceForPostgres will wipe data, then all POSTs will 403, rollback fires
    result = await _run_import(pg_page, exported_json, replace=True)
    # Import is expected to fail gracefully (returns False from the catch block)
    await pg_page.wait_for_timeout(3000)

    # Restore CSRF so we can call the API
    await pg_page.reload()
    await _wait_for_app_ready(pg_page)

    accounts = await (await _api_get(pg_page, base_url, '/api/accounts')).json()
    assert any(a['name'] == 'Rollback Preserved' for a in accounts), \
        f'Rollback did not restore pre-import account. Accounts: {accounts}. Console: {logs}'

    await _wipe_all(pg_page, base_url)


async def test_postgres_import_expired_session_shows_login_gate(pg_page, base_url, credentials):
    """If the session expires before import starts, the login gate is shown."""
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)

    exported_json = await _capture_export(pg_page)
    assert exported_json, 'Export produced no blob'

    # Clear ALL cookies to simulate full session expiry
    await pg_page.context.clear_cookies()

    await pg_page.evaluate("""async (jsonStr) => {
        const mod = await import('/src/dataExport.js');
        const file = new File([jsonStr], 'backup.json', { type: 'application/json' });
        mod.importAllJSON(window.app, file, {
            requestImportMode: () => true,
            onImported: () => {}
        });
    }""", exported_json)

    # apiFetch inside postgresImport throws; pgDeleteAll (the first call) goes
    # through pgFetch which shows the login gate on 401
    await pg_page.locator('#loginGate').wait_for(state='visible', timeout=10000)
    assert await pg_page.locator('#loginGate').is_visible(), \
        f'Login gate not shown after session expiry during import. Console: {logs}'


async def test_postgres_delete_milestones_endpoint(pg_page, base_url, credentials):
    """DELETE /api/plan-settings/milestones removes all milestones for the user."""
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)

    csrf = await _csrf(pg_page)
    await pg_page.request.post(
        f'{base_url}/api/plan-settings/milestones',
        data={'milestone': 5000},
        headers={'X-CSRF-Token': csrf}
    )
    await pg_page.request.post(
        f'{base_url}/api/plan-settings/milestones',
        data={'milestone': 10000},
        headers={'X-CSRF-Token': csrf}
    )

    plan_before = await (await _api_get(pg_page, base_url, '/api/plan-settings')).json()
    assert len(plan_before.get('netWorthMilestonesAwarded', [])) >= 2, \
        f'Milestones not seeded. Plan: {plan_before}'

    r = await pg_page.request.delete(
        f'{base_url}/api/plan-settings/milestones',
        headers={'X-CSRF-Token': csrf}
    )
    assert r.status == 204, f'DELETE milestones returned {r.status}: {await r.text()}'

    plan_after = await (await _api_get(pg_page, base_url, '/api/plan-settings')).json()
    assert plan_after.get('netWorthMilestonesAwarded', []) == [], \
        f'Milestones not cleared. Plan: {plan_after}. Console: {logs}'
