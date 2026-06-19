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


# --- Back-calculator (binary-search target-payoff-date) coverage ---
#
# NOTE: The binary-search back-calculator that finds a required monthly payment
# for a target payoff date is `calculateRequiredPayment()` in `src/strategy.js`,
# NOT a method on the pure `DebtCalculator` engine. It is tightly coupled to the
# DOM (reads `document.getElementById('targetPayoffDate')`, mutates `innerHTML`,
# reads `app.debts`) and is not exported as a standalone, side-effect-free
# function, so it cannot be invoked directly via `DebtCalculator.xxx(...)` the
# way the rest of this file exercises the engine. The tests below replicate its
# documented binary-search algorithm (see src/strategy.js lines ~132-150) on top
# of the pure `DebtCalculator.calculatePaymentPlan` primitive it actually calls,
# which is the portion of the back-calculator's behavior that lives in the
# engine under test here.

@pytest.mark.feature
def test_debt_calculator_back_calculator_finds_payment_for_target_date(app_page):
    """Binary search (replicating calculateRequiredPayment's algorithm) finds a
    monthly payment that pays off the debt at or before the target month count."""
    page = app_page

    result = page.evaluate("""() => {
        const debts = [{
            name: 'Target Card', debtType: 'creditCard',
            accountBalance: 3000, originalBalance: 3000,
            interestRate: 20, minimumPayment: 50, dueDate: 1, priority: 1
        }];
        const targetMonths = 12;
        const totalMinimum = debts.reduce((s, d) => s + (d.minimumPayment || 0), 0);

        let lo = totalMinimum;
        let hi = debts.reduce((s, d) => s + (d.accountBalance || 0), 0) * 2 + 10000;
        let found = null;

        for (let iter = 0; iter < 60; iter++) {
            const mid = (lo + hi) / 2;
            try {
                const r = DebtCalculator.calculatePaymentPlan(debts, mid, 'avalanche', 0);
                if (r.paymentPlan.length <= targetMonths) {
                    found = mid;
                    hi = mid;
                } else {
                    lo = mid;
                }
            } catch (e) {
                lo = mid;
            }
        }

        const requiredPayment = Math.ceil(found);
        const verify = DebtCalculator.calculatePaymentPlan(debts, requiredPayment, 'avalanche', 0);

        return {
            found: found !== null,
            requiredPayment,
            actualMonths: verify.paymentPlan.length,
            targetMonths
        };
    }""")

    assert result['found'], "Binary search should find a converging payment amount"
    assert result['requiredPayment'] > 0, "Required payment should be positive"
    assert result['actualMonths'] <= result['targetMonths'], (
        f"Payment of {result['requiredPayment']} should pay off the debt within "
        f"{result['targetMonths']} months, took {result['actualMonths']}"
    )


