// #547: category budget derivation and mutations (src/categoryBudgets.js, #255).
// The Ledger projection and the Spending classifier are mocked: they have their own
// coverage, and spending.js pulls in DOM modules. Only the budget logic runs for real.
jest.mock('../../src/ledgerTransactions.js', () => ({ getLedgerTransactionsForMonth: jest.fn() }));
jest.mock('../../src/spending.js', () => ({
    spendingCategoryForTx: jest.fn(tx => tx.category || null),
    computeSpendingByCategoryRange: jest.fn(() => []),
}));

const { getLedgerTransactionsForMonth } = require('../../src/ledgerTransactions.js');
const { spendingCategoryForTx, computeSpendingByCategoryRange } = require('../../src/spending.js');
const {
    computeDerivedBudgetByCategory, computeCategoryBudgets, setCategoryBudget,
    resetCategoryBudget, getKnownBudgetCategories,
} = require('../../src/categoryBudgets.js');

// months[`${year}-${month}`] -> ledger rows for that month
function stubLedger(months) {
    getLedgerTransactionsForMonth.mockImplementation((app, y, m) => months[`${y}-${m}`] || []);
}

function stubActuals(byCategory) {
    computeSpendingByCategoryRange.mockImplementation(() =>
        Object.entries(byCategory).map(([category, total]) => ({ category, total })));
}

beforeEach(() => {
    getLedgerTransactionsForMonth.mockReset();
    getLedgerTransactionsForMonth.mockReturnValue([]);
    computeSpendingByCategoryRange.mockReset();
    computeSpendingByCategoryRange.mockReturnValue([]);
    spendingCategoryForTx.mockClear();
});

describe('computeDerivedBudgetByCategory', () => {
    test('sums the absolute pre-override amounts per category', () => {
        stubLedger({ '2026-4': [
            { type: 'bill', category: 'Rent', originalAmount: -1000, amount: -900 },
            { type: 'bill', category: 'Rent', originalAmount: -50 },
            { type: 'expense', category: 'Food', originalAmount: 200 },
        ] });
        const out = computeDerivedBudgetByCategory({}, 2026, 4);
        expect(out.get('Rent')).toBe(1050);
        expect(out.get('Food')).toBe(200);
        expect(out.size).toBe(2);
    });

    test('classifies using originalAmount, not the overridden amount', () => {
        stubLedger({ '2026-4': [{ type: 'bill', category: 'Rent', originalAmount: -500, amount: -1 }] });
        computeDerivedBudgetByCategory({}, 2026, 4);
        expect(spendingCategoryForTx).toHaveBeenCalledWith(expect.objectContaining({ amount: -500 }));
    });

    test('skips manual transactions and rows the classifier rejects', () => {
        stubLedger({ '2026-4': [
            { type: 'manual', category: 'Food', originalAmount: -80 },
            { type: 'bill', category: '', originalAmount: -10 },
            { type: 'bill', category: 'Rent', originalAmount: -10 },
        ] });
        const out = computeDerivedBudgetByCategory({}, 2026, 4);
        expect(Array.from(out.entries())).toEqual([['Rent', 10]]);
    });

    test('a missing originalAmount counts as zero', () => {
        stubLedger({ '2026-4': [{ type: 'bill', category: 'Rent' }] });
        expect(computeDerivedBudgetByCategory({}, 2026, 4).get('Rent')).toBe(0);
    });

    test('an empty month gives an empty map', () => {
        expect(computeDerivedBudgetByCategory({}, 2026, 4).size).toBe(0);
    });
});

