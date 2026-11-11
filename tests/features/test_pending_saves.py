#!/usr/bin/env python3
"""
Adds while the save is pending or after it fails (#459, #460, #593).

Every add now POSTs first and only puts the record into app.* once the server
returns its id (pgCreate in postgresSync.js), and the form or modal is locked
while the POST is in flight (withBusy in utils.js).

- #459: a pending add disables Submit, marks the form aria-busy, makes text
  fields read-only, and ignores a second submit.
- #460: a failed POST (500 or network error) leaves no record behind, keeps
  the form filled for a retry, and shows the sync-error banner.
- #593: a just-created account is never offered in a dropdown under a
  temporary id; it appears only with its server id.

POSTs are held, failed or aborted with page.route, so the service worker is
blocked (it would otherwise send /api requests past the route).
"""
import pytest

from tests.conftest import BASE_URL, ensure_session, reset_server_state, seed_state, wait_for_app_ready

BANNER = '#syncErrorBanner'


@pytest.fixture
def app_page(browser, stack_user):
    context = browser.new_context(service_workers='block')
    page = context.new_page()
    ensure_session(context)
    page.goto(BASE_URL, wait_until='networkidle', timeout=60000)
    wait_for_app_ready(page)
    reset_server_state(page)
    yield page
    context.close()


def _hold_posts(page, pattern):
    """Hold every POST to `pattern` until the test releases it; returns the held routes."""
    held = []
    page.route(pattern, lambda r: held.append(r) if r.request.method == 'POST' else r.continue_())
    return held


def _fail_posts(page, pattern, abort=False):
    def handler(route):
        if route.request.method != 'POST':
            route.continue_()
        elif abort:
            route.abort()
        else:
            route.fulfill(status=500, content_type='application/json', body='{"error":"INTERNAL"}')
    page.route(pattern, handler)


def _fill_account(page, name, balance='100'):
    page.click('button[data-page="accounts"]')
    page.fill('#accountName', name)
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', balance)


def _server_account_ids(page):
    return page.evaluate("""async () => {
        const res = await fetch('/api/accounts', { credentials: 'same-origin' });
        return (await res.json()).map(a => a.id);
    }""")


# ── #459: the form is locked while the add is pending ──────────────────────────

@pytest.mark.feature
def test_pending_add_locks_the_form_then_unlocks(app_page):
    page = app_page
    held = _hold_posts(page, '**/api/accounts')
    _fill_account(page, 'Pending Checking')
    page.click('#accountFormSubmit')  # submit-no-wait: the POST is held to inspect the pending state
    page.wait_for_function("() => document.getElementById('accountForm').getAttribute('aria-busy') === 'true'")

    state = page.evaluate("""() => ({
        submitDisabled: document.getElementById('accountFormSubmit').disabled,
        nameReadOnly: document.getElementById('accountName').readOnly,
        typeDisabled: document.getElementById('accountType').disabled,
        listed: window.app.accounts.some(a => a.name === 'Pending Checking'),
    })""")
    assert state == {'submitDisabled': True, 'nameReadOnly': True, 'typeDisabled': True, 'listed': False}

    page.wait_for_function("n => n > 0", arg=len(held))
    held[0].continue_()
    page.wait_for_function("() => window.app.accounts.some(a => a.name === 'Pending Checking')")
    page.wait_for_function("() => !document.getElementById('accountForm').hasAttribute('aria-busy')")
    after = page.evaluate("""() => ({
        submitDisabled: document.getElementById('accountFormSubmit').disabled,
        nameReadOnly: document.getElementById('accountName').readOnly,
        typeDisabled: document.getElementById('accountType').disabled,
        name: document.getElementById('accountName').value,
    })""")
    assert after == {'submitDisabled': False, 'nameReadOnly': False, 'typeDisabled': False, 'name': ''}


@pytest.mark.feature
def test_double_submit_creates_one_record(app_page):
    page = app_page
    held = _hold_posts(page, '**/api/accounts')
    _fill_account(page, 'Once Only')
    # Two submits back to back, before the first POST answers.
    page.evaluate("""() => {
        const form = document.getElementById('accountForm');
        form.requestSubmit();
        form.requestSubmit();
    }""")
    page.wait_for_function("() => document.getElementById('accountForm').getAttribute('aria-busy') === 'true'")
    page.wait_for_timeout(300)
    assert len(held) == 1
    held[0].continue_()
    page.wait_for_function("() => !document.getElementById('accountForm').hasAttribute('aria-busy')")
    assert page.evaluate("() => window.app.accounts.filter(a => a.name === 'Once Only').length") == 1
    assert len(_server_account_ids(page)) == 1


