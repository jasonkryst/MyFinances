// Recurring Transaction Templates — subscriptions, reimbursements, transfers

import {
    formatCurrency,
    formatShortDate,
    normalizeText,
    sanitizeFiniteNumber,
    sanitizeInteger,
    sanitizeDateISO,
    dateToISO,
    escapeHtml,
    PINNED_COLORS,
    isRecurringInflow
} from './utils.js';
import { buildAccountOptionsHtml } from './accounts.js';
import { pgPost, pgPatch, pgDelete } from './postgresSync.js';
import { showDeleteConfirmModal, showAlertModal, confirmZeroAmountAllowed } from './ui.js';
import { getSetting, SHOW_ARCHIVED_RECURRING } from './settings.js';

const TYPES = ['subscription', 'income', 'reimbursement', 'transfer'];
const TYPE_LABELS = {
    subscription: 'Subscription / Expense',
    income: 'Income',
    reimbursement: 'Reimbursement',
    transfer: 'Transfer'
};
const TYPE_ICONS = { subscription: '📦', income: '💰', reimbursement: '💸', transfer: '🔄' };

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
    'Income', 'Reimbursement', 'Other'
];

// ─── Occurrence calculation ────────────────────────────────────────────────────

/**
 * A paused template whose auto-resume date (`pauseUntil`) has passed is
 * treated exactly as if it had been manually unpaused (issue #299) — this is
 * computed fresh on every call rather than persisted, so no render path
 * needs to write back to storage just to evaluate occurrences/overdue state.
 */
function isEffectivelyPaused(template, now = new Date()) {
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

    return dates;
}

// ─── R-02: Overdue detection ──────────────────────────────────────────────────

function isOverdue(template, now) {
    if (!template || template.archived) return false;
    if (isEffectivelyPaused(template, now)) return false;
    if (template.frequency !== 'monthly') return false;
    const dom = Number(template.dayOfMonth);
    if (!dom || dom < 1 || dom > 31) return false;

    const year = now.getFullYear();
    const month = now.getMonth();
    const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;

    if (Array.isArray(template.paidMonths) && template.paidMonths.includes(monthKey)) return false;
    if (Array.isArray(template.skippedMonths) && template.skippedMonths.includes(monthKey)) return false;

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const dueDay = Math.min(dom, daysInMonth);
    return now.getDate() > dueDay;
}

// ─── #382: Upcoming-due urgency badge ────────────────────────────────────────

function daysBetweenCalendarDates(a, b) {
    const utc1 = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    const utc2 = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((utc2 - utc1) / (24 * 60 * 60 * 1000));
}

function getUrgencyBadge(occurrences, now) {
    if (!occurrences || occurrences.length === 0) return '';
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const upcoming = occurrences
        .filter(d => d >= todayStart)
        .sort((a, b) => a - b)[0];
    if (!upcoming) return '';

    const daysUntil = daysBetweenCalendarDates(now, upcoming);
    if (daysUntil < 3) {
        const label = daysUntil <= 0 ? 'Due today' : `Due in ${daysUntil}d`;
        return `<span class="recurring-urgency-badge recurring-urgency-badge--red" role="status">${label}</span>`;
    }
    if (daysUntil < 7) {
        return `<span class="recurring-urgency-badge recurring-urgency-badge--yellow" role="status">Due in ${daysUntil}d</span>`;
    }
    return '';
}

// ─── R-01: Upcoming this month panel ─────────────────────────────────────────

