#!/usr/bin/env python3
"""
Financial Health Dashboard Tests
Tests the metric cards: DTI, savings rate, emergency fund coverage,
debt payoff timeline, monthly cash flow, budget allocation, credit utilization,
and surplus analysis.
"""

import pytest

BASE_URL = "http://localhost:32900/"


# ── Navigation ─────────────────────────────────────────────────────────────────

@pytest.mark.feature
def test_health_navigation(app_page):
    """Health page loads and renders the dashboard section."""
    page = app_page

    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)

    section = page.query_selector('#healthSection')
    assert section, "healthSection not found after navigation"

    content = section.evaluate('(el) => el.innerHTML.length')
    assert content > 0, "Health dashboard rendered empty content"


@pytest.mark.feature
def test_health_renders_metric_cards(app_page):
    """All metric cards are present in the dashboard (7 standard + 1 surplus analysis)."""
    page = app_page

    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)

    cards = page.query_selector_all('.health-metric-card')
    assert len(cards) == 10, f"Expected 10 metric cards (8 standard + interest burden + debt-to-asset + surplus analysis), found {len(cards)}"


# ── DTI card ───────────────────────────────────────────────────────────────────

@pytest.mark.feature
def test_health_dti_card_renders(app_page):
    """DTI card shows a gauge canvas and a badge."""
    page = app_page

    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)

    gauge = page.query_selector('#healthDtiGauge')
    assert gauge, "DTI gauge canvas not found"

    gauge_value = page.query_selector('.health-gauge-value')
    assert gauge_value, "DTI gauge value element not found"

    value_text = gauge_value.text_content()
    assert '%' in value_text, f"Gauge value should include %, got: {value_text}"


@pytest.mark.feature
def test_health_dti_healthy_with_no_debt(app_page):
    """DTI badge shows Healthy when there are no debts."""
    page = app_page

    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)

    section = page.query_selector('#healthSection')
    section_text = section.text_content()

    # With no debt the ratio is 0 — should be Healthy
    assert 'Healthy' in section_text, "Expected Healthy DTI badge with no debts"


@pytest.mark.feature
def test_health_dti_high_risk_with_large_debt(app_page):
    """DTI badge shows High Risk when debt payments exceed 40% of income."""
    page = app_page

    # Inject state directly: income $1 000, min payments $500 → 50% DTI
    page.evaluate("""() => {
        const app = window.app;
        app.incomes = [{ id: 1, name: 'Salary', amount: 1000,
                         firstPayDate: '2026-06-01', frequency: 'monthly' }];
        app.debts = [{ id: 2, name: 'BigDebt', accountBalance: 50000,
                       originalBalance: 50000, minimumPayment: 500,
                       interestRate: 18, dueDate: 15, debtType: 'creditCard' }];
        app.bills = []; app.expenses = []; app.recurringTemplates = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('health');
    }""")

    section = page.query_selector('#healthSection')
    section_text = section.text_content()
    assert 'High Risk' in section_text, "Expected High Risk badge with 50% DTI"


# ── Savings Rate card ──────────────────────────────────────────────────────────

@pytest.mark.feature
def test_health_savings_rate_card_renders(app_page):
    """Savings rate card shows a gauge canvas and badge."""
    page = app_page

    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)

    gauge = page.query_selector('#healthSavingsGauge')
    assert gauge, "Savings gauge canvas not found"


@pytest.mark.feature
def test_health_savings_rate_low_with_no_contributions(app_page):
    """Savings rate shows Low when no emergency/sinking funds are configured."""
    page = app_page

    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)

    section = page.query_selector('#healthSection')
    section_text = section.text_content()
    assert 'Low' in section_text, "Expected Low savings badge with no fund contributions"


# ── Emergency Fund card ────────────────────────────────────────────────────────

@pytest.mark.feature
def test_health_emergency_fund_empty_state(app_page):
    """Emergency fund card shows an empty state when no funds exist."""
    page = app_page

    # Ensure no emergency funds
    page.evaluate("""() => {
        window.app.emergencyFunds = [];
        window.app.switchPage('health');
    }""")

    section = page.query_selector('#healthSection')
    section_text = section.text_content()
    assert 'No emergency funds' in section_text, \
        "Expected empty-state message when no emergency funds exist"


@pytest.mark.feature
def test_health_emergency_fund_shows_coverage(app_page):
    """Emergency fund card shows month coverage when a fund is configured."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 9001, name: 'E-Fund Account', type: 'Savings', startingBalance: 0 }];
        app.emergencyFunds = [{
            id: 9002, name: 'Rainy Day', accountId: 9001,
            currentAmount: 6000, targetAmount: 12000, monthlyContribution: 200
        }];
        app.bills = []; app.expenses = []; app.debts = []; app.incomes = [];
        app.switchPage('health');
    }""")

    section = page.query_selector('#healthSection')
    section_text = section.text_content()
    # Should show coverage in months (or the account name)
    assert 'E-Fund Account' in section_text or 'mo' in section_text, \
        "Expected fund coverage details in emergency fund card"


# ── Debt Payoff Timeline card ──────────────────────────────────────────────────

@pytest.mark.feature
def test_health_timeline_debt_free_state(app_page):
    """Debt timeline card shows Debt Free when there are no debts."""
    page = app_page

    page.evaluate("""() => {
        window.app.debts = [];
        window.app.switchPage('health');
    }""")

    section = page.query_selector('#healthSection')
    section_text = section.text_content()
    assert 'Debt Free' in section_text, "Expected Debt Free message with no debts"


