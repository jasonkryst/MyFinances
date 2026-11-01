const {
    computeRetirementProjection,
    splitGrowthFromContribution,
    IRS_CONTRIBUTION_LIMITS,
    getContributionLimit,
    computeYtdContributions,
    computeMonthlyWithdrawal,
    computeScenarioRates,
    computeRetirementProjectionScenarios,
    computeRetirementProjectionSeries,
    computeCoastFire,
    DEFAULT_CONSERVATIVE_DELTA,
    DEFAULT_AGGRESSIVE_DELTA,
} = require('../../src/retirementCalculator.js');

// ── Coast FIRE (issue #346) ──────────────────────────────────────────────────
describe('computeCoastFire', () => {
    const acct = (currentBalance, monthlyContribution, annualRatePct) => ({ currentBalance, monthlyContribution, annualRatePct });

    test('reached now when today\'s balance alone grows to the target', () => {
        // 100k at 12%/yr (1%/mo) for 12 months = 112,682.50 >= 110k
        const r = computeCoastFire([acct(100000, 500, 12)], 110000, 12);
        expect(r.status).toBe('reached');
        expect(r.months).toBe(0);
        expect(r.valueWithoutContributions).toBeCloseTo(100000 * Math.pow(1.01, 12), 2);
    });

    test('exact boundary counts as reached', () => {
        const target = 100000 * Math.pow(1.01, 12);
        expect(computeCoastFire([acct(100000, 0, 12)], target, 12).status).toBe('reached');
    });

    test('coast date is the first month where stopping still reaches the target', () => {
        // 0% growth: stopping after t months leaves 1000 + 100t. Target 1500 -> t = 5.
        const r = computeCoastFire([acct(1000, 100, 0)], 1500, 24);
        expect(r.status).toBe('coast');
        expect(r.months).toBe(5);
    });

    test('stopping one month before the coast date falls short (minimality)', () => {
        const accounts = [acct(50000, 1000, 7)];
        const r = computeCoastFire(accounts, 600000, 360);
        expect(r.status).toBe('coast');
        const m = 0.07 / 12;
        const valueIfStopAt = t => computeRetirementProjection(50000, 1000, 7, t) * Math.pow(1 + m, 360 - t);
        expect(valueIfStopAt(r.months)).toBeGreaterThanOrEqual(600000);
        expect(valueIfStopAt(r.months - 1)).toBeLessThan(600000);
    });

    test('contributions required through retirement when only the full projection reaches it', () => {
        // 0% growth: 1000 + 100*12 = 2200 only at t = 12.
        const r = computeCoastFire([acct(1000, 100, 0)], 2200, 12);
        expect(r.status).toBe('throughRetirement');
        expect(r.months).toBe(12);
    });

    test('shortfall when even contributing every month misses the target', () => {
        const r = computeCoastFire([acct(1000, 100, 0)], 5000, 12);
        expect(r.status).toBe('shortfall');
        expect(r.months).toBeNull();
        expect(r.valueWithContributions).toBeCloseTo(2200, 5);
    });

    test('valueWithContributions equals the existing projection summed across accounts', () => {
        const accounts = [acct(20000, 300, 6), acct(5000, 100, 9)];
        const r = computeCoastFire(accounts, 1e9, 120);
        const expected = computeRetirementProjection(20000, 300, 6, 120) + computeRetirementProjection(5000, 100, 9, 120);
        expect(r.valueWithContributions).toBeCloseTo(expected, 4);
        expect(r.status).toBe('shortfall');
    });

    test('aggregates accounts with different rates (neither alone reaches the target)', () => {
        // 60k@1%/mo + 60k@0% over 12 months, no contributions: 67,609.50 + 60,000 = 127,609.50
        const accounts = [acct(60000, 0, 12), acct(60000, 0, 0)];
        expect(computeCoastFire(accounts, 125000, 12).status).toBe('reached');
        expect(computeCoastFire([accounts[0]], 125000, 12).status).toBe('shortfall');
    });

    test('target date already passed: reached if balance covers target, else shortfall', () => {
        expect(computeCoastFire([acct(5000, 100, 7)], 4000, 0).status).toBe('reached');
        expect(computeCoastFire([acct(5000, 100, 7)], 6000, 0).status).toBe('shortfall');
        expect(computeCoastFire([acct(5000, 100, 7)], 6000, -3).status).toBe('shortfall');
    });

    test.each([0, -100, NaN, Infinity, null, undefined, 'abc'])('invalid target %p -> noTarget', (target) => {
        const r = computeCoastFire([acct(1000, 100, 7)], target, 12);
        expect(r.status).toBe('noTarget');
        expect(r.months).toBeNull();
    });

    test('no accounts -> shortfall for a positive target, never throws', () => {
        expect(computeCoastFire([], 1000, 12).status).toBe('shortfall');
        expect(computeCoastFire(null, 1000, 12).status).toBe('shortfall');
    });

    test('non-numeric account fields are treated as zero', () => {
        const r = computeCoastFire([{ currentBalance: 'x', monthlyContribution: null, annualRatePct: undefined }], 1, 12);
        expect(r.status).toBe('shortfall');
        expect(r.valueWithContributions).toBe(0);
    });

    test('fractional months are floored', () => {
        const r = computeCoastFire([acct(1000, 100, 0)], 2200, 12.9);
        expect(r.status).toBe('throughRetirement');
        expect(r.months).toBe(12);
    });
});

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

