// Issue #688: splitting a manual transaction across several categories.
// Validator, sanitizer, the shared expand helper, and how Spending, Budget vs.
// Actual, Cash Flow and the Ledger filter/search read a split transaction.
import { sanitizeManualTransaction, sanitizeManualSplits, isValidManualTransaction, sanitizeParsedState } from '../../src/sanitizers.js';
import { expandManualSplits, transactionCategories, transactionHasCategory, hasSplits } from '../../src/manualSplits.js';
import { getLedgerTransactionsForMonth } from '../../src/ledgerTransactions.js';
import { computeAccountBalance } from '../../src/accounts.js';
import { computeSpendingByCategory } from '../../src/spending.js';
import { computeCategoryBudgets } from '../../src/categoryBudgets.js';
import { computeMonthCashFlowTotals } from '../../src/reportsCashFlow.js';
import { computeMoneyFlowSankeyData } from '../../src/reportsMoneyFlowSankey.js';
import { matchesLedgerSearch, buildLedgerMemoLookup } from '../../src/ledgerSearch.js';

function baseApp(extra = {}) {
    return {
        accounts: [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }],
        incomes: [], bonuses: [], debts: [], bills: [], expenses: [], transfers: [],
        recurringTemplates: [], emergencyFunds: [], sinkingFunds: [], reconciliations: [],
        manualTransactions: [], ledgerAmountOverrides: {}, ledgerClearedTransactions: {}, settings: {},
        budgetCategories: {},
        computeAccountBalance(id, y, m) { return computeAccountBalance(this, id, y, m); },
        ...extra
    };
}

function record(overrides) {
    return sanitizeManualTransaction({
        id: 700, accountId: 1, date: '2026-06-10', amount: -100, name: 'Receipt', category: 'Groceries', ...overrides
    }, 700);
}

const receipt = { amount: -100, splits: [
    { category: 'Groceries', amount: -60 },
    { category: 'Household', amount: -30 },
    { category: 'Gifts', amount: -10, memo: 'for Sam' }
] };

describe('isValidManualTransaction with splits', () => {
    test('accepts a 2-way and a 3-way split of an outflow', () => {
        expect(isValidManualTransaction(record({ amount: -100, splits: [{ category: 'A', amount: -40 }, { category: 'B', amount: -60 }] }))).toBe(true);
        expect(isValidManualTransaction(record(receipt))).toBe(true);
    });

    test('accepts a split of an inflow (deposit of parts)', () => {
        expect(isValidManualTransaction(record({ amount: 250, splits: [{ category: 'Salary', amount: 200 }, { category: 'Bonus', amount: 50 }] }))).toBe(true);
    });

    test('no splits, null, or an empty list is an ordinary record', () => {
        expect(isValidManualTransaction(record({}))).toBe(true);
        expect(isValidManualTransaction(record({ splits: null }))).toBe(true);
        expect(record({ splits: [] }).splits).toBeNull();
    });

    test('compares in integer cents, so 0.1 + 0.2 = 0.3 is accepted', () => {
        expect(isValidManualTransaction(record({ amount: -0.3, splits: [{ category: 'A', amount: -0.1 }, { category: 'B', amount: -0.2 }] }))).toBe(true);
        expect(isValidManualTransaction(record({ amount: -1.1, splits: [{ category: 'A', amount: -0.7 }, { category: 'B', amount: -0.4 }] }))).toBe(true);
    });

    test('rejects a sum that is off by one cent, either way', () => {
        expect(isValidManualTransaction(record({ amount: -100, splits: [{ category: 'A', amount: -40 }, { category: 'B', amount: -59.99 }] }))).toBe(false);
        expect(isValidManualTransaction(record({ amount: -100, splits: [{ category: 'A', amount: -40 }, { category: 'B', amount: -60.01 }] }))).toBe(false);
    });

    test('rejects a single split', () => {
        expect(isValidManualTransaction(record({ amount: -100, splits: [{ category: 'A', amount: -100 }] }))).toBe(false);
    });

    test('rejects an empty or missing category', () => {
        expect(isValidManualTransaction(record({ amount: -100, splits: [{ category: '', amount: -40 }, { category: 'B', amount: -60 }] }))).toBe(false);
        expect(isValidManualTransaction(record({ amount: -100, splits: [{ amount: -40 }, { category: 'B', amount: -60 }] }))).toBe(false);
    });

    test('rejects a zero or non-numeric split amount', () => {
        expect(isValidManualTransaction(record({ amount: -100, splits: [{ category: 'A', amount: 0 }, { category: 'B', amount: -100 }] }))).toBe(false);
        expect(isValidManualTransaction(record({ amount: -100, splits: [{ category: 'A', amount: 'x' }, { category: 'B', amount: -100 }] }))).toBe(false);
    });

    test('rejects a split whose sign differs from the transaction, even when the sum matches', () => {
        // -100 = -150 + 50
        expect(isValidManualTransaction(record({ amount: -100, splits: [{ category: 'A', amount: -150 }, { category: 'B', amount: 50 }] }))).toBe(false);
        // positive splits on an outflow
        expect(isValidManualTransaction(record({ amount: -100, splits: [{ category: 'A', amount: 40 }, { category: 'B', amount: 60 }] }))).toBe(false);
        // negative splits on an inflow
        expect(isValidManualTransaction(record({ amount: 100, splits: [{ category: 'A', amount: -40 }, { category: 'B', amount: -60 }] }))).toBe(false);
    });

    test('allows 20 splits and rejects 21', () => {
        const make = n => Array.from({ length: n }, (_, i) => ({ category: `C${i}`, amount: -1 }));
        expect(isValidManualTransaction(record({ amount: -20, splits: make(20) }))).toBe(true);
        expect(isValidManualTransaction(record({ amount: -21, splits: make(21) }))).toBe(false);
    });

    test('rejects non-array junk', () => {
        for (const junk of ['abc', 5, { category: 'A', amount: -100 }, true]) {
            expect(isValidManualTransaction(record({ amount: -100, splits: junk }))).toBe(false);
        }
    });

    test('a junk entry inside the array does not make an unbalanced list look valid', () => {
        // The null entry is dropped; the remaining two do not reach -100.
        expect(isValidManualTransaction(record({ amount: -100, splits: [{ category: 'A', amount: -40 }, null, 'x', { category: 'B', amount: -30 }] }))).toBe(false);
    });
});

