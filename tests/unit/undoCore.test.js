// #577 (Undo) and #546 (Contribute dialog): pure helpers.
const { ledgerKeysForSource, rekeyLedgerKey, planLedgerRekey, recordForRecreate } = require('../../src/undoCore.js');
const { parseContributionAmount } = require('../../src/utils.js');

describe('ledgerKeysForSource', () => {
    const map = {
        'debt|7|3|2026-11-15': { amount: -40 },
        'debt|7|__unlinked__|2026-12-15': { amount: -40 },
        'debt|70|3|2026-11-15': { amount: -1 },
        'income|7|3|2026-11-01': { amount: 100 },
        'debt|7|3': { amount: 0 },
        'recurring|7|3|2026-11-02': {},
    };

    test('only that type and exact id, well-formed keys only', () => {
        expect(ledgerKeysForSource(map, 'debt', 7).sort()).toEqual(['debt|7|3|2026-11-15', 'debt|7|__unlinked__|2026-12-15']);
        expect(ledgerKeysForSource(map, 'income', '7')).toEqual(['income|7|3|2026-11-01']);
        expect(ledgerKeysForSource(map, 'bonus', 7)).toEqual([]);
    });

    test('a missing or non-object map has no keys', () => {
        expect(ledgerKeysForSource(null, 'debt', 7)).toEqual([]);
        expect(ledgerKeysForSource(undefined, 'debt', 7)).toEqual([]);
        expect(ledgerKeysForSource('x', 'debt', 7)).toEqual([]);
    });
});

describe('rekeyLedgerKey', () => {
    test('replaces only the source id', () => {
        expect(rekeyLedgerKey('recurring|5|2|2026-11-03', 99)).toBe('recurring|99|2|2026-11-03');
        expect(rekeyLedgerKey('debt|5|__unlinked__|2026-11-03', '12')).toBe('debt|12|__unlinked__|2026-11-03');
    });

    test('malformed keys or a missing id give null', () => {
        expect(rekeyLedgerKey('debt|5|2', 9)).toBeNull();
        expect(rekeyLedgerKey('debt|5|2|2026-11-03|x', 9)).toBeNull();
        expect(rekeyLedgerKey('debt|5|2|2026-11-03', null)).toBeNull();
        expect(rekeyLedgerKey('debt|5|2|2026-11-03', undefined)).toBeNull();
        expect(rekeyLedgerKey('debt|5|2|2026-11-03', '')).toBeNull();
    });
});

describe('planLedgerRekey', () => {
    test('moves every entry of the source to the new id with its value', () => {
        const map = {
            'bonus|4|1|2026-12-20': { amount: 900, memo: 'net' },
            'bonus|4|1|2027-12-20': { amount: 950 },
            'bonus|5|1|2026-12-20': { amount: 1 },
        };
        const plan = planLedgerRekey(map, 'bonus', 4, 11);
        expect(plan).toEqual([
            { oldKey: 'bonus|4|1|2026-12-20', newKey: 'bonus|11|1|2026-12-20', value: { amount: 900, memo: 'net' } },
            { oldKey: 'bonus|4|1|2027-12-20', newKey: 'bonus|11|1|2027-12-20', value: { amount: 950 } },
        ]);
    });

    test('nothing to move when the id is unchanged or the source has no entries', () => {
        const map = { 'debt|4|1|2026-12-20': {} };
        expect(planLedgerRekey(map, 'debt', 4, 4)).toEqual([]);
        expect(planLedgerRekey(map, 'debt', 5, 6)).toEqual([]);
        expect(planLedgerRekey({}, 'debt', 4, 6)).toEqual([]);
    });
});

describe('recordForRecreate', () => {
    test('drops the id and rowVersion and keeps everything else', () => {
        const rec = { id: 3, rowVersion: 7, name: 'Visa', paidMonths: ['2026-10'], archived: false };
        expect(recordForRecreate(rec)).toEqual({ name: 'Visa', paidMonths: ['2026-10'], archived: false });
        expect(rec.id).toBe(3); // the original is not modified
    });

    test('non-objects give null', () => {
        expect(recordForRecreate(null)).toBeNull();
        expect(recordForRecreate(undefined)).toBeNull();
        expect(recordForRecreate('x')).toBeNull();
    });
});

describe('parseContributionAmount', () => {
    test.each([
        ['50', 50], [' 12.5 ', 12.5], ['0.01', 0.01], ['10.005', 10.01], ['1e9', 1e9], [25, 25],
    ])('%p -> %p', (raw, expected) => {
        expect(parseContributionAmount(raw)).toBe(expected);
    });

    test.each([
        [''], ['   '], [null], [undefined], ['0'], ['-5'], ['abc'], ['NaN'], ['Infinity'], ['1000000001'], ['0.004'],
    ])('%p is rejected', (raw) => {
        expect(parseContributionAmount(raw)).toBeNull();
    });
});
