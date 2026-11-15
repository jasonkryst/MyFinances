// #579: the pure recurring-occurrence engine shared by the browser
// (recurring.js re-exports it), the projection core and the server.
const { isEffectivelyPaused, getRecurringOccurrencesInMonth } = require('../../src/recurringOccurrences.js');
const recurring = require('../../src/recurring.js');

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dates = (tmpl, y, m) => getRecurringOccurrencesInMonth(tmpl, y, m).map(iso);

describe('isEffectivelyPaused', () => {
    const now = new Date(2026, 10, 15, 12);

    test('an unpaused or missing template is not paused', () => {
        expect(isEffectivelyPaused({ paused: false }, now)).toBe(false);
        expect(isEffectivelyPaused(null, now)).toBe(false);
        expect(isEffectivelyPaused(undefined, now)).toBe(false);
    });

    test('a paused template without an end date stays paused', () => {
        expect(isEffectivelyPaused({ paused: true }, now)).toBe(true);
        expect(isEffectivelyPaused({ paused: true, pauseUntil: null }, now)).toBe(true);
    });

    test('pauseUntil resumes on that day, not before', () => {
        expect(isEffectivelyPaused({ paused: true, pauseUntil: '2026-11-16' }, now)).toBe(true);
        expect(isEffectivelyPaused({ paused: true, pauseUntil: '2026-11-15' }, now)).toBe(false);
        expect(isEffectivelyPaused({ paused: true, pauseUntil: '2026-11-01' }, now)).toBe(false);
    });
});

describe('getRecurringOccurrencesInMonth', () => {
    test('recurring.js re-exports the same function', () => {
        expect(recurring.getRecurringOccurrencesInMonth).toBe(getRecurringOccurrencesInMonth);
    });

    test('monthly clamps to the month length and occurs at noon', () => {
        const t = { frequency: 'monthly', dayOfMonth: 31 };
        expect(dates(t, 2026, 1)).toEqual(['2026-02-28']);
        expect(dates(t, 2026, 2)).toEqual(['2026-03-31']);
        expect(getRecurringOccurrencesInMonth(t, 2026, 2)[0].getHours()).toBe(12);
    });

    test('defaults: monthly on day 1, dayOfMonth clamped into 1..31', () => {
        expect(dates({}, 2026, 4)).toEqual(['2026-05-01']);
        expect(dates({ dayOfMonth: 0 }, 2026, 4)).toEqual(['2026-05-01']);
        expect(dates({ dayOfMonth: 99 }, 2026, 3)).toEqual(['2026-04-30']);
    });

    test('nothing for a missing, archived, paused or skipped template', () => {
        expect(getRecurringOccurrencesInMonth(null, 2026, 0)).toEqual([]);
        expect(dates({ archived: true, dayOfMonth: 5 }, 2026, 0)).toEqual([]);
        expect(dates({ paused: true, dayOfMonth: 5 }, 2026, 0)).toEqual([]);
        expect(dates({ dayOfMonth: 5, skippedMonths: ['2026-01'] }, 2026, 0)).toEqual([]);
        expect(dates({ dayOfMonth: 5, skippedMonths: ['2026-02'] }, 2026, 0)).toEqual(['2026-01-05']);
    });

    test('start and end dates bound the series', () => {
        const t = { frequency: 'monthly', dayOfMonth: 10, startDate: '2026-03-15', endDate: '2026-06-09' };
        expect(dates(t, 2026, 1)).toEqual([]);
        expect(dates(t, 2026, 2)).toEqual([]); // 10 Mar is before the 15 Mar start
        expect(dates(t, 2026, 3)).toEqual(['2026-04-10']);
        expect(dates(t, 2026, 5)).toEqual([]); // 10 Jun is after the 9 Jun end
        expect(dates(t, 2026, 6)).toEqual([]);
    });

    test('quarterly repeats every third month from the start month', () => {
        const t = { frequency: 'quarterly', dayOfMonth: 20, startDate: '2026-01-20' };
        expect(dates(t, 2026, 0)).toEqual(['2026-01-20']);
        expect(dates(t, 2026, 1)).toEqual([]);
        expect(dates(t, 2026, 3)).toEqual(['2026-04-20']);
        expect(dates(t, 2025, 10)).toEqual([]);
        expect(dates({ frequency: 'quarterly', dayOfMonth: 20 }, 2026, 0)).toEqual([]);
    });

    test('yearly occurs only in the start month', () => {
        const t = { frequency: 'yearly', dayOfMonth: 29, startDate: '2024-02-29' };
        expect(dates(t, 2027, 1)).toEqual(['2027-02-28']);
        expect(dates(t, 2027, 2)).toEqual([]);
        expect(dates({ frequency: 'yearly', dayOfMonth: 1 }, 2027, 1)).toEqual([]);
    });

    test('weekly and biweekly step from the start date', () => {
        expect(dates({ frequency: 'weekly', startDate: '2026-10-28' }, 2026, 10))
            .toEqual(['2026-11-04', '2026-11-11', '2026-11-18', '2026-11-25']);
        expect(dates({ frequency: 'biweekly', startDate: '2026-10-28' }, 2026, 10))
            .toEqual(['2026-11-11', '2026-11-25']);
        expect(dates({ frequency: 'weekly', startDate: '2026-11-20', endDate: '2026-11-27' }, 2026, 10))
            .toEqual(['2026-11-20', '2026-11-27']);
        expect(dates({ frequency: 'weekly' }, 2026, 10)).toEqual([]);
    });

    test('the weekend rule shifts within the month', () => {
        // 1 Aug 2026 is a Saturday, 31 Jan 2027 a Sunday.
        expect(dates({ dayOfMonth: 1, weekendRule: 'before' }, 2026, 7)).toEqual(['2026-08-03']);
        expect(dates({ dayOfMonth: 1, weekendRule: 'after' }, 2026, 7)).toEqual(['2026-08-03']);
        expect(dates({ dayOfMonth: 31, weekendRule: 'after' }, 2027, 0)).toEqual(['2027-01-29']);
        expect(dates({ dayOfMonth: 1, weekendRule: 'none' }, 2026, 7)).toEqual(['2026-08-01']);
        expect(dates({ dayOfMonth: 1, weekendRule: 'bogus' }, 2026, 7)).toEqual(['2026-08-01']);
    });
});
