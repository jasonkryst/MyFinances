// Issue #584: manual one-off transactions -- record shape, import rules,
// Ledger generation and how each report classifies them.
import { sanitizeManualTransaction, isValidManualTransaction, sanitizeParsedState } from '../../src/sanitizers.js';
import { getLedgerTransactionsForMonth, makeLedgerTransactionId } from '../../src/ledgerTransactions.js';
import { computeAccountBalance } from '../../src/accounts.js';
import { spendingCategoryForTx } from '../../src/spending.js';
import { computeDerivedBudgetByCategory } from '../../src/categoryBudgets.js';
import { computeMonthCashFlowTotals } from '../../src/reportsCashFlow.js';
import { computeReportsSummaryMetrics } from '../../src/reportsSummary.js';

function baseApp(extra = {}) {
    return {
        accounts: [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }],
        incomes: [], bonuses: [], debts: [], bills: [], expenses: [], transfers: [],
        recurringTemplates: [], emergencyFunds: [], sinkingFunds: [], reconciliations: [],
        manualTransactions: [], ledgerAmountOverrides: {}, ledgerClearedTransactions: {}, settings: {},
        computeAccountBalance(id, y, m) { return computeAccountBalance(this, id, y, m); },
        ...extra
    };
}

const coffee = { id: 501, accountId: 1, date: '2026-06-10', amount: -4.5, name: 'Coffee', category: 'Dining', memo: '' };
const refund = { id: 502, accountId: 1, date: '2026-06-12', amount: 30, name: 'Refund', category: 'Shopping', memo: '' };

