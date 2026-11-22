jest.mock('../../src/postgresSync.js', () => ({ pgPut: jest.fn() }));

const {
    getZeroAmountPolicy, ZERO_AMOUNT_POLICY,
    getCoastFireTarget, RETIREMENT_COAST_TARGET, COAST_FIRE_TARGET_MAX,
    computeFireNumber, FIRE_MULTIPLIER
} = require('../../src/settings.js');

describe('getZeroAmountPolicy', () => {
    const appWith = (value) => ({ settings: value === undefined ? [] : [{ key: ZERO_AMOUNT_POLICY, value }] });

    test('defaults to allow when unset', () => {
        expect(getZeroAmountPolicy(appWith())).toBe('allow');
        expect(getZeroAmountPolicy({})).toBe('allow');
    });

    test.each(['allow', 'warn', 'block'])('returns stored valid value %s', (v) => {
        expect(getZeroAmountPolicy(appWith(v))).toBe(v);
    });

    test.each(['banana', '', 'WARN', 5, true, null])('unknown value %p falls back to allow', (v) => {
        expect(getZeroAmountPolicy(appWith(v))).toBe('allow');
    });
});

// #346: Coast FIRE target balance. 0 / unset means "use the FIRE number".
describe('getCoastFireTarget', () => {
    const appWith = (value) => ({ settings: value === undefined ? [] : [{ key: RETIREMENT_COAST_TARGET, value }] });

    test('null when unset', () => {
        expect(getCoastFireTarget(appWith())).toBeNull();
        expect(getCoastFireTarget({})).toBeNull();
    });

    test.each([1, 500000, 1234.56, COAST_FIRE_TARGET_MAX])('returns valid stored value %p', (v) => {
        expect(getCoastFireTarget(appWith(v))).toBe(v);
    });

    test.each([0, -1, NaN, Infinity, COAST_FIRE_TARGET_MAX + 1, '500000', true, null])('invalid stored value %p -> null', (v) => {
        expect(getCoastFireTarget(appWith(v))).toBeNull();
    });
});

describe('computeFireNumber', () => {
    test('annual bills + budgeted expenses x the FIRE multiplier (default 25)', () => {
        const app = { bills: [{ amount: 500 }], expenses: [{ budgetAmount: 200 }], settings: [] };
        expect(computeFireNumber(app)).toBe((500 + 200) * 12 * 25);
    });

    test('honors a custom FIRE multiplier', () => {
        const app = { bills: [{ amount: 1000 }], expenses: [], settings: [{ key: FIRE_MULTIPLIER, value: 30 }] };
        expect(computeFireNumber(app)).toBe(1000 * 12 * 30);
    });

    test('0 with no bills or expenses, and tolerates missing amounts', () => {
        expect(computeFireNumber({})).toBe(0);
        expect(computeFireNumber({ bills: [{}], expenses: [{ budgetAmount: null }] })).toBe(0);
    });
});

// #548: the remaining pure settings.js helpers, now in the Stryker scope.
describe('pure settings helpers (#548)', () => {
    const S = require('../../src/settings.js');
    const { pgPut } = require('../../src/postgresSync.js');

    test('budgetThresholdKey lowercases the category and keeps the suffix', () => {
        expect(S.budgetThresholdKey('Groceries', 'healthy')).toBe('bct:groceries:healthy');
        expect(S.budgetThresholdKey('DINING Out', 'warn')).toBe('bct:dining out:warn');
        expect(S.budgetThresholdKey(5, 'warn')).toBe('bct:5:warn');
    });

    test('getSetting returns the stored value or the default', () => {
        const app = { settings: [{ key: 'a', value: 0 }, { key: 'b', value: false }] };
        expect(S.getSetting(app, 'a', 9)).toBe(0);
        expect(S.getSetting(app, 'b', true)).toBe(false);
        expect(S.getSetting(app, 'missing', 'd')).toBe('d');
        expect(S.getSetting({}, 'a', 'd')).toBe('d');
    });

    test('setSetting updates in place or appends, and PUTs the encoded key', () => {
        pgPut.mockClear();
        const app = { settings: [{ key: 'a', value: 1 }] };
        S.setSetting(app, 'a', 2);
        S.setSetting(app, 'bct:food/x?:warn', 3);
        expect(app.settings).toEqual([{ key: 'a', value: 2 }, { key: 'bct:food/x?:warn', value: 3 }]);
        expect(pgPut).toHaveBeenNthCalledWith(1, app, '/api/settings/a', { value: 2 });
        expect(pgPut).toHaveBeenNthCalledWith(2, app, '/api/settings/bct%3Afood%2Fx%3F%3Awarn', { value: 3 });
        const empty = {};
        S.setSetting(empty, 'k', true);
        expect(empty.settings).toEqual([{ key: 'k', value: true }]);
    });

    test('getFireMultiplier accepts (0, max] numbers and falls back to the default otherwise', () => {
        const withValue = value => ({ settings: [{ key: S.FIRE_MULTIPLIER, value }] });
        expect(S.getFireMultiplier({ settings: [] })).toBe(25);
        expect(S.getFireMultiplier(withValue(30))).toBe(30);
        expect(S.getFireMultiplier(withValue(0.5))).toBe(0.5);
        expect(S.getFireMultiplier(withValue(S.FIRE_MULTIPLIER_MAX))).toBe(S.FIRE_MULTIPLIER_MAX);
        for (const bad of [0, -1, S.FIRE_MULTIPLIER_MAX + 1, '30', NaN, Infinity, null]) {
            expect(S.getFireMultiplier(withValue(bad))).toBe(25);
        }
    });
});
