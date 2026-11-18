// Unit tests for remapping account-id settings on import (issue #651).
const { remapAccountSettings } = require('../../src/settingsRemap.js');

// Object-keyed map: keys are strings, like the idMap built in postgresImport.js.
const MAP = { 5: 105, 6: 106 };
const s = (key, value) => ({ key, value });

describe('remapAccountSettings', () => {
    test('both account settings follow their account', () => {
        const r = remapAccountSettings([s('surplusAccountId', 5), s('notifyFilterAccount', 6)], MAP);
        expect(r.settings).toEqual([s('surplusAccountId', 105), s('notifyFilterAccount', 106)]);
        expect(r.changes).toEqual([
            { key: 'surplusAccountId', from: 5, to: 105, kind: 'remapped' },
            { key: 'notifyFilterAccount', from: 6, to: 106, kind: 'remapped' },
        ]);
    });

    test('an unresolved surplusAccountId is dropped', () => {
        const r = remapAccountSettings([s('surplusAccountId', 99), s('x', 1)], MAP);
        expect(r.settings).toEqual([s('x', 1)]);
        expect(r.changes).toEqual([{ key: 'surplusAccountId', from: 99, to: null, kind: 'rejected' }]);
    });

    test('an unresolved notifyFilterAccount resets to 0', () => {
        const r = remapAccountSettings([s('notifyFilterAccount', 99)], MAP);
        expect(r.settings).toEqual([s('notifyFilterAccount', 0)]);
        expect(r.changes).toEqual([{ key: 'notifyFilterAccount', from: 99, to: 0, kind: 'coerced' }]);
    });

    test('notifyFilterAccount 0 is untouched with no change recorded', () => {
        const r = remapAccountSettings([s('notifyFilterAccount', 0)], MAP);
        expect(r.settings).toEqual([s('notifyFilterAccount', 0)]);
        expect(r.changes).toEqual([]);
    });

    test('a remap onto the same id records nothing', () => {
        const r = remapAccountSettings([s('surplusAccountId', 5)], { 5: 5 });
        expect(r.settings).toEqual([s('surplusAccountId', 5)]);
        expect(r.changes).toEqual([]);
    });

    test('other keys pass through unchanged, including account-looking values', () => {
        const input = [s('theme', 'dark'), s('somethingElse', 5)];
        const r = remapAccountSettings(input, MAP);
        expect(r.settings).toEqual(input);
        expect(r.changes).toEqual([]);
    });

    test('input array and objects are not mutated', () => {
        const input = [s('surplusAccountId', 5), s('notifyFilterAccount', 99)];
        const copy = JSON.parse(JSON.stringify(input));
        const r = remapAccountSettings(input, MAP);
        expect(input).toEqual(copy);
        expect(r.settings).not.toBe(input);
        expect(r.settings[0]).not.toBe(input[0]);
    });

    test('string and number ids both resolve through a string-keyed map', () => {
        expect(remapAccountSettings([s('surplusAccountId', '5')], MAP).settings).toEqual([s('surplusAccountId', 105)]);
        expect(remapAccountSettings([s('surplusAccountId', 5)], MAP).settings).toEqual([s('surplusAccountId', 105)]);
    });

    test('empty, missing or non-array settings and a missing map', () => {
        expect(remapAccountSettings([], MAP)).toEqual({ settings: [], changes: [] });
        expect(remapAccountSettings(undefined, MAP)).toEqual({ settings: [], changes: [] });
        expect(remapAccountSettings(null, MAP)).toEqual({ settings: [], changes: [] });
        const r = remapAccountSettings([s('surplusAccountId', 5), s('notifyFilterAccount', 5)], undefined);
        expect(r.settings).toEqual([s('notifyFilterAccount', 0)]);
        expect(r.changes.map(c => c.kind)).toEqual(['rejected', 'coerced']);
    });

    test('map lookups ignore inherited properties', () => {
        const r = remapAccountSettings([s('surplusAccountId', 'constructor')], MAP);
        expect(r.settings).toEqual([]);
        expect(r.changes[0].kind).toBe('rejected');
    });
});
