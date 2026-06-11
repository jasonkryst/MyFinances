#!/usr/bin/env python3
"""
DebtCalculator Edge Case Tests
Tests the pure-static payoff calculation engine (src/debtCalculator.js)
directly via DebtCalculator for edge cases not covered by UI flows.
"""

import pytest


@pytest.mark.feature
def test_debt_calculator_zero_apr_no_interest(app_page):
    """A 0% APR debt accrues no interest and pays off in balance/payment months."""
    page = app_page

    result = page.evaluate("""() => {
        const debts = [{
            name: 'Zero APR Card', debtType: 'creditCard',
            accountBalance: 1200, originalBalance: 1200,
            interestRate: 0, minimumPayment: 100, dueDate: 1, priority: 1
        }];
        const { paymentPlan, workingDebts } = DebtCalculator.calculatePaymentPlan(debts, 100, 'avalanche');
        return {
            months: paymentPlan.length,
            totalInterest: workingDebts[0].totalInterest,
            totalPrincipal: workingDebts[0].totalPrincipal,
            paidOffMonth: workingDebts[0].paidOffMonth
        };
    }""")

    assert result['months'] == 12, f"Expected 12 months to pay off $1200 at $100/mo, got {result['months']}"
    assert result['totalInterest'] == 0, "0% APR debt should accrue no interest"
    assert result['totalPrincipal'] == 1200, "Total principal paid should equal the original balance"
    assert result['paidOffMonth'] == 12, "Debt should be paid off in month 12"


@pytest.mark.feature
def test_debt_calculator_single_debt_payment_order(app_page):
    """getPaymentOrder returns the single active debt's index regardless of strategy."""
    page = app_page

    result = page.evaluate("""() => {
        const debts = [{
            name: 'Only Debt', debtType: 'creditCard',
            balance: 500, interestRate: 9, minimumPayment: 25,
            paidOffMonth: null, priority: 5
        }];
        return {
            avalanche: DebtCalculator.getPaymentOrder(debts, 'avalanche'),
            snowball: DebtCalculator.getPaymentOrder(debts, 'snowball'),
            priorityLowest: DebtCalculator.getPaymentOrder(debts, 'priority-lowest'),
            priorityHighest: DebtCalculator.getPaymentOrder(debts, 'priority-highest')
        };
    }""")

    for strategy, order in result.items():
        assert order == [0], f"Expected single-debt order [0] for {strategy}, got {order}"


@pytest.mark.feature
def test_debt_calculator_exact_minimum_payment_no_overage(app_page):
    """When the monthly payment equals total minimum payments, no extra/overage payments occur."""
    page = app_page

    result = page.evaluate("""() => {
        const debts = [
            { name: 'Card A', debtType: 'creditCard', accountBalance: 1000, originalBalance: 1000,
              interestRate: 10, minimumPayment: 50, dueDate: 1, priority: 1 },
            { name: 'Card B', debtType: 'creditCard', accountBalance: 2000, originalBalance: 2000,
              interestRate: 15, minimumPayment: 80, dueDate: 5, priority: 2 }
        ];
        const totalMinimum = 50 + 80;
        const { paymentPlan } = DebtCalculator.calculatePaymentPlan(debts, totalMinimum, 'avalanche');
        const firstMonth = paymentPlan[0];
        return {
            paymentCount: firstMonth.payments.length,
            anyExtra: firstMonth.payments.some(p => p.isExtra),
            allMinimum: firstMonth.payments.every(p => p.isMinimum)
        };
    }""")

    assert result['paymentCount'] == 2, "Expected one payment entry per debt in the first month"
    assert result['allMinimum'], "All first-month payments should be minimum-only"
    assert not result['anyExtra'], "No overage/extra payment should occur when payment equals total minimums"


@pytest.mark.feature
def test_debt_calculator_throws_below_minimum_payment(app_page):
    """calculatePaymentPlan throws if the budget is below the sum of minimum payments."""
    page = app_page

    error_message = page.evaluate("""() => {
        const debts = [
            { name: 'Card A', debtType: 'creditCard', accountBalance: 1000, originalBalance: 1000,
              interestRate: 10, minimumPayment: 50, dueDate: 1, priority: 1 },
            { name: 'Card B', debtType: 'creditCard', accountBalance: 2000, originalBalance: 2000,
              interestRate: 15, minimumPayment: 80, dueDate: 5, priority: 2 }
        ];
        try {
            DebtCalculator.calculatePaymentPlan(debts, 100, 'avalanche');
            return null;
        } catch (err) {
            return err.message;
        }
    }""")

    assert error_message is not None, "Expected an error when budget is below total minimum payments"
    assert 'minimum' in error_message.lower(), f"Expected a minimum-payment error message, got: {error_message}"
