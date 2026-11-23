// #681: promotional APR and deferred interest in the payoff engine.
const DebtCalculator = require('../../src/debtCalculator.js');

const JAN = new Date(2026, 0, 1);
const FEB = new Date(2026, 1, 1);
const MAR = new Date(2026, 2, 1);
const growth = (ratePct, days) => Math.pow(1 + ratePct / 100 / 365, days) - 1;
const card = (fields = {}) => ({
    name: 'Card', debtType: 'creditCard', accountBalance: 1000, interestRate: 24, minimumPayment: 100, ...fields,
});

beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 0, 10, 12, 0, 0)); // plan month 1 = January 2026
});
afterAll(() => jest.useRealTimers());

describe('hasPromo', () => {
    test('needs a 0-100 rate and a YYYY-MM-DD end date', () => {
        expect(DebtCalculator.hasPromo(card({ promoRate: 0, promoEndDate: '2026-03-31' }))).toBe(true);
        expect(DebtCalculator.hasPromo(card({ promoRate: 100, promoEndDate: '2026-03-31' }))).toBe(true);
        expect(DebtCalculator.hasPromo(card({ promoRate: 100.5, promoEndDate: '2026-03-31' }))).toBe(false);
        expect(DebtCalculator.hasPromo(card({ promoRate: -1, promoEndDate: '2026-03-31' }))).toBe(false);
        expect(DebtCalculator.hasPromo(card({ promoRate: '0', promoEndDate: '2026-03-31' }))).toBe(false);
        expect(DebtCalculator.hasPromo(card({ promoRate: NaN, promoEndDate: '2026-03-31' }))).toBe(false);
        expect(DebtCalculator.hasPromo(card({ promoRate: 0, promoEndDate: null }))).toBe(false);
        expect(DebtCalculator.hasPromo(card({ promoRate: 0, promoEndDate: '2026-3-31' }))).toBe(false);
        expect(DebtCalculator.hasPromo(card({ promoRate: 0, promoEndDate: 'x2026-03-31' }))).toBe(false);
        expect(DebtCalculator.hasPromo(card({ promoRate: 0, promoEndDate: '2026-03-31x' }))).toBe(false);
        expect(DebtCalculator.hasPromo(card())).toBe(false);
        expect(DebtCalculator.hasPromo(null)).toBe(false);
    });
});

describe('promoDaysInMonth / promoEndsInMonth', () => {
    const d = card({ promoRate: 0, promoEndDate: '2026-02-10' });
    test('whole month before the end, the end day in its month, none after', () => {
        expect(DebtCalculator.promoDaysInMonth(d, JAN, 31)).toBe(31);
        expect(DebtCalculator.promoDaysInMonth(d, FEB, 28)).toBe(10);
        expect(DebtCalculator.promoDaysInMonth(d, MAR, 31)).toBe(0);
        expect(DebtCalculator.promoDaysInMonth(card(), JAN, 31)).toBe(0);
    });
    test('the day is capped at the month length and years compare correctly', () => {
        expect(DebtCalculator.promoDaysInMonth(card({ promoRate: 0, promoEndDate: '2026-04-30' }), new Date(2026, 3, 1), 28)).toBe(28);
        expect(DebtCalculator.promoDaysInMonth(card({ promoRate: 0, promoEndDate: '2025-12-31' }), JAN, 31)).toBe(0);
        expect(DebtCalculator.promoDaysInMonth(card({ promoRate: 0, promoEndDate: '2027-01-01' }), new Date(2026, 11, 1), 31)).toBe(31);
    });
    test('promoEndsInMonth only in the end month', () => {
        expect(DebtCalculator.promoEndsInMonth(d, FEB)).toBe(true);
        expect(DebtCalculator.promoEndsInMonth(d, JAN)).toBe(false);
        expect(DebtCalculator.promoEndsInMonth(d, MAR)).toBe(false);
        expect(DebtCalculator.promoEndsInMonth(d, new Date(2027, 1, 1))).toBe(false);
        expect(DebtCalculator.promoEndsInMonth(card(), FEB)).toBe(false);
    });
});