@pytest.mark.feature
def test_health_timeline_shows_years_with_debt(app_page):
    """Debt timeline shows years and a payoff date when debts exist."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.debts = [{
            id: 1, name: 'Loan', accountBalance: 10000, originalBalance: 10000,
            interestRate: 5, minimumPayment: 300, dueDate: 1,
            debtType: 'creditCard', priority: 1
        }];
        app.switchPage('health');
    }""")

    section = page.query_selector('#healthSection')
    section_text = section.text_content()
    assert 'years' in section_text.lower(), \
        "Expected years estimate in debt timeline card"


# ── Cash Flow card ─────────────────────────────────────────────────────────────

@pytest.mark.feature
def test_health_cash_flow_break_even_with_no_data(app_page):
    """Cash flow card shows Break Even when income and outflow are both zero."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.incomes = []; app.debts = []; app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('health');
    }""")

    section = page.query_selector('#healthSection')
    section_text = section.text_content()
    assert 'Break Even' in section_text, "Expected Break Even with zero income and outflow"


@pytest.mark.feature
def test_health_cash_flow_surplus(app_page):
    """Cash flow card shows Surplus when income exceeds all outflows."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.incomes = [{ id: 1, name: 'Job', amount: 5000,
                         firstPayDate: '2026-06-01', frequency: 'monthly' }];
        app.debts = [{ id: 2, name: 'CC', accountBalance: 1000, originalBalance: 1000,
                       minimumPayment: 50, interestRate: 18, dueDate: 15, debtType: 'creditCard' }];
        app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('health');
    }""")

    section = page.query_selector('#healthSection')
    section_text = section.text_content()
    assert 'Surplus' in section_text, "Expected Surplus badge when income > outflow"


@pytest.mark.feature
def test_health_cash_flow_deficit(app_page):
    """Cash flow card shows Deficit when outflows exceed income."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.incomes = [{ id: 1, name: 'PartTime', amount: 500,
                         firstPayDate: '2026-06-01', frequency: 'monthly' }];
        app.debts = [{ id: 2, name: 'Loans', accountBalance: 50000, originalBalance: 50000,
                       minimumPayment: 2000, interestRate: 5, dueDate: 10, debtType: 'creditCard' }];
        app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('health');
    }""")

    section = page.query_selector('#healthSection')
    section_text = section.text_content()
    assert 'Deficit' in section_text, "Expected Deficit badge when outflow > income"


# ── Budget Allocation card ─────────────────────────────────────────────────────

@pytest.mark.feature
def test_health_budget_allocation_empty_state(app_page):
    """Budget allocation shows an empty state when there is no income or expenses."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.incomes = []; app.bills = []; app.expenses = [];
        app.debts = []; app.recurringTemplates = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('health');
    }""")

    section = page.query_selector('#healthSection')
    section_text = section.text_content()
    assert 'Add income and expenses' in section_text, \
        "Expected empty-state message in budget allocation card"


@pytest.mark.feature
def test_health_budget_allocation_shows_categories(app_page):
    """Budget allocation renders category rows when bills exist."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.incomes = [{ id: 1, name: 'Salary', amount: 4000,
                         firstPayDate: '2026-06-01', frequency: 'monthly' }];
        app.bills = [
            { id: 10, name: 'Mortgage', amount: 1200, dueDay: 1, category: 'Housing' },
            { id: 11, name: 'Power',    amount: 150,  dueDay: 15, category: 'Utilities' }
        ];
        app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('health');
    }""")

    rows = page.query_selector_all('.health-budget-row')
    assert len(rows) >= 2, f"Expected at least 2 budget category rows, got {len(rows)}"

    section_text = page.query_selector('#healthSection').text_content()
    assert 'Housing' in section_text, "Housing category not shown in budget allocation"
    assert 'Utilities' in section_text, "Utilities category not shown in budget allocation"


# ── Internal navigation links ──────────────────────────────────────────────────

@pytest.mark.feature
def test_health_nav_link_to_savings(app_page):
    """'Set up emergency fund' link navigates to the savings page."""
    page = app_page

    page.evaluate("""() => {
        window.app.emergencyFunds = [];
        window.app.switchPage('health');
    }""")

    savings_link = page.query_selector('[data-health-nav="savings"]')
    assert savings_link, "No savings navigation link found on health page"

    savings_link.click()

    savings_section = page.query_selector('#savingsSection')
    assert savings_section and savings_section.evaluate('(el) => el.offsetParent !== null'), \
        "Clicking savings nav link should show savings section"


@pytest.mark.feature
def test_health_nav_link_to_strategy(app_page):
    """'Go to Plan' link navigates to the strategy page."""
    page = app_page

    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)

    strategy_link = page.query_selector('[data-health-nav="strategy"]')
    assert strategy_link, "No strategy navigation link found on health page"

    strategy_link.click()

    strategy_section = page.query_selector('#strategySection')
    assert strategy_section and strategy_section.evaluate('(el) => el.offsetParent !== null'), \
        "Clicking strategy nav link should show strategy section"


# ── No errors ──────────────────────────────────────────────────────────────────

@pytest.mark.feature
def test_health_no_console_errors(app_page):
    """Health dashboard renders without any JavaScript errors."""
    page = app_page

    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)

    filtered_errors = [
        e for e in (page.console_errors if hasattr(page, 'console_errors') else [])
        if 'favicon' not in e.lower()
    ]
    assert len(filtered_errors) == 0, f"Console errors on health page: {filtered_errors}"


# ── Credit Utilization card ────────────────────────────────────────────────────


def _inject_util_state(page, balance, credit_limit):
    """Inject a single credit-card debt with given balance and credit limit."""
    page.evaluate(f"""() => {{
        const app = window.app;
        app.incomes = [];
        app.debts = [{{
            id: 8001, name: 'Visa', debtType: 'creditCard',
            accountBalance: {balance}, originalBalance: {credit_limit},
            interestRate: 20, minimumPayment: 25, dueDate: 15,
            creditLimit: {credit_limit},
            debtStartDate: null, fixedAmount: 0, fixedStartDate: null,
            fixedEndDate: null, updatedAt: null, priority: null,
            accountId: null, archived: false
        }}];
        app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('health');
    }}""")
    page.wait_for_selector('#healthCreditUtilCard', timeout=5000)


