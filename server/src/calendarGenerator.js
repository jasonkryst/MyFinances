// Server-side ICS generator for the public calendar.ics endpoint.
// The occurrence engine below mirrors src/recurring.js::getRecurringOccurrencesInMonth —
// that function is a pure DOM-free calculation, duplicated here because the
// frontend ES module carries DOM-dependent imports that can't run in Node.

import { query } from './db.js';

const WINDOW_MONTHS = 12;

function getOccurrences(template, year, month) {
    if (template.paused) return [];

    const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
    if (Array.isArray(template.skippedMonths) && template.skippedMonths.includes(monthKey)) return [];

    const startDate = template.startDate ? new Date(`${template.startDate}T12:00:00`) : null;
    const endDate = template.endDate ? new Date(`${template.endDate}T12:00:00`) : null;
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);

    if (startDate && startDate > monthEnd) return [];
    if (endDate && endDate < monthStart) return [];

    const freq = template.frequency || 'monthly';
    const dom = Math.min(Math.max(Number(template.dayOfMonth) || 1, 1), 31);
    const daysInMo = new Date(year, month + 1, 0).getDate();
    const dates = [];

    if (freq === 'monthly') {
        const d = new Date(year, month, Math.min(dom, daysInMo), 12);
        if ((!startDate || d >= startDate) && (!endDate || d <= endDate)) dates.push(d);
    } else if (freq === 'quarterly') {
        if (!startDate) return [];
        const monthsFromStart = (year - startDate.getFullYear()) * 12 + (month - startDate.getMonth());
        if (monthsFromStart >= 0 && monthsFromStart % 3 === 0) {
            const d = new Date(year, month, Math.min(dom, daysInMo), 12);
            if (!endDate || d <= endDate) dates.push(d);
        }
    } else if (freq === 'yearly') {
        if (!startDate || startDate.getMonth() !== month) return dates;
        const d = new Date(year, month, Math.min(dom, daysInMo), 12);
        if (!endDate || d <= endDate) dates.push(d);
    } else if (freq === 'weekly' || freq === 'biweekly') {
        if (!startDate) return [];
        const interval = freq === 'weekly' ? 7 : 14;
        const MS = 24 * 60 * 60 * 1000;
        let cur = new Date(startDate);
        cur.setHours(12, 0, 0, 0);
        if (cur < monthStart) {
            const diffDays = Math.ceil((monthStart - cur) / MS);
            cur = new Date(cur.getTime() + Math.ceil(diffDays / interval) * interval * MS);
        }
        while (cur <= monthEnd) {
            if (!endDate || cur <= endDate) dates.push(new Date(cur));
            cur = new Date(cur.getTime() + interval * MS);
        }
    }
    return dates;
}

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

function buildDesc(amount, category, account) {
    const parts = [];
    if (Number(amount) > 0) parts.push(`Amount Due: $${Number(amount).toFixed(2)}`);
    if (category) parts.push(`Category: ${category}`);
    if (account) parts.push(`Account: ${account}`);
    return parts.join('\n');
}

function vevent(uid, summary, dateStr, description) {
    const lines = [
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTART:${dateStr}T090000`,
        `DTEND:${dateStr}T100000`,
        `SUMMARY:${icsEscape(summary)}`,
    ];
    if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
    lines.push('END:VEVENT');
    return lines.map(icsFold).join('');
}

export async function generateIcsFromDbRows(userId) {
    const [acctRes, billsRes, debtsRes, recurringRes, expensesRes] = await Promise.all([
        query('SELECT id, name FROM accounts WHERE user_id = $1', [userId]),
        query('SELECT id, name, amount, due_day, category, account_id FROM bills WHERE user_id = $1', [userId]),
        query('SELECT id, name, minimum_payment, due_date, category, account_id FROM debts WHERE user_id = $1', [userId]),
        query('SELECT id, name, type, amount, frequency, day_of_month, category, account_id, start_date, end_date, paused, skipped_months, paid_months FROM recurring_templates WHERE user_id = $1', [userId]),
        query('SELECT id, name, budget_amount, date, category, account_id FROM expenses WHERE user_id = $1', [userId]),
    ]);

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
                buildDesc(bill.amount, bill.category, bill.account_id ? accountMap[bill.account_id] : null)
            ));
        }

        for (const debt of debtsRes.rows) {
            if (!debt.due_date) continue;
            const d = Math.min(debt.due_date, daysInMo);
            const dateStr = isoDateStr(y, mo, d);
            events.push(vevent(
                `debt-${debt.id}-${dateStr}@myfinances`,
                `Debt - ${debt.name}`,
                dateStr,
                buildDesc(debt.minimum_payment, debt.category, debt.account_id ? accountMap[debt.account_id] : null)
            ));
        }

        for (const row of recurringRes.rows) {
            if (row.paid_months?.includes(monthKey)) continue;
            const template = {
                paused: row.paused,
                skippedMonths: row.skipped_months || [],
                startDate: row.start_date || null,
                endDate: row.end_date || null,
                frequency: row.frequency,
                dayOfMonth: row.day_of_month,
            };
            const occs = getOccurrences(template, y, mo);
            const typeLabel = row.type === 'reimbursement' ? 'Reimbursement'
                : row.type === 'transfer' ? 'Transfer' : 'Subscription';
            for (const occ of occs) {
                const dateStr = isoDateStr(occ.getFullYear(), occ.getMonth(), occ.getDate());
                events.push(vevent(
                    `recurring-${row.id}-${dateStr}@myfinances`,
                    `${typeLabel} - ${row.name}`,
                    dateStr,
                    buildDesc(row.amount, row.category, row.account_id ? accountMap[row.account_id] : null)
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
                buildDesc(exp.budget_amount, exp.category, exp.account_id ? accountMap[exp.account_id] : null)
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
