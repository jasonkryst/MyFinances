const DebtCalculator = require('../../src/debtCalculator.js');

const cc = (name, balance, min, rate, extra = {}) => ({
    name, debtType: 'creditCard', accountBalance: balance, minimumPayment: min, interestRate: rate, ...extra,
});
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysInMonthOffset = (offset) => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth() + offset + 1, 0).getDate();
};
const interestFor = (balance, rate, days) => balance * (Math.pow(1 + rate / 100 / 365, days) - 1);

describe('calculatePaymentPlan — month dates and interest', () => {
    test('month entries carry month number, first-of-month dates and cumulative balances', () => {
        const { paymentPlan } = DebtCalculator.calculatePaymentPlan([cc('A', 300, 100, 0)], 100);
        expect(paymentPlan.map(m => m.month)).toEqual([1, 2, 3]);
        const n = new Date();
        paymentPlan.forEach((m, i) => {
            expect(m.date.getTime()).toBe(new Date(n.getFullYear(), n.getMonth() + i).getTime());
            expect(m.stimulusApplied).toEqual({});
        });
        expect(paymentPlan.map(m => m.payments[0].balance)).toEqual([200, 100, 0]);
        expect(paymentPlan[2].payments[0].paidOff).toBe(true);
        expect(paymentPlan[1].payments[0].paidOff).toBe(false);
        expect(paymentPlan[0].payments[0].isMinimum).toBe(true);
    });

    test('first month interest uses daily compounding over the real days in month', () => {
        const { paymentPlan, workingDebts } = DebtCalculator.calculatePaymentPlan([cc('A', 1000, 100, 24)], 100);
        const p = paymentPlan[0].payments[0];
        const i1 = interestFor(1000, 24, daysInMonthOffset(0));
        expect(p.interest).toBeCloseTo(i1, 2);
        expect(p.payment).toBe(100);
        expect(p.principal).toBeCloseTo(100 - i1, 2);
        expect(p.balance).toBeCloseTo(1000 - (100 - i1), 2);
        expect(workingDebts[0].totalInterest).toBeGreaterThan(i1);
        expect(workingDebts[0].totalPrincipal).toBeCloseTo(1000, 1);
        expect(workingDebts[0].paidOffMonth).toBe(paymentPlan.length);
    });

    test('missing interestRate is treated as 0%', () => {
        const d = { name: 'A', debtType: 'creditCard', accountBalance: 200, minimumPayment: 100 };
        const { workingDebts, paymentPlan } = DebtCalculator.calculatePaymentPlan([d], 100);
        expect(workingDebts[0].totalInterest).toBe(0);
        expect(paymentPlan).toHaveLength(2);
    });

    test('does not mutate the input debts', () => {
        const d = cc('A', 500, 50, 10);
        const copy = JSON.parse(JSON.stringify(d));
        DebtCalculator.calculatePaymentPlan([d], 100);
        expect(d).toEqual(copy);
    });

    test('final minimum payment is capped at balance plus interest and zeroes the balance', () => {
        const { paymentPlan } = DebtCalculator.calculatePaymentPlan([cc('A', 150, 100, 0)], 100);
        expect(paymentPlan).toHaveLength(2);
        expect(paymentPlan[1].payments[0].payment).toBe(50);
        expect(paymentPlan[1].payments[0].balance).toBe(0);
    });

    test('balance within a cent of zero counts as paid off', () => {
        const { workingDebts } = DebtCalculator.calculatePaymentPlan([cc('A', 100.005, 100, 0)], 100);
        expect(workingDebts[0].paidOffMonth).toBe(1);
        expect(workingDebts[0].balance).toBe(0);
    });

    test('a debt with a zero minimum receives nothing in the first pass but takes overage', () => {
        const { paymentPlan } = DebtCalculator.calculatePaymentPlan([cc('A', 100, 0, 0)], 60);
        const p = paymentPlan[0].payments;
        expect(p).toHaveLength(1);
        expect(p[0].isExtra).toBe(true);
        expect(p[0].isMinimum).toBeUndefined();
        expect(p[0].payment).toBe(60);
        expect(p[0].interest).toBe(0);
        expect(p[0].principal).toBe(60);
        expect(p[0].balance).toBe(40);
        expect(p[0].paidOff).toBe(false);
        expect(paymentPlan).toHaveLength(2);
        expect(paymentPlan[1].payments[0].payment).toBe(40);
        expect(paymentPlan[1].payments[0].paidOff).toBe(true);
    });
});

