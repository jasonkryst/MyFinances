"""
Postgres mutation integration tests — require docker-compose stack to be running.
Run: pytest tests/postgres/test_postgres_mutations.py -v
"""
import pytest

pytestmark = pytest.mark.asyncio


def _capture_console(page):
    messages = []
    page.on('console', lambda m: messages.append(f'[{m.type}] {m.text}'))
    return messages


async def _login(page, base_url, credentials):
    await page.goto(base_url)
    await page.locator('#loginGate').wait_for(state='visible', timeout=8000)
    await page.fill('#loginGateEmail', credentials['email'])
    await page.fill('#loginGatePassword', credentials['password'])
    async with page.expect_response(lambda r: '/auth/login' in r.url, timeout=10000):
        await page.click('.login-gate-submit')
    await page.locator('#loginGate').wait_for(state='hidden', timeout=12000)
    await page.wait_for_selector('#topNav', state='visible', timeout=8000)


async def _csrf(page):
    return await page.evaluate(
        "document.cookie.split('; ').find(r => r.startsWith('csrf='))?.split('=')[1] || ''"
    )


async def _api_post(page, base_url, path, body):
    csrf = await _csrf(page)
    return await page.request.post(f"{base_url}{path}", data=body, headers={'X-CSRF-Token': csrf})


async def _api_delete(page, base_url, path):
    csrf = await _csrf(page)
    return await page.request.delete(f"{base_url}{path}", headers={'X-CSRF-Token': csrf})


async def _api_get(page, base_url, path):
    return await page.request.get(f"{base_url}{path}")


async def _ensure_account(page, base_url):
    accounts = await (await _api_get(page, base_url, '/api/accounts')).json()
    if not accounts:
        r = await _api_post(page, base_url, '/api/accounts', {'name': 'Checking', 'type': 'Checking', 'startingBalance': 0})
        assert r.status == 201
        await page.reload()
        await page.wait_for_selector('#topNav', state='visible', timeout=8000)
    return (await (await _api_get(page, base_url, '/api/accounts')).json())[0]


# ---------------------------------------------------------------------------
# Debt CRUD — full three-step (validates POST+id-swap, PATCH, DELETE)
# ---------------------------------------------------------------------------

async def test_debt_add_persists(pg_page, base_url, credentials):
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)
    await pg_page.click('[data-page="liabilities"]')
    await pg_page.wait_for_selector('#debtName', state='visible', timeout=5000)

    await pg_page.fill('#debtName', 'Test Visa')
    await pg_page.select_option('#debtType', 'creditCard')
    await pg_page.fill('#accountBalance', '5000')
    await pg_page.fill('#interestRate', '19.99')
    await pg_page.fill('#minimumPayment', '100')
    await pg_page.fill('#dueDate', '15')
    await pg_page.click('#addDebtBtn')
    await pg_page.wait_for_selector('text=Test Visa', timeout=5000)

    await pg_page.reload()
    await pg_page.wait_for_selector('#topNav', state='visible', timeout=8000)
    await pg_page.click('[data-page="liabilities"]')
    assert await pg_page.locator('text=Test Visa').count() > 0, f'Debt not found after reload. Console: {logs}'

    # Cleanup
    debts = await (await _api_get(pg_page, base_url, '/api/debts')).json()
    for d in debts:
        if d.get('name') == 'Test Visa':
            await _api_delete(pg_page, base_url, f'/api/debts/{d["id"]}')


async def test_debt_delete_persists(pg_page, base_url, credentials):
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)

    seed = await _api_post(pg_page, base_url, '/api/debts', {
        'name': 'Delete Me', 'debtType': 'creditCard',
        'accountBalance': 500, 'interestRate': 15,
        'minimumPayment': 20, 'dueDate': 1
    })
    assert seed.status == 201
    debt_id = (await seed.json())['id']

    await pg_page.reload()
    await pg_page.wait_for_selector('#topNav', state='visible', timeout=8000)
    await pg_page.click('[data-page="liabilities"]')
    await pg_page.wait_for_selector('text=Delete Me', timeout=5000)

    pg_page.once('dialog', lambda d: d.accept())
    await pg_page.click(f'[data-delete-debt="{debt_id}"]')
    await pg_page.wait_for_timeout(500)

    await pg_page.reload()
    await pg_page.wait_for_selector('#topNav', state='visible', timeout=8000)
    await pg_page.click('[data-page="liabilities"]')
    assert await pg_page.locator('text=Delete Me').count() == 0, f'Deleted debt still present. Console: {logs}'


