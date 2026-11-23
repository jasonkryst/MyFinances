// #689: Year in review. The pure core: period and data-floor helpers plus one
// rule per insight, each taking prepared plain data.
const core = require('../../src/yearReviewCore.js');
const { buildPeriod, priorPeriodOf, dataFloorIso, computeYearInsights, RULES } = core;

const P2025 = buildPeriod(2025, '2026-03-10');

function input(extra = {}) {
    const period = extra.period || P2025;
    return {
        period,
        priorPeriod: priorPeriodOf(period),
        floorIso: null,
        netWorthPoints: [], debts: [], balanceHistory: [], overrides: {},
        reconciliations: [], sinkingFunds: [], incomes: [], recurringTemplates: [],
        monthsTx: period.months.map(() => []), priorMonthsTx: period.months.map(() => []),
        ...extra
    };
}
const run = (name, inp) => core[name](inp);

describe('buildPeriod / priorPeriodOf', () => {
    test('a past year covers every month', () => {
        expect(P2025).toEqual({ year: 2025, startIso: '2025-01-01', endIso: '2025-12-31', months: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], isYtd: false });
    });
    test('the current year runs to today', () => {
        expect(buildPeriod(2026, '2026-03-10')).toEqual({ year: 2026, startIso: '2026-01-01', endIso: '2026-03-10', months: [0, 1, 2], isYtd: true });
    });
    test('a future year is clamped to the current year', () => {
        expect(buildPeriod(2030, '2026-03-10').year).toBe(2026);
    });
    test('the prior period of a year-to-date covers the same months', () => {
        expect(priorPeriodOf(buildPeriod(2026, '2026-03-10'))).toEqual({ year: 2025, startIso: '2025-01-01', endIso: '2025-03-10', months: [0, 1, 2], isYtd: false });
    });
    test('Feb 29 becomes Feb 28 in the prior period', () => {
        expect(priorPeriodOf(buildPeriod(2028, '2028-02-29')).endIso).toBe('2027-02-28');
    });
    test('the prior period of a past year is the whole year before', () => {
        expect(priorPeriodOf(P2025).endIso).toBe('2024-12-31');
    });
});

describe('dataFloorIso', () => {
    test('picks the earliest date across every source', () => {
        expect(dataFloorIso({
            balanceHistory: [{ date: '2025-05-01' }],
            snapshots: [{ date: '2025-02-01' }],
            manualTransactions: [{ date: '2025-06-01' }],
            reconciliations: [{ date: '2025-07-01' }],
            overrides: { 'recurring|5|2|2024-04-05': {} },
            cleared: { 'income|1|2|2024-09-01': {} }
        })).toBe('2024-04-05');
    });
    test('plan inputs (first payday, template start, bonus date) do not set the floor (review)', () => {
        expect(dataFloorIso({
            incomes: [{ firstPayDate: '2015-01-02' }],
            recurringTemplates: [{ startDate: '2015-01-01' }],
            bonuses: [{ date: '2015-12-24' }],
            balanceHistory: [{ date: '2025-03-01' }]
        })).toBe('2025-03-01');
        expect(dataFloorIso({ incomes: [{ firstPayDate: '2015-01-02' }] })).toBeNull();
    });
    test('no data gives null', () => {
        expect(dataFloorIso({})).toBeNull();
    });
});

