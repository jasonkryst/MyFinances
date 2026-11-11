// Unit tests for optimistic-concurrency helpers (issues #578, #563).
const {
    deepEqual, diffFields, classifyConflict, itemPath, createShadowStore,
} = require('../../src/recordVersions.js');

describe('deepEqual', () => {
    test.each([
        [1, 1], ['a', 'a'], [null, null], [undefined, undefined], [true, true],
        [[1, [2, 3]], [1, [2, 3]]],
        [{ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }],
        [[], []], [{}, {}],
    ])('equal: %j vs %j', (a, b) => {
        expect(deepEqual(a, b)).toBe(true);
    });

    test.each([
        [1, '1'], [0, null], [null, undefined], [null, {}], [{}, null], [0, false],
        [[1, 2], [2, 1]], [[1], [1, 1]], [[1, 1], [1]], [[], {}], [{}, []],
        [{ a: 1 }, { a: 1, b: 2 }], [{ a: 1, b: 2 }, { a: 1 }], [{ a: 1 }, { b: 1 }],
        [{ a: undefined }, { b: undefined }],
        [{ a: { b: 1 } }, { a: { b: 2 } }], ['x', { x: 1 }],
        [1, {}], [{}, 1], [1, 2], ['ab', 'ba'], [[], 0], [[1, 2], { 0: 1, 1: 2 }],
    ])('not equal: %j vs %j', (a, b) => {
        expect(deepEqual(a, b)).toBe(false);
    });
});

describe('diffFields', () => {
    const base = { id: 5, rowVersion: 3, name: 'Car Loan', accountBalance: 5000, personIds: [1, 2], split: { 1: 0.5 }, notes: null };

    test('a whole stale record diffs to only the field this tab changed (#563)', () => {
        const local = { ...base, accountBalance: 4500 };
        expect(diffFields(base, local)).toEqual({ accountBalance: 4500 });
    });

    test('a partial body is compared field by field', () => {
        expect(diffFields(base, { archived: true })).toEqual({ archived: true });
        expect(diffFields(base, { name: 'Car Loan' })).toEqual({});
    });

    test('nested arrays and objects are compared by value', () => {
        expect(diffFields(base, { personIds: [1, 2], split: { 1: 0.5 } })).toEqual({});
        expect(diffFields(base, { personIds: [2, 1] })).toEqual({ personIds: [2, 1] });
        expect(diffFields(base, { split: { 1: 0.25 } })).toEqual({ split: { 1: 0.25 } });
    });

    test('null vs a value, and number vs numeric string, count as changes', () => {
        expect(diffFields(base, { notes: '' })).toEqual({ notes: '' });
        expect(diffFields(base, { accountBalance: '5000' })).toEqual({ accountBalance: '5000' });
        expect(diffFields(base, { name: null })).toEqual({ name: null });
    });

    test('id, rowVersion and undefined values are never sent', () => {
        // toEqual ignores undefined-valued keys, so compare the key list.
        expect(Object.keys(diffFields(base, { id: 9, rowVersion: 1, name: undefined }))).toEqual([]);
    });

    test('a non-object base is treated as empty, never read as an object', () => {
        expect(diffFields('ab', { length: 2 })).toEqual({ length: 2 });
    });

    test('missing or non-object inputs', () => {
        expect(diffFields(null, { a: 1 })).toEqual({ a: 1 });
        expect(diffFields(base, null)).toEqual({});
        expect(diffFields(base, 'x')).toEqual({});
        expect(diffFields('x', { a: 1 })).toEqual({ a: 1 });
    });
});