describe('monthlyInterest / rateForMonth', () => {
    test('no promo: the regular daily-compounded rate', () => {
        expect(DebtCalculator.monthlyInterest(card(), 1000, JAN, 31)).toBeCloseTo(1000 * growth(24, 31), 10);
        expect(DebtCalculator.rateForMonth(card(), JAN, 31)).toBe(24);
        expect(DebtCalculator.rateForMonth({ promoRate: null }, JAN, 31)).toBe(0);
    });
    test('a whole promo month at 0% accrues nothing; a non-zero promo rate compounds', () => {
        const d = card({ promoRate: 0, promoEndDate: '2026-03-31' });
        expect(DebtCalculator.monthlyInterest(d, 1000, JAN, 31)).toBe(0);
        expect(DebtCalculator.rateForMonth(d, JAN, 31)).toBe(0);
        const d6 = card({ promoRate: 6, promoEndDate: '2026-03-31' });
        expect(DebtCalculator.monthlyInterest(d6, 1000, JAN, 31)).toBeCloseTo(1000 * growth(6, 31), 10);
        expect(DebtCalculator.rateForMonth(d6, JAN, 31)).toBe(6);
    });
    test('the end month splits by day; its rate is the regular one', () => {
        const d = card({ promoRate: 3, promoEndDate: '2026-02-10' });
        const expected = 1000 * (Math.pow(1 + 3 / 100 / 365, 10) * Math.pow(1 + 24 / 100 / 365, 18) - 1);
        expect(DebtCalculator.monthlyInterest(d, 1000, FEB, 28)).toBeCloseTo(expected, 10);
        expect(DebtCalculator.rateForMonth(d, FEB, 28)).toBe(24);
        expect(DebtCalculator.monthlyInterest(d, 1000, MAR, 31)).toBeCloseTo(1000 * growth(24, 31), 10);
    });
});

describe('calculatePaymentPlan with a promo', () => {
    test('no interest during the promo, the regular rate from the month after it ends', () => {
        const { paymentPlan, workingDebts } = DebtCalculator.calculatePaymentPlan(
            [card({ promoRate: 0, promoEndDate: '2026-03-31' })], 100, 'avalanche');
        expect(paymentPlan.slice(0, 3).map(m => m.payments[0].interest)).toEqual([0, 0, 0]);
        expect(paymentPlan[2].payments[0].balance).toBe(700);
        expect(paymentPlan[3].payments[0].interest).toBeCloseTo(700 * growth(24, 30), 2);
        expect(workingDebts[0].deferredCharged).toBe(0);
    });

    test('the boundary month accrues only for the days after the end date', () => {
        const { paymentPlan } = DebtCalculator.calculatePaymentPlan(
            [card({ promoRate: 0, promoEndDate: '2026-01-21' })], 100, 'avalanche');
        expect(paymentPlan[0].payments[0].interest).toBeCloseTo(1000 * growth(24, 10), 2);
    });

    test('a promo that ended before the plan starts changes nothing', () => {
        const plain = DebtCalculator.calculatePaymentPlan([card()], 150, 'avalanche');
        const ended = DebtCalculator.calculatePaymentPlan([card({ promoRate: 0, promoEndDate: '2025-12-31', deferredInterest: true, deferredInterestAccrued: 80 })], 150, 'avalanche');
        expect(ended.paymentPlan).toEqual(plain.paymentPlan);
        expect(ended.workingDebts[0].totalInterest).toBeCloseTo(plain.workingDebts[0].totalInterest, 6);
    });

    test('avalanche ranks by the rate in effect each month', () => {
        const promo = card({ name: 'Promo', accountBalance: 5000, interestRate: 30, minimumPayment: 50, promoRate: 0, promoEndDate: '2026-02-28' });
        const plain = card({ name: 'Plain', accountBalance: 5000, interestRate: 20, minimumPayment: 50 });
        const { paymentPlan } = DebtCalculator.calculatePaymentPlan([promo, plain], 400, 'avalanche');
        const extraTo = m => paymentPlan[m].payments.filter(p => p.payment > 50.5).map(p => p.debtName);
        expect(extraTo(0)).toEqual(['Plain']);
        expect(extraTo(1)).toEqual(['Plain']);
        expect(extraTo(2)).toEqual(['Promo']);
    });

    test('getPaymentOrder without a month falls back to the regular rate', () => {
        const debts = [
            { interestRate: 10, balance: 300, paidOffMonth: null, promoRate: 0, promoEndDate: '2099-01-01' },
            { interestRate: 20, balance: 200, paidOffMonth: null },
            { interestRate: 5, balance: 100, paidOffMonth: null },
            { interestRate: 99, balance: 0, paidOffMonth: null },
        ];
        expect(DebtCalculator.getPaymentOrder(debts, 'avalanche')).toEqual([1, 0, 2]);
        expect(DebtCalculator.getPaymentOrder(debts, 'avalanche', JAN, 31)).toEqual([1, 2, 0]);
        expect(DebtCalculator.getPaymentOrder(debts, 'snowball')).toEqual([2, 1, 0]);
        expect(DebtCalculator.getPaymentOrder(debts, 'unknown')).toEqual([0, 1, 2]);
    });
});

