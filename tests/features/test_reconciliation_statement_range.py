#!/usr/bin/env python3
"""
Reconciliation statement start/end date tests (issue #275, RC-02).

Covers applyReconciliation's { statementStartDate, statementEndDate } interface,
range validation (positive + negative), default range computation, the
Reconcile-page card and Ledger quick-reconcile modal date inputs, history
display, and sanitize/import round-trips of the two new fields.
"""

import pytest


def _seed(page, reconciliations=None, with_bill=False, switch_page=True):
    """One checking account (id 9001), optional 1st-of-month bill, optional prior reconciliations."""
    page.wait_for_function("() => window.app && window.app.accounts !== undefined", timeout=10000)
    page.evaluate("""([recons, withBill, switchPage]) => {
        const app = window.app;
        app.accounts = [{ id: 9001, name: 'Range Checking', type: 'Checking', startingBalance: 1000 }];
        app.bills = withBill
            ? [{ id: 90, name: 'Rent', dueDay: 1, amount: 200, category: 'Housing', accountId: 9001 }]
            : [];
        app.incomes = []; app.bonuses = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = recons;
        app.settings = [{ key: 'reconciliationAdjustsBalance', value: true }];
        app._reconciliationAccountFilter = 'all';
        if (switchPage) app.switchPage('reconcile');
    }""", [reconciliations or [], with_bill, switch_page])


def _today(page):
    return page.evaluate("""async () => (await import('/src/utils.js')).todayISO()""")


# ---------------------------------------------------------------------------
# applyReconciliation — new range interface
# ---------------------------------------------------------------------------

@pytest.mark.feature
def test_apply_with_range_records_start_and_end(app_page):
    """A valid range is stored on the entry, and date mirrors statementEndDate."""
    page = app_page
    _seed(page, switch_page=False)

    entry = page.evaluate("""async () => {
        const res = await window.app.applyReconciliation(9001, 1100, 'Sep statement',
            { statementStartDate: '2026-09-01', statementEndDate: '2026-09-30' });
        return { success: res.success, entry: window.app.reconciliations[0] };
    }""")

    assert entry['success'] is True
    assert entry['entry']['statementStartDate'] == '2026-09-01'
    assert entry['entry']['statementEndDate'] == '2026-09-30'
    assert entry['entry']['date'] == '2026-09-30'


@pytest.mark.feature
def test_apply_with_single_day_range_is_valid(app_page):
    """Start == end (a one-day statement) is accepted."""
    page = app_page
    _seed(page, switch_page=False)

    result = page.evaluate("""async () => {
        const res = await window.app.applyReconciliation(9001, 1000, '',
            { statementStartDate: '2026-09-15', statementEndDate: '2026-09-15' });
        return { success: res.success, count: window.app.reconciliations.length };
    }""")

    assert result == {'success': True, 'count': 1}


@pytest.mark.feature
def test_apply_rejects_end_before_start(app_page):
    """End date before start date is rejected with a visible alert; nothing is recorded."""
    page = app_page
    _seed(page, switch_page=False)

    page.evaluate("""() => {
        window._rangePromise = window.app.applyReconciliation(9001, 1500, '',
            { statementStartDate: '2026-09-30', statementEndDate: '2026-09-01' });
    }""")
    alert_text = page.locator('#alertModal').text_content()
    assert 'end date must not be before the start date' in alert_text
    page.locator('#alertModalOkBtn').click()

    result = page.evaluate("""async () => {
        const res = await window._rangePromise;
        return { success: res.success, count: window.app.reconciliations.length,
                 balance: window.app.accounts[0].startingBalance };
    }""")
    assert result == {'success': False, 'count': 0, 'balance': 1000}