describe('computeCategoryBudgets', () => {
    test('a derived category budgets its scheduled amount against actual spend', () => {
        stubLedger({ '2026-4': [{ type: 'bill', category: 'Rent', originalAmount: -1000 }] });
        stubActuals({ Rent: 400 });
        const [row] = computeCategoryBudgets({}, 2026, 4, 1);
        expect(row).toEqual({
            category: 'Rent', mode: 'derived', rollover: null, budget: 1000, carried: 0, available: 1000,
            actual: 400, difference: 600, pctUsed: 0.4, over: false,
        });
    });

    test('a fixed budget replaces the derived one and multiplies by the range length', () => {
        stubLedger({
            '2026-3': [{ type: 'bill', category: 'Food', originalAmount: -999 }],
            '2026-4': [{ type: 'bill', category: 'Food', originalAmount: -999 }],
        });
        stubActuals({ Food: 150 });
        const app = { budgetCategories: { Food: { mode: 'fixed', amount: 100 } } };
        const [row] = computeCategoryBudgets(app, 2026, 4, 2);
        expect(row.mode).toBe('fixed');
        expect(row.budget).toBe(200);
        expect(row.difference).toBe(50);
        expect(row.over).toBe(false);
    });

    test('derived budgets are summed across every month in the range, crossing a year', () => {
        stubLedger({
            '2025-11': [{ type: 'bill', category: 'Rent', originalAmount: -100 }],
            '2026-0': [{ type: 'bill', category: 'Rent', originalAmount: -100 }],
            '2026-1': [{ type: 'bill', category: 'Rent', originalAmount: -100 }],
        });
        const [row] = computeCategoryBudgets({}, 2026, 1, 3);
        expect(row.budget).toBe(300);
        expect(computeSpendingByCategoryRange).toHaveBeenCalledWith({}, 2026, 1, 3);
    });

    test('over budget is flagged only beyond a half cent; the difference goes negative', () => {
        stubLedger({ '2026-4': [{ type: 'bill', category: 'Rent', originalAmount: -100 }] });
        stubActuals({ Rent: 100.004 });
        expect(computeCategoryBudgets({}, 2026, 4, 1)[0].over).toBe(false);
        stubActuals({ Rent: 100.01 });
        const row = computeCategoryBudgets({}, 2026, 4, 1)[0];
        expect(row.over).toBe(true);
        expect(row.difference).toBeCloseTo(-0.01, 5);
    });

    test('a category with no budget has pctUsed null', () => {
        stubActuals({ Fun: 25 });
        const [row] = computeCategoryBudgets({}, 2026, 4, 1);
        expect(row).toMatchObject({ category: 'Fun', budget: 0, actual: 25, pctUsed: null, over: true });
    });

    test('an unconfigured category with no budget and no spend is left out; a configured one stays', () => {
        stubLedger({ '2026-4': [{ type: 'bill', category: 'Zero', originalAmount: 0 }] });
        const app = { budgetCategories: { Saved: { mode: 'fixed', amount: 0 } } };
        const rows = computeCategoryBudgets(app, 2026, 4, 1);
        expect(rows.map(r => r.category)).toEqual(['Saved']);
    });

    test('rows sort by actual descending, then by name', () => {
        stubLedger({ '2026-4': [
            { type: 'bill', category: 'B', originalAmount: -10 },
            { type: 'bill', category: 'A', originalAmount: -10 },
            { type: 'bill', category: 'C', originalAmount: -10 },
        ] });
        stubActuals({ B: 5, A: 5, C: 9 });
        expect(computeCategoryBudgets({}, 2026, 4, 1).map(r => r.category)).toEqual(['C', 'A', 'B']);
    });

    test('ignores a non-object budgetCategories and inherited keys', () => {
        stubActuals({ constructor: 5 });
        const rows = computeCategoryBudgets({ budgetCategories: 'nope' }, 2026, 4, 1);
        expect(rows).toHaveLength(1);
        expect(rows[0].mode).toBe('derived');
        const rows2 = computeCategoryBudgets({ budgetCategories: null }, 2026, 4, 1);
        expect(rows2[0].mode).toBe('derived');
    });

    test('a derived entry stays derived (mode derived is not fixed)', () => {
        stubLedger({ '2026-4': [{ type: 'bill', category: 'Rent', originalAmount: -70 }] });
        const app = { budgetCategories: { Rent: { mode: 'derived', amount: 5 } } };
        const [row] = computeCategoryBudgets(app, 2026, 4, 1);
        expect(row.mode).toBe('derived');
        expect(row.budget).toBe(70);
    });

    test('rangeMonths defaults to one month', () => {
        stubLedger({ '2026-4': [{ type: 'bill', category: 'Rent', originalAmount: -70 }] });
        expect(computeCategoryBudgets({}, 2026, 4)[0].budget).toBe(70);
    });
});