describe('calculatePaymentPlan — overage allocation', () => {
    test('overage merges into the minimum entry (payment, principal, balance, paidOff)', () => {
        const debts = [cc('A', 500, 50, 0)];
        const { paymentPlan } = DebtCalculator.calculatePaymentPlan(debts, 200);
        const p = paymentPlan[0].payments;
        expect(p).toHaveLength(1);
        expect(p[0]).toMatchObject({ payment: 200, principal: 200, interest: 0, balance: 300, paidOff: false, isMinimum: true });
        expect(p[0].isExtra).toBeUndefined();
        expect(paymentPlan).toHaveLength(3);
        expect(paymentPlan[2].payments[0]).toMatchObject({ payment: 100, balance: 0, paidOff: true });
    });

    test('overage that clears a debt marks the merged entry paid off', () => {
        const debts = [cc('A', 100, 10, 0), cc('B', 1000, 10, 0)];
        const { paymentPlan, workingDebts } = DebtCalculator.calculatePaymentPlan(debts, 200, 'snowball');
        const a = paymentPlan[0].payments.find(x => x.debtIndex === 0);
        expect(a.paidOff).toBe(true);
        expect(a.balance).toBe(0);
        expect(a.payment).toBe(100);
        expect(workingDebts[0].paidOffMonth).toBe(1);
        const b = paymentPlan[0].payments.find(x => x.debtIndex === 1);
        expect(b.payment).toBe(100);
        expect(b.balance).toBe(900);
    });

    test('overage spills over to the next debt in order when the first is cleared', () => {
        const debts = [cc('Small', 50, 5, 0), cc('Big', 500, 5, 0)];
        const { paymentPlan } = DebtCalculator.calculatePaymentPlan(debts, 100, 'snowball');
        const m1 = paymentPlan[0].payments;
        expect(m1.find(x => x.debtIndex === 0).payment).toBe(50);
        expect(m1.find(x => x.debtIndex === 1).payment).toBe(50);
        expect(paymentPlan[1].payments.find(x => x.debtIndex === 0)).toBeUndefined();
    });

    test('overage with interest accrues interest into the merged payment', () => {
        const { paymentPlan } = DebtCalculator.calculatePaymentPlan([cc('A', 1000, 50, 20)], 300);
        const p = paymentPlan[0].payments[0];
        const interest = interestFor(1000, 20, daysInMonthOffset(0));
        expect(p.interest).toBeCloseTo(interest, 2);
        expect(p.payment).toBeCloseTo(300, 2);
        expect(p.balance).toBeLessThan(1000 - 300 + interest + 20);
        expect(p.balance).toBeGreaterThan(1000 - 300);
    });

    test('a paid-off debt gets no entries in later months', () => {
        const debts = [cc('A', 100, 100, 0), cc('B', 300, 100, 0)];
        const { paymentPlan } = DebtCalculator.calculatePaymentPlan(debts, 200, 'avalanche');
        expect(paymentPlan).toHaveLength(2);
        expect(paymentPlan[1].payments.map(p => p.debtIndex)).toEqual([1]);
        expect(paymentPlan[1].payments[0].payment).toBe(200);
        expect(paymentPlan[1].payments[0].paidOff).toBe(true);
    });
});

