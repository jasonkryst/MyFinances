// Formatting, date helpers, shared utilities
import { getIntlLocale, getCurrencyCode } from './i18n.js';

export const APP_VERSION = '6.50.0';

// Returns a debounced wrapper that delays invoking `fn` until `waitMs` has
// elapsed since the last call — for expensive work triggered by
// high-frequency events (e.g. a range slider's `input` event).
export function debounce(fn, waitMs) {
    let timeoutId = null;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), waitMs);
    };
}

// Format a number as a currency string using the user's chosen currency code
// and locale (e.g. 1234.5 → "$1,234.50" for USD/en-US, "€1.234,50" for EUR/es-ES).
// Both the currency code and locale follow user preferences set in Settings.
export function formatCurrency(value) {
    return new Intl.NumberFormat(getIntlLocale(), {
        style: 'currency',
        currency: getCurrencyCode(),
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

export function parseFiniteOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

// Formats a bare "YYYY-MM-DD" string, an ISO datetime string, or a Date object as "Mon D, YYYY".
// Bare dates are padded with T12:00:00 before parsing so they don't roll back a day in
// negative-UTC-offset timezones (new Date("2026-07-15") parses as UTC midnight).
export function formatShortDate(value) {
    const isBareDate = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    const date = isBareDate ? new Date(`${value}T12:00:00`) : new Date(value);
    return date.toLocaleDateString(getIntlLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
}

// Formats a bare "YYYY-MM-DD" string, an ISO datetime string, or a Date object as "Mon YYYY".
// Bare dates are padded with T12:00:00 before parsing so they don't roll back a day in
// negative-UTC-offset timezones (new Date("2026-07-15") parses as UTC midnight).
export function formatMonthYear(value) {
    const isBareDate = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    const date = isBareDate ? new Date(`${value}T12:00:00`) : new Date(value);
    return date.toLocaleDateString(getIntlLocale(), { month: 'short', year: 'numeric' });
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
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        const date = new Date(`${text}T12:00:00`);
        if (Number.isNaN(date.getTime())) return null;
        return text;
    }
    // Heal legacy full ISO timestamps stored by Date.toISOString() (e.g. '2026-08-30T05:00:00.000Z')
    const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})T/);
    if (isoMatch) {
        const datePart = isoMatch[1];
        const date = new Date(`${datePart}T12:00:00`);
        if (!Number.isNaN(date.getTime())) return datePart;
    }
    return null;
}

export function sanitizeTimestampISO(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
}

export function dateToISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function todayISO() {
    return dateToISO(new Date());
}

export function getReportDate(app) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + app._reportMonthOffset, 1);
}

// Shared by the Spending and Variance reports (issue #329): both support
// aggregating across a multi-month range ending at the report's current
// month, rather than just that single month. `app._reportRangeMonths`
// (default 1, meaning "single month" - the pre-#329 behavior) is the one
// shared piece of range state; it lives on `app` rather than a module-local
// variable so it gets reset to 1 by the exact same resetToDefaults path in
// renderPageData() that already zeroes app._reportMonthOffset on navigation
// into Reports, and so Spending/Variance stay in sync when switching tabs.
export function getReportRangeMonths(app) {
    return app._reportRangeMonths && app._reportRangeMonths > 1 ? app._reportRangeMonths : 1;
}

// Chronological (oldest-first) list of { year, month } for the rangeMonths
// months ending at (year, month) inclusive.
export function reportRangeMonthsList(year, month, rangeMonths) {
    const months = [];
    for (let i = rangeMonths - 1; i >= 0; i--) {
        let m = month - i, y = year;
        while (m < 0) { m += 12; y--; }
        months.push({ year: y, month: m });
    }
    return months;
}

// The end month of the equivalent-length range immediately preceding the
// range ending at (year, month) - e.g. for a 3-month range ending Sep 2026
// (Jul-Sep), this returns Jun 2026, so the caller can build Apr-Jun 2026.
export function getPriorEquivalentRangeEnd(year, month, rangeMonths) {
    let m = month - rangeMonths, y = year;
    while (m < 0) { m += 12; y--; }
    return { year: y, month: m };
}

