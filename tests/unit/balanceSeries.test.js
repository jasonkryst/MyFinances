// Unit tests for the Emergency Fund balance history series (#307), built from
// balance-history entries.
import { trailingMonths, buildBalanceSeries } from '../../src/balanceSeries.js';

const now = new Date(2026, 10, 20); // Nov 2026
const months = trailingMonths(now, 12); // Dec 2025 .. Nov 2026
const acct = { id: 7, name: 'Savings' };
const entry = (id, date, balance, accountId = 7) => ({ id, debtId: null, accountId, date, balance, minimumPayment: 0 });

describe('trailingMonths', () => {
    test('returns 12 months oldest first, crossing a year boundary', () => {
        const m = trailingMonths(new Date(2026, 1, 15), 12);
        expect(m).toHaveLength(12);
        expect(m[0]).toEqual({ year: 2025, month: 2 });
        expect(m[11]).toEqual({ year: 2026, month: 1 });
    });
});

describe('buildBalanceSeries', () => {
    test('carries the last entry forward and has no points before the first entry', () => {
        const s = buildBalanceSeries({ months, accounts: [acct], entries: [entry(1, '2026-08-10', 1000), entry(2, '2026-10-02', 1500)] });
        const d = s.datasets[0].data;
        expect(d.slice(0, 8)).toEqual(Array(8).fill(null)); // Dec..Jul
        expect(d.slice(8)).toEqual([1000, 1000, 1500, 1500]); // Aug, Sep, Oct, Nov
        expect(s.pointCount).toBe(4);
    });
    test('several entries in one month use the last one (by date, then id)', () => {
        const s = buildBalanceSeries({
            months, accounts: [acct],
            entries: [entry(3, '2026-09-20', 900), entry(1, '2026-09-02', 700), entry(2, '2026-09-20', 800), entry(4, '2026-07-01', 100)]
        });
        const d = s.datasets[0].data;
        expect(d[9]).toBe(900); // Sep: 09-20 with the higher id
        expect(d[7]).toBe(100); // Jul
        expect(d[8]).toBe(100); // Aug carried forward
    });
    test('an entry before the window is carried into every month of it', () => {
        const s = buildBalanceSeries({ months, accounts: [acct], entries: [entry(1, '2025-03-15', 400)] });
        expect(s.datasets[0].data.every(v => v === 400)).toBe(true);
        expect(s.pointCount).toBe(12);
    });
    test('year boundary: December and January entries land in their own months', () => {
        const s = buildBalanceSeries({ months, accounts: [acct], entries: [entry(1, '2025-12-31', 10), entry(2, '2026-01-01', 20)] });
        expect(s.datasets[0].data.slice(0, 3)).toEqual([10, 20, 20]);
    });
    test('only this account\'s entries count, one dataset per account', () => {
        const s = buildBalanceSeries({
            months, accounts: [acct, { id: 8, name: 'Other' }],
            entries: [entry(1, '2026-10-01', 5), entry(2, '2026-10-01', 99, 8)]
        });
        expect(s.datasets.map(d => d.data[11])).toEqual([5, 99]);
    });
    test('no entries gives zero points', () => {
        const s = buildBalanceSeries({ months, accounts: [acct], entries: [] });
        expect(s.pointCount).toBe(0);
        expect(s.datasets[0].data.every(v => v === null)).toBe(true);
    });
    test('a single entry in the current month is one point (below the chart threshold)', () => {
        const s = buildBalanceSeries({ months, accounts: [acct], entries: [entry(1, '2026-11-05', 300)] });
        expect(s.pointCount).toBe(1);
    });
    test('entries only after the window (future dated) give no points', () => {
        const s = buildBalanceSeries({ months, accounts: [acct], entries: [entry(1, '2026-12-01', 300)] });
        expect(s.pointCount).toBe(0);
    });
    test('null balances, debt entries and malformed dates are ignored; no accounts gives no datasets', () => {
        const entries = [
            { id: 1, debtId: null, accountId: 7, date: '2026-10-01', balance: null },
            { id: 2, debtId: 7, accountId: null, date: '2026-10-01', balance: 50 },
            { id: 3, debtId: null, accountId: 7, date: 'nope', balance: 50 }
        ];
        expect(buildBalanceSeries({ months, accounts: [acct], entries }).pointCount).toBe(0);
        expect(buildBalanceSeries({ months, accounts: [], entries }).datasets).toEqual([]);
    });
});