describe('sanitizeManualSplits', () => {
    test('rounds to cents, trims and caps text, and drops a blank memo', () => {
        const out = sanitizeManualSplits([
            { category: '  Food  ', amount: -10.004, memo: '' },
            { category: 'c'.repeat(90), amount: '-5.557', memo: 'm'.repeat(300) }
        ]);
        expect(out[0]).toEqual({ category: 'Food', amount: -10 });
        expect(out[1].category.length).toBe(40);
        expect(out[1].amount).toBe(-5.56);
        expect(out[1].memo.length).toBe(200);
    });

    test('absent and empty are null; a non-array is rejected as false', () => {
        expect(sanitizeManualSplits(undefined)).toBeNull();
        expect(sanitizeManualSplits(null)).toBeNull();
        expect(sanitizeManualSplits([])).toBeNull();
        expect(sanitizeManualSplits('x')).toBe(false);
    });

    test('is a stable round trip through the record sanitizer', () => {
        const once = record(receipt);
        const twice = sanitizeManualTransaction(JSON.parse(JSON.stringify(once)), 1);
        expect(twice.splits).toEqual(once.splits);
        expect(twice.splits).toEqual(receipt.splits);
    });
});

describe('import rejects an unbalanced split', () => {
    test('sanitizeParsedState drops the bad record and warns, keeping a good one', () => {
        const warnings = [];
        const state = sanitizeParsedState({
            accounts: [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 0 }],
            manualTransactions: [
                { id: 1, accountId: 1, date: '2026-06-10', amount: -100, name: 'Bad', category: 'A', splits: [{ category: 'A', amount: -40 }, { category: 'B', amount: -50 }] },
                { id: 2, accountId: 1, date: '2026-06-10', amount: -100, name: 'Good', category: 'A', splits: [{ category: 'A', amount: -40 }, { category: 'B', amount: -60 }] }
            ]
        }, warnings);
        expect(state.manualTransactions.map(m => m.name)).toEqual(['Good']);
        expect(state.manualTransactions[0].splits).toHaveLength(2);
        expect(warnings.some(w => w.kind === 'rejected')).toBe(true);
    });
});