// Short label for a report range: a single month name for rangeMonths===1,
// or "<start short month> – <end short month> <year>" otherwise (crossing a
// year boundary spells out both years, e.g. "Dec 2025 – Feb 2026").
export function formatReportRangeLabel(year, month, rangeMonths) {
    const end = new Date(year, month, 1);
    if (rangeMonths <= 1) {
        return end.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    const months = reportRangeMonthsList(year, month, rangeMonths);
    const start = new Date(months[0].year, months[0].month, 1);
    const sameYear = start.getFullYear() === end.getFullYear();
    const startLabel = start.toLocaleDateString('en-US', sameYear ? { month: 'short' } : { month: 'short', year: 'numeric' });
    const endLabel = end.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    return `${startLabel} – ${endLabel}`;
}

// Pinned category->color overrides shared by spending.js (categoryColor())
// and recurring.js (its category color-picker's suggested-colors list).
// Lives here, not in spending.js, because recurring.js -> spending.js ->
// ledgerTransactions.js -> recurring.js forms a 3-module import cycle
// (ledgerTransactions.js pulls in getRecurringOccurrencesInMonth, spending.js
// pulls in getLedgerTransactionsForMonth) - a `const` export read across
// that cycle intermittently throws "Cannot access before initialization"
// depending on which module the browser happens to evaluate first. utils.js
// has no outgoing edge back into that cycle, so importing this constant
// from here instead is cycle-safe. See CLAUDE.md's "Module import
// constraints" section for the same hazard class in the ui.js/postgresSync.js
// cycle.
export const PINNED_COLORS = { 'Debt Payments': '#ef4444', 'Savings': '#10b981' };

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

// Issue #278: graceful fallback for a lazily-`import()`ed feature module
// that failed to load (e.g. a network error, or offline in a PWA session
// before the service worker's precache has populated). Replaces the target
// container's content with a plain-language message — built with
// createElement/textContent, never innerHTML of interpolated text, per the
// CSP/XSS conventions in CLAUDE.md — so a failed dynamic import degrades to
// an in-page error state instead of a blank section or an unhandled
// rejection reaching the browser.
export function renderLazyLoadError(containerId, label) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'lazy-load-error';
    const msg = document.createElement('p');
    msg.textContent = `Couldn't load ${label}. Check your connection and try again.`;
    wrap.appendChild(msg);
    container.appendChild(wrap);
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
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);
    const msPerDay = 24 * 60 * 60 * 1000;
    const firstDate = income.firstPayDate || income.firstDate;
    const first = new Date((firstDate || '') + 'T12:00:00');
    if (isNaN(first.getTime())) return [];

    const paydays = [];
    const freq = income.frequency;
    const isBiweekly = freq === 'biweekly' || freq === 'bi-weekly';
    const isWeekly = freq === 'weekly';
    const isTwiceMonthly = freq === 'twice_monthly';

    if (isWeekly || isBiweekly) {
        const interval = isWeekly ? 7 : 14;
        let pay = new Date(first);
        const diffDays = Math.floor((monthStart - pay) / msPerDay);
        const periods = Math.floor(diffDays / interval);
        pay = new Date(pay.getTime() + Math.max(0, periods) * interval * msPerDay);
        while (pay < monthStart) pay = new Date(pay.getTime() + interval * msPerDay);
        while (pay <= monthEnd) {
            paydays.push(new Date(pay));
            pay = new Date(pay.getTime() + interval * msPerDay);
        }
    } else if (isTwiceMonthly) {
        const daysInMonth = monthEnd.getDate();
        const mid = new Date(year, month, 15, 12, 0, 0);
        const last = new Date(year, month, daysInMonth, 12, 0, 0);
        if (mid >= first) paydays.push(mid);
        if (last >= first) paydays.push(last);
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

    const freq2 = income.frequency;
    const isBiweekly = freq2 === 'biweekly' || freq2 === 'bi-weekly';
    const isWeekly2 = freq2 === 'weekly';
    const isTwiceMonthly2 = freq2 === 'twice_monthly';

    if (isWeekly2 || isBiweekly) {
        const interval = isWeekly2 ? 7 : 14;
        let pay = new Date(first);
        const diffDays = Math.floor((today - pay) / msPerDay);
        if (diffDays > 0) {
            const periods = Math.floor(diffDays / interval);
            pay = new Date(pay.getTime() + periods * interval * msPerDay);
        }
        while (pay < today) pay = new Date(pay.getTime() + interval * msPerDay);
        while (dates.length < n) {
            dates.push(new Date(pay));
            pay = new Date(pay.getTime() + interval * msPerDay);
        }
    } else if (isTwiceMonthly2) {
        let yr = today.getFullYear();
        let mo = today.getMonth();
        while (dates.length < n) {
            const daysInMonth = new Date(yr, mo + 1, 0).getDate();
            const mid = new Date(yr, mo, 15, 12, 0, 0);
            const last = new Date(yr, mo, daysInMonth, 12, 0, 0);
            if (mid >= today && mid >= first && dates.length < n) dates.push(mid);
            if (last >= today && last >= first && dates.length < n) dates.push(last);
            mo++;
            if (mo > 11) { mo = 0; yr++; }
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

// Returns the take-home (net) amount for a single paycheck after applying
// the income's optional withholdingPercent (issue #251) — 0 by default, so
// an income record with no withholding set returns its raw `amount`
// unchanged (fully backward compatible).
export function computeNetIncomeAmount(income) {
    const pct = income?.withholdingPercent || 0;
    return (income?.amount || 0) * (1 - pct / 100);
}

// Returns the net (take-home) monthly income total — every call site is a
// cash-flow/affordability calculation, so withholding is applied here rather
// than at each caller (issue #251). Bonuses are never withheld.
export function computeMonthlyIncomeForMonth(incomes, bonuses, year, month) {
    let monthlyTotal = 0;
    for (const inc of (incomes || [])) {
        const count = countIncomePaydaysInMonth(inc, year, month);
        monthlyTotal += computeNetIncomeAmount(inc) * count;
    }
    monthlyTotal += computeMonthlyBonusesForMonth(bonuses, year, month);
    return { monthlyTotal };
}

// Sum of this month's active savings contributions (emergency fund monthly
// contributions + sinking fund monthly allocations) — shared by Health's
// Savings Rate card and the Savings page's rate summary panel (issue #303)
// so the two pages can never disagree about what counts as "saving".
export function computeTotalSavingsContribution(app) {
    return (app.emergencyFunds || []).reduce((s, f) => s + (f.monthlyContribution || 0), 0) +
           (app.sinkingFunds   || []).reduce((s, f) => s + (f.monthlyAllocation   || 0), 0);
}

export function dailyCompoundInterest(balance, aprPct, days) {
    const dailyRate = (aprPct || 0) / 100 / 365;
    return balance * (Math.pow(1 + dailyRate, days) - 1);
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

export function buildPersonPillsHtml(personIds, persons) {
    if (!personIds || !personIds.length || !persons || !persons.length) return '';
    const names = personIds.map(id => (persons || []).find(p => p.id === id)?.name).filter(Boolean);
    return names.map(n => `<span class="person-pill">${escapeHtml(n)}</span>`).join('');
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