@pytest.mark.feature
def test_validation_failure_unlocks_the_form(app_page):
    """A rejected submit (no name) shows the alert and leaves the form usable."""
    page = app_page
    page.click('button[data-page="accounts"]')
    page.fill('#accountStartingBalance', '10')
    page.click('#accountFormSubmit')  # submit-no-wait: validation rejects it, nothing is saved
    page.locator('#alertModalOkBtn').click()
    page.wait_for_function("() => !document.getElementById('accountForm').hasAttribute('aria-busy')")
    assert page.evaluate("() => document.getElementById('accountFormSubmit').disabled") is False
    assert page.evaluate("() => window.app.accounts.length") == 0


# ── #460: a failed add leaves nothing behind ───────────────────────────────────

@pytest.mark.feature
@pytest.mark.parametrize('abort', [False, True], ids=['http-500', 'network-error'])
def test_failed_account_add_is_not_kept(app_page, abort):
    page = app_page
    _fail_posts(page, '**/api/accounts', abort=abort)
    _fill_account(page, 'Phantom Account', '250')
    page.click('#accountFormSubmit')  # submit-no-wait: the POST is failed on purpose
    page.wait_for_selector(BANNER + ':visible', timeout=10000)
    page.wait_for_function("() => !document.getElementById('accountForm').hasAttribute('aria-busy')")

    assert page.evaluate("() => window.app.accounts.length") == 0
    assert page.locator('#accountList >> text=Phantom Account').count() == 0
    # The input is kept for a retry.
    assert page.input_value('#accountName') == 'Phantom Account'
    assert page.input_value('#accountStartingBalance') == '250'
    assert page.evaluate("() => (window.app.balanceHistory || []).length") == 0


@pytest.mark.feature
def test_retry_after_failure_saves_once(app_page):
    page = app_page
    _fail_posts(page, '**/api/accounts')
    _fill_account(page, 'Retry Account')
    page.click('#accountFormSubmit')  # submit-no-wait: the first POST is failed on purpose
    page.wait_for_selector(BANNER + ':visible', timeout=10000)
    page.wait_for_function("() => !document.getElementById('accountForm').hasAttribute('aria-busy')")
    page.unroute('**/api/accounts')
    page.click('#accountFormSubmit')  # submit-no-wait: waited on below
    page.wait_for_function("() => window.app.accounts.some(a => a.name === 'Retry Account')")
    ids = _server_account_ids(page)
    assert ids == page.evaluate("() => window.app.accounts.map(a => a.id)")


@pytest.mark.feature
def test_failed_debt_add_sends_no_follow_up_writes(app_page):
    """No PATCH or DELETE is ever sent for an id the server never assigned."""
    page = app_page
    writes = []
    page.on('request', lambda r: writes.append((r.method, r.url))
            if '/api/' in r.url and r.method in ('PATCH', 'DELETE') else None)
    _fail_posts(page, '**/api/debts')
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    if page.locator('#debtFormBody[hidden]').count():
        page.click('#debtFormToggle')
    page.fill('#debtName', 'Phantom Debt')
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', '500')
    page.fill('#interestRate', '18')
    page.fill('#minimumPayment', '25')
    page.fill('#dueDate', '15')
    page.click('#debtFormSubmit')  # submit-no-wait: the POST is failed on purpose
    page.wait_for_selector(BANNER + ':visible', timeout=10000)
    page.wait_for_function("() => !document.getElementById('debtForm').hasAttribute('aria-busy')")
    assert page.evaluate("() => window.app.debts.length") == 0
    assert page.input_value('#debtName') == 'Phantom Debt'
    page.wait_for_timeout(500)
    assert writes == []