@pytest.mark.feature
def test_health_credit_util_card_present(app_page):
    """Credit utilization card (#healthCreditUtilCard) is always rendered."""
    page = app_page
    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)

    card = page.query_selector('#healthCreditUtilCard')
    assert card, "Credit utilization card not found in health dashboard"


@pytest.mark.feature
def test_health_credit_util_empty_state_when_no_limits(app_page):
    """Credit utilization card shows empty state when no credit cards have a limit set."""
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        app.debts = [{ id: 1, name: 'Visa', debtType: 'creditCard',
                       accountBalance: 500, originalBalance: 500,
                       interestRate: 20, minimumPayment: 25, dueDate: 15,
                       creditLimit: null, archived: false }];
        app.incomes = []; app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('health');
    }""")
    page.wait_for_selector('#healthCreditUtilCard', timeout=5000)

    card_text = page.query_selector('#healthCreditUtilCard').text_content()
    assert 'No credit limits set' in card_text, \
        f"Expected empty-state message when no limits, got: {card_text[:200]}"


@pytest.mark.feature
def test_health_credit_util_good(app_page):
    """≤10% aggregate utilization shows 'Good' badge."""
    page = app_page
    _inject_util_state(page, balance=80, credit_limit=1000)  # 8%

    card_text = page.query_selector('#healthCreditUtilCard').text_content()
    assert 'Good' in card_text, f"Expected 'Good' at 8% utilization, got: {card_text[:200]}"


@pytest.mark.feature
def test_health_credit_util_fair(app_page):
    """11-30% aggregate utilization shows 'Fair' badge."""
    page = app_page
    _inject_util_state(page, balance=200, credit_limit=1000)  # 20%

    card_text = page.query_selector('#healthCreditUtilCard').text_content()
    assert 'Fair' in card_text, f"Expected 'Fair' at 20% utilization, got: {card_text[:200]}"


@pytest.mark.feature
def test_health_credit_util_high(app_page):
    """31-50% aggregate utilization shows 'High' badge."""
    page = app_page
    _inject_util_state(page, balance=400, credit_limit=1000)  # 40%

    card_text = page.query_selector('#healthCreditUtilCard').text_content()
    assert 'High' in card_text, f"Expected 'High' at 40% utilization, got: {card_text[:200]}"


@pytest.mark.feature
def test_health_credit_util_critical(app_page):
    """51%+ aggregate utilization shows 'Critical' badge."""
    page = app_page
    _inject_util_state(page, balance=600, credit_limit=1000)  # 60%

    card_text = page.query_selector('#healthCreditUtilCard').text_content()
    assert 'Critical' in card_text, f"Expected 'Critical' at 60% utilization, got: {card_text[:200]}"


@pytest.mark.feature
def test_health_credit_util_maxed(app_page):
    """≥100% aggregate utilization shows 'Maxed' badge."""
    page = app_page
    _inject_util_state(page, balance=1100, credit_limit=1000)  # 110%

    card_text = page.query_selector('#healthCreditUtilCard').text_content()
    assert 'Maxed' in card_text, f"Expected 'Maxed' at 110% utilization, got: {card_text[:200]}"


@pytest.mark.feature
def test_health_credit_util_shows_totals(app_page):
    """Credit utilization card shows aggregate balance and total limit."""
    page = app_page
    _inject_util_state(page, balance=500, credit_limit=2000)  # 25%

    card_text = page.query_selector('#healthCreditUtilCard').text_content()
    assert '500' in card_text, "Balance total not shown in credit utilization card"
    assert '2,000' in card_text or '2000' in card_text, "Credit limit total not shown"


# ── Credit Utilization — Negative tests ───────────────────────────────────────


@pytest.mark.feature
def test_health_credit_util_ignores_fixed_debts(app_page):
    """Fixed-amount debts are not included in the aggregate utilization calculation."""
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        app.debts = [{
            id: 8010, name: 'Car Loan', debtType: 'fixedAmount',
            accountBalance: 0, originalBalance: 15000,
            minimumPayment: 300, fixedAmount: 300,
            fixedStartDate: '2025-01-01', fixedEndDate: '2027-01-01',
            creditLimit: 15000, archived: false
        }];
        app.incomes = []; app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('health');
    }""")
    page.wait_for_selector('#healthCreditUtilCard', timeout=5000)

    card_text = page.query_selector('#healthCreditUtilCard').text_content()
    assert 'No credit limits set' in card_text, \
        "Fixed-amount debts should not contribute to aggregate credit utilization"


@pytest.mark.feature
def test_health_credit_util_ignores_archived_debts(app_page):
    """Archived credit-card debts are excluded from utilization calculation."""
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        app.debts = [{
            id: 8011, name: 'Old Card', debtType: 'creditCard',
            accountBalance: 900, originalBalance: 1000,
            interestRate: 20, minimumPayment: 25, dueDate: 15,
            creditLimit: 1000, archived: true
        }];
        app.incomes = []; app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('health');
    }""")
    page.wait_for_selector('#healthCreditUtilCard', timeout=5000)

    card_text = page.query_selector('#healthCreditUtilCard').text_content()
    assert 'No credit limits set' in card_text, \
        "Archived debts should not contribute to credit utilization"


@pytest.mark.feature
def test_health_credit_util_ignores_debts_without_limit(app_page):
    """Active credit-card debts without a creditLimit are excluded from the calculation."""
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        app.debts = [{
            id: 8012, name: 'No Limit Card', debtType: 'creditCard',
            accountBalance: 800, originalBalance: 1000,
            interestRate: 18, minimumPayment: 30, dueDate: 10,
            creditLimit: null, archived: false
        }];
        app.incomes = []; app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('health');
    }""")
    page.wait_for_selector('#healthCreditUtilCard', timeout=5000)

    card_text = page.query_selector('#healthCreditUtilCard').text_content()
    assert 'No credit limits set' in card_text, \
        "Debts without creditLimit should not be counted in aggregate utilization"


