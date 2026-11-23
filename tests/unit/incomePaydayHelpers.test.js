// #547: payday helper cases not covered in incomeEndDate.test.js.
const {
    getIncomePaydaysInMonth,
    countIncomePaydaysInMonth,
    getNextIncomePayDates,
    dateToISO,
} = require('../../src/utils.js');

const isos = dates => dates.map(dateToISO);

describe('getIncomePaydaysInMonth: month ends and leap years', () => {
    test('monthly on the 29th/30th/31st clamps in a leap February and in a common one', () => {
        for (const day of [29, 30, 31]) {
            const inc = { firstPayDate: `2024-01-${day}`, frequency: 'monthly' };
            expect(isos(getIncomePaydaysInMonth(inc, 2024, 1))).toEqual(['2024-02-29']);
            expect(isos(getIncomePaydaysInMonth(inc, 2025, 1))).toEqual(['2025-02-28']);
        }
    });

    test('monthly on the 30th is unclamped in a 31-day month and in a 30-day month', () => {
        const inc = { firstPayDate: '2026-01-30', frequency: 'monthly' };
        expect(isos(getIncomePaydaysInMonth(inc, 2026, 4))).toEqual(['2026-05-30']);
        expect(isos(getIncomePaydaysInMonth(inc, 2026, 5))).toEqual(['2026-06-30']);
    });

    test('twice monthly pays the last day of February, 29 in a leap year', () => {
        const inc = { firstPayDate: '2024-01-01', frequency: 'twice_monthly' };
        expect(isos(getIncomePaydaysInMonth(inc, 2024, 1))).toEqual(['2024-02-15', '2024-02-29']);
        expect(isos(getIncomePaydaysInMonth(inc, 2025, 1))).toEqual(['2025-02-15', '2025-02-28']);
    });

    test('weekly counts five paydays in a leap February that starts on the pay weekday', () => {
        // 2024-02-01 is a Thursday; Feb 2024 has 29 days.
        const inc = { firstPayDate: '2024-02-01', frequency: 'weekly' };
        expect(isos(getIncomePaydaysInMonth(inc, 2024, 1))).toEqual(
            ['2024-02-01', '2024-02-08', '2024-02-15', '2024-02-22', '2024-02-29']);
    });

    test('weekly lines up from a far-past anchor', () => {
        const inc = { firstPayDate: '2020-01-03', frequency: 'weekly' };
        expect(isos(getIncomePaydaysInMonth(inc, 2026, 0))).toEqual(
            ['2026-01-02', '2026-01-09', '2026-01-16', '2026-01-23', '2026-01-30']);
    });

    test('biweekly keeps its phase across a year boundary', () => {
        const inc = { firstPayDate: '2025-12-19', frequency: 'biweekly' };
        expect(isos(getIncomePaydaysInMonth(inc, 2025, 11))).toEqual(['2025-12-19']);
        expect(isos(getIncomePaydaysInMonth(inc, 2026, 0))).toEqual(['2026-01-02', '2026-01-16', '2026-01-30']);
    });

    test('monthly does not consult the first pay date for the month (pays on that day every month)', () => {
        const inc = { firstPayDate: '2026-06-15', frequency: 'monthly' };
        expect(isos(getIncomePaydaysInMonth(inc, 2026, 4))).toEqual(['2026-05-15']);
        expect(isos(getIncomePaydaysInMonth(inc, 2026, 5))).toEqual(['2026-06-15']);
    });

    test('an unknown frequency behaves as monthly; an empty or garbage date yields nothing', () => {
        expect(isos(getIncomePaydaysInMonth({ firstPayDate: '2026-01-10', frequency: 'whatever' }, 2026, 2)))
            .toEqual(['2026-03-10']);
        expect(getIncomePaydaysInMonth({ firstPayDate: '', frequency: 'weekly' }, 2026, 2)).toEqual([]);
        expect(getIncomePaydaysInMonth({ firstPayDate: '2026-13-45', frequency: 'monthly' }, 2026, 2)).toEqual([]);
    });
});

describe('countIncomePaydaysInMonth', () => {
    test('counts paydays per frequency', () => {
        const first = '2026-01-02';
        expect(countIncomePaydaysInMonth({ firstPayDate: first, frequency: 'monthly' }, 2026, 0)).toBe(1);
        expect(countIncomePaydaysInMonth({ firstPayDate: first, frequency: 'twice_monthly' }, 2026, 0)).toBe(2);
        expect(countIncomePaydaysInMonth({ firstPayDate: first, frequency: 'weekly' }, 2026, 0)).toBe(5);
        expect(countIncomePaydaysInMonth({ firstPayDate: first, frequency: 'biweekly' }, 2026, 0)).toBe(3);
        expect(countIncomePaydaysInMonth({ firstPayDate: first, frequency: 'biweekly' }, 2026, 1)).toBe(2);
    });

    test('zero for an invalid date, a month before the start; end date cuts the count', () => {
        expect(countIncomePaydaysInMonth({ firstPayDate: 'bad', frequency: 'weekly' }, 2026, 0)).toBe(0);
        expect(countIncomePaydaysInMonth({ firstPayDate: '2026-05-01', frequency: 'weekly' }, 2026, 0)).toBe(0);
        expect(countIncomePaydaysInMonth(
            { firstPayDate: '2026-01-02', frequency: 'weekly', endDate: '2026-01-10' }, 2026, 0)).toBe(2);
    });
});

describe('getNextIncomePayDates: edges', () => {
    const from = new Date(2026, 0, 31, 15, 30);

    test('monthly on the 31st walks through short months, including a leap February', () => {
        const inc = { firstPayDate: '2024-01-31', frequency: 'monthly' };
        expect(isos(getNextIncomePayDates(inc, 4, new Date(2027, 11, 31)))).toEqual(
            ['2027-12-31', '2028-01-31', '2028-02-29', '2028-03-31']);
        expect(isos(getNextIncomePayDates(inc, 2, from))).toEqual(['2026-01-31', '2026-02-28']);
    });

    test('n of 0 returns an empty list', () => {
        expect(getNextIncomePayDates({ firstPayDate: '2026-01-01', frequency: 'weekly' }, 0, from)).toEqual([]);
        expect(getNextIncomePayDates({ firstPayDate: '2026-01-01', frequency: 'monthly' }, 0, from)).toEqual([]);
    });

    test('weekly reads the legacy firstDate field and rolls across the year', () => {
        const inc = { firstDate: '2025-12-26', frequency: 'weekly' };
        expect(isos(getNextIncomePayDates(inc, 3, new Date(2025, 11, 28)))).toEqual(
            ['2026-01-02', '2026-01-09', '2026-01-16']);
    });

    test('does not mutate the fromDate argument', () => {
        const d = new Date(2026, 0, 31, 15, 30);
        getNextIncomePayDates({ firstPayDate: '2026-01-01', frequency: 'monthly' }, 2, d);
        expect(d.getHours()).toBe(15);
    });

    test('defaults to three upcoming dates', () => {
        const inc = { firstPayDate: '2000-01-01', frequency: 'twice_monthly' };
        expect(getNextIncomePayDates(inc, undefined, from)).toHaveLength(3);
    });

    test('a missing first pay date gives none', () => {
        expect(getNextIncomePayDates({ frequency: 'weekly' }, 3, from)).toEqual([]);
    });
});
