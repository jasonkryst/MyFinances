// Server-side ICS generator for the public calendar.ics endpoint. It only loads
// the user's rows and maps them to the app's record shapes; the ICS text, the
// event selection and the titles come from the pure src/calendarCore.js, the
// same module the browser's download uses (#526), imported by relative path
// (the Docker image copies src/ to /src, like the sanitizers).

import { query } from './db.js';
import { buildIcs } from '../../src/calendarCore.js';

export async function generateIcsFromDbRows(userId, baseUrl, now = new Date()) {
    const [acctRes, billsRes, debtsRes, recurringRes, expensesRes, incomesRes, showArchivedRes] = await Promise.all([
        query('SELECT id, name FROM accounts WHERE user_id = $1', [userId]),
        query('SELECT id, name, amount, due_day, category, account_id FROM bills WHERE user_id = $1', [userId]),
        query('SELECT id, name, minimum_payment, due_date, next_payment_due, weekend_rule, category, account_id, archived FROM debts WHERE user_id = $1', [userId]),
        query('SELECT id, name, type, amount, frequency, day_of_month, weekend_rule, category, account_id, start_date, end_date, paused, pause_until, skipped_months, paid_months, amount_changes, archived FROM recurring_templates WHERE user_id = $1', [userId]),
        query('SELECT id, name, budget_amount, date, category, account_id FROM expenses WHERE user_id = $1', [userId]),
        query('SELECT id, name, amount, first_pay_date, end_date, frequency, account_id, amount_changes FROM incomes WHERE user_id = $1', [userId]),
        query("SELECT value FROM settings WHERE user_id = $1 AND key = 'showArchivedDebts'", [userId]),
    ]);

    return buildIcs({
        accounts: acctRes.rows,
        bills: billsRes.rows.map(r => ({
            id: r.id, name: r.name, amount: r.amount, dueDay: r.due_day,
            category: r.category, accountId: r.account_id,
        })),
        debts: debtsRes.rows.map(r => ({
            id: r.id, name: r.name, minimumPayment: r.minimum_payment, dueDate: r.due_date,
            nextPaymentDue: r.next_payment_due, weekendRule: r.weekend_rule,
            category: r.category, accountId: r.account_id, archived: r.archived,
        })),
        recurringTemplates: recurringRes.rows.map(r => ({
            id: r.id, name: r.name, type: r.type, amount: r.amount, // amount-read-ok: base amount passed to getAmountOn
            amountChanges: r.amount_changes, frequency: r.frequency, dayOfMonth: r.day_of_month,
            weekendRule: r.weekend_rule, category: r.category, accountId: r.account_id,
            startDate: r.start_date || null, endDate: r.end_date || null,
            paused: r.paused, pauseUntil: r.pause_until || null,
            skippedMonths: r.skipped_months || [], paidMonths: r.paid_months || [],
            archived: r.archived,
        })),
        expenses: expensesRes.rows.map(r => ({
            id: r.id, name: r.name, budgetAmount: r.budget_amount, date: r.date,
            category: r.category, accountId: r.account_id,
        })),
        incomes: incomesRes.rows.map(r => ({
            id: r.id, name: r.name, amount: r.amount, // amount-read-ok: base amount passed to getAmountOn
            amountChanges: r.amount_changes, firstPayDate: r.first_pay_date,
            endDate: r.end_date, frequency: r.frequency, accountId: r.account_id,
        })),
        // Mirrors the frontend's "Show archived debts" setting (settings.value is
        // jsonb, so pg hands back an already-parsed boolean).
        showArchived: showArchivedRes.rows[0]?.value === true,
        appUrl: baseUrl,
        now,
    });
}
