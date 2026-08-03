const DebtCalculator = require('../../src/debtCalculator.js');

describe('calculatePaymentPlan — positive cases', () => {
    test('single 0%-interest debt is paid off in exactly balance/payment months with zero interest', () => {
        const debts = [{
            name: 'Card A',
            debtType: 'creditCard',
            accountBalance: 1000,
            minimumPayment: 100,
            interestRate: 0,
        }];

        const { paymentPlan, workingDebts } = DebtCalculator.calculatePaymentPlan(debts, 100, 'avalanche');

        expect(paymentPlan).toHaveLength(10);
        expect(workingDebts[0].paidOffMonth).toBe(10);
        expect(workingDebts[0].totalInterest).toBe(0);
        expect(workingDebts[0].totalPrincipal).toBeCloseTo(1000, 5);
    });

    test('avalanche strategy sends overage to the highest-APR debt first', () => {
        // Both debts' $25 minimum is > 0, so both get a first-pass payment entry;
        // the $50 overage then merges into whichever entry the strategy prioritizes
        // (calculatePaymentPlan's overage merge path does not set an `isExtra` flag
        // when merging into an existing entry — only when creating a brand-new one —
        // so assert on the resulting dollar amount, not on `isExtra`).
        const debts = [
            { name: 'Low APR', debtType: 'creditCard', accountBalance: 500, minimumPayment: 25, interestRate: 10 },
            { name: 'High APR', debtType: 'creditCard', accountBalance: 500, minimumPayment: 25, interestRate: 20 },
        ];

        const { paymentPlan } = DebtCalculator.calculatePaymentPlan(debts, 100, 'avalanche');
        const month1 = paymentPlan[0];

        const lowAprPayment = month1.payments.find(p => p.debtIndex === 0).payment;
        const highAprPayment = month1.payments.find(p => p.debtIndex === 1).payment;

        expect(highAprPayment).toBeGreaterThan(lowAprPayment);
    });

    test('snowball strategy sends overage to the lowest-balance debt first', () => {
        const debts = [
            { name: 'Big Balance', debtType: 'creditCard', accountBalance: 900, minimumPayment: 25, interestRate: 15 },
            { name: 'Small Balance', debtType: 'creditCard', accountBalance: 200, minimumPayment: 25, interestRate: 15 },
        ];

        const { paymentPlan } = DebtCalculator.calculatePaymentPlan(debts, 100, 'snowball');
        const month1 = paymentPlan[0];

        const bigBalancePayment = month1.payments.find(p => p.debtIndex === 0).payment;
        const smallBalancePayment = month1.payments.find(p => p.debtIndex === 1).payment;

        expect(smallBalancePayment).toBeGreaterThan(bigBalancePayment);
    });

    test('fixed-amount debt receives its fixed payment while within its date range', () => {
        // calculatePaymentPlan anchors month 1 to the real current date (not the
        // debt's own fixedStartDate), so the range must be computed relative to
        // "today" — a hardcoded date range would silently drift into the "already
        // ended" branch instead of the "payment due this month" branch as time passes.
        //
        // hasUnpaidDebts() always excludes fixedAmount debts from its "any unpaid"
        // check, so a debts list containing ONLY a fixed-amount debt never enters
        // the main loop at all (paymentPlan stays empty) — a companion credit-card
        // debt is required to keep the loop running for at least one month.
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        const toISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        const debts = [
            {
                name: 'Rent',
                debtType: 'fixedAmount',
                fixedAmount: 1000,
                fixedStartDate: toISO(start),
                fixedEndDate: toISO(end),
            },
            { name: 'Card', debtType: 'creditCard', accountBalance: 100, minimumPayment: 100, interestRate: 0 },
        ];

        const { paymentPlan } = DebtCalculator.calculatePaymentPlan(debts, 1100, 'avalanche');
        const month1Payment = paymentPlan[0].payments.find(p => p.debtIndex === 0);

        expect(month1Payment).toBeDefined();
        expect(month1Payment.payment).toBe(1000);
    });
});

describe('calculatePaymentPlan — negative cases', () => {
    test('throws when no debts are provided', () => {
        expect(() => DebtCalculator.calculatePaymentPlan([], 100)).toThrow('No debts provided');
        expect(() => DebtCalculator.calculatePaymentPlan(null, 100)).toThrow('No debts provided');
    });

    test('throws when monthlyPayment is zero or negative', () => {
        const debts = [{ name: 'Card', debtType: 'creditCard', accountBalance: 100, minimumPayment: 10, interestRate: 0 }];
        expect(() => DebtCalculator.calculatePaymentPlan(debts, 0)).toThrow('Monthly payment must be greater than 0');
        expect(() => DebtCalculator.calculatePaymentPlan(debts, -50)).toThrow('Monthly payment must be greater than 0');
    });

    test('throws when monthlyPayment is below total minimum payments', () => {
        const debts = [
            { name: 'Card A', debtType: 'creditCard', accountBalance: 1000, minimumPayment: 100, interestRate: 10 },
            { name: 'Card B', debtType: 'creditCard', accountBalance: 1000, minimumPayment: 100, interestRate: 10 },
        ];
        expect(() => DebtCalculator.calculatePaymentPlan(debts, 150)).toThrow(/less than total minimum payments/);
    });

    test('throws when the plan would exceed 600 months', () => {
        const debts = [{
            name: 'Huge Balance',
            debtType: 'creditCard',
            accountBalance: 1000000,
            minimumPayment: 1,
            interestRate: 30,
        }];
        expect(() => DebtCalculator.calculatePaymentPlan(debts, 1)).toThrow(/exceeds 50 years/);
    }, 15000);
});

describe('calculateMonthsBetweenDates', () => {
    test('counts whole calendar months between two dates', () => {
        expect(DebtCalculator.calculateMonthsBetweenDates(new Date(2026, 0, 1), new Date(2027, 0, 1))).toBe(12);
    });

    test('returns 0 when start equals end', () => {
        const d = new Date(2026, 5, 15);
        expect(DebtCalculator.calculateMonthsBetweenDates(d, d)).toBe(0);
    });

    test('returns 0 (not negative) when end is before start', () => {
        expect(DebtCalculator.calculateMonthsBetweenDates(new Date(2026, 5, 1), new Date(2026, 0, 1))).toBe(0);
    });
});

describe('formatDate', () => {
    test('formats a Date as a long US-locale string', () => {
        expect(DebtCalculator.formatDate(new Date(2026, 0, 15))).toBe('January 15, 2026');
    });
});
