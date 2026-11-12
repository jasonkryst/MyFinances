// Issue #165: weekend due-date shift. applyWeekendRule is the single rule used
// by the ledger, Recurring, the .ics feeds and the Plan calendar.
import { applyWeekendRule, getDebtDueDateInMonth, sanitizeWeekendRule, WEEKEND_RULES } from '../../src/weekendRule.js';
import { getRecurringOccurrencesInMonth } from '../../src/recurring.js';
import { sanitizeDebt, sanitizeRecurringTemplate } from '../../src/sanitizers.js';

// y, m (1-12), d, rule -> expected [y, m, d]
const ymd = (date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()];
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h);

describe('applyWeekendRule', () => {
    test('before: Saturday goes to Friday, Sunday goes to Friday', () => {
        expect(ymd(applyWeekendRule(at(2026, 11, 14), 'before'))).toEqual([2026, 11, 13]);
        expect(ymd(applyWeekendRule(at(2026, 11, 15), 'before'))).toEqual([2026, 11, 13]);
    });

    test('after: Saturday goes to Monday, Sunday goes to Monday', () => {
        expect(ymd(applyWeekendRule(at(2026, 11, 14), 'after'))).toEqual([2026, 11, 16]);
        expect(ymd(applyWeekendRule(at(2026, 11, 15), 'after'))).toEqual([2026, 11, 16]);
    });

    test('weekdays are unchanged for every rule', () => {
        for (const rule of WEEKEND_RULES) {
            for (let d = 9; d <= 13; d++) { // Mon 9 Nov .. Fri 13 Nov 2026
                expect(ymd(applyWeekendRule(at(2026, 11, d), rule))).toEqual([2026, 11, d]);
            }
        }
    });

    test("'none', undefined and unknown rules keep a weekend date", () => {
        for (const rule of ['none', undefined, null, 'bogus', '']) {
            expect(ymd(applyWeekendRule(at(2026, 11, 14), rule))).toEqual([2026, 11, 14]);
        }
    });

    test('month edge: Saturday the 1st with before goes to Monday the 3rd', () => {
        expect(ymd(applyWeekendRule(at(2026, 8, 1), 'before'))).toEqual([2026, 8, 3]);
    });

    test('month edge: Sunday the 1st with before goes to Monday the 2nd', () => {
        expect(ymd(applyWeekendRule(at(2026, 11, 1), 'before'))).toEqual([2026, 11, 2]);
        expect(ymd(applyWeekendRule(at(2026, 3, 1), 'before'))).toEqual([2026, 3, 2]);
    });

    test('month edge: Saturday the 30th and Sunday the 31st with after go back to Friday the 29th', () => {
        expect(ymd(applyWeekendRule(at(2026, 5, 30), 'after'))).toEqual([2026, 5, 29]);
        expect(ymd(applyWeekendRule(at(2026, 5, 31), 'after'))).toEqual([2026, 5, 29]);
    });

    test('month edge: a month ending on Saturday (Jan 2026) goes back to Friday the 30th', () => {
        expect(ymd(applyWeekendRule(at(2026, 1, 31), 'after'))).toEqual([2026, 1, 30]);
    });

    test('month edge: Saturday the 28th of a 28-day month (Feb 2026) with after goes to Friday the 27th', () => {
        expect(ymd(applyWeekendRule(at(2026, 2, 28), 'after'))).toEqual([2026, 2, 27]);
    });

    test('the shifted date never leaves its month, for every day of several years', () => {
        for (let y = 2024; y <= 2028; y++) {
            for (let m = 0; m < 12; m++) {
                const dim = new Date(y, m + 1, 0).getDate();
                for (let d = 1; d <= dim; d++) {
                    for (const rule of ['before', 'after']) {
                        const out = applyWeekendRule(new Date(y, m, d, 12), rule);
                        expect(out.getMonth()).toBe(m);
                        expect(out.getFullYear()).toBe(y);
                        expect([0, 6]).not.toContain(out.getDay());
                    }
                }
            }
        }
    });

    test('does not mutate its input and returns a new Date', () => {
        const input = at(2026, 11, 14);
        const out = applyWeekendRule(input, 'before');
        expect(ymd(input)).toEqual([2026, 11, 14]);
        expect(out).not.toBe(input);
        expect(applyWeekendRule(input, 'none')).not.toBe(input);
    });

    test('keeps the time of day', () => {
        const out = applyWeekendRule(new Date(2026, 10, 14, 9, 30, 15), 'before');
        expect([out.getHours(), out.getMinutes(), out.getSeconds()]).toEqual([9, 30, 15]);
        const midnight = applyWeekendRule(new Date(2026, 10, 14), 'after');
        expect(midnight.getHours()).toBe(0);
    });
});

describe('sanitizeWeekendRule', () => {
    test('keeps the three valid values and coerces everything else to none', () => {
        expect(sanitizeWeekendRule('none')).toBe('none');
        expect(sanitizeWeekendRule('before')).toBe('before');
        expect(sanitizeWeekendRule('after')).toBe('after');
        for (const bad of [undefined, null, '', 'Before', 'friday', 1, {}, ['before']]) {
            expect(sanitizeWeekendRule(bad)).toBe('none');
        }
    });
});