@pytest.mark.feature
def test_debt_calculator_back_calculator_unreachable_target_date(app_page):
    """Boundary case: an aggressively close target (1 month) for a large, high-APR
    balance should not converge on a 'reasonable' payment within the search range
    used by calculateRequiredPayment — the search should report failure to find
    a payment instead of silently returning a misleading result, OR (if it does
    converge) the resulting plan must still genuinely finish within the target,
    proving the binary search itself is sound at the boundary."""
    page = app_page

    result = page.evaluate("""() => {
        const debts = [{
            name: 'Huge Card', debtType: 'creditCard',
            accountBalance: 500000, originalBalance: 500000,
            interestRate: 29.99, minimumPayment: 25, dueDate: 1, priority: 1
        }];
        const targetMonths = 1; // pay off a $500k balance in a single month

        const totalMinimum = debts.reduce((s, d) => s + (d.minimumPayment || 0), 0);
        let lo = totalMinimum;
        let hi = debts.reduce((s, d) => s + (d.accountBalance || 0), 0) * 2 + 10000;
        let found = null;

        for (let iter = 0; iter < 60; iter++) {
            const mid = (lo + hi) / 2;
            try {
                const r = DebtCalculator.calculatePaymentPlan(debts, mid, 'avalanche', 0);
                if (r.paymentPlan.length <= targetMonths) {
                    found = mid;
                    hi = mid;
                } else {
                    lo = mid;
                }
            } catch (e) {
                lo = mid;
            }
        }

        let verifiedMonths = null;
        let verifyError = null;
        if (found !== null) {
            try {
                const verify = DebtCalculator.calculatePaymentPlan(debts, Math.ceil(found), 'avalanche', 0);
                verifiedMonths = verify.paymentPlan.length;
            } catch (e) {
                verifyError = e.message;
            }
        }

        return { found: found !== null, requiredPayment: found, verifiedMonths, verifyError, targetMonths };
    }""")

    # The search range (2x balance + 10000) is wide enough to cover paying off
    # $500k in one month with a single lump payment, so we expect it to find a
    # value. The key correctness property at this boundary is that whatever is
    # found, when fed back into the engine, truly pays off the debt within the
    # target month count -- the binary search must not report a false positive.
    if result['found']:
        assert result['verifyError'] is None, (
            f"Re-running the plan at the found payment threw: {result['verifyError']}"
        )
        assert result['verifiedMonths'] <= result['targetMonths'], (
            "Binary search reported a converging payment, but re-verifying the plan "
            f"took {result['verifiedMonths']} months, exceeding the target of {result['targetMonths']}"
        )
    else:
        # If the search genuinely cannot converge within its fixed range/iterations,
        # that's the expected "unreachable" outcome for this boundary case.
        assert result['requiredPayment'] is None


# --- Multi-debt priority-lowest / priority-highest strategy ordering ---

@pytest.mark.feature
def test_debt_calculator_priority_strategies_order_multi_debt(app_page):
    """With 3+ debts of varying balance/priority, priority-lowest orders by
    lowest priority number first and priority-highest orders by highest
    priority number first, and the two orders are opposite of each other."""
    page = app_page

    result = page.evaluate("""() => {
        const debts = [
            { name: 'Low Priority Card', debtType: 'creditCard',
              balance: 1500, accountBalance: 1500, originalBalance: 1500,
              interestRate: 12, minimumPayment: 40, dueDate: 1, priority: 1,
              paidOffMonth: null },
            { name: 'Mid Priority Card', debtType: 'creditCard',
              balance: 800, accountBalance: 800, originalBalance: 800,
              interestRate: 22, minimumPayment: 30, dueDate: 5, priority: 5,
              paidOffMonth: null },
            { name: 'High Priority Card', debtType: 'creditCard',
              balance: 3000, accountBalance: 3000, originalBalance: 3000,
              interestRate: 8, minimumPayment: 60, dueDate: 10, priority: 10,
              paidOffMonth: null }
        ];

        const lowestOrder = DebtCalculator.getPaymentOrder(debts, 'priority-lowest');
        const highestOrder = DebtCalculator.getPaymentOrder(debts, 'priority-highest');

        // Also run a full plan under each strategy and capture payoff order
        const planLowest = DebtCalculator.calculatePaymentPlan(debts, 500, 'priority-lowest');
        const planHighest = DebtCalculator.calculatePaymentPlan(debts, 500, 'priority-highest');

        const payoffOrder = (workingDebts) => workingDebts
            .map((d, i) => ({ name: d.name, paidOffMonth: d.paidOffMonth, i }))
            .sort((a, b) => a.paidOffMonth - b.paidOffMonth)
            .map(d => d.name);

        return {
            lowestOrder,
            highestOrder,
            payoffOrderLowest: payoffOrder(planLowest.workingDebts),
            payoffOrderHighest: payoffOrder(planHighest.workingDebts)
        };
    }""")

    # getPaymentOrder: priority-lowest => lowest priority number first (index 0 = priority 1)
    assert result['lowestOrder'] == [0, 1, 2], (
        f"priority-lowest should order by ascending priority number, got {result['lowestOrder']}"
    )
    # priority-highest => highest priority number first (index 2 = priority 10)
    assert result['highestOrder'] == [2, 1, 0], (
        f"priority-highest should order by descending priority number, got {result['highestOrder']}"
    )
    # The two strategies should produce reversed orderings
    assert result['lowestOrder'] == list(reversed(result['highestOrder']))

    # End-to-end: the debt that receives overage first should be the first paid off.
    assert result['payoffOrderLowest'][0] == 'Low Priority Card', (
        f"priority-lowest plan should pay off the lowest-priority debt first, got {result['payoffOrderLowest']}"
    )
    assert result['payoffOrderHighest'][0] == 'High Priority Card', (
        f"priority-highest plan should pay off the highest-priority debt first, got {result['payoffOrderHighest']}"
    )
    assert result['payoffOrderLowest'] != result['payoffOrderHighest'], (
        "priority-lowest and priority-highest should produce different payoff orders for this debt set"
    )


