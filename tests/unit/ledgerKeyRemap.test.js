// Unit tests for Ledger key remapping on import (issue #520).
const {
    remapLedgerKey, remapLedgerEntries, ledgerKeyDropWarning, UNLINKED_ACCOUNT_KEY,
} = require('../../src/ledgerKeyRemap.js');

const m = obj => new Map(Object.entries(obj));

function maps(extra = {}) {
    return {
        accounts: m({ 5: 105, 6: 106 }),
        incomes: m({ 11: 211 }),
        bonuses: m({ 12: 212 }),
        debts: m({ 13: 213 }),
        bills: m({ 14: 214 }),
        expenses: m({ 15: 215 }),
        transfers: m({ 16: 216 }),
        recurringTemplates: m({ 2004: 4334 }),
        savings: [],
        ...extra,
    };
}

describe('remapLedgerKey: positive', () => {
    test.each([
        ['income|11|5|2025-11-01', 'income|211|105|2025-11-01'],
        ['bonus|12|5|2025-12-15', 'bonus|212|105|2025-12-15'],
        ['debt|13|6|2025-11-20', 'debt|213|106|2025-11-20'],
        ['bill|14|5|2025-11-03', 'bill|214|105|2025-11-03'],
        ['expense|15|5|2025-11-01', 'expense|215|105|2025-11-01'],
        ['transfer|16|6|2025-11-09', 'transfer|216|106|2025-11-09'],
        ['recurring|2004|5|2025-11-22', 'recurring|4334|105|2025-11-22'],
    ])('rewrites both id segments of %s', (key, expected) => {
        expect(remapLedgerKey(key, maps())).toBe(expected);
    });

    test('interest rows use the account id as their source', () => {
        expect(remapLedgerKey('interest|5|5|2025-11-30', maps())).toBe('interest|105|105|2025-11-30');
    });

    test('a recurring transfer target leg remaps to the target account', () => {
        expect(remapLedgerKey('recurring|2004|6|2025-11-22', maps())).toBe('recurring|4334|106|2025-11-22');
    });

    test('the unlinked account segment is kept as is', () => {
        expect(remapLedgerKey(`recurring|2004|${UNLINKED_ACCOUNT_KEY}|2025-11-22`, maps()))
            .toBe(`recurring|4334|${UNLINKED_ACCOUNT_KEY}|2025-11-22`);
    });

    test('a savings key resolves a single matching fund', () => {
        const savings = [{ oldId: 7, newId: 307, oldAccountId: 5 }];
        expect(remapLedgerKey('savings|7|5|2025-11-01', maps({ savings }))).toBe('savings|307|105|2025-11-01');
    });

    test('an emergency and a sinking fund with the same old id are told apart by account', () => {
        const savings = [
            { oldId: 7, newId: 307, oldAccountId: 5 },
            { oldId: 7, newId: 407, oldAccountId: 6 },
        ];
        expect(remapLedgerKey('savings|7|5|2025-11-01', maps({ savings }))).toBe('savings|307|105|2025-11-01');
        expect(remapLedgerKey('savings|7|6|2025-11-01', maps({ savings }))).toBe('savings|407|106|2025-11-01');
    });

    test('a single matching fund resolves without consulting the account segment', () => {
        const savings = [{ oldId: 7, newId: 307, oldAccountId: 5 }];
        expect(remapLedgerKey('savings|7|6|2025-11-01', maps({ savings }))).toBe('savings|307|106|2025-11-01');
    });

    test('an unlinked savings fund matches the unlinked segment', () => {
        const savings = [
            { oldId: 7, newId: 307, oldAccountId: null },
            { oldId: 7, newId: 407, oldAccountId: 6 },
        ];
        expect(remapLedgerKey(`savings|7|${UNLINKED_ACCOUNT_KEY}|2025-11-01`, maps({ savings })))
            .toBe(`savings|307|${UNLINKED_ACCOUNT_KEY}|2025-11-01`);
    });

    test('numeric map values and string keys interoperate', () => {
        const idMaps = maps({ debts: new Map([['13', '999']]) });
        expect(remapLedgerKey('debt|13|5|2025-11-20', idMaps)).toBe('debt|999|105|2025-11-20');
    });

    test('a new id of 0 is still a valid mapping', () => {
        expect(remapLedgerKey('debt|13|5|2025-11-20', maps({ debts: m({ 13: 0 }) }))).toBe('debt|0|105|2025-11-20');
    });
});

