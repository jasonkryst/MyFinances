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


@pytest.mark.ui
def test_spending_ranked_list_shows_categories(app_page):
    """Ranked list rows show the seeded category names after data is loaded."""
    page = app_page
    _seed_and_navigate(page)

    text = page.evaluate('() => document.getElementById("spendingRankedList")?.textContent || ""')
    assert 'Housing' in text, f"Expected 'Housing' in ranked list, got: {text[:200]}"
    assert 'Food' in text, f"Expected 'Food' in ranked list, got: {text[:200]}"


@pytest.mark.ui
def test_spending_pie_chart_renders(app_page):
    """A canvas element for the pie chart is present after navigating to the Spending tab."""
    page = app_page
    _seed_and_navigate(page)

    canvas = page.query_selector('#rptSpendingPieChart')
    assert canvas, "Expected canvas#rptSpendingPieChart to exist after rendering the Spending tab"
    chart_exists = page.evaluate('() => !!(window.app._rptSpendingPieChart)')
    assert chart_exists, "Expected app._rptSpendingPieChart to be a Chart instance"


@pytest.mark.ui
def test_spending_bar_chart_renders(app_page):
    """A canvas element for the stacked bar chart exists after navigating to Spending tab."""
    page = app_page
    _seed_and_navigate(page)

    canvas = page.query_selector('#rptSpendingBarChart')
    assert canvas, "Expected canvas#rptSpendingBarChart to exist"
    chart_exists = page.evaluate('() => !!(window.app._rptSpendingBarChart)')
    assert chart_exists, "Expected app._rptSpendingBarChart to be a Chart instance"


@pytest.mark.ui
def test_spending_ranked_row_opens_modal(app_page):
    """Clicking a ranked list row opens the drill-down modal showing the category name."""
    page = app_page
    _seed_and_navigate(page)

    row = page.query_selector('[data-spending-cat="Housing"]')
    assert row, "Expected a ranked row for 'Housing'"
    row.click()
    page.wait_for_timeout(200)

    modal_visible = page.is_visible('#spendingDrilldownModal')
    assert modal_visible, "Expected the drill-down modal to be visible after clicking a ranked row"

    title_text = page.evaluate('() => document.getElementById("spendingDrilldownTitle")?.textContent || ""')
    assert 'Housing' in title_text, f"Expected modal title to contain 'Housing', got: {title_text}"


@pytest.mark.ui
def test_spending_modal_shows_transactions(app_page):
    """The drill-down modal body lists the individual transaction names."""
    page = app_page
    _seed_and_navigate(page)

    page.click('[data-spending-cat="Housing"]')
    page.wait_for_timeout(200)

    tx_list = page.evaluate('() => document.querySelector(".spending-modal-tx-list")?.textContent || ""')
    assert 'Rent' in tx_list, f"Expected 'Rent' transaction in modal body, got: {tx_list[:200]}"


@pytest.mark.ui
def test_spending_modal_close_button_dismisses(app_page):
    """Clicking the Close button hides the modal."""
    page = app_page
    _seed_and_navigate(page)

    page.click('[data-spending-cat="Housing"]')
    page.wait_for_timeout(200)
    assert page.is_visible('#spendingDrilldownModal'), "Modal should be visible before closing"

    page.click('#spendingDrilldownClose')
    page.wait_for_timeout(200)
    assert not page.is_visible('#spendingDrilldownModal'), "Modal should be hidden after clicking Close"


@pytest.mark.ui
def test_spending_empty_state_message(app_page):
    """When there is no spending data, an informational message is shown instead of charts."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)
    page.evaluate("""() => {
        const app = window.app;
        app.expenses = []; app.bills = []; app.recurringTemplates = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.incomes = []; app.bonuses = []; app.accounts = [];
        app.ledgerAmountOverrides = {};
        app._reportMonthOffset = 0;
        app.renderReportsPage();
    }""")
    page.click('[data-rptab="spending"]')
    page.wait_for_timeout(300)

    empty = page.query_selector('.spending-empty')
    assert empty, "Expected a .spending-empty element when there is no spending data"
    ranked = page.query_selector('#spendingRankedList')
    assert not ranked, "Expected no ranked list when there is no spending data"