function renderUpcomingThisMonthPanel(app) {
    const panel = document.getElementById('recurringUpcomingPanel');
    if (!panel) return;

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;

    const active = (app.recurringTemplates || []).filter(t => !isEffectivelyPaused(t, now) && !t.archived);

    if (active.length === 0) {
        panel.innerHTML = `<div class="recurring-upcoming-panel recurring-upcoming-panel--empty" role="region" aria-label="Upcoming this month"><span class="recurring-upcoming-empty">No active recurring items this month.</span></div>`;
        return;
    }

    let totalCount = 0;
    let totalAmount = 0;
    let paidCount = 0;
    let overdueCount = 0;

    for (const t of active) {
        const occurrences = getRecurringOccurrencesInMonth(t, year, month);
        if (occurrences.length === 0) continue;
        const isPaid = Array.isArray(t.paidMonths) && t.paidMonths.includes(monthKey);
        totalCount += occurrences.length;
        totalAmount += occurrences.length * (t.amount || 0);
        if (isPaid) paidCount++;
        if (isOverdue(t, now)) overdueCount++;
    }

    // #427: Overdue is a filter toggle with helper text. Overdue = monthly template whose
    // due day has already passed this month and that isn't marked paid or skipped.
    if (overdueCount === 0) app._recurringOverdueOnly = false;
    const overdueOnly = !!app._recurringOverdueOnly;
    const overdueHtml = overdueCount > 0
        ? `<button type="button" class="recurring-upcoming-stat recurring-upcoming-stat--overdue recurring-overdue-filter-btn${overdueOnly ? ' active' : ''}" id="recurringOverdueFilterBtn" aria-pressed="${overdueOnly ? 'true' : 'false'}" aria-label="Overdue: ${overdueCount}. ${overdueOnly ? 'Showing only overdue templates, click to show all' : 'Click to show only overdue templates'}" title="Overdue: the due day has passed this month and the template is not marked paid or skipped."><span class="recurring-upcoming-label">Overdue</span><span class="recurring-upcoming-value recurring-upcoming-value--overdue">${overdueCount}</span></button>`
        : '';
    const overdueHelpHtml = overdueCount > 0
        ? `<p class="recurring-overdue-help" id="recurringOverdueHelp">${overdueOnly ? 'Showing only overdue templates. ' : ''}Overdue means the due day has passed this month and the template isn't marked paid or skipped. ${overdueOnly ? 'Select Overdue again to show everything.' : 'Select Overdue to list just those templates.'}</p>`
        : '';

    panel.innerHTML = `
        <div class="recurring-upcoming-panel" role="region" aria-label="Upcoming this month">
            <h3 class="recurring-upcoming-title">Upcoming this month</h3>
            <div class="recurring-upcoming-stats">
                <div class="recurring-upcoming-stat">
                    <span class="recurring-upcoming-label">Occurrences</span>
                    <span class="recurring-upcoming-value">${totalCount}</span>
                </div>
                <div class="recurring-upcoming-stat">
                    <span class="recurring-upcoming-label">Total</span>
                    <span class="recurring-upcoming-value">${formatCurrency(totalAmount)}</span>
                </div>
                <div class="recurring-upcoming-stat">
                    <span class="recurring-upcoming-label">Paid</span>
                    <span class="recurring-upcoming-value">${paidCount}</span>
                </div>
                ${overdueHtml}
            </div>
            ${overdueHelpHtml}
        </div>`;

    const overdueBtn = panel.querySelector('#recurringOverdueFilterBtn');
    if (overdueBtn) {
        overdueBtn.addEventListener('click', () => {
            app._recurringOverdueOnly = !app._recurringOverdueOnly;
            renderRecurringPage(app);
        });
    }
}

// ─── Category datalist helpers ────────────────────────────────────────────────

const DEFAULT_CATEGORIES = [
    'Childcare', 'Clothing', 'Debt Payments', 'Dining', 'Education',
    'Entertainment', 'Food', 'Gifts', 'Groceries', 'Health',
    'Housing', 'Insurance', 'Other', 'Personal', 'Pets',
    'Savings', 'Subscriptions', 'Transportation', 'Travel', 'Utilities',
    ...Object.keys(PINNED_COLORS)
];

function getKnownCategories(app) {
    const used = [
        ...(app.recurringTemplates || []).map(t => t.category),
        ...(app.bills || []).map(b => b.category),
        ...(app.expenses || []).map(e => e.category),
    ].filter(Boolean);
    return [...new Set([...DEFAULT_CATEGORIES, ...used])].sort();
}

export function refreshCategoryDatalist(app) {
    const dl = document.getElementById('categoryOptions');
    if (!dl) return;
    dl.innerHTML = getKnownCategories(app).map(c => `<option value="${escapeHtml(c)}"></option>`).join('');
}

