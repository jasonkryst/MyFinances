// Unit tests for the Emergency Fund balance history series (#307).
import { trailingMonths, buildBalanceSeries } from '../../src/balanceSeries.js';

describe('trailingMonths', () => {
    test('returns 12 months oldest first, crossing a year boundary', () => {
        const m = trailingMonths(new Date(2026, 1, 15), 12);
        expect(m).toHaveLength(12);
        expect(m[0]).toEqual({ year: 2025, month: 2 });
        expect(m[11]).toEqual({ year: 2026, month: 1 });
    });
});

describe('buildBalanceSeries', () => {
    const now = new Date(2026, 10, 20);
    const months = trailingMonths(now, 12);

    test('active account yields real points for months with activity plus the current month', () => {
        const balanceFn = (id, y, m) => 1000 + (y === 2026 && m >= 8 ? (m - 7) * 100 : 0);
        const s = buildBalanceSeries({ months, accounts: [{ id: 1, name: 'Savings', startingBalance: 1000 }], balanceFn, now });
        expect(s.datasets[0].data.filter(v => v !== null)).toEqual([1100, 1200, 1300]);
        expect(s.datasets[0].data[11]).toBe(1300);
        expect(s.pointCount).toBe(3);
    });
    test('fresh account (no activity) has only the current month, so fewer than 2 points', () => {
        const s = buildBalanceSeries({ months, accounts: [{ id: 1, name: 'New', startingBalance: 500 }], balanceFn: () => 500, now });
        expect(s.pointCount).toBe(1);
        expect(s.datasets[0].data.slice(0, 11).every(v => v === null)).toBe(true);
    });
    test('no accounts gives zero points and no datasets', () => {
        const s = buildBalanceSeries({ months, accounts: [], balanceFn: () => 0, now });
        expect(s.datasets).toEqual([]);
        expect(s.pointCount).toBe(0);
    });
    test('pointCount is the maximum across accounts', () => {
        const balanceFn = (id, y, m) => (id === 2 ? 50 + m : 10);
        const s = buildBalanceSeries({
            months,
            accounts: [{ id: 1, name: 'Flat', startingBalance: 10 }, { id: 2, name: 'Moving', startingBalance: 0 }],
            balanceFn, now
        });
        expect(s.pointCount).toBe(12);
    });
});
