import pytest

from tests.conftest import current_month_iso

def _seed_and_navigate(page):
    """Seed spending data and open the Spending tab."""
    page.click('button[data-page="reports"]')
    page.wait_for_selector('#reportsSection.active', timeout=5000)
    page.evaluate("""(dates) => {
        const app = window.app;
        app.expenses = [
            { id: 9001, name: 'Rent', category: 'Housing', budgetAmount: 950, date: dates.rent, accountId: null },
            { id: 9002, name: 'Groceries', category: 'Food', budgetAmount: 180, date: dates.groceries, accountId: null }
        ];
        app.bills = []; app.recurringTemplates = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.incomes = []; app.bonuses = []; app.accounts = [];
        app.ledgerAmountOverrides = {};
        app._reportMonthOffset = 0;
        app.renderReportsPage();
    }""", {"rent": current_month_iso(1), "groceries": current_month_iso(10)})
    page.click('[data-rptab="spending"]')
    page.wait_for_selector('#rptPanel-spending.rpt-tab-panel--active', timeout=5000)


@pytest.mark.ui
def test_spending_tab_exists_and_navigates(app_page):
    """Spending tab button exists and clicking it makes its panel visible."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_selector('#reportsSection.active', timeout=5000)

    btn = page.query_selector('[data-rptab="spending"]')
    assert btn, "Expected a spending tab button with data-rptab='spending'"

    btn.click()

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

    tx_list = page.evaluate('() => document.querySelector(".spending-modal-tx-list")?.textContent || ""')
    assert 'Rent' in tx_list, f"Expected 'Rent' transaction in modal body, got: {tx_list[:200]}"


@pytest.mark.ui
def test_spending_modal_close_button_dismisses(app_page):
    """Clicking the Close button hides the modal."""
    page = app_page
    _seed_and_navigate(page)

    page.click('[data-spending-cat="Housing"]')
    assert page.is_visible('#spendingDrilldownModal'), "Modal should be visible before closing"

    page.click('#spendingDrilldownClose')
    assert not page.is_visible('#spendingDrilldownModal'), "Modal should be hidden after clicking Close"


@pytest.mark.ui
def test_spending_ranked_row_has_accessible_affordance(app_page):
    """Each ranked row has role=button, tabindex=0, aria-label mentioning 'transactions',
    and a visible chevron affordance element."""
    page = app_page
    _seed_and_navigate(page)

    row = page.query_selector('[data-spending-cat="Housing"]')
    assert row, "Expected a ranked row for Housing"
    assert row.get_attribute('role') == 'button', "Row should have role=button"
    assert row.get_attribute('tabindex') == '0', "Row should be keyboard-focusable"
    aria = row.get_attribute('aria-label') or ''
    assert 'transactions' in aria.lower(), f"aria-label should mention 'transactions', got: {aria}"

    chevron = row.query_selector('.spending-ranked-chevron')
    assert chevron, "Expected .spending-ranked-chevron inside the ranked row"


@pytest.mark.ui
def test_spending_ranked_row_keyboard_enter_opens_modal(app_page):
    """Pressing Enter on a focused ranked row opens the drill-down modal."""
    page = app_page
    _seed_and_navigate(page)

    row = page.query_selector('[data-spending-cat="Housing"]')
    assert row, "Expected a ranked row for Housing"
    row.focus()
    page.keyboard.press('Enter')

    assert page.is_visible('#spendingDrilldownModal'), "Modal should open on Enter keypress"
    title = page.evaluate('() => document.getElementById("spendingDrilldownTitle")?.textContent || ""')
    assert 'Housing' in title


@pytest.mark.ui
def test_spending_ranked_row_keyboard_space_opens_modal(app_page):
    """Pressing Space on a focused ranked row opens the drill-down modal."""
    page = app_page
    _seed_and_navigate(page)

    row = page.query_selector('[data-spending-cat="Food"]')
    assert row, "Expected a ranked row for Food"
    row.focus()
    page.keyboard.press(' ')

    assert page.is_visible('#spendingDrilldownModal'), "Modal should open on Space keypress"


@pytest.mark.ui
def test_spending_modal_close_button_has_aria_label(app_page):
    """The drill-down modal close button has aria-label='Close drill-down'."""
    page = app_page
    _seed_and_navigate(page)

    page.click('[data-spending-cat="Housing"]')
    assert page.is_visible('#spendingDrilldownModal')

    close_btn = page.query_selector('#spendingDrilldownClose')
    assert close_btn, "Expected #spendingDrilldownClose button"
    label = close_btn.get_attribute('aria-label') or ''
    assert 'close' in label.lower(), f"Close button should have aria-label containing 'close', got: {label}"


@pytest.mark.ui
def test_spending_modal_focus_on_open(app_page):
    """Focus moves into the drill-down modal when it opens."""
    page = app_page
    _seed_and_navigate(page)

    page.click('[data-spending-cat="Housing"]')
    assert page.is_visible('#spendingDrilldownModal')

    focused_id = page.evaluate("""() => {
        const el = document.activeElement;
        return el ? (el.id || el.className || el.tagName) : 'none';
    }""")
    modal_contains_focus = page.evaluate("""() => {
        const modal = document.getElementById('spendingDrilldownModal');
        return modal ? modal.contains(document.activeElement) : false;
    }""")
    assert modal_contains_focus, f"Focus should be inside the modal, got active element: {focused_id}"


@pytest.mark.ui
def test_spending_modal_escape_closes(app_page):
    """Pressing Escape while the drill-down modal is open closes it."""
    page = app_page
    _seed_and_navigate(page)

    page.click('[data-spending-cat="Housing"]')
    assert page.is_visible('#spendingDrilldownModal')

    page.keyboard.press('Escape')
    assert not page.is_visible('#spendingDrilldownModal'), "Escape should dismiss the modal"


@pytest.mark.ui
def test_spending_modal_focus_returns_to_trigger_on_close(app_page):
    """After closing the drill-down modal, focus returns to the row that triggered it."""
    page = app_page
    _seed_and_navigate(page)

    row = page.query_selector('[data-spending-cat="Housing"]')
    row.focus()
    page.keyboard.press('Enter')
    assert page.is_visible('#spendingDrilldownModal')

    page.click('#spendingDrilldownClose')
    assert not page.is_visible('#spendingDrilldownModal')

    trigger_is_focused = page.evaluate("""() => {
        const row = document.querySelector('[data-spending-cat="Housing"]');
        return row === document.activeElement;
    }""")
    assert trigger_is_focused, "Focus should return to the triggering ranked row after modal closes"


@pytest.mark.ui
def test_spending_empty_state_message(app_page):
    """When there is no spending data, an informational message is shown instead of charts."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_selector('#reportsSection.active', timeout=5000)
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
    page.wait_for_selector('#rptPanel-spending.rpt-tab-panel--active', timeout=5000)

    empty = page.query_selector('.spending-empty')
    assert empty, "Expected a .spending-empty element when there is no spending data"
    ranked = page.query_selector('#spendingRankedList')
    assert not ranked, "Expected no ranked list when there is no spending data"


