// Unit tests for merge-mode natural-key dedupe (issues #567, #478).
import { mergeKeyFor, planMerge } from '../../src/mergeDedupe.js';

describe('mergeKeyFor: same record matches', () => {
    test.each([
        ['debts', { name: 'Visa' }, { name: '  visa ' }],
        ['accounts', { name: 'Checking' }, { name: 'CHECKING' }],
        ['persons', { name: 'Sam' }, { name: 'sam ' }],
        ['incomes', { name: 'Job' }, { name: 'job' }],
        ['bonuses', { name: 'Q4' }, { name: 'q4' }],
        ['bills', { name: 'Rent' }, { name: 'rent' }],
        ['recurringTemplates', { name: 'Netflix' }, { name: 'NETFLIX' }],
        ['sinkingFunds', { name: 'Car' }, { name: 'car' }],
        ['expenses', { name: 'Food', date: '2026-01-05' }, { name: 'food', date: new Date(2026, 0, 5) }],
        ['emergencyFunds', { accountId: 3 }, { accountId: '3' }],
        ['transfers', { fromAccountId: 1, toAccountId: 2, amount: 50, date: '2026-02-01' },
            { fromAccountId: 1, toAccountId: 2, amount: '50.00', date: '2026-02-01' }],
        ['retirementSnapshots', { accountId: 4, date: '2026-03-01' }, { accountId: 4, date: '2026-03-01', balance: 9 }],
        ['reconciliations', { accountId: 1, statementEndDate: '2026-03-31', date: '2026-03-31' },
            { accountId: 1, statementEndDate: '2026-03-31', date: '2026-04-02' }],
        ['reconciliations', { accountId: 1, statementEndDate: null, date: '2026-03-31' },
            { accountId: 1, statementEndDate: null, date: '2026-03-31' }],
        ['planHistory', { createdAt: '2026-11-12T10:00:00.123Z' }, { createdAt: '2026-11-12 10:00:00.123456+00' }],
        ['manualTransactions', { accountId: 1, date: '2026-04-01', amount: -12.5, name: 'Coffee' },
            { accountId: 1, date: '2026-04-01', amount: '-12.50', name: ' coffee' }],
    ])('%s', (field, a, b) => {
        const ka = mergeKeyFor(field, a);
        expect(ka).not.toBeNull();
        expect(ka).toBe(mergeKeyFor(field, b));
    });
});

describe('mergeKeyFor: differing records do not match', () => {
    test.each([
        ['debts', { name: 'Visa' }, { name: 'Amex' }],
        ['expenses', { name: 'Food', date: '2026-01-05' }, { name: 'Food', date: '2026-01-06' }],
        ['emergencyFunds', { accountId: 3 }, { accountId: 4 }],
        ['transfers', { fromAccountId: 1, toAccountId: 2, amount: 50, date: '2026-02-01' },
            { fromAccountId: 1, toAccountId: 2, amount: 51, date: '2026-02-01' }],
        ['transfers', { fromAccountId: 1, toAccountId: 2, amount: 50, date: '2026-02-01' },
            { fromAccountId: 1, toAccountId: 2, amount: 50, date: '2026-02-02' }],
        ['transfers', { fromAccountId: 1, toAccountId: 2, amount: 50, date: '2026-02-01' },
            { fromAccountId: 2, toAccountId: 1, amount: 50, date: '2026-02-01' }],
        ['retirementSnapshots', { accountId: 4, date: '2026-03-01' }, { accountId: 4, date: '2026-04-01' }],
        ['retirementSnapshots', { accountId: 4, date: '2026-03-01' }, { accountId: 5, date: '2026-03-01' }],
        ['reconciliations', { accountId: 1, statementEndDate: '2026-03-31' }, { accountId: 1, statementEndDate: '2026-04-30' }],
        ['planHistory', { createdAt: '2026-11-12T10:00:00.123Z' }, { createdAt: '2026-11-12T10:00:00.124Z' }],
        ['manualTransactions', { accountId: 1, date: '2026-04-01', amount: -12.5, name: 'Coffee' },
            { accountId: 1, date: '2026-04-01', amount: -12.6, name: 'Coffee' }],
        ['manualTransactions', { accountId: 1, date: '2026-04-01', amount: -12.5, name: 'Coffee' },
            { accountId: 1, date: '2026-04-02', amount: -12.5, name: 'Coffee' }],
    ])('%s', (field, a, b) => {
        expect(mergeKeyFor(field, a)).not.toBe(mergeKeyFor(field, b));
    });

    test('keys of different collections never collide', () => {
        expect(mergeKeyFor('debts', { name: 'x' })).not.toBe(mergeKeyFor('incomes', { name: 'x' }));
    });
});