// ─── Rendering ────────────────────────────────────────────────────────────────

export function renderRecurringPage(app) {
    const container = document.getElementById('recurringList');
    if (!container) return;

    refreshCategoryDatalist(app);
    renderUpcomingThisMonthPanel(app);

    const allTemplates = app.recurringTemplates || [];
    const showArchived = getSetting(app, SHOW_ARCHIVED_RECURRING, false);

    const active = allTemplates.filter(t => !t.archived);
    const archived = allTemplates.filter(t => t.archived);
    const visible = showArchived ? allTemplates : active;

    if (allTemplates.length === 0) {
        container.innerHTML = `<p class="recurring-empty-msg">No recurring templates yet. Add your first subscription, income, reimbursement, or transfer above.</p>`;
        return;
    }
    if (active.length === 0 && !showArchived) {
        container.innerHTML = `<p class="recurring-empty-msg">All recurring templates are archived. Enable "Show archived recurring templates" in Settings to see them.</p>`;
        return;
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;

    // Populate category filter
    const catFilter = document.getElementById('recurringCategoryFilter');
    if (catFilter) {
        const prevCat = catFilter.value;
        catFilter.innerHTML = '<option value="">All</option>';
        const cats = Array.from(new Set(allTemplates.map(t => t.category).filter(Boolean))).sort();
        cats.forEach(c => {
            const o = document.createElement('option');
            o.value = c; o.textContent = c;
            catFilter.appendChild(o);
        });
        if (cats.includes(prevCat)) catFilter.value = prevCat;
    }

    // Populate account filter
    const acctFilter = document.getElementById('recurringAccountFilter');
    if (acctFilter) {
        const prevAcct = acctFilter.value;
        acctFilter.innerHTML = '<option value="">All</option>';
        const acctIds = Array.from(new Set(allTemplates.flatMap(t => [t.accountId, t.targetAccountId].filter(Boolean))));
        acctIds.forEach(id => {
            const a = app.accounts?.find(a => a.id === id);
            if (!a) return;
            const o = document.createElement('option');
            o.value = String(id); o.textContent = a.name;
            acctFilter.appendChild(o);
        });
        if (acctIds.map(String).includes(prevAcct)) acctFilter.value = prevAcct;
    }

    // Populate month filter (current month + next 11 months)
    const monthFilterEl = document.getElementById('recurringMonthFilter');
    if (monthFilterEl) {
        const prevMonth = monthFilterEl.value;
        monthFilterEl.innerHTML = '<option value="">Any</option>';
        for (let d = 0; d < 12; d++) {
            const ref = new Date(year, month + d, 1);
            const ky = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}`;
            const label = ref.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            const o = document.createElement('option');
            o.value = ky; o.textContent = label;
            monthFilterEl.appendChild(o);
        }
        if (monthFilterEl.querySelector(`option[value="${prevMonth}"]`)) monthFilterEl.value = prevMonth;
    }

    // Apply filters
    let displayTemplates = visible.slice();
    if (catFilter && catFilter.value) {
        displayTemplates = displayTemplates.filter(t => t.category === catFilter.value);
    }
    if (acctFilter && acctFilter.value) {
        displayTemplates = displayTemplates.filter(t =>
            String(t.accountId) === acctFilter.value || String(t.targetAccountId) === acctFilter.value
        );
    }
    if (monthFilterEl && monthFilterEl.value) {
        const [fy, fm] = monthFilterEl.value.split('-').map(Number);
        displayTemplates = displayTemplates.filter(t =>
            t.archived || getRecurringOccurrencesInMonth(t, fy, fm - 1).length > 0
        );
    }

    if (app._recurringOverdueOnly) {
        displayTemplates = displayTemplates.filter(t => isOverdue(t, now));
    }

    // Apply sort
    const sortBy = document.getElementById('recurringSortBy')?.value || '';
    if (sortBy) {
        displayTemplates = [...displayTemplates].sort((a, b) => {
            if (sortBy === 'amount-desc') return (b.amount || 0) - (a.amount || 0);
            if (sortBy === 'amount-asc') return (a.amount || 0) - (b.amount || 0);
            if (sortBy === 'due-asc' || sortBy === 'due-desc') {
                const va = a.dayOfMonth || 32, vb = b.dayOfMonth || 32;
                return sortBy === 'due-asc' ? va - vb : vb - va;
            }
            if (sortBy === 'name-asc') return (a.name || '').localeCompare(b.name || '');
            return 0;
        });
    }

    const cards = displayTemplates.map(t => {
        if (app.editingRecurringId === t.id) {
            return _buildEditCard(app, t);
        }
        return _buildReadCard(app, t, year, month, monthKey);
    }).join('');

    const archivedNote = (archived.length > 0 && !showArchived)
        ? `<p class="recurring-archived-note">${archived.length} archived template${archived.length !== 1 ? 's' : ''} hidden — enable "Show archived recurring templates" in Settings to view them.</p>`
        : '';

    container.innerHTML = cards + archivedNote;

    container.onclick = async (event) => {
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
            const name = app.recurringTemplates?.find(x => x.id === id)?.name || 'template';
            if (await showDeleteConfirmModal(`Delete "${name}"? This cannot be undone.`)) {
                app.deleteRecurringTemplate(id);
            }
        }
        else if (action === 'pause') app.openRecurringPauseModal(id);
        else if (action === 'unpause') app.pauseRecurringTemplate(id, false);
        else if (action === 'skip') app.skipRecurringOccurrence(id, mk, false);
        else if (action === 'unskip') app.skipRecurringOccurrence(id, mk, true);
        else if (action === 'mark-paid') openRecurringMarkPaidModal(app, id, mk);
        else if (action === 'unmark-paid') app.markRecurringPaid(id, mk, true);
        else if (action === 'archive') app.archiveRecurringTemplate(id);
        else if (action === 'unarchive') app.unarchiveRecurringTemplate(id);
    };
}

function _buildReadCard(app, t, year, month, monthKey) {
    const typeLabel = TYPE_LABELS[t.type] || t.type;
    const typeIcon = TYPE_ICONS[t.type] || '📋';
    const freqLabel = FREQ_LABELS[t.frequency] || t.frequency;

    // Reimbursements show as positive; everything else as negative
    const sign = isRecurringInflow(t) ? '+' : '-';
    const amountClass = isRecurringInflow(t) ? 'recurring-amount--pos' : 'recurring-amount--neg';

    const now = new Date();
    // #299: a template whose pauseUntil date has passed behaves exactly like
    // an active one everywhere on this card (badge, buttons, occurrences).
    const paused = isEffectivelyPaused(t, now);

    const occurrences = getRecurringOccurrencesInMonth(t, year, month);
    const thisMonthTotal = occurrences.length * (t.amount || 0);
    const isSkippedThisMonth = Array.isArray(t.skippedMonths) && t.skippedMonths.includes(monthKey);
    const isPaidThisMonth = Array.isArray(t.paidMonths) && t.paidMonths.includes(monthKey);

    let statusBadge;
    if (paused) {
        const resumeNote = t.pauseUntil
            ? ` <span class="recurring-pause-resume-note">until ${escapeHtml(formatShortDate(t.pauseUntil))}</span>`
            : '';
        statusBadge = `<span class="recurring-badge recurring-badge--paused">⏸ Paused${resumeNote}</span>`;
    } else if (isSkippedThisMonth) {
        statusBadge = `<span class="recurring-badge recurring-badge--skipped">⏭ Skipped this month</span>`;
    } else if (occurrences.length > 0 && isPaidThisMonth) {
        const actualAmt = t.paidAmounts?.[monthKey];
        const actualLabel = (actualAmt !== undefined && actualAmt !== t.amount)
            ? ` · actual: ${formatCurrency(actualAmt)}`
            : '';
        statusBadge = `<span class="recurring-badge recurring-badge--paid">✅ Paid this month${escapeHtml(actualLabel)}</span>`;
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

    const thisMonthLine = (occurrences.length > 0 && !paused && !isSkippedThisMonth)
        ? `<span class="recurring-this-month">This month: <strong>${sign}${formatCurrency(thisMonthTotal)}</strong> (${occurrences.length}×${nextDates ? ' on ' + nextDates : ''})</span>`
        : '';

    const archivedBadge = t.archived
        ? `<span class="recurring-badge recurring-badge--archived">📦 Archived</span>`
        : '';

    const overdueBadge = isOverdue(t, now)
        ? `<span class="recurring-overdue-badge" role="status" aria-label="Overdue">Overdue</span>`
        : '';
    const urgencyBadge = (!paused && !t.archived && !isSkippedThisMonth && !isPaidThisMonth && !isOverdue(t, now))
        ? getUrgencyBadge(occurrences, now)
        : '';

    return `<div id="recurring-card-${t.id}" class="recurring-card${paused ? ' recurring-card--paused' : ''}${t.archived ? ' recurring-card--archived' : ''}${isOverdue(t, now) ? ' recurring-card--overdue' : ''}">
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
            ${archivedBadge}
            ${t.archived ? '' : overdueBadge}
            ${t.archived ? '' : urgencyBadge}
            ${t.archived ? '' : statusBadge}
            ${t.archived ? '' : thisMonthLine}
        </div>
        <div class="recurring-card-actions">
            ${t.archived
                ? `<button class="btn btn-secondary btn-small" data-recurring-action="unarchive" data-recurring-id="${t.id}" aria-label="Unarchive ${escapeHtml(t.name)}">↩ Unarchive</button>
                   <button class="btn btn-danger btn-small" data-recurring-action="delete" data-recurring-id="${t.id}" aria-label="Delete ${escapeHtml(t.name)}">Delete</button>`
                : `<button class="btn btn-secondary btn-small" data-recurring-action="edit" data-recurring-id="${t.id}" aria-label="Edit ${escapeHtml(t.name)}">Edit</button>
                   ${paused
                       ? `<button class="btn btn-secondary btn-small" data-recurring-action="unpause" data-recurring-id="${t.id}" aria-label="Resume ${escapeHtml(t.name)}">▶ Resume</button>`
                       : `<button class="btn btn-secondary btn-small" data-recurring-action="pause" data-recurring-id="${t.id}" aria-label="Pause ${escapeHtml(t.name)}">⏸ Pause</button>`}
                   ${(!paused && !isSkippedThisMonth && occurrences.length > 0)
                       ? (isPaidThisMonth
                           ? `<button class="btn btn-secondary btn-small" data-recurring-action="unmark-paid" data-recurring-id="${t.id}" data-recurring-monthkey="${monthKey}" aria-label="Unmark paid ${escapeHtml(t.name)}">↩ Unmark paid</button>`
                           : `<button class="btn btn-secondary btn-small" data-recurring-action="mark-paid" data-recurring-id="${t.id}" data-recurring-monthkey="${monthKey}" aria-label="Mark as paid ${escapeHtml(t.name)}">✅ Mark as paid</button>`)
                       : ''}
                   ${isSkippedThisMonth
                       ? `<button class="btn btn-secondary btn-small" data-recurring-action="unskip" data-recurring-id="${t.id}" data-recurring-monthkey="${monthKey}" aria-label="Unskip ${escapeHtml(t.name)}">↩ Unskip</button>`
                       : !paused
                           ? `<button class="btn btn-secondary btn-small" data-recurring-action="skip" data-recurring-id="${t.id}" data-recurring-monthkey="${monthKey}" aria-label="Skip month ${escapeHtml(t.name)}">⏭ Skip month</button>`
                           : ''}
                   <button class="btn btn-secondary btn-small" data-recurring-action="archive" data-recurring-id="${t.id}" aria-label="Archive ${escapeHtml(t.name)}">Archive</button>
                   <button class="btn btn-danger btn-small" data-recurring-action="delete" data-recurring-id="${t.id}" aria-label="Delete ${escapeHtml(t.name)}">Delete</button>`}
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
                <input type="number" id="re-amount-${t.id}" value="${t.amount}" min="0" step="0.01">
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
                <input type="text" id="re-cat-${t.id}" list="categoryOptions" value="${escapeHtml(t.category || 'Other')}" autocomplete="off">
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
            <button class="btn btn-primary btn-small" data-recurring-action="save" data-recurring-id="${t.id}" aria-label="Save changes to ${escapeHtml(t.name)}">Save</button>
            <button class="btn btn-secondary btn-small" data-recurring-action="cancel" aria-label="Cancel editing ${escapeHtml(t.name)}">Cancel</button>
        </div>
    </div>`;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

// #412: blank/non-numeric/negative amounts are always rejected; $0 is subject
// to the zeroAmountPolicy setting, except for transfers which require > 0.
async function validateRecurringAmount(app, rawAmount, type, name) {
    const trimmed = String(rawAmount ?? '').trim();
    const n = Number(trimmed);
    if (trimmed === '' || !Number.isFinite(n) || n < 0) {
        await showAlertModal('Please enter a valid amount (0 or greater).');
        return false;
    }
    if (n === 0) {
        if (type === 'transfer') {
            await showAlertModal('Transfers must have an amount greater than $0.');
            return false;
        }
        return confirmZeroAmountAllowed(app, name);
    }
    return true;
}

export async function addRecurringTemplate(app) {
    const name = normalizeText(document.getElementById('recurringName')?.value, 80);
    const type = document.getElementById('recurringType')?.value || 'subscription';
    const rawAmount = document.getElementById('recurringAmount')?.value;
    const amount = sanitizeFiniteNumber(String(rawAmount ?? '').trim() === '' ? NaN : rawAmount, NaN, { min: 0 });
    const frequency = document.getElementById('recurringFrequency')?.value || 'monthly';
    const dayOfMonth = sanitizeInteger(document.getElementById('recurringDayOfMonth')?.value, 1, { min: 1, max: 31 });
    const category = normalizeText(document.getElementById('recurringCategory')?.value, 40) || 'Other';
    const accountId = parseInt(document.getElementById('recurringAccount')?.value, 10) || null;
    const targetAccountId = parseInt(document.getElementById('recurringTargetAccount')?.value, 10) || null;
    const startDate = sanitizeDateISO(document.getElementById('recurringStartDate')?.value) || new Date().toISOString().split('T')[0];
    const endDate = sanitizeDateISO(document.getElementById('recurringEndDate')?.value) || null;

    if (!name) { await showAlertModal('Please enter a name.'); return; }
    if (!(await validateRecurringAmount(app, rawAmount, type, name))) return;
    if (!accountId) { await showAlertModal('Please select an account.'); return; }

    if (!app.recurringTemplates) app.recurringTemplates = [];
    const tmpl = {
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
        paidMonths: [],
        paidAmounts: {}
    };
    app.recurringTemplates.push(tmpl);

    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') {
        const saved = await pgPost(app, '/api/recurring-templates', tmpl);
        if (saved?.id) tmpl.id = saved.id;
    }
    app.renderRecurringPage();
    document.getElementById('recurringForm')?.reset();
}

export function deleteRecurringTemplate(app, id) {
    if (!app.recurringTemplates) return;
    app.recurringTemplates = app.recurringTemplates.filter(t => t.id !== id);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/recurring-templates/${id}`);
    app.renderRecurringPage();
}

// #299: pauseUntil is only meaningful while paused=true; unpausing (manual or
// via the auto-resume modal flow) always clears it so a later re-pause starts fresh.
export function pauseRecurringTemplate(app, id, paused, pauseUntil = null) {
    const t = app.recurringTemplates?.find(x => x.id === id);
    if (!t) return;
    t.paused = paused;
    t.pauseUntil = paused ? (pauseUntil || null) : null;
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/recurring-templates/${id}`, t);
    app.renderRecurringPage();
}

/**
 * Pause action gains an optional "resume on" date (issue #299) — collected
 * via this modal instead of pausing immediately, mirroring
 * openRecurringMarkPaidModal's optional-extra-input pattern below.
 */
export function openRecurringPauseModal(app, id) {
    const t = app.recurringTemplates?.find(x => x.id === id);
    if (!t) return;

    const existing = document.getElementById('recurringPauseModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'recurringPauseModal';
    modal.className = 'modal-overlay flex-visible';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'recurringPauseModalTitle');
    modal.setAttribute('tabindex', '-1');
    modal.innerHTML = `<div class="modal-content">
        <h3 class="modal-subtitle" id="recurringPauseModalTitle">Pause Recurring Item</h3>
        <p class="modal-description">Optionally pick a date to automatically resume <strong>${escapeHtml(t.name)}</strong>. Leave blank to pause indefinitely until manually resumed.</p>
        <div class="form-group">
            <label class="label-compact" for="recurringPauseUntilInput">Resume on</label>
            <input type="date" id="recurringPauseUntilInput" class="form-control">
        </div>
        <div class="modal-actions">
            <button class="btn btn-primary" id="recurringPauseConfirmBtn">⏸ Pause</button>
            <button class="btn btn-secondary" id="recurringPauseCancelBtn">Cancel</button>
        </div>
    </div>`;
    document.body.appendChild(modal);

    const input = modal.querySelector('#recurringPauseUntilInput');
    const lastFocused = document.activeElement;
    const close = () => {
        modal.remove();
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    };

    modal.querySelector('#recurringPauseConfirmBtn').onclick = () => {
        const pauseUntil = sanitizeDateISO(input.value);
        close();
        app.pauseRecurringTemplate(id, true, pauseUntil);
    };
    modal.querySelector('#recurringPauseCancelBtn').onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };
    modal.onkeydown = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key === 'Tab') {
            const focusable = modal.querySelectorAll('button:not([disabled]), input:not([disabled])');
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (!first || !last) return;
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    };

    modal.focus();
    setTimeout(() => { input.focus(); }, 30);
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
    if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/recurring-templates/${id}`, t);
    app.renderRecurringPage();
}