# ── #332 Year-over-year comparison toggle ────────────────────────────────────

def _seed_yoy_and_navigate(page, this_year_amount=220, last_year_amount=100):
    """Seed a Food category expense in the current report month and an
    expense for the SAME category one year prior, so YoY comparison has a
    non-null baseline to compare against."""
    page.click('button[data-page="reports"]')
    page.wait_for_selector('#reportsSection.active', timeout=5000)
    page.evaluate("""(args) => {
        const app = window.app;
        const now = new Date();
        const thisYearDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-10`;
        const lastYearDate = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, '0')}-10`;
        app.expenses = [
            { id: 9101, name: 'Groceries', category: 'Food', budgetAmount: args.thisYear, date: thisYearDate, accountId: null },
            { id: 9102, name: 'Groceries LY', category: 'Food', budgetAmount: args.lastYear, date: lastYearDate, accountId: null }
        ];
        app.bills = []; app.recurringTemplates = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.incomes = []; app.bonuses = []; app.accounts = [];
        app.ledgerAmountOverrides = {};
        app._reportMonthOffset = 0;
        app._spendingYoYMode = false;
        app.renderReportsPage();
    }""", {"thisYear": this_year_amount, "lastYear": last_year_amount})
    page.click('[data-rptab="spending"]')
    page.wait_for_selector('#rptPanel-spending.rpt-tab-panel--active', timeout=5000)


