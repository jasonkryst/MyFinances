const {
    formatCurrency,
    normalizeText,
    normalizeMultilineText,
    sanitizeFiniteNumber,
    sanitizeInteger,
    parseFiniteOrNull,
    sanitizeDateISO,
    dateToISO,
    formatShortDate,
    formatMonthYear,
    dailyCompoundInterest,
    computeNetIncomeAmount,
    computeMonthlyIncomeForMonth,
    computeMonthlyBonusesForMonth,
    getBonusDatesInMonth,
    getNextBonusDate,
    getBonusesByDayForMonth,
} = require('../../src/utils.js');

describe('formatCurrency', () => {
    test('formats a positive amount as USD', () => {
        expect(formatCurrency(1234.5)).toBe('$1,234.50');
    });

    test('formats zero', () => {
        expect(formatCurrency(0)).toBe('$0.00');
    });
});

describe('normalizeText', () => {
    test('trims surrounding whitespace', () => {
        expect(normalizeText('  Hello World  ')).toBe('Hello World');
    });

    test('truncates to maxLen', () => {
        expect(normalizeText('a'.repeat(200), 120)).toHaveLength(120);
    });

    test('strips <, >, ", ` but does not remove tag contents', () => {
        expect(normalizeText('<script>alert(1)</script>')).toBe('scriptalert(1)/script');
    });

    test('returns empty string for null/undefined', () => {
        expect(normalizeText(null)).toBe('');
        expect(normalizeText(undefined)).toBe('');
    });

    test('coerces non-string values via String()', () => {
        expect(normalizeText(123)).toBe('123');
    });
});

describe('sanitizeFiniteNumber', () => {
    test('parses a numeric string', () => {
        expect(sanitizeFiniteNumber('42.5')).toBe(42.5);
    });

    test('falls back on non-numeric input', () => {
        expect(sanitizeFiniteNumber('abc', 99)).toBe(99);
    });

    test('falls back on NaN and Infinity', () => {
        expect(sanitizeFiniteNumber(NaN, -1)).toBe(-1);
        expect(sanitizeFiniteNumber(Infinity, 7)).toBe(7);
    });

    test('clamps to min/max', () => {
        expect(sanitizeFiniteNumber(-5, 0, { min: 0 })).toBe(0);
        expect(sanitizeFiniteNumber(500, 0, { max: 100 })).toBe(100);
    });

    test('returns fallback for null, undefined, and empty string', () => {
        expect(sanitizeFiniteNumber(null, null)).toBeNull();
        expect(sanitizeFiniteNumber(undefined, null)).toBeNull();
        expect(sanitizeFiniteNumber('', null)).toBeNull();
        expect(sanitizeFiniteNumber(null, 0)).toBe(0);
        expect(sanitizeFiniteNumber(null, 42)).toBe(42);
        expect(sanitizeFiniteNumber('', 10)).toBe(10);
    });
});

describe('sanitizeInteger', () => {
    test('parses an integer string', () => {
        expect(sanitizeInteger('42')).toBe(42);
    });

    test('truncates a float', () => {
        expect(sanitizeInteger(3.9)).toBe(3);
    });

    test('falls back on non-numeric input', () => {
        expect(sanitizeInteger('abc', null)).toBeNull();
        expect(sanitizeInteger(NaN, -1)).toBe(-1);
    });

    test('clamps to min/max', () => {
        expect(sanitizeInteger(500, null, { max: 100 })).toBe(100);
        expect(sanitizeInteger(-5, null, { min: 0 })).toBe(0);
    });
});

describe('parseFiniteOrNull', () => {
    test('parses a numeric string', () => {
        expect(parseFiniteOrNull('42')).toBe(42);
    });

    test('returns null for non-numeric or infinite input', () => {
        expect(parseFiniteOrNull('abc')).toBeNull();
        expect(parseFiniteOrNull(Infinity)).toBeNull();
        expect(parseFiniteOrNull(undefined)).toBeNull();
    });
});

describe('sanitizeDateISO', () => {
    test('accepts a well-formed YYYY-MM-DD string', () => {
        expect(sanitizeDateISO('2026-08-02')).toBe('2026-08-02');
    });

    test('returns null for empty/falsy input', () => {
        expect(sanitizeDateISO('')).toBeNull();
        expect(sanitizeDateISO(null)).toBeNull();
    });

    test('returns null for a non-ISO format', () => {
        expect(sanitizeDateISO('08/02/2026')).toBeNull();
        expect(sanitizeDateISO('not-a-date')).toBeNull();
    });
});

