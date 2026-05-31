#!/usr/bin/env python3
"""Focused UI test for Net Worth tracker workflows."""
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:5600/"


def fail(message: str) -> None:
    raise AssertionError(message)


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("dialog", lambda d: d.accept())

        page.goto(BASE_URL, wait_until="networkidle", timeout=60000)

        # Seed account + debt data so net worth has meaningful values.
        page.click('button[data-page="accounts"]')
        page.fill('#accountName', 'NW Checking')
        page.select_option('#accountType', label='Checking')
        page.fill('#accountStartingBalance', '5000')
        page.click('#accountFormSubmit')
        page.wait_for_selector('text=NW Checking', timeout=10000)

        page.click('button[data-page="liabilities"]')
        page.click('[data-liabilities-subtab="debts"]')
        page.click('#debtFormToggle')
        page.fill('#debtName', 'NW Card')
        page.fill('#debtCategory', 'Credit Card')
        page.select_option('#debtType', 'creditCard')
        page.fill('#accountBalance', '2000')
        page.fill('#interestRate', '18')
        page.fill('#minimumPayment', '75')
        page.fill('#dueDate', '10')
        page.select_option('#debtAccount', index=1)
        page.click('#debtFormSubmit')
        page.wait_for_selector('text=NW Card', timeout=10000)

        # Widget should be visible and show net worth text.
        page.click('button[data-page="accounts"]')
        page.wait_for_selector('#netWorthWidget', timeout=10000)
        widget_text = page.text_content('#netWorthWidget') or ''
        if 'Net Worth' not in widget_text:
            fail('Net worth widget text missing')

        # Reports > Net Worth should render and support range toggles.
        page.click('button[data-page="reports"]')
        page.click('button[data-rptab="networth"]')
        page.wait_for_selector('#reportsNetWorth', timeout=10000)
        page.wait_for_selector('#captureSnapshotBtn', timeout=10000)

        tab_text = page.text_content('#reportsNetWorth') or ''
        if 'Net Worth Timeline' not in tab_text:
            fail('Net worth timeline header missing')

        page.click('[data-networth-range="12"]')
        page.wait_for_timeout(300)
        active_12 = page.eval_on_selector('[data-networth-range="12"]', 'el => el.classList.contains("active")')
        if not active_12:
            fail('12M net worth range button did not become active')

        page.click('#captureSnapshotBtn')
        page.wait_for_timeout(500)
        has_trend_canvas = page.query_selector('#rptNetWorthTrendChart') is not None
        has_comp_canvas = page.query_selector('#rptNetWorthCompositionChart') is not None
        if not has_trend_canvas or not has_comp_canvas:
            fail('Net worth chart canvases are missing after snapshot capture')

        history_table = page.query_selector('#netWorthHistoryTable')
        if history_table is None:
            fail('Net worth snapshot history table is missing')

        header_text = page.text_content('#netWorthHistoryTable thead') or ''
        for column in ['Date', 'Assets', 'Liabilities', 'Net Worth', 'Income', 'Debt Paid']:
            if column not in header_text:
                fail(f'Net worth history table missing column: {column}')

        row_count = page.eval_on_selector_all('#netWorthHistoryTable tbody tr', 'rows => rows.length')
        if row_count < 1:
            fail('Net worth history table has no data rows')

        browser.close()

    print('PASS: Net worth widget/report workflow verified.')


if __name__ == '__main__':
    main()
