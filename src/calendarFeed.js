// Calendar feed: ICS generation and subscription modal for bills, debts,
// recurring templates, expenses, and income paydays.

import { getRecurringOccurrencesInMonth } from './recurring.js';
import { getCsrfCookie } from './storage.js';
import { getSetting, SHOW_ARCHIVED_DEBTS } from './settings.js';
import { getIncomePaydaysInMonth } from './utils.js';

const WINDOW_MONTHS = 12;

// RFC 5545 text value escaping.
function icsEscape(text) {
    return String(text ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');
}

// RFC 5545 line folding: max 75 octets per physical line, CRLF + space.
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

// Format year/month(0-indexed)/day as YYYYMMDD.
function isoDateStr(year, month, day) {
    return `${year}${String(month + 1).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}

// Build a DESCRIPTION value (raw string, not yet escaped).
function buildDesc(amount, category, account, appUrl, amountLabel = 'Amount Due') {
    const parts = [];
    if (Number(amount) > 0) parts.push(`${amountLabel}: $${Number(amount).toFixed(2)}`);
    if (category) parts.push(`Category: ${category}`);
    if (account) parts.push(`Account: ${account}`);
    if (appUrl) parts.push(`View in MyFinances: ${appUrl}`);
    return parts.join('\n');
}

// RFC 5545 YYYYMMDD for the calendar day after dateStr.
function nextDayStr(dateStr) {
    const y = parseInt(dateStr.slice(0, 4), 10);
    const m = parseInt(dateStr.slice(4, 6), 10) - 1;
    const d = parseInt(dateStr.slice(6, 8), 10);
    const next = new Date(y, m, d + 1);
    return isoDateStr(next.getFullYear(), next.getMonth(), next.getDate());
}

// Build a single VEVENT block (all-day, already CRLF-terminated).
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

// Generate a full ICS string from the current app state.
export function generateIcs(app) {
    const accountMap = Object.fromEntries((app.accounts || []).map(a => [a.id, a.name]));
    const appUrl = window.location.origin;
    // Mirrors the Liabilities page: archived debts only appear when the
    // "Show archived debts" setting is on, and are then labeled as such.
    const showArchived = Boolean(getSetting(app, SHOW_ARCHIVED_DEBTS, false));
    const now = new Date();
    const events = [];

    for (let delta = -WINDOW_MONTHS; delta <= WINDOW_MONTHS; delta++) {
        const ref = new Date(now.getFullYear(), now.getMonth() + delta, 1);
        const y = ref.getFullYear();
        const mo = ref.getMonth();
        const monthKey = `${y}-${String(mo + 1).padStart(2, '0')}`;
        const daysInMo = new Date(y, mo + 1, 0).getDate();

        for (const bill of app.bills || []) {
            if (!bill.dueDay) continue;
            const d = Math.min(bill.dueDay, daysInMo);
            const dateStr = isoDateStr(y, mo, d);
            events.push(vevent(
                `bill-${bill.id}-${dateStr}@myfinances`,
                `Bill - ${bill.name}`,
                dateStr,
                buildDesc(bill.amount, bill.category, bill.accountId ? accountMap[bill.accountId] : null, appUrl)
            ));
        }

        for (const debt of app.debts || []) {
            if (debt.archived && !showArchived) continue;
            if (!debt.dueDate) continue;
            const d = Math.min(debt.dueDate, daysInMo);
            const dateStr = isoDateStr(y, mo, d);
            events.push(vevent(
                `debt-${debt.id}-${dateStr}@myfinances`,
                `${debt.archived ? 'Debt (Archived)' : 'Debt'} - ${debt.name}`,
                dateStr,
                buildDesc(debt.minimumPayment, debt.category, debt.accountId ? accountMap[debt.accountId] : null, appUrl)
            ));
        }

        for (const t of app.recurringTemplates || []) {
            if (t.paidMonths?.includes(monthKey)) continue;
            const typeLabel = t.type === 'reimbursement' ? 'Reimbursement'
                : t.type === 'transfer' ? 'Transfer' : 'Subscription';
            const occs = getRecurringOccurrencesInMonth(t, y, mo);
            for (const occ of occs) {
                const dateStr = isoDateStr(occ.getFullYear(), occ.getMonth(), occ.getDate());
                events.push(vevent(
                    `recurring-${t.id}-${dateStr}@myfinances`,
                    `${typeLabel} - ${t.name}`,
                    dateStr,
                    buildDesc(t.amount, t.category, t.accountId ? accountMap[t.accountId] : null, appUrl)
                ));
            }
        }

        for (const inc of app.incomes || []) {
            for (const pay of getIncomePaydaysInMonth(inc, y, mo)) {
                const dateStr = isoDateStr(pay.getFullYear(), pay.getMonth(), pay.getDate());
                events.push(vevent(
                    `income-${inc.id}-${dateStr}@myfinances`,
                    `Payday - ${inc.name}`,
                    dateStr,
                    buildDesc(inc.amount, null, inc.accountId ? accountMap[inc.accountId] : null, appUrl, 'Amount')
                ));
            }
        }

        for (const exp of app.expenses || []) {
            if (!exp.date) continue;
            const expDate = exp.date instanceof Date ? exp.date : new Date(exp.date);
            if (expDate.getFullYear() !== y || expDate.getMonth() !== mo) continue;
            const dateStr = isoDateStr(y, mo, expDate.getDate());
            events.push(vevent(
                `expense-${exp.id}-${dateStr}@myfinances`,
                `Expense - ${exp.name}`,
                dateStr,
                buildDesc(exp.budgetAmount, exp.category, exp.accountId ? accountMap[exp.accountId] : null, appUrl)
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

// Trigger a browser download of the ICS file.
export function downloadIcs(app) {
    const blob = new Blob([generateIcs(app)], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'myfinances.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function fetchToken() {
    const res = await fetch('/api/calendar/token');
    if (!res.ok) return null;
    const data = await res.json();
    return data.token || null;
}

async function postToken() {
    const res = await fetch('/api/calendar/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfCookie() }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.token || null;
}

function subscriptionUrl(token) {
    return `webcal://${window.location.host}/calendar.ics?token=${token}`;
}

export function initCalendarFeedModal(app) {
    const modal = document.getElementById('calendarFeedModal');
    const openBtn = document.getElementById('calendarFeedBtn');
    const closeBtn = document.getElementById('calendarFeedModalCloseBtn');
    if (!modal || !openBtn || !closeBtn) return;

    let lastFocused = null;

    const close = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex-visible');
        modal.onkeydown = null;
        if (lastFocused?.focus) lastFocused.focus();
    };

    const setTokenUrl = (token) => {
        const urlEl = document.getElementById('calendarTokenUrl');
        const urlRow = document.getElementById('calendarTokenUrlRow');
        const genBtn = document.getElementById('calendarGenerateTokenBtn');
        if (urlEl) urlEl.textContent = subscriptionUrl(token);
        if (urlRow) urlRow.classList.remove('hidden');
        if (genBtn) genBtn.classList.add('hidden');
    };

    const open = async () => {
        lastFocused = document.activeElement;
        modal.classList.add('flex-visible');
        modal.classList.remove('hidden');
        modal.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };

        const section = document.getElementById('calendarSubscriptionSection');
        if (section) {
            if (app._storageBackendKind === 'postgres') {
                section.classList.remove('hidden');
                const urlRow = document.getElementById('calendarTokenUrlRow');
                const genBtn = document.getElementById('calendarGenerateTokenBtn');
                if (urlRow) urlRow.classList.add('hidden');
                if (genBtn) { genBtn.classList.remove('hidden'); genBtn.disabled = false; genBtn.textContent = 'Generate subscription link'; }
                const token = await fetchToken();
                if (token) setTokenUrl(token);
            } else {
                section.classList.add('hidden');
            }
        }

        const downloadBtn = document.getElementById('calendarDownloadBtn');
        setTimeout(() => downloadBtn?.focus(), 30);
    };

    openBtn.onclick = open;
    closeBtn.onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };

    document.getElementById('calendarDownloadBtn')?.addEventListener('click', () => downloadIcs(app));

    document.getElementById('calendarGenerateTokenBtn')?.addEventListener('click', async () => {
        const btn = document.getElementById('calendarGenerateTokenBtn');
        btn.disabled = true;
        btn.textContent = 'Generating…';
        const token = await postToken();
        if (token) setTokenUrl(token);
        else { btn.disabled = false; btn.textContent = 'Generate subscription link'; }
    });

    document.getElementById('calendarCopyUrlBtn')?.addEventListener('click', async () => {
        const urlEl = document.getElementById('calendarTokenUrl');
        if (!urlEl?.textContent) return;
        await navigator.clipboard.writeText(urlEl.textContent);
        const btn = document.getElementById('calendarCopyUrlBtn');
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 2000);
    });

    document.getElementById('calendarRegenerateTokenBtn')?.addEventListener('click', async () => {
        const btn = document.getElementById('calendarRegenerateTokenBtn');
        btn.disabled = true;
        btn.textContent = 'Regenerating…';
        const token = await postToken();
        btn.disabled = false;
        btn.textContent = 'Regenerate';
        if (token) setTokenUrl(token);
    });
}
