const { computeRetirementProjection, splitGrowthFromContribution, IRS_CONTRIBUTION_LIMITS, getContributionLimit, computeYtdContributions } = require('../../src/retirementCalculator.js');

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

describe('IRS_CONTRIBUTION_LIMITS', () => {
    test('contains entries for 2024 and 2025', () => {
        expect(IRS_CONTRIBUTION_LIMITS[2024]).toBeDefined();
        expect(IRS_CONTRIBUTION_LIMITS[2025]).toBeDefined();
    });

    test('401k 2024 base limit is 23000', () => {
        expect(IRS_CONTRIBUTION_LIMITS[2024]['401k'].base).toBe(23000);
    });

    test('401k 2024 catch-up limit is 30500', () => {
        expect(IRS_CONTRIBUTION_LIMITS[2024]['401k'].catchUp).toBe(30500);
    });

    test('Pension and Other entries are null (no statutory limit)', () => {
        expect(IRS_CONTRIBUTION_LIMITS[2024]['Pension']).toBeNull();
        expect(IRS_CONTRIBUTION_LIMITS[2024]['Other']).toBeNull();
    });
});

describe('getContributionLimit', () => {
    test('returns base 401k limit for 2024', () => {
        expect(getContributionLimit('401k', 2024)).toBe(23000);
    });

    test('returns catch-up 401k limit when catchUp flag is set', () => {
        expect(getContributionLimit('401k', 2024, { catchUp: true })).toBe(30500);
    });

    test('returns IRA base limit', () => {
        expect(getContributionLimit('Traditional IRA', 2025)).toBe(7000);
        expect(getContributionLimit('Roth IRA', 2025)).toBe(7000);
    });

    test('returns HSA self-only limit by default', () => {
        expect(getContributionLimit('HSA', 2025)).toBe(4300);
    });

    test('returns HSA family limit when hsaFamily flag is set', () => {
        expect(getContributionLimit('HSA', 2025, { hsaFamily: true })).toBe(8550);
    });

    test('returns null for Pension (no statutory limit)', () => {
        expect(getContributionLimit('Pension', 2025)).toBeNull();
    });

    test('returns null for Other (no statutory limit)', () => {
        expect(getContributionLimit('Other', 2025)).toBeNull();
    });

    test('falls back to most recent available year for an unknown future year', () => {
        const futureLimitUnknown = getContributionLimit('401k', 2099);
        const mostRecentYear = Math.max(...Object.keys(IRS_CONTRIBUTION_LIMITS).map(Number));
        expect(futureLimitUnknown).toBe(IRS_CONTRIBUTION_LIMITS[mostRecentYear]['401k'].base);
    });

    test('uses the correct year when multiple years are in the table', () => {
        expect(getContributionLimit('401k', 2024)).toBe(IRS_CONTRIBUTION_LIMITS[2024]['401k'].base);
        expect(getContributionLimit('401k', 2025)).toBe(IRS_CONTRIBUTION_LIMITS[2025]['401k'].base);
    });
});

describe('computeYtdContributions', () => {
    const snapshots = [
        { accountId: 1, date: '2025-01-15', contribution: 1000 },
        { accountId: 1, date: '2025-06-01', contribution: 2000 },
        { accountId: 1, date: '2024-12-01', contribution: 500 },
        { accountId: 2, date: '2025-03-01', contribution: 3000 },
    ];

    test('sums contributions for an account in the given year', () => {
        expect(computeYtdContributions(snapshots, 1, 2025)).toBe(3000);
    });

    test('excludes contributions from other calendar years', () => {
        expect(computeYtdContributions(snapshots, 1, 2024)).toBe(500);
    });

    test('excludes contributions from other accounts', () => {
        expect(computeYtdContributions(snapshots, 2, 2025)).toBe(3000);
    });

    test('returns 0 when no matching snapshots exist', () => {
        expect(computeYtdContributions(snapshots, 99, 2025)).toBe(0);
    });

    test('returns 0 for null/undefined snapshots array', () => {
        expect(computeYtdContributions(null, 1, 2025)).toBe(0);
        expect(computeYtdContributions(undefined, 1, 2025)).toBe(0);
    });
});
