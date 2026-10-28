jest.mock('../../src/postgresSync.js', () => ({ pgPut: jest.fn() }));

const { getZeroAmountPolicy, ZERO_AMOUNT_POLICY } = require('../../src/settings.js');

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
