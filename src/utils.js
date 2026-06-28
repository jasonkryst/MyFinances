// Formatting, date helpers, shared utilities

export const APP_VERSION = '4.2.0';


// Format a number as a USD currency string (e.g., 1234.5 → "$1,234.50")
export function formatCurrency(value) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}

export function normalizeText(value, maxLen = 120) {
    const raw = String(value ?? '');
    return raw
        .replace(/[<>"`]/g, '')
        .replace(/[\u0000-\u001F\u007F]/g, '')
        .trim()
        .slice(0, maxLen);
}

export function sanitizeFiniteNumber(value, fallback = 0, { min = null, max = null } = {}) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    if (min !== null && n < min) return min;
    if (max !== null && n > max) return max;
    return n;
}

export function sanitizeInteger(value, fallback = null, { min = null, max = null } = {}) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    if (min !== null && n < min) return min;
    if (max !== null && n > max) return max;
    return n;
}

export function sanitizeDateISO(value) {
    if (!value) return null;
    const text = String(value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const date = new Date(`${text}T12:00:00`);
    if (Number.isNaN(date.getTime())) return null;
    return text;
}

export function todayISO() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Build (or replace) a visually-hidden <table> data-equivalent next to a chart
// canvas, so screen-reader users get the same information sighted users get
// from the chart. Looked up by the canvas's immediate parent element.
export function renderChartDataTable(canvasId, { caption, columns, rows }) {
    const canvas = document.getElementById(canvasId);
    const host = canvas ? canvas.parentElement : null;
    if (!host) return;

    const tableId = `${canvasId}-sr-table`;
    const existing = document.getElementById(tableId);
    if (existing) existing.remove();

    const theadHtml = `<tr>${columns.map(c => `<th scope="col">${escapeHtml(c)}</th>`).join('')}</tr>`;
    const tbodyHtml = rows.map(row =>
        `<tr>${row.map(cell => `<td>${escapeHtml(String(cell))}</td>`).join('')}</tr>`
    ).join('');

    host.insertAdjacentHTML('beforeend', `
        <table id="${tableId}" class="sr-only chart-sr-table">
            <caption>${escapeHtml(caption)}</caption>
            <thead>${theadHtml}</thead>
            <tbody>${tbodyHtml}</tbody>
        </table>
    `);
}

export function getDayOrdinal(day) {
    const j = day % 10;
    const k = day % 100;

    if (j === 1 && k !== 11) return day + 'st';
    if (j === 2 && k !== 12) return day + 'nd';
    if (j === 3 && k !== 13) return day + 'rd';
    return day + 'th';
}

// Return all payday dates for an income source within the given month.
// Supports both `firstPayDate` and legacy `firstDate` fields.
export function getIncomePaydaysInMonth(income, year, month) {
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);
    const msPerDay = 24 * 60 * 60 * 1000;
    const firstDate = income.firstPayDate || income.firstDate;
    const first = new Date((firstDate || '') + 'T12:00:00');
    if (isNaN(first.getTime())) return [];

    const paydays = [];
    const isBiweekly = income.frequency === 'biweekly' || income.frequency === 'bi-weekly';
    if (isBiweekly) {
        let pay = new Date(first);
        const diffDays = Math.floor((monthStart - pay) / msPerDay);
        const periods = Math.floor(diffDays / 14);
        pay = new Date(pay.getTime() + Math.max(0, periods) * 14 * msPerDay);
        while (pay < monthStart) pay = new Date(pay.getTime() + 14 * msPerDay);
        while (pay <= monthEnd) {
            paydays.push(new Date(pay));
            pay = new Date(pay.getTime() + 14 * msPerDay);
        }
    } else {
        const payDay = first.getDate();
        const daysInMonth = monthEnd.getDate();
        const actualDay = Math.min(payDay, daysInMonth);
        const candidate = new Date(year, month, actualDay, 12, 0, 0);
        if (candidate >= monthStart && candidate <= monthEnd) {
            paydays.push(candidate);
        }
    }

    return paydays;
}

export function countIncomePaydaysInMonth(income, year, month) {
    return getIncomePaydaysInMonth(income, year, month).length;
}

