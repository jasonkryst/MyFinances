// #547: pure share math from src/debtOwnership.js (#272).
const {
    getDebtShare, hasCustomSplit, removePersonFromDebt, equalPercents, autoBalancePercents,
} = require('../../src/debtOwnership.js');

describe('getDebtShare', () => {
    test('a person not linked to the debt has no share', () => {
        expect(getDebtShare({ personIds: [1, 2] }, 3)).toBe(0);
        expect(getDebtShare({ personIds: [] }, 1)).toBe(0);
        expect(getDebtShare({}, 1)).toBe(0);
        expect(getDebtShare(null, 1)).toBe(0);
        expect(getDebtShare(undefined, 1)).toBe(0);
    });

    test('a sole owner has 100%, even with a stray split', () => {
        expect(getDebtShare({ personIds: [1] }, 1)).toBe(1);
        expect(getDebtShare({ personIds: [1], ownershipSplit: { 1: 0.4 } }, 1)).toBe(1);
    });

    test('no split means an equal share', () => {
        expect(getDebtShare({ personIds: [1, 2] }, 1)).toBe(0.5);
        expect(getDebtShare({ personIds: [1, 2, 3, 4], ownershipSplit: null }, 4)).toBe(0.25);
    });

    test('uses the explicit split for 2+ people', () => {
        const d = { personIds: [1, 2], ownershipSplit: { 1: 0.7, 2: 0.3 } };
        expect(getDebtShare(d, 1)).toBe(0.7);
        expect(getDebtShare(d, 2)).toBe(0.3);
    });

    test('a missing, negative or non-numeric split entry counts as 0, never negative', () => {
        expect(getDebtShare({ personIds: [1, 2], ownershipSplit: { 1: 1 } }, 2)).toBe(0);
        expect(getDebtShare({ personIds: [1, 2], ownershipSplit: { 1: -0.5, 2: 1.5 } }, 1)).toBe(0);
        expect(getDebtShare({ personIds: [1, 2], ownershipSplit: { 1: 'x', 2: 1 } }, 1)).toBe(0);
        expect(getDebtShare({ personIds: [1, 2], ownershipSplit: { 1: 0, 2: 1 } }, 1)).toBe(0);
    });

    test('a non-object split falls back to equal', () => {
        expect(getDebtShare({ personIds: [1, 2], ownershipSplit: 'bad' }, 1)).toBe(0.5);
    });
});

describe('hasCustomSplit', () => {
    test('true only with 2+ people and an object split', () => {
        expect(hasCustomSplit({ personIds: [1, 2], ownershipSplit: { 1: 0.5, 2: 0.5 } })).toBe(true);
        expect(hasCustomSplit({ personIds: [1], ownershipSplit: { 1: 1 } })).toBe(false);
        expect(hasCustomSplit({ personIds: [1, 2], ownershipSplit: null })).toBe(false);
        expect(hasCustomSplit({ personIds: [1, 2] })).toBe(false);
        expect(hasCustomSplit({ personIds: [1, 2], ownershipSplit: 'x' })).toBe(false);
        expect(hasCustomSplit({})).toBe(false);
        expect(hasCustomSplit(null)).toBe(false);
    });
});