describe('classifyConflict', () => {
    const base = { id: 1, rowVersion: 1, name: 'Car Loan', accountBalance: 5000, notes: '' };

    test('different fields: no conflict, their change is reported (#563)', () => {
        const theirs = { ...base, rowVersion: 2, name: 'Auto Loan' };
        expect(classifyConflict(base, theirs, { accountBalance: 4500 })).toEqual({
            conflicts: [],
            theirsChanges: { name: 'Auto Loan' },
        });
    });

    test('same field, different values: a conflict', () => {
        const theirs = { ...base, rowVersion: 2, name: 'Auto Loan' };
        expect(classifyConflict(base, theirs, { name: 'Truck Loan' })).toEqual({ conflicts: ['name'], theirsChanges: {} });
    });

    test('same field, same value: not a conflict', () => {
        const theirs = { ...base, rowVersion: 2, name: 'Auto Loan' };
        expect(classifyConflict(base, theirs, { name: 'Auto Loan' }).conflicts).toEqual([]);
    });

    test('a field only this tab changed is not a conflict', () => {
        const theirs = { ...base, rowVersion: 2 };
        expect(classifyConflict(base, theirs, { notes: 'x' })).toEqual({ conflicts: [], theirsChanges: {} });
    });

    test('meta fields are never reported as their changes', () => {
        const theirs = { ...base, id: 1, rowVersion: 9 };
        expect(classifyConflict(base, theirs, {}).theirsChanges).toEqual({});
    });

    test('a field the server added counts as their change', () => {
        const theirs = { ...base, rowVersion: 2, archived: true };
        expect(classifyConflict(base, theirs, {}).theirsChanges).toEqual({ archived: true });
    });

    test('mixed: conflicts and safe changes together', () => {
        const theirs = { ...base, rowVersion: 3, name: 'Auto Loan', accountBalance: 4000, notes: 'n' };
        const r = classifyConflict(base, theirs, { name: 'Truck', accountBalance: 4000 });
        expect(r.conflicts).toEqual(['name']);
        expect(r.theirsChanges).toEqual({ notes: 'n' });
    });

    test('a non-object base or theirs is treated as empty', () => {
        expect(classifyConflict('ab', { length: 2 }, {}).theirsChanges).toEqual({ length: 2 });
        expect(classifyConflict({}, 'ab', { length: 3 }).conflicts).toEqual([]);
    });

    test('non-object inputs are treated as empty', () => {
        expect(classifyConflict(null, null, null)).toEqual({ conflicts: [], theirsChanges: {} });
        expect(classifyConflict(null, { name: 'x' }, { name: 'y' })).toEqual({ conflicts: ['name'], theirsChanges: {} });
        expect(classifyConflict(base, 'x', { name: 'y' })).toEqual({ conflicts: ['name'], theirsChanges: {} });
        expect(classifyConflict(base, { ...base, name: 'z' }, 'x')).toEqual({ conflicts: [], theirsChanges: { name: 'z' } });
    });
});

describe('itemPath', () => {
    test('numeric and digit-string ids', () => {
        expect(itemPath('/api/debts', 5)).toBe('/api/debts/5');
        expect(itemPath('/api/debts', '12')).toBe('/api/debts/12');
        expect(itemPath('/api/debts', 0)).toBe('/api/debts/0');
    });

    test.each([
        ['/api/debts', null], ['/api/debts', undefined], ['/api/debts', 1.5], ['/api/debts', '1a'],
        ['/api/debts', ''], ['/api/debts', -1], ['/api/debts', {}], ['', 1], [null, 1], [5, 1],
        ['/api/debts', [5]], ['/api/debts', 'a1'], ['/api/debts', '1a'], ['/api/debts', true],
    ])('rejects %j %j', (collection, id) => {
        expect(itemPath(collection, id)).toBeNull();
    });
});

describe('createShadowStore', () => {
    test('stores a deep copy and returns copies', () => {
        const store = createShadowStore();
        const row = { id: 1, rowVersion: 2, tags: ['a'] };
        expect(store.set('/api/x/1', row)).toBe(true);
        row.tags.push('b');
        const got = store.get('/api/x/1');
        expect(got).toEqual({ id: 1, rowVersion: 2, tags: ['a'] });
        got.tags.push('c');
        expect(store.get('/api/x/1').tags).toEqual(['a']);
        expect(store.size).toBe(1);
    });

    test('ignores rows without an integer rowVersion and bad paths', () => {
        const store = createShadowStore();
        expect(store.set('/api/x/1', { id: 1 })).toBe(false);
        expect(store.set('/api/x/1', { id: 1, rowVersion: '2' })).toBe(false);
        expect(store.set('/api/x/1', { id: 1, rowVersion: 1.5 })).toBe(false);
        expect(store.set('/api/x/1', null)).toBe(false);
        expect(store.set('/api/x/1', 'row')).toBe(false);
        expect(store.set(null, { rowVersion: 1 })).toBe(false);
        expect(store.size).toBe(0);
        expect(store.get('/api/x/1')).toBeNull();
    });

    test('delete and clear', () => {
        const store = createShadowStore();
        store.set('/a/1', { rowVersion: 1 });
        store.set('/a/2', { rowVersion: 1 });
        store.delete('/a/1');
        expect(store.get('/a/1')).toBeNull();
        expect(store.size).toBe(1);
        store.clear();
        expect(store.size).toBe(0);
    });
});
