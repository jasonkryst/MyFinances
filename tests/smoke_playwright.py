from playwright.sync_api import sync_playwright
import sys
import traceback

BASE_URL = "http://localhost:5600/"


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    sys.exit(1)


def main() -> None:
    console_errors = []
    page_errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        def on_console(msg):
            if msg.type == "error":
                text = msg.text or ""
                if "favicon" in text.lower():
                    return
                console_errors.append(text)

        page.on("console", on_console)
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.on("dialog", lambda d: d.accept())

        page.goto(BASE_URL, wait_until="networkidle", timeout=60000)

        title = page.title()
        if "MyFinances" not in title:
            fail(f"Unexpected title: {title}")

        # Accounts: add account
        page.click('button[data-page="accounts"]')
        page.wait_for_timeout(500)
        page.fill('#accountName', 'Smoke Checking')
        page.select_option('#accountType', label='Checking')
        page.fill('#accountStartingBalance', '1000')
        page.click('#accountFormSubmit')
        page.wait_for_selector('text=Smoke Checking', timeout=10000)

        # Accounts: net worth widget should render (auto snapshot)
        page.wait_for_selector('#netWorthWidget', timeout=10000)
        net_worth_widget_text = page.text_content('#netWorthWidget') or ''
        if 'Net Worth' not in net_worth_widget_text:
            fail('Net worth widget did not render expected content on Accounts page')

        # Income: add income
        page.click('button[data-page="income"]')
        page.wait_for_timeout(500)
        page.fill('#incomeName', 'Smoke Job')
        page.fill('#incomeAmount', '2000')
        page.fill('#incomeFirstDate', '2026-05-01')
        page.select_option('#incomeFrequency', 'biweekly')
        # Select first real account option
        page.select_option('#incomeAccount', index=1)
        page.click('#incomeFormSubmit')
        page.wait_for_selector('text=Smoke Job', timeout=10000)

        # Liabilities (Debts): add debt first
        page.click('button[data-page="liabilities"]')
        page.wait_for_selector('.liabilities-section', timeout=10000)
        # Make sure we're on debts tab
        page.click('[data-liabilities-subtab="debts"]')
        page.wait_for_timeout(300)
        page.click('#debtFormToggle')
        page.fill('#debtName', 'Smoke Card')
        page.fill('#debtCategory', 'Credit Card')
        page.select_option('#debtType', 'creditCard')
        page.fill('#accountBalance', '1500')
        page.fill('#interestRate', '18')
        page.fill('#minimumPayment', '50')
        page.fill('#dueDate', '15')
        page.select_option('#debtAccount', index=1)
        page.click('#debtFormSubmit')
        page.wait_for_selector('text=Smoke Card', timeout=10000)

        # Switch to expenses tab within Liabilities
        page.click('[data-liabilities-subtab="expenses"]')
        page.wait_for_timeout(300)
        page.click('#expenseFormToggle')
        page.wait_for_timeout(300)
        page.fill('#expenseName', 'Smoke Groceries')
        page.fill('#expenseBudget', '300')
        page.fill('#expenseDate', '2026-05-20')
        page.select_option('#expenseCategory', label='Food & Groceries')
        page.select_option('#expenseAccount', index=1)
        page.click('#expenseFormSubmit')
        page.wait_for_selector('text=Smoke Groceries', timeout=10000)

        # Recurring: add recurring template
        page.click('button[data-page="recurring"]')
        page.click('#recurringFormToggle')
        page.fill('#recurringName', 'Smoke Netflix')
        page.select_option('#recurringType', 'subscription')
        page.fill('#recurringAmount', '15.99')
        page.select_option('#recurringFrequency', 'monthly')
        page.fill('#recurringDayOfMonth', '1')
        page.select_option('#recurringCategory', 'Subscription')
        page.select_option('#recurringAccount', index=1)
        page.fill('#recurringStartDate', '2026-05-01')
        page.click('#recurringFormSubmit')
        page.wait_for_selector('text=Smoke Netflix', timeout=10000)

        # Savings: add emergency fund
        page.click('button[data-page="savings"]')
        page.wait_for_selector('.savings-section', timeout=10000)
        # Click emergency fund tab to ensure we're on it
        page.click('[data-savings-subtab="emergency"]')
        page.wait_for_timeout(300)
        # Open the emergency fund form
        page.click('#emergencyFormToggle')
        page.wait_for_timeout(300)
        # Select account (first real account)
        page.select_option('#emergencyAccount', index=1)
        page.fill('#emergencyTarget', '5000')
        page.fill('#emergencyCurrent', '0')
        page.fill('#emergencyContribution', '500')
        page.check('#emergencyAuto')
        page.click('#emergencyFormSubmit')
        page.wait_for_selector('text=Emergency Fund', timeout=10000)

        # Savings: add sinking fund
        page.click('[data-savings-subtab="sinking"]')
        page.wait_for_timeout(300)
        # Open the sinking fund form
        page.click('#sinkingFormToggle')
        page.wait_for_timeout(300)
        page.fill('#sinkingName', 'Smoke Vacation')
        page.select_option('#sinkingAllocationMethod', 'fixed')
        page.wait_for_timeout(200)
        page.fill('#sinkingMonthlyAllocation', '200')
        page.fill('#sinkingCurrentAmount', '0')
        page.select_option('#sinkingAccount', index=1)
        page.check('#sinkingAuto')
        page.click('#sinkingFormSubmit')
        page.wait_for_selector('text=Smoke Vacation', timeout=10000)

        # Verify Savings appears in Reports
        page.click('button[data-page="reports"]')
        page.wait_for_selector('#reportsCalendar', timeout=10000)
        # Check that the calendar loaded
        calendar_content = page.text_content('#reportsCalendar')
        if not calendar_content or len(calendar_content) < 10:
            fail('Reports calendar failed to load content')

        # Test Income vs Expenses tab
        page.click('button[data-rptab="incomeexp"]')
        page.wait_for_selector('#reportsIncomeExp', timeout=10000)

        # Test Money Flow tab
        page.click('button[data-rptab="moneyflow"]')
        page.wait_for_selector('#reportsMoneyFlow', timeout=10000)

        # Test What Changed (Variance Dashboard) tab
        page.click('button[data-rptab="variance"]')
        page.wait_for_selector('#reportsVariance', timeout=10000)
        # Verify variance dashboard loaded
        variance_content = page.text_content('#reportsVariance')
        if not variance_content or 'Month-to-Month' not in variance_content:
            fail('Variance Dashboard failed to load content')

        # Test Net Worth tab
        page.click('button[data-rptab="networth"]')
        page.wait_for_selector('#reportsNetWorth', timeout=10000)
        page.wait_for_selector('#captureSnapshotBtn', timeout=10000)
        page.click('#captureSnapshotBtn')
        page.wait_for_timeout(500)
        net_worth_content = page.text_content('#reportsNetWorth')
        if not net_worth_content or 'Net Worth Timeline' not in net_worth_content:
            fail('Net Worth report failed to render timeline')
        if not page.query_selector('#rptNetWorthTrendChart'):
            fail('Net Worth trend chart canvas not found')
        if not page.query_selector('#netWorthHistoryTable'):
            fail('Net Worth snapshot history table not found')
        history_rows = page.eval_on_selector_all('#netWorthHistoryTable tbody tr', 'rows => rows.length')
        if history_rows < 1:
            fail('Net Worth snapshot history table has no rows')

        # Strategy: calculate plan
        page.click('button[data-page="strategy"]')
        page.wait_for_timeout(500)
        page.fill('#monthlyPayment', '400')
        page.select_option('#paymentStrategy', 'avalanche')
        page.click('#calculateBtn')
        page.wait_for_selector('#resultsSection', state='visible', timeout=15000)

        # Clear all data and verify reset state
        page.click('#clearDataBtn')
        page.wait_for_timeout(500)
        results_display = page.evaluate("""
            () => {
                const el = document.getElementById('resultsSection');
                return el ? getComputedStyle(el).display : 'missing';
            }
        """)
        if results_display != 'none':
            fail(f"resultsSection expected hidden after clear, got: {results_display}")

        if page_errors:
            fail('Page errors found: ' + ' | '.join(page_errors))

        if console_errors:
            fail('Console errors found: ' + ' | '.join(console_errors))

        browser.close()

    print('PASS: Automated smoke flow completed with no console/page errors.')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('FAIL: Unhandled exception during smoke run')
        print(str(exc))
        traceback.print_exc()
        sys.exit(1)