describe('setCategoryBudget', () => {
    const makeApp = budgetCategories => ({ budgetCategories, saveToStorage: jest.fn() });

    test('stores a fixed budget, trims the name and saves only that field', () => {
        const app = makeApp({});
        expect(setCategoryBudget(app, '  Food  ', 'fixed', '250.50')).toEqual({ ok: true, name: 'Food' });
        expect(app.budgetCategories).toEqual({ Food: { mode: 'fixed', amount: 250.5 } });
        expect(app.saveToStorage).toHaveBeenCalledWith(['budgetCategories']);
    });

    test('a derived entry stores amount 0 and ignores the amount input', () => {
        const app = makeApp({});
        expect(setCategoryBudget(app, 'Food', 'derived', 'junk').ok).toBe(true);
        expect(app.budgetCategories.Food).toEqual({ mode: 'derived', amount: 0 });
    });

    test('keeps the other categories', () => {
        const app = makeApp({ Rent: { mode: 'fixed', amount: 5 } });
        setCategoryBudget(app, 'Food', 'fixed', 1);
        expect(Object.keys(app.budgetCategories).sort()).toEqual(['Food', 'Rent']);
    });

    test('accepts 0 and the maximum amount', () => {
        const app = makeApp({});
        expect(setCategoryBudget(app, 'A', 'fixed', '0').ok).toBe(true);
        expect(setCategoryBudget(app, 'B', 'fixed', 1e9).ok).toBe(true);
    });

    test('rejects each invalid input without changing or saving anything', () => {
        const cases = [
            ['', 'fixed', '5'],
            ['   ', 'fixed', '5'],
            ['__proto__', 'fixed', '5'],
            ['constructor', 'fixed', '5'],
            ['prototype', 'fixed', '5'],
            ['Food', 'bogus', '5'],
            ['Food', 'fixed', ''],
            ['Food', 'fixed', '   '],
            ['Food', 'fixed', null],
            ['Food', 'fixed', 'abc'],
            ['Food', 'fixed', 'Infinity'],
            ['Food', 'fixed', '-1'],
            ['Food', 'fixed', 1e9 + 1],
        ];
        const errors = new Set();
        for (const [name, mode, amount] of cases) {
            const app = makeApp({});
            const res = setCategoryBudget(app, name, mode, amount);
            expect(res.ok).toBe(false);
            expect(typeof res.error).toBe('string');
            expect(res.error.length).toBeGreaterThan(0);
            errors.add(res.error);
            expect(app.budgetCategories).toEqual({});
            expect(app.saveToStorage).not.toHaveBeenCalled();
        }
        expect(errors.size).toBeGreaterThanOrEqual(5);
    });

    test('limits the number of categories but allows editing an existing one', () => {
        const full = {};
        for (let i = 0; i < 200; i++) full['C' + i] = { mode: 'derived', amount: 0 };
        const app = makeApp(full);
        expect(setCategoryBudget(app, 'One more', 'fixed', 1).ok).toBe(false);
        expect(Object.keys(app.budgetCategories)).toHaveLength(200);
        expect(setCategoryBudget(app, 'C5', 'fixed', 9).ok).toBe(true);
        expect(app.budgetCategories.C5).toEqual({ mode: 'fixed', amount: 9 });
        const almost = makeApp({ ...full });
        delete almost.budgetCategories.C0;
        expect(setCategoryBudget(almost, 'One more', 'fixed', 1).ok).toBe(true);
    });

    test('a missing budgetCategories object is treated as empty', () => {
        const app = { saveToStorage: jest.fn() };
        expect(setCategoryBudget(app, 'Food', 'fixed', 3).ok).toBe(true);
        expect(app.budgetCategories).toEqual({ Food: { mode: 'fixed', amount: 3 } });
    });
});

describe('resetCategoryBudget', () => {
    test('removes the entry without mutating the old object and saves', () => {
        const before = { Food: { mode: 'fixed', amount: 5 }, Rent: { mode: 'derived', amount: 0 } };
        const app = { budgetCategories: before, saveToStorage: jest.fn() };
        resetCategoryBudget(app, 'Food');
        expect(app.budgetCategories).toEqual({ Rent: { mode: 'derived', amount: 0 } });
        expect(before.Food).toBeDefined();
        expect(app.saveToStorage).toHaveBeenCalledWith(['budgetCategories']);
    });

    test('an unknown category (or an inherited key) does nothing and does not save', () => {
        const app = { budgetCategories: { Food: { mode: 'fixed', amount: 5 } }, saveToStorage: jest.fn() };
        resetCategoryBudget(app, 'Nope');
        resetCategoryBudget(app, 'constructor');
        expect(app.budgetCategories).toEqual({ Food: { mode: 'fixed', amount: 5 } });
        expect(app.saveToStorage).not.toHaveBeenCalled();
    });
});

