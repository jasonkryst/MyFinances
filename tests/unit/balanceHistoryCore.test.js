const {
    HISTORY_TRACKED_ACCOUNT_TYPES,
    isHistoryTrackedAccount,
    ownerOfEntry,
    entryBelongsTo,
    sortHistory,
    buildHistoryEntry,
    upsertHistoryEntry,
    seedHistoryForDebt,
    seedHistoryForAccount,
    remapHistoryOwners,
    excludeExistingHistory,
    computeHistoryDeltas
} = require('../../src/balanceHistoryCore.js');

const DEBT = { kind: 'debt', id: 1 };
const ACCT = { kind: 'account', id: 7 };

describe('isHistoryTrackedAccount', () => {
    test('true only for Credit Card and Loan', () => {
        expect(HISTORY_TRACKED_ACCOUNT_TYPES).toEqual(['Credit Card', 'Loan']);
        expect(isHistoryTrackedAccount({ type: 'Credit Card' })).toBe(true);
        expect(isHistoryTrackedAccount({ type: 'Loan' })).toBe(true);
        expect(isHistoryTrackedAccount({ type: 'Checking' })).toBe(false);
        expect(isHistoryTrackedAccount(null)).toBe(false);
    });
});

describe('ownerOfEntry / entryBelongsTo', () => {
    test('debt entry', () => {
        const e = { debtId: 1, accountId: null };
        expect(ownerOfEntry(e)).toEqual(DEBT);
        expect(entryBelongsTo(e, DEBT)).toBe(true);
        expect(entryBelongsTo(e, { kind: 'account', id: 1 })).toBe(false);
    });
    test('account entry', () => {
        const e = { debtId: null, accountId: 7 };
        expect(ownerOfEntry(e)).toEqual(ACCT);
        expect(entryBelongsTo(e, ACCT)).toBe(true);
        expect(entryBelongsTo(e, { kind: 'debt', id: 7 })).toBe(false);
    });
});

describe('sortHistory', () => {
    test('ascending by date then id, does not mutate input', () => {
        const input = [
            { id: 3, date: '2026-03-01' },
            { id: 2, date: '2026-01-01' },
            { id: 1, date: '2026-03-01' }
        ];
        const out = sortHistory(input);
        expect(out.map(e => e.id)).toEqual([2, 1, 3]);
        expect(input[0].id).toBe(3);
    });
});

describe('buildHistoryEntry', () => {
    test('interest-bearing debt uses accountBalance + minimumPayment', () => {
        const debt = { debtType: 'creditCard', accountBalance: 1200, minimumPayment: 35 };
        expect(buildHistoryEntry(DEBT, debt, '2026-09-28')).toEqual({
            debtId: 1, accountId: null, date: '2026-09-28', balance: 1200, minimumPayment: 35
        });
    });
    test('fixed amount debt has null balance and fixedAmount as minimumPayment', () => {
        const debt = { debtType: 'fixedAmount', fixedAmount: 800, minimumPayment: 1 };
        expect(buildHistoryEntry(DEBT, debt, '2026-09-28')).toEqual({
            debtId: 1, accountId: null, date: '2026-09-28', balance: null, minimumPayment: 800
        });
    });
    test('account uses startingBalance as-is (negative allowed) + minimumPayment', () => {
        const acct = { type: 'Credit Card', startingBalance: -450.5, minimumPayment: 25 };
        expect(buildHistoryEntry(ACCT, acct, '2026-09-28')).toEqual({
            debtId: null, accountId: 7, date: '2026-09-28', balance: -450.5, minimumPayment: 25
        });
    });
    test('missing numbers default to 0', () => {
        expect(buildHistoryEntry(ACCT, { type: 'Loan' }, '2026-09-28').minimumPayment).toBe(0);
        expect(buildHistoryEntry(DEBT, { debtType: 'creditCard' }, '2026-09-28').balance).toBe(0);
    });
});