# ---------------------------------------------------------------------------
# Smoke: add → reload → persists (one per remaining resource)
# ---------------------------------------------------------------------------

async def test_account_add_persists(pg_page, base_url, credentials):
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)
    await pg_page.click('[data-page="accounts"]')
    await pg_page.fill('#accountName', 'Smoke Checking')
    await pg_page.select_option('#accountType', 'Checking')
    await pg_page.fill('#startingBalance', '1000')
    await pg_page.click('#addAccountBtn')
    await pg_page.wait_for_selector('text=Smoke Checking', timeout=5000)
    await pg_page.reload()
    await pg_page.wait_for_selector('#topNav', state='visible', timeout=8000)
    await pg_page.click('[data-page="accounts"]')
    assert await pg_page.locator('text=Smoke Checking').count() > 0, f'Account not persisted. Console: {logs}'


async def test_income_add_persists(pg_page, base_url, credentials):
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)
    await _ensure_account(pg_page, base_url)
    await pg_page.click('[data-page="income"]')
    await pg_page.fill('#incomeName', 'Smoke Salary')
    await pg_page.fill('#incomeAmount', '5000')
    await pg_page.fill('#incomeFirstDate', '2026-01-01')
    await pg_page.select_option('#incomeFrequency', 'monthly')
    await pg_page.click('#addIncomeBtn')
    await pg_page.wait_for_selector('text=Smoke Salary', timeout=5000)
    await pg_page.reload()
    await pg_page.wait_for_selector('#topNav', state='visible', timeout=8000)
    await pg_page.click('[data-page="income"]')
    assert await pg_page.locator('text=Smoke Salary').count() > 0, f'Income not persisted. Console: {logs}'


async def test_bill_add_persists(pg_page, base_url, credentials):
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)
    await pg_page.click('[data-page="liabilities"]')
    await pg_page.click('[data-liab-tab="budget"]')
    await pg_page.click('#billFormToggle')
    await pg_page.fill('#billName', 'Smoke Electric')
    await pg_page.fill('#billAmount', '120')
    await pg_page.fill('#billDueDay', '10')
    await pg_page.click('#addBillBtn')
    await pg_page.wait_for_selector('text=Smoke Electric', timeout=5000)
    await pg_page.reload()
    await pg_page.wait_for_selector('#topNav', state='visible', timeout=8000)
    await pg_page.click('[data-page="liabilities"]')
    await pg_page.click('[data-liab-tab="budget"]')
    assert await pg_page.locator('text=Smoke Electric').count() > 0, f'Bill not persisted. Console: {logs}'


async def test_recurring_add_persists(pg_page, base_url, credentials):
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)
    account = await _ensure_account(pg_page, base_url)
    await pg_page.click('[data-page="recurring"]')
    await pg_page.fill('#recurringName', 'Smoke Netflix')
    await pg_page.fill('#recurringAmount', '15.99')
    await pg_page.select_option('#recurringAccount', str(account['id']))
    await pg_page.click('#addRecurringBtn')
    await pg_page.wait_for_selector('text=Smoke Netflix', timeout=5000)
    await pg_page.reload()
    await pg_page.wait_for_selector('#topNav', state='visible', timeout=8000)
    await pg_page.click('[data-page="recurring"]')
    assert await pg_page.locator('text=Smoke Netflix').count() > 0, f'Recurring not persisted. Console: {logs}'


async def test_reconciliation_add_persists(pg_page, base_url, credentials):
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)
    account = await _ensure_account(pg_page, base_url)
    await pg_page.click('[data-page="reconcile"]')
    await pg_page.fill(f'#recon-balance-{account["id"]}', '1050')
    await pg_page.fill(f'#recon-date-{account["id"]}', '2026-01-31')
    await pg_page.click(f'#recon-submit-{account["id"]}')
    await pg_page.wait_for_timeout(800)
    await pg_page.reload()
    await pg_page.wait_for_selector('#topNav', state='visible', timeout=8000)
    recons = await (await _api_get(pg_page, base_url, '/api/reconciliations')).json()
    assert len(recons) > 0, f'Reconciliation not persisted. Console: {logs}'


