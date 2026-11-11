// When to re-read the server (issues #575, #565). Pure and DOM-free (Jest +
// Stryker scope); src/liveRefresh.js does the wiring.

// Same-browser tabs announce writes on this channel (postgresSync.js posts,
// liveRefresh.js listens).
export const SYNC_CHANNEL = 'myfinances-sync';

export const DEFAULT_REFRESH_ON_FOCUS_SECONDS = 60;

// REFRESH_ON_FOCUS_SECONDS from window.__ENV__ (docker-entrypoint.d writes it
// from the env var of the same name). A finite number >= 0 is used as is; 0
// means refresh on every return. Anything else falls back to the default.
export function parseRefreshSeconds(raw) {
    let n = raw;
    if (typeof raw === 'string') {
        const s = raw.trim();
        n = /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
    }
    // Number.isFinite is false for every non-number, so no typeof check.
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_REFRESH_ON_FOCUS_SECONDS;
}

// A tab returning to view refreshes once it was hidden for at least the
// threshold. Never hidden (hiddenAt null) means nothing to catch up on.
export function shouldRefreshOnReturn(hiddenAtMs, nowMs, thresholdSeconds) {
    if (!Number.isFinite(hiddenAtMs) || !Number.isFinite(nowMs)) return false;
    return nowMs - hiddenAtMs >= thresholdSeconds * 1000;
}

// Why a refresh must wait, or null when it can run now. A refresh replaces
// every collection and re-renders the page, so it must not land while a save
// is in flight (it could load the pre-save row) or while the user is in the
// middle of editing (the re-render would throw their input away).
export function refreshBlockReason({ pendingWrites = 0, editing = false, modalOpen = false, typing = false } = {}) {
    if (pendingWrites > 0) return 'pending-writes';
    if (editing) return 'editing';
    if (modalOpen) return 'modal-open';
    if (typing) return 'typing';
    return null;
}

// True when any `editing…Id` field on the app (editingDebtId,
// editingRecurringId, ...) holds a record id: an inline edit form is open.
export function hasOpenInlineEdit(app) {
    if (!app) return false;
    return Object.keys(app).some(k => /^editing[A-Z]\w*Id$/.test(k) && app[k] !== null && app[k] !== undefined);
}

// View state loadFromPostgres also sets from the server row. A background
// refresh keeps the values on screen instead of jumping the user's view.
export const VIEW_STATE_FIELDS = [
    '_ledgerAccountFilter', '_ledgerDateRange', '_ledgerSortKey', '_ledgerSortDir', '_ledgerClearedFilter',
    '_forecastRangeMonths', '_forecastAccountId', '_forecastNotableThresholdPct',
];

// A loaded snapshot minus the view-state fields, ready to Object.assign onto
// the app.
export function withoutViewState(loaded) {
    if (!loaded || typeof loaded !== 'object') return {};
    const out = { ...loaded };
    for (const k of VIEW_STATE_FIELDS) delete out[k];
    return out;
}