describe('remapLedgerKey: negative', () => {
    test.each([
        ['source missing from the import', 'recurring|9999|5|2025-11-22'],
        ['account missing from the import', 'recurring|2004|77|2025-11-22'],
        ['interest for an unknown account', 'interest|77|77|2025-11-30'],
        ['unknown type', 'mystery|11|5|2025-11-01'],
        ['prototype-ish type', 'constructor|11|5|2025-11-01'],
        ['reconciliation (never keyed)', 'reconciliation|1|5|2025-11-01'],
        ['too few segments', 'income|11|5'],
        ['too many segments', 'income|11|5|2025-11-01|x'],
        ['empty source', 'income||5|2025-11-01'],
        ['empty account', 'income|11||2025-11-01'],
        ['empty date', 'income|11|5|'],
        ['empty type', '|11|5|2025-11-01'],
        ['empty string', ''],
    ])('returns null for %s', (_label, key) => {
        expect(remapLedgerKey(key, maps())).toBeNull();
    });

    test('non-string keys and missing maps return null', () => {
        expect(remapLedgerKey(null, maps())).toBeNull();
        expect(remapLedgerKey(42, maps())).toBeNull();
        expect(remapLedgerKey('income|11|5|2025-11-01', null)).toBeNull();
        expect(remapLedgerKey('income|11|5|2025-11-01', { accounts: m({ 5: 105 }) })).toBeNull();
        expect(remapLedgerKey('income|11|5|2025-11-01', { accounts: { 5: 105 }, incomes: m({ 11: 211 }) })).toBeNull();
    });

    test('a savings key with no matching fund returns null', () => {
        expect(remapLedgerKey('savings|7|5|2025-11-01', maps())).toBeNull();
        expect(remapLedgerKey('savings|7|5|2025-11-01', maps({ savings: null }))).toBeNull();
        expect(remapLedgerKey('savings|8|5|2025-11-01', maps({ savings: [{ oldId: 7, newId: 307, oldAccountId: 5 }] }))).toBeNull();
    });

    test('a savings fund that failed to post (no newId) is not a match', () => {
        const savings = [{ oldId: 7, newId: null, oldAccountId: 5 }];
        expect(remapLedgerKey('savings|7|5|2025-11-01', maps({ savings }))).toBeNull();
    });

    test('a failed fund keeps its key instead of letting it slide onto the other fund', () => {
        const savings = [
            { oldId: 7, newId: null, oldAccountId: 5 },
            { oldId: 7, newId: 407, oldAccountId: 6 },
        ];
        expect(remapLedgerKey('savings|7|5|2025-11-01', maps({ savings }))).toBeNull();
        expect(remapLedgerKey('savings|7|6|2025-11-01', maps({ savings }))).toBe('savings|407|106|2025-11-01');
    });

    test('an ambiguous savings key the account cannot settle returns null, never a guess', () => {
        const savings = [
            { oldId: 7, newId: 307, oldAccountId: 5 },
            { oldId: 7, newId: 407, oldAccountId: 5 },
        ];
        expect(remapLedgerKey('savings|7|5|2025-11-01', maps({ savings }))).toBeNull();
        expect(remapLedgerKey('savings|7|6|2025-11-01', maps({ savings }))).toBeNull();
    });
});

describe('remapLedgerEntries', () => {
    test('rewrites resolvable entries, keeps their values and counts the rest', () => {
        const val = { amount: 1900 };
        const result = remapLedgerEntries([
            ['recurring|2004|5|2025-11-22', val],
            ['recurring|9999|5|2025-11-22', { amount: 1 }],
            ['garbage', { amount: 2 }],
        ], maps());
        expect(result.entries).toEqual([['recurring|4334|105|2025-11-22', val]]);
        expect(result.entries[0][1]).toBe(val);
        expect(result.dropped).toBe(2);
    });

    test('empty and missing input yield nothing dropped', () => {
        expect(remapLedgerEntries([], maps())).toEqual({ entries: [], dropped: 0 });
        expect(remapLedgerEntries(undefined, maps())).toEqual({ entries: [], dropped: 0 });
    });
});

describe('ledgerKeyDropWarning', () => {
    test('null when nothing was dropped', () => {
        expect(ledgerKeyDropWarning('Ledger Override', 0)).toBeNull();
        expect(ledgerKeyDropWarning('Ledger Override', undefined)).toBeNull();
    });

    test('singular and plural summaries in the sanitizer warning shape', () => {
        expect(ledgerKeyDropWarning('Ledger Override', 1)).toEqual({
            recordType: 'Ledger Override',
            recordName: '1 entry',
            kind: 'rejected',
            reason: 'Referenced a record or account that is not in this file — not imported.',
        });
        expect(ledgerKeyDropWarning('Ledger Cleared Flag', 12).recordName).toBe('12 entries');
    });
});
