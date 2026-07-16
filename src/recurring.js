// Recurring Transaction Templates — subscriptions, reimbursements, transfers

import {
    formatCurrency,
    normalizeText,
    sanitizeFiniteNumber,
    sanitizeInteger,
    sanitizeDateISO,
    escapeHtml
} from './utils.js';
import { buildAccountOptionsHtml } from './accounts.js';

const TYPES = ['subscription', 'reimbursement', 'transfer'];
const TYPE_LABELS = {
    subscription: 'Subscription / Expense',
    reimbursement: 'Reimbursement / Income',
    transfer: 'Transfer'
};
const TYPE_ICONS = { subscription: '📦', reimbursement: '💸', transfer: '🔄' };

const FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
const FREQ_LABELS = {
    weekly: 'Weekly',
    biweekly: 'Every 2 weeks',
    monthly: 'Monthly',
    quarterly: 'Quarterly',
    yearly: 'Yearly'
};

const CATEGORIES = [
    'Subscription', 'Insurance', 'Rent / Mortgage', 'Utilities', 'Transport',
    'Food', 'Entertainment', 'Health', 'Education', 'Savings', 'Transfer',
    'Reimbursement', 'Other'
];

// ─── Occurrence calculation ────────────────────────────────────────────────────

/**
 * Returns an array of Date objects for all occurrences of this template in
 * the given calendar month (year/month where month is 0-indexed).
 */
export function getRecurringOccurrencesInMonth(template, year, month) {
    if (!template || template.paused) return [];

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

    return dates;
}

// ─── Rendering ────────────────────────────────────────────────────────────────

