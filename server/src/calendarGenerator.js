// Server-side ICS generator for the public calendar.ics endpoint.
// Recurring occurrences and income paydays come from the same pure modules the
// browser uses (src/recurringOccurrences.js, src/utils.js; #579, part of #526),
// imported by relative path: the Docker image copies src/ to /src, like the
// sanitizers. The ICS text helpers below are still a copy of
// src/calendarFeed.js's (#526).

import { query } from './db.js';
import { applyWeekendRule } from '../../src/weekendRule.js';
import { getRecurringOccurrencesInMonth } from '../../src/recurringOccurrences.js';
import { getAmountOn } from '../../src/amountSchedule.js';
import { getIncomePaydaysInMonth } from '../../src/utils.js';

const WINDOW_MONTHS = 12;

function icsEscape(text) {
    return String(text ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');
}

function icsFold(line) {
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

function isoDateStr(year, month, day) {
    return `${year}${String(month + 1).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}

function buildDesc(amount, category, account, appUrl, amountLabel = 'Amount Due') {
    const parts = [];
    if (Number(amount) > 0) parts.push(`${amountLabel}: $${Number(amount).toFixed(2)}`);
    if (category) parts.push(`Category: ${category}`);
    if (account) parts.push(`Account: ${account}`);
    if (appUrl) parts.push(`View in MyFinances: ${appUrl}`);
    return parts.join('\n');
}

// RFC 5545 YYYYMMDD -> YYYY-MM-DD (the form getAmountOn compares).
function dateStrToIso(dateStr) {
    return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
}

// RFC 5545 YYYYMMDD for the calendar day after dateStr.
function nextDayStr(dateStr) {
    const y = parseInt(dateStr.slice(0, 4), 10);
    const m = parseInt(dateStr.slice(4, 6), 10) - 1;
    const d = parseInt(dateStr.slice(6, 8), 10);
    const next = new Date(y, m, d + 1);
    return isoDateStr(next.getFullYear(), next.getMonth(), next.getDate());
}

function vevent(uid, summary, dateStr, description) {
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

export async function generateIcsFromDbRows(userId, baseUrl) {
    const [acctRes, billsRes, debtsRes, recurringRes, expensesRes, incomesRes, showArchivedRes] = await Promise.all([
        query('SELECT id, name FROM accounts WHERE user_id = $1', [userId]),
        query('SELECT id, name, amount, due_day, category, account_id FROM bills WHERE user_id = $1', [userId]),
        query('SELECT id, name, minimum_payment, due_date, weekend_rule, category, account_id, archived FROM debts WHERE user_id = $1', [userId]),
        query('SELECT id, name, type, amount, frequency, day_of_month, weekend_rule, category, account_id, start_date, end_date, paused, pause_until, skipped_months, paid_months, amount_changes FROM recurring_templates WHERE user_id = $1', [userId]),
        query('SELECT id, name, budget_amount, date, category, account_id FROM expenses WHERE user_id = $1', [userId]),
        query('SELECT id, name, amount, first_pay_date, frequency, account_id, amount_changes FROM incomes WHERE user_id = $1', [userId]),
        query("SELECT value FROM settings WHERE user_id = $1 AND key = 'showArchivedDebts'", [userId]),
    ]);

    // Mirrors the frontend's "Show archived debts" setting (settings.value is
    // jsonb, so pg hands back an already-parsed boolean).
    const showArchived = showArchivedRes.rows[0]?.value === true;
    const accountMap = Object.fromEntries(acctRes.rows.map(r => [r.id, r.name]));
    const now = new Date();
    const events = [];

    for (let delta = -WINDOW_MONTHS; delta <= WINDOW_MONTHS; delta++) {
        const ref = new Date(now.getFullYear(), now.getMonth() + delta, 1);
        const y = ref.getFullYear();
        const mo = ref.getMonth();
        const monthKey = `${y}-${String(mo + 1).padStart(2, '0')}`;
        const daysInMo = new Date(y, mo + 1, 0).getDate();

        for (const bill of billsRes.rows) {
            if (!bill.due_day) continue;
            const d = Math.min(bill.due_day, daysInMo);
            const dateStr = isoDateStr(y, mo, d);
            events.push(vevent(
                `bill-${bill.id}-${dateStr}@myfinances`,
                `Bill - ${bill.name}`,
                dateStr,
                buildDesc(bill.amount, bill.category, bill.account_id ? accountMap[bill.account_id] : null, baseUrl)
            ));
        }

        for (const debt of debtsRes.rows) {
            if (debt.archived && !showArchived) continue;
            if (!debt.due_date && !debt.next_payment_due) continue;
            let dateStr;
            if (debt.next_payment_due && debt.next_payment_due.startsWith(`${y}-${String(mo).padStart(2, '0')}`)) {
                dateStr = typeof debt.next_payment_due === 'string'
                    ? debt.next_payment_due.slice(0, 10)
                    : debt.next_payment_due.toISOString().slice(0, 10);
            } else if (debt.due_date) {
                const d = Math.min(debt.due_date, daysInMo);
                const due = applyWeekendRule(new Date(y, mo, d, 12), debt.weekend_rule);
                dateStr = isoDateStr(y, mo, due.getDate());
            } else {
                continue;
            }
            events.push(vevent(
                `debt-${debt.id}-${dateStr}@myfinances`,
                `${debt.archived ? 'Debt (Archived)' : 'Debt'} - ${debt.name}`,
                dateStr,
                buildDesc(debt.minimum_payment, debt.category, debt.account_id ? accountMap[debt.account_id] : null, baseUrl)
            ));
        }

        for (const row of recurringRes.rows) {
            if (row.paid_months?.includes(monthKey)) continue;
            const template = {
                paused: row.paused,
                pauseUntil: row.pause_until || null,
                skippedMonths: row.skipped_months || [],
                startDate: row.start_date || null,
                endDate: row.end_date || null,
                frequency: row.frequency,
                dayOfMonth: row.day_of_month,
                weekendRule: row.weekend_rule,
            };
            const occs = getRecurringOccurrencesInMonth(template, y, mo);
            const typeLabel = row.type === 'reimbursement' ? 'Reimbursement'
                : row.type === 'income' ? 'Income'
                : row.type === 'transfer' ? 'Transfer' : 'Subscription';
            for (const occ of occs) {
                const dateStr = isoDateStr(occ.getFullYear(), occ.getMonth(), occ.getDate());
                events.push(vevent(
                    `recurring-${row.id}-${dateStr}@myfinances`,
                    `${typeLabel} - ${row.name}`,
                    dateStr,
                    // #678: the amount in effect on this occurrence.
                    buildDesc(getAmountOn({ amount: row.amount, amountChanges: row.amount_changes }, dateStrToIso(dateStr)), row.category, row.account_id ? accountMap[row.account_id] : null, baseUrl)
                ));
            }
        }

        for (const inc of incomesRes.rows) {
            const income = { firstPayDate: inc.first_pay_date, frequency: inc.frequency };
            for (const pay of getIncomePaydaysInMonth(income, y, mo)) {
                const dateStr = isoDateStr(pay.getFullYear(), pay.getMonth(), pay.getDate());
                events.push(vevent(
                    `income-${inc.id}-${dateStr}@myfinances`,
                    `Payday - ${inc.name}`,
                    dateStr,
                    buildDesc(getAmountOn({ amount: inc.amount, amountChanges: inc.amount_changes }, dateStrToIso(dateStr)), null, inc.account_id ? accountMap[inc.account_id] : null, baseUrl, 'Amount')
                ));
            }
        }

        for (const exp of expensesRes.rows) {
            if (!exp.date) continue;
            // pg returns date columns as 'YYYY-MM-DD' strings
            const expDate = new Date(`${exp.date}T12:00:00`);
            if (expDate.getFullYear() !== y || expDate.getMonth() !== mo) continue;
            const dateStr = isoDateStr(y, mo, expDate.getDate());
            events.push(vevent(
                `expense-${exp.id}-${dateStr}@myfinances`,
                `Expense - ${exp.name}`,
                dateStr,
                buildDesc(exp.budget_amount, exp.category, exp.account_id ? accountMap[exp.account_id] : null, baseUrl)
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