describe('calculatePaymentPlan — strategies', () => {
    test('priority-lowest plan pays the lowest-priority debt first', () => {
        const d = [cc('Hi', 500, 10, 0, { priority: 9 }), cc('Lo', 500, 10, 0, { priority: 1 })];
        const { paymentPlan } = DebtCalculator.calculatePaymentPlan(d, 110, 'priority-lowest');
        expect(paymentPlan[0].payments.find(p => p.debtIndex === 1).payment).toBe(100);
        expect(paymentPlan[0].payments.find(p => p.debtIndex === 0).payment).toBe(10);
    });
    test('priority-highest plan pays the highest-priority debt first', () => {
        const d = [cc('Hi', 500, 10, 0, { priority: 9 }), cc('Lo', 500, 10, 0, { priority: 1 })];
        const { paymentPlan } = DebtCalculator.calculatePaymentPlan(d, 110, 'priority-highest');
        expect(paymentPlan[0].payments.find(p => p.debtIndex === 0).payment).toBe(100);
        expect(paymentPlan[0].payments.find(p => p.debtIndex === 1).payment).toBe(10);
    });
    test('avalanche saves interest versus snowball when the high-rate debt is the bigger one', () => {
        const d = [cc('Small', 200, 10, 5), cc('BigHigh', 3000, 30, 25)];
        const av = DebtCalculator.calculatePaymentPlan(d, 300, 'avalanche').workingDebts;
        const sn = DebtCalculator.calculatePaymentPlan(d, 300, 'snowball').workingDebts;
        const sum = w => w.reduce((s, x) => s + x.totalInterest, 0);
        expect(sum(av)).toBeLessThan(sum(sn));
    });
    test('default strategy is avalanche', () => {
        const d = [cc('Low', 500, 10, 5), cc('High', 500, 10, 25)];
        const a = DebtCalculator.calculatePaymentPlan(d, 100);
        const b = DebtCalculator.calculatePaymentPlan(d, 100, 'avalanche');
        expect(a.paymentPlan[0].payments).toEqual(b.paymentPlan[0].payments);
        expect(a.paymentPlan[0].payments.find(p => p.debtIndex === 1).payment)
            .toBeGreaterThan(a.paymentPlan[0].payments.find(p => p.debtIndex === 0).payment);
    });
});