@pytest.mark.feature
def test_health_credit_util_multiple_cards_aggregated(app_page):
    """Multiple credit cards with limits are aggregated into a single utilization percentage."""
    page = app_page
    # Card A: $300 / $1000 = 30%; Card B: $700 / $1000 = 70%; aggregate: $1000/$2000 = 50%
    page.evaluate("""() => {
        const app = window.app;
        app.debts = [
            { id: 8020, name: 'Card A', debtType: 'creditCard',
              accountBalance: 300, originalBalance: 1000,
              interestRate: 18, minimumPayment: 25, dueDate: 10,
              creditLimit: 1000, archived: false },
            { id: 8021, name: 'Card B', debtType: 'creditCard',
              accountBalance: 700, originalBalance: 1000,
              interestRate: 22, minimumPayment: 35, dueDate: 15,
              creditLimit: 1000, archived: false }
        ];
        app.incomes = []; app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('health');
    }""")
    page.wait_for_selector('#healthCreditUtilCard', timeout=5000)

    card_text = page.query_selector('#healthCreditUtilCard').text_content()
    # 50% aggregate → 'High' tier (31-50%)
    assert 'High' in card_text, \
        f"Expected 'High' for 50% aggregate utilization across 2 cards, got: {card_text[:200]}"
    assert '50' in card_text, f"Expected 50% shown in utilization card, got: {card_text[:200]}"


# ── Surplus Analysis card ───────────────────────────────────────────────────────

@pytest.mark.feature
def test_surplus_card_renders(app_page):
    """Surplus Analysis card is present with controls and result container."""
    page = app_page

    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)

    assert page.query_selector('.health-surplus-card'), "Surplus Analysis card not found"
    assert page.query_selector('#healthSurplusAcct'), "Account select not found"
    assert page.query_selector('#healthSurplusWindow'), "Window input not found"
    assert page.query_selector('#healthSurplusCushion'), "Cushion input not found"
    assert page.query_selector('#healthSurplusResult'), "Result container not found"


@pytest.mark.feature
def test_surplus_empty_state_no_accounts(app_page):
    """Surplus card shows empty-state prompt when no accounts are configured."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [];
        app.debts = []; app.bills = []; app.incomes = [];
        app.recurringTemplates = []; app.expenses = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('health');
    }""")
    page.wait_for_selector('#healthSurplusResult', timeout=5000)

    result_text = page.query_selector('#healthSurplusResult').text_content()
    assert 'Select an account' in result_text, \
        f"Expected empty-state prompt when no accounts, got: {result_text}"


@pytest.mark.feature
def test_surplus_positive_with_high_balance(app_page):
    """Surplus badge shows Surplus when account balance far exceeds projected expenses."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 5001, name: 'Checking', type: 'Checking', startingBalance: 50000 }];
        app.incomes = [{
            id: 5002, name: 'Salary', amount: 5000,
            firstPayDate: '2026-10-01', frequency: 'monthly', accountId: 5001
        }];
        app.bills = [{ id: 5003, name: 'Rent', amount: 1200, dueDay: 1, category: 'Housing', accountId: 5001 }];
        app.debts = []; app.expenses = []; app.recurringTemplates = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('health');
    }""")
    page.wait_for_selector('#healthSurplusResult', timeout=5000)

    page.evaluate("""() => {
        const sel = document.getElementById('healthSurplusAcct');
        if (sel) { sel.value = '5001'; sel.dispatchEvent(new Event('change')); }
    }""")
    page.wait_for_timeout(300)

    badge_text = page.query_selector('#healthSurplusBadge').text_content().strip()
    result_text = page.query_selector('#healthSurplusResult').text_content()

    assert badge_text == 'Surplus', f"Expected Surplus badge, got: {badge_text}"
    assert '+' in result_text, f"Expected positive surplus amount (+), got: {result_text[:200]}"


@pytest.mark.feature
def test_surplus_deficit_with_low_balance(app_page):
    """Surplus badge shows Deficit when balance cannot cover expenses plus cushion."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 6001, name: 'Low Account', type: 'Checking', startingBalance: 100 }];
        app.incomes = [];
        app.bills = [{ id: 6002, name: 'BigBill', amount: 2000, dueDay: 5, category: 'Other', accountId: 6001 }];
        app.debts = []; app.expenses = []; app.recurringTemplates = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('health');
    }""")
    page.wait_for_selector('#healthSurplusResult', timeout=5000)

    page.evaluate("""() => {
        const sel = document.getElementById('healthSurplusAcct');
        if (sel) { sel.value = '6001'; sel.dispatchEvent(new Event('change')); }
    }""")
    page.wait_for_timeout(300)

    badge_text = page.query_selector('#healthSurplusBadge').text_content().strip()
    assert badge_text == 'Deficit', \
        f"Expected Deficit badge for $100 balance vs $2000 bill, got: {badge_text}"


