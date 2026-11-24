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
    test('joins the memo and split memos with one space, skipping blanks (#688)', () => {
        const lookup = buildLedgerMemoLookup({
            manualTransactions: [
                { id: 1, memo: 'Receipt', splits: [{ category: 'A', memo: 'milk' }, { category: 'B' }, null, { category: 'C', memo: 'card' }] },
                { id: 2, splits: [{ category: 'A', memo: 'only split' }, { category: 'B' }] },
                { id: 3, splits: [{ category: 'A' }, { category: 'B' }] },
            ],
        });
        expect(lookup.get('manual|1')).toBe('Receipt milk card');
        expect(lookup.get('manual|2')).toBe('only split');
        expect(lookup.has('manual|3')).toBe(false);
    });

    test('null entries in either collection are skipped without throwing', () => {
        const lookup = buildLedgerMemoLookup({ transfers: [null, { id: 4, memo: 'kept' }], manualTransactions: [null, { id: 5, memo: 'also kept', splits: 'junk' }] });
        expect([...lookup.entries()]).toEqual([['transfer|4', 'kept'], ['manual|5', 'also kept']]);
    });

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

    test('a record with no category never matches its label fallback (#688)', () => {
        const fallbackLabel = c => c || 'Uncategorized';
        expect(matchesLedgerSearch({ name: 'x' }, 'uncategorized', null, fallbackLabel)).toBe(false);
        expect(matchesLedgerSearch({ name: 'x' }, 'stryker', null, fallbackLabel)).toBe(false);
    });

    test('a split transaction matches any of its split categories and their labels (#688)', () => {
        const split = { name: 'Store', category: 'Groceries', splits: [{ category: 'Groceries', amount: -5 }, { category: 'Gifts', amount: -3 }] };
        expect(matchesLedgerSearch(split, 'gifts', null, labelFn)).toBe(true);
        expect(matchesLedgerSearch(split, 'comest', null, labelFn)).toBe(true);
        expect(matchesLedgerSearch(split, 'rent', null, labelFn)).toBe(false);
    });

    test('the memo lookup is consulted only with a lookup and a real sourceId', () => {
        const lookup = new Map([['manual|undefined', 'secret one'], ['manual|null', 'secret two']]);
        expect(matchesLedgerSearch({ name: 'x', type: 'manual' }, 'secret', lookup, labelFn)).toBe(false);
        expect(matchesLedgerSearch({ name: 'x', type: 'manual', sourceId: null }, 'secret', lookup, labelFn)).toBe(false);
        expect(() => matchesLedgerSearch({ name: 'x', type: 'manual', sourceId: 5 }, 'x', null, labelFn)).not.toThrow();
        expect(matchesLedgerSearch({ name: 'y', type: 'manual', sourceId: 5 }, 'x', null, labelFn)).toBe(false);
    });

    test('an undefined field never matches the text "undefined"', () => {
        expect(matchesLedgerSearch({ name: undefined, type: 'manual', sourceId: 1 }, 'undefined', new Map(), labelFn)).toBe(false);
    });

    test('regex characters in the term are literal', () => {
        expect(matchesLedgerSearch({ name: 'a.b (c)' }, '.b (', null, labelFn)).toBe(true);
        expect(matchesLedgerSearch({ name: 'axb' }, 'a.b', null, labelFn)).toBe(false);
    });
});
