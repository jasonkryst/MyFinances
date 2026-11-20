#!/usr/bin/env python3
"""
Reconciliation report export (#318): CSV and Print from the Reconcile history
and from the result panel shown after saving a reconciliation.

Records are injected in memory (like tests/ui/test_reconciliation_actions.py),
so POSTs for the in-memory account are answered by accept_creates_for_local_parents.
"""

import pytest

from tests.conftest import accept_creates_for_local_parents

# Bills on days 4, 5, 7, 10 and 11 of March 2026. Statement range 03-05..03-10:
# Rent5 and Rent10 sit exactly on the inclusive bounds and are Cleared, Rent7 is
# in range but NOT cleared, Rent4 and Rent11 are Cleared but out of range.
SEED_JS = """async (opts) => {
    const app = window.app;
    const bill = (id, day) => ({ id, name: 'Rent' + day, dueDay: day, amount: 50, category: 'Housing', accountId: 8001 });
    app.accounts = [
        { id: 8001, name: 'Recon Checking', type: 'Checking', startingBalance: 1000 },
        { id: 8002, name: 'Other Acct', type: 'Savings', startingBalance: 5 }
    ];
    app.bills = [bill(81, 4), bill(82, 5), bill(83, 7), bill(84, 10), bill(85, 11)];
    app.incomes = []; app.bonuses = []; app.expenses = []; app.debts = [];
    app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
    app.settings = [{ key: 'reconciliationAdjustsBalance', value: false }];
    app._reconciliationAccountFilter = 'all';
    app.ledgerClearedTransactions = {};
    const mod = await import('/src/reconciliation.js');
    const txs = mod.getExpectedTransactionsInRange(app, 8001, '2026-03-01', '2026-03-31');
    for (const tx of txs) {
        if (tx.type === 'bill' && tx.name !== 'Rent7') {
            app.ledgerClearedTransactions[tx.transactionId] = { clearedAt: '2026-03-12T10:00:00.000Z' };
        }
    }
    app.reconciliations = [
        { id: 7000, accountId: 8001, date: '2026-02-28', statementStartDate: '2026-02-01', statementEndDate: '2026-02-28',
          previousBalance: 800, statementBalance: 900, difference: 100, note: 'February close' },
        { id: 7001, accountId: 8001, date: '2026-03-10', statementStartDate: '2026-03-05', statementEndDate: '2026-03-10',
          previousBalance: 1000, statementBalance: 1200, difference: 200, note: opts.note },
        { id: 7002, accountId: 8002, date: '2026-03-10', statementStartDate: '2026-03-01', statementEndDate: '2026-03-10',
          previousBalance: 5, statementBalance: 6, difference: 1, note: 'OTHER-ACCT-NOTE' },
        { id: 7003, accountId: 8001, date: '2026-03-10', statementStartDate: null, statementEndDate: null,
          previousBalance: 1, statementBalance: 2, difference: 1, note: 'legacy' }
    ];
    app.switchPage('reconcile');
    await app.renderReconciliationPage();
}"""

STUB_PRINT_JS = """() => {
    window.__printCalls = 0;
    window.__printHtml = '';
    window.__printClassDuring = null;
    window.print = () => {
        window.__printCalls++;
        window.__printHtml = document.getElementById('reconcilePrintArea').innerHTML;
        window.__printClassDuring = document.body.classList.contains('recon-printing');
    };
}"""

PLAIN_NOTE = 'Statement matched'


@pytest.fixture(autouse=True)
def _accept_local_parent_creates(request):
    if 'app_page' in request.fixturenames:
        accept_creates_for_local_parents(request.getfixturevalue('app_page'), '**/api/reconciliations')


def _seed(page, note=PLAIN_NOTE):
    page.evaluate(SEED_JS, {"note": note})
    page.wait_for_selector('[data-recon-action="export-history"][data-recon-history-id="7001"]')


def _download_csv(page, selector):
    with page.expect_download() as info:
        page.click(selector)
    download = info.value
    with open(download.path(), encoding='utf-8') as f:
        return download.suggested_filename, f.read()


@pytest.mark.feature
def test_history_export_csv_contents(app_page):
    """Positive: cleared in-range rows are exported (bounds inclusive); the rest are not."""
    page = app_page
    _seed(page, note='=HYPERLINK("http://evil.example","click")')

    filename, csv = _download_csv(page, '[data-recon-action="export-history"][data-recon-history-id="7001"]')

    assert filename == 'reconciliation-recon-checking-2026-03-10.csv'
    assert '"Account","Recon Checking"' in csv
    assert '"Statement Start","2026-03-05"' in csv
    assert '"Statement End","2026-03-10"' in csv
    assert '"Previous Balance","1000.00"' in csv
    assert '"Statement Balance","1200.00"' in csv
    assert '"Difference","200.00"' in csv
    # Cleared, on the inclusive bounds
    assert '"Rent5","-50.00","2026-03-12T10:00:00.000Z"' in csv
    assert '"Rent10","-50.00"' in csv
    # In range but uncleared; cleared but out of range
    for absent in ('Rent7', 'Rent4', 'Rent11'):
        assert absent not in csv, absent
    # History log: this account only
    assert '"2026-02-28","900.00","100.00","February close"' in csv
    assert 'OTHER-ACCT-NOTE' not in csv
    # Formula injection is neutralised
    assert '"\'=HYPERLINK(' in csv
    assert ',"=HYPERLINK' not in csv