export function openRecurringMarkPaidModal(app, id, monthKey) {
    const t = app.recurringTemplates?.find(x => x.id === id);
    if (!t) return;

    const existing = document.getElementById('recurringMarkPaidModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'recurringMarkPaidModal';
    modal.className = 'modal-overlay flex-visible';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'recurringMarkPaidModalTitle');
    modal.setAttribute('tabindex', '-1');
    modal.innerHTML = `<div class="modal-content">
        <h3 class="modal-subtitle" id="recurringMarkPaidModalTitle">Mark as Paid</h3>
        <p class="modal-description">Optionally enter the actual amount paid for <strong>${escapeHtml(t.name)}</strong> this month.</p>
        <div class="form-group">
            <label class="label-compact" for="recurringActualAmountInput">Actual amount paid ($)</label>
            <input type="number" id="recurringActualAmountInput" class="form-control" value="${t.amount}" step="0.01" min="0">
        </div>
        <div class="modal-actions">
            <button class="btn btn-primary" id="recurringMarkPaidConfirmBtn">✅ Mark as Paid</button>
            <button class="btn btn-secondary" id="recurringMarkPaidCancelBtn">Cancel</button>
        </div>
    </div>`;
    document.body.appendChild(modal);

    const input = modal.querySelector('#recurringActualAmountInput');
    const lastFocused = document.activeElement;
    const close = () => {
        modal.remove();
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    };

    modal.querySelector('#recurringMarkPaidConfirmBtn').onclick = () => {
        const raw = input.value;
        const actual = raw !== '' ? sanitizeFiniteNumber(raw, null, { min: 0 }) : null;
        close();
        app.markRecurringPaid(id, monthKey, false, actual);
    };
    modal.querySelector('#recurringMarkPaidCancelBtn').onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };
    modal.onkeydown = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key === 'Tab') {
            const focusable = modal.querySelectorAll('button:not([disabled]), input:not([disabled])');
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (!first || !last) return;
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    };

    modal.focus();
    setTimeout(() => { input.select(); }, 30);
}

