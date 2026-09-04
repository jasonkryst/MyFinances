#!/usr/bin/env python3
"""
Table Mobile Scroll Tests
Verifies wide data tables (debt summary, payment schedule, summary report,
reconciliation, ledger) are contained in an overflow-x:auto wrapper on
narrow viewports, so the table scrolls horizontally instead of forcing the
whole page to overflow.

Data is created at the default desktop viewport (the mobile nav menu is
collapsed behind #navToggle and is covered by separate mobile-nav tests),
then the viewport is shrunk and navigation continues via app.switchPage()
so each test stays focused on table/wrapper behavior.
"""

import pytest

from tests.conftest import create_account, create_debt, assert_no_errors

MOBILE_VIEWPORT = {"width": 375, "height": 800}


def _no_page_overflow(page):
    """The page body must never be wider than the viewport itself."""
    body_scroll_width = page.evaluate("() => document.body.scrollWidth")
    viewport_width = page.evaluate("() => window.innerWidth")
    assert body_scroll_width <= viewport_width + 1, (
        f"Page body overflows viewport horizontally: "
        f"body.scrollWidth={body_scroll_width}, window.innerWidth={viewport_width}"
    )


@pytest.mark.ui
def test_debt_summary_table_scrolls_within_wrapper_on_mobile(app_page, debt_data):
    """The Debt Summary table must scroll inside .table-wrapper, not overflow the page."""
    page = app_page
    create_debt(page, debt_data)

    page.click('button[data-page="strategy"]')
    page.wait_for_timeout(150)
    page.fill('#monthlyPayment', '200')
    page.click('#calculateBtn')
    page.wait_for_timeout(300)

    page.set_viewport_size(MOBILE_VIEWPORT)
    page.click('[data-rtab="debt-summary"]')
    page.wait_for_timeout(300)

    wrapped = page.evaluate(
        "() => !!document.querySelector('#debtSummaryTable').closest('.table-wrapper')"
    )
    assert wrapped, "Expected #debtSummaryTable to be inside a .table-wrapper"
    _no_page_overflow(page)
    assert_no_errors(page)


@pytest.mark.ui
def test_payment_schedule_table_scrolls_within_wrapper_on_mobile(app_page, debt_data):
    """The payment schedule table must scroll inside .table-wrapper, not overflow the page."""
    page = app_page
    create_debt(page, debt_data)

    page.click('button[data-page="strategy"]')
    page.wait_for_timeout(150)
    page.fill('#monthlyPayment', '200')
    page.click('#calculateBtn')
    page.wait_for_timeout(300)

    page.set_viewport_size(MOBILE_VIEWPORT)
    page.click('[data-rtab="schedule"]')
    page.wait_for_timeout(300)

    wrapped = page.evaluate(
        "() => !!document.querySelector('#paymentTable').closest('.table-wrapper')"
    )
    assert wrapped, "Expected #paymentTable to be inside a .table-wrapper"
    _no_page_overflow(page)


@pytest.mark.ui
def test_summary_report_tables_scroll_within_wrapper_on_mobile(app_page, account_data):
    """Reports > Summary tab tables (cash flow, account balances, net worth) must
    each scroll inside .nw-history-table-wrap, not overflow the page."""
    page = app_page
    create_account(page, account_data)

    page.set_viewport_size(MOBILE_VIEWPORT)
    page.evaluate("() => window.app.switchPage('reports')")
    page.wait_for_timeout(300)
    page.click('[data-rptab="summary"]')
    page.wait_for_timeout(400)

    tables = page.evaluate("""
        () => Array.from(document.querySelectorAll('.nw-history-table'))
            .map(t => !!t.closest('.nw-history-table-wrap'))
    """)
    assert tables, "Expected at least one .nw-history-table on the Summary tab"
    assert all(tables), "Every .nw-history-table must be inside a .nw-history-table-wrap"
    _no_page_overflow(page)


