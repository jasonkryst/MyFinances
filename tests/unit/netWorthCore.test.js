// #579: the pure projection + snapshot core shared by the browser and the
// server's monthly net-worth snapshot job.
const { getOverrideAmount, getEffectiveAmount, isCleared, getClearedAt } = require('../../src/ledgerStateCore.js');
const { makeLedgerTransactionId, getLedgerTransactionsForMonth, computeAccountBalance } = require('../../src/projectionCore.js');
const { computeSnapshotMetrics, buildNetWorthSnapshot, snapshotMonthKey, hasSnapshotInMonth } = require('../../src/netWorthCore.js');
const ledgerTransactions = require('../../src/ledgerTransactions.js');
const ledgerOverrides = require('../../src/ledgerOverrides.js');
const ledgerCleared = require('../../src/ledgerCleared.js');
const accounts = require('../../src/accounts.js');

const NOV = [2026, 10];
const NOW = new Date(2026, 10, 15, 12);

function baseApp(extra = {}) {
    return {
        accounts: [{ id: 1, name: 'Checking', startingBalance: 1000, interestRate: 0 }],
        incomes: [{ id: 7, name: 'Pay', amount: 2000, frequency: 'monthly', firstPayDate: '2026-01-05', accountId: 1 }],
        debts: [{ id: 3, name: 'Card', accountBalance: 500, minimumPayment: 50, dueDate: 10, accountId: 1 }],
        recurringTemplates: [{ id: 4, name: 'Gym', type: 'subscription', amount: 15, frequency: 'monthly', dayOfMonth: 3, accountId: 1 }],
        ...extra,
    };
}

describe('ledgerStateCore', () => {
    const app = {
        ledgerAmountOverrides: { k1: { amount: 12.5 }, bad: { amount: 'x' }, zero: { amount: 0 } },
        ledgerClearedTransactions: { k1: { clearedAt: '2026-11-01T00:00:00.000Z' }, k2: {} },
    };

    test('override lookups', () => {
        expect(getOverrideAmount(app, 'k1')).toBe(12.5);
        expect(getOverrideAmount(app, 'zero')).toBe(0);
        expect(getOverrideAmount(app, 'bad')).toBeNull();
        expect(getOverrideAmount(app, 'missing')).toBeNull();
        expect(getOverrideAmount(app, null)).toBeNull();
        expect(getOverrideAmount({}, 'k1')).toBeNull();
    });

    test('effective amount prefers a valid override, including $0', () => {
        expect(getEffectiveAmount(app, { transactionId: 'k1', originalAmount: 99 })).toBe(12.5);
        expect(getEffectiveAmount(app, { transactionId: 'zero', originalAmount: 99 })).toBe(0);
        expect(getEffectiveAmount(app, { transactionId: 'bad', originalAmount: 99 })).toBe(99);
        expect(getEffectiveAmount(app, { transactionId: null, originalAmount: 99 })).toBe(99);
    });

    test('cleared lookups', () => {
        expect(isCleared(app, 'k1')).toBe(true);
        expect(isCleared(app, 'k2')).toBe(true);
        expect(isCleared(app, 'nope')).toBe(false);
        expect(isCleared(app, '')).toBe(false);
        expect(isCleared({}, 'k1')).toBe(false);
        expect(getClearedAt(app, 'k1')).toBe('2026-11-01T00:00:00.000Z');
        expect(getClearedAt(app, 'k2')).toBeNull();
        expect(getClearedAt(app, null)).toBeNull();
        expect(getClearedAt({}, 'k1')).toBeNull();
    });

    test('the old module paths re-export the same functions', () => {
        expect(ledgerOverrides.getEffectiveAmount).toBe(getEffectiveAmount);
        expect(ledgerOverrides.getOverrideAmount).toBe(getOverrideAmount);
        expect(ledgerCleared.isCleared).toBe(isCleared);
        expect(ledgerCleared.getClearedAt).toBe(getClearedAt);
    });
});