@pytest.mark.feature
def test_history_export_legacy_entry_without_start_date(app_page):
    """Negative/edge: a legacy record with null dates falls back to the 1st of the end month."""
    page = app_page
    _seed(page)
    # Legacy entry 7003 has date 2026-03-10 only: range 03-01..03-10.
    _, csv = _download_csv(page, '[data-recon-action="export-history"][data-recon-history-id="7003"]')
    assert '"Statement Start","2026-03-01"' in csv
    assert '"Rent4"' in csv and '"Rent5"' in csv and '"Rent10"' in csv
    assert 'Rent11' not in csv and 'Rent7' not in csv


@pytest.mark.feature
def test_export_unknown_entry_is_a_noop(app_page):
    """Negative: an id that is not in app.reconciliations exports nothing."""
    page = app_page
    _seed(page)
    ok = page.evaluate("""async () => {
        const m = await import('/src/reconciliation.js');
        return [m.exportReconciliationCsv(window.app, 424242), m.printReconciliationReport(window.app, 424242)];
    }""")
    assert ok == [False, False]


@pytest.mark.feature
def test_history_print_populates_print_area(app_page):
    """Print calls window.print with the print container filled and the print class set."""
    page = app_page
    _seed(page)
    page.evaluate(STUB_PRINT_JS)

    page.click('[data-recon-action="print-history"][data-recon-history-id="7001"]')

    assert page.evaluate("window.__printCalls") == 1
    assert page.evaluate("window.__printClassDuring") is True
    html = page.evaluate("window.__printHtml")
    assert 'Rent5' in html and 'Rent10' in html
    assert 'Rent7' not in html and 'Rent4' not in html
    assert '$1,200.00' in html and 'Statement matched' in html
    assert 'February close' in html and 'OTHER-ACCT-NOTE' not in html
    # Class is removed again afterwards
    assert page.evaluate("document.body.classList.contains('recon-printing')") is False


@pytest.mark.security
def test_print_view_escapes_html_in_note(app_page):
    """XSS: markup in a note is rendered as text in the print view, never as elements."""
    page = app_page
    _seed(page, note='<img src=x onerror="window.__xss=1">')
    page.evaluate(STUB_PRINT_JS)

    page.click('[data-recon-action="print-history"][data-recon-history-id="7001"]')

    assert page.evaluate("window.__printCalls") == 1
    assert page.evaluate("document.querySelectorAll('#reconcilePrintArea img').length") == 0
    assert '&lt;img' in page.evaluate("window.__printHtml")
    page.wait_for_timeout(200)
    assert page.evaluate("window.__xss") is None


@pytest.mark.feature
def test_apply_reconciliation_shows_result_with_export_and_print(app_page):
    """Saving a reconciliation shows the result panel; Export CSV and Print work from it."""
    page = app_page
    _seed(page)
    page.evaluate(STUB_PRINT_JS)

    page.fill('#recon-start-8001', '2026-03-05')
    page.fill('#recon-end-8001', '2026-03-10')
    page.fill('#recon-balance-8001', '1234')
    page.fill('#recon-note-8001', 'Panel check')
    page.click('[data-recon-action="reconcile"][data-recon-id="8001"]')

    page.wait_for_selector('#reconcileResultPanel:not(.hidden)', timeout=10000)
    assert 'Recon Checking' in page.text_content('#reconcileResultMessage')

    _, csv = _download_csv(page, '#reconcileResultExportBtn')
    assert '"Statement Balance","1234.00"' in csv
    assert '"Note","Panel check"' in csv
    assert '"Rent5"' in csv and 'Rent7' not in csv

    page.click('#reconcileResultPrintBtn')
    assert page.evaluate("window.__printCalls") == 1
    assert 'Panel check' in page.evaluate("window.__printHtml")

    page.click('#reconcileResultClose')
    assert 'hidden' in page.get_attribute('#reconcileResultPanel', 'class')


@pytest.mark.feature
def test_failed_apply_shows_no_result_panel(app_page):
    """Negative: an invalid statement balance shows the alert and no result panel."""
    page = app_page
    _seed(page)

    page.fill('#recon-balance-8001', '')
    page.click('[data-recon-action="reconcile"][data-recon-id="8001"]')
    page.wait_for_selector('#alertModalOkBtn', state='visible')
    assert 'hidden' in page.get_attribute('#reconcileResultPanel', 'class')
    page.click('#alertModalOkBtn')
