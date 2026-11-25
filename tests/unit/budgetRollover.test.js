// #687: the pure category budget rollover rule.
const {
    ROLLOVER_MODES, ROLLOVER_MAX_LOOKBACK_MONTHS, isValidRolloverMode, isValidRolloverStart, roundCents,
    computeRolloverCarries, computeRolloverCarry, rolloverMonthsBefore,
} = require('../../src/budgetRollover.js');

const r = (budget, actual) => ({ budget, actual });

describe('isValidRolloverMode', () => {
    test('accepts exactly both and overspend', () => {
        expect(ROLLOVER_MODES).toEqual(['both', 'overspend']);
        expect(isValidRolloverMode('both')).toBe(true);
        expect(isValidRolloverMode('overspend')).toBe(true);
    });
    test('rejects everything else', () => {
        for (const v of ['', 'off', 'BOTH', 'underspend', null, undefined, 1, true, {}, []]) {
            expect(isValidRolloverMode(v)).toBe(false);
        }
    });
});

describe('isValidRolloverStart', () => {
    test('accepts YYYY-MM with a real month', () => {
        for (const v of ['2026-01', '2026-12', '1900-01', '2200-12']) expect(isValidRolloverStart(v)).toBe(true);
    });
    test('rejects malformed, out-of-range and non-string values', () => {
        for (const v of ['2026-00', '2026-13', '2026-1', '26-01', '2026-01-01', ' 2026-01', '2026-01 ', '1899-12', '2201-01',
            'abcd-ef', '', null, undefined, 202601, {}, []]) {
            expect(isValidRolloverStart(v)).toBe(false);
        }
    });
});

describe('roundCents', () => {
    test('rounds to cents and never returns negative zero', () => {
        expect(roundCents(0.1 + 0.2)).toBe(0.3);
        expect(roundCents(1.005)).toBe(1.01);
        expect(roundCents(-0.001)).toBe(0);
        expect(Object.is(roundCents(-0.001), 0)).toBe(true);
        expect(roundCents(-12.345)).toBe(-12.34);
    });
});

describe('computeRolloverCarries', () => {
    test('both: unspent adds and overspend subtracts, the first month carries nothing', () => {
        expect(computeRolloverCarries([r(100, 60), r(100, 130), r(100, 100), r(100, 0)], 'both'))
            .toEqual([0, 40, 10, 10]);
    });
    test('overspend: only overspending carries, unspent money is dropped', () => {
        expect(computeRolloverCarries([r(100, 60), r(100, 130), r(100, 100), r(100, 20), r(100, 150)], 'overspend'))
            .toEqual([0, 0, -30, -30, 0]);
    });
    test('overspend: a later surplus pays the debt down but never goes above zero', () => {
        expect(computeRolloverCarries([r(100, 150), r(100, 80), r(100, 0), r(100, 0)], 'overspend'))
            .toEqual([0, -50, -30, 0]);
    });
    test('both: the carry may stay negative across months', () => {
        expect(computeRolloverCarries([r(100, 200), r(100, 200), r(100, 0)], 'both')).toEqual([0, -100, -200]);
    });
    test('off, unknown or missing mode: all zeros', () => {
        for (const mode of [undefined, null, '', 'off', 'bogus', 5]) {
            expect(computeRolloverCarries([r(100, 0), r(100, 0)], mode)).toEqual([0, 0]);
        }
    });
    test('empty and non-array input give an empty array', () => {
        expect(computeRolloverCarries([], 'both')).toEqual([]);
        expect(computeRolloverCarries(null, 'both')).toEqual([]);
        expect(computeRolloverCarries('x', 'both')).toEqual([]);
    });
    test('zero and negative budgets and junk values count as numbers or zero', () => {
        expect(computeRolloverCarries([r(0, 50), r(0, 0), r(-10, 0)], 'both')).toEqual([0, -50, -50]);
        expect(computeRolloverCarries([r('x', 'y'), r(undefined, null), {}, null], 'both')).toEqual([0, 0, 0, 0]);
        expect(computeRolloverCarries([r('100', '40'), r(0, 0)], 'both')).toEqual([0, 60]);
    });
    test('rounds the running carry to cents', () => {
        expect(computeRolloverCarries([r(0.1, 0), r(0.2, 0), r(0, 0)], 'both')).toEqual([0, 0.1, 0.3]);
        expect(computeRolloverCarries([r(33.333, 0), r(0, 0)], 'both')).toEqual([0, 33.33]);
    });
});

