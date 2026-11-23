// #678: the "Applies from" row in the income and recurring inline editors, and
// the change list on their cards. The rule itself lives in amountSchedule.js.
//
// Every export is a hoisted function: ui.js imports this module, and it imports
// postgresSync.js, so it sits on the ui.js/postgresSync.js import cycle.
import { escapeHtml, formatCurrency, formatShortDate, dateToISO, getIncomePaydaysInMonth } from './utils.js';
import { getRecurringOccurrencesInMonth } from './recurringOccurrences.js';
import { getCurrentAmount, getAmountChangeSummary, applyAmountChange } from './amountSchedule.js';
import { pgPatch } from './postgresSync.js';
import { t, plural } from './i18n.js';

const LOOKAHEAD_MONTHS = 14;

// The first occurrence strictly after `today` (a Date), as YYYY-MM-DD; the day
// after today when there is none in the next 14 months (an ended template).
export function nextOccurrenceIso(record, kind, today = new Date()) {
    const todayIso = dateToISO(today);
    for (let i = 0; i < LOOKAHEAD_MONTHS; i++) {
        const ref = new Date(today.getFullYear(), today.getMonth() + i, 1);
        const dates = kind === 'income'
            ? getIncomePaydaysInMonth(record, ref.getFullYear(), ref.getMonth())
            : getRecurringOccurrencesInMonth(record, ref.getFullYear(), ref.getMonth());
        const next = dates.map(dateToISO).sort().find(iso => iso > todayIso);
        if (next) return next;
    }
    return dateToISO(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
}

// Attributes for the amount <input>: the listener shows the row once the value
// differs from the current amount.
export function amountInputAttrs(prefix, id, record) {
    const current = getCurrentAmount(record, dateToISO(new Date()));
    return `data-current-amount="${escapeHtml(String(current))}" data-applies-row="${prefix}-applies-row-${escapeHtml(String(id))}"`;
}

export function renderAppliesFromRow(prefix, id, record, kind) {
    const sid = escapeHtml(String(id));
    const hasScheduled = getAmountChangeSummary(record, dateToISO(new Date())).upcoming !== null;
    const note = hasScheduled
        ? `<p class="amount-applies-note hidden" id="${prefix}-applies-note-${sid}">${escapeHtml(t('amounts.allWipesScheduled'))}</p>`
        : '';
    return `<div class="amount-applies hidden" id="${prefix}-applies-row-${sid}">
        <label for="${prefix}-applies-from-${sid}">${escapeHtml(t('amounts.appliesFrom'))}</label>
        <input type="date" id="${prefix}-applies-from-${sid}" value="${escapeHtml(nextOccurrenceIso(record, kind))}">
        <label class="amount-applies-all" for="${prefix}-applies-all-${sid}"><input type="checkbox" id="${prefix}-applies-all-${sid}" data-applies-all="${prefix}-applies-from-${sid}"${hasScheduled ? ` data-applies-note="${prefix}-applies-note-${sid}"` : ''}> <span>${escapeHtml(t('amounts.allOccurrences'))}</span></label>
        ${note}
    </div>`;
}

// 'all', a YYYY-MM-DD date, or null when the row is shown but has no date.
export function readAppliesFrom(prefix, id) {
    if (document.getElementById(`${prefix}-applies-all-${id}`)?.checked) return 'all';
    const v = document.getElementById(`${prefix}-applies-from-${id}`)?.value || '';
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

// The `{ amount, amountChanges }` to save for an edited amount, or null when the
// amount changed but no "Applies from" date was given.
export function resolveAmountEdit(record, newAmount, prefix, id, firstOccurrenceIso) {
    const current = getCurrentAmount(record, dateToISO(new Date()));
    if (Math.abs(Number(newAmount) - current) < 0.005) {
        return { amount: record.amount, amountChanges: Array.isArray(record.amountChanges) ? record.amountChanges : [] };
    }
    const from = readAppliesFrom(prefix, id);
    if (from === null) return null;
    return applyAmountChange(record, newAmount, from, firstOccurrenceIso || null);
}

export function renderAmountChangeSummary(record, kind) {
    const s = getAmountChangeSummary(record, dateToISO(new Date()));
    if (!s.changes.length) return '';
    const head = s.previous !== null
        ? t('amounts.wasUntil', { amount: formatCurrency(s.previous), date: formatShortDate(s.previousUntil) })
        : t('amounts.changesTo', { amount: formatCurrency(s.upcoming.amount), date: formatShortDate(s.upcoming.from) });
    const items = s.changes.map(c => {
        const amount = formatCurrency(c.amount);
        const date = formatShortDate(c.from);
        const del = c.isFuture
            ? `<span class="amount-changes-badge">${escapeHtml(t('amounts.scheduled'))}</span>
               <button type="button" class="btn btn-secondary btn-small" data-amount-change-delete="${kind}" data-record-id="${escapeHtml(String(record.id))}" data-from="${escapeHtml(c.from)}" aria-label="${escapeHtml(t('amounts.deleteScheduledAria', { amount, date }))}">${escapeHtml(t('common.delete'))}</button>`
            : '';
        return `<li class="amount-changes-item"><span>${escapeHtml(t('amounts.changeItem', { amount, date }))}</span>${del}</li>`;
    }).join('');
    return `<details class="amount-changes">
        <summary><span>${escapeHtml(head)}</span><span class="amount-changes-sep" aria-hidden="true"></span><span>${escapeHtml(plural('amounts.changeCount', s.changes.length))}</span></summary>
        <ul class="amount-changes-list">${items}</ul>
    </details>`;
}

// Removes one scheduled (future) change from a record and saves it.
export function deleteScheduledAmountChange(app, kind, recordId, from) {
    const list = kind === 'income' ? app.incomes : app.recurringTemplates;
    const rec = (list || []).find(r => String(r.id) === String(recordId));
    if (!rec || !(from > dateToISO(new Date()))) return;
    rec.amountChanges = (rec.amountChanges || []).filter(c => c.from !== from);
    if (kind === 'income') {
        pgPatch(app, `/api/incomes/${rec.id}`, rec);
        app.renderIncomeList();
    } else {
        pgPatch(app, `/api/recurring-templates/${rec.id}`, rec);
        app.renderRecurringPage();
    }
}

export function installAmountChangeListeners(getApp) {
    document.addEventListener('input', e => {
        const input = e.target;
        if (!input?.matches?.('[data-applies-row]')) return;
        const row = document.getElementById(input.getAttribute('data-applies-row'));
        if (!row) return;
        const changed = input.value.trim() !== '' && Math.abs(Number(input.value) - Number(input.getAttribute('data-current-amount'))) >= 0.005;
        row.classList.toggle('hidden', !changed);
    });
    document.addEventListener('change', e => {
        const box = e.target;
        if (!box?.matches?.('[data-applies-all]')) return;
        const dateEl = document.getElementById(box.getAttribute('data-applies-all'));
        if (dateEl) dateEl.disabled = box.checked;
        const noteId = box.getAttribute('data-applies-note');
        if (noteId) document.getElementById(noteId)?.classList.toggle('hidden', !box.checked);
    });
    document.addEventListener('click', e => {
        const btn = e.target?.closest?.('[data-amount-change-delete]');
        if (!btn) return;
        deleteScheduledAmountChange(getApp(), btn.getAttribute('data-amount-change-delete'), btn.getAttribute('data-record-id'), btn.getAttribute('data-from'));
    });
}
