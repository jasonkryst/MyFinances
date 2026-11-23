// #680: sinking fund target-date schedule. Pure rules shared by the browser
// and the server's projection core.
const {
    isValidIsoDate,
    hasTargetDate,
    getMonthsLeft,
    getRemainingAmount,
    getRequiredMonthlyAmount,
    getSinkingFundStatus,
    getEffectiveMonthlyAllocation,
    isAfterTargetMonth,
    SINKING_BEHIND_ALERT_RATIO,
    getSinkingAlertState
} = require('../../src/sinkingFundSchedule.js');

const fund = (extra) => ({
    allocationMethod: 'target_date', targetDate: '2027-01-15', targetAmount: 1200, currentAmount: 0, monthlyAllocation: 100, ...extra
});
const TODAY = '2026-01-15';

describe('isValidIsoDate', () => {
    test('accepts real dates and rejects impossible or malformed ones', () => {
        expect(isValidIsoDate('2027-02-28')).toBe(true);
        expect(isValidIsoDate('2028-02-29')).toBe(true);
        expect(isValidIsoDate('2027-02-30')).toBe(false);
        expect(isValidIsoDate('2027-2-3')).toBe(false);
        expect(isValidIsoDate('2027-01-15T00:00:00Z')).toBe(false);
        expect(isValidIsoDate(null)).toBe(false);
    });
});

describe('hasTargetDate', () => {
    test('true only for target_date with a valid date', () => {
        expect(hasTargetDate(fund())).toBe(true);
    });
    test('false for other methods, missing or invalid dates, and no fund', () => {
        expect(hasTargetDate(fund({ allocationMethod: 'fixed' }))).toBe(false);
        expect(hasTargetDate(fund({ allocationMethod: 'annual' }))).toBe(false);
        expect(hasTargetDate(fund({ targetDate: null }))).toBe(false);
        expect(hasTargetDate(fund({ targetDate: undefined }))).toBe(false);
        expect(hasTargetDate(fund({ targetDate: '' }))).toBe(false);
        expect(hasTargetDate(fund({ targetDate: 'tomorrow' }))).toBe(false);
        expect(hasTargetDate(fund({ targetDate: '2027-13-01' }))).toBe(false);
        expect(hasTargetDate(fund({ targetDate: '2027-00-10' }))).toBe(false);
        expect(hasTargetDate(fund({ targetDate: '2027-02-29' }))).toBe(false);
        expect(hasTargetDate(fund({ targetDate: '2027-04-31' }))).toBe(false);
        expect(hasTargetDate(fund({ targetDate: '2027-04-00' }))).toBe(false);
        expect(hasTargetDate(fund({ targetDate: 20270115 }))).toBe(false);
        expect(hasTargetDate(null)).toBe(false);
        expect(hasTargetDate(undefined)).toBe(false);
    });
    test('accepts leap day only in a leap year, and month ends', () => {
        expect(hasTargetDate(fund({ targetDate: '2028-02-29' }))).toBe(true);
        expect(hasTargetDate(fund({ targetDate: '2028-02-30' }))).toBe(false);
        expect(hasTargetDate(fund({ targetDate: '2026-02-28' }))).toBe(true);
        expect(hasTargetDate(fund({ targetDate: '2026-12-31' }))).toBe(true);
        expect(hasTargetDate(fund({ targetDate: '2026-04-30' }))).toBe(true);
    });
});

describe('getMonthsLeft', () => {
    test('is the calendar-month difference', () => {
        expect(getMonthsLeft('2027-01-15', '2026-01-15')).toBe(12);
        expect(getMonthsLeft('2026-02-01', '2026-01-31')).toBe(1);
        expect(getMonthsLeft('2026-03-31', '2026-01-01')).toBe(2);
        expect(getMonthsLeft('2028-02-29', '2026-12-10')).toBe(14);
    });
    test('a target in the current month, or today, is 1', () => {
        expect(getMonthsLeft('2026-01-31', '2026-01-15')).toBe(1);
        expect(getMonthsLeft('2026-01-15', '2026-01-15')).toBe(1);
    });
    test('a target before today is 0, even earlier in the same month', () => {
        expect(getMonthsLeft('2026-01-14', '2026-01-15')).toBe(0);
        expect(getMonthsLeft('2025-12-31', '2026-01-01')).toBe(0);
        expect(getMonthsLeft('2020-01-01', '2026-01-01')).toBe(0);
    });
    test('null when either date is invalid', () => {
        expect(getMonthsLeft('nope', TODAY)).toBeNull();
        expect(getMonthsLeft('2027-01-15', 'nope')).toBeNull();
        expect(getMonthsLeft(null, TODAY)).toBeNull();
        expect(getMonthsLeft('2027-01-15', undefined)).toBeNull();
    });
});