@pytest.mark.feature
@pytest.mark.parametrize('start,end', [
    ('', '2026-09-30'),
    ('2026-09-01', ''),
    ('not-a-date', '2026-09-30'),
    ('2026-02-31x', '2026-09-30'),
])
def test_apply_rejects_missing_or_invalid_range_dates(app_page, start, end):
    """A missing or malformed start/end date is rejected before anything is recorded."""
    page = app_page
    _seed(page, switch_page=False)

    page.evaluate("""([start, end]) => {
        window._rangePromise = window.app.applyReconciliation(9001, 1500, '',
            { statementStartDate: start, statementEndDate: end });
    }""", [start, end])
    assert 'valid statement start and end dates' in page.locator('#alertModal').text_content()
    page.locator('#alertModalOkBtn').click()

    result = page.evaluate("""async () => {
        const res = await window._rangePromise;
        return { success: res.success, count: window.app.reconciliations.length };
    }""")
    assert result == {'success': False, 'count': 0}


@pytest.mark.feature
def test_apply_legacy_date_string_still_supported(app_page):
    """The legacy positional date string still works: it becomes the end date, with no start."""
    page = app_page
    _seed(page, switch_page=False)

    entry = page.evaluate("""async () => {
        await window.app.applyReconciliation(9001, 1100, '', '2026-06-10');
        return window.app.reconciliations[0];
    }""")

    assert entry['date'] == '2026-06-10'
    assert entry['statementEndDate'] == '2026-06-10'
    assert entry['statementStartDate'] is None


# ---------------------------------------------------------------------------
# Default range
# ---------------------------------------------------------------------------

@pytest.mark.feature
def test_default_range_without_prior_reconciliation(app_page):
    """No prior reconciliation: start = 1st of the current month, end = today."""
    page = app_page
    _seed(page, switch_page=False)
    today = _today(page)

    rng = page.evaluate("""async () => {
        const mod = await import('/src/reconciliation.js');
        return mod.getDefaultStatementRange(window.app, 9001);
    }""")

    assert rng == {'start': today[:8] + '01', 'end': today}


@pytest.mark.feature
def test_default_range_starts_day_after_latest_reconciliation(app_page):
    """Start defaults to the day after the most recent prior reconciliation for that account only."""
    page = app_page
    _seed(page, switch_page=False, reconciliations=[
        {'id': 1, 'accountId': 9001, 'date': '2026-08-31', 'previousBalance': 0, 'statementBalance': 1, 'difference': 1},
        {'id': 2, 'accountId': 9001, 'date': '2026-07-31', 'previousBalance': 0, 'statementBalance': 1, 'difference': 1},
        # Other account's later reconciliation must not affect 9001's default
        {'id': 3, 'accountId': 4242, 'date': '2026-09-15', 'previousBalance': 0, 'statementBalance': 1, 'difference': 1},
    ])

    rng = page.evaluate("""async () => {
        const mod = await import('/src/reconciliation.js');
        return mod.getDefaultStatementRange(window.app, 9001);
    }""")

    assert rng['start'] == '2026-09-01', "Month-end rollover: day after Aug 31 is Sep 1"
    assert rng['end'] == _today(page)


@pytest.mark.feature
def test_default_range_clamps_start_when_last_reconciliation_is_today(app_page):
    """If the last reconciliation is today, the default start never lands after the default end."""
    page = app_page
    today = _today(page)
    _seed(page, switch_page=False, reconciliations=[
        {'id': 1, 'accountId': 9001, 'date': today, 'previousBalance': 0, 'statementBalance': 1, 'difference': 1},
    ])

    rng = page.evaluate("""async () => {
        const mod = await import('/src/reconciliation.js');
        return mod.getDefaultStatementRange(window.app, 9001);
    }""")

    assert rng == {'start': today, 'end': today}