@pytest.mark.ui
def test_spending_comparison_mode_select_present_and_defaults_to_month(app_page):
    """The comparison-mode toggle exists and defaults to 'vs. last month'."""
    page = app_page
    _seed_yoy_and_navigate(page)

    select = page.query_selector('#spendingComparisonMode')
    assert select, "Expected #spendingComparisonMode select in the summary strip"
    value = page.eval_on_selector('#spendingComparisonMode', 'el => el.value')
    assert value == 'month'


@pytest.mark.ui
def test_spending_switching_to_yoy_mode_changes_badge_baseline(app_page):
    """Selecting 'vs. same month last year' recomputes the Food category's
    badge against last year's total instead of last month's."""
    page = app_page
    # This month: $220 Food. Last year same month: $100 Food (prior calendar
    # month is seeded empty by _seed_yoy_and_navigate, so the month-mode
    # badge is null while the YoY badge is +120%).
    _seed_yoy_and_navigate(page, this_year_amount=220, last_year_amount=100)

    row = page.query_selector('[data-spending-cat="Food"]')
    month_mode_badge = row.query_selector('.spending-ranked-change--up, .spending-ranked-change--down')
    assert month_mode_badge is None, "Expected no badge in month mode (no prior-month data seeded)"

    page.select_option('#spendingComparisonMode', 'year')
    page.wait_for_selector('#spendingComparisonMode', timeout=5000)

    row = page.query_selector('[data-spending-cat="Food"]')
    yoy_badge = row.query_selector('.spending-ranked-change--up')
    assert yoy_badge, "Expected an 'up' badge comparing $220 this year vs $100 last year"
    assert '120%' in yoy_badge.inner_text()

    select_value = page.eval_on_selector('#spendingComparisonMode', 'el => el.value')
    assert select_value == 'year'


@pytest.mark.ui
def test_spending_yoy_badge_hidden_when_no_prior_year_data(app_page):
    """A category with no spending in the same month last year shows no
    badge in YoY mode, rather than a misleading 0%/division-by-zero result."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_selector('#reportsSection.active', timeout=5000)
    page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        const thisYearDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-10`;
        // Only this year's record is seeded -- nothing exists for the prior-year month.
        app.expenses = [{ id: 9101, name: 'Groceries', category: 'Food', budgetAmount: 220, date: thisYearDate, accountId: null }];
        app.bills = []; app.recurringTemplates = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.incomes = []; app.bonuses = []; app.accounts = [];
        app.ledgerAmountOverrides = {};
        app._reportMonthOffset = 0;
        app._spendingYoYMode = false;
        app.renderReportsPage();
    }""")
    page.click('[data-rptab="spending"]')
    page.wait_for_selector('#rptPanel-spending.rpt-tab-panel--active', timeout=5000)

    page.select_option('#spendingComparisonMode', 'year')
    page.wait_for_selector('#spendingComparisonMode', timeout=5000)

    row = page.query_selector('[data-spending-cat="Food"]')
    badge = row.query_selector('.spending-ranked-change--up, .spending-ranked-change--down')
    assert badge is None, "Expected no YoY badge when there is no prior-year data for this category"


@pytest.mark.ui
def test_spending_comparison_mode_persists_across_rerender(app_page):
    """Switching to YoY mode stays selected when the panel re-renders
    (e.g. after navigating away and back to the Spending tab)."""
    page = app_page
    _seed_yoy_and_navigate(page)

    page.select_option('#spendingComparisonMode', 'year')
    page.wait_for_selector('#spendingComparisonMode', timeout=5000)

    page.click('[data-rptab="calendar"]')
    page.wait_for_selector('#rptPanel-calendar.rpt-tab-panel--active', timeout=5000)
    page.click('[data-rptab="spending"]')
    page.wait_for_selector('#rptPanel-spending.rpt-tab-panel--active', timeout=5000)

    value = page.eval_on_selector('#spendingComparisonMode', 'el => el.value')
    assert value == 'year'


# ── Spending -> Ledger cross-navigation (#315) ──────────────────────────────────