describe('dateToISO', () => {
    test('zero-pads single-digit month and day', () => {
        expect(dateToISO(new Date(2026, 0, 5))).toBe('2026-01-05');
    });

    test('formats a double-digit month and day', () => {
        expect(dateToISO(new Date(2026, 7, 2))).toBe('2026-08-02');
    });
});

describe('formatShortDate / formatMonthYear', () => {
    test('formatShortDate formats a bare ISO date', () => {
        expect(formatShortDate('2026-08-02')).toBe('Aug 2, 2026');
    });

    test('formatMonthYear formats a bare ISO date', () => {
        expect(formatMonthYear('2026-08-02')).toBe('Aug 2026');
    });
});

describe('dailyCompoundInterest', () => {
    test('returns 0 for 0% APR', () => {
        expect(dailyCompoundInterest(1000, 0, 30)).toBe(0);
    });

    test('returns 0 for 0 balance regardless of rate', () => {
        expect(dailyCompoundInterest(0, 12, 30)).toBe(0);
    });

    test('matches the documented daily-compounding formula for a known input', () => {
        const balance = 1000, apr = 12, days = 30;
        const expected = balance * (Math.pow(1 + apr / 100 / 365, days) - 1);
        expect(dailyCompoundInterest(balance, apr, days)).toBeCloseTo(expected, 10);
    });

    test('treats an undefined APR as 0', () => {
        expect(dailyCompoundInterest(1000, undefined, 30)).toBe(0);
    });
});

describe('computeNetIncomeAmount (#251)', () => {
    test('returns the raw amount when withholdingPercent is unset (gross === net, backward compatible)', () => {
        expect(computeNetIncomeAmount({ amount: 2000 })).toBe(2000);
    });

    test('returns the raw amount when withholdingPercent is 0', () => {
        expect(computeNetIncomeAmount({ amount: 2000, withholdingPercent: 0 })).toBe(2000);
    });

    test('applies withholding to derive take-home pay', () => {
        expect(computeNetIncomeAmount({ amount: 2000, withholdingPercent: 25 })).toBe(1500);
    });

    test('treats a missing amount as 0', () => {
        expect(computeNetIncomeAmount({ withholdingPercent: 25 })).toBe(0);
    });
});

describe('computeMonthlyIncomeForMonth (#251 withholding)', () => {
    test('0%/unset withholding matches the pre-existing gross total (backward compatible)', () => {
        const incomes = [{ amount: 2000, firstPayDate: '2026-01-01', frequency: 'monthly' }];
        const { monthlyTotal } = computeMonthlyIncomeForMonth(incomes, [], 2026, 0);
        expect(monthlyTotal).toBe(2000);
    });

    test('a non-zero withholding percent reduces the monthly total proportionally', () => {
        const incomes = [{ amount: 2000, firstPayDate: '2026-01-01', frequency: 'monthly', withholdingPercent: 20 }];
        const { monthlyTotal } = computeMonthlyIncomeForMonth(incomes, [], 2026, 0);
        expect(monthlyTotal).toBe(1600);
    });

    test('composes with multiple paydays (biweekly) and multiple income sources', () => {
        const incomes = [
            // 3 biweekly paydays land in January 2026 (1st, 15th, 29th); 10% withheld
            { amount: 1000, firstPayDate: '2026-01-01', frequency: 'biweekly', withholdingPercent: 10 },
            // no withholding set on this one
            { amount: 3000, firstPayDate: '2026-01-01', frequency: 'monthly' }
        ];
        const { monthlyTotal } = computeMonthlyIncomeForMonth(incomes, [], 2026, 0);
        expect(monthlyTotal).toBeCloseTo(900 * 3 + 3000, 10);
    });

    test('bonuses are never withheld — they add on top of net income', () => {
        const incomes = [{ amount: 2000, firstPayDate: '2026-01-01', frequency: 'monthly', withholdingPercent: 50 }];
        const bonuses = [{ date: '2026-01-15', amount: 500 }];
        const { monthlyTotal } = computeMonthlyIncomeForMonth(incomes, bonuses, 2026, 0);
        expect(monthlyTotal).toBe(1000 + 500);
    });
});

describe('normalizeMultilineText', () => {
    test('keeps newlines, normalizes CRLF/CR, trims each line', () => {
        expect(normalizeMultilineText('  a  \r\n  b\rc  ')).toBe('a\nb\nc');
    });

    test('strips tag/quote characters and control characters but not newlines', () => {
        expect(normalizeMultilineText('<b>hi</b>\u0001 "x"\nline`2`')).toBe('bhi/b x\nline2');
    });

    test('caps length', () => {
        expect(normalizeMultilineText('x'.repeat(900), 500)).toHaveLength(500);
        expect(normalizeMultilineText('abcdef', 3)).toBe('abc');
    });

    test('non-strings become an empty string', () => {
        expect(normalizeMultilineText(123)).toBe('');
        expect(normalizeMultilineText(null)).toBe('');
        expect(normalizeMultilineText({ a: 1 })).toBe('');
        expect(normalizeMultilineText(['x'])).toBe('');
    });
});