@pytest.mark.ui
def test_summary_report_narrow_tables_have_no_internal_scroll_on_mobile(app_page, account_data):
    """Regression test for GitHub issue #31: the Summary tab's narrow tables
    (Cash Flow, Account Balances, Net Worth) must fit the mobile viewport
    without their own horizontal scrollbar -- unlike the wider report tables,
    they don't need the shared 680px min-width, so they opt out via
    .nw-history-table--compact and restack into cards instead."""
    page = app_page
    create_account(page, account_data)

    page.set_viewport_size(MOBILE_VIEWPORT)
    page.evaluate("() => window.app.switchPage('reports')")
    page.wait_for_timeout(300)
    page.click('[data-rptab="summary"]')
    page.wait_for_timeout(400)

    tables = page.evaluate("""
        () => Array.from(document.querySelectorAll('#rptPanel-summary .nw-history-table--compact'))
            .map(t => ({ scrollWidth: t.scrollWidth, clientWidth: t.clientWidth }))
    """)
    assert len(tables) == 3, f"Expected 3 compact tables on the Summary tab, found {len(tables)}"
    for t in tables:
        assert t['scrollWidth'] <= t['clientWidth'] + 1, (
            f"Compact table should not overflow its own width on mobile: {t}"
        )
    _no_page_overflow(page)
    assert_no_errors(page)


@pytest.mark.ui
def test_summary_report_account_balances_stacks_into_labelled_cards_on_mobile(app_page, account_data):
    """The Account Balances table's Start/End/Change cells should restack into
    a card layout on mobile, with each value cell showing its column name via
    a generated data-label so the row remains understandable without headers."""
    page = app_page
    create_account(page, account_data)

    page.set_viewport_size(MOBILE_VIEWPORT)
    page.evaluate("() => window.app.switchPage('reports')")
    page.wait_for_timeout(300)
    page.click('[data-rptab="summary"]')
    page.wait_for_timeout(400)

    info = page.evaluate("""
        () => {
            const table = document.querySelectorAll('#rptPanel-summary .nw-history-table--compact')[1];
            const row = table.querySelector('tbody tr');
            const cells = Array.from(row.querySelectorAll('td'));
            return {
                display: getComputedStyle(row).display,
                cellDisplay: getComputedStyle(cells[1]).display,
                labels: cells.map(c => c.getAttribute('data-label')),
                beforeContent: getComputedStyle(cells[1], '::before').content
            };
        }
    """)
    assert info['display'] == 'block', "Table rows should stack as blocks (cards) on mobile"
    assert info['cellDisplay'] == 'flex', "Value cells should lay out label/value with flex on mobile"
    assert info['labels'] == [None, 'Start', 'End', 'Change']
    assert 'Start' in info['beforeContent'], (
        f"Expected the Start cell's ::before content to render its data-label, got {info['beforeContent']}"
    )


@pytest.mark.ui
def test_summary_report_tables_keep_normal_table_layout_on_desktop(app_page, account_data):
    """Negative case: the mobile card stacking must not leak into desktop --
    above the breakpoint the compact tables should render as ordinary table
    rows/cells, not flex cards."""
    page = app_page
    create_account(page, account_data)

    page.set_viewport_size({"width": 1280, "height": 800})
    page.evaluate("() => window.app.switchPage('reports')")
    page.wait_for_timeout(300)
    page.click('[data-rptab="summary"]')
    page.wait_for_timeout(400)

    info = page.evaluate("""
        () => {
            const table = document.querySelectorAll('#rptPanel-summary .nw-history-table--compact')[1];
            const row = table.querySelector('tbody tr');
            const cell = row.querySelector('td:nth-child(2)');
            return {
                rowDisplay: getComputedStyle(row).display,
                cellDisplay: getComputedStyle(cell).display,
                beforeContent: getComputedStyle(cell, '::before').content
            };
        }
    """)
    assert info['rowDisplay'] == 'table-row', "Desktop rows should remain normal table rows"
    assert info['cellDisplay'] == 'table-cell', "Desktop cells should remain normal table cells"
    assert info['beforeContent'] in ('none', 'normal', ''), (
        f"Desktop cells should not render a data-label prefix, got {info['beforeContent']}"
    )