@pytest.mark.feature
@pytest.mark.parametrize('start,end,expected', [
    ('2026-09-01', '2026-09-30', ''),
    ('2026-09-30', '2026-09-30', ''),
    ('2026-09-30', '2026-09-01', 'Statement end date must not be before the start date.'),
    ('', '2026-09-30', 'Please enter valid statement start and end dates.'),
    ('2026-09-01', None, 'Please enter valid statement start and end dates.'),
])
def test_validate_statement_range(app_page, start, end, expected):
    """validateStatementRange returns '' for valid ranges and a user-facing message otherwise."""
    result = app_page.evaluate("""async ([start, end]) => {
        const mod = await import('/src/reconciliation.js');
        return mod.validateStatementRange(start, end);
    }""", [start, end])
    assert result == expected


# ---------------------------------------------------------------------------
# Reconcile page card
# ---------------------------------------------------------------------------

@pytest.mark.ui
def test_card_has_start_and_end_inputs_with_defaults(app_page):
    """The card replaces the single statement date with start/end inputs, pre-filled with the default range."""
    page = app_page
    _seed(page, reconciliations=[
        {'id': 1, 'accountId': 9001, 'date': '2026-08-31', 'previousBalance': 0, 'statementBalance': 1000, 'difference': 0},
    ])

    assert page.query_selector('#recon-date-9001') is None, "Single statement date input should be gone"
    assert page.input_value('#recon-start-9001') == '2026-09-01'
    assert page.input_value('#recon-end-9001') == _today(page)
    assert page.locator('label[for="recon-start-9001"]').text_content().strip() == 'Statement Start Date'
    assert page.locator('label[for="recon-end-9001"]').text_content().strip() == 'Statement End Date'


@pytest.mark.ui
def test_card_expected_transactions_follow_explicit_range(app_page):
    """Changing the range re-queries expected transactions for exactly that range."""
    page = app_page
    _seed(page, with_bill=True)

    page.fill('#recon-start-9001', '2026-01-01')
    page.fill('#recon-end-9001', '2026-01-31')
    body = page.locator('#recon-expected-body-9001')
    assert 'Rent' in body.text_content()
    assert 'Jan' in page.locator('#recon-expected-summary-9001').text_content()

    # Excluding the 1st drops the rent bill
    page.fill('#recon-start-9001', '2026-01-02')
    assert 'No expected transactions in this period.' in body.text_content()


@pytest.mark.ui
def test_card_invalid_range_shows_error_and_blocks_reconcile(app_page):
    """An inverted range shows a role=alert error and disables Reconcile; fixing it clears both."""
    page = app_page
    _seed(page)
    btn = page.locator('[data-recon-action="reconcile"][data-recon-id="9001"]')
    error = page.locator('#recon-range-error-9001')

    assert error.get_attribute('role') == 'alert'
    assert error.is_hidden()

    page.fill('#recon-start-9001', '2026-09-30')
    page.fill('#recon-end-9001', '2026-09-01')
    assert error.is_visible()
    assert 'end date must not be before the start date' in error.text_content()
    assert btn.is_disabled()

    page.fill('#recon-end-9001', '2026-10-01')
    assert error.is_hidden()
    assert btn.is_enabled()


@pytest.mark.ui
def test_card_reconcile_records_range(app_page):
    """Submitting the card stores the chosen statement range on the history entry."""
    page = app_page
    _seed(page)

    page.fill('#recon-start-9001', '2026-09-01')
    page.fill('#recon-end-9001', '2026-09-30')
    page.fill('#recon-balance-9001', '1200')
    page.click('[data-recon-action="reconcile"][data-recon-id="9001"]')
    page.wait_for_function("() => window.app.reconciliations.length === 1", timeout=5000)

    entry = page.evaluate("() => window.app.reconciliations[0]")
    assert entry['statementStartDate'] == '2026-09-01'
    assert entry['statementEndDate'] == '2026-09-30'
    assert entry['date'] == '2026-09-30'