export function getNextIncomePayDates(income, n = 3, fromDate = new Date()) {
    const firstDate = income.firstPayDate || income.firstDate;
    const first = new Date((firstDate || '') + 'T12:00:00');
    if (isNaN(first.getTime())) return [];

    const msPerDay = 24 * 60 * 60 * 1000;
    const today = new Date(fromDate);
    today.setHours(0, 0, 0, 0);
    const dates = [];

    const isBiweekly = income.frequency === 'biweekly' || income.frequency === 'bi-weekly';
    if (isBiweekly) {
        let pay = new Date(first);
        const diffDays = Math.floor((today - pay) / msPerDay);
        if (diffDays > 0) {
            const periods = Math.floor(diffDays / 14);
            pay = new Date(pay.getTime() + periods * 14 * msPerDay);
        }
        while (pay < today) pay = new Date(pay.getTime() + 14 * msPerDay);
        while (dates.length < n) {
            dates.push(new Date(pay));
            pay = new Date(pay.getTime() + 14 * msPerDay);
        }
    } else {
        const payDay = first.getDate();
        let yr = today.getFullYear();
        let mo = today.getMonth();
        while (dates.length < n) {
            const daysInMonth = new Date(yr, mo + 1, 0).getDate();
            const actualDay = Math.min(payDay, daysInMonth);
            const candidate = new Date(yr, mo, actualDay, 12, 0, 0);
            if (candidate >= today) dates.push(candidate);
            mo++;
            if (mo > 11) {
                mo = 0;
                yr++;
            }
        }
    }

    return dates;
}

export function computeMonthlyBonusesForMonth(bonuses, year, month) {
    return (bonuses || []).reduce((sum, b) => {
        if (!b.date) return sum;
        const d = new Date(b.date + 'T12:00:00');
        if (d.getFullYear() === year && d.getMonth() === month) {
            return sum + (b.amount || 0);
        }
        return sum;
    }, 0);
}

export function computeMonthlyIncomeForMonth(incomes, bonuses, year, month) {
    let monthlyTotal = 0;
    for (const inc of (incomes || [])) {
        const count = countIncomePaydaysInMonth(inc, year, month);
        monthlyTotal += (inc.amount || 0) * count;
    }
    monthlyTotal += computeMonthlyBonusesForMonth(bonuses, year, month);
    return { monthlyTotal };
}

export function computeInterestPaidToDate(debt) {
    const isCC = !debt.debtType || debt.debtType === 'creditCard';
    if (!debt.debtStartDate || !isCC) return null;

    const start = new Date(debt.debtStartDate + 'T12:00:00');
    const today = new Date();
    if (isNaN(start.getTime()) || start >= today) return null;

    const origBal = debt.originalBalance || debt.accountBalance;
    const dailyRate = (debt.interestRate || 0) / 100 / 365;
    const days = Math.floor((today - start) / (1000 * 60 * 60 * 24));
    if (days <= 0) return null;

    const totalAccrued = origBal * (Math.pow(1 + dailyRate, days) - 1);
    const principalPaid = Math.max(0, origBal - debt.accountBalance);
    const interestPaid = Math.max(0, totalAccrued - principalPaid);
    return { interestPaid, days, start };
}

export function getBillsByDayForMonth(bills, year, month) {
    const dayBills = {};
    for (const bill of (bills || [])) {
        if (!bill.dueDay) continue;
        const daysInM = new Date(year, month + 1, 0).getDate();
        const day = Math.min(bill.dueDay, daysInM);
        if (!dayBills[day]) dayBills[day] = [];
        dayBills[day].push(bill);
    }
    return dayBills;
}

export function getExpensesByDayForMonth(expenses, year, month) {
    const dayExpenses = {};
    for (const exp of (expenses || [])) {
        if (!exp.date) continue;
        const ed = new Date(exp.date);
        if (ed.getFullYear() === year && ed.getMonth() === month) {
            const day = ed.getDate();
            if (!dayExpenses[day]) dayExpenses[day] = [];
            dayExpenses[day].push(exp);
        }
    }
    return dayExpenses;
}

export function getBonusesByDayForMonth(bonuses, year, month) {
    const dayBonuses = {};
    for (const b of (bonuses || [])) {
        if (!b.date) continue;
        const bd = new Date(b.date + 'T12:00:00');
        if (bd.getFullYear() === year && bd.getMonth() === month) {
            const day = bd.getDate();
            if (!dayBonuses[day]) dayBonuses[day] = [];
            dayBonuses[day].push(b);
        }
    }
    return dayBonuses;
}

export function getIncomeEventsByMonthForRange(incomes, startDate, endDate) {
    const byMonth = new Map();
    if (!startDate || !endDate) return byMonth;

    let y = startDate.getFullYear();
    let m = startDate.getMonth();
    const endY = endDate.getFullYear();
    const endM = endDate.getMonth();

    while (y < endY || (y === endY && m <= endM)) {
        const key = `${y}-${m}`;
        const events = [];
        for (const inc of (incomes || [])) {
            const paydays = getIncomePaydaysInMonth(inc, y, m);
            for (const payDate of paydays) {
                events.push({ name: inc.name, amount: inc.amount, day: payDate.getDate() });
            }
        }
        byMonth.set(key, events);

        m++;
        if (m > 11) {
            m = 0;
            y++;
        }
    }

    return byMonth;
}
