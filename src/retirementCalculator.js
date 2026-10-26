// Pure retirement projection calculations — no DOM/app state access.

// IRS annual contribution limits by account subtype.
// Update each November when the IRS publishes next year's limits (Rev. Proc. / IR news release).
// getContributionLimit() falls back to the most recent available year, so missing future
// years never crash — they simply show the last known limit until a code update lands.
// Catch-up limits apply to account holders age 50+ (age 60-63 has a higher 401k catch-up
// under SECURE 2.0 starting 2025, but we use the age-50+ figure for simplicity).
export const IRS_CONTRIBUTION_LIMITS = {
    2024: {
        '401k':            { base: 23000, catchUp: 30500 },
        'Traditional IRA': { base:  7000, catchUp:  8000 },
        'Roth IRA':        { base:  7000, catchUp:  8000 },
        'HSA':             { selfOnly: 4150, family: 8300 },
        'Pension':         null,
        'Other':           null,
    },
    2025: {
        '401k':            { base: 23500, catchUp: 31000 },
        'Traditional IRA': { base:  7000, catchUp:  8000 },
        'Roth IRA':        { base:  7000, catchUp:  8000 },
        'HSA':             { selfOnly: 4300, family: 8550 },
        'Pension':         null,
        'Other':           null,
    },
    // 2026: IRS typically announces in October/November of the prior year.
    // Update when the official IR news release is published.
    2026: {
        '401k':            { base: 23500, catchUp: 31000 },
        'Traditional IRA': { base:  7000, catchUp:  8000 },
        'Roth IRA':        { base:  7000, catchUp:  8000 },
        'HSA':             { selfOnly: 4300, family: 8550 },
        'Pension':         null,
        'Other':           null,
    },
};

// Returns the IRS contribution limit for a given subtype and calendar year.
// Falls back to the nearest prior year in the table when the requested year is not present.
// Returns null for Pension/Other (no statutory limit).
export function getContributionLimit(subtype, year, { catchUp = false, hsaFamily = false } = {}) {
    const years = Object.keys(IRS_CONTRIBUTION_LIMITS).map(Number).sort((a, b) => a - b);
    const resolvedYear = [...years].reverse().find(y => y <= year) ?? years[years.length - 1];
    const limits = IRS_CONTRIBUTION_LIMITS[resolvedYear]?.[subtype];
    if (!limits) return null;
    if (subtype === 'HSA') return hsaFamily ? limits.family : limits.selfOnly;
    return catchUp ? limits.catchUp : limits.base;
}

// Sums contributions for a single account within a given calendar year.
// Filters snapshots by accountId and year prefix on the ISO date string.
export function computeYtdContributions(snapshots, accountId, year) {
    const prefix = String(year);
    return (snapshots || [])
        .filter(s => s.accountId === accountId && String(s.date || '').startsWith(prefix))
        .reduce((sum, s) => sum + (Number(s.contribution) || 0), 0);
}

export function computeRetirementProjection(currentBalance, monthlyContribution, annualRatePct, monthsUntilTarget) {
    if (!(monthsUntilTarget > 0)) return currentBalance;
    const monthlyRate = (Number(annualRatePct) || 0) / 100 / 12;
    let balance = Number(currentBalance) || 0;
    const contribution = Number(monthlyContribution) || 0;
    for (let i = 0; i < monthsUntilTarget; i++) {
        balance = balance * (1 + monthlyRate) + contribution;
    }
    return balance;
}

// ── Multi-scenario projections (issue #264) ────────────────────────────────
// Conservative/aggressive rates are derived from a given "moderate" rate
// (the account's own rateOfReturn, honored as-is) by applying a configurable
// delta rather than three flat global rates — see the design spec's
// "Design decision" section for the reasoning. Defaults (-2 / +3) produce
// the issue's suggested 5%/7%/10% band for a typical 7% moderate rate.
export const DEFAULT_CONSERVATIVE_DELTA = -2;
export const DEFAULT_AGGRESSIVE_DELTA = 3;

function clampRatePct(rate) {
    const n = Number(rate);
    if (!Number.isFinite(n)) return 0;
    return Math.min(100, Math.max(0, n));
}