@pytest.mark.ui
def test_history_shows_statement_period(app_page):
    """History rows show the statement period when recorded, and omit it for legacy rows."""
    page = app_page
    _seed(page, reconciliations=[
        {'id': 1, 'accountId': 9001, 'date': '2026-09-30', 'statementStartDate': '2026-09-01',
         'statementEndDate': '2026-09-30', 'previousBalance': 0, 'statementBalance': 1000, 'difference': 0, 'note': 'ranged'},
        {'id': 2, 'accountId': 9001, 'date': '2026-08-15', 'previousBalance': 0, 'statementBalance': 1000, 'difference': 0, 'note': 'legacy'},
    ])

    rows = page.query_selector_all('.recon-history-table tbody tr')
    assert len(rows) == 2
    assert rows[0].query_selector('.recon-period') is not None
    assert 'Statement:' in rows[0].text_content()
    assert rows[1].query_selector('.recon-period') is None


# ---------------------------------------------------------------------------
# Ledger quick-reconcile modal
# ---------------------------------------------------------------------------

def _open_modal(page, **seed):
    _seed(page, switch_page=False, **seed)
    page.evaluate("() => window.app.openReconcileModal(9001)")
    page.wait_for_selector('#reconcileModal.flex-visible', timeout=5000)


@pytest.mark.ui
def test_modal_has_start_and_end_inputs_with_defaults(app_page):
    """The modal shows start/end inputs (no single date) defaulting to the computed range."""
    page = app_page
    _open_modal(page)
    today = _today(page)

    assert page.query_selector('#reconcileModalDate') is None
    assert page.input_value('#reconcileModalStartDate') == today[:8] + '01'
    assert page.input_value('#reconcileModalEndDate') == today
    assert page.locator('#reconcileModalRangeError').is_hidden()


@pytest.mark.ui
def test_modal_expected_preview_follows_range(app_page):
    """The modal's expected-transactions preview is driven by the explicit range."""
    page = app_page
    _open_modal(page, with_bill=True)

    page.fill('#reconcileModalStartDate', '2026-01-01')
    page.fill('#reconcileModalEndDate', '2026-01-31')
    assert 'Rent' in page.locator('#reconcileModalExpected').text_content()

    page.fill('#reconcileModalStartDate', '2026-01-02')
    assert 'No expected transactions in this period.' in page.locator('#reconcileModalExpected').text_content()


@pytest.mark.ui
def test_modal_invalid_range_blocks_submission(app_page):
    """An inverted range in the modal shows an inline error; confirming (click or Enter) records nothing."""
    page = app_page
    _open_modal(page)

    page.fill('#reconcileModalStartDate', '2026-09-30')
    page.fill('#reconcileModalEndDate', '2026-09-01')
    error = page.locator('#reconcileModalRangeError')
    assert error.is_visible()
    assert error.get_attribute('role') == 'alert'
    assert page.locator('#reconcileModalConfirmBtn').is_disabled()

    page.focus('#reconcileModalBalance')
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)
    assert page.evaluate("() => window.app.reconciliations.length") == 0
    assert page.locator('#reconcileModal').is_visible(), "Modal should stay open on an invalid range"


@pytest.mark.ui
def test_modal_enter_on_summary_toggles_details_without_submitting(app_page):
    """Enter on the expected-transactions <summary> opens it rather than submitting the reconciliation."""
    page = app_page
    _open_modal(page)

    page.focus('#reconcileModalExpectedSummary')
    page.keyboard.press('Enter')
    page.wait_for_function(
        "() => document.getElementById('reconcileModalExpectedSummary').parentElement.open", timeout=2000
    )
    assert page.evaluate("() => window.app.reconciliations.length") == 0
    assert page.locator('#reconcileModal').is_visible()


@pytest.mark.ui
def test_modal_valid_range_records_and_closes(app_page):
    """A valid modal submission records both dates and closes the modal."""
    page = app_page
    _open_modal(page)

    page.fill('#reconcileModalStartDate', '2026-09-01')
    page.fill('#reconcileModalEndDate', '2026-09-30')
    page.fill('#reconcileModalBalance', '875')
    page.click('#reconcileModalConfirmBtn')
    page.wait_for_selector('#reconcileModal', state='hidden', timeout=5000)

    entry = page.evaluate("() => window.app.reconciliations[0]")
    assert entry['statementStartDate'] == '2026-09-01'
    assert entry['statementEndDate'] == '2026-09-30'
    assert entry['statementBalance'] == 875