describe('calculatePaymentPlan — stimulus', () => {
    test('scalar stimulus is applied every month as principal-only to the first debt in order', () => {
        const { paymentPlan, workingDebts } = DebtCalculator.calculatePaymentPlan([cc('A', 1000, 100, 0)], 100, 'avalanche', 200);
        const m1 = paymentPlan[0];
        expect(m1.payments).toHaveLength(1);
        expect(m1.payments[0]).toMatchObject({ payment: 300, principal: 300, interest: 0, balance: 700, isStimulus: true, paidOff: false });
        expect(m1.stimulusApplied).toEqual({ A: 200 });
        expect(paymentPlan).toHaveLength(4);
        expect(workingDebts[0].paidOffMonth).toBe(4);
        expect(paymentPlan[2].stimulusApplied).toEqual({ A: 200 });
        expect(paymentPlan[2].payments[0].balance).toBe(100);
        expect(paymentPlan[3].stimulusApplied).toEqual({});
        expect(paymentPlan[3].payments[0].paidOff).toBe(true);
    });

    test('array stimulus applies per month, missing entries count as 0', () => {
        const { paymentPlan } = DebtCalculator.calculatePaymentPlan([cc('A', 1000, 100, 0)], 100, 'avalanche', [0, 300]);
        expect(paymentPlan[0].stimulusApplied).toEqual({});
        expect(paymentPlan[0].payments[0].isStimulus).toBeUndefined();
        expect(paymentPlan[1].stimulusApplied).toEqual({ A: 300 });
        expect(paymentPlan[1].payments[0]).toMatchObject({ payment: 400, balance: 500, isStimulus: true });
        expect(paymentPlan[2].stimulusApplied).toEqual({});
    });

    test('stimulus under a cent is ignored, falsy/NaN stimulus is ignored', () => {
        const base = DebtCalculator.calculatePaymentPlan([cc('A', 300, 100, 0)], 100, 'avalanche', 0).paymentPlan;
        const tiny = DebtCalculator.calculatePaymentPlan([cc('A', 300, 100, 0)], 100, 'avalanche', 0.005).paymentPlan;
        const nul = DebtCalculator.calculatePaymentPlan([cc('A', 300, 100, 0)], 100, 'avalanche', null).paymentPlan;
        const arr = DebtCalculator.calculatePaymentPlan([cc('A', 300, 100, 0)], 100, 'avalanche', [undefined, null]).paymentPlan;
        expect(tiny).toHaveLength(base.length);
        expect(nul).toHaveLength(3);
        expect(arr).toHaveLength(3);
        expect(tiny[0].stimulusApplied).toEqual({});
        expect(tiny[0].payments[0].isStimulus).toBeUndefined();
    });

    test('stimulus is capped at the balance and the remainder flows to the next debt by strategy', () => {
        const d = [cc('Small', 50, 5, 0), cc('Big', 1000, 5, 0)];
        const { paymentPlan, workingDebts } = DebtCalculator.calculatePaymentPlan(d, 10, 'snowball', [500]);
        const m1 = paymentPlan[0];
        expect(m1.stimulusApplied.Small).toBe(45);
        expect(m1.stimulusApplied.Big).toBe(455);
        const small = m1.payments.find(p => p.debtIndex === 0);
        expect(small.balance).toBe(0);
        expect(small.payment).toBe(50);
        expect(workingDebts[0].paidOffMonth).toBe(1);
        const big = m1.payments.find(p => p.debtIndex === 1);
        expect(big.balance).toBe(540);
        expect(big.isStimulus).toBe(true);
    });

    test('stimulus creates a new entry for a debt with no payment entry this month', () => {
        const d = [cc('Zero', 400, 0, 0), cc('Pay', 400, 10, 0)];
        const { paymentPlan } = DebtCalculator.calculatePaymentPlan(d, 10, 'snowball', [100]);
        const m1 = paymentPlan[0];
        const zero = m1.payments.find(p => p.debtIndex === 0);
        expect(zero).toMatchObject({ debtName: 'Zero', payment: 100, principal: 100, interest: 0, balance: 300, paidOff: false, isStimulus: true });
        expect(zero.isExtra).toBeUndefined();
        expect(zero.isMinimum).toBeUndefined();
        expect(m1.stimulusApplied).toEqual({ Zero: 100 });
    });

    test('stimulus accumulates in stimulusApplied across debts with the same name', () => {
        const d = [cc('Same', 20, 5, 0), cc('Same', 500, 5, 0)];
        const { paymentPlan } = DebtCalculator.calculatePaymentPlan(d, 10, 'snowball', [100]);
        expect(paymentPlan[0].stimulusApplied.Same).toBe(100);
    });

    test('stimulus skips fixed-amount debts', () => {
        const now = new Date();
        const d = [
            { name: 'Rent', debtType: 'fixedAmount', fixedAmount: 100, fixedStartDate: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), fixedEndDate: iso(new Date(now.getFullYear(), now.getMonth() + 5, 1)) },
            cc('Card', 300, 50, 0),
        ];
        const { paymentPlan } = DebtCalculator.calculatePaymentPlan(d, 200, 'avalanche', 100);
        expect(paymentPlan[0].stimulusApplied).toEqual({ Card: 100 });
        expect(paymentPlan[0].payments.find(p => p.debtName === 'Rent').isStimulus).toBeUndefined();
    });
});