describe('computeMonthlyWithdrawal', () => {
    test('derives monthly income from a projected balance at the 4% safe withdrawal rate', () => {
        expect(computeMonthlyWithdrawal(1000000, 4)).toBeCloseTo(3333.33, 2);
    });

    test('scales linearly with the withdrawal rate', () => {
        expect(computeMonthlyWithdrawal(1000000, 8)).toBeCloseTo(6666.67, 2);
        expect(computeMonthlyWithdrawal(1000000, 2)).toBeCloseTo(1666.67, 2);
    });

    test('scales linearly with the projected balance', () => {
        expect(computeMonthlyWithdrawal(500000, 4)).toBeCloseTo(1666.67, 2);
    });

    test('returns 0 for a zero balance', () => {
        expect(computeMonthlyWithdrawal(0, 4)).toBe(0);
    });

    test('returns 0 for a zero withdrawal rate', () => {
        expect(computeMonthlyWithdrawal(1000000, 0)).toBe(0);
    });

    test('treats a non-numeric balance or rate as 0', () => {
        expect(computeMonthlyWithdrawal('foo', 4)).toBe(0);
        expect(computeMonthlyWithdrawal(1000000, 'bar')).toBe(0);
        expect(computeMonthlyWithdrawal(null, undefined)).toBe(0);
    });

    test('handles a negative balance proportionally (no clamping — a projection should never actually be negative)', () => {
        expect(computeMonthlyWithdrawal(-120000, 4)).toBeCloseTo(-400, 2);
    });
});

// ── Multi-scenario projections (issue #264) ────────────────────────────────

describe('computeScenarioRates', () => {
    test('default deltas on a 7% moderate rate produce the suggested 5/7/10 band', () => {
        expect(computeScenarioRates(7)).toEqual({ conservative: 5, moderate: 7, aggressive: 10 });
    });

    test('DEFAULT_CONSERVATIVE_DELTA and DEFAULT_AGGRESSIVE_DELTA match -2/+3', () => {
        expect(DEFAULT_CONSERVATIVE_DELTA).toBe(-2);
        expect(DEFAULT_AGGRESSIVE_DELTA).toBe(3);
    });

    test('honors a custom delta pair', () => {
        expect(computeScenarioRates(6, -1, 5)).toEqual({ conservative: 5, moderate: 6, aggressive: 11 });
    });

    test('preserves a different per-account moderate rate instead of flattening to a global default', () => {
        expect(computeScenarioRates(4)).toEqual({ conservative: 2, moderate: 4, aggressive: 7 });
        expect(computeScenarioRates(9)).toEqual({ conservative: 7, moderate: 9, aggressive: 12 });
    });

    test('clamps conservative at 0 rather than going negative', () => {
        expect(computeScenarioRates(1)).toEqual({ conservative: 0, moderate: 1, aggressive: 4 });
        expect(computeScenarioRates(0)).toEqual({ conservative: 0, moderate: 0, aggressive: 3 });
    });

    test('clamps aggressive at 100', () => {
        expect(computeScenarioRates(99)).toEqual({ conservative: 97, moderate: 99, aggressive: 100 });
    });

    test('falls back to the default delta when a non-finite delta is passed', () => {
        expect(computeScenarioRates(7, NaN, undefined)).toEqual({ conservative: 5, moderate: 7, aggressive: 10 });
        expect(computeScenarioRates(7, 'bad', null)).toEqual({ conservative: 5, moderate: 7, aggressive: 10 });
    });

    test('treats a missing/non-numeric moderate rate as 0 (e.g. an account with no assumedReturn set)', () => {
        expect(computeScenarioRates(undefined)).toEqual({ conservative: 0, moderate: 0, aggressive: 3 });
        expect(computeScenarioRates(null)).toEqual({ conservative: 0, moderate: 0, aggressive: 3 });
    });

    test('a negative moderate rate is clamped to 0 before deltas are applied', () => {
        expect(computeScenarioRates(-5)).toEqual({ conservative: 0, moderate: 0, aggressive: 3 });
    });

    test('duplicate (zero) deltas collapse all three scenarios to the same rate', () => {
        expect(computeScenarioRates(7, 0, 0)).toEqual({ conservative: 7, moderate: 7, aggressive: 7 });
    });
});

