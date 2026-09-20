#!/usr/bin/env python3
"""
Financial Health Dashboard Tests
Tests the six metric cards: DTI, savings rate, emergency fund coverage,
debt payoff timeline, monthly cash flow, and budget allocation.
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
def test_health_renders_six_metric_cards(app_page):
    """All six metric cards are present in the dashboard."""
    page = app_page

    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)

    cards = page.query_selector_all('.health-metric-card')
    assert len(cards) == 7, f"Expected 7 metric cards (including credit utilization), found {len(cards)}"


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