def _seed_linked_and_navigate(page):
    """Like _seed_and_navigate, but links the expense to a real account —
    the Ledger only shows account-linked transactions (unlinked ones are
    excluded from getLedgerTransactions by design), so the cross-nav tests
    need a seed that will actually appear there."""
    page.click('button[data-page="reports"]')
    page.wait_for_selector('#reportsSection.active', timeout=5000)
    page.evaluate("""(dates) => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        app.expenses = [
            { id: 9001, name: 'Rent', category: 'Housing', budgetAmount: 950, date: dates.rent, accountId: 1 },
            { id: 9002, name: 'Groceries', category: 'Food', budgetAmount: 180, date: dates.groceries, accountId: 1 }
        ];
        app.bills = []; app.recurringTemplates = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.incomes = []; app.bonuses = [];
        app.ledgerAmountOverrides = {};
        app._reportMonthOffset = 0;
        app.renderReportsPage();
    }""", {"rent": current_month_iso(1), "groceries": current_month_iso(10)})
    page.click('[data-rptab="spending"]')
    page.wait_for_selector('#rptPanel-spending.rpt-tab-panel--active', timeout=5000)


@pytest.mark.ui
def test_spending_drilldown_view_in_ledger_navigates_with_category_filter(app_page):
    """Positive: clicking 'View in Ledger' from a category's drill-down
    modal lands on the Ledger page with that category pre-selected in the
    Category filter, and shows a 'Back to Spending' breadcrumb."""
    page = app_page
    _seed_linked_and_navigate(page)

    page.click('[data-spending-cat="Food"]')
    page.wait_for_selector('#spendingDrilldownModal:not(.hidden)', timeout=5000)
    page.click('#spendingDrilldownViewLedgerBtn')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)

    assert page.eval_on_selector('#ledgerCategoryFilter', 'el => el.value') == 'Food'
    assert page.is_visible('.ledger-crossnav-banner')


@pytest.mark.ui
def test_spending_drilldown_view_in_ledger_back_button_returns_to_spending(app_page):
    """Positive: the breadcrumb's 'Back to Spending' button returns to the
    Reports page with the Spending sub-tab active again."""
    page = app_page
    _seed_linked_and_navigate(page)

    page.click('[data-spending-cat="Food"]')
    page.wait_for_selector('#spendingDrilldownModal:not(.hidden)', timeout=5000)
    page.click('#spendingDrilldownViewLedgerBtn')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)

    page.click('#ledgerCrossNavBackBtn')
    page.wait_for_selector('#reportsSection.active', timeout=5000)
    assert page.get_attribute('[data-rptab="spending"]', 'aria-selected') == 'true'


@pytest.mark.ui
def test_spending_drilldown_view_in_ledger_does_not_clobber_saved_account_filter(app_page):
    """Regression (review finding #1): if the user had already saved a
    non-default Ledger account/date filter earlier this session, cross-
    navigating from Spending must not let renderLedgerPage's restore-from-
    storage overwrite the cross-nav's 'all'/'all' override back to the
    stale saved values — the Category filter and 'all' overrides must win."""
    page = app_page
    _seed_linked_and_navigate(page)

    page.evaluate("""() => {
        localStorage.setItem('debtTrackerLedgerFilters', JSON.stringify({
            accountFilter: '1', dateRange: '30', clearedFilter: 'all',
            pageSize: 25, categoryFilter: 'all'
        }));
    }""")

    page.click('[data-spending-cat="Food"]')
    page.wait_for_selector('#spendingDrilldownModal:not(.hidden)', timeout=5000)
    page.click('#spendingDrilldownViewLedgerBtn')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)

    assert page.eval_on_selector('#ledgerCategoryFilter', 'el => el.value') == 'Food'
    assert page.eval_on_selector('#ledgerAccountFilter', 'el => el.value') == 'all'
    assert page.eval_on_selector('#ledgerDateRange', 'el => el.value') == 'all'


@pytest.mark.ui
def test_spending_drilldown_view_in_ledger_does_not_overwrite_saved_filters_on_save(app_page):
    """Regression (review finding #3): touching an unrelated filter control
    (page size) while viewing a cross-nav'd category must not persist the
    cross-nav's 'all'/'all' account/date override over the account/date the
    user had deliberately saved before cross-navigating."""
    page = app_page
    _seed_linked_and_navigate(page)

    page.evaluate("""() => {
        localStorage.setItem('debtTrackerLedgerFilters', JSON.stringify({
            accountFilter: '1', dateRange: '30', clearedFilter: 'all',
            pageSize: 25, categoryFilter: 'all'
        }));
    }""")

    page.click('[data-spending-cat="Food"]')
    page.wait_for_selector('#spendingDrilldownModal:not(.hidden)', timeout=5000)
    page.click('#spendingDrilldownViewLedgerBtn')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)

    page.select_option('#ledgerPageSize', '50')
    page.wait_for_timeout(200)

    saved = page.evaluate("() => JSON.parse(localStorage.getItem('debtTrackerLedgerFilters'))")
    assert saved['accountFilter'] == '1', f"Cross-nav override leaked into saved filters: {saved}"
    assert saved['dateRange'] == '30', f"Cross-nav override leaked into saved filters: {saved}"
    assert saved['pageSize'] == 50