describe('getKnownBudgetCategories', () => {
    test('unions derived, expense, bill and configured categories, sorted, with Other as the default', () => {
        const app = {
            expenses: [{ category: 'Food' }, { }],
            bills: [{ category: 'Utilities' }, { category: '' }],
            budgetCategories: { Zed: { mode: 'fixed', amount: 1 } },
        };
        const out = getKnownBudgetCategories(app, new Map([['Rent', 1], ['Food', 2]]));
        expect(out).toEqual(['Food', 'Other', 'Rent', 'Utilities', 'Zed']);
    });

    test('works with no expenses, bills or budgets', () => {
        expect(getKnownBudgetCategories({}, new Map())).toEqual([]);
    });
});

// ── #687 rollover ─────────────────────────────────────────────────────────

// actualsByMonth['2026-3'] = { Food: 80 } for single-month queries (month is 0-based).
function stubActualsByMonth(actualsByMonth) {
    computeSpendingByCategoryRange.mockImplementation((app, y, m) =>
        Object.entries(actualsByMonth[`${y}-${m}`] || {}).map(([category, total]) => ({ category, total })));
}

describe('computeCategoryBudgets with rollover', () => {
    const fixedApp = (rollover, start, amount = 100) => ({
        budgetCategories: { Food: { mode: 'fixed', amount, rollover, rolloverStart: start } },
    });

    test('both: unspent money from earlier months is carried and available', () => {
        stubActualsByMonth({ '2026-2': { Food: 60 }, '2026-3': { Food: 130 }, '2026-4': { Food: 50 } });
        const [row] = computeCategoryBudgets(fixedApp('both', '2026-03'), 2026, 4, 1);
        // Mar (index 2): +40; Apr (index 3): 40 + 100 - 130 = 10; carried into May = 10
        expect(row).toMatchObject({
            category: 'Food', rollover: 'both', budget: 100, carried: 10, available: 110,
            actual: 50, difference: 60, over: false,
        });
        expect(row.pctUsed).toBeCloseTo(50 / 110, 10);
    });

    test('overspend: unspent money is not carried but overspending is', () => {
        stubActualsByMonth({ '2026-2': { Food: 60 }, '2026-3': { Food: 130 }, '2026-4': { Food: 90 } });
        const [row] = computeCategoryBudgets(fixedApp('overspend', '2026-03'), 2026, 4, 1);
        expect(row).toMatchObject({ rollover: 'overspend', carried: -30, available: 70, actual: 90, difference: -20, over: true });
    });

    test('over is judged against the available amount, not the plain budget', () => {
        stubActualsByMonth({ '2026-3': { Food: 0 }, '2026-4': { Food: 150 } });
        const [row] = computeCategoryBudgets(fixedApp('both', '2026-04'), 2026, 4, 1);
        expect(row).toMatchObject({ carried: 100, available: 200, over: false, difference: 50 });
    });

    test('a negative available amount gives pctUsed null and a negative difference', () => {
        stubActualsByMonth({ '2026-3': { Food: 400 }, '2026-4': { Food: 10 } });
        const [row] = computeCategoryBudgets(fixedApp('both', '2026-04'), 2026, 4, 1);
        expect(row).toMatchObject({ carried: -300, available: -200, pctUsed: null, over: true });
    });

    test('the carry starts at zero in the start month and ignores earlier months', () => {
        stubActualsByMonth({ '2026-0': { Food: 0 }, '2026-1': { Food: 0 }, '2026-4': { Food: 10 } });
        expect(computeCategoryBudgets(fixedApp('both', '2026-05'), 2026, 4, 1)[0]).toMatchObject({ carried: 0, available: 100 });
        // a start after the viewed month also carries nothing
        expect(computeCategoryBudgets(fixedApp('both', '2027-01'), 2026, 4, 1)[0]).toMatchObject({ carried: 0, available: 100 });
    });

    test('derived categories roll over their scheduled amount month by month', () => {
        stubLedger({
            '2026-2': [{ type: 'bill', category: 'Rent', originalAmount: -100 }],
            '2026-3': [{ type: 'bill', category: 'Rent', originalAmount: -100 }],
            '2026-4': [{ type: 'bill', category: 'Rent', originalAmount: -100 }],
        });
        stubActualsByMonth({ '2026-2': { Rent: 90 }, '2026-3': { Rent: 90 }, '2026-4': { Rent: 100 } });
        const app = { budgetCategories: { Rent: { mode: 'derived', amount: 0, rollover: 'both', rolloverStart: '2026-03' } } };
        const [row] = computeCategoryBudgets(app, 2026, 4, 1);
        expect(row).toMatchObject({ mode: 'derived', budget: 100, carried: 20, available: 120, difference: 20 });
    });

    test('for a range the carry is into its first month and the budget is multiplied', () => {
        computeSpendingByCategoryRange.mockImplementation((app, y, m, n) => n === 1
            ? (y === 2026 && m === 2 ? [{ category: 'Food', total: 50 }] : [])
            : [{ category: 'Food', total: 120 }]);
        const [row] = computeCategoryBudgets(fixedApp('both', '2026-03'), 2026, 4, 2);
        expect(row).toMatchObject({ budget: 200, carried: 50, available: 250, actual: 120, difference: 130 });
    });

    test('only rollover categories pay for the monthly passes', () => {
        stubActuals({ Food: 10 });
        computeCategoryBudgets({ budgetCategories: { Food: { mode: 'fixed', amount: 100 } } }, 2026, 4, 1);
        expect(computeSpendingByCategoryRange).toHaveBeenCalledTimes(1);
    });

    test('rollover off: values are exactly the pre-rollover ones', () => {
        stubLedger({ '2026-4': [{ type: 'bill', category: 'Rent', originalAmount: -1000 }] });
        stubActuals({ Rent: 1200, Fun: 5 });
        const app = { budgetCategories: { Food: { mode: 'fixed', amount: 50 } } };
        for (const row of computeCategoryBudgets(app, 2026, 4, 1)) {
            expect(row.rollover).toBeNull();
            expect(row.carried).toBe(0);
            expect(row.available).toBe(row.budget);
            expect(row.difference).toBe(row.budget - row.actual);
        }
    });

    test('an invalid rollover pair on an in-memory entry is treated as off', () => {
        stubActualsByMonth({ '2026-3': { Food: 0 } });
        for (const entry of [{ rollover: 'both' }, { rolloverStart: '2026-03' }, { rollover: 'x', rolloverStart: '2026-03' },
            { rollover: 'both', rolloverStart: '2026-13' }]) {
            const app = { budgetCategories: { Food: { mode: 'fixed', amount: 100, ...entry } } };
            expect(computeCategoryBudgets(app, 2026, 4, 1)[0]).toMatchObject({ rollover: null, carried: 0, available: 100 });
        }
    });
});

