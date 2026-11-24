import {
    foldForSearch, matchRank, matchRecords, RECORD_TYPE_ORDER, MAX_RECORDS_PER_TYPE,
} from '../../src/paletteSearch.js';

describe('foldForSearch', () => {
    test('lower-cases, trims and strips accents', () => {
        expect(foldForSearch('  Café  ')).toBe('cafe');
        expect(foldForSearch('Préstamo Coche')).toBe('prestamo coche');
        expect(foldForSearch('ŻŁÓW')).toBe('zlow');
        expect(foldForSearch('łódź')).toBe('lodz');
    });
    test('null and numbers are safe', () => {
        expect(foldForSearch(null)).toBe('');
        expect(foldForSearch(undefined)).toBe('');
        expect(foldForSearch(42)).toBe('42');
    });
});

describe('matchRank', () => {
    test('prefix of the name is 0', () => {
        expect(matchRank('Visa Gold', 'vi')).toBe(0);
        expect(matchRank('Visa Gold', 'VISA GOLD')).toBe(0);
    });
    test('prefix of a later word is 1', () => {
        expect(matchRank('Visa Gold', 'gol')).toBe(1);
        expect(matchRank('Car-Loan', 'loan')).toBe(1);
        expect(matchRank('Cargo Gold', 'go')).toBe(1);
    });
    test('inside a word is 2', () => {
        expect(matchRank('Mastercard', 'card')).toBe(2);
    });
    test('accents and case are ignored', () => {
        expect(matchRank('Préstamo', 'presta')).toBe(0);
        expect(matchRank('Konto Złote', 'zlo')).toBe(1);
    });
    test('no match, blank query or blank name is null', () => {
        expect(matchRank('Visa', 'amex')).toBeNull();
        expect(matchRank('Visa', '')).toBeNull();
        expect(matchRank('Visa', '   ')).toBeNull();
        expect(matchRank('', 'a')).toBeNull();
    });
});

describe('matchRecords', () => {
    const e = (type, id, name, extra = {}) => ({ type, id, name, ...extra });

    test('groups by type order, then rank, then name', () => {
        const entries = [
            e('person', 1, 'Visa Holder'),
            e('debt', 2, 'Old Visa'),
            e('debt', 3, 'Visa Gold'),
            e('account', 4, 'Avisa Checking'),
            e('debt', 5, 'Visa Blue'),
        ];
        expect(matchRecords(entries, 'visa').map(x => x.id)).toEqual([4, 5, 3, 2, 1]);
    });

    test('ties on name break by id', () => {
        const out = matchRecords([e('debt', 9, 'Visa'), e('debt', 3, 'visa')], 'visa');
        expect(out.map(x => x.id)).toEqual([3, 9]);
    });

    test('keeps the entry objects (with any extra fields)', () => {
        const entry = e('income', 1, 'Salary', { amountText: '$3,000.00' });
        expect(matchRecords([entry], 'sal')[0]).toBe(entry);
    });

    test('caps each type', () => {
        const many = Array.from({ length: 9 }, (_, i) => e('debt', i + 1, `Card ${i + 1}`));
        const out = matchRecords([...many, e('account', 50, 'Card Account')], 'card');
        expect(out.filter(x => x.type === 'debt')).toHaveLength(MAX_RECORDS_PER_TYPE);
        expect(out.some(x => x.type === 'account')).toBe(true);
        expect(matchRecords(many, 'card', 2)).toHaveLength(2);
        expect(matchRecords(many, 'card', 0)).toHaveLength(MAX_RECORDS_PER_TYPE);
        expect(matchRecords(many, 'card', 'x')).toHaveLength(MAX_RECORDS_PER_TYPE);
    });

    test('blank query returns nothing', () => {
        expect(matchRecords([e('debt', 1, 'Visa')], '')).toEqual([]);
        expect(matchRecords([e('debt', 1, 'Visa')], '  ')).toEqual([]);
    });

    test('ignores unknown types, blank names and junk', () => {
        const out = matchRecords([
            e('bill', 1, 'Visa'), e('debt', 2, '   '), e('debt', 3, null), null, undefined,
            e('debt', 4, 'Visa'),
        ], 'visa');
        expect(out.map(x => x.id)).toEqual([4]);
        expect(matchRecords(null, 'visa')).toEqual([]);
    });

    test('type order covers every palette record type', () => {
        expect(RECORD_TYPE_ORDER).toEqual(['account', 'debt', 'income', 'recurring', 'emergency', 'sinking', 'person']);
    });
});