describe('netWorthChange', () => {
    test('first and last point inside the period', () => {
        const out = run('netWorthChange', input({ netWorthPoints: [
            { monthKey: '2024-12', netWorth: 1, kind: 'snapshot' },
            { monthKey: '2025-01', netWorth: 1000, kind: 'snapshot' },
            { monthKey: '2025-12', netWorth: 1500, kind: 'snapshot' }
        ] }));
        expect(out).toMatchObject({ id: 'netWorthChange', kind: 'actual', key: 'yearReview.i.netWorthUp', estimated: false, vars: { amount: { $: 500 }, since: { m: '2025-01' } } });
    });
    test('a last point before the period ends names its month (review)', () => {
        const out = run('netWorthChange', input({ netWorthPoints: [
            { monthKey: '2025-01', netWorth: 1000, kind: 'snapshot' },
            { monthKey: '2025-06', netWorth: 1500, kind: 'snapshot' }
        ] }));
        expect(out).toMatchObject({ key: 'yearReview.i.netWorthUpUntil', vars: { amount: { $: 500 }, since: { m: '2025-01' }, until: { m: '2025-06' } } });
        const down = run('netWorthChange', input({ netWorthPoints: [
            { monthKey: '2025-01', netWorth: 1000, kind: 'snapshot' },
            { monthKey: '2025-06', netWorth: 900, kind: 'snapshot' }
        ] }));
        expect(down.key).toBe('yearReview.i.netWorthDownUntil');
    });
    test('data that starts late in the year uses that first month, never January', () => {
        const out = run('netWorthChange', input({ netWorthPoints: [
            { monthKey: '2025-11', netWorth: 2000, kind: 'snapshot' },
            { monthKey: '2025-12', netWorth: 1800, kind: 'estimated' }
        ] }));
        expect(out).toMatchObject({ key: 'yearReview.i.netWorthDown', estimated: true, vars: { amount: { $: 200 }, since: { m: '2025-11' } } });
    });
    test('one point is not enough', () => {
        expect(run('netWorthChange', input({ netWorthPoints: [{ monthKey: '2025-03', netWorth: 1, kind: 'live' }] }))).toBeNull();
    });
});

describe('debtPaidDown', () => {
    const debts = [{ id: 1, name: 'Visa', interestRate: 20 }, { id: 2, name: 'Car', interestRate: 5 }];
    test('balance before the period vs at its end', () => {
        const out = run('debtPaidDown', input({ debts, balanceHistory: [
            { debtId: 1, date: '2024-11-01', balance: 5000 },
            { debtId: 1, date: '2025-10-01', balance: 3000 }
        ] }));
        expect(out).toMatchObject({ key: 'yearReview.i.debtPaidDown', plural: true, vars: { count: 1, amount: { $: 2000 } } });
    });
    test('a debt first recorded mid-year at the same balance is not paid down', () => {
        expect(run('debtPaidDown', input({ debts, balanceHistory: [
            { debtId: 1, date: '2025-06-01', balance: 4000 },
            { debtId: 1, date: '2025-12-01', balance: 4000 }
        ] }))).toBeNull();
    });
    test('an increase is not netted against a decrease', () => {
        const out = run('debtPaidDown', input({ debts, balanceHistory: [
            { debtId: 1, date: '2024-12-01', balance: 1000 },
            { debtId: 1, date: '2025-12-01', balance: 400 },
            { debtId: 2, date: '2024-12-01', balance: 1000 },
            { debtId: 2, date: '2025-12-01', balance: 1500 }
        ] }));
        expect(out.vars).toEqual({ count: 1, amount: { $: 600 } });
    });
    test('entries after the period are ignored', () => {
        expect(run('debtPaidDown', input({ debts, balanceHistory: [
            { debtId: 1, date: '2024-12-01', balance: 1000 },
            { debtId: 1, date: '2026-02-01', balance: 0 }
        ] }))).toBeNull();
    });
});

describe('debtCleared', () => {
    const debts = [1, 2, 3, 4].map(id => ({ id, name: `D${id}`, interestRate: 10 }));
    test('a balance that reaches zero in the period names the month', () => {
        const out = run('debtCleared', input({ debts, balanceHistory: [
            { debtId: 1, date: '2025-07-01', balance: 300 },
            { debtId: 1, date: '2025-08-15', balance: 0 }
        ] }));
        expect(out).toEqual([expect.objectContaining({ key: 'yearReview.i.debtCleared', vars: { name: 'D1', month: { m: '2025-08' } } })]);
    });
    test('a debt whose only entry is zero is not cleared', () => {
        expect(run('debtCleared', input({ debts, balanceHistory: [{ debtId: 1, date: '2025-03-01', balance: 0 }] }))).toBeNull();
    });
    test('beyond three, the rest are counted', () => {
        const history = [];
        for (const id of [1, 2, 3, 4]) {
            history.push({ debtId: id, date: '2025-01-01', balance: 100 }, { debtId: id, date: `2025-0${id + 1}-01`, balance: 0 });
        }
        const out = run('debtCleared', input({ debts, balanceHistory: history }));
        expect(out).toHaveLength(4);
        expect(out.slice(0, 3).map(i => i.vars.name)).toEqual(['D1', 'D2', 'D3']);
        expect(out[3]).toMatchObject({ key: 'yearReview.i.debtClearedMore', plural: true, vars: { count: 1 } });
    });
});

