// #678: effective-dated amounts. The one rule for "amount on a date" plus the
// edit operation and the sanitizer, shared by the browser and the server.
const {
    getAmountOn,
    sanitizeAmountChanges,
    applyAmountChange,
    getCurrentAmount,
    getAmountChangeSummary
} = require('../../src/amountSchedule.js');

const one = { amount: 15, amountChanges: [{ from: '2027-01-01', amount: 18 }] };

describe('getAmountOn', () => {
    test('uses the base amount before the first change', () => {
        expect(getAmountOn(one, '2026-12-31')).toBe(15);
    });
    test('uses the new amount on the change date itself', () => {
        expect(getAmountOn(one, '2027-01-01')).toBe(18);
    });
    test('keeps the new amount after the change date', () => {
        expect(getAmountOn(one, '2027-06-01')).toBe(18);
    });
    test('picks the latest change on or before the date', () => {
        const rec = { amount: 15, amountChanges: [{ from: '2027-01-01', amount: 18 }, { from: '2027-07-01', amount: 20 }] };
        expect(getAmountOn(rec, '2026-06-01')).toBe(15);
        expect(getAmountOn(rec, '2027-03-01')).toBe(18);
        expect(getAmountOn(rec, '2027-06-30')).toBe(18);
        expect(getAmountOn(rec, '2027-07-01')).toBe(20);
    });
    test('does not depend on the list being sorted', () => {
        const rec = { amount: 15, amountChanges: [{ from: '2027-07-01', amount: 20 }, { from: '2027-01-01', amount: 18 }] };
        expect(getAmountOn(rec, '2027-03-01')).toBe(18);
        expect(getAmountOn(rec, '2027-08-01')).toBe(20);
    });
    test('falls back to the amount with no change list', () => {
        expect(getAmountOn({ amount: 9.5 }, '2027-01-01')).toBe(9.5);
        expect(getAmountOn({ amount: 9.5, amountChanges: null }, '2027-01-01')).toBe(9.5);
    });
    test('treats a missing or non-numeric amount as 0', () => {
        expect(getAmountOn({}, '2027-01-01')).toBe(0);
        expect(getAmountOn(null, '2027-01-01')).toBe(0);
        expect(getAmountOn({ amount: 'abc' }, '2027-01-01')).toBe(0);
    });
    test('coerces a numeric-string base amount', () => {
        expect(getAmountOn({ amount: '12.5' }, '2027-01-01')).toBe(12.5);
    });
});

describe('getCurrentAmount', () => {
    test('is the amount on the given day', () => {
        expect(getCurrentAmount(one, '2026-06-01')).toBe(15);
        expect(getCurrentAmount(one, '2027-02-01')).toBe(18);
    });
});

describe('sanitizeAmountChanges', () => {
    test('a non-array gives an empty list', () => {
        expect(sanitizeAmountChanges(undefined)).toEqual([]);
        expect(sanitizeAmountChanges('x')).toEqual([]);
        expect(sanitizeAmountChanges({ from: '2027-01-01', amount: 1 })).toEqual([]);
    });
    test('keeps valid entries with only from and amount', () => {
        expect(sanitizeAmountChanges([{ from: '2027-01-01', amount: 18, junk: 1 }]))
            .toEqual([{ from: '2027-01-01', amount: 18 }]);
    });
    test('drops bad dates and bad amounts', () => {
        const out = sanitizeAmountChanges([
            { from: 'bad', amount: 1 },
            { from: '2027-02-30', amount: 1 },
            { from: '2027-01-01', amount: NaN },
            { from: '2027-01-02', amount: -1 },
            { from: '2027-01-03', amount: 1e9 + 1 },
            { from: '2027-01-04', amount: '7' },
            null,
            { from: '2027-01-05', amount: 1e9 }
        ]);
        expect(out).toEqual([{ from: '2027-01-04', amount: 7 }, { from: '2027-01-05', amount: 1e9 }]);
    });
    test('sorts ascending by date', () => {
        expect(sanitizeAmountChanges([{ from: '2027-07-01', amount: 2 }, { from: '2027-01-01', amount: 1 }]))
            .toEqual([{ from: '2027-01-01', amount: 1 }, { from: '2027-07-01', amount: 2 }]);
    });
    test('a duplicate date keeps the last entry', () => {
        expect(sanitizeAmountChanges([{ from: '2027-01-01', amount: 1 }, { from: '2027-01-01', amount: 2 }]))
            .toEqual([{ from: '2027-01-01', amount: 2 }]);
    });
    test('caps the list at the 120 latest changes', () => {
        const raw = [];
        for (let i = 0; i < 130; i++) {
            const y = 2020 + Math.floor(i / 12);
            const m = String((i % 12) + 1).padStart(2, '0');
            raw.push({ from: `${y}-${m}-01`, amount: i + 1 });
        }
        const out = sanitizeAmountChanges(raw);
        expect(out).toHaveLength(120);
        expect(out[0].amount).toBe(11);
        expect(out[119].amount).toBe(130);
    });
    test('honours a minimum (income must be positive)', () => {
        expect(sanitizeAmountChanges([{ from: '2027-01-01', amount: 0 }], { min: 0.01 })).toEqual([]);
        expect(sanitizeAmountChanges([{ from: '2027-01-01', amount: 0 }])).toEqual([{ from: '2027-01-01', amount: 0 }]);
    });
});

