// Issue #616: the Forecast total view leaves transfers between two of the
// user's own asset accounts out of Income and Outflow (net is unchanged);
// a transfer to a liability account is still a real outflow, and a
// single-account view still counts every transfer.
import { computeForecastSeries, isInternalTransferLeg } from '../../src/forecast.js';
import { getLedgerTransactionsForMonth } from '../../src/ledgerTransactions.js';

const ASSETS = new Set(['chk', 'sav']);

describe('isInternalTransferLeg', () => {
    const leg = (extra) => ({ type: 'transfer', accountId: 'chk', counterpartAccountId: 'sav', amount: -100, ...extra });

    test('a one-off transfer between two asset accounts is internal', () => {
        expect(isInternalTransferLeg(leg(), ASSETS)).toBe(true);
        expect(isInternalTransferLeg(leg({ accountId: 'sav', counterpartAccountId: 'chk', amount: 100 }), ASSETS)).toBe(true);
    });

    test('a recurring transfer-template leg between two asset accounts is internal', () => {
        expect(isInternalTransferLeg(leg({ type: 'recurring', isTransferLeg: true }), ASSETS)).toBe(true);
    });

    test('ids compare as strings', () => {
        expect(isInternalTransferLeg(leg({ accountId: 1, counterpartAccountId: 2 }), new Set(['1', '2']))).toBe(true);
    });

    test('a transfer to a liability (non-asset) account is not internal', () => {
        expect(isInternalTransferLeg(leg({ counterpartAccountId: 'card' }), ASSETS)).toBe(false);
        expect(isInternalTransferLeg(leg({ accountId: 'card', counterpartAccountId: 'chk' }), ASSETS)).toBe(false);
    });

    test('non-transfer legs are never internal', () => {
        expect(isInternalTransferLeg(leg({ type: 'recurring' }), ASSETS)).toBe(false); // subscription leg
        expect(isInternalTransferLeg(leg({ type: 'manual' }), ASSETS)).toBe(false);
        expect(isInternalTransferLeg(leg({ type: 'income' }), ASSETS)).toBe(false);
    });

    test('a missing counterpart, the same account on both sides, or no tx is not internal', () => {
        expect(isInternalTransferLeg(leg({ counterpartAccountId: null }), ASSETS)).toBe(false);
        expect(isInternalTransferLeg(leg({ counterpartAccountId: undefined }), ASSETS)).toBe(false);
        expect(isInternalTransferLeg(leg({ counterpartAccountId: 'chk' }), ASSETS)).toBe(false);
        expect(isInternalTransferLeg(null, ASSETS)).toBe(false);
    });
});