describe('getRemainingAmount', () => {
    test('is target minus current, floored at 0', () => {
        expect(getRemainingAmount(fund({ currentAmount: 200 }))).toBe(1000);
        expect(getRemainingAmount(fund({ currentAmount: 1200 }))).toBe(0);
        expect(getRemainingAmount(fund({ currentAmount: 5000 }))).toBe(0);
    });
    test('non-numeric values count as 0; no fund is 0', () => {
        expect(getRemainingAmount(fund({ currentAmount: 'x' }))).toBe(1200);
        expect(getRemainingAmount(fund({ targetAmount: undefined }))).toBe(0);
        expect(getRemainingAmount(null)).toBe(0);
    });
});

describe('getRequiredMonthlyAmount', () => {
    test('divides what is missing by the months left', () => {
        expect(getRequiredMonthlyAmount(fund(), TODAY)).toBe(100);
        expect(getRequiredMonthlyAmount(fund({ currentAmount: 600 }), TODAY)).toBe(50);
    });
    test('rises as months pass without contributing', () => {
        expect(getRequiredMonthlyAmount(fund(), '2026-07-15')).toBeCloseTo(1200 / 6);
        expect(getRequiredMonthlyAmount(fund(), '2026-12-01')).toBe(1200);
    });
    test('a target this month needs everything now', () => {
        expect(getRequiredMonthlyAmount(fund({ targetDate: '2026-01-31', currentAmount: 200 }), TODAY)).toBe(1000);
    });
    test('a past date still reports the whole remainder', () => {
        expect(getRequiredMonthlyAmount(fund({ targetDate: '2025-06-01', currentAmount: 200 }), TODAY)).toBe(1000);
    });
    test('0 when funded or overfunded', () => {
        expect(getRequiredMonthlyAmount(fund({ currentAmount: 1200 }), TODAY)).toBe(0);
        expect(getRequiredMonthlyAmount(fund({ currentAmount: 1300 }), TODAY)).toBe(0);
        expect(getRequiredMonthlyAmount(fund({ targetAmount: 0 }), TODAY)).toBe(0);
    });
    test('null without a usable date, method or today', () => {
        expect(getRequiredMonthlyAmount(fund({ targetDate: null }), TODAY)).toBeNull();
        expect(getRequiredMonthlyAmount(fund({ targetDate: 'bad' }), TODAY)).toBeNull();
        expect(getRequiredMonthlyAmount(fund({ allocationMethod: 'fixed' }), TODAY)).toBeNull();
        expect(getRequiredMonthlyAmount(fund(), 'bad')).toBeNull();
        expect(getRequiredMonthlyAmount(null, TODAY)).toBeNull();
    });
});

describe('getSinkingFundStatus', () => {
    test('on track when the live need equals the planned pace', () => {
        const r = getSinkingFundStatus(fund(), TODAY);
        expect(r.status).toBe('onTrack');
        expect(r.required).toBe(100);
        expect(r.planned).toBe(100);
        expect(r.remaining).toBe(1200);
        expect(r.monthsLeft).toBe(12);
    });
    test('behind when months pass without contributing', () => {
        expect(getSinkingFundStatus(fund(), '2026-07-15').status).toBe('behind');
    });
    test('ahead when contributions exceed the pace', () => {
        const r = getSinkingFundStatus(fund({ currentAmount: 600 }), TODAY);
        expect(r.status).toBe('ahead');
        expect(r.required).toBe(50);
    });
    test('under half a cent of difference is on track; over is not', () => {
        expect(getSinkingFundStatus(fund({ targetAmount: 1200.004 }), TODAY).status).toBe('onTrack');
        expect(getSinkingFundStatus(fund({ targetAmount: 1200.12 }), TODAY).status).toBe('behind');
        expect(getSinkingFundStatus(fund({ targetAmount: 1199.88 }), TODAY).status).toBe('ahead');
    });
    test('on track when there is no planned pace stored', () => {
        expect(getSinkingFundStatus(fund({ monthlyAllocation: 0 }), TODAY).status).toBe('onTrack');
        expect(getSinkingFundStatus(fund({ monthlyAllocation: undefined }), TODAY).status).toBe('onTrack');
        expect(getSinkingFundStatus(fund({ monthlyAllocation: -5 }), TODAY).status).toBe('onTrack');
    });
    test('past due when the date has gone and money is missing', () => {
        const r = getSinkingFundStatus(fund({ targetDate: '2025-12-31', currentAmount: 200 }), TODAY);
        expect(r.status).toBe('pastDue');
        expect(r.monthsLeft).toBe(0);
        expect(r.remaining).toBe(1000);
    });
    test('the target day itself is not past due', () => {
        expect(getSinkingFundStatus(fund({ targetDate: TODAY }), TODAY).status).not.toBe('pastDue');
    });
    test('funded wins over past due', () => {
        const r = getSinkingFundStatus(fund({ targetDate: '2025-12-31', currentAmount: 1200 }), TODAY);
        expect(r.status).toBe('funded');
        expect(r.required).toBe(0);
    });
    test('a zero target is never funded', () => {
        expect(getSinkingFundStatus(fund({ targetAmount: 0 }), TODAY).status).not.toBe('funded');
    });
    test('null without a usable target date or today', () => {
        expect(getSinkingFundStatus(fund({ allocationMethod: 'fixed' }), TODAY)).toBeNull();
        expect(getSinkingFundStatus(fund({ targetDate: null }), TODAY)).toBeNull();
        expect(getSinkingFundStatus(fund(), 'bad')).toBeNull();
        expect(getSinkingFundStatus(undefined, TODAY)).toBeNull();
    });
});

