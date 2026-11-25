// #548: sanitizeTransfer and sanitizeBudgetCategories had no unit tests and
// were outside the Stryker scope. Positive and negative cases for both.
const {
    sanitizeTransfer, isValidTransfer, sanitizeBudgetCategories,
    BUDGET_CATEGORY_MAX_ENTRIES, BUDGET_CATEGORY_MAX_AMOUNT,
} = require('../../src/sanitizers.js');

describe('sanitizeTransfer', () => {
    test('keeps a valid transfer exactly', () => {
        const t = sanitizeTransfer({
            id: '7', fromAccountId: '1', toAccountId: 2, amount: '125.50', date: '2026-03-04',
            memo: '  Rent share  ', createdAt: '2026-03-01T10:00:00.000Z',
        }, 99);
        expect(t).toEqual({
            id: 7, fromAccountId: 1, toAccountId: 2, amount: 125.5, date: '2026-03-04',
            memo: 'Rent share', createdAt: '2026-03-01T10:00:00.000Z',
        });
        expect(isValidTransfer(t)).toBe(true);
    });

    test('falls back to idFallback and nulls for missing ids', () => {
        const t = sanitizeTransfer({ amount: 5, date: '2026-01-01' }, 42);
        expect(t.id).toBe(42);
        expect(t.fromAccountId).toBeNull();
        expect(t.toAccountId).toBeNull();
        expect(isValidTransfer(t)).toBe(false);
    });

    test('never clamps a bad amount into a valid one', () => {
        for (const amount of [-5, 0, 'abc', null, undefined, Infinity]) {
            const t = sanitizeTransfer({ fromAccountId: 1, toAccountId: 2, amount, date: '2026-01-01' }, 1);
            expect(isValidTransfer(t)).toBe(false);
        }
        expect(Number.isNaN(sanitizeTransfer({ amount: 'abc' }, 1).amount)).toBe(true);
        expect(sanitizeTransfer({ amount: -5 }, 1).amount).toBe(-5);
        expect(sanitizeTransfer({ amount: 0 }, 1).amount).toBe(0);
    });

    test('an invalid date becomes today; a valid one is kept', () => {
        const today = new Date();
        const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        expect(sanitizeTransfer({ date: 'not a date' }, 1).date).toBe(iso);
        expect(sanitizeTransfer({}, 1).date).toBe(iso);
        expect(sanitizeTransfer({ date: '2025-12-31' }, 1).date).toBe('2025-12-31');
    });

    test('createdAt keeps a parseable string and replaces anything else', () => {
        const before = Date.now();
        for (const createdAt of [undefined, 'garbage', 12345, null]) {
            const out = sanitizeTransfer({ createdAt }, 1).createdAt;
            expect(typeof out).toBe('string');
            expect(new Date(out).getTime()).toBeGreaterThanOrEqual(before - 1000);
        }
        expect(sanitizeTransfer({ createdAt: '2020-01-01' }, 1).createdAt).toBe('2020-01-01');
    });

    test('memo strips markup characters and is capped at 200', () => {
        expect(sanitizeTransfer({ memo: '<b>"hi"</b>' }, 1).memo).toBe('bhi/b');
        expect(sanitizeTransfer({ memo: 'x'.repeat(250) }, 1).memo).toHaveLength(200);
        expect(sanitizeTransfer({}, 1).memo).toBe('');
    });

    test('tolerates a null or non-object record', () => {
        for (const record of [null, undefined, 'x', 5]) {
            const t = sanitizeTransfer(record, 3);
            expect(t.id).toBe(3);
            expect(isValidTransfer(t)).toBe(false);
        }
    });

    test('isValidTransfer rejects same-account, too-large and missing records', () => {
        const base = { fromAccountId: 1, toAccountId: 2, amount: 10 };
        expect(isValidTransfer(base)).toBe(true);
        expect(isValidTransfer({ ...base, toAccountId: 1 })).toBe(false);
        expect(isValidTransfer({ ...base, amount: 1e9 })).toBe(true);
        expect(isValidTransfer({ ...base, amount: 1e9 + 1 })).toBe(false);
        expect(isValidTransfer({ ...base, fromAccountId: null })).toBe(false);
        expect(isValidTransfer(null)).toBe(false);
    });
});

