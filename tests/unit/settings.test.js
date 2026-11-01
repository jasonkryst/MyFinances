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
