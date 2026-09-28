"""Server-side content tests for the public webcal feed (issue #217).

Verifies server/src/calendarGenerator.js honors the showArchivedDebts setting
and emits income paydays — the same behavior as the client-side ICS download
(tests/features/test_calendar_feed.py), since the two generators are separate
copies of the same logic.

Requires: docker compose up (postgres stack at localhost:32900).
"""
import asyncio
from datetime import date

import pytest

from tests.postgres.test_calendar_security import _login, _csrf, _get_calendar_token

pytestmark = pytest.mark.asyncio


async def _wipe(page, base_url):
    csrf = await _csrf(page)
    await asyncio.gather(*[
        page.request.delete(f'{base_url}{p}', headers={'X-CSRF-Token': csrf})
        for p in ('/api/debts', '/api/incomes', '/api/accounts', '/api/bills',
                  '/api/expenses', '/api/recurring-templates', '/api/settings')
    ])


async def _post(page, base_url, path, body):
    csrf = await _csrf(page)
    r = await page.request.post(f'{base_url}{path}', data=body, headers={'X-CSRF-Token': csrf})
    assert r.status == 201, f'POST {path} failed: {r.status} {await r.text()}'
    return await r.json()


async def _set_show_archived(page, base_url, value):
    csrf = await _csrf(page)
    r = await page.request.put(f'{base_url}/api/settings/showArchivedDebts',
                               data={'value': value}, headers={'X-CSRF-Token': csrf})
    assert r.status in (200, 201, 204), f'PUT setting failed: {r.status} {await r.text()}'


async def _fetch_feed(page, base_url):
    token = await _get_calendar_token(page, base_url)
    r = await page.request.get(f'{base_url}/calendar.ics', params={'token': token})
    assert r.status == 200
    return await r.text()


async def _seed_debts(page, base_url):
    await _post(page, base_url, '/api/debts', {
        'name': 'PgArchivedVisa', 'debtType': 'creditCard', 'accountBalance': 1000,
        'interestRate': 0, 'minimumPayment': 50, 'dueDate': 10, 'archived': True,
    })
    await _post(page, base_url, '/api/debts', {
        'name': 'PgActiveLoan', 'debtType': 'personal', 'accountBalance': 2000,
        'interestRate': 5, 'minimumPayment': 100, 'dueDate': 12, 'archived': False,
    })


# ─── Archived debts ───────────────────────────────────────────────────────────

async def test_feed_omits_archived_debt_when_setting_unset(pg_page, base_url, credentials):
    """No showArchivedDebts row: archived debts are omitted from the webcal feed."""
    await _login(pg_page, base_url, credentials)
    await _wipe(pg_page, base_url)
    await _seed_debts(pg_page, base_url)
    body = await _fetch_feed(pg_page, base_url)
    assert 'PgArchivedVisa' not in body
    assert 'SUMMARY:Debt - PgActiveLoan' in body


async def test_feed_omits_archived_debt_when_setting_false(pg_page, base_url, credentials):
    await _login(pg_page, base_url, credentials)
    await _wipe(pg_page, base_url)
    await _seed_debts(pg_page, base_url)
    await _set_show_archived(pg_page, base_url, False)
    body = await _fetch_feed(pg_page, base_url)
    assert 'PgArchivedVisa' not in body
    assert 'SUMMARY:Debt - PgActiveLoan' in body


async def test_feed_includes_labeled_archived_debt_when_setting_true(pg_page, base_url, credentials):
    await _login(pg_page, base_url, credentials)
    await _wipe(pg_page, base_url)
    await _seed_debts(pg_page, base_url)
    await _set_show_archived(pg_page, base_url, True)
    body = await _fetch_feed(pg_page, base_url)
    assert 'SUMMARY:Debt (Archived) - PgArchivedVisa' in body
    assert 'SUMMARY:Debt - PgActiveLoan' in body
    assert 'SUMMARY:Debt (Archived) - PgActiveLoan' not in body


# ─── Paydays ──────────────────────────────────────────────────────────────────

async def test_feed_includes_monthly_payday(pg_page, base_url, credentials):
    await _login(pg_page, base_url, credentials)
    await _wipe(pg_page, base_url)
    acct = await _post(pg_page, base_url, '/api/accounts', {
        'name': 'PgPayroll', 'type': 'Checking', 'startingBalance': 0,
    })
    today = date.today()
    inc = await _post(pg_page, base_url, '/api/incomes', {
        'name': 'PgSalary', 'amount': 2500, 'frequency': 'monthly',
        'firstPayDate': f'{today.year - 1}-{today.month:02d}-05', 'accountId': acct['id'],
    })
    body = await _fetch_feed(pg_page, base_url)
    this_month = f'{today.year}{today.month:02d}05'
    assert f"UID:income-{inc['id']}-{this_month}@myfinances" in body
    assert 'SUMMARY:Payday - PgSalary' in body
    unfolded = body.replace('\r\n ', '')
    assert 'Amount: $2500.00' in unfolded
    assert 'Account: PgPayroll' in unfolded


async def test_feed_has_no_paydays_before_first_pay_date(pg_page, base_url, credentials):
    await _login(pg_page, base_url, credentials)
    await _wipe(pg_page, base_url)
    today = date.today()
    m0 = today.month - 1 + 3
    first = date(today.year + m0 // 12, m0 % 12 + 1, 10)
    inc = await _post(pg_page, base_url, '/api/incomes', {
        'name': 'PgFutureJob', 'amount': 3000, 'frequency': 'biweekly',
        'firstPayDate': first.isoformat(),
    })
    body = await _fetch_feed(pg_page, base_url)
    prefix = f"UID:income-{inc['id']}-"
    uids = [ln for ln in body.splitlines() if ln.startswith(prefix)]
    assert f"{prefix}{first.strftime('%Y%m%d')}@myfinances" in uids
    assert all(ln[len(prefix):len(prefix) + 8] >= first.strftime('%Y%m%d') for ln in uids)