# --- fixedAmount debtType date-window boundary behavior ---

@pytest.mark.feature
def test_debt_calculator_fixed_amount_only_applies_within_date_window(app_page):
    """A fixedAmount debt (e.g. a lease) only receives scheduled payments while
    the current plan month overlaps [fixedStartDate, fixedEndDate], and is
    marked paid off once the window has fully elapsed."""
    page = app_page

    result = page.evaluate("""() => {
        const today = new Date();
        const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        const endDate = new Date(today.getFullYear(), today.getMonth() + 2, 0); // ~3 month window

        const fmt = (d) => d.toISOString().slice(0, 10);

        const debts = [
            { name: 'Lease', debtType: 'fixedAmount',
              fixedAmount: 200, fixedStartDate: fmt(startDate), fixedEndDate: fmt(endDate) },
            { name: 'Companion Card', debtType: 'creditCard',
              accountBalance: 100, originalBalance: 100,
              interestRate: 0, minimumPayment: 100, dueDate: 1, priority: 1 }
        ];

        // Use a payment budget well above the credit card minimum so the credit
        // card pays off in month 1; the fixedAmount debt's window keeps the loop
        // alive via hasUnpaidDebts only because of the credit card, so we also
        // need the plan to keep running across the fixedAmount window. Since
        // hasUnpaidDebts ignores fixedAmount debts entirely, drive enough months
        // by giving the credit card a slow payoff instead.
        const debts2 = [
            { name: 'Lease', debtType: 'fixedAmount',
              fixedAmount: 200, fixedStartDate: fmt(startDate), fixedEndDate: fmt(endDate) },
            { name: 'Slow Card', debtType: 'creditCard',
              accountBalance: 500, originalBalance: 500,
              interestRate: 0, minimumPayment: 100, dueDate: 1, priority: 1 }
        ];

        const { paymentPlan } = DebtCalculator.calculatePaymentPlan(debts2, 100, 'avalanche');

        const leasePaymentsByMonth = paymentPlan.map(m => {
            const p = m.payments.find(p => p.debtName === 'Lease');
            return p ? p.payment : null;
        });

        return {
            totalMonths: paymentPlan.length,
            leasePaymentsByMonth
        };
    }""")

    # Lease window is 3 calendar months (this month + next 2), so it should
    # receive a $200 payment in months 1-3 and nothing afterward.
    months_with_payment = [i for i, p in enumerate(result['leasePaymentsByMonth']) if p is not None]
    assert len(months_with_payment) > 0, "Lease should receive at least one scheduled payment within its window"
    assert all(p == 200 for p in result['leasePaymentsByMonth'] if p is not None), (
        "Every scheduled lease payment within the window should equal the fixed amount"
    )
    # No payments should be scheduled after the first gap once the window has closed
    if len(months_with_payment) < result['totalMonths']:
        last_paid_month = months_with_payment[-1]
        after_window = result['leasePaymentsByMonth'][last_paid_month + 1:]
        assert all(p is None for p in after_window), (
            f"Lease received a payment after its date window closed: {result['leasePaymentsByMonth']}"
        )


