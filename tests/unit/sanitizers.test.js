const {
    sanitizeAccount,
    sanitizeDebt,
    sanitizeIncome,
    sanitizeBill,
    sanitizeExpense,
    sanitizeRecurringTemplate,
} = require('../../src/sanitizers.js');

describe('sanitizeAccount', () => {
    test('passes through a well-formed record', () => {
        const result = sanitizeAccount({ id: 5, name: 'Checking', type: 'Bank', startingBalance: 100.5, interestRate: 2.5 }, 1);
        expect(result).toEqual({ id: 5, name: 'Checking', type: 'Bank', startingBalance: 100.5, interestRate: 2.5 });
    });

    test('applies fallbacks for an empty record', () => {
        const result = sanitizeAccount({}, 42);
        expect(result).toEqual({ id: 42, name: '', type: 'Other', startingBalance: 0, interestRate: 0 });
    });

    test('strips markup from name and clamps interestRate to 100', () => {
        const result = sanitizeAccount({ name: '<b>Evil</b>', interestRate: 500 }, 1);
        expect(result.name).toBe('bEvil/b');
        expect(result.interestRate).toBe(100);
    });
});

describe('sanitizeDebt', () => {
    test('passes through a well-formed creditCard record', () => {
        const result = sanitizeDebt({
            id: 1, name: 'Visa', category: 'Credit Card', debtType: 'creditCard',
            priority: 3, accountBalance: 1500, interestRate: 19.99, minimumPayment: 50, dueDate: 15,
        }, 99);
        expect(result.debtType).toBe('creditCard');
        expect(result.accountBalance).toBe(1500);
        expect(result.priority).toBe(3);
        expect(result.dueDate).toBe(15);
    });

    test('falls back to creditCard for an unrecognized debtType', () => {
        expect(sanitizeDebt({ debtType: 'bogus' }, 1).debtType).toBe('creditCard');
    });

    test('clamps negative accountBalance to 0 and out-of-range dueDate to 31', () => {
        const result = sanitizeDebt({ accountBalance: -500, dueDate: 99 }, 1);
        expect(result.accountBalance).toBe(0);
        expect(result.dueDate).toBe(31);
    });

    test('returns null debtStartDate for a malformed date', () => {
        expect(sanitizeDebt({ debtStartDate: 'garbage' }, 1).debtStartDate).toBeNull();
    });

    test('passes through a valid updatedAt date unchanged', () => {
        expect(sanitizeDebt({ updatedAt: '2026-08-01' }, 1).updatedAt).toBe('2026-08-01');
    });

    test('returns null updatedAt when missing or malformed', () => {
        expect(sanitizeDebt({}, 1).updatedAt).toBeNull();
        expect(sanitizeDebt({ updatedAt: 'not-a-date' }, 1).updatedAt).toBeNull();
    });
});

describe('sanitizeIncome', () => {
    test('passes through a well-formed record', () => {
        const result = sanitizeIncome({ id: 1, name: 'Paycheck', amount: 2000, firstPayDate: '2026-01-02', frequency: 'monthly' }, 1);
        expect(result.frequency).toBe('monthly');
        expect(result.amount).toBe(2000);
    });

    test('falls back to biweekly for an unrecognized frequency', () => {
        expect(sanitizeIncome({ frequency: 'weekly' }, 1).frequency).toBe('biweekly');
    });

    test('clamps a negative amount to 0', () => {
        expect(sanitizeIncome({ amount: -100 }, 1).amount).toBe(0);
    });
});

describe('sanitizeBill', () => {
    test('passes through a well-formed record', () => {
        const result = sanitizeBill({ id: 1, name: 'Electric', amount: 120, dueDay: 10, category: 'Utilities' }, 1);
        expect(result).toMatchObject({ name: 'Electric', amount: 120, dueDay: 10, category: 'Utilities' });
    });

    test('clamps dueDay to [1, 31] and falls back category to Other', () => {
        const result = sanitizeBill({ dueDay: 99 }, 1);
        expect(result.dueDay).toBe(31);
        expect(result.category).toBe('Other');
    });
});

describe('sanitizeExpense', () => {
    test('converts a valid date string to a Date at midnight', () => {
        const result = sanitizeExpense({ date: '2026-08-02', name: 'Groceries', budgetAmount: 50 }, 1);
        expect(result.date).toBeInstanceOf(Date);
        expect(result.date.getFullYear()).toBe(2026);
        expect(result.date.getMonth()).toBe(7);
        expect(result.date.getDate()).toBe(2);
    });

    test('returns null date for a malformed date string', () => {
        expect(sanitizeExpense({ date: 'bad-date' }, 1).date).toBeNull();
    });
});

describe('sanitizeRecurringTemplate', () => {
    test('falls back frequency to monthly and type to subscription for unrecognized values', () => {
        const result = sanitizeRecurringTemplate({ frequency: 'bogus', type: 'bogus' }, 1);
        expect(result.frequency).toBe('monthly');
        expect(result.type).toBe('subscription');
    });

    test('filters skippedMonths to YYYY-MM-shaped strings only (does not validate calendar range)', () => {
        const result = sanitizeRecurringTemplate({ skippedMonths: ['2026-08', 'bad-format', '2026-13'] }, 1);
        expect(result.skippedMonths).toEqual(['2026-08', '2026-13']);
    });
});