describe('interestEstimate', () => {
    test('monthly daily-compounded interest on the carried-forward balance', () => {
        const out = run('interestEstimate', input({
            debts: [{ id: 1, name: 'Card', interestRate: 12 }],
            balanceHistory: [{ debtId: 1, date: '2024-06-01', balance: 1200 }]
        }));
        let expected = 0;
        for (let m = 0; m < 12; m++) {
            const days = new Date(2025, m + 1, 0).getDate();
            expected += 1200 * (Math.pow(1 + 0.12 / 365, days) - 1);
        }
        expect(out).toMatchObject({ key: 'yearReview.i.interest', estimated: true, vars: { name: 'Card' } });
        expect(out.vars.amount.$).toBeCloseTo(expected, 2);
    });
    test('names the debt that cost the most', () => {
        const out = run('interestEstimate', input({
            debts: [{ id: 1, name: 'Small', interestRate: 5 }, { id: 2, name: 'Big', interestRate: 20 }],
            balanceHistory: [{ debtId: 1, date: '2024-01-01', balance: 1000 }, { debtId: 2, date: '2024-01-01', balance: 1000 }]
        }));
        expect(out.vars.name).toBe('Big');
    });
    test('a debt is only charged from its first entry', () => {
        const out = run('interestEstimate', input({
            debts: [{ id: 1, name: 'Card', interestRate: 12 }],
            balanceHistory: [{ debtId: 1, date: '2025-12-10', balance: 1200 }]
        }));
        expect(out.vars.amount.$).toBeCloseTo(1200 * (Math.pow(1 + 0.12 / 365, 31) - 1), 2);
    });
    test('zero APR gives nothing', () => {
        expect(run('interestEstimate', input({
            debts: [{ id: 1, name: 'Card', interestRate: 0 }],
            balanceHistory: [{ debtId: 1, date: '2024-01-01', balance: 1200 }]
        }))).toBeNull();
    });
    test('the partial current month counts days up to today', () => {
        const period = buildPeriod(2026, '2026-01-10');
        const out = run('interestEstimate', input({
            period,
            debts: [{ id: 1, name: 'Card', interestRate: 12 }],
            balanceHistory: [{ debtId: 1, date: '2025-01-01', balance: 1200 }]
        }));
        expect(out.vars.amount.$).toBeCloseTo(1200 * (Math.pow(1 + 0.12 / 365, 10) - 1), 2);
    });
});

describe('computeYearInsights', () => {
    test('actual before planned, then by weight; null rules dropped', () => {
        const fake = [
            () => ({ id: 'p', kind: 'planned', weight: 999 }),
            () => null,
            () => ({ id: 'a1', kind: 'actual', weight: 10 }),
            () => [{ id: 'a2', kind: 'actual', weight: 50 }, { id: 'a3', kind: 'actual', weight: 50 }]
        ];
        expect(computeYearInsights(input(), fake).map(i => i.id)).toEqual(['a2', 'a3', 'a1', 'p']);
    });
    test('the default rule list is exported and runs on empty input', () => {
        expect(Array.isArray(RULES)).toBe(true);
        expect(computeYearInsights(input())).toEqual([]);
    });
});

// ─── Task 2: remaining actual rules ─────────────────────────────────────────