describe('expandManualSplits', () => {
    test('an unsplit transaction is one part in its own category with its own sign', () => {
        expect(expandManualSplits({ category: 'Dining', amount: -4.5 })).toEqual([{ category: 'Dining', amount: -4.5 }]);
        expect(expandManualSplits({ amount: 3 })).toEqual([{ category: 'Other', amount: 3 }]);
        expect(hasSplits({ splits: [] })).toBe(false);
    });

    test('a split transaction yields one signed part per split, summing to the amount', () => {
        const parts = expandManualSplits(receipt);
        expect(parts).toEqual([
            { category: 'Groceries', amount: -60 }, { category: 'Household', amount: -30 }, { category: 'Gifts', amount: -10 }
        ]);
        expect(parts.reduce((s, p) => s + p.amount, 0)).toBe(-100);
    });

    test('category helpers see every split', () => {
        expect(transactionCategories(receipt)).toEqual(['Groceries', 'Household', 'Gifts']);
        expect(transactionHasCategory(receipt, 'Household')).toBe(true);
        expect(transactionHasCategory(receipt, 'Dining')).toBe(false);
        expect(transactionCategories({ category: 'A', splits: [{ category: 'A', amount: -1 }, { category: 'A', amount: -2 }] })).toEqual(['A']);
    });
});

describe('reports read each split in its own category', () => {
    const app = baseApp({ manualTransactions: [record(receipt), record({ id: 701, name: 'Coffee', category: 'Groceries', amount: -5, splits: null })] });

    test('one Ledger row and one balance effect for the whole transaction', () => {
        const txs = getLedgerTransactionsForMonth(app, 2026, 5).filter(t => t.type === 'manual');
        expect(txs).toHaveLength(2);
        expect(txs.find(t => t.name === 'Receipt').amount).toBe(-100);
        expect(txs.find(t => t.name === 'Receipt').splits).toHaveLength(3);
        expect(txs.find(t => t.name === 'Coffee').splits).toBeUndefined();
        expect(computeAccountBalance(app, 1, 2026, 5)).toBe(1000 - 105);
    });

    test('Spending attributes each split to its category, totals unchanged', () => {
        const rows = computeSpendingByCategory(app, 2026, 5);
        const byCat = Object.fromEntries(rows.map(r => [r.category, r.total]));
        expect(byCat).toEqual({ Groceries: 65, Household: 30, Gifts: 10 });
        expect(rows.reduce((s, r) => s + r.total, 0)).toBe(105);
        const groceries = rows.find(r => r.category === 'Groceries');
        expect(groceries.transactions.map(t => t.amount).sort((a, b) => a - b)).toEqual([-60, -5]);
    });

    test('Budget vs. Actual actuals follow the split categories', () => {
        const rows = computeCategoryBudgets(app, 2026, 5, 1);
        const actual = Object.fromEntries(rows.map(r => [r.category, r.actual]));
        expect(actual.Groceries).toBe(65);
        expect(actual.Household).toBe(30);
        expect(actual.Gifts).toBe(10);
    });

    test('Cash Flow totals use the whole amount; the Money Flow outflow nodes use the splits', () => {
        const totals = computeMonthCashFlowTotals(app, 2026, 5);
        expect(totals.outflow).toBe(105);
        const sankey = computeMoneyFlowSankeyData(app, 2026, 5);
        const labels = sankey.nodes.map(n => n.label).join('|');
        expect(labels).toMatch(/Household/);
        expect(labels).toMatch(/Gifts/);
        expect(labels).not.toMatch(/Receipt/);
    });

    test('an inflow split is not spending', () => {
        const deposit = baseApp({ manualTransactions: [record({ id: 702, name: 'Deposit', amount: 250, splits: [{ category: 'Salary', amount: 200 }, { category: 'Bonus', amount: 50 }] })] });
        expect(computeSpendingByCategory(deposit, 2026, 5)).toEqual([]);
        const parts = expandManualSplits(getLedgerTransactionsForMonth(deposit, 2026, 5).find(t => t.type === 'manual'));
        expect(parts.map(p => p.category)).toEqual(['Salary', 'Bonus']);
        expect(computeMonthCashFlowTotals(deposit, 2026, 5).income).toBe(250);
    });
});

describe('Ledger search and filter see split categories and memos', () => {
    const tx = { name: 'Receipt', category: 'Groceries', type: 'manual', sourceId: 700, splits: receipt.splits };
    test('search matches any split category', () => {
        const memos = buildLedgerMemoLookup(baseApp({ manualTransactions: [record(receipt)] }));
        expect(matchesLedgerSearch(tx, 'household', memos)).toBe(true);
        expect(matchesLedgerSearch(tx, 'gifts', memos)).toBe(true);
        expect(matchesLedgerSearch(tx, 'dining', memos)).toBe(false);
    });

    test('search matches a split memo', () => {
        const memos = buildLedgerMemoLookup(baseApp({ manualTransactions: [record(receipt)] }));
        expect(matchesLedgerSearch(tx, 'for sam', memos)).toBe(true);
    });
});