describe('applyAmountChange', () => {
    test("'all' replaces the base amount and clears every change", () => {
        expect(applyAmountChange(one, 20, 'all', null)).toEqual({ amount: 20, amountChanges: [] });
    });
    test('a date on or before the first occurrence behaves like all', () => {
        expect(applyAmountChange(one, 20, '2026-01-01', '2026-03-01')).toEqual({ amount: 20, amountChanges: [] });
        expect(applyAmountChange(one, 20, '2026-03-01', '2026-03-01')).toEqual({ amount: 20, amountChanges: [] });
    });
    test('adds a change from a date', () => {
        expect(applyAmountChange({ amount: 15, amountChanges: [] }, 18, '2027-01-01', '2026-01-01'))
            .toEqual({ amount: 15, amountChanges: [{ from: '2027-01-01', amount: 18 }] });
    });
    test('a change with no first-occurrence date is still added', () => {
        expect(applyAmountChange({ amount: 15 }, 18, '2027-01-01', null))
            .toEqual({ amount: 15, amountChanges: [{ from: '2027-01-01', amount: 18 }] });
    });
    test('replaces an existing change on the same date', () => {
        expect(applyAmountChange(one, 19, '2027-01-01', null))
            .toEqual({ amount: 15, amountChanges: [{ from: '2027-01-01', amount: 19 }] });
    });
    test('keeps later changes and inserts in date order', () => {
        const rec = { amount: 15, amountChanges: [{ from: '2027-07-01', amount: 20 }] };
        expect(applyAmountChange(rec, 18, '2027-01-01', null).amountChanges)
            .toEqual([{ from: '2027-01-01', amount: 18 }, { from: '2027-07-01', amount: 20 }]);
    });
    test('a change to the amount already in effect is a no-op', () => {
        expect(applyAmountChange(one, 18, '2027-06-01', null)).toEqual({ amount: 15, amountChanges: [{ from: '2027-01-01', amount: 18 }] });
        expect(applyAmountChange({ amount: 15, amountChanges: [] }, 15, '2027-01-01', null)).toEqual({ amount: 15, amountChanges: [] });
    });
    test('setting a change back to the previous amount removes it', () => {
        expect(applyAmountChange(one, 15, '2027-01-01', null)).toEqual({ amount: 15, amountChanges: [] });
    });
    test('a later change that now repeats the amount before it is dropped', () => {
        const rec = { amount: 15, amountChanges: [{ from: '2027-07-01', amount: 20 }] };
        expect(applyAmountChange(rec, 20, '2027-01-01', null).amountChanges)
            .toEqual([{ from: '2027-01-01', amount: 20 }]);
    });
    test('does not mutate the record', () => {
        const rec = { amount: 15, amountChanges: [{ from: '2027-01-01', amount: 18 }] };
        applyAmountChange(rec, 30, '2027-03-01', null);
        expect(rec).toEqual({ amount: 15, amountChanges: [{ from: '2027-01-01', amount: 18 }] });
    });
});

describe('getAmountChangeSummary', () => {
    const rec = { amount: 15, amountChanges: [{ from: '2027-01-01', amount: 18 }, { from: '2027-07-01', amount: 20 }] };
    test('reports current, previous, the end of the previous amount and the next scheduled change', () => {
        const s = getAmountChangeSummary(rec, '2027-03-01');
        expect(s.current).toBe(18);
        expect(s.previous).toBe(15);
        expect(s.previousUntil).toBe('2026-12-31');
        expect(s.upcoming).toEqual({ from: '2027-07-01', amount: 20 });
    });
    test('lists changes newest first, flagging future ones', () => {
        const s = getAmountChangeSummary(rec, '2027-03-01');
        expect(s.changes).toEqual([
            { from: '2027-07-01', amount: 20, isFuture: true },
            { from: '2027-01-01', amount: 18, isFuture: false }
        ]);
    });
    test('a change dated today is not in the future', () => {
        expect(getAmountChangeSummary(rec, '2027-01-01').changes[1].isFuture).toBe(false);
    });
    test('with only a scheduled change there is no previous amount', () => {
        const s = getAmountChangeSummary(rec, '2026-06-01');
        expect(s.current).toBe(15);
        expect(s.previous).toBeNull();
        expect(s.previousUntil).toBeNull();
        expect(s.upcoming).toEqual({ from: '2027-01-01', amount: 18 });
    });
    test('previousUntil crosses a month boundary correctly', () => {
        const s = getAmountChangeSummary({ amount: 1, amountChanges: [{ from: '2027-03-01', amount: 2 }] }, '2027-03-05');
        expect(s.previousUntil).toBe('2027-02-28');
    });
    test('no changes gives an empty summary', () => {
        const s = getAmountChangeSummary({ amount: 5 }, '2027-01-01');
        expect(s).toEqual({ current: 5, previous: null, previousUntil: null, upcoming: null, changes: [] });
    });
});
