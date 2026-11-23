// #312: Plan History per-debt snapshot and comparison.
const {
    PLAN_HISTORY_DEBTS_MAX, buildPlanDebtSnapshot, monthsBetween, comparePlanEntries, deltaTone, remapPlanHistoryDebtIds,
} = require('../../src/planHistoryCompare.js');

const plan = [
    { month: 1, date: new Date(2026, 0, 1) },
    { month: 2, date: new Date(2026, 1, 1) },
    { month: 3, date: new Date(2026, 2, 1) },
];

describe('buildPlanDebtSnapshot', () => {
    test('one entry per interest-bearing debt with its payoff month and interest', () => {
        const snap = buildPlanDebtSnapshot([
            { id: 1, name: 'Visa', debtType: 'creditCard', paidOffMonth: 3, totalInterest: 12.345 },
            { id: 2, name: 'Rent', debtType: 'fixedAmount', paidOffMonth: 2, totalInterest: 0 },
            { id: 3, name: 'Loan', paidOffMonth: 1, totalInterest: 4 },
        ], plan);
        expect(snap).toEqual([
            { debtId: 1, name: 'Visa', payoffDate: '2026-03-01', totalInterest: 12.35 },
            { debtId: 3, name: 'Loan', payoffDate: '2026-01-01', totalInterest: 4 },
        ]);
    });

    test('unpaid, out-of-range or malformed values fall back safely', () => {
        const snap = buildPlanDebtSnapshot([
            { id: 'x', name: 7, paidOffMonth: null, totalInterest: 'abc' },
            { id: 4, name: 'Late', paidOffMonth: 9, totalInterest: 1 },
            { id: 5, name: 'Zero', paidOffMonth: 0, totalInterest: 1 },
            { id: 6, name: 'Frac', paidOffMonth: 1.5, totalInterest: 1 },
            { id: 7, name: 'BadDate', paidOffMonth: 1, totalInterest: 1 },
            null,
        ], [{ date: 'not a date' }]);
        expect(snap).toEqual([
            { debtId: null, name: '', payoffDate: null, totalInterest: 0 },
            { debtId: 4, name: 'Late', payoffDate: null, totalInterest: 1 },
            { debtId: 5, name: 'Zero', payoffDate: null, totalInterest: 1 },
            { debtId: 6, name: 'Frac', payoffDate: null, totalInterest: 1 },
            { debtId: 7, name: 'BadDate', payoffDate: null, totalInterest: 1 },
        ]);
    });

    test('non-arrays give an empty snapshot; the list is capped', () => {
        expect(buildPlanDebtSnapshot(null, null)).toEqual([]);
        expect(buildPlanDebtSnapshot([{ id: 1, name: 'A', paidOffMonth: 1, totalInterest: 0 }], null))
            .toEqual([{ debtId: 1, name: 'A', payoffDate: null, totalInterest: 0 }]);
        const many = Array.from({ length: PLAN_HISTORY_DEBTS_MAX + 5 }, (_, i) => ({ id: i, name: `D${i}`, totalInterest: 0 }));
        expect(buildPlanDebtSnapshot(many, plan)).toHaveLength(PLAN_HISTORY_DEBTS_MAX);
        expect(PLAN_HISTORY_DEBTS_MAX).toBe(200);
    });
});

describe('monthsBetween', () => {
    test('whole months b - a, across years', () => {
        expect(monthsBetween('2026-01-01', '2026-03-01')).toBe(2);
        expect(monthsBetween('2026-03-01', '2026-01-01')).toBe(-2);
        expect(monthsBetween('2026-12-01', '2027-01-01')).toBe(1);
        expect(monthsBetween('2026-05-01', '2026-05-31')).toBe(0);
    });
    test('null when either side is missing or malformed', () => {
        expect(monthsBetween(null, '2026-01-01')).toBeNull();
        expect(monthsBetween('2026-01-01', undefined)).toBeNull();
        expect(monthsBetween('2026-1-01', '2026-01-01')).toBeNull();
        expect(monthsBetween('x2026-01-01', '2026-01-01')).toBeNull();
        expect(monthsBetween('2026-01-01', '2026-01-01x')).toBeNull();
    });
});