@pytest.mark.ui
def test_spending_drilldown_back_button_restores_pre_cross_nav_account_and_date(app_page):
    """Regression: 'Back to Spending' must restore the account/date filters
    that were active before the cross-nav, not leave them stuck at 'all'."""
    page = app_page
    _seed_linked_and_navigate(page)

    page.evaluate("""() => {
        localStorage.setItem('debtTrackerLedgerFilters', JSON.stringify({
            accountFilter: '1', dateRange: '30', clearedFilter: 'all',
            pageSize: 25, categoryFilter: 'all'
        }));
    }""")

    page.click('[data-spending-cat="Food"]')
    page.wait_for_selector('#spendingDrilldownModal:not(.hidden)', timeout=5000)
    page.click('#spendingDrilldownViewLedgerBtn')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)

    page.click('#ledgerCrossNavBackBtn')
    page.wait_for_selector('#reportsSection.active', timeout=5000)

    page.click('button[data-page="ledger"]')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)
    assert page.eval_on_selector('#ledgerAccountFilter', 'el => el.value') == '1'
    assert page.eval_on_selector('#ledgerDateRange', 'el => el.value') == '30'


@pytest.mark.ui
def test_spending_drilldown_debt_payments_has_no_view_in_ledger_link(app_page):
    """Negative (review finding #2): the synthetic 'Debt Payments' Spending
    category has no matching Ledger category (debt rows there use the
    debt's own name) — the 'View in Ledger' link would always land on an
    empty filtered table, so it must not be offered for this category."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_selector('#reportsSection.active', timeout=5000)
    page.evaluate("""(date) => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        app.debts = [{ id: 1, name: 'Visa', debtType: 'creditCard', accountBalance: 500,
            interestRate: 20, minimumPayment: 50, dueDate: 5, accountId: 1 }];
        app.expenses = []; app.bills = []; app.recurringTemplates = [];
        app.emergencyFunds = []; app.sinkingFunds = []; app.incomes = []; app.bonuses = [];
        app.ledgerAmountOverrides = {};
        app._reportMonthOffset = 0;
        app.renderReportsPage();
    }""", current_month_iso(5))
    page.click('[data-rptab="spending"]')
    page.wait_for_selector('#rptPanel-spending.rpt-tab-panel--active', timeout=5000)

    cat_el = page.query_selector('[data-spending-cat="Debt Payments"]')
    if not cat_el:
        pytest.skip("No Debt Payments category rendered for this seed")
    cat_el.click()
    page.wait_for_selector('#spendingDrilldownModal:not(.hidden)', timeout=5000)
    assert page.query_selector('#spendingDrilldownViewLedgerBtn') is None


@pytest.mark.ui
def test_ledger_category_filter_persists_across_navigation(app_page):
    """Positive/regression: manually picking a category filter survives
    navigating away and back, like the existing account/date/cleared filters."""
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        app.bills = [{ id: 30, name: 'Internet', amount: 60, category: 'Utilities', dueDay: 5, accountId: 1 }];
        app.expenses = []; app.incomes = []; app.debts = []; app.bonuses = []; app.recurringTemplates = [];
    }""")
    page.click('button[data-page="ledger"]')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)

    options = page.eval_on_selector_all('#ledgerCategoryFilter option', 'opts => opts.map(o => o.value)')
    non_all = [o for o in options if o and o != 'all']
    if not non_all:
        pytest.skip("No non-'all' category options to select")

    page.select_option('#ledgerCategoryFilter', non_all[0])
    page.wait_for_timeout(300)
    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)
    page.click('button[data-page="ledger"]')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)

    assert page.eval_on_selector('#ledgerCategoryFilter', 'el => el.value') == non_all[0]