describe('mergeKeyFor: never dedupe (null key)', () => {
    test.each([
        ['debts', { name: '' }],
        ['debts', { name: '   ' }],
        ['debts', {}],
        ['emergencyFunds', { accountId: null }],
        ['transfers', { fromAccountId: 1, toAccountId: 2, amount: NaN, date: '2026-02-01' }],
        ['transfers', { fromAccountId: null, toAccountId: 2, amount: 5, date: '2026-02-01' }],
        ['retirementSnapshots', { accountId: 1, date: null }],
        ['reconciliations', { accountId: 1 }],
        ['planHistory', { createdAt: 'garbage' }],
        ['manualTransactions', { accountId: 1, date: '2026-01-01', amount: 5, name: '' }],
        ['unknownCollection', { name: 'x' }],
    ])('%s %j', (field, rec) => {
        expect(mergeKeyFor(field, rec)).toBeNull();
    });

    test('non-object records', () => {
        expect(mergeKeyFor('debts', null)).toBeNull();
        expect(mergeKeyFor('debts', undefined)).toBeNull();
    });
});

describe('planMerge', () => {
    test('existing match maps incoming id to existing id and is skipped', () => {
        const plan = planMerge('debts', [{ id: 90, name: 'Visa' }], [{ id: 1, name: 'visa' }, { id: 2, name: 'Amex' }]);
        expect(plan.toPost.map(r => r.id)).toEqual([2]);
        expect(plan.matched).toEqual([[1, 90]]);
        expect(plan.repeats).toEqual([]);
        expect(plan.skipped).toBe(1);
    });

    test('in-file repeat collapses to the first and points at it (#478)', () => {
        const plan = planMerge('debts', [], [{ id: 1, name: 'Visa' }, { id: 2, name: ' VISA' }]);
        expect(plan.toPost.map(r => r.id)).toEqual([1]);
        expect(plan.repeats).toEqual([[2, 1]]);
        expect(plan.matched).toEqual([]);
        expect(plan.skipped).toBe(1);
    });

    test('three copies: one posted, two repeats', () => {
        const plan = planMerge('debts', [], [{ id: 1, name: 'A' }, { id: 2, name: 'a' }, { id: 3, name: 'A' }]);
        expect(plan.toPost).toHaveLength(1);
        expect(plan.repeats).toEqual([[2, 1], [3, 1]]);
        expect(plan.skipped).toBe(2);
    });

    test('null-key records are always posted, even when identical', () => {
        const plan = planMerge('emergencyFunds', [{ id: 9, accountId: null }],
            [{ id: 1, accountId: null }, { id: 2, accountId: null }]);
        expect(plan.toPost.map(r => r.id)).toEqual([1, 2]);
        expect(plan.skipped).toBe(0);
    });

    test('order of posted records is preserved', () => {
        const plan = planMerge('expenses', [{ id: 9, name: 'b', date: '2026-01-01' }], [
            { id: 1, name: 'c', date: '2026-01-01' },
            { id: 2, name: 'b', date: '2026-01-01' },
            { id: 3, name: 'a', date: '2026-01-01' },
        ]);
        expect(plan.toPost.map(r => r.id)).toEqual([1, 3]);
    });

    test('a record differing only by date or amount is posted', () => {
        const existing = [{ id: 9, fromAccountId: 1, toAccountId: 2, amount: 50, date: '2026-02-01' }];
        const plan = planMerge('transfers', existing, [
            { id: 1, fromAccountId: 1, toAccountId: 2, amount: 50, date: '2026-02-02' },
            { id: 2, fromAccountId: 1, toAccountId: 2, amount: 60, date: '2026-02-01' },
            { id: 3, fromAccountId: 1, toAccountId: 2, amount: 50, date: '2026-02-01' },
        ]);
        expect(plan.toPost.map(r => r.id)).toEqual([1, 2]);
        expect(plan.matched).toEqual([[3, 9]]);
    });

    test('existing duplicates keep the first existing id', () => {
        const plan = planMerge('debts', [{ id: 5, name: 'x' }, { id: 6, name: 'X' }], [{ id: 1, name: 'x' }]);
        expect(plan.matched).toEqual([[1, 5]]);
    });

    test('empty and missing inputs', () => {
        expect(planMerge('debts', undefined, undefined)).toEqual({ toPost: [], matched: [], repeats: [], skipped: 0 });
        expect(planMerge('debts', [], [])).toEqual({ toPost: [], matched: [], repeats: [], skipped: 0 });
    });
});
