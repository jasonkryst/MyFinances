#!/usr/bin/env python3
"""
Strategy/Payment-Plan Tests
Tests strategy switching (Avalanche/Snowball/Priority) and the per-month
stimulus input on the payment schedule table.
"""

import pytest

from tests.conftest import create_debt, assert_no_errors


def _create_two_debts(page):
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)
    page.fill('#accountName', 'Strategy Account')
    page.select_option('#accountType', label='Credit Card')
    page.fill('#accountStartingBalance', '0')
    page.click('#accountFormSubmit')

    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_selector('[data-liabilities-subtab="debts"].active', timeout=5000)

    debts = [
        ('High Interest Debt', '2000', '24', '100'),
        ('Low Interest Debt', '5000', '6', '150'),
    ]
    for name, balance, rate, min_pmt in debts:
        page.click('#debtFormToggle')
        page.wait_for_selector('#debtFormBody:not([hidden])', timeout=5000)
        page.fill('#debtName', name)
        page.select_option('#debtType', 'creditCard')
        page.fill('#accountBalance', balance)
        page.fill('#interestRate', rate)
        page.fill('#minimumPayment', min_pmt)
        page.fill('#dueDate', '15')
        page.click('#debtFormSubmit')


def _calculate(page, strategy):
    page.click('button[data-page="strategy"]')
    page.wait_for_selector('#strategySection.active', timeout=5000)
    page.fill('#monthlyPayment', '500')
    page.select_option('#paymentStrategy', strategy)
    page.click('#calculateBtn')
    page.wait_for_selector('#resultsSection.visible', timeout=10000)


@pytest.mark.feature
def test_strategy_switch_recalculates_without_error(app_page):
    """Switching between Avalanche, Snowball, and Priority strategies and
    recalculating each time produces a fresh plan with no console errors.
    """
    page = app_page
    _create_two_debts(page)

    for strategy in ['avalanche', 'snowball', 'priority-lowest', 'priority-highest']:
        _calculate(page, strategy)
        assert_no_errors(page)

    months_to_payoff = page.evaluate(
        "() => window.app.lastSummary ? window.app.lastSummary.monthsToPayOff : null"
    )
    assert months_to_payoff and months_to_payoff > 0, \
        "Expected a positive monthsToPayOff after the final strategy calculation"


@pytest.mark.feature
def test_strategy_comparison_panel_shows_all_strategies(app_page):
    """The Strategy Comparison panel lists all 4 strategies once a plan is calculated."""
    page = app_page
    _create_two_debts(page)
    _calculate(page, 'avalanche')

    page.click('[data-rtab="overview"]')
    page.wait_for_selector('#rPanel-overview', timeout=5000)

    row_count = page.evaluate(
        "() => document.querySelectorAll('#interestComparison .comparison-table tbody tr').length"
    )
    assert row_count == 4, f"Expected 4 strategy rows in the comparison table, got {row_count}"


@pytest.mark.feature
def test_stimulus_input_increases_month_total_paid(app_page):
    """Entering a per-month stimulus amount recalculates and raises that month's total paid."""
    page = app_page
    _create_two_debts(page)
    _calculate(page, 'avalanche')

    page.click('[data-rtab="schedule"]')
    page.wait_for_selector('#rPanel-schedule', timeout=5000)
    page.click('button[data-tab="tabular"]')
    page.wait_for_selector(f'button[data-tab="tabular"].active', timeout=5000)

    total_before = page.evaluate("""
        () => {
            const row = document.querySelector('#paymentTableBody tr');
            return row ? row.querySelector('.amount-total').textContent : null;
        }
    """)
    assert total_before is not None, "Expected at least one row in the payment schedule table"

    page.fill('#stimulus-input-0', '300')
    page.dispatch_event('#stimulus-input-0', 'change')

    total_after = page.evaluate("""
        () => {
            const row = document.querySelector('#paymentTableBody tr');
            return row ? row.querySelector('.amount-total').textContent : null;
        }
    """)
    assert total_after is not None and total_after != total_before, \
        f"Expected month-1 total paid to change after applying a stimulus (before={total_before!r}, after={total_after!r})"


@pytest.mark.feature
def test_stimulus_non_numeric_input_falls_back_to_zero(app_page):
    """A non-numeric stimulus value is stored as 0, not NaN, and doesn't break recalculation."""
    page = app_page
    _create_two_debts(page)
    _calculate(page, 'avalanche')

    page.click('[data-rtab="schedule"]')
    page.wait_for_selector('#rPanel-schedule', timeout=5000)
    page.click('button[data-tab="tabular"]')
    page.wait_for_selector(f'button[data-tab="tabular"].active', timeout=5000)

    page.evaluate("""
        () => {
            const input = document.getElementById('stimulus-input-0');
            input.value = 'abc';
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
    """)

    stored_value = page.evaluate("() => window.app.perMonthStimulus[0]")
    assert stored_value == 0, f"Expected non-numeric stimulus input to fall back to 0, got {stored_value!r}"
    assert_no_errors(page)


