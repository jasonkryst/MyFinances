// #679: an income's optional, inclusive end date. Paydays after it are never
// generated; paydays on or before it are unchanged (so their Ledger keys stay).
const {
    getIncomePaydaysInMonth,
    countIncomePaydaysInMonth,
    getNextIncomePayDates,
    getIncomeEndDate,
    isIncomeEnded,
    computeMonthlyIncomeForMonth,
    dateToISO,
} = require('../../src/utils.js');
const { sanitizeIncome } = require('../../src/sanitizers.js');

const days = dates => dates.map(d => d.getDate());
const isos = dates => dates.map(dateToISO);

describe('getIncomePaydaysInMonth without an end date', () => {
    test('monthly pays on the first pay date\'s day', () => {
        const inc = { firstPayDate: '2026-01-15', frequency: 'monthly' };
        expect(days(getIncomePaydaysInMonth(inc, 2026, 2))).toEqual([15]);
    });

    test('monthly clamps a 31st to the last day of a short month', () => {
        const inc = { firstPayDate: '2026-01-31', frequency: 'monthly' };
        expect(isos(getIncomePaydaysInMonth(inc, 2026, 1))).toEqual(['2026-02-28']);
        expect(isos(getIncomePaydaysInMonth(inc, 2026, 3))).toEqual(['2026-04-30']);
    });

    test('weekly lists every week in the month from the first pay date', () => {
        const inc = { firstPayDate: '2026-01-02', frequency: 'weekly' };
        expect(days(getIncomePaydaysInMonth(inc, 2026, 0))).toEqual([2, 9, 16, 23, 30]);
        expect(days(getIncomePaydaysInMonth(inc, 2026, 1))).toEqual([6, 13, 20, 27]);
    });

    test('biweekly steps 14 days and accepts the legacy bi-weekly spelling', () => {
        const inc = { firstPayDate: '2026-01-02', frequency: 'biweekly' };
        expect(days(getIncomePaydaysInMonth(inc, 2026, 0))).toEqual([2, 16, 30]);
        expect(days(getIncomePaydaysInMonth(inc, 2026, 1))).toEqual([13, 27]);
        expect(days(getIncomePaydaysInMonth({ ...inc, frequency: 'bi-weekly' }, 2026, 1))).toEqual([13, 27]);
    });

    test('weekly has no paydays in a month before the first pay date', () => {
        const inc = { firstPayDate: '2026-03-06', frequency: 'weekly' };
        expect(getIncomePaydaysInMonth(inc, 2026, 1)).toEqual([]);
    });

    test('twice monthly pays the 15th and the last day, not before the first pay date', () => {
        const inc = { firstPayDate: '2026-02-20', frequency: 'twice_monthly' };
        expect(isos(getIncomePaydaysInMonth(inc, 2026, 1))).toEqual(['2026-02-28']);
        expect(isos(getIncomePaydaysInMonth(inc, 2026, 2))).toEqual(['2026-03-15', '2026-03-31']);
    });

    test('reads the legacy firstDate field; an invalid date yields nothing', () => {
        expect(days(getIncomePaydaysInMonth({ firstDate: '2026-01-10', frequency: 'monthly' }, 2026, 4))).toEqual([10]);
        expect(getIncomePaydaysInMonth({ firstPayDate: 'nope', frequency: 'monthly' }, 2026, 4)).toEqual([]);
        expect(getIncomePaydaysInMonth({ frequency: 'monthly' }, 2026, 4)).toEqual([]);
    });
});

describe('getIncomePaydaysInMonth with an end date', () => {
    test('monthly: the end date is inclusive; later months have no payday', () => {
        const inc = { firstPayDate: '2026-01-15', frequency: 'monthly', endDate: '2026-03-15' };
        expect(isos(getIncomePaydaysInMonth(inc, 2026, 0))).toEqual(['2026-01-15']);
        expect(isos(getIncomePaydaysInMonth(inc, 2026, 2))).toEqual(['2026-03-15']);
        expect(getIncomePaydaysInMonth(inc, 2026, 3)).toEqual([]);
        expect(getIncomePaydaysInMonth(inc, 2027, 0)).toEqual([]);
    });

    test('monthly: an end the day before the payday drops that payday', () => {
        const inc = { firstPayDate: '2026-01-15', frequency: 'monthly', endDate: '2026-03-14' };
        expect(getIncomePaydaysInMonth(inc, 2026, 2)).toEqual([]);
        expect(isos(getIncomePaydaysInMonth(inc, 2026, 1))).toEqual(['2026-02-15']);
    });

    test('weekly stops mid-month at the end date', () => {
        const inc = { firstPayDate: '2026-01-02', frequency: 'weekly', endDate: '2026-01-16' };
        expect(days(getIncomePaydaysInMonth(inc, 2026, 0))).toEqual([2, 9, 16]);
        expect(countIncomePaydaysInMonth(inc, 2026, 0)).toBe(3);
        expect(countIncomePaydaysInMonth(inc, 2026, 1)).toBe(0);
    });

    test('biweekly stops at the end date', () => {
        const inc = { firstPayDate: '2026-01-02', frequency: 'biweekly', endDate: '2026-01-29' };
        expect(days(getIncomePaydaysInMonth(inc, 2026, 0))).toEqual([2, 16]);
    });

    test('twice monthly keeps the 15th and drops the month end after the end date', () => {
        const inc = { firstPayDate: '2026-01-15', frequency: 'twice_monthly', endDate: '2026-02-15' };
        expect(isos(getIncomePaydaysInMonth(inc, 2026, 1))).toEqual(['2026-02-15']);
        expect(getIncomePaydaysInMonth({ ...inc, endDate: '2026-02-14' }, 2026, 1)).toEqual([]);
    });

    test('a null, missing or malformed end date changes nothing', () => {
        const base = { firstPayDate: '2026-01-15', frequency: 'monthly' };
        for (const endDate of [null, undefined, '', 'soon', '2026-1-5', 20260101]) {
            expect(isos(getIncomePaydaysInMonth({ ...base, endDate }, 2030, 5))).toEqual(['2030-06-15']);
        }
    });
});