describe('amountChanges', () => {
    const tmpl = (o) => ({ id: 1, name: 'Netflix', type: 'subscription', amount: 15, frequency: 'monthly', amountChanges: [], ...o });
    test('a price change inside the period, from the amount in effect the day before', () => {
        const out = run('amountChanges', input({ recurringTemplates: [tmpl({ amountChanges: [{ from: '2024-06-01', amount: 16 }, { from: '2025-03-01', amount: 18 }] })] }));
        expect(out).toEqual([expect.objectContaining({ key: 'yearReview.i.priceChange', vars: { name: 'Netflix', from: { $: 16 }, to: { $: 18 }, month: { m: '2025-03' } } })]);
    });
    test('a change outside the period is ignored', () => {
        expect(run('amountChanges', input({ recurringTemplates: [tmpl({ amountChanges: [{ from: '2026-01-01', amount: 18 }] })] }))).toBeNull();
    });
    test('income and inflow templates are pay changes; transfers are skipped', () => {
        const out = run('amountChanges', input({
            incomes: [{ id: 3, name: 'Salary', amount: 1000, frequency: 'biweekly', amountChanges: [{ from: '2025-07-01', amount: 1080 }] }],
            recurringTemplates: [tmpl({ type: 'transfer', amountChanges: [{ from: '2025-02-01', amount: 99 }] })]
        }));
        expect(out).toEqual([expect.objectContaining({ key: 'yearReview.i.payChange', vars: { name: 'Salary', from: { $: 1000 }, to: { $: 1080 }, month: { m: '2025-07' } } })]);
    });
    test('the top two by annualized difference are named, the rest counted', () => {
        const out = run('amountChanges', input({ recurringTemplates: [
            tmpl({ id: 1, name: 'Small', amountChanges: [{ from: '2025-02-01', amount: 16 }] }),       // 1 x 12 = 12
            tmpl({ id: 2, name: 'Weekly', frequency: 'weekly', amount: 10, amountChanges: [{ from: '2025-02-01', amount: 11 }] }), // 1 x 52 = 52
            tmpl({ id: 3, name: 'Yearly', frequency: 'yearly', amount: 100, amountChanges: [{ from: '2025-02-01', amount: 130 }] }) // 30 x 1 = 30
        ] }));
        expect(out.map(i => i.vars.name || i.vars.count)).toEqual(['Weekly', 'Yearly', 1]);
        expect(out[2]).toMatchObject({ key: 'yearReview.i.changesMore', plural: true });
    });
});

describe('actualsVsPlan', () => {
    const ov = (date, amount, originalAmount) => ({ amount, originalAmount, date });
    test('counts differing overrides in the period and sums the difference', () => {
        const out = run('actualsVsPlan', input({ overrides: {
            'recurring|1|2|2025-02-05': ov('2025-02-05', -25, -15),
            'recurring|1|2|2025-03-05': ov('2025-03-05', -25, -15),
            'expense|4|2|2025-04-01': ov('2025-04-01', -95, -100),
            'expense|4|2|2024-04-01': ov('2024-04-01', -500, -100),
            'debt|5|2|2025-05-01': ov('2025-05-01', -50, null),
            'debt|6|2|2025-06-01': ov('2025-06-01', -50, -50)
        } }));
        expect(out).toMatchObject({ key: 'yearReview.i.actualsMore', plural: true, vars: { count: 3, amount: { $: 15 } } });
    });
    test('less than planned', () => {
        expect(run('actualsVsPlan', input({ overrides: { 'bill|1|2|2025-02-01': ov('2025-02-01', -80, -100) } })).key).toBe('yearReview.i.actualsLess');
    });
    test('differences that cancel out', () => {
        expect(run('actualsVsPlan', input({ overrides: {
            'bill|1|2|2025-02-01': ov('2025-02-01', -80, -100),
            'bill|1|2|2025-03-01': ov('2025-03-01', -120, -100)
        } })).key).toBe('yearReview.i.actualsEven');
    });
    test('nothing differing gives nothing', () => {
        expect(run('actualsVsPlan', input())).toBeNull();
    });
});

describe('goalsReached', () => {
    test('goals completed in the period', () => {
        const out = run('goalsReached', input({ sinkingFunds: [
            { name: 'Vacation', completedDate: '2025-06-01' },
            { name: 'Car', completedDate: '2025-08-01' },
            { name: 'Laptop', completedDate: '2025-09-01' },
            { name: 'Old', completedDate: '2024-12-31' },
            { name: 'Open', completedDate: null }
        ] }));
        expect(out).toMatchObject({ key: 'yearReview.i.goalsReached', plural: true, vars: { count: 3, names: 'Vacation, Car' } });
    });
    test('none gives nothing', () => {
        expect(run('goalsReached', input({ sinkingFunds: [{ name: 'Open', completedDate: null }] }))).toBeNull();
    });
});

describe('reconciliations', () => {
    // `difference` is not an adjustment in record-only mode (it is statement
    // minus the starting balance), so only the count is reported (review).
    test('counts reconciliations in the period, whatever their difference', () => {
        const out = run('reconciliations', input({ reconciliations: [
            { date: '2025-03-31', difference: -12.5 },
            { date: '2025-04-30', difference: 7 },
            { date: '2025-05-31', difference: 0 },
            { date: '2024-12-31', difference: 100 }
        ] }));
        expect(out).toMatchObject({ key: 'yearReview.i.reconciled', plural: true, vars: { count: 3 } });
        expect(out.vars.amount).toBeUndefined();
    });
    test('none gives nothing', () => {
        expect(run('reconciliations', input())).toBeNull();
    });
});

