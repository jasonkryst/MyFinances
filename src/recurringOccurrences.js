// Pure recurring-template occurrence engine (#579, #526). DOM-free and
// import-safe in Node: the browser (recurring.js re-exports it, so every
// existing import keeps working), the Ledger projection core and the server
// (calendar feed, background jobs) all share this one definition.

import { dateToISO } from './utils.js';
import { applyWeekendRule } from './weekendRule.js';


/**
 * A paused template whose auto-resume date (`pauseUntil`) has passed is
 * treated exactly as if it had been manually unpaused (issue #299) — this is
 * computed fresh on every call rather than persisted, so no render path
 * needs to write back to storage just to evaluate occurrences/overdue state.
 */
export function isEffectivelyPaused(template, now = new Date()) {
    if (!template?.paused) return false;
    if (template.pauseUntil && dateToISO(now) >= template.pauseUntil) return false;
    return true;
}

/**
 * Returns an array of Date objects for all occurrences of this template in
 * the given calendar month (year/month where month is 0-indexed).
 */
export function getRecurringOccurrencesInMonth(template, year, month) {
    if (!template || template.archived) return [];
    if (isEffectivelyPaused(template)) return [];

    const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
    if (Array.isArray(template.skippedMonths) && template.skippedMonths.includes(monthKey)) return [];

    const startDate = template.startDate ? new Date(`${template.startDate}T12:00:00`) : null;
    const endDate = template.endDate ? new Date(`${template.endDate}T12:00:00`) : null;

    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);

    if (startDate && startDate > monthEnd) return [];
    if (endDate && endDate < monthStart) return [];

    const freq = template.frequency || 'monthly';
    const dayOfMonth = Math.min(Math.max(Number(template.dayOfMonth) || 1, 1), 31);
    const dates = [];

    if (freq === 'monthly') {
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const day = Math.min(dayOfMonth, daysInMonth);
        const d = new Date(year, month, day, 12);
        if ((!startDate || d >= startDate) && (!endDate || d <= endDate)) {
            dates.push(d);
        }
    } else if (freq === 'quarterly') {
        if (!startDate) return [];
        const startMonth = startDate.getMonth();
        const startYear = startDate.getFullYear();
        const monthsFromStart = (year - startYear) * 12 + (month - startMonth);
        if (monthsFromStart >= 0 && monthsFromStart % 3 === 0) {
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const day = Math.min(dayOfMonth, daysInMonth);
            const d = new Date(year, month, day, 12);
            if (!endDate || d <= endDate) dates.push(d);
        }
    } else if (freq === 'yearly') {
        if (!startDate) return [];
        if (startDate.getMonth() === month) {
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const day = Math.min(dayOfMonth, daysInMonth);
            const d = new Date(year, month, day, 12);
            if (!endDate || d <= endDate) dates.push(d);
        }
    } else if (freq === 'weekly' || freq === 'biweekly') {
        if (!startDate) return [];
        const interval = freq === 'weekly' ? 7 : 14;
        const MS_PER_DAY = 24 * 60 * 60 * 1000;
        let cur = new Date(startDate);
        cur.setHours(12, 0, 0, 0);

        if (cur < monthStart) {
            const diffDays = Math.ceil((monthStart - cur) / MS_PER_DAY);
            const periods = Math.ceil(diffDays / interval);
            cur = new Date(cur.getTime() + periods * interval * MS_PER_DAY);
        }

        while (cur <= monthEnd) {
            if (!endDate || cur <= endDate) dates.push(new Date(cur));
            cur = new Date(cur.getTime() + interval * MS_PER_DAY);
        }
    }

    // #165: optional weekend shift (stays inside the month).
    const rule = template.weekendRule;
    if (rule === 'before' || rule === 'after') return dates.map(d => applyWeekendRule(d, rule));
    return dates;
}

