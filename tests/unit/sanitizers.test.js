const {
    sanitizePerson,
    sanitizeAccount,
    sanitizeDebt,
    sanitizeIncome,
    sanitizeBonus,
    sanitizeBill,
    sanitizeExpense,
    sanitizeRecurringTemplate,
    sanitizeLedgerOverrides,
    sanitizeHomePurchasePlan,
    sanitizeLedgerClearedTransactions,
    sanitizeEmergencyFund,
    sanitizeSinkingFund,
    sanitizeNetWorthSnapshot,
    sanitizeForecastSettings,
    sanitizeSetting,
    sanitizeRetirementSnapshot,
    sanitizeBalanceHistoryEntry,
    sanitizeReconciliation,
    sanitizePlanHistoryEntry,
    sanitizeParsedState,
} = require('../../src/sanitizers.js');

describe('sanitizePerson', () => {
    test('passes through a well-formed record', () => {
        const result = sanitizePerson({ id: 7, name: 'Alice' }, 1);
        expect(result).toEqual({ id: 7, name: 'Alice' });
    });

    test('applies idFallback when id is missing', () => {
        const result = sanitizePerson({ name: 'Bob' }, 99);
        expect(result.id).toBe(99);
    });

    test('strips HTML markup from name', () => {
        const result = sanitizePerson({ id: 1, name: '<script>evil</script>' }, 1);
        expect(result.name).not.toContain('<');
        expect(result.name).not.toContain('>');
    });

    test('clamps name to 80 characters', () => {
        const result = sanitizePerson({ id: 1, name: 'A'.repeat(100) }, 1);
        expect(result.name.length).toBeLessThanOrEqual(80);
    });

    test('returns empty name for missing name', () => {
        const result = sanitizePerson({ id: 1 }, 1);
        expect(result.name).toBe('');
    });

    test('handles null record gracefully', () => {
        const result = sanitizePerson(null, 5);
        expect(result.id).toBe(5);
        expect(result.name).toBe('');
    });
});