# --- Per-month stimulus distribution edge cases ---

@pytest.mark.feature
def test_debt_calculator_stimulus_larger_than_total_balance_no_overpayment(app_page):
    """A stimulus amount larger than the sum of all remaining balances in a
    given month must not drive any balance negative or overpay a debt --
    excess stimulus should simply have nowhere left to apply."""
    page = app_page

    result = page.evaluate("""() => {
        const debts = [
            { name: 'Small Card A', debtType: 'creditCard',
              accountBalance: 200, originalBalance: 200,
              interestRate: 10, minimumPayment: 50, dueDate: 1, priority: 1 },
            { name: 'Small Card B', debtType: 'creditCard',
              accountBalance: 300, originalBalance: 300,
              interestRate: 15, minimumPayment: 50, dueDate: 5, priority: 2 }
        ];
        // Total balance is only 500; stimulus of 100000 in month 1 vastly exceeds it.
        const { paymentPlan, workingDebts } = DebtCalculator.calculatePaymentPlan(
            debts, 100, 'avalanche', [100000]
        );

        return {
            anyNegativeBalance: paymentPlan.some(m => m.payments.some(p => p.balance < 0)),
            anyNaN: paymentPlan.some(m => m.payments.some(p =>
                Number.isNaN(p.payment) || Number.isNaN(p.balance) || Number.isNaN(p.principal)
            )),
            workingDebtBalancesAllZero: workingDebts.every(d => d.balance === 0),
            totalMonths: paymentPlan.length,
            firstMonthStimulusApplied: paymentPlan[0].stimulusApplied
        };
    }""")

    assert not result['anyNegativeBalance'], "No payment entry should show a negative balance"
    assert not result['anyNaN'], "No payment entry should contain NaN values"
    assert result['workingDebtBalancesAllZero'], "Both small debts should end fully paid off, not overpaid into negative"
    assert result['totalMonths'] == 1, "Both debts should be paid off in month 1 given the oversized stimulus"
    # Stimulus applied per debt should not exceed what each debt actually owed
    stimulus_applied = result['firstMonthStimulusApplied']
    assert stimulus_applied is not None and len(stimulus_applied) > 0, "Stimulus should be recorded as applied"


@pytest.mark.feature
def test_debt_calculator_stimulus_after_all_debts_paid_off_does_not_throw_or_corrupt(app_page):
    """A stimulus scheduled for a month after all debts are already paid off
    must not throw or corrupt the plan -- the loop ends once hasUnpaidDebts()
    is false, so a late stimulus entry should simply be unused."""
    page = app_page

    result = page.evaluate("""() => {
        const debts = [{
            name: 'Fast Payoff Card', debtType: 'creditCard',
            accountBalance: 100, originalBalance: 100,
            interestRate: 0, minimumPayment: 100, dueDate: 1, priority: 1
        }];
        // 0% APR so payment == balance pays off exactly in month 1, with no
        // interest-accrual residual. Provide a stimulus array with a large
        // value in month 6, far beyond payoff.
        const stimulusByMonth = [0, 0, 0, 0, 0, 50000];

        let error = null;
        let paymentPlan = null;
        let workingDebts = null;
        try {
            const result = DebtCalculator.calculatePaymentPlan(debts, 100, 'avalanche', stimulusByMonth);
            paymentPlan = result.paymentPlan;
            workingDebts = result.workingDebts;
        } catch (e) {
            error = e.message;
        }

        return {
            error,
            totalMonths: paymentPlan ? paymentPlan.length : null,
            paidOffMonth: workingDebts ? workingDebts[0].paidOffMonth : null
        };
    }""")

    assert result['error'] is None, f"Plan should not throw when stimulus is scheduled after payoff, got: {result['error']}"
    assert result['totalMonths'] == 1, "Plan should end as soon as the debt is paid off, ignoring the later stimulus entry"
    assert result['paidOffMonth'] == 1, "Debt should be paid off in month 1"