@pytest.mark.feature
def test_surplus_debt_recommendations_shown(app_page):
    """Surplus card lists debt-paydown recommendations when surplus is positive."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 7001, name: 'Main', type: 'Checking', startingBalance: 20000 }];
        app.incomes = []; app.bills = [];
        app.debts = [
            { id: 7002, name: 'High APR Card', debtType: 'creditCard',
              accountBalance: 3000, originalBalance: 5000,
              apr: 24, interestRate: 24, minimumPayment: 60, dueDate: 15, archived: false },
            { id: 7003, name: 'Car Loan', debtType: 'loan',
              accountBalance: 8000, originalBalance: 10000,
              apr: 5, interestRate: 5, minimumPayment: 250, dueDate: 20, archived: false }
        ];
        app.expenses = []; app.recurringTemplates = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('health');
    }""")
    page.wait_for_selector('#healthSurplusResult', timeout=5000)

    page.evaluate("""() => {
        const sel = document.getElementById('healthSurplusAcct');
        if (sel) { sel.value = '7001'; sel.dispatchEvent(new Event('change')); }
    }""")
    page.wait_for_timeout(300)

    result_text = page.query_selector('#healthSurplusResult').text_content()
    assert 'Highest interest rate' in result_text, \
        f"Expected 'Highest interest rate' strategy, got: {result_text[:400]}"
    assert 'Highest balance' in result_text, \
        f"Expected 'Highest balance' strategy, got: {result_text[:400]}"


@pytest.mark.feature
def test_surplus_savings_recommendations_shown(app_page):
    """Surplus card recommends open savings goals when surplus is positive."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 8001, name: 'Savings', type: 'Savings', startingBalance: 15000 }];
        app.incomes = []; app.bills = []; app.debts = []; app.expenses = [];
        app.recurringTemplates = [];
        app.emergencyFunds = [{
            id: 8002, name: 'Emergency Fund', accountId: 8001,
            currentAmount: 1000, targetAmount: 10000, monthlyContribution: 200, autoContribute: true
        }];
        app.sinkingFunds = [{
            id: 8003, name: 'Vacation Fund', accountId: 8001,
            currentAmount: 500, targetAmount: 3000, monthlyAllocation: 100, autoContribute: true
        }];
        app.switchPage('health');
    }""")
    page.wait_for_selector('#healthSurplusResult', timeout=5000)

    page.evaluate("""() => {
        const sel = document.getElementById('healthSurplusAcct');
        if (sel) { sel.value = '8001'; sel.dispatchEvent(new Event('change')); }
    }""")
    page.wait_for_timeout(300)

    result_text = page.query_selector('#healthSurplusResult').text_content()
    assert 'Emergency fund' in result_text or 'Savings goal' in result_text, \
        f"Expected savings recommendation, got: {result_text[:400]}"


@pytest.mark.feature
def test_surplus_window_control_updates_result(app_page):
    """Changing the window input re-renders the result with the new window value."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 9101, name: 'Budget', type: 'Checking', startingBalance: 5000 }];
        app.incomes = []; app.bills = []; app.debts = [];
        app.expenses = []; app.recurringTemplates = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('health');
    }""")
    page.wait_for_selector('#healthSurplusResult', timeout=5000)

    page.evaluate("""() => {
        const sel = document.getElementById('healthSurplusAcct');
        if (sel) { sel.value = '9101'; sel.dispatchEvent(new Event('change')); }
    }""")
    page.wait_for_timeout(200)

    # Change window to 30 days
    page.evaluate("""() => {
        const inp = document.getElementById('healthSurplusWindow');
        if (inp) { inp.value = '30'; inp.dispatchEvent(new Event('change')); }
    }""")
    page.wait_for_timeout(200)

    result_html = page.query_selector('#healthSurplusResult').inner_html()
    assert '30' in result_html, \
        f"Expected window value '30' reflected in result breakdown, got: {result_html[:300]}"


@pytest.mark.feature
def test_surplus_zero_balance_debts_excluded(app_page):
    """Debts with zero balance are excluded from surplus recommendations."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'Checking', accountType: 'checking', startingBalance: 50000 }];
        // Two debts: one paid off ($0 balance), one with balance
        app.debts = [
            { id: 10, name: 'PaidOff', debtType: 'creditCard', accountBalance: 0,
              originalBalance: 1000, minimumPayment: 0, interestRate: 20, dueDate: 15,
              apr: 20, archived: false },
            { id: 11, name: 'ActiveDebt', debtType: 'creditCard', accountBalance: 500,
              originalBalance: 500, minimumPayment: 25, interestRate: 15, dueDate: 10,
              apr: 15, archived: false },
        ];
        app.incomes = []; app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.settings = [
            { key: 'surplusAccountId', value: 1 },
            { key: 'surplusWindowDays', value: 90 },
            { key: 'surplusCushionPct', value: 0 },
        ];
        app.switchPage('health');
    }""")
    page.wait_for_selector('#healthSurplusResult', timeout=5000)
    page.evaluate("""() => {
        const sel = document.getElementById('healthSurplusAcct');
        if (sel) { sel.value = '1'; sel.dispatchEvent(new Event('change')); }
    }""")
    page.wait_for_timeout(300)

    result_text = page.query_selector('#healthSurplusResult').text_content()
    assert 'PaidOff' not in result_text, \
        "Zero-balance debt 'PaidOff' should not appear in recommendations"
    assert 'ActiveDebt' in result_text, \
        "Debt with balance 'ActiveDebt' should still appear in recommendations"


