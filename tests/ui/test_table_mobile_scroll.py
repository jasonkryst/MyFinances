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