describe('getEffectiveMonthlyAllocation', () => {
    test('live amount for a target_date fund with a date', () => {
        expect(getEffectiveMonthlyAllocation(fund({ monthlyAllocation: 999, currentAmount: 600 }), TODAY)).toBe(50);
    });
    test('0 when funded or past due', () => {
        expect(getEffectiveMonthlyAllocation(fund({ currentAmount: 1200 }), TODAY)).toBe(0);
        expect(getEffectiveMonthlyAllocation(fund({ targetDate: '2025-01-01' }), TODAY)).toBe(0);
    });
    test('this month target needs everything now', () => {
        expect(getEffectiveMonthlyAllocation(fund({ targetDate: '2026-01-20' }), TODAY)).toBe(1200);
    });
    test('stored monthlyAllocation for other methods', () => {
        expect(getEffectiveMonthlyAllocation(fund({ allocationMethod: 'fixed', targetDate: null, monthlyAllocation: 75 }), TODAY)).toBe(75);
        expect(getEffectiveMonthlyAllocation(fund({ allocationMethod: 'annual', monthlyAllocation: 40 }), TODAY)).toBe(40);
    });
    test('stored monthlyAllocation for a target_date fund without a date (legacy)', () => {
        expect(getEffectiveMonthlyAllocation(fund({ targetDate: null, monthlyAllocation: 80 }), TODAY)).toBe(80);
        expect(getEffectiveMonthlyAllocation(fund({ targetDate: 'bad', monthlyAllocation: 80 }), TODAY)).toBe(80);
    });
    test('an invalid today falls back to the stored amount', () => {
        expect(getEffectiveMonthlyAllocation(fund({ monthlyAllocation: 80 }), 'bad')).toBe(80);
    });
    test('never negative, non-finite becomes 0; no fund is 0', () => {
        expect(getEffectiveMonthlyAllocation(fund({ allocationMethod: 'fixed', monthlyAllocation: -5 }), TODAY)).toBe(0);
        expect(getEffectiveMonthlyAllocation(fund({ allocationMethod: 'fixed', monthlyAllocation: 'x' }), TODAY)).toBe(0);
        expect(getEffectiveMonthlyAllocation(null, TODAY)).toBe(0);
    });
});

describe('isAfterTargetMonth', () => {
    const f = fund({ targetDate: '2026-06-10' });
    test('false up to and including the target month (month is 0-based)', () => {
        expect(isAfterTargetMonth(f, 2026, 4)).toBe(false);
        expect(isAfterTargetMonth(f, 2026, 5)).toBe(false);
    });
    test('true from the month after, across year ends', () => {
        expect(isAfterTargetMonth(f, 2026, 6)).toBe(true);
        expect(isAfterTargetMonth(f, 2027, 0)).toBe(true);
        expect(isAfterTargetMonth(fund({ targetDate: '2026-12-31' }), 2026, 11)).toBe(false);
        expect(isAfterTargetMonth(fund({ targetDate: '2026-12-31' }), 2027, 0)).toBe(true);
    });
    test('false for a year earlier', () => {
        expect(isAfterTargetMonth(f, 2025, 11)).toBe(false);
    });
    test('false without a usable target date', () => {
        expect(isAfterTargetMonth(fund({ targetDate: null }), 2030, 0)).toBe(false);
        expect(isAfterTargetMonth(fund({ allocationMethod: 'fixed' }), 2030, 0)).toBe(false);
        expect(isAfterTargetMonth(null, 2030, 0)).toBe(false);
    });
});