export function markRecurringPaid(app, id, monthKey, unmark = false, actualAmount = null) {
    const t = app.recurringTemplates?.find(x => x.id === id);
    if (!t || !monthKey) return;
    if (!t.paidMonths) t.paidMonths = [];
    if (!t.paidAmounts) t.paidAmounts = {};
    if (unmark) {
        t.paidMonths = t.paidMonths.filter(m => m !== monthKey);
        delete t.paidAmounts[monthKey];
    } else if (!t.paidMonths.includes(monthKey)) {
        t.paidMonths.push(monthKey);
        if (actualAmount !== null && actualAmount > 0) t.paidAmounts[monthKey] = actualAmount;
    }
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/recurring-templates/${id}`, t);
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

export async function saveEditRecurring(app, id) {
    if (!app.recurringTemplates) return;
    const idx = app.recurringTemplates.findIndex(t => t.id === id);
    if (idx === -1) return;

    const name = normalizeText(document.getElementById(`re-name-${id}`)?.value, 80);
    const type = document.getElementById(`re-type-${id}`)?.value || 'subscription';
    const rawAmount = document.getElementById(`re-amount-${id}`)?.value;
    const amount = sanitizeFiniteNumber(String(rawAmount ?? '').trim() === '' ? NaN : rawAmount, NaN, { min: 0 });
    const frequency = document.getElementById(`re-freq-${id}`)?.value || 'monthly';
    const dayOfMonth = sanitizeInteger(document.getElementById(`re-day-${id}`)?.value, 1, { min: 1, max: 31 });
    const category = normalizeText(document.getElementById(`re-cat-${id}`)?.value, 40) || 'Other';
    const accountId = parseInt(document.getElementById(`re-acct-${id}`)?.value, 10) || null;
    const targetAccountId = parseInt(document.getElementById(`re-tacct-${id}`)?.value, 10) || null;
    const startDate = sanitizeDateISO(document.getElementById(`re-start-${id}`)?.value);
    const endDate = sanitizeDateISO(document.getElementById(`re-end-${id}`)?.value) || null;

    if (!name) { await showAlertModal('Please enter a name.'); return; }
    if (!(await validateRecurringAmount(app, rawAmount, type, name))) return;

    app.recurringTemplates[idx] = {
        ...app.recurringTemplates[idx],
        name, type, amount, frequency, dayOfMonth, category,
        accountId, targetAccountId, startDate, endDate
    };

    app.editingRecurringId = null;
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/recurring-templates/${id}`, app.recurringTemplates[idx]);
    app.renderRecurringPage();
}