@pytest.mark.feature
def test_surplus_transparency_toggle_shows_transactions(app_page):
    """Clicking 'Show projected transactions' reveals the income/expense detail list."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'Checking', accountType: 'checking', startingBalance: 50000 }];
        app.incomes = [{ id: 2, name: 'Salary', amount: 3000,
                         firstPayDate: '2026-10-01', frequency: 'monthly', accountId: 1 }];
        app.debts = []; app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.settings = [
            { key: 'surplusAccountId', value: 1 },
            { key: 'surplusWindowDays', value: 90 },
            { key: 'surplusCushionPct', value: 0 },
        ];
        app.switchPage('health');
    }""")
    page.wait_for_selector('#healthSurplusResult', timeout=5000)
    page.evaluate("""() => {
        const sel = document.getElementById('healthSurplusAcct');
        if (sel) { sel.value = '1'; sel.dispatchEvent(new Event('change')); }
    }""")
    page.wait_for_timeout(300)

    toggle = page.query_selector('#healthSurplusTxToggle')
    assert toggle, "Transaction toggle button (#healthSurplusTxToggle) should be present"

    detail = page.query_selector('#healthSurplusTxDetail')
    assert detail, "Transaction detail panel (#healthSurplusTxDetail) should be present"
    assert detail.get_attribute('hidden') is not None, \
        "Detail panel should be hidden before toggle is clicked"

    toggle.click()
    page.wait_for_timeout(100)

    assert detail.get_attribute('hidden') is None, \
        "Detail panel should be visible after clicking the toggle"
    detail_text = detail.text_content()
    assert 'Income' in detail_text or 'Expenses' in detail_text, \
        "Detail panel should contain Income or Expenses group label"


@pytest.mark.feature
def test_surplus_sparkline_canvas_rendered(app_page):
    """Sparkline canvas is rendered when an account is selected."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'Checking', accountType: 'checking', startingBalance: 10000 }];
        app.incomes = [{ id: 2, name: 'Paycheck', amount: 2000,
                         firstPayDate: '2026-10-01', frequency: 'monthly', accountId: 1 }];
        app.debts = []; app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.settings = [{ key: 'surplusAccountId', value: 1 }];
        app.switchPage('health');
    }""")
    page.wait_for_selector('#healthSurplusResult', timeout=5000)
    page.evaluate("""() => {
        const sel = document.getElementById('healthSurplusAcct');
        if (sel) { sel.value = '1'; sel.dispatchEvent(new Event('change')); }
    }""")
    page.wait_for_timeout(400)

    canvas = page.query_selector('#healthSurplusSparkline')
    assert canvas, "Sparkline canvas (#healthSurplusSparkline) should be rendered"


@pytest.mark.feature
def test_surplus_payoff_acceleration_shown(app_page):
    """Debt recommendations show 'mo sooner' badge when payoff is accelerated."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'Checking', accountType: 'checking', startingBalance: 50000 }];
        app.debts = [{
            id: 20, name: 'AutoLoan', debtType: 'creditCard',
            accountBalance: 8000, originalBalance: 8000,
            minimumPayment: 200, interestRate: 7, apr: 7, dueDate: 10, archived: false,
        }];
        app.incomes = []; app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.settings = [
            { key: 'surplusAccountId', value: 1 },
            { key: 'surplusWindowDays', value: 90 },
            { key: 'surplusCushionPct', value: 0 },
        ];
        app.switchPage('health');
    }""")
    page.wait_for_selector('#healthSurplusResult', timeout=5000)
    page.evaluate("""() => {
        const sel = document.getElementById('healthSurplusAcct');
        if (sel) { sel.value = '1'; sel.dispatchEvent(new Event('change')); }
    }""")
    page.wait_for_timeout(400)

    result_text = page.query_selector('#healthSurplusResult').text_content()
    assert 'sooner' in result_text, \
        "Debt recommendations should show 'mo sooner' payoff acceleration badge"


@pytest.mark.feature
def test_surplus_balance_dip_warning(app_page):
    """Warning is shown when projected balance dips below the minimum reserve mid-window."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        // Low balance account so even one debt payment triggers a dip warning
        app.accounts = [{ id: 1, name: 'Checking', accountType: 'checking', startingBalance: 300 }];
        app.incomes = [];
        app.debts = [{
            id: 30, name: 'CreditCard', debtType: 'creditCard',
            accountBalance: 500, originalBalance: 500,
            minimumPayment: 250, interestRate: 20, apr: 20, dueDate: 5, archived: false,
            accountId: 1,
        }];
        app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.settings = [
            { key: 'surplusAccountId', value: 1 },
            { key: 'surplusWindowDays', value: 90 },
            { key: 'surplusCushionPct', value: 20 },
        ];
        app.switchPage('health');
    }""")
    page.wait_for_selector('#healthSurplusResult', timeout=5000)
    page.evaluate("""() => {
        const sel = document.getElementById('healthSurplusAcct');
        if (sel) { sel.value = '1'; sel.dispatchEvent(new Event('change')); }
    }""")
    page.wait_for_timeout(400)

    result_text = page.query_selector('#healthSurplusResult').text_content()
    # Either dip warning or deficit notice — both indicate the cash flow problem
    has_dip_warning = 'dips to' in result_text.lower()
    has_deficit     = 'Deficit' in result_text or 'Reduce expenses' in result_text
    assert has_dip_warning or has_deficit, \
        "Expected dip warning or deficit indicator when balance cannot cover reserve"


