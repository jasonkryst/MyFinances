// Recurring "Mark as paid" ↔ Ledger two-way sync (issue #434).
//
// The Ledger's per-transaction maps are the single source of truth for whether
// a recurring occurrence was paid and for what amount:
//   - paid      ⇔ every ledger leg of that occurrence is Cleared
//                 (app.ledgerClearedTransactions)
//   - actual $  ⇔ a ledger amount override on that leg (app.ledgerAmountOverrides)
// Both maps are keyed `recurring|<templateId>|<accountKey>|<YYYY-MM-DD>` (see
// makeLedgerTransactionId), so paid state is tied to the occurrence date.
//
// `template.paidMonths` is kept only as a derived cache: a month is listed iff
// it has at least one occurrence and every leg of every occurrence is cleared.
// It exists because the calendar feeds (client calendarFeed.js and the server's
// calendarGenerator.js, which reads `paid_months` straight from Postgres) and
// isOverdue() read it. Every write path below re-derives it.
//
// `template.paidAmounts` is legacy (pre-#434): it was only ever shown on the
// card badge and was never persisted by the Postgres backend. It is migrated
// into ledger overrides by reconcileRecurringPaidState() and then removed.

import { isRecurringInflow, dateToISO, formatCurrency, formatShortDate, sanitizeFiniteNumber, escapeHtml } from './utils.js';
import { getRecurringOccurrencesInMonth } from './recurring.js';
import { makeLedgerTransactionId } from './ledgerTransactions.js';
import { isCleared, setLedgerCleared } from './ledgerCleared.js';
import { getOverrideAmount, setLedgerAmountOverride, clearLedgerAmountOverride } from './ledgerOverrides.js';
import { pgPatch } from './postgresSync.js';
import { confirmZeroAmountAllowed } from './ui.js';
import { t as tr } from './i18n.js';

// Mirrors ledgerTransactions.js's private UNLINKED_KEY: a template whose
// account doesn't exist posts under this sentinel account key.
const UNLINKED_KEY = '__unlinked__';