describe('upsertHistoryEntry', () => {
    const base = [{ id: 10, debtId: 1, accountId: null, date: '2026-09-01', balance: 500, minimumPayment: 25 }];

    test('insert when no entry exists for owner', () => {
        const entry = { debtId: 2, accountId: null, date: '2026-09-28', balance: 100, minimumPayment: 10 };
        const r = upsertHistoryEntry(base, entry, 99);
        expect(r.action).toBe('insert');
        expect(r.target).toEqual({ id: 99, ...entry });
        expect(r.entries).toHaveLength(2);
        expect(base).toHaveLength(1);
    });

    test('none when latest entry has identical values', () => {
        const entry = { debtId: 1, accountId: null, date: '2026-09-28', balance: 500, minimumPayment: 25 };
        const r = upsertHistoryEntry(base, entry, 99);
        expect(r.action).toBe('none');
        expect(r.entries).toBe(base);
        expect(r.target.id).toBe(10);
    });

    test('insert on a new date when values changed', () => {
        const entry = { debtId: 1, accountId: null, date: '2026-09-28', balance: 450, minimumPayment: 25 };
        const r = upsertHistoryEntry(base, entry, 99);
        expect(r.action).toBe('insert');
        expect(r.entries).toHaveLength(2);
    });

    test('update when an entry already exists for the same owner and date', () => {
        const entry = { debtId: 1, accountId: null, date: '2026-09-01', balance: 400, minimumPayment: 20 };
        const r = upsertHistoryEntry(base, entry, 99);
        expect(r.action).toBe('update');
        expect(r.target).toEqual({ ...base[0], balance: 400, minimumPayment: 20 });
        expect(r.entries).toHaveLength(1);
        expect(base[0].balance).toBe(500);
    });

    test('same-day revert updates the same-day entry even though an older entry matches', () => {
        const history = [
            { id: 1, debtId: 1, accountId: null, date: '2026-09-01', balance: 500, minimumPayment: 25 },
            { id: 2, debtId: 1, accountId: null, date: '2026-09-28', balance: 400, minimumPayment: 25 }
        ];
        const entry = { debtId: 1, accountId: null, date: '2026-09-28', balance: 500, minimumPayment: 25 };
        const r = upsertHistoryEntry(history, entry, 99);
        expect(r.action).toBe('update');
        expect(r.target.id).toBe(2);
        expect(r.target.balance).toBe(500);
    });

    test('none when same-day entry already has identical values', () => {
        const entry = { debtId: 1, accountId: null, date: '2026-09-01', balance: 500, minimumPayment: 25 };
        expect(upsertHistoryEntry(base, entry, 99).action).toBe('none');
    });

    test('account and debt with the same numeric id do not collide', () => {
        const entry = { debtId: null, accountId: 1, date: '2026-09-01', balance: 500, minimumPayment: 25 };
        expect(upsertHistoryEntry(base, entry, 99).action).toBe('insert');
    });
});

describe('seedHistoryForDebt', () => {
    test('credit card with earlier start date and changed values seeds original + current', () => {
        const debt = {
            id: 1, debtType: 'creditCard', accountBalance: 800, minimumPayment: 30,
            originalBalance: 1000, originalMinimumPayment: 40,
            debtStartDate: '2026-01-15', updatedAt: '2026-09-01'
        };
        expect(seedHistoryForDebt(debt, '2026-09-28')).toEqual([
            { debtId: 1, accountId: null, date: '2026-01-15', balance: 1000, minimumPayment: 40 },
            { debtId: 1, accountId: null, date: '2026-09-01', balance: 800, minimumPayment: 30 }
        ]);
    });

    test('no start date seeds only current, dated today when updatedAt missing', () => {
        const debt = { id: 1, debtType: 'creditCard', accountBalance: 800, minimumPayment: 30, originalBalance: 1000 };
        expect(seedHistoryForDebt(debt, '2026-09-28')).toEqual([
            { debtId: 1, accountId: null, date: '2026-09-28', balance: 800, minimumPayment: 30 }
        ]);
    });

    test('unchanged original values seed only current', () => {
        const debt = {
            id: 1, debtType: 'creditCard', accountBalance: 800, minimumPayment: 30,
            originalBalance: 800, originalMinimumPayment: 30, debtStartDate: '2026-01-15', updatedAt: '2026-09-01'
        };
        expect(seedHistoryForDebt(debt, '2026-09-28')).toHaveLength(1);
    });

    test('start date not earlier than current date seeds only current', () => {
        const debt = {
            id: 1, debtType: 'creditCard', accountBalance: 800, minimumPayment: 30,
            originalBalance: 1000, originalMinimumPayment: 40, debtStartDate: '2026-09-01', updatedAt: '2026-09-01'
        };
        expect(seedHistoryForDebt(debt, '2026-09-28')).toHaveLength(1);
    });

    test('missing original fields fall back to current values', () => {
        const debt = { id: 1, debtType: 'creditCard', accountBalance: 800, minimumPayment: 30, debtStartDate: '2026-01-15', updatedAt: '2026-09-01' };
        expect(seedHistoryForDebt(debt, '2026-09-28')).toHaveLength(1);
    });

    test('fixed amount seeds only current', () => {
        const debt = { id: 1, debtType: 'fixedAmount', fixedAmount: 800, debtStartDate: '2026-01-15', updatedAt: '2026-09-01' };
        expect(seedHistoryForDebt(debt, '2026-09-28')).toEqual([
            { debtId: 1, accountId: null, date: '2026-09-01', balance: null, minimumPayment: 800 }
        ]);
    });
});