describe('isTransferLegTx (issue #566)', () => {
    const { isTransferLegTx } = require('../../src/utils.js');

    test('true for a flagged recurring transfer leg (either sign)', () => {
        expect(isTransferLegTx({ type: 'recurring', amount: -300, isTransferLeg: true })).toBe(true);
        expect(isTransferLegTx({ type: 'recurring', amount: 300, isTransferLeg: true })).toBe(true);
    });
    test('true for a one-off transfer leg', () => {
        expect(isTransferLegTx({ type: 'transfer', amount: -50 })).toBe(true);
        expect(isTransferLegTx({ type: 'transfer', amount: 50 })).toBe(true);
    });
    test('false for ordinary recurring, income, manual and other types', () => {
        expect(isTransferLegTx({ type: 'recurring', amount: -50 })).toBe(false);
        expect(isTransferLegTx({ type: 'recurring', amount: 100, isTransferLeg: false })).toBe(false);
        expect(isTransferLegTx({ type: 'income', amount: 3000 })).toBe(false);
        expect(isTransferLegTx({ type: 'manual', amount: -20 })).toBe(false);
        expect(isTransferLegTx({ type: 'recurring', amount: -5, isTransferLeg: 'true' })).toBe(false);
    });
    test('false for null and undefined', () => {
        expect(isTransferLegTx(null)).toBe(false);
        expect(isTransferLegTx(undefined)).toBe(false);
    });
});

describe('getBonusDatesInMonth (#290)', () => {
    const oneTime = { date: '2026-12-15', amount: 100 };
    const annual = { date: '2026-12-15', amount: 100, recurringAnnually: true };
    const ymd = (list) => list.map(d => [d.getFullYear(), d.getMonth(), d.getDate()]);

    test('a one-time bonus occurs only in its own month', () => {
        expect(ymd(getBonusDatesInMonth(oneTime, 2026, 11))).toEqual([[2026, 11, 15]]);
        expect(getBonusDatesInMonth(oneTime, 2027, 11)).toEqual([]);
        expect(getBonusDatesInMonth(oneTime, 2026, 10)).toEqual([]);
        expect(getBonusDatesInMonth(oneTime, 2025, 11)).toEqual([]);
    });

    test('an annual bonus occurs in the same month every year', () => {
        expect(ymd(getBonusDatesInMonth(annual, 2026, 11))).toEqual([[2026, 11, 15]]);
        expect(ymd(getBonusDatesInMonth(annual, 2027, 11))).toEqual([[2027, 11, 15]]);
        expect(ymd(getBonusDatesInMonth(annual, 2040, 11))).toEqual([[2040, 11, 15]]);
        expect(getBonusDatesInMonth(annual, 2027, 10)).toEqual([]);
        expect(getBonusDatesInMonth(annual, 2027, 0)).toEqual([]);
    });

    test('an annual bonus does not occur before its start year', () => {
        expect(getBonusDatesInMonth(annual, 2025, 11)).toEqual([]);
        expect(getBonusDatesInMonth(annual, 2000, 11)).toEqual([]);
    });

    test('recurUntil is inclusive of its own year when the occurrence is on or before it', () => {
        const b = { ...annual, recurUntil: '2028-12-15' };
        expect(ymd(getBonusDatesInMonth(b, 2028, 11))).toEqual([[2028, 11, 15]]);
        expect(getBonusDatesInMonth(b, 2029, 11)).toEqual([]);
        const later = { ...annual, recurUntil: '2028-12-31' };
        expect(ymd(getBonusDatesInMonth(later, 2028, 11))).toEqual([[2028, 11, 15]]);
    });

    test('recurUntil before that year\'s occurrence excludes that year', () => {
        const b = { ...annual, recurUntil: '2028-12-14' };
        expect(ymd(getBonusDatesInMonth(b, 2027, 11))).toEqual([[2027, 11, 15]]);
        expect(getBonusDatesInMonth(b, 2028, 11)).toEqual([]);
    });

    test('recurUntil is ignored on a one-time bonus', () => {
        const b = { ...oneTime, recurUntil: '2030-01-01' };
        expect(getBonusDatesInMonth(b, 2027, 11)).toEqual([]);
        expect(ymd(getBonusDatesInMonth(b, 2026, 11))).toEqual([[2026, 11, 15]]);
    });

    test('Feb 29 falls on Feb 28 in non-leap years and Feb 29 in leap years', () => {
        const leap = { date: '2024-02-29', amount: 1, recurringAnnually: true };
        expect(ymd(getBonusDatesInMonth(leap, 2024, 1))).toEqual([[2024, 1, 29]]);
        expect(ymd(getBonusDatesInMonth(leap, 2025, 1))).toEqual([[2025, 1, 28]]);
        expect(ymd(getBonusDatesInMonth(leap, 2028, 1))).toEqual([[2028, 1, 29]]);
        expect(getBonusDatesInMonth(leap, 2025, 2)).toEqual([]);
    });

    test('a missing, empty or invalid date yields nothing', () => {
        expect(getBonusDatesInMonth({ amount: 1, recurringAnnually: true }, 2026, 11)).toEqual([]);
        expect(getBonusDatesInMonth({ date: '', recurringAnnually: true }, 2026, 11)).toEqual([]);
        expect(getBonusDatesInMonth({ date: 'junk' }, 2026, 11)).toEqual([]);
        expect(getBonusDatesInMonth(null, 2026, 11)).toEqual([]);
    });

    test('tolerates a legacy full ISO timestamp', () => {
        expect(ymd(getBonusDatesInMonth({ date: '2026-12-15T05:00:00.000Z' }, 2026, 11))).toEqual([[2026, 11, 15]]);
    });
});

