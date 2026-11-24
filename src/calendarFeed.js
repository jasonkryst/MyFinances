// Calendar feed: the .ics download and the subscription modal. The ICS text
// itself is built by the pure src/calendarCore.js, shared with the server's
// webcal feed (#526).

import { getCsrfCookie } from './storage.js';
import { getSetting, SHOW_ARCHIVED_DEBTS } from './settings.js';
import { discardBody } from './utils.js';
import { buildIcs } from './calendarCore.js';

// Generate a full ICS string from the current app state. `now` is injectable.
export function generateIcs(app, now = new Date()) {
    return buildIcs({
        accounts: app.accounts,
        bills: app.bills,
        debts: app.debts,
        recurringTemplates: app.recurringTemplates,
        incomes: app.incomes,
        expenses: app.expenses,
        // Mirrors the Liabilities page: archived debts only appear when the
        // "Show archived debts" setting is on, and are then labeled as such.
        showArchived: Boolean(getSetting(app, SHOW_ARCHIVED_DEBTS, false)),
        appUrl: window.location.origin,
        now,
    });
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
    try {
        const res = await fetch('/api/calendar/token');
        if (!res.ok) { await discardBody(res); return null; }
        const data = await res.json();
        return data.token || null;
    } catch {
        return null;  // offline or aborted: the dialog still opens and the ICS download still works
    }
}

async function postToken() {
    try {
        const res = await fetch('/api/calendar/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfCookie() }
        });
        if (!res.ok) { await discardBody(res); return null; }
        const data = await res.json();
        return data.token || null;
    } catch {
        return null;  // offline or aborted: leave the Generate button ready to try again
    }
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

    const onKeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };

    const close = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex-visible');
        document.removeEventListener('keydown', onKeydown);
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
        document.addEventListener('keydown', onKeydown);

        const section = document.getElementById('calendarSubscriptionSection');
        if (section) {
            section.classList.remove('hidden');
            const urlRow = document.getElementById('calendarTokenUrlRow');
            const genBtn = document.getElementById('calendarGenerateTokenBtn');
            if (urlRow) urlRow.classList.add('hidden');
            if (genBtn) { genBtn.classList.remove('hidden'); genBtn.disabled = false; genBtn.textContent = 'Generate subscription link'; }
            const token = await fetchToken();
            if (token) setTokenUrl(token);
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