describe('removePersonFromDebt', () => {
    test('does not mutate the input', () => {
        const d = { name: 'D', personIds: [1, 2], ownershipSplit: { 1: 0.5, 2: 0.5 } };
        const copy = JSON.parse(JSON.stringify(d));
        removePersonFromDebt(d, 1);
        expect(d).toEqual(copy);
    });

    test('equal-share debt: unlinking one of three keeps an equal share', () => {
        const out = removePersonFromDebt({ personIds: [1, 2, 3], ownershipSplit: null }, 2);
        expect(out.personIds).toEqual([1, 3]);
        expect(out.ownershipSplit).toBeNull();
    });

    test('custom split: remaining shares are renormalized proportionally', () => {
        const d = { personIds: [1, 2, 3], ownershipSplit: { 1: 0.5, 2: 0.3, 3: 0.2 } };
        const out = removePersonFromDebt(d, 3);
        expect(out.personIds).toEqual([1, 2]);
        expect(out.ownershipSplit[1]).toBeCloseTo(0.5 / 0.8, 5);
        expect(out.ownershipSplit[2]).toBeCloseTo(0.3 / 0.8, 5);
    });

    test('custom split down to one person: no split remains', () => {
        const d = { personIds: [1, 2], ownershipSplit: { 1: 0.6, 2: 0.4 } };
        const out = removePersonFromDebt(d, 2);
        expect(out.personIds).toEqual([1]);
        expect(out.ownershipSplit).toBeNull();
    });

    test('replacement person receives the removed share', () => {
        const d = { personIds: [1, 2], ownershipSplit: { 1: 0.6, 2: 0.4 } };
        const out = removePersonFromDebt(d, 2, 9);
        expect(out.personIds).toEqual([1, 9]);
        expect(out.ownershipSplit[1]).toBeCloseTo(0.6, 5);
        expect(out.ownershipSplit[9]).toBeCloseTo(0.4, 5);
    });

    test('replacement already linked gets the removed share added to its own', () => {
        const d = { personIds: [1, 2, 3], ownershipSplit: { 1: 0.5, 2: 0.3, 3: 0.2 } };
        const out = removePersonFromDebt(d, 3, 2);
        expect(out.personIds).toEqual([1, 2]);
        expect(out.ownershipSplit[1]).toBeCloseTo(0.5, 5);
        expect(out.ownershipSplit[2]).toBeCloseTo(0.5, 5);
    });

    test('replacing the sole owner leaves the replacement as sole owner with no split', () => {
        const out = removePersonFromDebt({ personIds: [1] }, 1, 4);
        expect(out.personIds).toEqual([4]);
        expect(out.ownershipSplit).toBeNull();
    });

    test('removing someone who is not linked keeps the split', () => {
        const d = { personIds: [1, 2], ownershipSplit: { 1: 0.7, 2: 0.3 } };
        const out = removePersonFromDebt(d, 5);
        expect(out.personIds).toEqual([1, 2]);
        expect(out.ownershipSplit[1]).toBeCloseTo(0.7, 5);
    });

    test('a debt with no people at all stays valid', () => {
        const out = removePersonFromDebt({}, 1);
        expect(out.personIds).toEqual([]);
        expect(out.ownershipSplit).toBeNull();
    });

    test('other debt fields are preserved', () => {
        expect(removePersonFromDebt({ id: 7, name: 'Car', personIds: [1, 2] }, 1)).toMatchObject({ id: 7, name: 'Car' });
    });
});

describe('equalPercents', () => {
    test('empty for zero or negative', () => {
        expect(equalPercents(0)).toEqual([]);
        expect(equalPercents(-1)).toEqual([]);
    });

    test('splits evenly when divisible', () => {
        expect(equalPercents(1)).toEqual([100]);
        expect(equalPercents(2)).toEqual([50, 50]);
        expect(equalPercents(4)).toEqual([25, 25, 25, 25]);
    });

    test('puts the rounding residue on the last entry so the total is exactly 100', () => {
        expect(equalPercents(3)).toEqual([33.33, 33.33, 33.34]);
        for (const n of [3, 6, 7, 9, 11]) {
            const sum = equalPercents(n).reduce((a, b) => a + b, 0);
            expect(Math.round(sum * 100) / 100).toBe(100);
        }
    });
});

describe('autoBalancePercents', () => {
    test('shares the remainder equally among the others', () => {
        expect(autoBalancePercents([1, 2, 3], 1, 40)).toEqual({ 1: 40, 2: 30, 3: 30 });
    });

    test('residue lands on the last other so the total is exactly 100', () => {
        const out = autoBalancePercents([1, 2, 3], 1, 33.33);
        expect(out[2]).toBe(33.34);
        expect(out[3]).toBe(33.33);
        expect(Math.round((out[1] + out[2] + out[3]) * 100) / 100).toBe(100);
    });

    test('clamps to 0..100 and never goes negative', () => {
        expect(autoBalancePercents([1, 2], 1, 150)).toEqual({ 1: 100, 2: 0 });
        expect(autoBalancePercents([1, 2], 1, -20)).toEqual({ 1: 0, 2: 100 });
    });

    test('non-finite input counts as 0', () => {
        expect(autoBalancePercents([1, 2], 1, NaN)).toEqual({ 1: 0, 2: 100 });
        expect(autoBalancePercents([1, 2], 1, Infinity)).toEqual({ 1: 0, 2: 100 });
    });

    test('a sole person is always 100', () => {
        expect(autoBalancePercents([1], 1, 30)).toEqual({ 1: 100 });
    });

    test('rounds the input to cents', () => {
        expect(autoBalancePercents([1, 2], 1, 33.337)).toEqual({ 1: 33.34, 2: 66.66 });
    });
});