export function renderRecurringPage(app) {
    const container = document.getElementById('recurringList');
    if (!container) return;

    const templates = app.recurringTemplates || [];

    if (templates.length === 0) {
        container.innerHTML = `<p class="recurring-empty-msg">No recurring templates yet. Add your first subscription, reimbursement, or transfer above.</p>`;
        return;
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;

    const cards = templates.map(t => {
        if (app.editingRecurringId === t.id) {
            return _buildEditCard(app, t);
        }
        return _buildReadCard(app, t, year, month, monthKey);
    }).join('');

    container.innerHTML = cards;

    container.onclick = (event) => {
        const actionEl = event.target.closest('[data-recurring-action]');
        if (!actionEl) return;
        const action = actionEl.getAttribute('data-recurring-action');
        const id = parseInt(actionEl.getAttribute('data-recurring-id'), 10);
        const mk = actionEl.getAttribute('data-recurring-monthkey') || null;
        if (action === 'cancel') { app.cancelEditRecurring(); return; }
        if (Number.isNaN(id)) return;
        if (action === 'edit') app.startEditRecurring(id);
        else if (action === 'save') app.saveEditRecurring(id);
        else if (action === 'delete') {
            if (confirm(`Delete "${app.recurringTemplates?.find(x => x.id === id)?.name || 'template'}"? This cannot be undone.`)) {
                app.deleteRecurringTemplate(id);
            }
        }
        else if (action === 'pause') app.pauseRecurringTemplate(id, true);
        else if (action === 'unpause') app.pauseRecurringTemplate(id, false);
        else if (action === 'skip') app.skipRecurringOccurrence(id, mk, false);
        else if (action === 'unskip') app.skipRecurringOccurrence(id, mk, true);
        else if (action === 'mark-paid') app.markRecurringPaid(id, mk, false);
        else if (action === 'unmark-paid') app.markRecurringPaid(id, mk, true);
    };
}

function _buildReadCard(app, t, year, month, monthKey) {
    const typeLabel = TYPE_LABELS[t.type] || t.type;
    const typeIcon = TYPE_ICONS[t.type] || '📋';
    const freqLabel = FREQ_LABELS[t.frequency] || t.frequency;

    // Reimbursements show as positive; everything else as negative
    const sign = t.type === 'reimbursement' ? '+' : '-';
    const amountClass = t.type === 'reimbursement' ? 'recurring-amount--pos' : 'recurring-amount--neg';

    const occurrences = getRecurringOccurrencesInMonth(t, year, month);
    const thisMonthTotal = occurrences.length * (t.amount || 0);
    const isSkippedThisMonth = Array.isArray(t.skippedMonths) && t.skippedMonths.includes(monthKey);
    const isPaidThisMonth = Array.isArray(t.paidMonths) && t.paidMonths.includes(monthKey);

    let statusBadge;
    if (t.paused) {
        statusBadge = `<span class="recurring-badge recurring-badge--paused">⏸ Paused</span>`;
    } else if (isSkippedThisMonth) {
        statusBadge = `<span class="recurring-badge recurring-badge--skipped">⏭ Skipped this month</span>`;
    } else if (occurrences.length > 0 && isPaidThisMonth) {
        statusBadge = `<span class="recurring-badge recurring-badge--paid">✅ Paid this month</span>`;
    } else if (occurrences.length > 0) {
        statusBadge = `<span class="recurring-badge recurring-badge--active">✅ Active</span>`;
    } else {
        statusBadge = `<span class="recurring-badge recurring-badge--pending">⏳ No hits this month</span>`;
    }

    const nextDates = occurrences.slice(0, 2)
        .map(d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
        .join(', ');

    const srcAccount = app.accounts?.find(a => a.id === t.accountId);
    const tgtAccount = t.targetAccountId ? app.accounts?.find(a => a.id === t.targetAccountId) : null;
    const accountLine = srcAccount
        ? tgtAccount
            ? `${escapeHtml(srcAccount.name)} → ${escapeHtml(tgtAccount.name)}`
            : escapeHtml(srcAccount.name)
        : '—';

    const thisMonthLine = (occurrences.length > 0 && !t.paused && !isSkippedThisMonth)
        ? `<span class="recurring-this-month">This month: <strong>${sign}${formatCurrency(thisMonthTotal)}</strong> (${occurrences.length}×${nextDates ? ' on ' + nextDates : ''})</span>`
        : '';

    return `<div class="recurring-card${t.paused ? ' recurring-card--paused' : ''}">
        <div class="recurring-card-header">
            <span class="recurring-type-icon">${typeIcon}</span>
            <div class="recurring-card-info">
                <span class="recurring-card-name">${escapeHtml(t.name)}</span>
                <span class="recurring-type-label">${escapeHtml(typeLabel)}</span>
            </div>
            <div class="recurring-card-right">
                <span class="recurring-amount ${amountClass}">${sign}${formatCurrency(t.amount)}</span>
                <span class="recurring-freq-badge">${escapeHtml(freqLabel)}</span>
            </div>
        </div>
        <div class="recurring-card-meta">
            <span class="recurring-meta-item">🏦 ${accountLine}</span>
            <span class="recurring-meta-item">🏷 ${escapeHtml(t.category || 'Other')}</span>
            ${t.startDate ? `<span class="recurring-meta-item">📅 Since ${escapeHtml(t.startDate)}</span>` : ''}
            ${t.endDate ? `<span class="recurring-meta-item">🔚 Until ${escapeHtml(t.endDate)}</span>` : ''}
        </div>
        <div class="recurring-card-status">
            ${statusBadge}
            ${thisMonthLine}
        </div>
        <div class="recurring-card-actions">
            <button class="btn btn-secondary btn-small" data-recurring-action="edit" data-recurring-id="${t.id}">Edit</button>
            ${t.paused
                ? `<button class="btn btn-secondary btn-small" data-recurring-action="unpause" data-recurring-id="${t.id}">▶ Resume</button>`
                : `<button class="btn btn-secondary btn-small" data-recurring-action="pause" data-recurring-id="${t.id}">⏸ Pause</button>`}
            ${(!t.paused && !isSkippedThisMonth && occurrences.length > 0)
                ? (isPaidThisMonth
                    ? `<button class="btn btn-secondary btn-small" data-recurring-action="unmark-paid" data-recurring-id="${t.id}" data-recurring-monthkey="${monthKey}">↩ Unmark paid</button>`
                    : `<button class="btn btn-secondary btn-small" data-recurring-action="mark-paid" data-recurring-id="${t.id}" data-recurring-monthkey="${monthKey}">✅ Mark as paid</button>`)
                : ''}
            ${isSkippedThisMonth
                ? `<button class="btn btn-secondary btn-small" data-recurring-action="unskip" data-recurring-id="${t.id}" data-recurring-monthkey="${monthKey}">↩ Unskip</button>`
                : !t.paused
                    ? `<button class="btn btn-secondary btn-small" data-recurring-action="skip" data-recurring-id="${t.id}" data-recurring-monthkey="${monthKey}">⏭ Skip month</button>`
                    : ''}
            <button class="btn btn-danger btn-small" data-recurring-action="delete" data-recurring-id="${t.id}">Delete</button>
        </div>
    </div>`;
}

function _buildEditCard(app, t) {
    const accountOptions = buildAccountOptionsHtml(app.accounts, t.accountId);
    const targetOptions = buildAccountOptionsHtml(app.accounts, t.targetAccountId, { emptyLabel: '— None —' });

    const typeOpts = TYPES.map(tp =>
        `<option value="${tp}" ${t.type === tp ? 'selected' : ''}>${escapeHtml(TYPE_LABELS[tp])}</option>`
    ).join('');
    const freqOpts = FREQUENCIES.map(f =>
        `<option value="${f}" ${t.frequency === f ? 'selected' : ''}>${escapeHtml(FREQ_LABELS[f])}</option>`
    ).join('');
    const catOpts = CATEGORIES.map(c =>
        `<option value="${c}" ${t.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`
    ).join('');

    return `<div class="recurring-card recurring-card--editing">
        <div class="recurring-edit-grid">
            <div class="form-group recurring-edit-field">
                <label>Name *</label>
                <input type="text" id="re-name-${t.id}" value="${escapeHtml(t.name)}" maxlength="80">
            </div>
            <div class="form-group recurring-edit-field">
                <label>Type</label>
                <select id="re-type-${t.id}">${typeOpts}</select>
            </div>
            <div class="form-group recurring-edit-field">
                <label>Amount ($) *</label>
                <input type="number" id="re-amount-${t.id}" value="${t.amount}" min="0.01" step="0.01">
            </div>
            <div class="form-group recurring-edit-field">
                <label>Frequency</label>
                <select id="re-freq-${t.id}">${freqOpts}</select>
            </div>
            <div class="form-group recurring-edit-field">
                <label>Day of Month</label>
                <input type="number" id="re-day-${t.id}" value="${t.dayOfMonth || ''}" min="1" max="31">
            </div>
            <div class="form-group recurring-edit-field">
                <label>Category</label>
                <select id="re-cat-${t.id}">${catOpts}</select>
            </div>
            <div class="form-group recurring-edit-field">
                <label>Account</label>
                <select id="re-acct-${t.id}">
                    <option value="">— No account —</option>
                    ${accountOptions}
                </select>
            </div>
            <div class="form-group recurring-edit-field">
                <label>Target Account (transfers)</label>
                <select id="re-tacct-${t.id}">${targetOptions}</select>
            </div>
            <div class="form-group recurring-edit-field">
                <label>Start Date</label>
                <input type="date" id="re-start-${t.id}" value="${t.startDate || ''}">
            </div>
            <div class="form-group recurring-edit-field">
                <label>End Date (optional)</label>
                <input type="date" id="re-end-${t.id}" value="${t.endDate || ''}">
            </div>
        </div>
        <div class="recurring-edit-actions">
            <button class="btn btn-primary btn-small" data-recurring-action="save" data-recurring-id="${t.id}">Save</button>
            <button class="btn btn-secondary btn-small" data-recurring-action="cancel">Cancel</button>
        </div>
    </div>`;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function addRecurringTemplate(app) {
    const name = normalizeText(document.getElementById('recurringName')?.value, 80);
    const type = document.getElementById('recurringType')?.value || 'subscription';
    const rawAmount = document.getElementById('recurringAmount')?.value;
    const amount = sanitizeFiniteNumber(rawAmount, NaN, { min: 0.01 });
    const frequency = document.getElementById('recurringFrequency')?.value || 'monthly';
    const dayOfMonth = sanitizeInteger(document.getElementById('recurringDayOfMonth')?.value, 1, { min: 1, max: 31 });
    const category = normalizeText(document.getElementById('recurringCategory')?.value, 40) || 'Other';
    const accountId = parseInt(document.getElementById('recurringAccount')?.value, 10) || null;
    const targetAccountId = parseInt(document.getElementById('recurringTargetAccount')?.value, 10) || null;
    const startDate = sanitizeDateISO(document.getElementById('recurringStartDate')?.value) || new Date().toISOString().split('T')[0];
    const endDate = sanitizeDateISO(document.getElementById('recurringEndDate')?.value) || null;

    if (!name) { alert('Please enter a name.'); return; }
    if (!rawAmount || isNaN(Number(rawAmount)) || Number(rawAmount) <= 0) { alert('Please enter a valid positive amount.'); return; }
    if (!accountId) { alert('Please select an account.'); return; }

    if (!app.recurringTemplates) app.recurringTemplates = [];
    app.recurringTemplates.push({
        id: Date.now(),
        name,
        type,
        amount,
        frequency,
        dayOfMonth,
        category,
        accountId,
        targetAccountId: targetAccountId && targetAccountId !== accountId ? targetAccountId : null,
        startDate,
        endDate,
        paused: false,
        skippedMonths: [],
        paidMonths: []
    });

    app.saveToStorage();
    app.renderRecurringPage();
    document.getElementById('recurringForm')?.reset();
}

export function deleteRecurringTemplate(app, id) {
    if (!app.recurringTemplates) return;
    app.recurringTemplates = app.recurringTemplates.filter(t => t.id !== id);
    app.saveToStorage();
    app.renderRecurringPage();
}

export function pauseRecurringTemplate(app, id, paused) {
    const t = app.recurringTemplates?.find(x => x.id === id);
    if (!t) return;
    t.paused = paused;
    app.saveToStorage();
    app.renderRecurringPage();
}

export function skipRecurringOccurrence(app, id, monthKey, unskip = false) {
    const t = app.recurringTemplates?.find(x => x.id === id);
    if (!t || !monthKey) return;
    if (!t.skippedMonths) t.skippedMonths = [];
    if (unskip) {
        t.skippedMonths = t.skippedMonths.filter(m => m !== monthKey);
    } else if (!t.skippedMonths.includes(monthKey)) {
        t.skippedMonths.push(monthKey);
    }
    app.saveToStorage();
    app.renderRecurringPage();
}

export function markRecurringPaid(app, id, monthKey, unmark = false) {
    const t = app.recurringTemplates?.find(x => x.id === id);
    if (!t || !monthKey) return;
    if (!t.paidMonths) t.paidMonths = [];
    if (unmark) {
        t.paidMonths = t.paidMonths.filter(m => m !== monthKey);
    } else if (!t.paidMonths.includes(monthKey)) {
        t.paidMonths.push(monthKey);
    }
    app.saveToStorage();
    app.renderRecurringPage();
}

export function startEditRecurring(app, id) {
    app.editingRecurringId = id;
    app.renderRecurringPage();
    setTimeout(() => {
        const el = document.getElementById(`re-name-${id}`);
        if (el) el.focus();
    }, 0);
}

export function cancelEditRecurring(app) {
    app.editingRecurringId = null;
    app.renderRecurringPage();
}

export function saveEditRecurring(app, id) {
    if (!app.recurringTemplates) return;
    const idx = app.recurringTemplates.findIndex(t => t.id === id);
    if (idx === -1) return;

    const name = normalizeText(document.getElementById(`re-name-${id}`)?.value, 80);
    const type = document.getElementById(`re-type-${id}`)?.value || 'subscription';
    const rawAmount = document.getElementById(`re-amount-${id}`)?.value;
    const amount = sanitizeFiniteNumber(rawAmount, NaN, { min: 0.01 });
    const frequency = document.getElementById(`re-freq-${id}`)?.value || 'monthly';
    const dayOfMonth = sanitizeInteger(document.getElementById(`re-day-${id}`)?.value, 1, { min: 1, max: 31 });
    const category = normalizeText(document.getElementById(`re-cat-${id}`)?.value, 40) || 'Other';
    const accountId = parseInt(document.getElementById(`re-acct-${id}`)?.value, 10) || null;
    const targetAccountId = parseInt(document.getElementById(`re-tacct-${id}`)?.value, 10) || null;
    const startDate = sanitizeDateISO(document.getElementById(`re-start-${id}`)?.value);
    const endDate = sanitizeDateISO(document.getElementById(`re-end-${id}`)?.value) || null;

    if (!name) { alert('Please enter a name.'); return; }
    if (!rawAmount || isNaN(Number(rawAmount)) || Number(rawAmount) <= 0) { alert('Please enter a valid positive amount.'); return; }

    app.recurringTemplates[idx] = {
        ...app.recurringTemplates[idx],
        name, type, amount, frequency, dayOfMonth, category,
        accountId, targetAccountId, startDate, endDate
    };

    app.editingRecurringId = null;
    app.saveToStorage();
    app.renderRecurringPage();
}

// ─── Monthly summary helper (used by bills.js cash flow panel) ───────────────

/**
 * Returns { debits, credits } totals from active recurring templates for a month.
 * month is 0-indexed.
 */
export function getRecurringTotalsForMonth(app, year, month) {
    let debits = 0;
    let credits = 0;
    for (const t of app.recurringTemplates || []) {
        const occurrences = getRecurringOccurrencesInMonth(t, year, month);
        if (occurrences.length === 0) continue;
        const total = occurrences.length * (t.amount || 0);
        if (t.type === 'reimbursement') {
            credits += total;
        } else {
            debits += total;
        }
    }
    return { debits, credits };
}

// ─── Storage helpers ─────────────────────────────────────────────────────────

/**
 * Populate a recurring template account selector with current app accounts.
 * Pass in the select element's id and optional current value.
 */
export function refreshRecurringAccountSelectors(app) {
    const accountSelectors = [
        document.getElementById('recurringAccount'),
        document.getElementById('recurringTargetAccount')
    ];
    for (const sel of accountSelectors) {
        if (!sel) continue;
        const current = sel.value;
        const isTarget = sel.id === 'recurringTargetAccount';
        sel.innerHTML = isTarget
            ? `<option value="">— None (not a transfer) —</option>`
            : `<option value="">— Select account —</option>`;
        for (const acct of app.accounts || []) {
            const opt = document.createElement('option');
            opt.value = acct.id;
            opt.textContent = normalizeText(acct.name, 80);
            if (String(acct.id) === String(current)) opt.selected = true;
            sel.appendChild(opt);
        }
    }
}