// ─── Task 3: planned rules ──────────────────────────────────────────────────

const tx = (type, amount, category, extra = {}) => ({ type, amount, category, name: 'x', ...extra });
const months12 = (fn) => Array.from({ length: 12 }, (_, m) => fn(m));
const OLD_FLOOR = '2023-05-01';   // allows comparing 2025 with 2024
const LATE_FLOOR = '2024-06-01';  // does not

describe('subscriptionsTotal', () => {
    const monthsTx = months12(() => [tx('recurring', -20, 'Subscriptions'), tx('recurring', -500, 'Transfer', { isTransferLeg: true }), tx('recurring', 50, 'Income')]);
    const priorMonthsTx = months12(() => [tx('recurring', -200 / 12, 'Subscriptions')]);
    test('sums recurring outflows, skipping transfer legs and inflows', () => {
        expect(run('subscriptionsTotal', input({ monthsTx, floorIso: LATE_FLOOR }))).toMatchObject({ kind: 'planned', key: 'yearReview.i.subscriptions', vars: { amount: { $: 240 } } });
    });
    test('compares with last year when the data floor allows', () => {
        expect(run('subscriptionsTotal', input({ monthsTx, priorMonthsTx, floorIso: OLD_FLOOR }))).toMatchObject({ key: 'yearReview.i.subscriptionsUp', vars: { amount: { $: 240 }, pct: { pct: 20 } } });
    });
    test('no comparison when data starts after the prior period begins', () => {
        expect(run('subscriptionsTotal', input({ monthsTx, priorMonthsTx, floorIso: LATE_FLOOR })).key).toBe('yearReview.i.subscriptions');
    });
    test('a fall is reported as down', () => {
        const prior = months12(() => [tx('recurring', -30, 'Subscriptions')]);
        expect(run('subscriptionsTotal', input({ monthsTx, priorMonthsTx: prior, floorIso: OLD_FLOOR })).key).toBe('yearReview.i.subscriptionsDown');
    });
    test('none gives nothing', () => {
        expect(run('subscriptionsTotal', input())).toBeNull();
    });
});

describe('topCategory', () => {
    test('largest spending category and its share', () => {
        const monthsTx = months12(m => m === 0 ? [tx('expense', -600, 'Housing'), tx('bill', -300, 'Food'), tx('manual', -100, null), tx('debt', -500, 'x'), tx('savings', -500, 'x')] : []);
        expect(run('topCategory', input({ monthsTx }))).toMatchObject({ key: 'yearReview.i.topCategory', vars: { category: { cat: 'Housing' }, pct: { pct: 30 } } });
    });
    test('debt payments and savings are categories, as on the Spending tab (review)', () => {
        const monthsTx = months12(m => m === 0 ? [tx('expense', -600, 'Housing'), tx('debt', -900, 'x'), tx('savings', -500, 'x')] : []);
        expect(run('topCategory', input({ monthsTx })).vars.category).toEqual({ cat: 'Debt Payments' });
    });
    test('no spending gives nothing', () => {
        expect(run('topCategory', input({ monthsTx: months12(() => [tx('income', 100, 'Income')]) }))).toBeNull();
    });
});

describe('biggestCategoryChange', () => {
    const one = (amt) => months12(m => m === 0 ? [tx('expense', -amt, 'Food')] : []);
    test('a rise of at least 10% and $100 is reported', () => {
        expect(run('biggestCategoryChange', input({ monthsTx: one(1100), priorMonthsTx: one(1000), floorIso: OLD_FLOOR })))
            .toMatchObject({ key: 'yearReview.i.categoryRise', vars: { category: { cat: 'Food' }, amount: { $: 100 }, pct: { pct: 10 } } });
    });
    test('9.9% is not enough', () => {
        expect(run('biggestCategoryChange', input({ monthsTx: one(1099), priorMonthsTx: one(1000), floorIso: OLD_FLOOR }))).toBeNull();
    });
    test('$99 is not enough, however large the percentage', () => {
        expect(run('biggestCategoryChange', input({ monthsTx: one(199), priorMonthsTx: one(100), floorIso: OLD_FLOOR }))).toBeNull();
    });
    test('needs the data floor', () => {
        expect(run('biggestCategoryChange', input({ monthsTx: one(2000), priorMonthsTx: one(1000), floorIso: LATE_FLOOR }))).toBeNull();
    });
    test('a category new this year has no percentage and is skipped', () => {
        expect(run('biggestCategoryChange', input({ monthsTx: one(2000), priorMonthsTx: months12(() => []), floorIso: OLD_FLOOR }))).toBeNull();
    });
    test('picks the largest qualifying increase', () => {
        const cur = months12(m => m === 0 ? [tx('expense', -1200, 'Food'), tx('expense', -3000, 'Travel')] : []);
        const pri = months12(m => m === 0 ? [tx('expense', -1000, 'Food'), tx('expense', -2000, 'Travel')] : []);
        expect(run('biggestCategoryChange', input({ monthsTx: cur, priorMonthsTx: pri, floorIso: OLD_FLOOR })).vars.category).toEqual({ cat: 'Travel' });
    });
});

