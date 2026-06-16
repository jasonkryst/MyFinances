import pytest

def _seed_and_navigate(page):
    """Seed spending data and open the Spending tab."""
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)
    page.evaluate("""() => {
        const app = window.app;
        app.expenses = [
            { id: 9001, name: 'Rent', category: 'Housing', budgetAmount: 950, date: '2026-06-01', accountId: null },
            { id: 9002, name: 'Groceries', category: 'Food', budgetAmount: 180, date: '2026-06-10', accountId: null }
        ];
        app.bills = []; app.recurringTemplates = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.incomes = []; app.bonuses = []; app.accounts = [];
        app.ledgerAmountOverrides = {};
        app._reportMonthOffset = 0;
        app.renderReportsPage();
    }""")
    page.click('[data-rptab="spending"]')
    page.wait_for_timeout(300)


@pytest.mark.ui
def test_spending_tab_exists_and_navigates(app_page):
    """Spending tab button exists and clicking it makes its panel visible."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    btn = page.query_selector('[data-rptab="spending"]')
    assert btn, "Expected a spending tab button with data-rptab='spending'"

    btn.click()
    page.wait_for_timeout(200)

    is_active = page.evaluate('() => document.getElementById("rptPanel-spending")?.classList.contains("rpt-tab-panel--active")')
    assert is_active, "Expected #rptPanel-spending to have class rpt-tab-panel--active after clicking the tab"