describe('calculatePaymentPlan — fixed-amount debts', () => {
    const now = new Date();
    const rel = (m, day = 1) => iso(new Date(now.getFullYear(), now.getMonth() + m, day));

    test('fixed debt payments are principal-only, deduct from the budget and total up', () => {
        const d = [
            { name: 'Rent', debtType: 'fixedAmount', fixedAmount: 100, fixedStartDate: rel(-1), fixedEndDate: rel(3) },
            cc('Card', 300, 50, 0),
        ];
        const { paymentPlan, workingDebts } = DebtCalculator.calculatePaymentPlan(d, 150, 'avalanche');
        const rent = paymentPlan[0].payments.find(p => p.debtIndex === 0);
        expect(rent).toEqual({ debtIndex: 0, debtName: 'Rent', payment: 100, principal: 100, interest: 0, balance: 100, paidOff: false });
        const card = paymentPlan[0].payments.find(p => p.debtIndex === 1);
        expect(card.payment).toBe(50);
        expect(card.isExtra).toBeUndefined();
        expect(paymentPlan).toHaveLength(5);
        expect(paymentPlan.slice(0, 4).every(m => m.payments.some(p => p.debtIndex === 0))).toBe(true);
        expect(paymentPlan[4].payments.some(p => p.debtIndex === 0)).toBe(false);
        expect(workingDebts[0].totalPrincipal).toBe(400);
        expect(workingDebts[0].totalInterest).toBe(0);
        expect(workingDebts[0].balance).toBe(100);
        expect(workingDebts[0].remainingMonths).toBe(DebtCalculator.calculateMonthsBetweenDates(new Date(rel(-1)), new Date(rel(3))));
        expect(workingDebts[1].remainingMonths).toBeNull();
    });

    test('fixed debt gets paidOffMonth once the date range has ended', () => {
        const d = [
            { name: 'Old', debtType: 'fixedAmount', fixedAmount: 100, fixedStartDate: rel(-6), fixedEndDate: rel(-3) },
            cc('Card', 200, 100, 0),
        ];
        const { paymentPlan, workingDebts } = DebtCalculator.calculatePaymentPlan(d, 100, 'avalanche');
        expect(workingDebts[0].paidOffMonth).toBe(1);
        expect(paymentPlan[0].payments.some(p => p.debtIndex === 0)).toBe(false);
        expect(workingDebts[0].totalPrincipal).toBe(0);
    });

    test('fixed debt that has not started yet gets no payment and is not marked paid off', () => {
        const d = [
            { name: 'Future', debtType: 'fixedAmount', fixedAmount: 100, fixedStartDate: rel(3), fixedEndDate: rel(6) },
            cc('Card', 200, 100, 0),
        ];
        const { paymentPlan, workingDebts } = DebtCalculator.calculatePaymentPlan(d, 100, 'avalanche');
        expect(paymentPlan[0].payments.some(p => p.debtIndex === 0)).toBe(false);
        expect(workingDebts[0].paidOffMonth).toBeNull();
    });

    test('fixed debt ending mid current month is still paid that month, then paid off next month', () => {
        const d = [
            { name: 'Short', debtType: 'fixedAmount', fixedAmount: 40, fixedStartDate: rel(-2), fixedEndDate: rel(0, 28) },
            cc('Card', 300, 100, 0),
        ];
        const { paymentPlan, workingDebts } = DebtCalculator.calculatePaymentPlan(d, 150, 'avalanche');
        expect(paymentPlan[0].payments.find(p => p.debtIndex === 0).payment).toBe(40);
        expect(paymentPlan[1].payments.some(p => p.debtIndex === 0)).toBe(false);
        expect(workingDebts[0].paidOffMonth).toBe(2);
    });

    test('only fixed-amount debts: loop never runs and returns an empty plan', () => {
        const d = [{ name: 'Rent', debtType: 'fixedAmount', fixedAmount: 100, fixedStartDate: rel(-1), fixedEndDate: rel(3) }];
        const { paymentPlan } = DebtCalculator.calculatePaymentPlan(d, 100);
        expect(paymentPlan).toEqual([]);
    });
});

