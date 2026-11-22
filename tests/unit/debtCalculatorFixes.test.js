// Regression tests for #671, #672 and #673 (payoff engine fixes, 7.22.1).
const DebtCalculator = require('../../src/debtCalculator.js');

const card = (name, accountBalance, minimumPayment, interestRate) =>
    ({ name, debtType: 'creditCard', accountBalance, minimumPayment, interestRate });

const sumInterest = plan => plan.reduce((s, m) => s + m.payments.reduce((t, p) => t + p.interest, 0), 0);

describe('#671: the 50-year cap', () => {
    test('a plan finishing in exactly month 600 is returned', () => {
        const { paymentPlan, workingDebts } = DebtCalculator.calculatePaymentPlan([card('A', 600, 1, 0)], 1);
        expect(paymentPlan).toHaveLength(600);
        expect(workingDebts[0].paidOffMonth).toBe(600);
    });

    test('a plan still unpaid after month 600 throws', () => {
        expect(() => DebtCalculator.calculatePaymentPlan([card('A', 601, 1, 0)], 1))
            .toThrow('Payment plan exceeds 50 years');
    });

    test('a 599-month plan is unaffected', () => {
        expect(DebtCalculator.calculatePaymentPlan([card('A', 599, 1, 0)], 1).paymentPlan).toHaveLength(599);
    });
});

describe('#672: overage never charges a second month of interest', () => {
    test('principal + interest equals the payment on a merged entry', () => {
        const { paymentPlan, workingDebts } = DebtCalculator.calculatePaymentPlan([card('A', 1000, 50, 20)], 300);
        for (const month of paymentPlan) {
            for (const p of month.payments) {
                expect(p.principal + p.interest).toBeCloseTo(p.payment, 1);
            }
        }
        const first = paymentPlan[0].payments[0];
        expect(first.payment).toBe(300);
        // The balance drops by the payment minus one month of interest.
        expect(first.balance).toBeCloseTo(1000 - (300 - first.interest), 1);
        // Total interest in the plan equals the per-entry interest (counted once).
        expect(workingDebts[0].totalInterest).toBeCloseTo(sumInterest(paymentPlan), 1);
    });

    test('one month of interest, whether paid as minimum or as minimum + extra', () => {
        // Same debt, same total payment: a $300 minimum vs a $50 minimum + $250 extra
        // must produce the same schedule.
        const asMinimum = DebtCalculator.calculatePaymentPlan([card('A', 1000, 300, 20)], 300);
        const withExtra = DebtCalculator.calculatePaymentPlan([card('A', 1000, 50, 20)], 300);
        expect(withExtra.paymentPlan).toHaveLength(asMinimum.paymentPlan.length);
        expect(withExtra.workingDebts[0].totalInterest).toBeCloseTo(asMinimum.workingDebts[0].totalInterest, 2);
        expect(withExtra.paymentPlan[0].payments[0].balance).toBeCloseTo(asMinimum.paymentPlan[0].payments[0].balance, 2);
    });

    test('extra money pays the interest a too-small minimum left unpaid', () => {
        // $10 minimum on $1000 at 24%: the month's ~$20 interest exceeds the minimum.
        const { paymentPlan } = DebtCalculator.calculatePaymentPlan([card('A', 1000, 10, 24)], 100);
        const entry = paymentPlan[0].payments[0];
        const monthInterest = entry.interest;
        expect(monthInterest).toBeGreaterThan(10);
        expect(entry.payment).toBe(100);
        expect(entry.principal).toBeCloseTo(100 - monthInterest, 1);
    });

    test('a debt with no minimum still pays its month of interest from the overage', () => {
        const { paymentPlan } = DebtCalculator.calculatePaymentPlan([card('A', 1000, 0, 12)], 100);
        const entry = paymentPlan[0].payments[0];
        expect(entry.isExtra).toBe(true);
        expect(entry.interest).toBeGreaterThan(9);
        expect(entry.principal + entry.interest).toBeCloseTo(100, 1);
    });

    test('at 0% interest nothing changes', () => {
        const { paymentPlan, workingDebts } = DebtCalculator.calculatePaymentPlan([card('A', 1000, 50, 0)], 250);
        expect(paymentPlan).toHaveLength(4);
        expect(workingDebts[0].totalInterest).toBe(0);
    });
});

describe('#673: a stimulus payoff marks the entry paid off', () => {
    test('existing minimum entry gets paidOff when the stimulus clears it', () => {
        const { paymentPlan, workingDebts } = DebtCalculator.calculatePaymentPlan(
            [card('Small', 50, 5, 0), card('Big', 1000, 5, 0)], 10, 'snowball', [500]);
        const small = paymentPlan[0].payments.find(p => p.debtName === 'Small');
        expect(small.balance).toBe(0);
        expect(small.isStimulus).toBe(true);
        expect(small.paidOff).toBe(true);
        expect(workingDebts[0].paidOffMonth).toBe(1);
        // Negative: the debt the stimulus only reduced is not marked.
        const big = paymentPlan[0].payments.find(p => p.debtName === 'Big');
        expect(big.balance).toBeGreaterThan(0);
        expect(big.paidOff).toBe(false);
    });
});