describe('seedHistoryForAccount', () => {
    test('one current entry dated today', () => {
        expect(seedHistoryForAccount({ id: 7, type: 'Loan', startingBalance: -9000, minimumPayment: 210 }, '2026-09-28')).toEqual([
            { debtId: null, accountId: 7, date: '2026-09-28', balance: -9000, minimumPayment: 210 }
        ]);
    });
});

describe('remapHistoryOwners', () => {
    test('maps both owner kinds and drops unmapped entries', () => {
        const entries = [
            { id: 1, debtId: 100, accountId: null, date: '2026-01-01', balance: 1, minimumPayment: 1 },
            { id: 2, debtId: null, accountId: 200, date: '2026-01-01', balance: 2, minimumPayment: 2 },
            { id: 3, debtId: 999, accountId: null, date: '2026-01-01', balance: 3, minimumPayment: 3 },
            { id: 4, debtId: null, accountId: 998, date: '2026-01-01', balance: 4, minimumPayment: 4 }
        ];
        const out = remapHistoryOwners(entries, new Map([[100, 1100]]), new Map([[200, 1200]]));
        expect(out).toEqual([
            { id: 1, debtId: 1100, accountId: null, date: '2026-01-01', balance: 1, minimumPayment: 1 },
            { id: 2, debtId: null, accountId: 1200, date: '2026-01-01', balance: 2, minimumPayment: 2 }
        ]);
        expect(entries[0].debtId).toBe(100);
    });
});

describe('excludeExistingHistory', () => {
    test('drops incoming entries whose owner+date already exist', () => {
        const existing = [{ id: 1, debtId: 5, accountId: null, date: '2026-01-01' }];
        const incoming = [
            { debtId: 5, accountId: null, date: '2026-01-01' },
            { debtId: 5, accountId: null, date: '2026-02-01' },
            { debtId: null, accountId: 5, date: '2026-01-01' }
        ];
        expect(excludeExistingHistory(existing, incoming)).toEqual([incoming[1], incoming[2]]);
    });
});

describe('computeHistoryDeltas', () => {
    test('first entry has null deltas; later entries are rounded differences', () => {
        const out = computeHistoryDeltas([
            { date: '2026-01-01', balance: 100.1, minimumPayment: 10 },
            { date: '2026-02-01', balance: 100, minimumPayment: 12.5 }
        ]);
        expect(out[0].balanceDelta).toBeNull();
        expect(out[0].minimumPaymentDelta).toBeNull();
        expect(out[1].balanceDelta).toBe(-0.1);
        expect(out[1].minimumPaymentDelta).toBe(2.5);
    });
    test('null balances produce null balanceDelta', () => {
        const out = computeHistoryDeltas([
            { date: '2026-01-01', balance: null, minimumPayment: 800 },
            { date: '2026-02-01', balance: null, minimumPayment: 850 }
        ]);
        expect(out[1].balanceDelta).toBeNull();
        expect(out[1].minimumPaymentDelta).toBe(50);
    });
});
