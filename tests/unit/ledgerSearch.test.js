// Unit tests for the Ledger search predicate (issue #586).
const {
    normalizeLedgerSearchTerm, buildLedgerMemoLookup, matchesLedgerSearch,
} = require('../../src/ledgerSearch.js');

const labels = { Groceries: 'Comestibles', Transfer: 'Transferencia' };
const labelFn = c => labels[c] || c;

describe('normalizeLedgerSearchTerm', () => {
    test.each([
        ['  Rent ', 'rent'], ['ABC', 'abc'], ['', ''], ['   ', ''],
        [null, ''], [undefined, ''], [42, ''], [{}, ''],
    ])('%j -> %j', (raw, expected) => {
        expect(normalizeLedgerSearchTerm(raw)).toBe(expected);
    });
});

describe('buildLedgerMemoLookup', () => {
    test('keys transfers and manual transactions by type and id', () => {
        const lookup = buildLedgerMemoLookup({
            transfers: [{ id: 1, memo: 'Down payment' }, { id: 2, memo: '' }],
            manualTransactions: [{ id: 1, memo: 'Birthday cash' }, { id: 3 }],
        });
        expect(lookup.get('transfer|1')).toBe('Down payment');
        expect(lookup.get('manual|1')).toBe('Birthday cash');
        expect(lookup.has('transfer|2')).toBe(false);
        expect(lookup.has('manual|3')).toBe(false);
        expect(lookup.size).toBe(2);
    });

    test('tolerates missing collections and a missing app', () => {
        expect(buildLedgerMemoLookup({}).size).toBe(0);
        expect(buildLedgerMemoLookup(null).size).toBe(0);
        expect(buildLedgerMemoLookup(undefined).size).toBe(0);
    });
});

describe('matchesLedgerSearch', () => {
    const tx = { name: 'Whole Foods Market', category: 'Groceries', type: 'manual', sourceId: 7 };
    const memos = new Map([['manual|7', 'Weekly shop for Anna']]);

    test('empty or blank term matches everything, even a row with no fields', () => {
        expect(matchesLedgerSearch(tx, '', memos, labelFn)).toBe(true);
        expect(matchesLedgerSearch(tx, '   ', memos, labelFn)).toBe(true);
        expect(matchesLedgerSearch(tx, undefined, memos, labelFn)).toBe(true);
        expect(matchesLedgerSearch({}, '', memos, labelFn)).toBe(true);
    });

    test('matches the name, case-insensitively and trimmed', () => {
        expect(matchesLedgerSearch(tx, 'whole', memos, labelFn)).toBe(true);
        expect(matchesLedgerSearch(tx, '  FOODS MARKET  ', memos, labelFn)).toBe(true);
    });

    test('matches the stored category and the translated label', () => {
        expect(matchesLedgerSearch(tx, 'grocer', memos, labelFn)).toBe(true);
        expect(matchesLedgerSearch(tx, 'comest', memos, labelFn)).toBe(true);
        // Without a label function only the stored category is searched.
        expect(matchesLedgerSearch(tx, 'comest', memos, undefined)).toBe(false);
    });

    test('matches the memo found through the lookup by type and sourceId', () => {
        expect(matchesLedgerSearch(tx, 'anna', memos, labelFn)).toBe(true);
        // Same id, other type: no memo.
        expect(matchesLedgerSearch({ ...tx, type: 'transfer' }, 'anna', memos, labelFn)).toBe(false);
        // Same type, other id.
        expect(matchesLedgerSearch({ ...tx, sourceId: 8 }, 'anna', memos, labelFn)).toBe(false);
    });

    test('a transfer memo is found for both legs through type transfer', () => {
        const lookup = new Map([['transfer|3', 'House fund']]);
        expect(matchesLedgerSearch({ name: 'Transfer to Savings', category: 'Transfer', type: 'transfer', sourceId: 3 }, 'house', lookup, labelFn)).toBe(true);
    });

    test('no match returns false', () => {
        expect(matchesLedgerSearch(tx, 'zzz', memos, labelFn)).toBe(false);
    });

    test('null and missing fields never throw and never match "null"', () => {
        const bare = { name: null, category: null, type: 'income', sourceId: null };
        expect(matchesLedgerSearch(bare, 'null', memos, labelFn)).toBe(false);
        expect(matchesLedgerSearch(bare, 'x', null, labelFn)).toBe(false);
        expect(matchesLedgerSearch({ name: 'Pay' }, 'pay', undefined, labelFn)).toBe(true);
        expect(matchesLedgerSearch(null, 'pay', memos, labelFn)).toBe(false);
    });

    test('a sourceId of 0 still looks up its memo', () => {
        expect(matchesLedgerSearch({ name: 'x', type: 'manual', sourceId: 0 }, 'zero', new Map([['manual|0', 'zero memo']]), labelFn)).toBe(true);
    });

    test('regex characters in the term are literal', () => {
        expect(matchesLedgerSearch({ name: 'a.b (c)' }, '.b (', null, labelFn)).toBe(true);
        expect(matchesLedgerSearch({ name: 'axb' }, 'a.b', null, labelFn)).toBe(false);
    });
});