describe('calculatePaymentPlan — errors and limits', () => {
    test('error messages include formatted amounts', () => {
        expect(() => DebtCalculator.calculatePaymentPlan([cc('A', 100, 80, 0), cc('B', 100, 40.5, 0)], 100))
            .toThrow('Monthly payment of 100.00 is less than total minimum payments required (120.50). Please increase your payment amount.');
    });
    test('specific messages for empty / null debts and non-positive payment', () => {
        expect(() => DebtCalculator.calculatePaymentPlan([], 100)).toThrow('No debts provided');
        expect(() => DebtCalculator.calculatePaymentPlan(null, 100)).toThrow('No debts provided');
        expect(() => DebtCalculator.calculatePaymentPlan([cc('A', 1, 0, 0)], 0)).toThrow('Monthly payment must be greater than 0');
        expect(() => DebtCalculator.calculatePaymentPlan([cc('A', 1, 0, 0)], -5)).toThrow('Monthly payment must be greater than 0');
    });
    test('payment exactly equal to the total minimum is accepted', () => {
        expect(() => DebtCalculator.calculatePaymentPlan([cc('A', 100, 50, 0), cc('B', 100, 50, 0)], 100)).not.toThrow();
    });
    test('debts without minimumPayment count as 0 minimum', () => {
        const d = [{ name: 'A', debtType: 'creditCard', accountBalance: 100, interestRate: 0 }];
        const { paymentPlan } = DebtCalculator.calculatePaymentPlan(d, 50);
        expect(paymentPlan).toHaveLength(2);
        expect(paymentPlan[0].payments[0].payment).toBe(50);
    });
    test('599 months is allowed, 601 throws', () => {
        expect(DebtCalculator.calculatePaymentPlan([cc('A', 599, 1, 0)], 1).paymentPlan).toHaveLength(599);
        expect(() => DebtCalculator.calculatePaymentPlan([cc('A', 601, 1, 0)], 1))
            .toThrow('Payment plan exceeds 50 years. Monthly payment may be too low.');
    });
    test('zero-balance debt produces an empty plan', () => {
        const { paymentPlan } = DebtCalculator.calculatePaymentPlan([cc('A', 0, 0, 0)], 10);
        expect(paymentPlan).toEqual([]);
    });
});

describe('calculateMonthsBetweenDates / formatDate — extra', () => {
    test('counts a partial trailing month as a whole month', () => {
        expect(DebtCalculator.calculateMonthsBetweenDates(new Date(2026, 0, 1), new Date(2026, 0, 2))).toBe(1);
        expect(DebtCalculator.calculateMonthsBetweenDates(new Date(2026, 0, 1), new Date(2026, 3, 1))).toBe(3);
        expect(DebtCalculator.calculateMonthsBetweenDates(new Date(2026, 0, 1), new Date(2026, 3, 2))).toBe(4);
        expect(DebtCalculator.calculateMonthsBetweenDates(new Date(2025, 10, 15), new Date(2026, 1, 15))).toBe(3);
    });
    test('does not mutate its arguments and accepts ISO strings', () => {
        const s = new Date(2026, 0, 1);
        const e = new Date(2026, 5, 1);
        const sT = s.getTime();
        DebtCalculator.calculateMonthsBetweenDates(s, e);
        expect(s.getTime()).toBe(sT);
        expect(DebtCalculator.calculateMonthsBetweenDates('2026-01-01T12:00:00', '2026-03-01T12:00:00')).toBe(2);
    });
    test('formatDate uses full month name, numeric day and year', () => {
        expect(DebtCalculator.formatDate(new Date(2026, 6, 4))).toBe('July 4, 2026');
        expect(DebtCalculator.formatDate(new Date(2025, 11, 31))).toBe('December 31, 2025');
    });
});