function _monthKey(year, month) {
    return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function _accountKey(app, accountId) {
    return accountId && (app.accounts || []).some(a => a.id === accountId) ? accountId : UNLINKED_KEY;
}

/**
 * The ledger legs one recurring occurrence posts, mirroring the branches in
 * buildProjectedAccountTransactions(): one inflow leg, two legs for a transfer
 * with a target account, otherwise one outflow leg. `sign` is the sign the
 * ledger amount carries on that leg.
 */
export function getRecurringOccurrenceLegs(app, tmpl, occDate) {
    const leg = (accountId, sign) => ({
        txId: makeLedgerTransactionId({ accountId: _accountKey(app, accountId), date: occDate, type: 'recurring', sourceId: tmpl.id }),
        accountId: accountId ?? null,
        sign
    });
    if (isRecurringInflow(tmpl)) return [leg(tmpl.accountId, 1)];
    if (tmpl.type === 'transfer' && tmpl.targetAccountId) {
        return [leg(tmpl.accountId, -1), leg(tmpl.targetAccountId, 1)];
    }
    return [leg(tmpl.accountId, -1)];
}

/**
 * Per-occurrence paid status for one template and month, derived from the
 * ledger maps. `actualAmount` is the positive amount the occurrence posts with
 * (its override, else the template amount); `hasOverride` says whether an
 * override is in effect.
 */
export function getRecurringMonthPaidStatus(app, tmpl, year, month) {
    const base = Math.abs(Number(tmpl.amount) || 0);
    const occurrences = getRecurringOccurrencesInMonth(tmpl, year, month).map(date => {
        const legs = getRecurringOccurrenceLegs(app, tmpl, date);
        const override = getOverrideAmount(app, legs[0].txId);
        return {
            date,
            iso: dateToISO(date),
            legs,
            paid: legs.every(l => isCleared(app, l.txId)),
            anyLegCleared: legs.some(l => isCleared(app, l.txId)),
            hasOverride: override !== null,
            actualAmount: override !== null ? Math.abs(override) : base
        };
    });
    const paidCount = occurrences.filter(o => o.paid).length;
    return {
        occurrences,
        paidCount,
        total: occurrences.length,
        allPaid: occurrences.length > 0 && paidCount === occurrences.length
    };
}

// Re-derives whether monthKey belongs in tmpl.paidMonths. Returns true if the
// cache changed. A month with no occurrences right now (paused, skipped, or
// outside the start/end window) is left as it is: there is nothing to derive
// from, and dropping it would lose paid history when a template is paused.
function _syncPaidMonth(app, tmpl, year, month) {
    const mk = _monthKey(year, month);
    const { allPaid, total } = getRecurringMonthPaidStatus(app, tmpl, year, month);
    if (total === 0) return false;
    const list = Array.isArray(tmpl.paidMonths) ? tmpl.paidMonths : [];
    const has = list.includes(mk);
    if (allPaid === has) return false;
    tmpl.paidMonths = allPaid ? [...list, mk].sort() : list.filter(m => m !== mk);
    return true;
}

function _persistTemplate(app, tmpl) {
    pgPatch(app, `/api/recurring-templates/${tmpl.id}`, tmpl);
}

// Sets one occurrence's paid state on every leg. When `actualAmount` is a
// number it becomes the leg's override (or removes the override when it equals
// the template amount); `clearOverride` drops any override outright.
function _applyOccurrence(app, tmpl, occ, { paid, actualAmount = null, clearOverride = false }) {
    const base = Math.abs(Number(tmpl.amount) || 0);
    for (const leg of occ.legs) {
        setLedgerCleared(app, leg.txId, paid);
        if (clearOverride) {
            clearLedgerAmountOverride(app, leg.txId);
        } else if (actualAmount !== null) {
            if (Math.abs(actualAmount - base) < 0.005) {
                clearLedgerAmountOverride(app, leg.txId);
            } else {
                setLedgerAmountOverride(app, leg.txId, leg.sign * actualAmount, {
                    originalAmount: leg.sign * base,
                    transactionName: tmpl.name || 'Recurring',
                    accountId: leg.accountId,
                    date: occ.iso,
                    memo: 'Actual amount from Recurring › Mark as paid'
                });
            }
        }
    }
}

function _findTemplateAndMonth(app, id, monthKey) {
    const tmpl = app.recurringTemplates?.find(x => x.id === id);
    if (!tmpl || !/^\d{4}-\d{2}$/.test(monthKey || '')) return null;
    const [y, m] = monthKey.split('-').map(Number);
    return { tmpl, year: y, month: m - 1 };
}

/**
 * Month-level mark/unmark (the card's "Unmark paid" button and the legacy API).
 * Marking clears every occurrence in the month, applying `actualAmount` to each
 * when given; unmarking un-clears them and removes their overrides.
 */
export function markRecurringPaid(app, id, monthKey, unmark = false, actualAmount = null) {
    const found = _findTemplateAndMonth(app, id, monthKey);
    if (!found) return;
    const { tmpl, year, month } = found;
    const actual = (actualAmount !== null && Number.isFinite(Number(actualAmount)) && Number(actualAmount) >= 0)
        ? Number(actualAmount) : null;
    for (const occ of getRecurringMonthPaidStatus(app, tmpl, year, month).occurrences) {
        _applyOccurrence(app, tmpl, occ, unmark
            ? { paid: false, clearOverride: true }
            : { paid: true, actualAmount: actual });
    }
    _syncPaidMonth(app, tmpl, year, month);
    if (tmpl.paidAmounts) delete tmpl.paidAmounts[monthKey];
    app.saveToStorage();
    _persistTemplate(app, tmpl);
    app.renderRecurringPage();
}

/**
 * Applies the Mark-as-paid modal's per-occurrence rows. Each edit is
 * `{ iso, paid, amount }` where amount is a non-negative number or null
 * (leave the occurrence's amount as it is).
 */
export function applyRecurringPaidEdits(app, id, monthKey, edits) {
    const found = _findTemplateAndMonth(app, id, monthKey);
    if (!found) return;
    const { tmpl, year, month } = found;
    const byIso = new Map((edits || []).map(e => [e.iso, e]));
    for (const occ of getRecurringMonthPaidStatus(app, tmpl, year, month).occurrences) {
        const edit = byIso.get(occ.iso);
        if (!edit) continue;
        _applyOccurrence(app, tmpl, occ, {
            paid: !!edit.paid,
            actualAmount: edit.paid && edit.amount !== null ? edit.amount : null
        });
    }
    _syncPaidMonth(app, tmpl, year, month);
    if (tmpl.paidAmounts) delete tmpl.paidAmounts[monthKey];
    app.saveToStorage();
    _persistTemplate(app, tmpl);
    app.renderRecurringPage();
}

/**
 * Ledger → Recurring direction. Called after the Ledger toggles Cleared on any
 * set of transaction ids; re-derives paidMonths for every recurring template
 * month those ids touch. Does not save — callers already do.
 */
export function syncRecurringPaidFromLedger(app, txIds) {
    const changed = _syncMonths(app, _monthsFromTxIds(txIds));
    for (const tmpl of changed) _persistTemplate(app, tmpl);
    return changed.size > 0;
}

// Map of `${templateId}|${monthKey}` → { id, year, month } for recurring ids.
function _monthsFromTxIds(txIds, into = new Map()) {
    for (const txId of txIds || []) {
        const m = /^recurring\|(\d+)\|[^|]*\|(\d{4})-(\d{2})-\d{2}$/.exec(String(txId));
        if (m) into.set(`${m[1]}|${m[2]}-${m[3]}`, { id: Number(m[1]), year: Number(m[2]), month: Number(m[3]) - 1 });
    }
    return into;
}

// Re-derives paidMonths for each month; returns the set of changed templates.
function _syncMonths(app, months) {
    const changed = new Set();
    for (const { id, year, month } of months.values()) {
        const tmpl = app.recurringTemplates?.find(x => x.id === id);
        if (tmpl && _syncPaidMonth(app, tmpl, year, month)) changed.add(tmpl);
    }
    return changed;
}

/**
 * Brings legacy/imported state in line with the ledger. Idempotent; called
 * after load and before each Recurring render (so state injected directly into
 * app.recurringTemplates is handled too).
 *   1. A month in paidMonths is paid in full: clear any uncleared legs, and turn
 *      a legacy paidAmounts entry into overrides where none exist yet.
 *   2. Drop the migrated paidAmounts map.
 *   3. Re-derive paidMonths for every month with a cleared recurring leg.
 * Returns true if anything changed (the caller saves).
 */
export function reconcileRecurringPaidState(app) {
    const changed = new Set();
    // Template-months with any cleared recurring key, matched by template id
    // and month rather than by the current occurrences' dates, so a start-date
    // or frequency edit that moves every occurrence still counts as owned.
    const ledgerOwned = _monthsFromTxIds(Object.keys(app.ledgerClearedTransactions || {}));
    for (const tmpl of app.recurringTemplates || []) {
        for (const mk of Array.isArray(tmpl.paidMonths) ? tmpl.paidMonths : []) {
            const [y, m] = mk.split('-').map(Number);
            const status = getRecurringMonthPaidStatus(app, tmpl, y, m - 1);
            // Only a month with no cleared leg at all is legacy (pre-#434).
            // If any leg is cleared, the Ledger already owns the month, so a
            // newly added or moved occurrence (frequency or start-date edit,
            // unskip) must not be marked paid; the re-derive below drops the
            // month from the cache instead.
            if (status.allPaid || ledgerOwned.has(`${tmpl.id}|${mk}`)) continue;
            const legacy = tmpl.paidAmounts?.[mk];
            for (const occ of status.occurrences) {
                if (occ.paid) continue;
                const useLegacy = Number.isFinite(legacy) && !occ.hasOverride;
                _applyOccurrence(app, tmpl, occ, { paid: true, actualAmount: useLegacy ? legacy : null });
            }
            if (status.total > 0) changed.add(tmpl);
        }
        if (tmpl.paidAmounts && Object.keys(tmpl.paidAmounts).length > 0) {
            tmpl.paidAmounts = {};
            changed.add(tmpl);
        }
    }
    // Months with a cleared leg may now be fully paid, so re-derive them.
    const months = _monthsFromTxIds(Object.keys(app.ledgerClearedTransactions || {}));
    for (const tmpl of _syncMonths(app, months)) changed.add(tmpl);
    for (const tmpl of changed) _persistTemplate(app, tmpl);
    return changed.size > 0;
}

/** Badge HTML for the Recurring card's current-month paid state, or '' if unpaid. */
export function buildRecurringPaidBadge(status, tmpl) {
    if (status.allPaid) {
        const total = status.occurrences.reduce((s, o) => s + o.actualAmount, 0);
        const anyOverride = status.occurrences.some(o => o.hasOverride);
        const actualLabel = anyOverride ? ' ' + tr('recurring.paidActual', { amount: formatCurrency(total) }) : '';
        return `<span class="recurring-badge recurring-badge--paid">✅ ${escapeHtml(tr('recurring.paidThisMonth'))}${escapeHtml(actualLabel)}</span>`;
    }
    if (status.paidCount > 0) {
        return `<span class="recurring-badge recurring-badge--partial">◐ ${escapeHtml(tr('recurring.paidPartial', { paid: status.paidCount, total: status.total }))}</span>`;
    }
    return '';
}

export function openRecurringMarkPaidModal(app, id, monthKey) {
    const found = _findTemplateAndMonth(app, id, monthKey);
    if (!found) return;
    const { tmpl: t, year, month } = found;
    const status = getRecurringMonthPaidStatus(app, t, year, month);
    if (status.total === 0) return;

    const existing = document.getElementById('recurringMarkPaidModal');
    if (existing) existing.remove();

    // Row 0 keeps the historical #recurringActualAmountInput id.
    const inputId = i => (i === 0 ? 'recurringActualAmountInput' : `recurringActualAmountInput-${i}`);
    const rows = status.occurrences.map((o, i) => {
        const label = escapeHtml(formatShortDate(o.date));
        return `<div class="recurring-paid-row">
            <label class="recurring-paid-row-check">
                <input type="checkbox" id="recurringPaidCheck-${i}" data-paid-iso="${o.iso}" checked>
                <span>${label}</span>
            </label>
            <input type="number" id="${inputId(i)}" class="form-control recurring-paid-row-amount" data-paid-iso="${o.iso}"
                value="${o.actualAmount}" step="0.01" min="0" aria-label="${escapeHtml(tr('recurring.actualAmountAria', { date: formatShortDate(o.date) }))}">
        </div>`;
    }).join('');

    const modal = document.createElement('div');
    modal.id = 'recurringMarkPaidModal';
    modal.className = 'modal-overlay flex-visible';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'recurringMarkPaidModalTitle');
    modal.setAttribute('tabindex', '-1');
    modal.innerHTML = `<div class="modal-content">
        <h3 class="modal-subtitle" id="recurringMarkPaidModalTitle">${escapeHtml(tr('recurring.markPaidTitle'))}</h3>
        <p class="modal-description">${escapeHtml(tr('recurring.markPaidDesc', { name: t.name }))}</p>
        <div class="recurring-paid-rows">${rows}</div>
        <p class="recurring-paid-error hidden" id="recurringMarkPaidError" role="alert"></p>
        <div class="modal-actions">
            <button class="btn btn-primary" id="recurringMarkPaidConfirmBtn">✅ ${escapeHtml(tr('recurring.markPaidBtn'))}</button>
            <button class="btn btn-secondary" id="recurringMarkPaidCancelBtn">${escapeHtml(tr('common.cancel'))}</button>
        </div>
    </div>`;
    document.body.appendChild(modal);

    const errorEl = modal.querySelector('#recurringMarkPaidError');
    const lastFocused = document.activeElement;
    const close = () => {
        modal.remove();
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    };

    modal.querySelector('#recurringMarkPaidConfirmBtn').onclick = async () => {
        const edits = [];
        for (const o of status.occurrences) {
            const paid = modal.querySelector(`input[type="checkbox"][data-paid-iso="${o.iso}"]`)?.checked ?? false;
            const raw = modal.querySelector(`input[type="number"][data-paid-iso="${o.iso}"]`)?.value ?? '';
            let amount = null;
            if (paid && raw.trim() !== '') {
                amount = sanitizeFiniteNumber(raw, null, { min: 0 });
                if (amount === null || Number(raw) < 0) {
                    errorEl.textContent = tr('recurring.errPaidAmount', { date: formatShortDate(o.date) });
                    errorEl.classList.remove('hidden');
                    return;
                }
            }
            edits.push({ iso: o.iso, paid, amount });
        }
        if (edits.some(e => e.paid && e.amount === 0)
            && !(await confirmZeroAmountAllowed(app, tr('recurring.paymentLabel', { name: t.name })))) {
            return;
        }
        close();
        applyRecurringPaidEdits(app, id, monthKey, edits);
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
    setTimeout(() => { modal.querySelector(`#${inputId(0)}`)?.select(); }, 30);
}