describe('setCategoryBudget rollover', () => {
    const makeApp = budgetCategories => ({ budgetCategories, saveToStorage: jest.fn() });

    test('stores the mode and start month', () => {
        const app = makeApp({});
        expect(setCategoryBudget(app, 'Food', 'fixed', 100, 'both', '2026-11').ok).toBe(true);
        expect(app.budgetCategories.Food).toEqual({ mode: 'fixed', amount: 100, rollover: 'both', rolloverStart: '2026-11' });
        expect(setCategoryBudget(app, 'Rent', 'derived', '', 'overspend', '2026-01').ok).toBe(true);
        expect(app.budgetCategories.Rent).toEqual({ mode: 'derived', amount: 0, rollover: 'overspend', rolloverStart: '2026-01' });
    });

    test('off (blank, null, undefined or "off") removes both fields', () => {
        for (const off of ['', null, undefined, 'off']) {
            const app = makeApp({ Food: { mode: 'fixed', amount: 100, rollover: 'both', rolloverStart: '2026-11' } });
            expect(setCategoryBudget(app, 'Food', 'fixed', 100, off, '2026-11').ok).toBe(true);
            expect(app.budgetCategories.Food).toEqual({ mode: 'fixed', amount: 100 });
        }
    });

    test('rejects an unknown rollover mode and a missing or invalid start without saving', () => {
        const errors = new Set();
        for (const [mode, start] of [['sideways', '2026-11'], ['both', ''], ['both', undefined], ['both', '2026-13'], ['both', '11/2026'], ['overspend', null]]) {
            const app = makeApp({});
            const res = setCategoryBudget(app, 'Food', 'fixed', 100, mode, start);
            expect(res.ok).toBe(false);
            expect(res.error.length).toBeGreaterThan(0);
            errors.add(res.error);
            expect(app.budgetCategories).toEqual({});
            expect(app.saveToStorage).not.toHaveBeenCalled();
        }
        expect(errors.size).toBe(2);
    });
});