describe('computeForecastSeries with transfers (#616)', () => {
    const now = new Date();
    const inMonths = (n, day) => {
        const d = new Date(now.getFullYear(), now.getMonth() + n, day);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const ONE_OFF_DATE = inMonths(1, 15);

    function app() {
        return {
            accounts: [
                { id: 'chk', name: 'Checking', type: 'Checking', startingBalance: 5000, interestRate: 0 },
                { id: 'sav', name: 'Savings', type: 'Savings', startingBalance: 1000, interestRate: 0 },
                { id: 'card', name: 'Visa', type: 'Credit Card', startingBalance: 0, interestRate: 0 }
            ],
            incomes: [{ id: 'pay', name: 'Salary', amount: 3000, frequency: 'monthly', firstPayDate: inMonths(-1, 1), accountId: 'chk' }],
            recurringTemplates: [
                { id: 'sweep', name: 'Auto save', type: 'transfer', amount: 300, frequency: 'monthly', dayOfMonth: 10, accountId: 'chk', targetAccountId: 'sav' },
                { id: 'visa', name: 'Pay Visa', type: 'transfer', amount: 100, frequency: 'monthly', dayOfMonth: 12, accountId: 'chk', targetAccountId: 'card' },
                { id: 'gym', name: 'Gym', type: 'subscription', amount: 40, frequency: 'monthly', dayOfMonth: 5, accountId: 'chk' }
            ],
            transfers: [{ id: 'x1', fromAccountId: 'chk', toAccountId: 'sav', amount: 900, date: ONE_OFF_DATE, memo: '' }],
            debts: [], bonuses: [], bills: [], expenses: [], manualTransactions: [],
            emergencyFunds: [], sinkingFunds: [], reconciliations: [],
            ledgerAmountOverrides: {}, ledgerClearedTransactions: {}, settings: []
        };
    }

    test('transfer legs carry their counterpart account; other legs carry none', () => {
        const a = app();
        const txs = getLedgerTransactionsForMonth(a, now.getFullYear() + Math.floor((now.getMonth() + 1) / 12), (now.getMonth() + 1) % 12);
        const sweepOut = txs.find(t => t.sourceId === 'sweep' && t.amount < 0);
        const sweepIn = txs.find(t => t.sourceId === 'sweep' && t.amount > 0);
        const oneOffOut = txs.find(t => t.sourceId === 'x1' && t.amount < 0);
        const gym = txs.find(t => t.sourceId === 'gym');
        expect(sweepOut.counterpartAccountId).toBe('sav');
        expect(sweepIn.counterpartAccountId).toBe('chk');
        expect(oneOffOut.counterpartAccountId).toBe('sav');
        expect(gym.counterpartAccountId ?? null).toBeNull();
    });

    test('total view: internal transfers leave Income/Outflow, the card transfer stays, net is unchanged', () => {
        const a = app();
        const months = 3;
        const total = computeForecastSeries(a, 'total', months);
        const chk = computeForecastSeries(a, 'chk', months);
        const sav = computeForecastSeries(a, 'sav', months);
        expect(total).toHaveLength(chk.length);
        // Month 0 is the balance-only "Now" row.
        expect(total[0]).toMatchObject({ income: 0, outflow: 0, net: 0 });
        for (let i = 1; i < total.length; i++) {
            const isOneOffMonth = `${total[i].year}-${String(total[i].month + 1).padStart(2, '0')}` === ONE_OFF_DATE.slice(0, 7);
            const internal = 300 + (isOneOffMonth ? 900 : 0);
            const r = n => Math.round(n * 100) / 100;
            // Per-account views still count every transfer leg.
            expect(chk[i].outflow).toBeGreaterThanOrEqual(300 + 100 + 40 + (isOneOffMonth ? 900 : 0));
            expect(sav[i].income).toBeGreaterThanOrEqual(internal);
            // Total = sum of the asset accounts minus the internal legs on both sides.
            expect(total[i].outflow).toBeCloseTo(r(chk[i].outflow + sav[i].outflow - internal), 2);
            expect(total[i].income).toBeCloseTo(r(chk[i].income + sav[i].income - internal), 2);
            // Net and balance are untouched: the two legs cancel.
            expect(total[i].net).toBeCloseTo(r(chk[i].net + sav[i].net), 2);
            expect(total[i].balance).toBeCloseTo(r(chk[i].balance + sav[i].balance), 2);
            // The card payment and the subscription are still real outflow.
            expect(total[i].outflow).toBeGreaterThanOrEqual(140);
        }
    });

    test('negative control: with no internal transfers the total is the plain sum', () => {
        const a = app();
        a.transfers = [];
        a.recurringTemplates = a.recurringTemplates.filter(t => t.id !== 'sweep');
        const total = computeForecastSeries(a, 'total', 2);
        const chk = computeForecastSeries(a, 'chk', 2);
        const sav = computeForecastSeries(a, 'sav', 2);
        for (let i = 1; i < total.length; i++) {
            expect(total[i].outflow).toBeCloseTo(chk[i].outflow + sav[i].outflow, 2);
            expect(total[i].income).toBeCloseTo(chk[i].income + sav[i].income, 2);
        }
    });
});