@pytest.mark.ui
def test_networth_history_table_still_scrolls_within_wrapper_on_mobile(app_page):
    """Negative/scope-guard test: the wider Net Worth History table (6 data
    columns) must keep its original horizontal-scroll behavior -- it should
    NOT get the .nw-history-table--compact treatment meant for the narrow
    Summary Report tables, since squeezing 6 columns into stacked cards would
    make the date-series harder to scan, not easier."""
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0');
        app.accounts = []; app.incomes = []; app.bills = []; app.debts = [];
        app.expenses = []; app.bonuses = []; app.recurringTemplates = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.monthlySnapshots = [
            { date: `${y}-${m}-15`, netWorth: 12500, totalAssets: 17000, totalLiabilities: 4500 }
        ];
        app.switchPage('reports');
    }""")

    page.set_viewport_size(MOBILE_VIEWPORT)
    page.click('[data-rptab="networth"]')
    page.wait_for_timeout(400)

    info = page.evaluate("""
        () => {
            const table = document.getElementById('netWorthHistoryTable');
            return {
                isCompact: table.classList.contains('nw-history-table--compact'),
                wrapped: !!table.closest('.nw-history-table-wrap'),
                scrollWidth: table.scrollWidth,
                clientWidth: table.parentElement.clientWidth
            };
        }
    """)
    assert not info['isCompact'], "Net Worth History table should keep its wide table layout"
    assert info['wrapped'], "Net Worth History table should still scroll inside its wrapper"
    assert info['scrollWidth'] > info['clientWidth'], (
        "Net Worth History table should still be wider than its wrapper on mobile "
        "(6 columns genuinely need horizontal scroll)"
    )
    _no_page_overflow(page)
    assert_no_errors(page)


@pytest.mark.ui
def test_ledger_table_scrolls_within_wrapper_on_mobile(app_page, account_data):
    """The Ledger table must scroll inside .table-wrapper, not overflow the page."""
    page = app_page
    create_account(page, account_data)

    page.set_viewport_size(MOBILE_VIEWPORT)
    page.evaluate("() => window.app.switchPage('ledger')")
    page.wait_for_timeout(400)

    table = page.query_selector('.ledger-table')
    if table:
        wrapped = page.evaluate(
            "() => !!document.querySelector('.ledger-table').closest('.table-wrapper')"
        )
        assert wrapped, "Expected .ledger-table to be inside a .table-wrapper"
    _no_page_overflow(page)


@pytest.mark.ui
def test_reconcile_expected_table_scrolls_within_wrapper_on_mobile(app_page, account_data):
    """The reconciliation expected-transactions table must scroll inside
    .recon-table-wrap, not overflow the page."""
    page = app_page
    create_account(page, account_data)

    page.set_viewport_size(MOBILE_VIEWPORT)
    page.evaluate("() => window.app.switchPage('reconcile')")
    page.wait_for_timeout(400)

    table = page.query_selector('.recon-expected-table')
    if table:
        wrapped = page.evaluate(
            "() => !!document.querySelector('.recon-expected-table').closest('.recon-table-wrap')"
        )
        assert wrapped, "Expected .recon-expected-table to be inside a .recon-table-wrap"
    _no_page_overflow(page)


@pytest.mark.ui
def test_debt_overview_categories_stack_into_labelled_cards_on_mobile(app_page, debt_data):
    """Regression test for the PWA clipping bug: the Debt Overview card's
    category grid (Category/Debts/Min-mo/Balance) used fixed-px columns
    inside an overflow:hidden card, so the Balance column silently clipped
    on narrow viewports instead of scrolling or restacking. It should now
    restack into labelled cards on mobile, like .var-row and
    .nw-history-table--compact already do elsewhere in this app."""
    page = app_page
    create_debt(page, debt_data)

    page.set_viewport_size(MOBILE_VIEWPORT)
    page.wait_for_timeout(200)

    info = page.evaluate("""
        () => {
            const header = document.querySelector('.debt-overview-cats-header');
            const row = document.querySelector('.debt-overview-cat-row');
            const totalCell = row.querySelector('.debt-overview-cat-total');
            return {
                headerDisplay: getComputedStyle(header).display,
                rowDisplay: getComputedStyle(row).display,
                totalCellDisplay: getComputedStyle(totalCell).display,
                labels: Array.from(row.children).map(c => c.getAttribute('data-label')),
                beforeContent: getComputedStyle(totalCell, '::before').content,
            };
        }
    """)
    assert info['headerDisplay'] == 'none', "Column header row should be hidden once cards restack on mobile"
    assert info['totalCellDisplay'] == 'flex', "Value cells should lay out label/value with flex on mobile"
    assert info['labels'] == [None, 'Debts', 'Min/mo', 'Balance']
    assert 'Balance' in info['beforeContent'], (
        f"Expected the Balance cell's ::before content to render its data-label, got {info['beforeContent']}"
    )
    _no_page_overflow(page)
    assert_no_errors(page)


@pytest.mark.ui
def test_debt_overview_categories_keep_grid_layout_on_desktop(app_page, debt_data):
    """Negative case: the mobile card stacking must not leak into desktop --
    above the breakpoint the category grid should keep its normal grid
    columns, not flex cards."""
    page = app_page
    create_debt(page, debt_data)

    page.set_viewport_size({"width": 1280, "height": 800})
    page.wait_for_timeout(200)

    info = page.evaluate("""
        () => {
            const header = document.querySelector('.debt-overview-cats-header');
            const totalCell = document.querySelector('.debt-overview-cat-total');
            return {
                headerDisplay: getComputedStyle(header).display,
                totalCellDisplay: getComputedStyle(totalCell).display,
                beforeContent: getComputedStyle(totalCell, '::before').content,
            };
        }
    """)
    assert info['headerDisplay'] != 'none', "Column header row should stay visible on desktop"
    assert info['totalCellDisplay'] != 'flex', "Desktop cells should not switch to the mobile flex card layout"
    assert info['beforeContent'] in ('none', 'normal', ''), (
        f"Desktop cells should not render a data-label prefix, got {info['beforeContent']}"
    )


@pytest.mark.ui
def test_account_money_flow_table_stacks_into_labelled_cards_on_mobile(app_page, account_data):
    """Regression test for the same clipping bug in the Reports > Account
    Balances (Money Flow) grid: it should restack into labelled cards on
    mobile instead of relying on fixed-px columns inside an overflow:hidden
    section."""
    page = app_page
    create_account(page, account_data)

    page.set_viewport_size(MOBILE_VIEWPORT)
    page.evaluate("() => window.app.switchPage('reports')")
    page.wait_for_timeout(400)
    # renderReportsPage() only renders the active sub-tab (performance fix,
    # 2026-09-04); Account Balances (Money Flow) isn't the default (Calendar is).
    page.click('[data-rptab="moneyflow"]')
    page.wait_for_timeout(200)

    info = page.evaluate("""
        () => {
            const header = document.querySelector('.acct-mf-header');
            const row = document.querySelector('.acct-mf-row');
            const projCell = row.querySelector('.acct-mf-proj');
            return {
                headerDisplay: getComputedStyle(header).display,
                projCellDisplay: getComputedStyle(projCell).display,
                label: projCell.getAttribute('data-label'),
                beforeContent: getComputedStyle(projCell, '::before').content,
            };
        }
    """)
    assert info['headerDisplay'] == 'none', "Column header row should be hidden once cards restack on mobile"
    assert info['projCellDisplay'] == 'flex', "Value cells should lay out label/value with flex on mobile"
    assert info['label'] == 'Projected'
    assert 'Projected' in info['beforeContent'], (
        f"Expected the Projected cell's ::before content to render its data-label, got {info['beforeContent']}"
    )
    _no_page_overflow(page)
    assert_no_errors(page)


@pytest.mark.ui
def test_account_money_flow_table_keeps_grid_layout_on_desktop(app_page, account_data):
    """Negative case: the mobile card stacking must not leak into desktop --
    above the breakpoint the account money-flow grid should keep its normal
    grid columns, not flex cards."""
    page = app_page
    create_account(page, account_data)

    page.set_viewport_size({"width": 1280, "height": 800})
    page.evaluate("() => window.app.switchPage('reports')")
    page.wait_for_timeout(400)
    page.click('[data-rptab="moneyflow"]')
    page.wait_for_timeout(200)

    info = page.evaluate("""
        () => {
            const header = document.querySelector('.acct-mf-header');
            const projCell = document.querySelector('.acct-mf-proj');
            return {
                headerDisplay: getComputedStyle(header).display,
                projCellDisplay: getComputedStyle(projCell).display,
                beforeContent: getComputedStyle(projCell, '::before').content,
            };
        }
    """)
    assert info['headerDisplay'] != 'none', "Column header row should stay visible on desktop"
    assert info['projCellDisplay'] != 'flex', "Desktop cells should not switch to the mobile flex card layout"
    assert info['beforeContent'] in ('none', 'normal', ''), (
        f"Desktop cells should not render a data-label prefix, got {info['beforeContent']}"
    )
