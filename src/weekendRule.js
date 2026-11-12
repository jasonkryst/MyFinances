// Weekend due-date shift (issue #165). Pure leaf module (no imports) so the
// browser and the server (server/src/calendarGenerator.js) share one rule.
//
// weekendRule: 'none' keeps the date, 'before' moves a Saturday/Sunday to the
// Friday before, 'after' to the Monday after. The result always stays in the
// same calendar month: when the chosen direction would leave it (Saturday the
// 1st with 'before', Sunday the 31st with 'after') the other direction is used.

export const WEEKEND_RULES = ['none', 'before', 'after'];

export function sanitizeWeekendRule(value) {
    return WEEKEND_RULES.includes(value) ? value : 'none';
}

// Returns a new Date (never mutates), keeping the input's time of day.
export function applyWeekendRule(date, rule) {
    const out = new Date(date.getTime());
    if (rule !== 'before' && rule !== 'after') return out;
    const dow = out.getDay();
    if (dow !== 0 && dow !== 6) return out;
    const daysInMonth = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
    // Friday-before offset: Sat -1, Sun -2. Monday-after offset: Sat +2, Sun +1.
    const back = dow === 6 ? -1 : -2;
    const fwd = dow === 6 ? 2 : 1;
    const day = out.getDate();
    let delta = rule === 'before' ? back : fwd;
    const target = day + delta;
    if (target < 1 || target > daysInMonth) delta = rule === 'before' ? fwd : back;
    out.setDate(day + delta);
    return out;
}

// A debt's due date in the given month (month is 0-indexed). Without a rule
// this is the long-standing `new Date(year, month, dueDate)` (midnight, no
// day clamp); with a rule the day is clamped to the month first so the shifted
// date stays inside it.
export function getDebtDueDateInMonth(debt, year, month) {
    const rule = debt?.weekendRule;
    if (rule !== 'before' && rule !== 'after') return new Date(year, month, debt.dueDate);
    const dim = new Date(year, month + 1, 0).getDate();
    return applyWeekendRule(new Date(year, month, Math.min(debt.dueDate, dim)), rule);
}