@pytest.mark.feature
def test_failed_transfer_keeps_the_modal_open(app_page):
    page = app_page
    seed_state(page, {'accounts': [
        {'id': 1, 'name': 'From Acct', 'type': 'Checking', 'startingBalance': 1000},
        {'id': 2, 'name': 'To Acct', 'type': 'Savings', 'startingBalance': 0},
    ]})
    wait_for_app_ready(page)
    _fail_posts(page, '**/api/transfers')
    page.evaluate("""() => {
        const id = n => window.app.accounts.find(a => a.name === n).id;
        return window.app.openTransferModal({ fromAccountId: id('From Acct') });
    }""")
    page.wait_for_selector('#transferModal:not(.hidden)')
    to_id = page.evaluate("() => window.app.accounts.find(a => a.name === 'To Acct').id")
    page.select_option('#transferModalTo', value=str(to_id))
    page.fill('#transferModalAmount', '75')
    page.click('#transferModalConfirmBtn')
    page.wait_for_selector(BANNER + ':visible', timeout=10000)
    page.wait_for_function("() => !document.getElementById('transferModal').hasAttribute('aria-busy')")
    assert page.is_visible('#transferModal')
    assert page.input_value('#transferModalAmount') == '75'
    assert page.evaluate("() => window.app.transfers.length") == 0


@pytest.mark.feature
def test_failed_reconciliation_changes_nothing(app_page):
    page = app_page
    seed_state(page, {'accounts': [{'id': 1, 'name': 'Recon Acct', 'type': 'Checking', 'startingBalance': 500}]})
    wait_for_app_ready(page)
    page.evaluate("() => window.app.setSetting && window.app.setSetting('reconciliationAdjustsBalance', true)")
    _fail_posts(page, '**/api/reconciliations')
    result = page.evaluate("""async () => {
        const app = window.app;
        const id = app.accounts[0].id;
        const res = await app.applyReconciliation(id, 640, 'statement', '2026-11-01');
        return { success: res.success, count: app.reconciliations.length, balance: app.accounts[0].startingBalance };
    }""")
    assert result == {'success': False, 'count': 0, 'balance': 500}


@pytest.mark.feature
def test_successful_add_uses_the_server_id(app_page):
    """Positive control: a normal add lands in app.* with the id the server assigned."""
    page = app_page
    _fill_account(page, 'Real Id Account')
    page.click('#accountFormSubmit')  # submit-no-wait: waited on below
    page.wait_for_function("() => window.app.accounts.length === 1")
    assert _server_account_ids(page) == page.evaluate("() => window.app.accounts.map(a => a.id)")
    assert not page.is_visible(BANNER)


# ── #593: a pending account is never offered for linking ──────────────────────

@pytest.mark.feature
def test_pending_account_not_offered_until_saved(app_page):
    page = app_page
    held = _hold_posts(page, '**/api/accounts')
    _fill_account(page, 'Brand New Checking')
    page.click('#accountFormSubmit')  # submit-no-wait: the POST is held to inspect the pending state
    page.wait_for_function("n => n > 0", arg=len(held))
    page.wait_for_function("() => document.getElementById('accountForm').getAttribute('aria-busy') === 'true'")

    options = page.evaluate("() => [...document.querySelectorAll('#incomeAccount option')].map(o => o.textContent)")
    assert not any('Brand New Checking' in o for o in options)

    held[0].continue_()
    page.wait_for_function("() => window.app.accounts.some(a => a.name === 'Brand New Checking')")
    server_ids = _server_account_ids(page)
    option_value = page.evaluate("""() => {
        const opt = [...document.querySelectorAll('#incomeAccount option')]
            .find(o => o.textContent.includes('Brand New Checking'));
        return opt ? Number(opt.value) : null;
    }""")
    assert option_value in server_ids


@pytest.mark.feature
def test_income_linked_to_new_account_saves(app_page):
    """End to end: link an income to the account just created; the server accepts it."""
    page = app_page
    _fill_account(page, 'Payday Checking')
    page.click('#accountFormSubmit')  # submit-no-wait: the next fill waits for the unlocked form
    page.click('button[data-page="income"]')
    page.wait_for_function("""() => [...document.querySelectorAll('#incomeAccount option')]
        .some(o => o.textContent.includes('Payday Checking'))""")
    page.fill('#incomeName', 'Salary')
    page.fill('#incomeAmount', '2000')
    page.fill('#incomeFirstDate', '2026-01-15')
    page.select_option('#incomeAccount', label='Payday Checking (Checking)')
    page.click('#incomeFormSubmit')  # submit-no-wait: waited on below
    page.wait_for_function("() => window.app.incomes.length === 1")
    assert not page.is_visible(BANNER)
    account_id = _server_account_ids(page)[0]
    assert page.evaluate("() => window.app.incomes[0].accountId") == account_id