@pytest.mark.feature
def test_surplus_allocation_slider_shown_with_mixed_recs(app_page):
    """Allocation slider appears when both debt and savings recommendations are present."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'Checking', accountType: 'checking', startingBalance: 50000 }];
        app.debts = [{
            id: 40, name: 'Visa', debtType: 'creditCard',
            accountBalance: 1000, originalBalance: 1000,
            minimumPayment: 50, interestRate: 18, apr: 18, dueDate: 15, archived: false,
        }];
        app.incomes = []; app.bills = []; app.expenses = [];
        app.recurringTemplates = [];
        app.emergencyFunds = [{
            id: 50, name: 'Emergency', currentAmount: 500, targetAmount: 5000,
            monthlyContribution: 100,
        }];
        app.sinkingFunds = [];
        app.settings = [
            { key: 'surplusAccountId', value: 1 },
            { key: 'surplusWindowDays', value: 90 },
            { key: 'surplusCushionPct', value: 0 },
        ];
        app.switchPage('health');
    }""")
    page.wait_for_selector('#healthSurplusResult', timeout=5000)
    page.evaluate("""() => {
        const sel = document.getElementById('healthSurplusAcct');
        if (sel) { sel.value = '1'; sel.dispatchEvent(new Event('change')); }
    }""")
    page.wait_for_timeout(400)

    slider = page.query_selector('#healthSurplusAllocSlider')
    assert slider, "Allocation slider (#healthSurplusAllocSlider) should appear with mixed recs"

    # Drag slider to 50% debt and verify amounts update
    page.evaluate("""() => {
        const s = document.getElementById('healthSurplusAllocSlider');
        if (s) { s.value = '50'; s.dispatchEvent(new Event('input')); }
    }""")
    page.wait_for_timeout(100)

    alloc_text = page.query_selector('#healthSurplusResult').text_content()
    assert '50%' in alloc_text, "Allocation label should reflect 50% debt slider position"


# ── H-01 Trend arrows ──────────────────────────────────────────────────────────

@pytest.mark.feature
def test_health_trend_arrow_present_when_income_changes(app_page):
    """Trend arrows appear on DTI / Savings Rate cards when prev-month income differs."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        const yr = now.getFullYear();
        const mo = now.getMonth();
        // Monthly income running since prev month (1 payday in both months).
        const prevYear  = mo === 0 ? yr - 1 : yr;
        const prevMonth = mo === 0 ? 11 : mo - 1;
        const firstDate = new Date(prevYear, prevMonth, 1);
        const firstPayDate = firstDate.toISOString().slice(0, 10);
        // Add a one-time bonus this month to make current-month income != prev-month income.
        const bonusDate = `${yr}-${String(mo + 1).padStart(2, '0')}-15`;
        app.incomes = [{
            id: 1, name: 'Job', amount: 5000, firstPayDate,
            frequency: 'monthly', accountId: null, personId: null, category: 'Salary'
        }];
        app.bonuses = [{ id: 10, name: 'Bonus', amount: 1000, date: bonusDate, accountId: null }];
        app.debts = [{ id: 2, name: 'Loan', accountBalance: 10000, originalBalance: 10000,
                       minimumPayment: 500, interestRate: 5, debtType: 'personal',
                       accountId: null }];
        app.bills = []; app.expenses = []; app.recurringTemplates = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('health');
    }""")
    page.wait_for_timeout(500)

    trends = page.query_selector_all('.health-trend')
    assert len(trends) >= 1, "Expected at least one trend arrow when income and debt exist"


@pytest.mark.feature
def test_health_trend_arrow_absent_when_no_prev_income(app_page):
    """No trend arrows when there is no previous-month income to compare against."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        // Set firstPayDate to this month so prev month has 0 income
        const now = new Date();
        const firstPayDate = new Date(now.getFullYear(), now.getMonth(), 1)
            .toISOString().slice(0, 10);
        app.incomes = [{
            id: 1, name: 'NewJob', amount: 3000, firstPayDate,
            frequency: 'monthly', accountId: null, personId: null, category: 'Salary'
        }];
        app.debts = []; app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('health');
    }""")
    page.wait_for_timeout(500)

    trends = page.query_selector_all('.health-trend')
    assert len(trends) == 0, "No trend arrows expected when prev-month income is zero"


# ── H-02 Clickable cards ────────────────────────────────────────────────────────

@pytest.mark.feature
def test_health_cards_have_data_card_nav(app_page):
    """All clickable health cards carry data-card-nav attribute."""
    page = app_page

    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)

    nav_cards = page.query_selector_all('[data-card-nav]')
    assert len(nav_cards) >= 6, \
        f"Expected at least 6 cards with data-card-nav, found {len(nav_cards)}"


@pytest.mark.feature
def test_health_card_click_navigates(app_page):
    """Clicking a health metric card navigates to the target page."""
    page = app_page

    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)

    # Click the DTI card (data-card-nav="liabilities") away from any link/button
    page.evaluate("""() => {
        const card = document.querySelector('[data-card-nav="liabilities"]');
        if (card) {
            // click the title span — not a link or button
            const title = card.querySelector('.health-card-title');
            if (title) title.click();
        }
    }""")
    page.wait_for_timeout(400)

    liabilities_active = page.query_selector('#liabilitiesSection.active')
    assert liabilities_active, "Clicking a data-card-nav='liabilities' card should navigate to Liabilities"


# ── Interest Burden Rate card ──────────────────────────────────────────────────


def _inject_interest_burden_state(page, balance, interest_rate, monthly_income):
    """Inject a single debt and income source, then navigate to health."""
    page.evaluate(f"""() => {{
        const app = window.app;
        app.incomes = [{{
            id: 9001, name: 'Salary', amount: {monthly_income},
            firstPayDate: '2026-01-01', frequency: 'monthly',
            accountId: null
        }}];
        app.debts = [{{
            id: 9002, name: 'Loan', debtType: 'creditCard',
            accountBalance: {balance}, originalBalance: {balance},
            interestRate: {interest_rate}, minimumPayment: 50, dueDate: 15,
            creditLimit: null, archived: false
        }}];
        app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('health');
    }}""")
    page.wait_for_selector('#healthInterestBurdenCard', timeout=5000)


@pytest.mark.feature
def test_health_interest_burden_card_present(app_page):
    """Interest Burden Rate card (#healthInterestBurdenCard) is always rendered."""
    page = app_page
    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)

    card = page.query_selector('#healthInterestBurdenCard')
    assert card, "Interest Burden Rate card not found in health dashboard"


