// #678: projections use the amount in effect on each occurrence's date, so an
// amount change leaves earlier months untouched.
jest.mock('../../src/postgresSync.js', () => ({
    pgPut: jest.fn(() => Promise.resolve(true)),
    pgPatch: jest.fn(() => Promise.resolve(true)),
    pgDelete: jest.fn(() => Promise.resolve(true)),
    pgPost: jest.fn(() => Promise.resolve(true)),
    pgCreate: jest.fn(() => Promise.resolve(null))
}));
jest.mock('../../src/ui.js', () => ({ showAlertModal: jest.fn(), confirmZeroAmountAllowed: jest.fn(() => Promise.resolve(true)), showDeleteConfirmModal: jest.fn() }));

const { getLedgerTransactionsForMonth } = require('../../src/projectionCore.js');
const { getRecurringOccurrencesInMonth } = require('../../src/recurringOccurrences.js');
const { computeRecurringCashFlowForMonth } = require('../../src/recurring.js');
const { computeMonthlyIncomeForMonth, computeNetIncomeAmount, dateToISO } = require('../../src/utils.js');
const { getRecurringMonthPaidStatus, markRecurringPaid } = require('../../src/recurringPaid.js');

function makeApp(extra = {}) {
    return {
        accounts: [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000, interestRate: 0 }],
        incomes: [], recurringTemplates: [], transfers: [], debts: [], bonuses: [], bills: [], expenses: [],
        manualTransactions: [], emergencyFunds: [], sinkingFunds: [], reconciliations: [],
        ledgerAmountOverrides: {}, ledgerClearedTransactions: {}, settings: [],
        renderRecurringPage: () => {},
        ...extra
    };
}

const netflix = () => ({
    id: 7, name: 'Netflix', type: 'subscription', amount: 15, frequency: 'monthly', dayOfMonth: 5,
    category: 'Subscriptions', accountId: 1, startDate: '2026-01-01',
    amountChanges: [{ from: '2027-01-01', amount: 18 }], skippedMonths: [], paidMonths: []
});

describe('recurring legs', () => {
    test('months before the change keep the old amount, later months use the new one', () => {
        const app = makeApp({ recurringTemplates: [netflix()] });
        const dec = getLedgerTransactionsForMonth(app, 2026, 11).filter(t => t.sourceId === 7);
        const jan = getLedgerTransactionsForMonth(app, 2027, 0).filter(t => t.sourceId === 7);
        expect(dec.map(t => t.amount)).toEqual([-15]);
        expect(jan.map(t => t.amount)).toEqual([-18]);
    });

    test('a weekly template whose month straddles a change sums each occurrence at its own amount', () => {
        const tmpl = {
            id: 8, name: 'Coffee club', type: 'subscription', amount: 10, frequency: 'weekly', dayOfMonth: 1,
            category: 'Food', accountId: 1, startDate: '2027-03-01',
            amountChanges: [{ from: '2027-03-15', amount: 12 }], skippedMonths: [], paidMonths: []
        };
        const app = makeApp({ recurringTemplates: [tmpl] });
        const dates = getRecurringOccurrencesInMonth(tmpl, 2027, 2).map(dateToISO);
        const before = dates.filter(d => d < '2027-03-15').length;
        const after = dates.length - before;
        expect(before).toBeGreaterThan(0);
        expect(after).toBeGreaterThan(0);
        const expected = 10 * before + 12 * after;
        const legs = getLedgerTransactionsForMonth(app, 2027, 2).filter(t => t.sourceId === 8);
        expect(legs.reduce((s, t) => s - t.amount, 0)).toBeCloseTo(expected, 6);
        expect(computeRecurringCashFlowForMonth(app, 2027, 2).outflow).toBeCloseTo(expected, 6);
    });

    test('a recurring income template uses the dated amount for inflows too', () => {
        const tmpl = { ...netflix(), id: 9, type: 'income', name: 'Side gig' };
        const app = makeApp({ recurringTemplates: [tmpl] });
        expect(getLedgerTransactionsForMonth(app, 2026, 11).find(t => t.sourceId === 9).amount).toBe(15);
        expect(getLedgerTransactionsForMonth(app, 2027, 0).find(t => t.sourceId === 9).amount).toBe(18);
        expect(computeRecurringCashFlowForMonth(app, 2027, 0).inflow).toBe(18);
    });
});

describe('income', () => {
    const salary = () => ({
        id: 3, name: 'Salary', amount: 1000, frequency: 'biweekly', firstPayDate: '2026-01-02',
        accountId: 1, withholdingPercent: 20, amountChanges: [{ from: '2027-01-01', amount: 1200 }]
    });

    test('withholding applies to the gross amount in effect on each payday', () => {
        const app = makeApp({ incomes: [salary()] });
        const dec = getLedgerTransactionsForMonth(app, 2026, 11).filter(t => t.type === 'income').map(t => t.amount);
        const jan = getLedgerTransactionsForMonth(app, 2027, 0).filter(t => t.type === 'income').map(t => t.amount);
        expect(dec.length).toBeGreaterThan(0);
        expect(new Set(dec)).toEqual(new Set([800]));
        expect(new Set(jan)).toEqual(new Set([960]));
    });

    test('computeMonthlyIncomeForMonth matches the sum of the projected legs', () => {
        const app = makeApp({ incomes: [salary()] });
        for (const [y, m] of [[2026, 11], [2027, 0]]) {
            const legs = getLedgerTransactionsForMonth(app, y, m).filter(t => t.type === 'income');
            const sum = legs.reduce((s, t) => s + t.amount, 0);
            expect(computeMonthlyIncomeForMonth(app.incomes, [], y, m).monthlyTotal).toBeCloseTo(sum, 6);
        }
    });

    test('computeNetIncomeAmount takes an optional date', () => {
        const inc = salary();
        expect(computeNetIncomeAmount(inc, '2026-12-15')).toBe(800);
        expect(computeNetIncomeAmount(inc, new Date(2027, 0, 15))).toBe(960);
    });
});

describe('recurring paid sync', () => {
    test('an occurrence after the change reports the dated amount with no override', () => {
        const app = makeApp({ recurringTemplates: [netflix()] });
        const status = getRecurringMonthPaidStatus(app, app.recurringTemplates[0], 2027, 0);
        expect(status.occurrences[0].actualAmount).toBe(18);
        expect(status.occurrences[0].hasOverride).toBe(false);
    });

    test('marking paid with the dated amount stores no override', () => {
        const app = makeApp({ recurringTemplates: [netflix()] });
        markRecurringPaid(app, 7, '2027-01', false, 18);
        expect(Object.keys(app.ledgerAmountOverrides)).toEqual([]);
        expect(Object.keys(app.ledgerClearedTransactions)).toHaveLength(1);
    });

    test('marking paid with the old base amount after the change stores an override', () => {
        const app = makeApp({ recurringTemplates: [netflix()] });
        markRecurringPaid(app, 7, '2027-01', false, 15);
        const keys = Object.keys(app.ledgerAmountOverrides);
        expect(keys).toHaveLength(1);
        expect(app.ledgerAmountOverrides[keys[0]].originalAmount).toBe(-18);
    });
});