describe('computeRolloverCarry', () => {
    test('is the carry out of the last month', () => {
        expect(computeRolloverCarry([r(100, 60), r(100, 130)], 'both')).toBe(10);
        expect(computeRolloverCarry([r(100, 60), r(100, 130)], 'overspend')).toBe(-30);
        expect(computeRolloverCarry([r(100, 150)], 'overspend')).toBe(-50);
        expect(computeRolloverCarry([r(100, 20)], 'both')).toBe(80);
        expect(computeRolloverCarry([r(100, 20)], 'overspend')).toBe(0);
    });
    test('agrees with the last per-month carry plus the last month', () => {
        const rows = [r(80, 10), r(80, 200), r(80, 85), r(80, 79.99)];
        for (const mode of ROLLOVER_MODES) {
            const carries = computeRolloverCarries([...rows, r(0, 0)], mode);
            expect(computeRolloverCarry(rows, mode)).toBe(carries[carries.length - 1]);
        }
    });
    test('zero for empty input, a missing range or an unknown mode', () => {
        expect(computeRolloverCarry([], 'both')).toBe(0);
        expect(computeRolloverCarry(undefined, 'both')).toBe(0);
        expect(computeRolloverCarry([r(100, 0)], 'off')).toBe(0);
        expect(computeRolloverCarry([r(100, 0)], undefined)).toBe(0);
    });
    test('never returns negative zero', () => {
        expect(Object.is(computeRolloverCarry([r(100, 100)], 'overspend'), 0)).toBe(true);
        expect(Object.is(computeRolloverCarry([r(0, 0)], 'both'), 0)).toBe(true);
    });
    test('non-numeric last row counts as zero', () => {
        expect(computeRolloverCarry([r(100, 0), null], 'both')).toBe(100);
        expect(computeRolloverCarry([r(100, 0), r('x', 'y')], 'both')).toBe(100);
    });
});

describe('rolloverMonthsBefore', () => {
    test('lists the months from the start up to but excluding the target month', () => {
        expect(rolloverMonthsBefore('2026-03', 2026, 5)).toEqual([
            { year: 2026, month: 2 }, { year: 2026, month: 3 }, { year: 2026, month: 4 },
        ]);
    });
    test('crosses a year boundary (month is 0-based)', () => {
        expect(rolloverMonthsBefore('2025-11', 2026, 1)).toEqual([
            { year: 2025, month: 10 }, { year: 2025, month: 11 }, { year: 2026, month: 0 },
        ]);
    });
    test('empty when the start is the target month, after it, or invalid', () => {
        expect(rolloverMonthsBefore('2026-06', 2026, 5)).toEqual([]);
        expect(rolloverMonthsBefore('2026-09', 2026, 5)).toEqual([]);
        expect(rolloverMonthsBefore('2030-01', 2026, 5)).toEqual([]);
        expect(rolloverMonthsBefore('nope', 2026, 5)).toEqual([]);
        expect(rolloverMonthsBefore(undefined, 2026, 5)).toEqual([]);
    });
    test('caps the lookback at the most recent months', () => {
        const out = rolloverMonthsBefore('1990-01', 2026, 5);
        expect(out).toHaveLength(ROLLOVER_MAX_LOOKBACK_MONTHS);
        expect(out[out.length - 1]).toEqual({ year: 2026, month: 4 });
        expect(out[0]).toEqual({ year: 2016, month: 5 });
        expect(rolloverMonthsBefore('2026-01', 2026, 5, 2)).toEqual([{ year: 2026, month: 3 }, { year: 2026, month: 4 }]);
    });
    test('a start exactly at the cap boundary is not trimmed', () => {
        expect(rolloverMonthsBefore('2016-06', 2026, 5)).toHaveLength(ROLLOVER_MAX_LOOKBACK_MONTHS);
        expect(rolloverMonthsBefore('2016-07', 2026, 5)).toHaveLength(ROLLOVER_MAX_LOOKBACK_MONTHS - 1);
    });
});