@pytest.mark.feature
def test_health_interest_burden_empty_state_no_debts(app_page):
    """Interest Burden Rate card shows empty state when no active debts."""
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        app.debts = []; app.incomes = []; app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('health');
    }""")
    page.wait_for_selector('#healthInterestBurdenCard', timeout=5000)

    card_text = page.query_selector('#healthInterestBurdenCard').text_content()
    assert 'No active debts' in card_text, \
        f"Expected empty-state when no debts, got: {card_text[:200]}"


@pytest.mark.feature
def test_health_interest_burden_low(app_page):
    """≤5% interest burden shows 'Low' badge."""
    page = app_page
    # $10,000 at 6% APR → $50/mo interest; income $5,000/mo → 1% burden
    _inject_interest_burden_state(page, balance=10000, interest_rate=6, monthly_income=5000)

    card_text = page.query_selector('#healthInterestBurdenCard').text_content()
    assert 'Low' in card_text, f"Expected 'Low' at ~1% interest burden, got: {card_text[:200]}"


@pytest.mark.feature
def test_health_interest_burden_moderate(app_page):
    """6–10% interest burden shows 'Moderate' badge."""
    page = app_page
    # $10,000 at 10% APR → ~$83/mo interest; income $1,000/mo → ~8.3% burden
    _inject_interest_burden_state(page, balance=10000, interest_rate=10, monthly_income=1000)

    card_text = page.query_selector('#healthInterestBurdenCard').text_content()
    assert 'Moderate' in card_text, \
        f"Expected 'Moderate' at ~8% interest burden, got: {card_text[:200]}"


@pytest.mark.feature
def test_health_interest_burden_high(app_page):
    """>10% interest burden shows 'High' badge."""
    page = app_page
    # $20,000 at 24% APR → $400/mo interest; income $2,000/mo → 20% burden
    _inject_interest_burden_state(page, balance=20000, interest_rate=24, monthly_income=2000)

    card_text = page.query_selector('#healthInterestBurdenCard').text_content()
    assert 'High' in card_text, \
        f"Expected 'High' at 20% interest burden, got: {card_text[:200]}"


@pytest.mark.feature
def test_health_interest_burden_shows_values(app_page):
    """Interest Burden Rate card shows monthly interest and income amounts."""
    page = app_page
    # $12,000 at 12% APR → $120/mo interest; income $2,000/mo
    _inject_interest_burden_state(page, balance=12000, interest_rate=12, monthly_income=2000)

    card_text = page.query_selector('#healthInterestBurdenCard').text_content()
    assert 'Interest' in card_text, "Should show 'Interest' label"
    assert 'Income' in card_text, "Should show 'Income' label"
    # $120/mo interest — check some fragment of the formatted number
    assert '120' in card_text, "Monthly interest amount not shown in card"


# ── Debt-to-Asset Ratio card ──────────────────────────────────────────────────


@pytest.mark.feature
def test_health_debt_to_asset_card_present(app_page):
    """Debt-to-Asset Ratio card (#healthDebtToAssetCard) is always rendered."""
    page = app_page
    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)

    card = page.query_selector('#healthDebtToAssetCard')
    assert card, "Debt-to-Asset Ratio card not found in health dashboard"


@pytest.mark.feature
def test_health_dta_empty_state_no_accounts(app_page):
    """Debt-to-Asset Ratio card shows empty state when no accounts (no assets)."""
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = []; app.debts = []; app.incomes = []; app.bills = [];
        app.expenses = []; app.recurringTemplates = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('health');
    }""")
    page.wait_for_selector('#healthDebtToAssetCard', timeout=5000)

    card_text = page.query_selector('#healthDebtToAssetCard').text_content()
    assert 'No asset data' in card_text, \
        f"Expected empty-state when no assets, got: {card_text[:200]}"


@pytest.mark.feature
def test_health_dta_healthy(app_page):
    """D/A ratio < 0.5 shows 'Healthy' badge."""
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        // Account with $10,000 starting balance; debt $4,000 → ratio = 0.4
        app.accounts = [{
            id: 7001, name: 'Checking', type: 'checking',
            startingBalance: 10000, accountId: null
        }];
        app.debts = [{
            id: 7002, name: 'Card', debtType: 'creditCard',
            accountBalance: 4000, originalBalance: 4000,
            interestRate: 15, minimumPayment: 80, dueDate: 15,
            creditLimit: null, archived: false
        }];
        app.incomes = []; app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('health');
    }""")
    page.wait_for_selector('#healthDebtToAssetCard', timeout=5000)

    card_text = page.query_selector('#healthDebtToAssetCard').text_content()
    assert 'Healthy' in card_text, \
        f"Expected 'Healthy' badge at D/A ratio 0.4, got: {card_text[:200]}"


@pytest.mark.feature
def test_health_dta_high_risk(app_page):
    """D/A ratio >= 1.0 shows 'High Risk' badge."""
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        // Account $5,000; debt $6,000 → ratio = 1.2 (over-leveraged)
        app.accounts = [{
            id: 7003, name: 'Savings', type: 'savings',
            startingBalance: 5000, accountId: null
        }];
        app.debts = [{
            id: 7004, name: 'Loan', debtType: 'creditCard',
            accountBalance: 6000, originalBalance: 6000,
            interestRate: 20, minimumPayment: 120, dueDate: 15,
            creditLimit: null, archived: false
        }];
        app.incomes = []; app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('health');
    }""")
    page.wait_for_selector('#healthDebtToAssetCard', timeout=5000)

    card_text = page.query_selector('#healthDebtToAssetCard').text_content()
    assert 'High Risk' in card_text, \
        f"Expected 'High Risk' badge when debts exceed assets, got: {card_text[:200]}"