@pytest.mark.ui
def test_modal_reopen_resets_error_state(app_page):
    """Reopening the modal after an invalid range resets inputs to defaults and clears the error."""
    page = app_page
    _open_modal(page)

    page.fill('#reconcileModalStartDate', '2026-09-30')
    page.fill('#reconcileModalEndDate', '2026-09-01')
    page.keyboard.press('Escape')
    page.wait_for_selector('#reconcileModal', state='hidden', timeout=5000)

    page.evaluate("() => window.app.openReconcileModal(9001)")
    page.wait_for_selector('#reconcileModal.flex-visible', timeout=5000)
    assert page.locator('#reconcileModalRangeError').is_hidden()
    assert page.locator('#reconcileModalConfirmBtn').is_enabled()
    assert page.input_value('#reconcileModalEndDate') == _today(page)


# ---------------------------------------------------------------------------
# Persistence: sanitize + import round-trip
# ---------------------------------------------------------------------------

@pytest.mark.feature
def test_import_round_trip_preserves_statement_range(app_page):
    """JSON import keeps statementStartDate/EndDate; malicious or inverted values are sanitized."""
    page = app_page

    recs = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/dataExport.js');
        app.accounts = [{ id: 9101, name: 'Range Import', type: 'Checking', startingBalance: 500 }];
        app.reconciliations = [];
        const base = { accountId: 9101, previousBalance: 400, statementBalance: 500, difference: 100 };
        const payload = {
            accounts: app.accounts,
            debts: [{ id: 1, name: 'Dummy Debt', debtType: 'creditCard', accountBalance: 100, interestRate: 5, minimumPayment: 10, dueDate: 1 }],
            incomes: [], bonuses: [], bills: [], expenses: [],
            recurringTemplates: [], emergencyFunds: [], sinkingFunds: [],
            reconciliations: [
                { ...base, id: 1, date: '2026-09-30', note: 'good', statementStartDate: '2026-09-01', statementEndDate: '2026-09-30' },
                { ...base, id: 2, date: '2026-08-31', note: 'xss', statementStartDate: '<img src=x onerror=alert(1)>', statementEndDate: '2026-08-31' },
                { ...base, id: 3, date: '2026-07-31', note: 'inverted', statementStartDate: '2026-08-15', statementEndDate: '2026-07-31' }
            ]
        };
        const file = new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' });
        return new Promise(resolve => {
            mod.importAllJSON(app, file, {});
            setTimeout(() => resolve(app.reconciliations), 300);
        });
    }""")

    by_note = {r['note']: r for r in recs}
    assert by_note['good']['statementStartDate'] == '2026-09-01'
    assert by_note['good']['statementEndDate'] == '2026-09-30'
    assert by_note['xss']['statementStartDate'] is None
    assert by_note['xss']['statementEndDate'] == '2026-08-31'
    assert by_note['inverted']['statementStartDate'] is None
    assert by_note['inverted']['statementEndDate'] == '2026-07-31'


@pytest.mark.feature
def test_statement_range_survives_save_and_reload(app_page):
    """Recorded range survives a localStorage save/load cycle."""
    page = app_page
    _seed(page, switch_page=False)

    entry = page.evaluate("""async () => {
        const app = window.app;
        await app.applyReconciliation(9001, 1100, '', { statementStartDate: '2026-09-01', statementEndDate: '2026-09-30' });
        await app.saveToStorage();
        app.reconciliations = [];
        app.loadFromStorage();
        return app.reconciliations.find(r => r.accountId === 9001);
    }""")

    assert entry['statementStartDate'] == '2026-09-01'
    assert entry['statementEndDate'] == '2026-09-30'