# ---------------------------------------------------------------------------
# Suggest monthly payment button (issue #319)
# ---------------------------------------------------------------------------

@pytest.mark.feature
def test_suggest_payment_btn_exists(app_page):
    """The Suggest button is present next to the monthly payment input."""
    page = app_page
    page.click('button[data-page="strategy"]')
    page.wait_for_selector('#strategySection.active', timeout=5000)
    btn = page.query_selector('#suggestPaymentBtn')
    assert btn is not None, "Suggest payment button should be rendered on the Plan page"


@pytest.mark.feature
def test_suggest_payment_fills_input_with_income_minus_expenses(app_page):
    """Suggest button computes income - bills - expenses - debt minimums."""
    page = app_page

    # Seed: $3000 income, $500 bills, $200 expenses, $100 debt min → suggest = $2200
    page.evaluate("""() => {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        window.app.incomes = [{
            id: 1, name: 'Salary', amount: 3000, frequency: 'monthly',
            firstPayDate: `${yyyy}-${mm}-01`, accountId: null, bonusType: null
        }];
        window.app.bills = [{
            id: 1, name: 'Rent', amount: 500, dueDate: 1,
            category: '', accountId: null, frequency: 'monthly'
        }];
        window.app.expenses = [{
            id: 1, name: 'Groceries', budgetAmount: 200, category: '',
            accountId: null, frequency: 'monthly'
        }];
        window.app.debts = [{
            id: 1, name: 'Card', debtType: 'creditCard',
            accountBalance: 1000, originalBalance: 1000, creditLimit: null,
            interestRate: 18, minimumPayment: 100, dueDate: 15,
            fixedAmount: null, fixedStartDate: null, fixedEndDate: null,
            debtStartDate: null, updatedAt: null, priority: null,
            accountId: null, archived: false, personIds: [], notes: ''
        }];
        window.app.switchPage('strategy');
    }""")
    page.wait_for_selector('#strategySection.active', timeout=5000)

    page.click('#suggestPaymentBtn')

    value = page.evaluate("() => document.getElementById('monthlyPayment').value")
    assert value == '2200.00', f"Expected suggested payment of 2200.00, got {value!r}"


@pytest.mark.feature
def test_export_schedule_btn_exists(app_page):
    """The Export Schedule button is present when a payment plan is calculated."""
    page = app_page

    # Seed: 1 debt with minimum payment so we can calculate a plan
    page.evaluate("""() => {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        window.app.incomes = [{
            id: 1, name: 'Salary', amount: 3000, frequency: 'monthly',
            firstPayDate: `${yyyy}-${mm}-01`, accountId: null, bonusType: null
        }];
        window.app.debts = [{
            id: 1, name: 'Card', debtType: 'creditCard',
            accountBalance: 1000, originalBalance: 1000, creditLimit: null,
            interestRate: 18, minimumPayment: 100, dueDate: 15,
            fixedAmount: null, fixedStartDate: null, fixedEndDate: null,
            debtStartDate: null, updatedAt: null, priority: null,
            accountId: null, archived: false, personIds: [], notes: ''
        }];
        window.app.switchPage('strategy');
    }""")
    page.wait_for_selector('#strategySection.active', timeout=5000)

    # Calculate a plan
    page.fill('#monthlyPayment', '1000')
    page.select_option('#paymentStrategy', 'avalanche')
    page.click('#calculateBtn')
    page.wait_for_selector('#resultsSection:not(.hidden)', timeout=5000)

    # Check for export button
    btn = page.query_selector('#exportScheduleBtn')
    assert btn is not None, "Export Schedule button should be rendered when a plan is calculated"


@pytest.mark.feature
def test_export_payment_schedule_csv(app_page):
    """exportPaymentScheduleCSV does not throw when given a valid payment plan."""
    page = app_page

    page.evaluate("""() => {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        window.app.incomes = [{
            id: 1, name: 'Salary', amount: 5000, frequency: 'monthly',
            firstPayDate: `${yyyy}-${mm}-01`, accountId: null, bonusType: null
        }];
        window.app.debts = [{
            id: 1, name: 'Card1', debtType: 'creditCard',
            accountBalance: 1000, originalBalance: 1000, creditLimit: null,
            interestRate: 18, minimumPayment: 100, dueDate: 15,
            fixedAmount: null, fixedStartDate: null, fixedEndDate: null,
            debtStartDate: null, updatedAt: null, priority: null,
            accountId: null, archived: false, personIds: [], notes: ''
        }];
        window.app.switchPage('strategy');
    }""")
    page.wait_for_selector('#strategySection.active', timeout=5000)

    # Calculate a plan
    page.fill('#monthlyPayment', '1500')
    page.select_option('#paymentStrategy', 'avalanche')
    page.click('#calculateBtn')
    page.wait_for_selector('#resultsSection:not(.hidden)', timeout=5000)

    # Call the export function and ensure it doesn't throw
    result = page.evaluate("() => { try { window.app.exportPaymentScheduleCSV(); return 'ok'; } catch(e) { return e.message; } }")
    assert result == 'ok', f"exportPaymentScheduleCSV should not throw, got: {result}"