// #701: when a fund alerts.
describe('getSinkingAlertState', () => {
    // 2026-01-15 to 2027-01-15 is 12 months left. 1200 left => 100/mo required.
    const f = (extra) => fund({ targetAmount: 1200, currentAmount: 0, ...extra });

    test('the threshold is 10%', () => {
        expect(SINKING_BEHIND_ALERT_RATIO).toBe(1.1);
    });
    test('behind at 10% or more above the planned pace, with the figures', () => {
        expect(getSinkingAlertState(f({ monthlyAllocation: 80 }), TODAY)).toEqual({
            kind: 'behind', required: 100, planned: 80, remaining: 1200, monthsLeft: 12, targetAmount: 1200, targetDate: '2027-01-15',
        });
    });
    test('the boundary is inclusive and float-safe; just under does not alert', () => {
        // required 330 against planned 300 (300 * 1.1 is 330.00000000000006 in floating point).
        expect(getSinkingAlertState(f({ targetAmount: 3960, monthlyAllocation: 300 }), TODAY)?.kind).toBe('behind');
        expect(getSinkingAlertState(f({ monthlyAllocation: 90.91 }), TODAY)).toBeNull();
        expect(getSinkingAlertState(f({ monthlyAllocation: 90.9 }), TODAY)?.kind).toBe('behind');
        expect(getSinkingAlertState(f({ targetAmount: 3959.88, monthlyAllocation: 300 }), TODAY)).toBeNull();
    });
    test('on pace, ahead and small slips are null', () => {
        expect(getSinkingAlertState(f({ monthlyAllocation: 100 }), TODAY)).toBeNull();
        expect(getSinkingAlertState(f({ monthlyAllocation: 200 }), TODAY)).toBeNull();
        expect(getSinkingAlertState(f({ monthlyAllocation: 95 }), TODAY)).toBeNull();
    });
    test('a missing or zero planned pace never alerts as behind', () => {
        expect(getSinkingAlertState(f({ monthlyAllocation: 0 }), TODAY)).toBeNull();
        expect(getSinkingAlertState(f({ monthlyAllocation: undefined }), TODAY)).toBeNull();
        expect(getSinkingAlertState(f({ monthlyAllocation: -5 }), TODAY)).toBeNull();
    });
    test('pastDue when the date has passed and money is missing, with or without a planned pace', () => {
        const past = f({ targetDate: '2026-01-14', currentAmount: 200, monthlyAllocation: 0 });
        expect(getSinkingAlertState(past, TODAY)).toMatchObject({ kind: 'pastDue', remaining: 1000, monthsLeft: 0 });
        expect(getSinkingAlertState({ ...past, monthlyAllocation: 100 }, TODAY).kind).toBe('pastDue');
        expect(getSinkingAlertState(f({ targetDate: TODAY, monthlyAllocation: 50 }), TODAY)?.kind).toBe('behind');
    });
    test('funded, archived, undated, other methods and missing funds are null', () => {
        expect(getSinkingAlertState(f({ currentAmount: 1200, monthlyAllocation: 50 }), TODAY)).toBeNull();
        expect(getSinkingAlertState(f({ currentAmount: 1500, targetDate: '2025-01-01' }), TODAY)).toBeNull();
        expect(getSinkingAlertState(f({ archived: true, monthlyAllocation: 50 }), TODAY)).toBeNull();
        expect(getSinkingAlertState(f({ targetDate: null, monthlyAllocation: 50 }), TODAY)).toBeNull();
        expect(getSinkingAlertState(f({ allocationMethod: 'fixed', monthlyAllocation: 50 }), TODAY)).toBeNull();
        expect(getSinkingAlertState(f({ targetAmount: 0, targetDate: '2025-01-01' }), TODAY)).toBeNull();
        expect(getSinkingAlertState(null, TODAY)).toBeNull();
        expect(getSinkingAlertState(f({ monthlyAllocation: 50 }), 'bad')).toBeNull();
    });
});
