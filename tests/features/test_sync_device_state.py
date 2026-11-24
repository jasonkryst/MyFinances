#!/usr/bin/env python3
"""
#587: an in-progress reconciliation (plan_settings.recon_drafts) and the
Ledger's hidden columns (the ledgerHiddenColumns setting) live on the server,
so work started in one browser resumes in another. Pre-#587 copies in browser
storage migrate once and their keys are removed.
"""

import pytest

from tests.conftest import (
    BASE_URL, ensure_session, seed_state, wait_for_api, wait_for_app_ready,
)

STATE = {
    'accounts': [{'id': 1, 'name': 'Sync Checking', 'type': 'Checking', 'startingBalance': 1000}],
    'incomes': [{'id': 1, 'name': 'Pay', 'amount': 500, 'frequency': 'monthly',
                 'firstPayDate': '2026-01-05', 'accountId': 1}],
}


def _account_id(page):
    return page.evaluate("() => window.app.accounts.find(a => a.name === 'Sync Checking').id")


def _second_device(browser):
    """A separate browser context (its own localStorage), signed in as the same user."""
    context = browser.new_context()
    ensure_session(context)
    page = context.new_page()
    page.goto(BASE_URL)
    wait_for_app_ready(page)
    return context, page


def _open_reconcile(page, account_id):
    page.evaluate("(id) => window.app.openReconcileModal(id)", account_id)
    page.wait_for_selector('#reconcileModal.flex-visible', timeout=5000)


@pytest.mark.feature
def test_reconciliation_started_on_one_device_resumes_on_another(app_page, browser):
    """The issue's acceptance: save progress in one context, resume in another."""
    page = app_page
    seed_state(page, STATE)
    acct = _account_id(page)
    _open_reconcile(page, acct)
    page.fill('#reconcileModalBalance', '1234.56')
    page.fill('#reconcileModalNote', 'Half way through')
    page.click('#reconcileModalCancelBtn')
    page.wait_for_selector('#reconSaveProgressModal.flex-visible', timeout=5000)
    page.click('#reconSaveProgressSaveBtn')
    page.wait_for_selector('#reconcileModal', state='hidden', timeout=5000)
    wait_for_api(page, '/api/plan-settings', lambda d: str(acct) in (d.get('reconDrafts') or {}))
    assert page.evaluate("() => localStorage.getItem('debtTrackerReconInProgress')") is None

    context, other = _second_device(browser)
    try:
        _open_reconcile(other, acct)
        assert other.input_value('#reconcileModalBalance') == '1234.56'
        assert other.input_value('#reconcileModalNote') == 'Half way through'
        assert other.is_visible('#reconcileModalResumeBanner')
    finally:
        context.close()


@pytest.mark.feature
def test_discarding_on_one_device_clears_the_draft_for_the_other(app_page, browser):
    """Negative: a discarded draft is gone everywhere, not only in this browser."""
    page = app_page
    seed_state(page, STATE)
    acct = _account_id(page)
    page.evaluate("""async (id) => {
        const mod = await import('/src/reconciliation.js');
        mod.saveReconInProgress(window.app, id, { statementBalance: '42', clearedTxIds: [] });
    }""", acct)
    wait_for_api(page, '/api/plan-settings', lambda d: str(acct) in (d.get('reconDrafts') or {}))
    _open_reconcile(page, acct)
    page.fill('#reconcileModalBalance', '43')
    page.click('#reconcileModalCancelBtn')
    page.wait_for_selector('#reconSaveProgressModal.flex-visible', timeout=5000)
    page.click('#reconSaveProgressDiscardBtn')
    wait_for_api(page, '/api/plan-settings', lambda d: d.get('reconDrafts') == {})

    context, other = _second_device(browser)
    try:
        _open_reconcile(other, acct)
        assert other.is_hidden('#reconcileModalResumeBanner')
        assert other.input_value('#reconcileModalBalance') == '1000'
    finally:
        context.close()


def _hide_ledger_column(page, col):
    page.click('button[data-page="ledger"]')
    page.wait_for_selector('#ledgerColsSelect', state='attached', timeout=5000)
    page.evaluate("""(col) => {
        const sel = document.getElementById('ledgerColsSelect');
        Array.from(sel.options).forEach(o => { o.selected = o.value !== col; });
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    }""", col)


@pytest.mark.feature
def test_ledger_hidden_columns_follow_the_user_to_another_device(app_page, browser):
    page = app_page
    seed_state(page, STATE)
    _hide_ledger_column(page, 'balance')
    wait_for_api(page, '/api/settings',
                 lambda rows: any(r['key'] == 'ledgerHiddenColumns' and r['value'] == 'balance' for r in rows))

    context, other = _second_device(browser)
    try:
        other.click('button[data-page="ledger"]')
        other.wait_for_selector('.ledger-table', timeout=5000)
        assert other.locator('th[data-col="balance"].ledger-col-hidden').count() == 1
        assert other.locator('th[data-col="amount"].ledger-col-hidden').count() == 0
    finally:
        context.close()