describe('getDebtDueDateInMonth', () => {
    test('without a rule it is the long-standing midnight date', () => {
        const d = getDebtDueDateInMonth({ dueDate: 14 }, 2026, 10);
        expect(ymd(d)).toEqual([2026, 11, 14]);
        expect(d.getHours()).toBe(0);
    });
    test('before / after shift a weekend due date', () => {
        expect(ymd(getDebtDueDateInMonth({ dueDate: 14, weekendRule: 'before' }, 2026, 10))).toEqual([2026, 11, 13]);
        expect(ymd(getDebtDueDateInMonth({ dueDate: 14, weekendRule: 'after' }, 2026, 10))).toEqual([2026, 11, 16]);
    });
    test('a day past the end of the month is clamped before shifting', () => {
        // 31 in November clamps to Monday the 30th (no weekend, unchanged).
        expect(ymd(getDebtDueDateInMonth({ dueDate: 31, weekendRule: 'after' }, 2026, 10))).toEqual([2026, 11, 30]);
        // 31 in May 2026 is a Sunday; after would leave May, so Friday the 29th.
        expect(ymd(getDebtDueDateInMonth({ dueDate: 31, weekendRule: 'after' }, 2026, 4))).toEqual([2026, 5, 29]);
    });
});

describe('getRecurringOccurrencesInMonth with a weekend rule', () => {
    const monthly = (extra) => ({ frequency: 'monthly', dayOfMonth: 14, startDate: '2026-01-01', ...extra });

    test('monthly: Saturday the 14th shifts to Friday (before) or Monday (after)', () => {
        expect(getRecurringOccurrencesInMonth(monthly({ weekendRule: 'before' }), 2026, 10).map(ymd)).toEqual([[2026, 11, 13]]);
        expect(getRecurringOccurrencesInMonth(monthly({ weekendRule: 'after' }), 2026, 10).map(ymd)).toEqual([[2026, 11, 16]]);
    });

    test('monthly: none or a missing rule keeps the weekend date', () => {
        expect(getRecurringOccurrencesInMonth(monthly({ weekendRule: 'none' }), 2026, 10).map(ymd)).toEqual([[2026, 11, 14]]);
        expect(getRecurringOccurrencesInMonth(monthly({}), 2026, 10).map(ymd)).toEqual([[2026, 11, 14]]);
    });

    test('monthly: a weekday due date is unchanged', () => {
        expect(getRecurringOccurrencesInMonth(monthly({ dayOfMonth: 12, weekendRule: 'after' }), 2026, 10).map(ymd)).toEqual([[2026, 11, 12]]);
    });

    test('monthly: keeps the 12:00 time of day', () => {
        const [d] = getRecurringOccurrencesInMonth(monthly({ weekendRule: 'before' }), 2026, 10);
        expect(d.getHours()).toBe(12);
    });

    test('weekly on Saturdays: every occurrence moves to Friday, none leaves the month', () => {
        const tmpl = { frequency: 'weekly', startDate: '2026-10-31', weekendRule: 'before' }; // a Saturday
        const dates = getRecurringOccurrencesInMonth(tmpl, 2026, 10).map(ymd);
        // Saturdays in Nov 2026: 7, 14, 21, 28; the 1st is a Sunday (not an occurrence).
        expect(dates).toEqual([[2026, 11, 6], [2026, 11, 13], [2026, 11, 20], [2026, 11, 27]]);
    });

    test('weekly: Saturday the 1st with before goes to Monday the 3rd and stays in the month', () => {
        const tmpl = { frequency: 'weekly', startDate: '2026-07-25', weekendRule: 'before' }; // Saturday
        const dates = getRecurringOccurrencesInMonth(tmpl, 2026, 7).map(ymd); // Aug 2026: Sat 1, 8, 15, 22, 29
        expect(dates).toEqual([[2026, 8, 3], [2026, 8, 7], [2026, 8, 14], [2026, 8, 21], [2026, 8, 28]]);
    });

    test('biweekly, quarterly and yearly shift too', () => {
        const bi = { frequency: 'biweekly', startDate: '2026-11-14', weekendRule: 'after' };
        expect(getRecurringOccurrencesInMonth(bi, 2026, 10).map(ymd)).toEqual([[2026, 11, 16], [2026, 11, 30]]);
        const q = { frequency: 'quarterly', dayOfMonth: 14, startDate: '2026-08-01', weekendRule: 'before' };
        expect(getRecurringOccurrencesInMonth(q, 2026, 10).map(ymd)).toEqual([[2026, 11, 13]]);
        const y = { frequency: 'yearly', dayOfMonth: 14, startDate: '2025-11-01', weekendRule: 'after' };
        expect(getRecurringOccurrencesInMonth(y, 2026, 10).map(ymd)).toEqual([[2026, 11, 16]]);
    });
});

describe('weekendRule sanitizing', () => {
    test('sanitizeRecurringTemplate whitelists the rule, default none', () => {
        expect(sanitizeRecurringTemplate({ weekendRule: 'before' }, 1).weekendRule).toBe('before');
        expect(sanitizeRecurringTemplate({ weekendRule: 'after' }, 1).weekendRule).toBe('after');
        expect(sanitizeRecurringTemplate({}, 1).weekendRule).toBe('none');
        expect(sanitizeRecurringTemplate({ weekendRule: 'sideways' }, 1).weekendRule).toBe('none');
    });

    test('sanitizeDebt whitelists the rule, default none', () => {
        expect(sanitizeDebt({ weekendRule: 'before' }, 1).weekendRule).toBe('before');
        expect(sanitizeDebt({ weekendRule: 'after' }, 1).weekendRule).toBe('after');
        expect(sanitizeDebt({}, 1).weekendRule).toBe('none');
        expect(sanitizeDebt({ weekendRule: 'sideways' }, 1).weekendRule).toBe('none');
    });
});
