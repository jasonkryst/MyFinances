// Keep tabs and devices current (issues #575, #565).
//
// - Same browser: every successful write fires DATA_WRITTEN_EVENT
//   (postgresSync.js); this module relays it on a BroadcastChannel, and the
//   other tabs refresh within about a second.
// - Other devices: a tab that was hidden for at least REFRESH_ON_FOCUS_SECONDS
//   (window.__ENV__, default 60, 0 = always) refreshes when it is shown again.
//
// A refresh re-reads every collection into a scratch object and applies it
// only if no write started meanwhile, then re-renders the open page. It waits
// while a save is pending, an inline edit or modal is open, or the user is
// typing, so it never throws away input. The user's view (Ledger filters and
// sort, Forecast range) is kept.

import { loadFromPostgres, SessionExpiredError } from './storage.js';
import { requestLogin } from './loginGate.js';
import { pendingWriteCount, currentWriteGeneration, seedShadows, DATA_WRITTEN_EVENT } from './postgresSync.js';
import {
    SYNC_CHANNEL, parseRefreshSeconds, shouldRefreshOnReturn, refreshBlockReason,
    hasOpenInlineEdit, withoutViewState,
} from './refreshPolicy.js';

// Coalesces a burst of writes from another tab into one refresh.
const DEBOUNCE_MS = 300;
// How often a deferred refresh checks again whether it can run.
const RETRY_MS = 1000;

let state = null;

function isModalOpen() {
    return Array.from(document.querySelectorAll('[role="dialog"], .modal'))
        .some(el => !el.classList.contains('hidden') && el.getClientRects().length > 0);
}

const NON_TEXT_INPUTS = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image']);

function isTyping() {
    const el = document.activeElement;
    if (!el) return false;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return true;
    return el.tagName === 'INPUT' && !NON_TEXT_INPUTS.has((el.type || '').toLowerCase());
}

function currentBlockReason(app) {
    return refreshBlockReason({
        pendingWrites: pendingWriteCount(),
        editing: hasOpenInlineEdit(app),
        modalOpen: isModalOpen(),
        typing: isTyping(),
    });
}

function markRefresh(outcome) {
    // For tests and tooling: when the last refresh ran and how it ended.
    document.documentElement.dataset.lastRefresh = `${outcome}:${Date.now()}`;
}

function attempt() {
    if (!state) return;
    state.timer = null;
    const blocked = currentBlockReason(state.app);
    if (blocked) {
        state.deferred = blocked;
        document.documentElement.dataset.refreshDeferred = blocked;
        state.timer = setTimeout(attempt, RETRY_MS);
        return;
    }
    state.deferred = null;
    delete document.documentElement.dataset.refreshDeferred;
    refreshFromServer(state.app);
}

// Ask for a refresh soon; repeated calls within DEBOUNCE_MS collapse to one.
export function scheduleRefresh() {
    if (!state) return;
    clearTimeout(state.timer);
    state.timer = setTimeout(attempt, DEBOUNCE_MS);
}

// Re-read the server now (also the "Reload" action of the deleted-elsewhere
// notice). Resolves true when fresh data was applied.
export async function refreshFromServer(app) {
    if (state?.running) {
        state.again = true;
        return false;
    }
    if (state) state.running = true;
    const generation = currentWriteGeneration();
    try {
        const loaded = {};
        await loadFromPostgres(loaded, { seed: false });
        // A save that started while we were loading may not be in `loaded`;
        // applying it would show (and later diff against) pre-save data.
        if (currentWriteGeneration() !== generation || pendingWriteCount() > 0) {
            if (state) state.again = true;
            markRefresh('discarded');
            return false;
        }
        Object.assign(app, withoutViewState(loaded));
        seedShadows(app);
        if (typeof app.reconcileRecurringPaidState === 'function') app.reconcileRecurringPaidState();
        if (typeof app.updateUI === 'function') app.updateUI();
        if (typeof app.refreshCurrentPageData === 'function') app.refreshCurrentPageData();
        markRefresh('applied');
        return true;
    } catch (err) {
        if (err instanceof SessionExpiredError) {
            await requestLogin(app);
            if (state) state.again = true;
        } else {
            // A failed background refresh loses nothing; the next one retries.
            console.warn('[liveRefresh] refresh failed:', err);
        }
        markRefresh('failed');
        return false;
    } finally {
        if (state) {
            state.running = false;
            if (state.again) {
                state.again = false;
                scheduleRefresh();
            }
        }
    }
}

function onVisibilityChange() {
    if (!state) return;
    if (document.visibilityState === 'hidden') {
        state.hiddenAt = Date.now();
        return;
    }
    const hiddenAt = state.hiddenAt;
    state.hiddenAt = null;
    // Read on every return so an operator (or a test) can change it live.
    const threshold = parseRefreshSeconds(window.__ENV__?.REFRESH_ON_FOCUS_SECONDS);
    if (shouldRefreshOnReturn(hiddenAt, Date.now(), threshold)) scheduleRefresh();
}

function onLocalWrite() {
    try { state?.channel?.postMessage({ type: 'changed' }); } catch { /* channel closed */ }
}

// Called once, after boot has loaded data (not while a gate is up).
export function initLiveRefresh(app) {
    if (state) return;
    state = { app, timer: null, hiddenAt: null, running: false, again: false, deferred: null, channel: null };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener(DATA_WRITTEN_EVENT, onLocalWrite);
    if (typeof BroadcastChannel === 'function') {
        state.channel = new BroadcastChannel(SYNC_CHANNEL);
        state.channel.onmessage = (event) => {
            if (event?.data?.type === 'changed') scheduleRefresh();
        };
    }
}