describe('bestAndWorstMonth', () => {
    const three = [
        [tx('income', 1000, 'Income'), tx('expense', -500, 'Food')],
        [tx('income', 400, 'Income'), tx('bill', -500, 'Utilities')],
        [tx('income', 1000, 'Income'), tx('debt', -100, 'Debt')]
    ];
    test('a past year names the best and worst month by net', () => {
        const monthsTx = months12(m => three[m] || []);
        expect(run('bestAndWorstMonth', input({ monthsTx }))).toMatchObject({ key: 'yearReview.i.bestWorst', vars: { best: { m: '2025-03' }, bestNet: { $: 900 }, worst: { m: '2025-02' }, worstNet: { $: -100 } } });
    });
    test('the current partial month is left out', () => {
        const period = buildPeriod(2026, '2026-03-10');
        const out = run('bestAndWorstMonth', input({ period, monthsTx: three, priorMonthsTx: [[], [], []] }));
        expect(out.vars.best).toEqual({ m: '2026-01' });
        expect(out.vars.worst).toEqual({ m: '2026-02' });
    });
    test('January of the current year has too few months', () => {
        const period = buildPeriod(2026, '2026-01-20');
        expect(run('bestAndWorstMonth', input({ period, monthsTx: [three[0]], priorMonthsTx: [[]] }))).toBeNull();
    });
});

describe('debtShareOfIncome', () => {
    test('debt payments as a share of income', () => {
        const monthsTx = months12(() => [tx('income', 1000, 'Income'), tx('debt', -250, 'Debt')]);
        expect(run('debtShareOfIncome', input({ monthsTx }))).toMatchObject({ key: 'yearReview.i.debtShare', vars: { pct: { pct: 25 } } });
    });
    test('no income or no debt gives nothing', () => {
        expect(run('debtShareOfIncome', input({ monthsTx: months12(() => [tx('debt', -250, 'Debt')]) }))).toBeNull();
        expect(run('debtShareOfIncome', input({ monthsTx: months12(() => [tx('income', 100, 'Income')]) }))).toBeNull();
    });
});

describe('incomeChange', () => {
    const cur = months12(() => [tx('income', 900, 'Income'), tx('bonus', 100, 'Bonus'), tx('recurring', 0, 'Income')]);
    test('total income', () => {
        expect(run('incomeChange', input({ monthsTx: cur }))).toMatchObject({ key: 'yearReview.i.income', vars: { amount: { $: 12000 } } });
    });
    test('up and down against last year', () => {
        expect(run('incomeChange', input({ monthsTx: cur, priorMonthsTx: months12(() => [tx('income', 10000 / 12, 'Income')]), floorIso: OLD_FLOOR })))
            .toMatchObject({ key: 'yearReview.i.incomeUp', vars: { pct: { pct: 20 } } });
        expect(run('incomeChange', input({ monthsTx: cur, priorMonthsTx: months12(() => [tx('income', 1500, 'Income')]), floorIso: OLD_FLOOR })).key)
            .toBe('yearReview.i.incomeDown');
    });
    test('planned insights sort after actual ones', () => {
        const all = computeYearInsights(input({ monthsTx: cur, netWorthPoints: [{ monthKey: '2025-01', netWorth: 1, kind: 'snapshot' }, { monthKey: '2025-05', netWorth: 2, kind: 'snapshot' }] }));
        expect(all[0].kind).toBe('actual');
        expect(all[all.length - 1].kind).toBe('planned');
    });
});