@pytest.mark.feature
def test_showing_every_column_again_is_saved_as_empty(app_page):
    page = app_page
    seed_state(page, STATE)
    _hide_ledger_column(page, 'balance')
    wait_for_api(page, '/api/settings',
                 lambda rows: any(r['key'] == 'ledgerHiddenColumns' and r['value'] == 'balance' for r in rows))
    page.evaluate("""() => {
        const sel = document.getElementById('ledgerColsSelect');
        Array.from(sel.options).forEach(o => { o.selected = true; });
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    }""")
    wait_for_api(page, '/api/settings',
                 lambda rows: any(r['key'] == 'ledgerHiddenColumns' and r['value'] == '' for r in rows))


@pytest.mark.feature
def test_legacy_hidden_columns_migrate_once(app_page):
    """A pre-#587 browser copy becomes the setting and the key is removed."""
    page = app_page
    seed_state(page, STATE)
    page.evaluate("() => { localStorage.setItem('ledgerHiddenColumns', 'account,bogus,cleared'); window.app._ledgerColsMigrated = false; }")
    page.click('button[data-page="ledger"]')
    page.wait_for_selector('.ledger-table', timeout=5000)
    wait_for_api(page, '/api/settings',
                 lambda rows: any(r['key'] == 'ledgerHiddenColumns' and r['value'] == 'account,cleared' for r in rows))
    assert page.evaluate("() => localStorage.getItem('ledgerHiddenColumns')") is None
    assert page.locator('th[data-col="account"].ledger-col-hidden').count() == 1


@pytest.mark.feature
def test_legacy_hidden_columns_never_override_the_server(app_page):
    """Negative: when the server already has a value, the browser copy is dropped."""
    page = app_page
    seed_state(page, {**STATE, 'settings': [{'key': 'ledgerHiddenColumns', 'value': 'name'}]})
    page.evaluate("() => { localStorage.setItem('ledgerHiddenColumns', 'account'); window.app._ledgerColsMigrated = false; }")
    page.click('button[data-page="ledger"]')
    page.wait_for_selector('.ledger-table', timeout=5000)
    assert page.evaluate("() => localStorage.getItem('ledgerHiddenColumns')") is None
    assert page.locator('th[data-col="name"].ledger-col-hidden').count() == 1
    assert page.locator('th[data-col="account"].ledger-col-hidden').count() == 0


@pytest.mark.feature
@pytest.mark.parametrize('value', ['bogus', 'date,account,name,amount,balance,cleared', 'date,date', 7])
def test_server_rejects_invalid_hidden_columns(app_page, value):
    """Negative: the server accepts only a subset of the real columns, at least one visible."""
    status = app_page.evaluate("""async (value) => {
        const csrf = document.cookie.match(/csrf=([^;]+)/)[1];
        const r = await fetch('/api/settings/ledgerHiddenColumns', {
            method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
            body: JSON.stringify({ value }) });
        await r.text();
        return r.status;
    }""", value)
    assert status == 400


@pytest.mark.feature
def test_replace_import_empties_drafts_but_merge_keeps_them(app_page):
    """Drafts are not exported; a replace import empties them, a merge keeps them."""
    page = app_page
    seed_state(page, STATE)
    acct = _account_id(page)
    page.evaluate("""async (id) => {
        const mod = await import('/src/reconciliation.js');
        mod.saveReconInProgress(window.app, id, { statementBalance: '9', clearedTxIds: [] });
    }""", acct)
    wait_for_api(page, '/api/plan-settings', lambda d: str(acct) in (d.get('reconDrafts') or {}))
    # A file that carries drafts anyway: import drops them (they are not part of the format).
    dropped = page.evaluate("""async () => {
        const { sanitizeParsedState } = await import('/src/sanitizers.js');
        return 'reconDrafts' in sanitizeParsedState({ accounts: [], reconDrafts: { '1': { statementBalance: '5' } } });
    }""")
    assert dropped is False
    page.evaluate("""async () => {
        const { sanitizeParsedState } = await import('/src/sanitizers.js');
        const mod = await import('/src/postgresImport.js');
        const clean = sanitizeParsedState({ accounts: [{ id: 50, name: 'Merged In', type: 'Checking', startingBalance: 1 }] });
        await mod.mergeForPostgres(window.app, clean);
    }""")
    data = wait_for_api(page, '/api/plan-settings', lambda d: True)
    assert str(acct) in data['reconDrafts']
    seed_state(page, STATE)  # a replace import
    wait_for_api(page, '/api/plan-settings', lambda d: d.get('reconDrafts') == {})
    assert page.evaluate('() => window.app.reconDrafts') == {}
