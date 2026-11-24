// Pure, DOM-free calendar (.ics) builder shared by the browser download
// (src/calendarFeed.js) and the server's webcal feed (server/src/calendarGenerator.js,
// which imports it by relative path; the Docker image copies src/ to /src). One
// implementation of the RFC 5545 text helpers, the event selection and the
// titles, so both produce the same text for the same data (#526).
//
// Never import ui.js, postgresSync.js, settings.js, storage.js or any DOM or
// network module here.

import { applyWeekendRule } from './weekendRule.js';
import { getRecurringOccurrencesInMonth } from './recurringOccurrences.js';
import { getAmountOn } from './amountSchedule.js';
import { getIncomePaydaysInMonth } from './utils.js';

export const WINDOW_MONTHS = 12;

// RFC 5545 text value escaping.
export function icsEscape(text) {
    return String(text ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r\n|\r|\n/g, '\\n');
}

// RFC 5545 line folding: max 75 characters per physical line, CRLF + space.
export function icsFold(line) {
    if (line.length <= 75) return line + '\r\n';
    let out = '';
    let pos = 0;
    while (pos < line.length) {
        const len = pos === 0 ? 75 : 74;
        out += (pos === 0 ? '' : ' ') + line.slice(pos, pos + len) + '\r\n';
        pos += len;
    }
    return out;
}

// Format year/month(0-indexed)/day as YYYYMMDD.
export function isoDateStr(year, month, day) {
    return `${year}${String(month + 1).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}

// Build a DESCRIPTION value (raw string, not yet escaped).
export function buildDesc(amount, category, account, appUrl, amountLabel = 'Amount Due') {
    const parts = [];
    if (Number(amount) > 0) parts.push(`${amountLabel}: $${Number(amount).toFixed(2)}`);
    if (category) parts.push(`Category: ${category}`);
    if (account) parts.push(`Account: ${account}`);
    if (appUrl) parts.push(`View in MyFinances: ${appUrl}`);
    return parts.join('\n');
}

// RFC 5545 YYYYMMDD -> YYYY-MM-DD (the form getAmountOn compares).
export function dateStrToIso(dateStr) {
    return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
}

// RFC 5545 YYYYMMDD for the calendar day after dateStr.
export function nextDayStr(dateStr) {
    const y = parseInt(dateStr.slice(0, 4), 10);
    const m = parseInt(dateStr.slice(4, 6), 10) - 1;
    const d = parseInt(dateStr.slice(6, 8), 10);
    const next = new Date(y, m, d + 1);
    return isoDateStr(next.getFullYear(), next.getMonth(), next.getDate());
}

// Build a single VEVENT block (all-day, already CRLF-terminated).
export function vevent(uid, summary, dateStr, description) {
    const lines = [
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTART;VALUE=DATE:${dateStr}`,
        `DTEND;VALUE=DATE:${nextDayStr(dateStr)}`,
        `SUMMARY:${icsEscape(summary)}`,
    ];
    if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
    lines.push('END:VEVENT');
    return lines.map(icsFold).join('');
}

export function recurringTypeLabel(type) {
    return type === 'reimbursement' ? 'Reimbursement'
        : type === 'income' ? 'Income'
        : type === 'transfer' ? 'Transfer' : 'Subscription';
}

// 'YYYY-MM-DD' (or a Date) -> YYYYMMDD, or null when it is not a date.
function compactDate(value) {
    if (!value) return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : isoDateStr(value.getFullYear(), value.getMonth(), value.getDate());
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
    return m ? `${m[1]}${m[2]}${m[3]}` : null;
}

