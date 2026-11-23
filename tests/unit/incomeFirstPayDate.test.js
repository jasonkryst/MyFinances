// #705: a monthly income (and an unknown frequency, which falls back to
// monthly) never has a payday before its first pay date. Weekly, biweekly and
// twice-monthly already respected it; these cases pin all of them.
const {
    getIncomePaydaysInMonth,
    countIncomePaydaysInMonth,
    getNextIncomePayDates,
    computeMonthlyIncomeForMonth,
    dateToISO,
} = require('../../src/utils.js');

const isos = dates => dates.map(dateToISO);

describe('getIncomePaydaysInMonth respects firstPayDate (#705)', () => {
    const monthly = { firstPayDate: '2026-06-15', frequency: 'monthly', amount: 1000 };

    test('monthly: nothing in months before the first payday', () => {
        expect(getIncomePaydaysInMonth(monthly, 2026, 4)).toEqual([]);
        expect(getIncomePaydaysInMonth(monthly, 2025, 11)).toEqual([]);
    });

    test('monthly: the first payday itself and later months are kept', () => {
        expect(isos(getIncomePaydaysInMonth(monthly, 2026, 5))).toEqual(['2026-06-15']);
        expect(isos(getIncomePaydaysInMonth(monthly, 2026, 6))).toEqual(['2026-07-15']);
        expect(isos(getIncomePaydaysInMonth(monthly, 2027, 0))).toEqual(['2027-01-15']);
    });

    test('monthly: a later day in the first month is fine, an earlier one is not', () => {
        // First payday on the 31st: June (30 days) clamps to the 30th, which is
        // after a May 31 start; but a June 30 start has no payday in May.
        const end = { firstPayDate: '2026-05-31', frequency: 'monthly' };
        expect(isos(getIncomePaydaysInMonth(end, 2026, 4))).toEqual(['2026-05-31']);
        expect(isos(getIncomePaydaysInMonth(end, 2026, 5))).toEqual(['2026-06-30']);
        expect(getIncomePaydaysInMonth({ firstPayDate: '2026-06-30', frequency: 'monthly' }, 2026, 4)).toEqual([]);
    });

    test('an unknown frequency behaves as monthly, including the start rule', () => {
        const odd = { firstPayDate: '2026-03-10', frequency: 'whatever' };
        expect(getIncomePaydaysInMonth(odd, 2026, 1)).toEqual([]);
        expect(isos(getIncomePaydaysInMonth(odd, 2026, 2))).toEqual(['2026-03-10']);
    });

    test('other frequencies: nothing before the first payday either', () => {
        for (const frequency of ['weekly', 'biweekly', 'twice_monthly']) {
            expect(getIncomePaydaysInMonth({ firstPayDate: '2026-06-20', frequency }, 2026, 4)).toEqual([]);
        }
    });

    test('counts and monthly income are 0 before the start, positive after', () => {
        expect(countIncomePaydaysInMonth(monthly, 2026, 4)).toBe(0);
        expect(countIncomePaydaysInMonth(monthly, 2026, 5)).toBe(1);
        expect(computeMonthlyIncomeForMonth([monthly], [], 2026, 4).monthlyTotal).toBe(0);
        expect(computeMonthlyIncomeForMonth([monthly], [], 2026, 5).monthlyTotal).toBe(1000);
    });
});

describe('getNextIncomePayDates respects firstPayDate (#705)', () => {
    test('monthly: starts at the first payday when it is in the future', () => {
        const inc = { firstPayDate: '2026-06-15', frequency: 'monthly' };
        expect(isos(getNextIncomePayDates(inc, 3, new Date(2026, 3, 1)))).toEqual(['2026-06-15', '2026-07-15', '2026-08-15']);
    });

    test('monthly: a past first payday does not change the usual next dates', () => {
        const inc = { firstPayDate: '2025-01-15', frequency: 'monthly' };
        expect(isos(getNextIncomePayDates(inc, 2, new Date(2026, 3, 20)))).toEqual(['2026-05-15', '2026-06-15']);
    });
});
