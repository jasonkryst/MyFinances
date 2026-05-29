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
        page.fill('#accountName', 'Smoke Checking')
        page.select_option('#accountType', label='Checking')
        page.fill('#accountStartingBalance', '1000')
        page.click('#accountFormSubmit')
        page.wait_for_selector('text=Smoke Checking', timeout=10000)

        # Income: add income
        page.click('button[data-page="income"]')
        page.fill('#incomeName', 'Smoke Job')
        page.fill('#incomeAmount', '2000')
        page.fill('#incomeFirstDate', '2026-05-01')
        page.select_option('#incomeFrequency', 'biweekly')
        # Select first real account option
        page.select_option('#incomeAccount', index=1)
        page.click('#incomeFormSubmit')
        page.wait_for_selector('text=Smoke Job', timeout=10000)

        # Debts: add debt
        page.click('button[data-page="debts"]')
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

        # Budget: add bill and expense
        page.click('button[data-page="budget"]')
        page.click('#billFormToggle')
        page.fill('#billName', 'Smoke Electric')
        page.fill('#billAmount', '120')
        page.fill('#billDueDay', '12')
        page.select_option('#billCategory', label='Utilities')
        page.select_option('#billAccount', index=1)
        page.click('#billFormSubmit')
        page.wait_for_selector('text=Smoke Electric', timeout=10000)

        page.click('#expenseFormToggle')
        page.fill('#expenseName', 'Smoke Groceries')
        page.fill('#expenseBudget', '300')
        page.fill('#expenseDate', '2026-05-20')
        page.select_option('#expenseCategory', label='Food & Groceries')
        page.select_option('#expenseAccount', index=1)
        page.click('#expenseFormSubmit')
        page.wait_for_selector('text=Smoke Groceries', timeout=10000)

        # Strategy: calculate plan
        page.click('button[data-page="strategy"]')
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