// ─── Storage helpers ─────────────────────────────────────────────────────────

/**
 * Populate a recurring template account selector with current app accounts.
 * Pass in the select element's id and optional current value.
 */
export function archiveRecurringTemplate(app, id) {
    const t = app.recurringTemplates?.find(x => x.id === id);
    if (!t) return;
    t.archived = true;
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/recurring-templates/${id}`, { archived: true });
    app.renderRecurringPage();
}

export function unarchiveRecurringTemplate(app, id) {
    const t = app.recurringTemplates?.find(x => x.id === id);
    if (!t) return;
    t.archived = false;
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/recurring-templates/${id}`, { archived: false });
    app.renderRecurringPage();
}

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
            opt.textContent = `${normalizeText(acct.name, 80)} (${acct.type})`;
            if (String(acct.id) === String(current)) opt.selected = true;
            sel.appendChild(opt);
        }
    }
}

/**
 * Month-normalized recurring cash flow (issue #252) for Health's cash-flow
 * card: every occurrence from getRecurringOccurrencesInMonth (so frequency,
 * pause, archive, skipped months and start/end dates are all honored).
 * Inflows (income + reimbursement) and outflows (subscription) are summed
 * separately; transfers are zero-sum between own accounts and excluded.
 */
export function computeRecurringCashFlowForMonth(app, year, month) {
    let inflow = 0;
    let outflow = 0;
    for (const tmpl of (app?.recurringTemplates || [])) {
        if (tmpl.type === 'transfer') continue;
        const count = getRecurringOccurrencesInMonth(tmpl, year, month).length;
        if (!count) continue;
        const amt = Math.abs(Number(tmpl.amount)) || 0;
        if (isRecurringInflow(tmpl)) inflow += amt * count;
        else outflow += amt * count;
    }
    return { inflow, outflow };
}