describe('comparePlanEntries', () => {
    const a = { debts: [
        { debtId: 1, name: 'Visa', payoffDate: '2027-06-01', totalInterest: 900 },
        { debtId: 2, name: 'Loan', payoffDate: '2028-01-01', totalInterest: 300 },
        { debtId: null, name: 'Legacy', payoffDate: null, totalInterest: 50 },
    ] };
    const b = { debts: [
        { debtId: 2, name: 'Car Loan', payoffDate: '2027-10-01', totalInterest: 320.5 },
        { debtId: 1, name: 'Visa', payoffDate: '2027-04-01', totalInterest: 700 },
        { debtId: 9, name: 'New Card', payoffDate: '2027-02-01', totalInterest: 40 },
        { debtId: null, name: 'Legacy', payoffDate: '2027-01-01', totalInterest: 50 },
    ] };

    test('matches by id (then name), in A order then B additions', () => {
        const out = comparePlanEntries(a, b);
        expect(out.rows.map(r => r.name)).toEqual(['Visa', 'Car Loan', 'Legacy', 'New Card']);
        expect(out.rows[0]).toMatchObject({ payoffDelta: -2, interestDelta: -200 });
        expect(out.rows[1]).toMatchObject({ payoffDelta: -3, interestDelta: 20.5 });
        expect(out.rows[2]).toMatchObject({ payoffDelta: null, interestDelta: 0 });
        expect(out.rows[3]).toMatchObject({ a: null, payoffDelta: null, interestDelta: null });
        expect(out.rows[3].b.name).toBe('New Card');
        expect(out.totals).toEqual({ interestA: 1250, interestB: 1110.5 });
    });

    test('a debt only in A has no B side and no deltas', () => {
        const out = comparePlanEntries(a, { debts: [b.debts[1]] });
        expect(out.rows.find(r => r.name === 'Loan')).toMatchObject({ b: null, payoffDelta: null, interestDelta: null });
    });

    test('null when either entry has no per-debt data', () => {
        expect(comparePlanEntries(a, { debts: [] })).toBeNull();
        expect(comparePlanEntries({}, b)).toBeNull();
        expect(comparePlanEntries(null, b)).toBeNull();
        expect(comparePlanEntries(a, { debts: 'x' })).toBeNull();
    });
});

describe('deltaTone', () => {
    test('lower is better', () => {
        expect(deltaTone(-1)).toBe('better');
        expect(deltaTone(-0.01)).toBe('better');
        expect(deltaTone(2)).toBe('worse');
        expect(deltaTone(0)).toBe('same');
        expect(deltaTone(null)).toBeNull();
        expect(deltaTone(undefined)).toBeNull();
        expect(deltaTone(NaN)).toBeNull();
        expect(deltaTone(Infinity)).toBeNull();
    });
});

describe('remapPlanHistoryDebtIds', () => {
    test('rewrites known ids, nulls unknown ones, keeps null ids', () => {
        const entry = { id: 5, debts: [
            { debtId: 1, name: 'A', totalInterest: 1 },
            { debtId: 2, name: 'B', totalInterest: 2 },
            { debtId: null, name: 'C', totalInterest: 3 },
            null,
        ] };
        const out = remapPlanHistoryDebtIds(entry, new Map([['1', 41]]));
        expect(out.debts).toEqual([
            { debtId: 41, name: 'A', totalInterest: 1 },
            { debtId: null, name: 'B', totalInterest: 2 },
            { debtId: null, name: 'C', totalInterest: 3 },
            null,
        ]);
        expect(out.id).toBe(5);
        expect(entry.debts[0].debtId).toBe(1);
    });

    test('a missing map nulls every id; entries without a list pass through', () => {
        expect(remapPlanHistoryDebtIds({ debts: [{ debtId: 1 }] }, undefined).debts).toEqual([{ debtId: null }]);
        const plain = { id: 1 };
        expect(remapPlanHistoryDebtIds(plain, new Map())).toBe(plain);
        expect(remapPlanHistoryDebtIds(null, new Map())).toBeNull();
    });
});