describe('computeRetirementProjectionScenarios', () => {
    test('three scenarios diverge over a multi-year horizon with a positive contribution', () => {
        const result = computeRetirementProjectionScenarios(10000, 200, 7, 120); // 10 years
        expect(result.conservative).toBeLessThan(result.moderate);
        expect(result.moderate).toBeLessThan(result.aggressive);
        expect(result.rates).toEqual({ conservative: 5, moderate: 7, aggressive: 10 });
    });

    test('matches calling computeRetirementProjection three times with the derived rates', () => {
        const result = computeRetirementProjectionScenarios(5000, 100, 7, 36);
        expect(result.conservative).toBeCloseTo(computeRetirementProjection(5000, 100, 5, 36), 6);
        expect(result.moderate).toBeCloseTo(computeRetirementProjection(5000, 100, 7, 36), 6);
        expect(result.aggressive).toBeCloseTo(computeRetirementProjection(5000, 100, 10, 36), 6);
    });

    test('zero months collapses all three scenarios to currentBalance unchanged', () => {
        const result = computeRetirementProjectionScenarios(10000, 500, 7, 0);
        expect(result).toMatchObject({ conservative: 10000, moderate: 10000, aggressive: 10000 });
    });

    test('duplicate deltas (0, 0) collapse all three scenarios to the same value', () => {
        const result = computeRetirementProjectionScenarios(10000, 200, 7, 24, 0, 0);
        expect(result.conservative).toBeCloseTo(result.moderate, 6);
        expect(result.moderate).toBeCloseTo(result.aggressive, 6);
    });

    test('a zero moderate rate with zero contribution still diverges only on the aggressive side (conservative clamps to 0)', () => {
        const result = computeRetirementProjectionScenarios(10000, 0, 0, 60);
        expect(result.conservative).toBe(10000);
        expect(result.moderate).toBe(10000);
        expect(result.aggressive).toBeGreaterThan(10000);
    });
});

describe('computeRetirementProjectionSeries', () => {
    test('zero/negative months returns a single point at currentBalance', () => {
        expect(computeRetirementProjectionSeries(10000, 500, 7, 0)).toEqual([{ month: 0, balance: 10000 }]);
        expect(computeRetirementProjectionSeries(10000, 500, 7, -3)).toEqual([{ month: 0, balance: 10000 }]);
    });

    test('includes month 0 and the final month', () => {
        const series = computeRetirementProjectionSeries(1000, 100, 12, 7, 3);
        expect(series[0]).toEqual({ month: 0, balance: 1000 });
        expect(series[series.length - 1].month).toBe(7);
    });

    test('samples every sampleEveryMonths in between', () => {
        const series = computeRetirementProjectionSeries(1000, 100, 12, 12, 3);
        expect(series.map(p => p.month)).toEqual([0, 3, 6, 9, 12]);
    });

    test('is monotonically non-decreasing for a positive rate and contribution', () => {
        const series = computeRetirementProjectionSeries(1000, 100, 7, 24, 1);
        for (let i = 1; i < series.length; i++) {
            expect(series[i].balance).toBeGreaterThanOrEqual(series[i - 1].balance);
        }
    });

    test('final point matches computeRetirementProjection for the same inputs', () => {
        const series = computeRetirementProjectionSeries(5000, 150, 6, 18, 1);
        const expected = computeRetirementProjection(5000, 150, 6, 18);
        expect(series[series.length - 1].balance).toBeCloseTo(expected, 6);
    });

    test('defaults sampleEveryMonths to 1 when omitted', () => {
        const series = computeRetirementProjectionSeries(1000, 50, 5, 5);
        expect(series.map(p => p.month)).toEqual([0, 1, 2, 3, 4, 5]);
    });
});