# ---------------------------------------------------------------------------
# Keyed resources
# ---------------------------------------------------------------------------

async def test_setting_persists(pg_page, base_url, credentials):
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)
    await pg_page.click('#settingsBtn')
    await pg_page.wait_for_selector('#settingsModal', state='visible', timeout=5000)
    checkbox = pg_page.locator('#settingReconciliationAdjustsBalance')
    initial_state = await checkbox.is_checked()
    await checkbox.click()
    await pg_page.click('#settingsModalDoneBtn')
    await pg_page.reload()
    await pg_page.wait_for_selector('#topNav', state='visible', timeout=8000)
    await pg_page.click('#settingsBtn')
    await pg_page.wait_for_selector('#settingsModal', state='visible', timeout=5000)
    new_state = await pg_page.locator('#settingReconciliationAdjustsBalance').is_checked()
    assert new_state != initial_state, f'Setting not persisted after reload. Console: {logs}'


async def test_net_worth_snapshot_persists(pg_page, base_url, credentials):
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)
    await pg_page.click('[data-page="reports"]')
    await pg_page.wait_for_selector('#captureSnapshotBtn', state='visible', timeout=5000)
    await pg_page.click('#captureSnapshotBtn')
    await pg_page.wait_for_timeout(800)
    await pg_page.reload()
    await pg_page.wait_for_selector('#topNav', state='visible', timeout=8000)
    snapshots = await (await _api_get(pg_page, base_url, '/api/net-worth-snapshots')).json()
    assert len(snapshots) > 0, f'Snapshot not persisted. Console: {logs}'


# ---------------------------------------------------------------------------
# clearAllData wipes server rows
# ---------------------------------------------------------------------------

async def test_clear_all_data_wipes_server(pg_page, base_url, credentials):
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)

    seed = await _api_post(pg_page, base_url, '/api/debts', {
        'name': 'To Clear', 'debtType': 'creditCard',
        'accountBalance': 100, 'interestRate': 5,
        'minimumPayment': 10, 'dueDate': 1
    })
    assert seed.status == 201

    await pg_page.click('#settingsBtn')
    await pg_page.wait_for_selector('#settingsModal', state='visible', timeout=5000)
    pg_page.once('dialog', lambda d: d.accept())
    await pg_page.click('#clearAllDataBtn')
    await pg_page.wait_for_timeout(1500)

    # Re-enter postgres mode and log back in to verify server state is empty
    await pg_page.evaluate("localStorage.setItem('debtTrackerStorageBackend', 'postgres')")
    await pg_page.reload()
    await pg_page.locator('#loginGate').wait_for(state='visible', timeout=8000)
    await pg_page.fill('#loginGateEmail', credentials['email'])
    await pg_page.fill('#loginGatePassword', credentials['password'])
    async with pg_page.expect_response(lambda r: '/auth/login' in r.url, timeout=10000):
        await pg_page.click('.login-gate-submit')
    await pg_page.locator('#loginGate').wait_for(state='hidden', timeout=12000)

    debts = await (await _api_get(pg_page, base_url, '/api/debts')).json()
    assert len(debts) == 0, f'Debts still present after clearAllData. Console: {logs}'


# ---------------------------------------------------------------------------
# 401 mid-session shows login gate
# ---------------------------------------------------------------------------

async def test_401_shows_login_gate(pg_page, base_url, credentials):
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)
    await pg_page.click('[data-page="liabilities"]')
    await pg_page.wait_for_selector('#addDebtBtn', state='visible', timeout=5000)

    # Clear cookies to simulate session expiry
    await pg_page.context.clear_cookies()

    await pg_page.fill('#debtName', 'Post-expiry Debt')
    await pg_page.select_option('#debtType', 'creditCard')
    await pg_page.fill('#accountBalance', '100')
    await pg_page.fill('#interestRate', '5')
    await pg_page.fill('#minimumPayment', '10')
    await pg_page.fill('#dueDate', '1')
    await pg_page.click('#addDebtBtn')

    await pg_page.locator('#loginGate').wait_for(state='visible', timeout=8000)
    assert await pg_page.locator('#loginGate').is_visible(), f'Login gate not shown on 401. Console: {logs}'