// Build the whole VCALENDAR text. `data` uses the app's record shapes
// (camelCase): { accounts, bills, debts, recurringTemplates, incomes, expenses,
// showArchived, appUrl, now }. `now` (a Date) is injectable so two callers can
// be compared byte for byte. Archived recurring templates are skipped.
export function buildIcs(data = {}) {
    const {
        accounts = [], bills = [], debts = [], recurringTemplates = [],
        incomes = [], expenses = [], showArchived = false, appUrl = null,
    } = data;
    const now = data.now instanceof Date ? data.now : new Date();
    const accountMap = Object.fromEntries((accounts || []).map(a => [a.id, a.name]));
    const acctName = id => (id ? accountMap[id] : null);
    const activeTemplates = (recurringTemplates || []).filter(t => !t.archived);
    const events = [];

    for (let delta = -WINDOW_MONTHS; delta <= WINDOW_MONTHS; delta++) {
        const ref = new Date(now.getFullYear(), now.getMonth() + delta, 1);
        const y = ref.getFullYear();
        const mo = ref.getMonth();
        const monthKey = `${y}-${String(mo + 1).padStart(2, '0')}`;
        const daysInMo = new Date(y, mo + 1, 0).getDate();

        for (const bill of bills || []) {
            if (!bill.dueDay) continue;
            const d = Math.min(bill.dueDay, daysInMo);
            const dateStr = isoDateStr(y, mo, d);
            events.push(vevent(
                `bill-${bill.id}-${dateStr}@myfinances`,
                `Bill - ${bill.name}`,
                dateStr,
                buildDesc(bill.amount, bill.category, acctName(bill.accountId), appUrl)
            ));
        }

        for (const debt of debts || []) {
            if (debt.archived && !showArchived) continue;
            const explicit = compactDate(debt.nextPaymentDue);
            if (!debt.dueDate && !explicit) continue;
            let dateStr;
            if (explicit && explicit.startsWith(`${y}${String(mo + 1).padStart(2, '0')}`)) {
                // The user typed this date: the weekend rule does not shift it.
                dateStr = explicit;
            } else if (debt.dueDate) {
                const d = Math.min(debt.dueDate, daysInMo);
                // #165: shift a weekend due day per the debt's weekendRule.
                const due = applyWeekendRule(new Date(y, mo, d, 12), debt.weekendRule);
                dateStr = isoDateStr(y, mo, due.getDate());
            } else {
                continue;
            }
            events.push(vevent(
                `debt-${debt.id}-${dateStr}@myfinances`,
                `${debt.archived ? 'Debt (Archived)' : 'Debt'} - ${debt.name}`,
                dateStr,
                buildDesc(debt.minimumPayment, debt.category, acctName(debt.accountId), appUrl)
            ));
        }

        for (const t of activeTemplates) {
            if (t.paidMonths?.includes(monthKey)) continue;
            const typeLabel = recurringTypeLabel(t.type);
            for (const occ of getRecurringOccurrencesInMonth(t, y, mo)) {
                const dateStr = isoDateStr(occ.getFullYear(), occ.getMonth(), occ.getDate());
                events.push(vevent(
                    `recurring-${t.id}-${dateStr}@myfinances`,
                    `${typeLabel} - ${t.name}`,
                    dateStr,
                    // #678: the amount in effect on this occurrence.
                    buildDesc(getAmountOn(t, dateStrToIso(dateStr)), t.category, acctName(t.accountId), appUrl)
                ));
            }
        }

        for (const inc of incomes || []) {
            for (const pay of getIncomePaydaysInMonth(inc, y, mo)) {
                const dateStr = isoDateStr(pay.getFullYear(), pay.getMonth(), pay.getDate());
                events.push(vevent(
                    `income-${inc.id}-${dateStr}@myfinances`,
                    `Payday - ${inc.name}`,
                    dateStr,
                    buildDesc(getAmountOn(inc, dateStrToIso(dateStr)), null, acctName(inc.accountId), appUrl, 'Amount')
                ));
            }
        }

        for (const exp of expenses || []) {
            if (!exp.date) continue;
            // 'YYYY-MM-DD' parses at noon so the local date never shifts.
            const expDate = exp.date instanceof Date ? exp.date
                : new Date(/^\d{4}-\d{2}-\d{2}$/.test(exp.date) ? `${exp.date}T12:00:00` : exp.date);
            if (Number.isNaN(expDate.getTime())) continue;
            if (expDate.getFullYear() !== y || expDate.getMonth() !== mo) continue;
            const dateStr = isoDateStr(y, mo, expDate.getDate());
            events.push(vevent(
                `expense-${exp.id}-${dateStr}@myfinances`,
                `Expense - ${exp.name}`,
                dateStr,
                buildDesc(exp.budgetAmount, exp.category, acctName(exp.accountId), appUrl)
            ));
        }
    }

    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//MyFinances//MyFinances Calendar Feed//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:MyFinances',
    ].map(icsFold).join('') + events.join('') + 'END:VCALENDAR\r\n';
}
