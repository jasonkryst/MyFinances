// Undo for deletes and archives (#577). After a delete or an (un)archive, an
// Undo notice shows for UNDO_WINDOW_MS. Undo for an archive flips it back;
// Undo for a delete re-creates the record (it gets a new server id), moves its
// Ledger overrides and Cleared flags to the new id, and re-creates a debt's
// balance history, which the server deleted with it (ON DELETE CASCADE).
//
// Accessibility: the notice lives in an always-present polite live region;
// the countdown pauses while the pointer or focus is inside it; when the
// deleted item's button took focus with it, focus moves to Undo; Ctrl/Cmd+Z
// runs it while it is showing (KEYBOARD_SHORTCUTS).

import { t } from './i18n.js';
import { pgCreate, pgPut, pgDelete } from './postgresSync.js';
import { planLedgerRekey, recordForRecreate } from './undoCore.js';

export const UNDO_WINDOW_MS = 10000;

let current = null; // { undo, timer, remaining, startedAt, busy }

const el = id => document.getElementById(id);

function clearTimer() {
    if (current?.timer) clearTimeout(current.timer);
    if (current) current.timer = null;
}

function startTimer() {
    if (!current) return;
    clearTimer();
    current.startedAt = Date.now();
    current.timer = setTimeout(() => dismissUndo(), current.remaining);
}

function pauseTimer() {
    if (!current?.timer) return;
    current.remaining = Math.max(1000, current.remaining - (Date.now() - current.startedAt));
    clearTimer();
}

function hideToast() {
    const toast = el('undoToast');
    if (!toast) return;
    if (toast.contains(document.activeElement)) {
        // Don't strand focus on a hidden button: hand it to the visible page.
        const section = document.querySelector('section.active') || document.querySelector('main') || document.body;
        if (!section.hasAttribute('tabindex')) section.setAttribute('tabindex', '-1');
        section.focus({ preventScroll: true });
    }
    toast.classList.add('hidden');
}

export function hasActiveUndo() {
    return current !== null;
}

// Shows the notice. `undo` is an async function returning a truthy value on
// success. A new notice replaces the previous one (whose window just ends).
export function offerUndo(message, undo) {
    const toast = el('undoToast');
    const msg = el('undoToastMessage');
    if (!toast || !msg) return;
    clearTimer();
    const active = document.activeElement;
    const focusLost = !active || active === document.body || !active.isConnected;
    current = { undo, timer: null, remaining: UNDO_WINDOW_MS, startedAt: 0, busy: false, autoFocus: false };
    msg.textContent = message;
    toast.classList.remove('hidden');
    el('undoToastBtn').disabled = false;
    if (toast.matches(':hover')) return; // paused until the pointer leaves
    startTimer();
    // Moving focus here ourselves is not the user pausing the countdown.
    if (focusLost) {
        current.autoFocus = true;
        el('undoToastBtn').focus({ preventScroll: true });
        current.autoFocus = false;
    }
}

export function dismissUndo() {
    clearTimer();
    current = null;
    hideToast();
}

// Runs the pending undo. Resolves true when it succeeded.
export async function runUndo() {
    if (!current || current.busy) return false;
    const action = current;
    action.busy = true;
    clearTimer();
    el('undoToastBtn').disabled = true;
    let ok = false;
    try {
        ok = Boolean(await action.undo());
    } catch (err) {
        console.error('[undo] failed:', err);
    }
    if (current !== action) return ok;
    current = null;
    const msg = el('undoToastMessage');
    if (ok) {
        hideToast();
        // The notice is gone; a separate polite region announces the result.
        const region = el('undoToastAnnounce');
        if (region) {
            region.textContent = t('undo.done');
            setTimeout(() => { if (region.textContent === t('undo.done')) region.textContent = ''; }, 3000);
        }
    } else {
        if (msg) msg.textContent = t('undo.failed');
        setTimeout(() => { if (!current) hideToast(); }, 5000);
    }
    return ok;
}

export function initUndoToast() {
    const toast = el('undoToast');
    if (!toast || toast.dataset.wired) return;
    toast.dataset.wired = 'true';
    el('undoToastBtn')?.addEventListener('click', () => runUndo());
    el('undoToastClose')?.addEventListener('click', () => dismissUndo());
    // Hovering, or the user moving focus into the notice, pauses the countdown;
    // leaving restarts it with the time that was left.
    let userFocused = false;
    toast.addEventListener('mouseenter', pauseTimer);
    toast.addEventListener('focusin', () => {
        if (current?.autoFocus) return;
        userFocused = true;
        pauseTimer();
    });
    toast.addEventListener('mouseleave', () => {
        if (current && !current.timer && !current.busy && !userFocused) startTimer();
    });
    toast.addEventListener('focusout', (e) => {
        if (toast.contains(e.relatedTarget)) return;
        userFocused = false;
        if (current && !current.timer && !current.busy && !toast.matches(':hover')) startTimer();
    });
    document.addEventListener('keydown', (e) => {
        if (!current || e.key.toLowerCase() !== 'z' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
        const tgt = e.target;
        if (tgt && (tgt.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(tgt.tagName))) return;
        e.preventDefault();
        runUndo();
    });
}

const LEDGER_MAPS = [
    ['ledgerAmountOverrides', '/api/ledger-overrides/', 'overrideKey'],
    ['ledgerClearedTransactions', '/api/ledger-cleared/', 'clearedKey'],
];

// Re-creates a deleted record. `deletion` is the promise of its DELETE (so the
// re-create never races it). `index` puts it back where it was in the list.
// `ledgerType` is the Ledger key type ('debt', 'income', 'bonus',
// 'recurring'). `history` (debts) is the balance history removed with it.
// Returns the restored record, or null when the re-create failed (pgCreate has
// shown the sync-error banner).
export async function restoreDeletedRecord(app, { collection, path, record, index = -1, deletion, ledgerType, history = [] }) {
    try { await deletion; } catch { /* a failed DELETE was already reported */ }
    const body = recordForRecreate(record);
    if (!body) return null;
    const created = await pgCreate(app, collection, path, body);
    if (!created) return null;

    const list = app[collection];
    const at = list.indexOf(created);
    if (index >= 0 && index < list.length - 1 && at !== -1) {
        list.splice(at, 1);
        list.splice(index, 0, created);
    }

    for (const [mapName, base, keyField] of LEDGER_MAPS) {
        const map = app[mapName] || (app[mapName] = {});
        for (const { oldKey, newKey, value } of planLedgerRekey(map, ledgerType, record.id, created.id)) {
            const moved = { ...value, [keyField]: newKey };
            delete map[oldKey];
            map[newKey] = moved;
            pgPut(app, `${base}${encodeURIComponent(newKey)}`, moved);
            pgDelete(app, `${base}${encodeURIComponent(oldKey)}`);
        }
    }

    for (const entry of history) {
        const copy = recordForRecreate(entry);
        if (copy) await pgCreate(app, 'balanceHistory', '/api/balance-history', { ...copy, debtId: created.id });
    }
    return created;
}
