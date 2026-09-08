const { computeRetirementProjection, splitGrowthFromContribution } = require('../../src/retirementCalculator.js');

describe('computeRetirementProjection', () => {
    test('returns currentBalance unchanged when monthsUntilTarget is zero or negative', () => {
        expect(computeRetirementProjection(10000, 500, 7, 0)).toBe(10000);
        expect(computeRetirementProjection(10000, 500, 7, -5)).toBe(10000);
    });

    test('zero rate of return sums contributions linearly', () => {
        const result = computeRetirementProjection(1000, 100, 0, 12);
        expect(result).toBeCloseTo(1000 + 100 * 12, 5);
    });

    test('compounds monthly at the given annual rate with contributions', () => {
        // Hand-computed: $10,000 at 12%/yr (1%/mo) for 3 months, $100/mo contribution
        // m1: 10000*1.01+100=10200; m2: 10200*1.01+100=10402; m3: 10402*1.01+100=10606.02
        const result = computeRetirementProjection(10000, 100, 12, 3);
        expect(result).toBeCloseTo(10606.02, 2);
    });

    test('zero contribution still compounds the existing balance', () => {
        const result = computeRetirementProjection(1000, 0, 12, 12);
        expect(result).toBeCloseTo(1000 * Math.pow(1.01, 12), 5);
    });
});

describe('splitGrowthFromContribution', () => {
    test('single snapshot has zero growth (no prior balance to diff against)', () => {
        const result = splitGrowthFromContribution([{ date: '2026-01-01', balance: 5000, contribution: 200 }]);
        expect(result).toEqual([{ date: '2026-01-01', contribution: 200, growth: 0 }]);
    });

    test('computes growth as balance delta minus contribution across multiple snapshots', () => {
        const result = splitGrowthFromContribution([
            { date: '2026-01-01', balance: 5000, contribution: 200 },
            { date: '2026-02-01', balance: 5300, contribution: 200 }
        ]);
        expect(result[1]).toEqual({ date: '2026-02-01', contribution: 200, growth: 100 });
    });

    test('sorts input by date before diffing, regardless of input order', () => {
        const result = splitGrowthFromContribution([
            { date: '2026-02-01', balance: 5300, contribution: 200 },
            { date: '2026-01-01', balance: 5000, contribution: 200 }
        ]);
        expect(result.map(r => r.date)).toEqual(['2026-01-01', '2026-02-01']);
        expect(result[1].growth).toBe(100);
    });

    test('handles a mid-series contribution change', () => {
        const result = splitGrowthFromContribution([
            { date: '2026-01-01', balance: 1000, contribution: 100 },
            { date: '2026-02-01', balance: 1150, contribution: 50 }
        ]);
        expect(result[1]).toEqual({ date: '2026-02-01', contribution: 50, growth: 100 });
    });
});