describe('getNextIncomePayDates with an end date', () => {
    const from = new Date(2026, 2, 1);

    test('without an end date returns n dates', () => {
        const inc = { firstPayDate: '2026-01-15', frequency: 'monthly' };
        expect(isos(getNextIncomePayDates(inc, 3, from))).toEqual(['2026-03-15', '2026-04-15', '2026-05-15']);
    });

    test('stops at the end date (inclusive)', () => {
        const inc = { firstPayDate: '2026-01-15', frequency: 'monthly', endDate: '2026-04-15' };
        expect(isos(getNextIncomePayDates(inc, 3, from))).toEqual(['2026-03-15', '2026-04-15']);
    });

    test('an ended income has no upcoming paydays, for every frequency', () => {
        for (const frequency of ['weekly', 'biweekly', 'twice_monthly', 'monthly']) {
            const inc = { firstPayDate: '2026-01-02', frequency, endDate: '2026-02-20' };
            expect(getNextIncomePayDates(inc, 3, from)).toEqual([]);
        }
    });

    test('weekly and twice monthly are cut at the end date', () => {
        expect(isos(getNextIncomePayDates({ firstPayDate: '2026-01-02', frequency: 'weekly', endDate: '2026-03-13' }, 3, from)))
            .toEqual(['2026-03-06', '2026-03-13']);
        expect(isos(getNextIncomePayDates({ firstPayDate: '2026-01-15', frequency: 'twice_monthly', endDate: '2026-03-30' }, 3, from)))
            .toEqual(['2026-03-15']);
    });
});

describe('getIncomeEndDate / isIncomeEnded', () => {
    test('getIncomeEndDate returns only a YYYY-MM-DD string', () => {
        expect(getIncomeEndDate({ endDate: '2026-05-31' })).toBe('2026-05-31');
        expect(getIncomeEndDate({ endDate: null })).toBeNull();
        expect(getIncomeEndDate({})).toBeNull();
        expect(getIncomeEndDate(null)).toBeNull();
        expect(getIncomeEndDate({ endDate: '2026-05-31T00:00:00Z' })).toBeNull();
        expect(getIncomeEndDate({ endDate: 'x2026-05-31' })).toBeNull();
    });

    test('an income ending today is still active; the day after it has ended', () => {
        const inc = { endDate: '2026-05-31' };
        expect(isIncomeEnded(inc, '2026-05-30')).toBe(false);
        expect(isIncomeEnded(inc, '2026-05-31')).toBe(false);
        expect(isIncomeEnded(inc, '2026-06-01')).toBe(true);
        expect(isIncomeEnded({}, '2099-01-01')).toBe(false);
    });

    test('defaults to today', () => {
        expect(isIncomeEnded({ endDate: '2000-01-01' })).toBe(true);
        expect(isIncomeEnded({ endDate: '2999-12-31' })).toBe(false);
    });
});

describe('computeMonthlyIncomeForMonth honours the end date', () => {
    test('counts paydays up to the end, none after', () => {
        const inc = { firstPayDate: '2026-01-02', frequency: 'weekly', amount: 100, endDate: '2026-01-16' };
        expect(computeMonthlyIncomeForMonth([inc], [], 2026, 0).monthlyTotal).toBe(300);
        expect(computeMonthlyIncomeForMonth([inc], [], 2026, 1).monthlyTotal).toBe(0);
    });
});

describe('sanitizeIncome endDate', () => {
    const base = { id: 1, name: 'Job', amount: 1000, firstPayDate: '2026-01-15', frequency: 'monthly' };

    test('keeps an end date on or after the first pay date', () => {
        expect(sanitizeIncome({ ...base, endDate: '2026-06-30' }).endDate).toBe('2026-06-30');
        expect(sanitizeIncome({ ...base, endDate: '2026-01-15' }).endDate).toBe('2026-01-15');
    });

    test('drops an end date before the first pay date', () => {
        expect(sanitizeIncome({ ...base, endDate: '2026-01-14' }).endDate).toBeNull();
    });

    test('missing, invalid or without a first pay date is null', () => {
        expect(sanitizeIncome(base).endDate).toBeNull();
        expect(sanitizeIncome({ ...base, endDate: 'garbage' }).endDate).toBeNull();
        expect(sanitizeIncome({ ...base, firstPayDate: null, endDate: '2026-06-30' }).endDate).toBeNull();
    });

    test('the legacy firstDate field anchors the end date check', () => {
        const { firstPayDate, ...legacy } = base;
        expect(sanitizeIncome({ ...legacy, firstDate: '2026-02-01', endDate: '2026-01-31' }).endDate).toBeNull();
        expect(sanitizeIncome({ ...legacy, firstDate: '2026-02-01', endDate: '2026-02-01' }).endDate).toBe('2026-02-01');
    });
});