describe('sanitizeManualTransaction', () => {
    test('keeps a valid record, signed amount and all fields', () => {
        const out = sanitizeManualTransaction({ ...coffee, memo: 'with Sam', createdAt: '2026-06-10T10:00:00.000Z' }, 9);
        expect(out).toEqual({
            id: 501, accountId: 1, date: '2026-06-10', amount: -4.5, name: 'Coffee',
            category: 'Dining', memo: 'with Sam', createdAt: '2026-06-10T10:00:00.000Z'
        });
        expect(isValidManualTransaction(out)).toBe(true);
    });

    test('defaults: id fallback, Other category, today for a bad date, NaN for a bad amount', () => {
        const out = sanitizeManualTransaction({ accountId: '3', name: 'X', amount: 'abc', date: 'nope' }, 77);
        expect(out.id).toBe(77);
        expect(out.accountId).toBe(3);
        expect(out.category).toBe('Other');
        expect(out.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isNaN(out.amount)).toBe(true);
    });

    test('caps text lengths and strips markup characters the shared sanitizers remove', () => {
        const out = sanitizeManualTransaction({ ...coffee, name: 'n'.repeat(300), category: 'c'.repeat(90), memo: 'm'.repeat(500) }, 1);
        expect(out.name.length).toBe(100);
        expect(out.category.length).toBe(40);
        expect(out.memo.length).toBe(200);
    });

    test.each([
        ['no account', { accountId: null }],
        ['no name', { name: '   ' }],
        ['a zero amount', { amount: 0 }],
        ['a non-numeric amount', { amount: 'abc' }],
        ['an amount over 1e9', { amount: -2e9 }],
    ])('rejects %s', (_, change) => {
        expect(isValidManualTransaction(sanitizeManualTransaction({ ...coffee, ...change }, 1))).toBe(false);
    });

    test('rejects null', () => {
        expect(isValidManualTransaction(null)).toBe(false);
    });

    test('a null or undefined record yields an invalid shape instead of throwing', () => {
        for (const raw of [null, undefined]) {
            const out = sanitizeManualTransaction(raw, 5);
            expect(out.id).toBe(5);
            expect(out.accountId).toBeNull();
            expect(out.name).toBe('');
            expect(out.memo).toBe('');
            expect(out.category).toBe('Other');
            expect(Number.isNaN(out.amount)).toBe(true);
            expect(out.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(Number.isNaN(new Date(out.createdAt).getTime())).toBe(false);
            expect(isValidManualTransaction(out)).toBe(false);
        }
    });

    test.each([
        ['an invalid date string', 'not a date'],
        ['a number', 1767225600000],
        ['an empty string', ''],
    ])('createdAt that is %s is replaced with now', (_, createdAt) => {
        const before = Date.now();
        const out = sanitizeManualTransaction({ ...coffee, createdAt }, 1);
        expect(typeof out.createdAt).toBe('string');
        expect(new Date(out.createdAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    });

    test('amount boundaries: 1e9 and a cent are valid, either sign', () => {
        for (const amount of [1e9, -1e9, 0.01, -0.01]) {
            expect(isValidManualTransaction(sanitizeManualTransaction({ ...coffee, amount }, 1))).toBe(true);
        }
        expect(isValidManualTransaction(sanitizeManualTransaction({ ...coffee, amount: 1e9 + 1 }, 1))).toBe(false);
    });

    test('each required part alone makes it invalid', () => {
        const ok = sanitizeManualTransaction(coffee, 1);
        expect(isValidManualTransaction({ ...ok, accountId: null })).toBe(false);
        expect(isValidManualTransaction({ ...ok, name: '' })).toBe(false);
        expect(isValidManualTransaction({ ...ok, amount: NaN })).toBe(false);
        expect(isValidManualTransaction({ ...ok, amount: Infinity })).toBe(false);
        expect(isValidManualTransaction({ ...ok, amount: 0 })).toBe(false);
        expect(isValidManualTransaction({ ...ok, accountId: 0 })).toBe(true);
    });
});

describe('import (sanitizeParsedState)', () => {
    test('keeps valid records, rejects invalid ones and orphans, with warnings', () => {
        const warnings = [];
        const state = sanitizeParsedState({
            accounts: [{ id: 1, name: 'Checking', type: 'Checking' }],
            manualTransactions: [coffee, { ...refund, amount: 0 }, { ...refund, id: 503, accountId: 99 }]
        }, warnings);
        expect(state.manualTransactions.map(m => m.id)).toEqual([501]);
        const rejected = warnings.filter(w => w.recordType === 'Transaction' && w.kind === 'rejected');
        expect(rejected).toHaveLength(2);
        expect(rejected.some(w => /no longer exists/.test(w.reason))).toBe(true);
    });

    test('a file without the collection imports as an empty list', () => {
        expect(sanitizeParsedState({ accounts: [] }).manualTransactions).toEqual([]);
    });
});

describe('Ledger generation', () => {
    test('one signed manual leg on its own date, keyed like every other source', () => {
        const app = baseApp({ manualTransactions: [coffee, refund] });
        const txs = getLedgerTransactionsForMonth(app, 2026, 5, 1);
        expect(txs.map(x => [x.type, x.amount, x.category, x.name])).toEqual([
            ['manual', -4.5, 'Dining', 'Coffee'],
            ['manual', 30, 'Shopping', 'Refund'],
        ]);
        expect(txs[0].transactionId).toBe('manual|501|1|2026-06-10');
        expect(txs[0].transactionId).toBe(makeLedgerTransactionId({ accountId: 1, date: new Date('2026-06-10T00:00:00'), type: 'manual', sourceId: 501 }));
    });

    test('only in its own month', () => {
        const app = baseApp({ manualTransactions: [coffee] });
        expect(getLedgerTransactionsForMonth(app, 2026, 4, 1)).toEqual([]);
        expect(getLedgerTransactionsForMonth(app, 2026, 6, 1)).toEqual([]);
    });

    test('moves the account balance for that month', () => {
        const app = baseApp({ manualTransactions: [coffee, refund] });
        expect(computeAccountBalance(app, 1, 2026, 5)).toBeCloseTo(1000 - 4.5 + 30, 2);
        expect(computeAccountBalance(app, 1, 2026, 6)).toBe(1000);
    });

    test('Cleared state is read like any other row', () => {
        const app = baseApp({ manualTransactions: [coffee] });
        app.ledgerClearedTransactions['manual|501|1|2026-06-10'] = { clearedAt: '2026-06-10T12:00:00Z' };
        expect(getLedgerTransactionsForMonth(app, 2026, 5, 1)[0].cleared).toBe(true);
    });
});

describe('report classification', () => {
    test('Spending: an outflow counts in its category, an inflow does not', () => {
        expect(spendingCategoryForTx({ type: 'manual', amount: -4.5, category: 'Dining' })).toBe('Dining');
        expect(spendingCategoryForTx({ type: 'manual', amount: -4.5, category: '' })).toBe('Other');
        expect(spendingCategoryForTx({ type: 'manual', amount: 30, category: 'Shopping' })).toBeNull();
    });

    test('derived budgets ignore manual transactions (actuals only)', () => {
        const app = baseApp({
            manualTransactions: [coffee],
            expenses: [{ id: 7, name: 'Eating out', budgetAmount: 100, date: '2026-06-01', category: 'Dining', accountId: 1 }]
        });
        expect(computeDerivedBudgetByCategory(app, 2026, 5).get('Dining')).toBe(100);
    });

    test('Cash Flow totals: inflow is income, outflow is an expense', () => {
        const app = baseApp({ manualTransactions: [coffee, refund] });
        const totals = computeMonthCashFlowTotals(app, 2026, 5);
        expect(totals.income).toBeCloseTo(30, 2);
        expect(totals.expenses).toBeCloseTo(4.5, 2);
        expect(totals.net).toBeCloseTo(25.5, 2);
    });

    test('Summary metrics classify the same way', () => {
        const app = baseApp({ manualTransactions: [coffee, refund] });
        const metrics = computeReportsSummaryMetrics(app, 'month', new Date(2026, 5, 15));
        expect(metrics.cashFlow.income).toBeCloseTo(30, 2);
        expect(metrics.cashFlow.expenses).toBeCloseTo(4.5, 2);
    });
});