describe('sanitizeBudgetCategories', () => {
    test('keeps fixed and derived entries', () => {
        expect(sanitizeBudgetCategories({
            Groceries: { mode: 'fixed', amount: 400 },
            Dining: { mode: 'fixed', amount: '125.5' },
            Fuel: { mode: 'derived', amount: 999 },
        })).toEqual({
            Groceries: { mode: 'fixed', amount: 400 },
            Dining: { mode: 'fixed', amount: 125.5 },
            Fuel: { mode: 'derived', amount: 0 },
        });
    });

    test('fixed $0 is allowed; amounts are capped', () => {
        expect(sanitizeBudgetCategories({ A: { mode: 'fixed', amount: 0 } })).toEqual({ A: { mode: 'fixed', amount: 0 } });
        expect(sanitizeBudgetCategories({ A: { mode: 'fixed', amount: 5e12 } }).A.amount).toBe(BUDGET_CATEGORY_MAX_AMOUNT);
    });

    test('non-object input returns an empty object', () => {
        for (const raw of [null, undefined, 'x', 5, [], [{ mode: 'fixed', amount: 1 }]]) {
            expect(sanitizeBudgetCategories(raw)).toEqual({});
        }
    });

    test('prototype-polluting keys are dropped and never reach the prototype', () => {
        const raw = JSON.parse('{"__proto__": {"mode": "fixed", "amount": 1}, "constructor": {"mode": "fixed", "amount": 2}, "prototype": {"mode": "derived"}, "Rent": {"mode": "fixed", "amount": 3}}');
        const warnings = [];
        const out = sanitizeBudgetCategories(raw, warnings);
        expect(Object.keys(out)).toEqual(['Rent']);
        expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
        expect(({}).mode).toBeUndefined();
        expect(warnings.map(w => w.recordName)).toEqual(['__proto__', 'constructor', 'prototype']);
        expect(warnings.every(w => w.kind === 'rejected' && w.recordType === 'Category Budget')).toBe(true);
    });

    test('a key that normalizes to a forbidden or blank name is dropped', () => {
        const warnings = [];
        expect(sanitizeBudgetCategories({ '<__proto__>': { mode: 'derived' }, '   ': { mode: 'derived' } }, warnings)).toEqual({});
        expect(warnings).toHaveLength(2);
        expect(warnings[1].recordName).toBe('   ');
        expect(sanitizeBudgetCategories({ '': { mode: 'derived' } }, (warnings.length = 0, warnings))).toEqual({});
        expect(warnings[0].recordName).toBe('(blank)');
    });

    test('names are normalized and capped at 40 characters; normalized duplicates merge', () => {
        const long = 'x'.repeat(60);
        const out = sanitizeBudgetCategories({ [long]: { mode: 'derived' }, ' Food ': { mode: 'fixed', amount: 1 }, Food: { mode: 'fixed', amount: 2 } });
        expect(Object.keys(out).sort()).toEqual(['Food', 'x'.repeat(40)]);
        expect(out.Food.amount).toBe(2);
    });

    test('unknown modes and bad fixed amounts are rejected, not coerced to $0', () => {
        const warnings = [];
        const out = sanitizeBudgetCategories({
            A: { mode: 'weekly', amount: 5 },
            B: null,
            C: 'fixed',
            D: { mode: 'fixed', amount: -1 },
            E: { mode: 'fixed', amount: 'abc' },
            F: { mode: 'fixed', amount: '' },
            G: { mode: 'fixed', amount: '   ' },
            H: { mode: 'fixed' },
            I: { mode: 'fixed', amount: true },
            J: { mode: 'fixed', amount: Infinity },
        }, warnings);
        expect(out).toEqual({});
        expect(warnings.map(w => w.recordName)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
        expect(warnings[0].reason).toMatch(/Unknown budget mode/);
        expect(warnings[3].reason).toMatch(/negative or non-numeric/);
    });

    test('stops at the entry cap with a warning, but a repeated name does not count twice', () => {
        const raw = {};
        for (let i = 0; i < BUDGET_CATEGORY_MAX_ENTRIES + 2; i++) raw[`C${i}`] = { mode: 'derived' };
        const warnings = [];
        const out = sanitizeBudgetCategories(raw, warnings);
        expect(Object.keys(out)).toHaveLength(BUDGET_CATEGORY_MAX_ENTRIES);
        expect(warnings).toHaveLength(2);
        expect(warnings[0].reason).toMatch(new RegExp(`max ${BUDGET_CATEGORY_MAX_ENTRIES}`));

        const atCap = {};
        for (let i = 0; i < BUDGET_CATEGORY_MAX_ENTRIES; i++) atCap[`C${i}`] = { mode: 'derived' };
        atCap[' C0 '] = { mode: 'fixed', amount: 9 };
        const merged = sanitizeBudgetCategories(atCap);
        expect(Object.keys(merged)).toHaveLength(BUDGET_CATEGORY_MAX_ENTRIES);
        expect(merged.C0).toEqual({ mode: 'fixed', amount: 9 });
    });

    test('works without a warnings array', () => {
        expect(() => sanitizeBudgetCategories({ A: { mode: 'bad' } })).not.toThrow();
    });
});

describe('sanitizeBudgetCategories rollover (#687)', () => {
    test('keeps a valid rollover pair on fixed and derived entries', () => {
        expect(sanitizeBudgetCategories({
            A: { mode: 'fixed', amount: 100, rollover: 'both', rolloverStart: '2026-11' },
            B: { mode: 'derived', rollover: 'overspend', rolloverStart: '2025-01' },
        })).toEqual({
            A: { mode: 'fixed', amount: 100, rollover: 'both', rolloverStart: '2026-11' },
            B: { mode: 'derived', amount: 0, rollover: 'overspend', rolloverStart: '2025-01' },
        });
    });

    test('an entry without rollover is unchanged and warns about nothing', () => {
        const warnings = [];
        expect(sanitizeBudgetCategories({ A: { mode: 'fixed', amount: 5 } }, warnings)).toEqual({ A: { mode: 'fixed', amount: 5 } });
        expect(warnings).toEqual([]);
    });

    test('an invalid or incomplete rollover is dropped with a warning and the budget is kept', () => {
        const bad = [
            { rollover: 'sideways', rolloverStart: '2026-11' },
            { rollover: 'both' },
            { rolloverStart: '2026-11' },
            { rollover: 'both', rolloverStart: '2026-13' },
            { rollover: 'both', rolloverStart: '2026-1' },
            { rollover: 'both', rolloverStart: 202611 },
            { rollover: null, rolloverStart: '2026-11' },
            { rollover: '', rolloverStart: '' },
        ];
        for (const extra of bad) {
            const warnings = [];
            const out = sanitizeBudgetCategories({ A: { mode: 'fixed', amount: 7, ...extra } }, warnings);
            expect(out).toEqual({ A: { mode: 'fixed', amount: 7 } });
            expect(warnings).toHaveLength(1);
            expect(warnings[0]).toMatchObject({ recordType: 'Category Budget', recordName: 'A', kind: 'rejected' });
        }
    });

    test('rollover on an invalid budget is not resurrected', () => {
        expect(sanitizeBudgetCategories({ A: { mode: 'fixed', amount: -1, rollover: 'both', rolloverStart: '2026-11' } })).toEqual({});
    });
});