// null/undefined mean "not provided" and fall back to the given default;
// anything else is coerced with Number() and falls back only if that
// coercion isn't finite (e.g. a non-numeric string) — explicit 0 is a
// legitimate delta and must NOT be treated as "missing" (Number(null) === 0
// would otherwise silently collapse a missing value to a real zero delta).
function resolveDelta(value, fallback) {
    if (value === null || value === undefined) return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

export function computeScenarioRates(moderateRatePct, conservativeDelta = DEFAULT_CONSERVATIVE_DELTA, aggressiveDelta = DEFAULT_AGGRESSIVE_DELTA) {
    const moderate = clampRatePct(moderateRatePct);
    const cDelta = resolveDelta(conservativeDelta, DEFAULT_CONSERVATIVE_DELTA);
    const aDelta = resolveDelta(aggressiveDelta, DEFAULT_AGGRESSIVE_DELTA);
    return {
        conservative: clampRatePct(moderate + cDelta),
        moderate,
        aggressive: clampRatePct(moderate + aDelta),
    };
}

// Produces a conservative/moderate/aggressive projection band by calling
// computeRetirementProjection three times (once per derived rate) rather
// than changing that function's own scalar signature — it has other call
// sites that only ever need a single rate.
export function computeRetirementProjectionScenarios(currentBalance, monthlyContribution, moderateRatePct, monthsUntilTarget, conservativeDelta = DEFAULT_CONSERVATIVE_DELTA, aggressiveDelta = DEFAULT_AGGRESSIVE_DELTA) {
    const rates = computeScenarioRates(moderateRatePct, conservativeDelta, aggressiveDelta);
    return {
        conservative: computeRetirementProjection(currentBalance, monthlyContribution, rates.conservative, monthsUntilTarget),
        moderate: computeRetirementProjection(currentBalance, monthlyContribution, rates.moderate, monthsUntilTarget),
        aggressive: computeRetirementProjection(currentBalance, monthlyContribution, rates.aggressive, monthsUntilTarget),
        rates,
    };
}

// Month-by-month projection series for a single rate, sampled every
// sampleEveryMonths (always including month 0 and the final month) — used
// to plot the three-scenario projection chart. monsthUntilTarget <= 0
// mirrors computeRetirementProjection's own short-circuit.
export function computeRetirementProjectionSeries(currentBalance, monthlyContribution, annualRatePct, monthsUntilTarget, sampleEveryMonths = 1) {
    const startBalance = Number(currentBalance) || 0;
    if (!(monthsUntilTarget > 0)) return [{ month: 0, balance: startBalance }];
    const monthlyRate = (Number(annualRatePct) || 0) / 100 / 12;
    const contribution = Number(monthlyContribution) || 0;
    const step = Math.max(1, Math.round(Number(sampleEveryMonths) || 1));
    let balance = startBalance;
    const points = [{ month: 0, balance }];
    for (let m = 1; m <= monthsUntilTarget; m++) {
        balance = balance * (1 + monthlyRate) + contribution;
        if (m % step === 0 || m === monthsUntilTarget) {
            points.push({ month: m, balance });
        }
    }
    return points;
}

// Projects total employee contributions paid into a pension by the target date.
// Unlike investment accounts, pension value is defined by the employer formula —
// only the employee's own accumulated contributions are projected here.
export function computePensionContributionProjection(annualSalary, contributionRatePct, monthsUntilTarget) {
    if (!(monthsUntilTarget > 0)) return 0;
    const monthly = (Number(annualSalary) || 0) * (Number(contributionRatePct) || 0) / 1200;
    return monthly * monthsUntilTarget;
}

// Monthly income a projected balance supports under a safe withdrawal rate
// (e.g. the 4% rule: $1M * 4% / 12 = $3,333/mo). Pure arithmetic derivation
// of an already-computed projection — no new compounding logic.
export function computeMonthlyWithdrawal(projectedBalance, withdrawalRatePct) {
    const balance = Number(projectedBalance) || 0;
    const rate = Number(withdrawalRatePct) || 0;
    return balance * (rate / 100) / 12;
}

export function splitGrowthFromContribution(snapshotsForOneAccount) {
    const sorted = [...(snapshotsForOneAccount || [])].sort((a, b) => a.date.localeCompare(b.date));
    return sorted.map((snap, i) => {
        const contribution = Number(snap.contribution) || 0;
        if (i === 0) return { date: snap.date, contribution, growth: 0 };
        const prevBalance = Number(sorted[i - 1].balance) || 0;
        const balance = Number(snap.balance) || 0;
        return { date: snap.date, contribution, growth: balance - prevBalance - contribution };
    });
}