describe('deferred interest', () => {
    const deferred = (fields = {}) => card({ promoRate: 0, promoEndDate: '2026-03-31', deferredInterest: true, ...fields });

    test('a balance left at the end is charged everything accrued at the regular rate', () => {
        const { paymentPlan, workingDebts } = DebtCalculator.calculatePaymentPlan([deferred({ deferredInterestAccrued: 50 })], 100, 'avalanche');
        const expected = 50 + 1000 * growth(24, 31) + 900 * growth(24, 28) + 800 * growth(24, 31);
        const march = paymentPlan[2].payments[0];
        expect(march.deferredInterestCharged).toBeCloseTo(expected, 2);
        expect(march.balance).toBeCloseTo(700 + expected, 2);
        expect(workingDebts[0].deferredCharged).toBeCloseTo(expected, 6);
        expect(paymentPlan[1].payments[0].deferredInterestCharged).toBeUndefined();
        expect(paymentPlan[3].payments[0].deferredInterestCharged).toBeUndefined();
        const plain = DebtCalculator.calculatePaymentPlan([card({ promoRate: 0, promoEndDate: '2026-03-31' })], 100, 'avalanche');
        expect(workingDebts[0].totalInterest).toBeGreaterThan(plain.workingDebts[0].totalInterest + expected - 0.01);
    });

    test('paid off before the end: nothing is charged', () => {
        const { paymentPlan, workingDebts } = DebtCalculator.calculatePaymentPlan([deferred({ deferredInterestAccrued: 50 })], 400, 'avalanche');
        expect(workingDebts[0].paidOffMonth).toBe(3);
        expect(workingDebts[0].deferredCharged).toBe(0);
        expect(workingDebts[0].totalInterest).toBe(0);
        expect(paymentPlan.every(m => m.payments.every(p => p.deferredInterestCharged === undefined))).toBe(true);
    });

    test('a debt with no minimum still gets a charge entry when no payment reaches it', () => {
        const other = card({ name: 'Other', accountBalance: 1000, interestRate: 30, minimumPayment: 100 });
        const d = deferred({ name: 'Deferred', minimumPayment: 0, promoEndDate: '2026-01-31', deferredInterestAccrued: 25 });
        const { paymentPlan } = DebtCalculator.calculatePaymentPlan([other, d], 300, 'avalanche');
        const entry = paymentPlan[0].payments.find(p => p.debtName === 'Deferred');
        expect(entry).toMatchObject({ payment: 0, principal: 0, interest: 0, paidOff: false });
        expect(entry.deferredInterestCharged).toBeCloseTo(25 + 1000 * growth(24, 31), 2);
        expect(entry.balance).toBeCloseTo(1000 + entry.deferredInterestCharged, 2);
    });

    test('the accrued input is ignored without deferred interest or without a promo', () => {
        const plain = DebtCalculator.calculatePaymentPlan([card({ promoRate: 0, promoEndDate: '2026-03-31' })], 100, 'avalanche');
        const notDeferred = DebtCalculator.calculatePaymentPlan([card({ promoRate: 0, promoEndDate: '2026-03-31', deferredInterestAccrued: 99 })], 100, 'avalanche');
        expect(notDeferred.paymentPlan).toEqual(plain.paymentPlan);
        const noPromo = DebtCalculator.calculatePaymentPlan([card({ deferredInterest: true, deferredInterestAccrued: 99 })], 150, 'avalanche');
        expect(noPromo.workingDebts[0].deferredCharged).toBe(0);
        expect(noPromo.workingDebts[0].deferredAccrued).toBe(0);
    });

    test('a negative or invalid accrued input counts as zero', () => {
        const zero = DebtCalculator.calculatePaymentPlan([deferred()], 100, 'avalanche');
        const neg = DebtCalculator.calculatePaymentPlan([deferred({ deferredInterestAccrued: -40 })], 100, 'avalanche');
        const bad = DebtCalculator.calculatePaymentPlan([deferred({ deferredInterestAccrued: 'abc' })], 100, 'avalanche');
        expect(neg.workingDebts[0].deferredCharged).toBeCloseTo(zero.workingDebts[0].deferredCharged, 6);
        expect(bad.workingDebts[0].deferredCharged).toBeCloseTo(zero.workingDebts[0].deferredCharged, 6);
    });

    test('fixed-amount debts never accrue deferred interest', () => {
        const fixed = { name: 'Rent', debtType: 'fixedAmount', fixedAmount: 50, fixedStartDate: '2026-01-01', fixedEndDate: '2026-02-28', minimumPayment: 50, deferredInterest: true, promoRate: 0, promoEndDate: '2026-01-31' };
        const { workingDebts } = DebtCalculator.calculatePaymentPlan([fixed, card()], 200, 'avalanche');
        expect(workingDebts[0].deferredCharged).toBe(0);
    });
});