describe('projectionCore', () => {
    test('the old module paths re-export the same functions', () => {
        expect(ledgerTransactions.getLedgerTransactionsForMonth).toBe(getLedgerTransactionsForMonth);
        expect(ledgerTransactions.makeLedgerTransactionId).toBe(makeLedgerTransactionId);
        expect(accounts.computeAccountBalance).toBe(computeAccountBalance);
    });

    test('transaction ids are type|source|account|local date', () => {
        expect(makeLedgerTransactionId({ type: 'income', sourceId: 7, accountId: 1, date: new Date(2026, 10, 5, 12) }))
            .toBe('income|7|1|2026-11-05');
        expect(makeLedgerTransactionId({ date: new Date(2026, 0, 1) })).toBe('other|none||2026-01-01');
    });

    test('a month lists every source, date-sorted, with overrides applied', () => {
        const app = baseApp({ ledgerAmountOverrides: { 'income|7|1|2026-11-05': { amount: 1900 } } });
        const txs = getLedgerTransactionsForMonth(app, ...NOV);
        expect(txs.map(t => [t.type, t.amount])).toEqual([
            ['recurring', -15], ['income', 1900], ['debt', -50],
        ]);
        const pay = txs.find(t => t.type === 'income');
        expect(pay.hasOverride).toBe(true);
        expect(pay.originalAmount).toBe(2000);
        expect(pay.overrideAmount).toBe(1900);
    });

    test('an account filter excludes other accounts and unlinked items', () => {
        const app = baseApp({ incomes: [{ id: 8, name: 'Loose', amount: 10, frequency: 'monthly', firstPayDate: '2026-01-02' }] });
        expect(getLedgerTransactionsForMonth(app, ...NOV, 1).map(t => t.type)).toEqual(['recurring', 'debt']);
        expect(getLedgerTransactionsForMonth(app, ...NOV).map(t => t.accountId)).toContain(null);
        expect(getLedgerTransactionsForMonth(app, ...NOV, 2)).toEqual([]);
    });

    test('computeAccountBalance = starting balance + the month\'s effective amounts', () => {
        expect(computeAccountBalance(baseApp(), 1, ...NOV)).toBe(2935);
        expect(computeAccountBalance(baseApp(), 99, ...NOV)).toBe(0);
        const archived = baseApp({ debts: [{ id: 3, name: 'Card', accountBalance: 500, minimumPayment: 50, dueDate: 10, accountId: 1, archived: true }] });
        expect(computeAccountBalance(archived, 1, ...NOV)).toBe(2985);
    });
});

describe('netWorthCore', () => {
    test('snapshot metrics: positive balances are assets, debts are liabilities', () => {
        const app = baseApp({
            accounts: [
                { id: 1, name: 'Checking', startingBalance: 1000, interestRate: 0 },
                { id: 2, name: 'Overdrawn', startingBalance: -300, interestRate: 0 },
            ],
            debts: [
                { id: 3, name: 'Card', accountBalance: 500, minimumPayment: 50, dueDate: 10, accountId: 1 },
                { id: 5, name: 'Fixed', debtType: 'fixedAmount', fixedAmount: 250, accountBalance: 9999 },
                { id: 6, name: 'Paid', accountBalance: -20 },
            ],
        });
        expect(computeSnapshotMetrics(app, NOW)).toEqual({
            totalAssets: 2935, totalLiabilities: 750, netWorth: 2185, debtPaymentMade: 50, incomeReceived: 2000,
        });
    });

    test('transfer legs are not income; recurring inflows, manual inflows and interest are', () => {
        const app = baseApp({
            accounts: [
                { id: 1, name: 'Checking', startingBalance: 1000, interestRate: 0 },
                { id: 2, name: 'Savings', startingBalance: 1200, interestRate: 12 },
            ],
            recurringTemplates: [
                { id: 4, name: 'Sweep', type: 'transfer', amount: 200, dayOfMonth: 2, accountId: 1, targetAccountId: 2 },
                { id: 5, name: 'Gig', type: 'income', amount: 300, dayOfMonth: 9, accountId: 1 },
            ],
            transfers: [{ id: 9, fromAccountId: 2, toAccountId: 1, amount: 100, date: '2026-11-11' }],
            manualTransactions: [
                { id: 1, accountId: 1, date: '2026-11-04', amount: 80, name: 'Refund' },
                { id: 2, accountId: 1, date: '2026-11-05', amount: -30, name: 'Food' },
            ],
        });
        const m = computeSnapshotMetrics(app, NOW);
        // Savings: 1200 + 200 - 100 = 1300, + 1% interest = 13.
        expect(m.incomeReceived).toBe(2000 + 300 + 80 + 13);
        expect(m.totalAssets).toBe((1000 + 2000 - 50 - 200 + 300 + 100 + 80 - 30) + 1313);
    });

    test('an empty dataset is all zeros', () => {
        expect(computeSnapshotMetrics({}, NOW)).toEqual({
            totalAssets: 0, totalLiabilities: 0, netWorth: 0, debtPaymentMade: 0, incomeReceived: 0,
        });
    });

    test('buildNetWorthSnapshot adds the date and source', () => {
        const snap = buildNetWorthSnapshot(baseApp(), NOW);
        expect(snap).toEqual({ date: NOW.toISOString().slice(0, 10), ...computeSnapshotMetrics(baseApp(), NOW), source: 'auto' });
        expect(buildNetWorthSnapshot(baseApp(), NOW, 'manual').source).toBe('manual');
        expect(buildNetWorthSnapshot(baseApp(), NOW, 'anything').source).toBe('auto');
    });

    test('month keys and the one-per-month rule', () => {
        expect(snapshotMonthKey(new Date(2026, 0, 31))).toBe('2026-01');
        expect(hasSnapshotInMonth([{ date: '2026-11-01' }], NOW)).toBe(true);
        expect(hasSnapshotInMonth([{ date: '2026-10-31' }, { date: '2025-11-15' }], NOW)).toBe(false);
        expect(hasSnapshotInMonth([], NOW)).toBe(false);
        expect(hasSnapshotInMonth(null, NOW)).toBe(false);
        expect(hasSnapshotInMonth([null, {}], NOW)).toBe(false);
    });
});
