// Sinking fund target-date schedule (#680). Pure, import-free and DOM-free, so
// the browser and the server (the shared projection core) use one definition.
//
// A fund with allocationMethod 'target_date' and a valid ISO `targetDate`
// stores its date; the monthly amount it needs is computed here at use time
// from what is still missing, so it moves as the user contributes and as time
// passes. `monthlyAllocation` stays stored (the amount computed at save) and is
// the planned pace the status compares against. Never read a target_date
// fund's `monthlyAllocation` directly for a live figure: use
// getEffectiveMonthlyAllocation().

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIso(iso) {
    if (typeof iso !== 'string') return null;
    const m = ISO_RE.exec(iso);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1) return null;
    // Day 0 of the next month is the last day of this one (handles leap years).
    const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    if (d > lastDay) return null;
    return { y, mo, d };
}

function toNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

/** True for a real calendar date written YYYY-MM-DD (rejects 2027-02-30). */
export function isValidIsoDate(iso) {
    return parseIso(iso) !== null;
}

/** True for a fund whose live amount is driven by a valid target date. */
export function hasTargetDate(fund) {
    return Boolean(fund) && fund.allocationMethod === 'target_date' && parseIso(fund.targetDate) !== null;
}

/**
 * Months left to fund a goal, counted in calendar months from today's month to
 * the target date's month (the difference of the two months, so a target next
 * month is 1 and a target in 12 months is 12). A target in the current month,
 * or today itself, counts as 1: everything that remains is needed now. A
 * target before today is 0 (past due). Returns null when either date is invalid.
 */
export function getMonthsLeft(targetDateISO, todayISO) {
    const target = parseIso(targetDateISO);
    const today = parseIso(todayISO);
    if (!target || !today) return null;
    const targetKey = target.y * 10000 + target.mo * 100 + target.d;
    const todayKey = today.y * 10000 + today.mo * 100 + today.d;
    if (targetKey < todayKey) return 0;
    const diff = (target.y - today.y) * 12 + (target.mo - today.mo);
    return Math.max(1, diff);
}

/**
 * Amount still missing: max(0, targetAmount - currentAmount).
 */
export function getRemainingAmount(fund) {
    if (!fund) return 0;
    return Math.max(0, toNumber(fund.targetAmount) - toNumber(fund.currentAmount));
}

/**
 * Live required monthly amount for a target_date fund with a date:
 * remaining / monthsLeft (see getMonthsLeft). 0 when already funded; the whole
 * remainder when the target is in the current month; the whole remainder as
 * well when the date is past (callers that schedule contributions use
 * getEffectiveMonthlyAllocation, which treats past due as 0). Returns null
 * when the fund has no usable target date, or todayISO is invalid.
 */
export function getRequiredMonthlyAmount(fund, todayISO) {
    if (!hasTargetDate(fund)) return null;
    const monthsLeft = getMonthsLeft(fund.targetDate, todayISO);
    if (monthsLeft === null) return null;
    const remaining = getRemainingAmount(fund);
    if (remaining <= 0) return 0;
    return remaining / Math.max(1, monthsLeft);
}

/**
 * Status of a target_date fund, or null when it has no usable target date.
 *   funded  - currentAmount >= targetAmount (wins over everything).
 *   pastDue - target date before today and not funded.
 *   behind / ahead / onTrack - the live required amount compared with the
 *     planned pace, the stored monthlyAllocation (the amount computed when the
 *     fund was last saved): more than half a cent above is behind, more than
 *     half a cent below is ahead, otherwise on track. Contributing at the
 *     planned pace keeps the requirement level; skipping months raises it.
 *     A missing planned pace (0) is on track.
 * Returns { status, required, planned, remaining, monthsLeft }.
 */
export function getSinkingFundStatus(fund, todayISO) {
    if (!hasTargetDate(fund)) return null;
    const monthsLeft = getMonthsLeft(fund.targetDate, todayISO);
    if (monthsLeft === null) return null;
    const remaining = getRemainingAmount(fund);
    const planned = Math.max(0, toNumber(fund.monthlyAllocation));
    const funded = toNumber(fund.targetAmount) > 0 && remaining <= 0;
    const required = remaining <= 0 ? 0 : remaining / Math.max(1, monthsLeft);
    let status;
    if (funded) status = 'funded';
    else if (monthsLeft === 0) status = 'pastDue';
    else if (planned <= 0) status = 'onTrack';
    else if (required - planned > 0.005) status = 'behind';
    else if (planned - required > 0.005) status = 'ahead';
    else status = 'onTrack';
    return { status, required, planned, remaining, monthsLeft };
}

/**
 * The monthly amount to count for a fund today. A target_date fund with a date
 * returns the live required amount, or 0 when funded or past due (nothing is
 * scheduled for a goal whose date has gone; the card flags it). Every other
 * fund returns its stored monthlyAllocation.
 */
export function getEffectiveMonthlyAllocation(fund, todayISO) {
    if (!fund) return 0;
    const stored = Math.max(0, toNumber(fund.monthlyAllocation));
    if (!hasTargetDate(fund)) return stored;
    const info = getSinkingFundStatus(fund, todayISO);
    if (!info) return stored;
    if (info.status === 'funded' || info.status === 'pastDue') return 0;
    return info.required;
}

/**
 * True when the calendar month (year, 0-based month) starts after the month of
 * the fund's target date, so no contribution should be projected in it. Funds
 * without a usable target date are never past their window.
 */
export function isAfterTargetMonth(fund, year, month) {
    if (!hasTargetDate(fund)) return false;
    const target = parseIso(fund.targetDate);
    return year * 12 + month > target.y * 12 + (target.mo - 1);
}

// #701: a target_date fund raises an alert once its live required monthly
// amount is at least 10% above the planned pace (the stored monthlyAllocation,
// the amount saved with the goal), or once its date has passed with money
// still to save. The boundary is inclusive: exactly 10% above alerts (a small
// epsilon absorbs float error, so planned 300 and required 330 alert).
export const SINKING_BEHIND_ALERT_RATIO = 1.1;

/**
 * Alert state of a fund, or null when it should not alert.
 *   null      - no usable target date, archived, funded, nothing left to save,
 *               on or ahead of pace, less than 10% behind, or behind with no
 *               planned pace (planned 0 or missing: nothing to slip from).
 *   'pastDue' - the target date is before today and money is still missing
 *               (checked regardless of the planned pace).
 *   'behind'  - required >= planned * SINKING_BEHIND_ALERT_RATIO.
 * Returns { kind, required, planned, remaining, monthsLeft, targetAmount, targetDate }.
 */
export function getSinkingAlertState(fund, todayISO) {
    if (!fund || fund.archived) return null;
    const info = getSinkingFundStatus(fund, todayISO);
    if (!info || info.status === 'funded' || info.remaining <= 0) return null;
    let kind = null;
    if (info.status === 'pastDue') kind = 'pastDue';
    else if (info.planned > 0 && info.required >= info.planned * SINKING_BEHIND_ALERT_RATIO - 1e-9) kind = 'behind';
    if (!kind) return null;
    return {
        kind,
        required: info.required,
        planned: info.planned,
        remaining: info.remaining,
        monthsLeft: info.monthsLeft,
        targetAmount: toNumber(fund.targetAmount),
        targetDate: fund.targetDate,
    };
}