describe('getNextBonusDate (#290)', () => {
    const at = (y, m, d) => new Date(y, m, d, 9, 30);
    const ymd = (d) => d && [d.getFullYear(), d.getMonth(), d.getDate()];

    test('a one-time bonus: its date when upcoming or today, null once past', () => {
        const b = { date: '2026-12-15' };
        expect(ymd(getNextBonusDate(b, at(2026, 5, 1)))).toEqual([2026, 11, 15]);
        expect(ymd(getNextBonusDate(b, at(2026, 11, 15)))).toEqual([2026, 11, 15]);
        expect(getNextBonusDate(b, at(2026, 11, 16))).toBeNull();
    });

    test('an annual bonus: next occurrence this year or next', () => {
        const b = { date: '2024-12-15', recurringAnnually: true };
        expect(ymd(getNextBonusDate(b, at(2026, 5, 1)))).toEqual([2026, 11, 15]);
        expect(ymd(getNextBonusDate(b, at(2026, 11, 15)))).toEqual([2026, 11, 15]);
        expect(ymd(getNextBonusDate(b, at(2026, 11, 16)))).toEqual([2027, 11, 15]);
    });

    test('an annual bonus that starts in the future returns its first date', () => {
        const b = { date: '2030-03-10', recurringAnnually: true };
        expect(ymd(getNextBonusDate(b, at(2026, 5, 1)))).toEqual([2030, 2, 10]);
    });

    test('an ended series returns null', () => {
        const b = { date: '2024-12-15', recurringAnnually: true, recurUntil: '2025-12-15' };
        expect(getNextBonusDate(b, at(2026, 0, 1))).toBeNull();
        expect(ymd(getNextBonusDate(b, at(2025, 5, 1)))).toEqual([2025, 11, 15]);
    });

    test('Feb 29 clamps in a non-leap year', () => {
        const b = { date: '2024-02-29', recurringAnnually: true };
        expect(ymd(getNextBonusDate(b, at(2026, 0, 1)))).toEqual([2026, 1, 28]);
    });

    test('no date returns null', () => {
        expect(getNextBonusDate({ recurringAnnually: true }, new Date())).toBeNull();
    });
});

describe('bonus consumers use the shared rule (#290)', () => {
    const annual = { id: 1, name: 'Y', date: '2025-12-20', amount: 1000, recurringAnnually: true };
    const once = { id: 2, name: 'T', date: '2025-12-05', amount: 200 };

    test('computeMonthlyBonusesForMonth sums annual and one-time bonuses', () => {
        expect(computeMonthlyBonusesForMonth([annual, once], 2025, 11)).toBe(1200);
        expect(computeMonthlyBonusesForMonth([annual, once], 2026, 11)).toBe(1000);
        expect(computeMonthlyBonusesForMonth([annual, once], 2026, 10)).toBe(0);
        expect(computeMonthlyBonusesForMonth(undefined, 2026, 11)).toBe(0);
    });

    test('computeMonthlyIncomeForMonth includes a future annual bonus', () => {
        expect(computeMonthlyIncomeForMonth([], [annual], 2031, 11).monthlyTotal).toBe(1000);
    });

    test('getBonusesByDayForMonth places the occurrence on its day', () => {
        const byDay = getBonusesByDayForMonth([annual, once], 2027, 11);
        expect(Object.keys(byDay)).toEqual(['20']);
        expect(byDay[20]).toEqual([annual]);
    });
});