describe('sanitizeAccount', () => {
    test('passes through a well-formed record', () => {
        const result = sanitizeAccount({ id: 5, name: 'Checking', type: 'Bank', startingBalance: 100.5, interestRate: 2.5 }, 1);
        expect(result).toEqual({ id: 5, name: 'Checking', type: 'Bank', startingBalance: 100.5, interestRate: 2.5, retirementSubtype: 'Other', rateOfReturn: 0, employerMatchPercent: 0, pensionAnnualSalary: 0, pensionContributionRatePct: 0, pensionVestingYears: 0, pensionEstimatedMonthlyBenefit: 0, pensionYearsOfService: 0, minimumPayment: 0, catchUpEligible: false, hsaCoverageType: 'selfOnly', archived: false });
    });

    test('applies fallbacks for an empty record', () => {
        const result = sanitizeAccount({}, 42);
        expect(result).toEqual({ id: 42, name: '', type: 'Other', startingBalance: 0, interestRate: 0, retirementSubtype: 'Other', rateOfReturn: 0, employerMatchPercent: 0, pensionAnnualSalary: 0, pensionContributionRatePct: 0, pensionVestingYears: 0, pensionEstimatedMonthlyBenefit: 0, pensionYearsOfService: 0, minimumPayment: 0, catchUpEligible: false, hsaCoverageType: 'selfOnly', archived: false });
    });

    test('strips markup from name and clamps interestRate to 100', () => {
        const result = sanitizeAccount({ name: '<b>Evil</b>', interestRate: 500 }, 1);
        expect(result.name).toBe('bEvil/b');
        expect(result.interestRate).toBe(100);
    });

    test('adds retirement fields with defaults for a non-retirement account', () => {
        const result = sanitizeAccount({ id: 1, name: 'Checking', type: 'Checking', startingBalance: 100, interestRate: 0 }, 1);
        expect(result.retirementSubtype).toBe('Other');
        expect(result.rateOfReturn).toBe(0);
        expect(result.employerMatchPercent).toBe(0);
    });

    test('accepts a valid retirement subtype and clamps rate/match to [0,100]', () => {
        const result = sanitizeAccount({
            name: '401k', type: 'Retirement', retirementSubtype: '401k',
            rateOfReturn: 250, employerMatchPercent: -5
        }, 1);
        expect(result.retirementSubtype).toBe('401k');
        expect(result.rateOfReturn).toBe(100);
        expect(result.employerMatchPercent).toBe(0);
    });

    test('falls back an unrecognized retirementSubtype to Other', () => {
        const result = sanitizeAccount({ name: 'IRA', type: 'Retirement', retirementSubtype: 'bogus' }, 1);
        expect(result.retirementSubtype).toBe('Other');
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

    test('does not pass through unrecognized fields from the raw input (allowlist, not spread-then-override)', () => {
        const result = sanitizeDebt({ name: 'Visa', notAField: 'evil', __proto__: { polluted: true } }, 1);
        expect(result.notAField).toBeUndefined();
        expect(Object.keys(result).sort()).toEqual([
            'accountBalance', 'accountId', 'archived', 'category', 'creditLimit', 'debtStartDate', 'debtType', 'dueDate',
            'fixedAmount', 'fixedEndDate', 'fixedStartDate', 'id', 'interestRate', 'minimumPayment',
            'name', 'nextPaymentDue', 'notes', 'originalBalance', 'originalMinimumPayment', 'personIds', 'priority', 'updatedAt',
        ]);
    });

    test('passes through a valid creditLimit', () => {
        expect(sanitizeDebt({ creditLimit: 5000 }, 1).creditLimit).toBe(5000);
        expect(sanitizeDebt({ creditLimit: '2500' }, 1).creditLimit).toBe(2500);
    });

    test('returns null creditLimit when missing or non-numeric', () => {
        expect(sanitizeDebt({}, 1).creditLimit).toBeNull();
        expect(sanitizeDebt({ creditLimit: null }, 1).creditLimit).toBeNull();
        expect(sanitizeDebt({ creditLimit: 'abc' }, 1).creditLimit).toBeNull();
    });

    test('clamps negative creditLimit to 0', () => {
        expect(sanitizeDebt({ creditLimit: -1000 }, 1).creditLimit).toBe(0);
    });
});

describe('sanitizeIncome', () => {
    test('passes through a well-formed record', () => {
        const result = sanitizeIncome({ id: 1, name: 'Paycheck', amount: 2000, firstPayDate: '2026-01-02', frequency: 'monthly' }, 1);
        expect(result.frequency).toBe('monthly');
        expect(result.amount).toBe(2000);
    });

    test('falls back to monthly for an unrecognized frequency', () => {
        expect(sanitizeIncome({ frequency: 'bogus' }, 1).frequency).toBe('monthly');
    });

    test('passes through weekly frequency', () => {
        expect(sanitizeIncome({ frequency: 'weekly' }, 1).frequency).toBe('weekly');
    });

    test('passes through twice_monthly frequency', () => {
        expect(sanitizeIncome({ frequency: 'twice_monthly' }, 1).frequency).toBe('twice_monthly');
    });

    test('normalises bi-weekly to biweekly', () => {
        expect(sanitizeIncome({ frequency: 'bi-weekly' }, 1).frequency).toBe('biweekly');
    });

    test('clamps a negative amount to 0', () => {
        expect(sanitizeIncome({ amount: -100 }, 1).amount).toBe(0);
    });

    test('defaults isVariable to false when absent', () => {
        expect(sanitizeIncome({}, 1).isVariable).toBe(false);
    });

    test('preserves isVariable: true', () => {
        expect(sanitizeIncome({ isVariable: true }, 1).isVariable).toBe(true);
    });

    test('coerces truthy string to true and falsy value to false', () => {
        expect(sanitizeIncome({ isVariable: 'yes' }, 1).isVariable).toBe(true);
        expect(sanitizeIncome({ isVariable: 0 }, 1).isVariable).toBe(false);
        expect(sanitizeIncome({ isVariable: null }, 1).isVariable).toBe(false);
    });

    test('passes through a valid updatedAt (#383)', () => {
        expect(sanitizeIncome({ updatedAt: '2026-08-01' }, 1).updatedAt).toBe('2026-08-01');
    });

    test('returns null updatedAt when missing or malformed (#383)', () => {
        expect(sanitizeIncome({}, 1).updatedAt).toBeNull();
        expect(sanitizeIncome({ updatedAt: 'not-a-date' }, 1).updatedAt).toBeNull();
    });

    // #251: optional tax withholding percent, clamped [0, 99.9], default 0.
    describe('withholdingPercent (#251)', () => {
        test('defaults to 0 when absent', () => {
            expect(sanitizeIncome({}, 1).withholdingPercent).toBe(0);
        });

        test('passes through valid values: 0, 15.5, 99.9', () => {
            expect(sanitizeIncome({ withholdingPercent: 0 }, 1).withholdingPercent).toBe(0);
            expect(sanitizeIncome({ withholdingPercent: 15.5 }, 1).withholdingPercent).toBe(15.5);
            expect(sanitizeIncome({ withholdingPercent: 99.9 }, 1).withholdingPercent).toBe(99.9);
        });

        test('clamps a negative value to 0', () => {
            expect(sanitizeIncome({ withholdingPercent: -10 }, 1).withholdingPercent).toBe(0);
        });

        test('clamps a value of 100 or more to 99.9', () => {
            expect(sanitizeIncome({ withholdingPercent: 100 }, 1).withholdingPercent).toBe(99.9);
            expect(sanitizeIncome({ withholdingPercent: 250 }, 1).withholdingPercent).toBe(99.9);
        });

        test('falls back to 0 for a non-numeric value', () => {
            expect(sanitizeIncome({ withholdingPercent: 'abc' }, 1).withholdingPercent).toBe(0);
        });

        test('falls back to 0 when null or undefined', () => {
            expect(sanitizeIncome({ withholdingPercent: null }, 1).withholdingPercent).toBe(0);
            expect(sanitizeIncome({ withholdingPercent: undefined }, 1).withholdingPercent).toBe(0);
        });

        test('round-trips through a second sanitize pass unchanged (export/import)', () => {
            const once = sanitizeIncome({ name: 'Paycheck', amount: 2000, withholdingPercent: 22.5 }, 1);
            const twice = sanitizeIncome(once, 1);
            expect(twice.withholdingPercent).toBe(22.5);
        });
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

describe('sanitizeLedgerOverrides', () => {
    test('returns an empty object for null, undefined, or non-object input', () => {
        expect(sanitizeLedgerOverrides(null)).toEqual({});
        expect(sanitizeLedgerOverrides(undefined)).toEqual({});
        expect(sanitizeLedgerOverrides('not-an-object')).toEqual({});
    });

    test('passes through a well-formed entry', () => {
        const result = sanitizeLedgerOverrides({
            'bill|1|2|2026-08-01': { amount: 120.5, originalAmount: 100, transactionName: 'Electric', accountId: 2, date: '2026-08-01', updatedAt: '2026-08-01T05:00:00.000Z' },
        });
        expect(result['bill|1|2|2026-08-01']).toEqual({
            amount: 120.5, originalAmount: 100, transactionName: 'Electric', accountId: 2, date: '2026-08-01', updatedAt: '2026-08-01T05:00:00.000Z', memo: '',
        });
    });

    test('preserves a memo string present in the entry', () => {
        const result = sanitizeLedgerOverrides({
            'expense|5|3|2026-09-01': { amount: 42, memo: 'split with roommate', updatedAt: '2026-09-01T00:00:00.000Z' },
        });
        expect(result['expense|5|3|2026-09-01'].memo).toBe('split with roommate');
    });

    test('defaults memo to empty string when absent', () => {
        const result = sanitizeLedgerOverrides({ a: { amount: 50, updatedAt: '2026-08-01T05:00:00.000Z' } });
        expect(result.a.memo).toBe('');
    });

    test('truncates memo longer than 500 characters', () => {
        const longMemo = 'x'.repeat(600);
        const result = sanitizeLedgerOverrides({ a: { amount: 50, memo: longMemo, updatedAt: '2026-08-01T05:00:00.000Z' } });
        expect(result.a.memo.length).toBe(500);
        expect(result.a.memo).toBe('x'.repeat(500));
    });

    test('strips HTML-like characters from memo via normalizeText', () => {
        const result = sanitizeLedgerOverrides({ a: { amount: 50, memo: '<script>alert(1)</script>', updatedAt: '2026-08-01T05:00:00.000Z' } });
        expect(result.a.memo).not.toMatch(/[<>]/);
    });

    test('drops an entry whose amount is missing or non-finite', () => {
        const result = sanitizeLedgerOverrides({ a: { amount: 'not-a-number' }, b: {} });
        expect(result).toEqual({});
    });

    test('drops an entry keyed by an empty string', () => {
        const result = sanitizeLedgerOverrides({ '': { amount: 50 } });
        expect(result).toEqual({});
    });

    test('defaults updatedAt to the current time when missing or malformed', () => {
        const result = sanitizeLedgerOverrides({ a: { amount: 50, updatedAt: 'garbage' } });
        expect(result.a.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
});

describe('sanitizeHomePurchasePlan', () => {
    test('passes through a well-formed plan', () => {
        const result = sanitizeHomePurchasePlan({
            targetHomePrice: 400000, targetDownPaymentPct: 10, currentSavings: 15000,
            monthlyContribution: 500, housingCostEstimate: 2200, notes: 'First home'
        });
        expect(result).toEqual({
            targetHomePrice: 400000, targetDownPaymentPct: 10, currentSavings: 15000,
            monthlyContribution: 500, housingCostEstimate: 2200, notes: 'First home'
        });
    });

    test('returns null when raw input is null, undefined, or not an object', () => {
        expect(sanitizeHomePurchasePlan(null)).toBeNull();
        expect(sanitizeHomePurchasePlan(undefined)).toBeNull();
        expect(sanitizeHomePurchasePlan('nope')).toBeNull();
    });

    test('returns null when targetHomePrice is missing, zero, or negative', () => {
        expect(sanitizeHomePurchasePlan({})).toBeNull();
        expect(sanitizeHomePurchasePlan({ targetHomePrice: 0 })).toBeNull();
        expect(sanitizeHomePurchasePlan({ targetHomePrice: -50000 })).toBeNull();
    });

    test('defaults targetDownPaymentPct to 20 and clamps to 0-100', () => {
        expect(sanitizeHomePurchasePlan({ targetHomePrice: 300000 }).targetDownPaymentPct).toBe(20);
        expect(sanitizeHomePurchasePlan({ targetHomePrice: 300000, targetDownPaymentPct: -5 }).targetDownPaymentPct).toBe(0);
        expect(sanitizeHomePurchasePlan({ targetHomePrice: 300000, targetDownPaymentPct: 150 }).targetDownPaymentPct).toBe(100);
    });

    test('clamps negative currentSavings/monthlyContribution/housingCostEstimate to 0', () => {
        const result = sanitizeHomePurchasePlan({
            targetHomePrice: 300000, currentSavings: -1, monthlyContribution: -1, housingCostEstimate: -1
        });
        expect(result.currentSavings).toBe(0);
        expect(result.monthlyContribution).toBe(0);
        expect(result.housingCostEstimate).toBe(0);
    });

    test('strips HTML/script content from notes and truncates to 500 chars', () => {
        const result = sanitizeHomePurchasePlan({ targetHomePrice: 300000, notes: '<script>evil</script>' + 'x'.repeat(600) });
        expect(result.notes).not.toContain('<script>');
        expect(result.notes.length).toBeLessThanOrEqual(500);
    });

    test('defaults notes to an empty string when missing', () => {
        expect(sanitizeHomePurchasePlan({ targetHomePrice: 300000 }).notes).toBe('');
    });
});

describe('sanitizeLedgerClearedTransactions', () => {
    test('returns an empty object for null, undefined, or non-object input', () => {
        expect(sanitizeLedgerClearedTransactions(null)).toEqual({});
        expect(sanitizeLedgerClearedTransactions(undefined)).toEqual({});
        expect(sanitizeLedgerClearedTransactions('not-an-object')).toEqual({});
    });

    test('passes through a well-formed entry with a full-precision timestamp', () => {
        const result = sanitizeLedgerClearedTransactions({ 'bill|1|2|2026-08-01': { clearedAt: '2026-08-30T14:23:05.123Z' } });
        expect(result['bill|1|2|2026-08-01']).toEqual({ clearedAt: '2026-08-30T14:23:05.123Z' });
    });

    test('drops an entry whose clearedAt is missing or malformed', () => {
        const result = sanitizeLedgerClearedTransactions({ a: {}, b: { clearedAt: 'not-a-date' } });
        expect(result).toEqual({});
    });

    test('drops an entry keyed by an empty string', () => {
        const result = sanitizeLedgerClearedTransactions({ '': { clearedAt: '2026-08-30T14:23:05.123Z' } });
        expect(result).toEqual({});
    });
});

describe('sanitizeRetirementSnapshot', () => {
    test('passes through a well-formed record', () => {
        const result = sanitizeRetirementSnapshot({ id: 1, accountId: 5, date: '2026-01-01', balance: 10000, contribution: 500 }, 99);
        expect(result).toEqual({ id: 1, accountId: 5, date: '2026-01-01', balance: 10000, contribution: 500, annualSalary: null });
    });

    test('defaults date to today and numbers to 0 when missing', () => {
        const result = sanitizeRetirementSnapshot({ accountId: 5 }, 42);
        expect(result.id).toBe(42);
        expect(result.accountId).toBe(5);
        expect(result.balance).toBe(0);
        expect(result.contribution).toBe(0);
        expect(typeof result.date).toBe('string');
    });

    test('rejects a negative balance by clamping to 0', () => {
        const result = sanitizeRetirementSnapshot({ accountId: 1, date: '2026-01-01', balance: -500 }, 1);
        expect(result.balance).toBe(0);
    });
});

describe('sanitizeAccount minimumPayment', () => {
    test('defaults to 0 and clamps negatives', () => {
        expect(sanitizeAccount({ name: 'Visa', type: 'Credit Card' }, 1).minimumPayment).toBe(0);
        expect(sanitizeAccount({ name: 'Visa', minimumPayment: -5 }, 1).minimumPayment).toBe(0);
        expect(sanitizeAccount({ name: 'Visa', minimumPayment: '35.5' }, 1).minimumPayment).toBe(35.5);
    });
});

describe('sanitizeBalanceHistoryEntry', () => {
    test('valid debt entry', () => {
        expect(sanitizeBalanceHistoryEntry({ id: 3, debtId: '5', date: '2026-09-01', balance: '120.5', minimumPayment: 25 }, 9))
            .toEqual({ id: 3, debtId: 5, accountId: null, date: '2026-09-01', balance: 120.5, minimumPayment: 25 });
    });
    test('valid account entry keeps negative balance', () => {
        expect(sanitizeBalanceHistoryEntry({ accountId: 7, date: '2026-09-01', balance: -400, minimumPayment: 10 }, 9))
            .toEqual({ id: 9, debtId: null, accountId: 7, date: '2026-09-01', balance: -400, minimumPayment: 10 });
    });
    test('null/absent balance stays null (fixed amount)', () => {
        expect(sanitizeBalanceHistoryEntry({ debtId: 5, date: '2026-09-01', balance: null, minimumPayment: 800 }, 9).balance).toBeNull();
        expect(sanitizeBalanceHistoryEntry({ debtId: 5, date: '2026-09-01', minimumPayment: 800 }, 9).balance).toBeNull();
    });
    test('non-numeric balance becomes null', () => {
        expect(sanitizeBalanceHistoryEntry({ debtId: 5, date: '2026-09-01', balance: 'abc' }, 9).balance).toBeNull();
    });
    test('minimumPayment defaults to 0 and clamps negatives', () => {
        expect(sanitizeBalanceHistoryEntry({ debtId: 5, date: '2026-09-01' }, 9).minimumPayment).toBe(0);
        expect(sanitizeBalanceHistoryEntry({ debtId: 5, date: '2026-09-01', minimumPayment: -1 }, 9).minimumPayment).toBe(0);
    });
    test('rejects both owners, neither owner, and missing/invalid date', () => {
        expect(sanitizeBalanceHistoryEntry({ debtId: 5, accountId: 7, date: '2026-09-01' }, 9)).toBeNull();
        expect(sanitizeBalanceHistoryEntry({ date: '2026-09-01' }, 9)).toBeNull();
        expect(sanitizeBalanceHistoryEntry({ debtId: 5 }, 9)).toBeNull();
        expect(sanitizeBalanceHistoryEntry({ debtId: 5, date: 'not-a-date' }, 9)).toBeNull();
        expect(sanitizeBalanceHistoryEntry(null, 9)).toBeNull();
    });
});

describe('sanitizeParsedState balanceHistory', () => {
    test('keeps entries whose owner exists and drops orphans', () => {
        const state = sanitizeParsedState({
            debts: [{ id: 1, name: 'Visa' }],
            accounts: [{ id: 7, name: 'Loan', type: 'Loan' }],
            balanceHistory: [
                { id: 1, debtId: 1, date: '2026-09-01', balance: 10, minimumPayment: 1 },
                { id: 2, accountId: 7, date: '2026-09-01', balance: -10, minimumPayment: 1 },
                { id: 3, debtId: 99, date: '2026-09-01', balance: 10, minimumPayment: 1 },
                { id: 4, accountId: 98, date: '2026-09-01', balance: 10, minimumPayment: 1 },
                { id: 5, date: '2026-09-01' }
            ]
        });
        expect(state.balanceHistory.map(h => h.id)).toEqual([1, 2]);
    });
    test('missing balanceHistory yields empty array', () => {
        expect(sanitizeParsedState({}).balanceHistory).toEqual([]);
    });
});

describe('sanitizeParsedState warnings collection (issue #291)', () => {
    test('omitting warnings param leaves output and behavior unchanged', () => {
        const withoutWarnings = sanitizeParsedState({ debts: [{ name: 'Visa', minimumPayment: 'not-a-number' }] });
        expect(withoutWarnings.debts).toHaveLength(1);
        expect(withoutWarnings.debts[0].minimumPayment).toBe(0);
    });

    test('reports a coerced field with its original and new value', () => {
        const warnings = [];
        sanitizeParsedState({ debts: [{ name: 'Visa', minimumPayment: 'foo' }] }, warnings);
        const w = warnings.find(x => x.recordType === 'Debt' && x.field === 'minimumPayment');
        expect(w).toMatchObject({ recordName: 'Visa', kind: 'coerced', field: 'minimumPayment', from: 'foo', to: 0 });
    });

    test('does not warn when an optional field is simply omitted (not a coercion)', () => {
        const warnings = [];
        sanitizeParsedState({ debts: [{ name: 'Visa', accountBalance: 500 }] }, warnings);
        expect(warnings.find(x => x.field === 'originalBalance')).toBeUndefined();
    });

    test('reports a rejected record that is missing its required name field', () => {
        const warnings = [];
        sanitizeParsedState({ debts: [{ minimumPayment: 50 }] }, warnings);
        const w = warnings.find(x => x.recordType === 'Debt' && x.kind === 'rejected');
        expect(w).toBeTruthy();
        expect(w.reason).toMatch(/not imported/i);
    });

    test('labels a rejected record by position when no name is available', () => {
        const warnings = [];
        sanitizeParsedState({ debts: [{ minimumPayment: 50 }] }, warnings);
        const w = warnings.find(x => x.recordType === 'Debt' && x.kind === 'rejected');
        expect(w.recordName).toBe('Record #1');
    });

    test('does not falsely flag expenses.date as coerced when the raw date is valid', () => {
        const warnings = [];
        sanitizeParsedState({ expenses: [{ name: 'Groceries', date: '2026-05-01', budgetAmount: 100 }] }, warnings);
        expect(warnings.find(x => x.recordType === 'Expense' && x.field === 'date')).toBeUndefined();
    });

    test('reports coercion for a record type without a name field, labeled by a fallback identifier', () => {
        const warnings = [];
        sanitizeParsedState({
            accounts: [{ id: 1, name: 'Checking' }],
            emergencyFunds: [{ accountId: 1, targetAmount: 'lots' }]
        }, warnings);
        const w = warnings.find(x => x.recordType === 'Emergency Fund' && x.field === 'targetAmount');
        expect(w).toMatchObject({ recordName: 'Emergency Fund (account 1)', kind: 'coerced', from: 'lots', to: 0 });
    });

    test('reports a rejected balance history entry orphaned after debts/accounts are finalized', () => {
        const warnings = [];
        sanitizeParsedState({ balanceHistory: [{ debtId: 404, date: '2026-09-01', balance: 10 }] }, warnings);
        const w = warnings.find(x => x.recordType === 'Balance History' && x.kind === 'rejected');
        expect(w).toBeTruthy();
        expect(w.reason).toMatch(/no longer exists/i);
    });

    test('reports a rejected ledger override missing its amount', () => {
        const warnings = [];
        sanitizeParsedState({ ledgerAmountOverrides: { 'debt|1|2|2026-01-01': { memo: 'oops' } } }, warnings);
        const w = warnings.find(x => x.recordType === 'Ledger Override' && x.kind === 'rejected');
        expect(w).toBeTruthy();
    });

    test('reports plan history entries dropped by the cap is handled by dataExport.js, not here', () => {
        // sanitizeParsedState itself has no cap; dataExport.js applies PLAN_HISTORY_CAP
        // after calling it and reports its own warning there (see test_data_export.py).
        const warnings = [];
        const state = sanitizeParsedState({ planHistory: [] }, warnings);
        expect(state.planHistory).toEqual([]);
        expect(warnings).toEqual([]);
    });
});

describe('sanitizeReconciliation statement range (issue #275)', () => {
    const base = { id: 9, accountId: 7, date: '2026-09-30', previousBalance: 100, statementBalance: 120, difference: 20, note: '' };

    test('preserves valid statementStartDate/statementEndDate', () => {
        const result = sanitizeReconciliation({ ...base, statementStartDate: '2026-09-01', statementEndDate: '2026-09-30' }, 1);
        expect(result.statementStartDate).toBe('2026-09-01');
        expect(result.statementEndDate).toBe('2026-09-30');
    });

    test('legacy records without range fields get null (not today)', () => {
        const result = sanitizeReconciliation(base, 1);
        expect(result.statementStartDate).toBeNull();
        expect(result.statementEndDate).toBeNull();
    });

    test('malformed range dates are dropped to null', () => {
        const result = sanitizeReconciliation({ ...base, statementStartDate: '<script>', statementEndDate: '2026-13-45' }, 1);
        expect(result.statementStartDate).toBeNull();
        expect(result.statementEndDate).toBeNull();
    });

    test('heals full ISO timestamps to YYYY-MM-DD', () => {
        const result = sanitizeReconciliation({ ...base, statementStartDate: '2026-09-01T05:00:00.000Z', statementEndDate: '2026-09-30T05:00:00.000Z' }, 1);
        expect(result.statementStartDate).toBe('2026-09-01');
        expect(result.statementEndDate).toBe('2026-09-30');
    });

    test('an end date before the start date drops the start date', () => {
        const result = sanitizeReconciliation({ ...base, statementStartDate: '2026-10-05', statementEndDate: '2026-09-30' }, 1);
        expect(result.statementStartDate).toBeNull();
        expect(result.statementEndDate).toBe('2026-09-30');
    });
});

describe('sanitizeBonus', () => {
    test('passes through a well-formed record', () => {
        const result = sanitizeBonus({ id: 3, name: 'Q4 Bonus', amount: 2500, date: '2026-12-01', category: 'Work', accountId: 7, purpose: 'cashFlow' }, 1);
        expect(result).toEqual({ id: 3, name: 'Q4 Bonus', amount: 2500, date: '2026-12-01', category: 'Work', accountId: 7, purpose: 'cashFlow' });
    });

    test('applies idFallback and defaults for an empty record', () => {
        const result = sanitizeBonus({}, 42);
        expect(result.id).toBe(42);
        expect(result.amount).toBe(0);
        expect(result.category).toBe('Other');
        expect(result.accountId).toBeNull();
        expect(result.purpose).toBeNull();
    });

    test('clamps negative amount to 0', () => {
        expect(sanitizeBonus({ amount: -500 }, 1).amount).toBe(0);
    });

    test('passes through savings purpose', () => {
        expect(sanitizeBonus({ purpose: 'savings' }, 1).purpose).toBe('savings');
    });

    test('drops unrecognized purpose to null', () => {
        expect(sanitizeBonus({ purpose: 'bogus' }, 1).purpose).toBeNull();
        expect(sanitizeBonus({ purpose: null }, 1).purpose).toBeNull();
    });

    test('returns null date for a malformed date', () => {
        expect(sanitizeBonus({ date: 'not-a-date' }, 1).date).toBeNull();
    });

    test('handles null record gracefully', () => {
        const result = sanitizeBonus(null, 99);
        expect(result.id).toBe(99);
        expect(result.purpose).toBeNull();
    });
});

describe('sanitizeEmergencyFund', () => {
    test('passes through a well-formed record', () => {
        const result = sanitizeEmergencyFund({ id: 1, accountId: 5, targetAmount: 5000, currentAmount: 1500, monthlyContribution: 250, autoContribute: true, autoSyncBalance: true, notes: 'Safety net' }, 99);
        expect(result).toEqual({ id: 1, accountId: 5, targetAmount: 5000, currentAmount: 1500, monthlyContribution: 250, autoContribute: true, autoSyncBalance: true, notes: 'Safety net' });
    });

    test('applies defaults for an empty record', () => {
        const result = sanitizeEmergencyFund({}, 10);
        expect(result.id).toBe(10);
        expect(result.accountId).toBeNull();
        expect(result.targetAmount).toBe(0);
        expect(result.currentAmount).toBe(0);
        expect(result.monthlyContribution).toBe(0);
        expect(result.autoContribute).toBe(false);
        expect(result.notes).toBe('');
    });

    test('clamps negative amounts to 0', () => {
        const result = sanitizeEmergencyFund({ targetAmount: -100, currentAmount: -50, monthlyContribution: -25 }, 1);
        expect(result.targetAmount).toBe(0);
        expect(result.currentAmount).toBe(0);
        expect(result.monthlyContribution).toBe(0);
    });

    test('coerces truthy/falsy to boolean for autoContribute', () => {
        expect(sanitizeEmergencyFund({ autoContribute: 1 }, 1).autoContribute).toBe(true);
        expect(sanitizeEmergencyFund({ autoContribute: 0 }, 1).autoContribute).toBe(false);
        expect(sanitizeEmergencyFund({ autoContribute: null }, 1).autoContribute).toBe(false);
    });
});

describe('sanitizeSinkingFund', () => {
    test('passes through a well-formed record', () => {
        const result = sanitizeSinkingFund({ id: 2, name: 'Vacation', allocationMethod: 'target_date', monthlyAllocation: 100, targetAmount: 1200, currentAmount: 300, autoContribute: true, accountId: 5, notes: 'Summer trip' }, 1);
        expect(result.allocationMethod).toBe('target_date');
        expect(result.name).toBe('Vacation');
        expect(result.monthlyAllocation).toBe(100);
    });

    test('passes through each valid allocationMethod', () => {
        expect(sanitizeSinkingFund({ allocationMethod: 'fixed' }, 1).allocationMethod).toBe('fixed');
        expect(sanitizeSinkingFund({ allocationMethod: 'annual' }, 1).allocationMethod).toBe('annual');
        expect(sanitizeSinkingFund({ allocationMethod: 'target_date' }, 1).allocationMethod).toBe('target_date');
    });

    test('falls back to fixed for an unrecognized allocationMethod', () => {
        expect(sanitizeSinkingFund({ allocationMethod: 'bogus' }, 1).allocationMethod).toBe('fixed');
        expect(sanitizeSinkingFund({}, 1).allocationMethod).toBe('fixed');
    });

    test('applies defaults for an empty record', () => {
        const result = sanitizeSinkingFund({}, 7);
        expect(result.id).toBe(7);
        expect(result.monthlyAllocation).toBe(0);
        expect(result.targetAmount).toBe(0);
        expect(result.currentAmount).toBe(0);
        expect(result.accountId).toBeNull();
        expect(result.autoContribute).toBe(false);
    });

    test('clamps negative numeric fields to 0', () => {
        const result = sanitizeSinkingFund({ monthlyAllocation: -50, targetAmount: -200, currentAmount: -10 }, 1);
        expect(result.monthlyAllocation).toBe(0);
        expect(result.targetAmount).toBe(0);
        expect(result.currentAmount).toBe(0);
    });
});

describe('sanitizeNetWorthSnapshot', () => {
    test('passes through a well-formed record', () => {
        const result = sanitizeNetWorthSnapshot({ date: '2026-09-30', totalAssets: 50000, totalLiabilities: 20000, netWorth: 30000, debtPaymentMade: 500, incomeReceived: 4000, source: 'auto' });
        expect(result).toEqual({ date: '2026-09-30', totalAssets: 50000, totalLiabilities: 20000, netWorth: 30000, debtPaymentMade: 500, incomeReceived: 4000, source: 'auto' });
    });

    test('returns null when date is missing or malformed', () => {
        expect(sanitizeNetWorthSnapshot({})).toBeNull();
        expect(sanitizeNetWorthSnapshot({ date: 'not-a-date' })).toBeNull();
        expect(sanitizeNetWorthSnapshot(null)).toBeNull();
    });

    test('defaults netWorth to totalAssets - totalLiabilities when missing', () => {
        const result = sanitizeNetWorthSnapshot({ date: '2026-09-30', totalAssets: 50000, totalLiabilities: 20000 });
        expect(result.netWorth).toBe(30000);
    });

    test('passes through manual source and defaults unknown source to auto', () => {
        expect(sanitizeNetWorthSnapshot({ date: '2026-09-30', source: 'manual' }).source).toBe('manual');
        expect(sanitizeNetWorthSnapshot({ date: '2026-09-30', source: 'bogus' }).source).toBe('auto');
        expect(sanitizeNetWorthSnapshot({ date: '2026-09-30' }).source).toBe('auto');
    });

    test('defaults numeric fields to 0', () => {
        const result = sanitizeNetWorthSnapshot({ date: '2026-09-30' });
        expect(result.totalAssets).toBe(0);
        expect(result.totalLiabilities).toBe(0);
        expect(result.debtPaymentMade).toBe(0);
        expect(result.incomeReceived).toBe(0);
    });
});

describe('sanitizeForecastSettings', () => {
    test('passes through a valid record', () => {
        const result = sanitizeForecastSettings({ rangeMonths: 6, accountId: 'total', notableThresholdPct: 150 });
        expect(result).toEqual({ rangeMonths: 6, accountId: 'total', notableThresholdPct: 150 });
    });

    test('passes through each valid rangeMonths value', () => {
        for (const v of [1, 2, 3, 6, 12]) {
            expect(sanitizeForecastSettings({ rangeMonths: v }).rangeMonths).toBe(v);
        }
    });

    test('falls back to 1 for an invalid rangeMonths value', () => {
        expect(sanitizeForecastSettings({ rangeMonths: 4 }).rangeMonths).toBe(1);
        expect(sanitizeForecastSettings({ rangeMonths: 0 }).rangeMonths).toBe(1);
        expect(sanitizeForecastSettings({}).rangeMonths).toBe(1);
    });

    test('defaults accountId to total when missing or empty', () => {
        expect(sanitizeForecastSettings({}).accountId).toBe('total');
        expect(sanitizeForecastSettings({ accountId: '' }).accountId).toBe('total');
        expect(sanitizeForecastSettings({ accountId: 'total' }).accountId).toBe('total');
    });

    test('clamps notableThresholdPct to [100, 500] and defaults to 130', () => {
        expect(sanitizeForecastSettings({ notableThresholdPct: 50 }).notableThresholdPct).toBe(100);
        expect(sanitizeForecastSettings({ notableThresholdPct: 600 }).notableThresholdPct).toBe(500);
        expect(sanitizeForecastSettings({}).notableThresholdPct).toBe(130);
    });

    test('defaults all fields for a null/empty record', () => {
        const result = sanitizeForecastSettings(null);
        expect(result.rangeMonths).toBe(1);
        expect(result.accountId).toBe('total');
        expect(result.notableThresholdPct).toBe(130);
    });
});

describe('sanitizeSetting', () => {
    test('passes through a valid boolean value', () => {
        expect(sanitizeSetting({ key: 'showArchived', value: true })).toEqual({ key: 'showArchived', value: true });
        expect(sanitizeSetting({ key: 'showArchived', value: false })).toEqual({ key: 'showArchived', value: false });
    });

    test('passes through a valid number value', () => {
        expect(sanitizeSetting({ key: 'pageSize', value: 25 })).toEqual({ key: 'pageSize', value: 25 });
    });

    test('passes through a valid string value (normalized)', () => {
        expect(sanitizeSetting({ key: 'theme', value: 'dark' })).toEqual({ key: 'theme', value: 'dark' });
    });

    test('returns null when key is missing or empty', () => {
        expect(sanitizeSetting({ value: true })).toBeNull();
        expect(sanitizeSetting({ key: '', value: true })).toBeNull();
        expect(sanitizeSetting({})).toBeNull();
    });

    test('returns null for array, object, null, or undefined value', () => {
        expect(sanitizeSetting({ key: 'x', value: [] })).toBeNull();
        expect(sanitizeSetting({ key: 'x', value: {} })).toBeNull();
        expect(sanitizeSetting({ key: 'x', value: null })).toBeNull();
        expect(sanitizeSetting({ key: 'x', value: undefined })).toBeNull();
    });

    test('strips HTML markup from key', () => {
        const result = sanitizeSetting({ key: '<script>evil</script>', value: 'x' });
        expect(result.key).not.toContain('<');
    });

    test('handles null record gracefully', () => {
        expect(sanitizeSetting(null)).toBeNull();
    });
});

describe('sanitizePlanHistoryEntry', () => {
    test('passes through a well-formed record', () => {
        const result = sanitizePlanHistoryEntry({ id: 1, monthlyPayment: 300, strategy: 'avalanche', totalInterest: 1500, monthsToPayOff: 24, payoffDate: '2028-10-01', totalDebt: 7200, createdAt: '2026-10-01T12:00:00.000Z' }, 99);
        expect(result).toEqual({ id: 1, monthlyPayment: 300, strategy: 'avalanche', totalInterest: 1500, monthsToPayOff: 24, payoffDate: '2028-10-01', totalDebt: 7200, createdAt: '2026-10-01T12:00:00.000Z' });
    });

    test('applies defaults for an empty record', () => {
        const result = sanitizePlanHistoryEntry({}, 5);
        expect(result.id).toBe(5);
        expect(result.monthlyPayment).toBe(0);
        expect(result.strategy).toBeNull();
        expect(result.totalInterest).toBe(0);
        expect(result.monthsToPayOff).toBe(0);
        expect(result.payoffDate).toBeNull();
        expect(result.totalDebt).toBe(0);
        expect(typeof result.createdAt).toBe('string');
    });

    test('returns null strategy when missing or empty', () => {
        expect(sanitizePlanHistoryEntry({ strategy: '' }, 1).strategy).toBeNull();
        expect(sanitizePlanHistoryEntry({}, 1).strategy).toBeNull();
    });

    test('clamps negative numeric fields to 0', () => {
        const result = sanitizePlanHistoryEntry({ monthlyPayment: -100, totalInterest: -50, monthsToPayOff: -5, totalDebt: -200 }, 1);
        expect(result.monthlyPayment).toBe(0);
        expect(result.totalInterest).toBe(0);
        expect(result.monthsToPayOff).toBe(0);
        expect(result.totalDebt).toBe(0);
    });

    test('defaults createdAt to current ISO timestamp when missing', () => {
        const before = Date.now();
        const result = sanitizePlanHistoryEntry({}, 1);
        const after = Date.now();
        const ts = new Date(result.createdAt).getTime();
        expect(ts).toBeGreaterThanOrEqual(before);
        expect(ts).toBeLessThanOrEqual(after);
    });

    test('defaults createdAt when the value is not a parseable date string', () => {
        const result = sanitizePlanHistoryEntry({ createdAt: 'garbage' }, 1);
        expect(new Date(result.createdAt).getTime()).not.toBeNaN();
    });

    test('sanitizes payoffDate to YYYY-MM-DD or null', () => {
        expect(sanitizePlanHistoryEntry({ payoffDate: '2028-06-15' }, 1).payoffDate).toBe('2028-06-15');
        expect(sanitizePlanHistoryEntry({ payoffDate: 'bad' }, 1).payoffDate).toBeNull();
    });
});
