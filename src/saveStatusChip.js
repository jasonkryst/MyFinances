// Header "Saving… / All changes saved" chip and the unload warning (#576).
// Wiring only: the state machine is the pure reduceSaveStatus (saveStatus.js)
// and the counter is postgresSync.js's pendingWriteCount(), announced through
// WRITES_CHANGED_EVENT.

import { t } from './i18n.js';
import { pendingWriteCount, WRITES_CHANGED_EVENT } from './postgresSync.js';
import {
    INITIAL_SAVE_STATE, reduceSaveStatus, shouldWarnOnUnload, SAVED_VISIBLE_MS, SETTLE_MS
} from './saveStatus.js';

const TEXT_KEYS = {
    saving: 'saveStatus.saving',
    saved: 'saveStatus.saved',
    error: 'saveStatus.error'
};

let initialized = false;

export function initSaveStatusChip() {
    if (initialized) return;
    initialized = true;

    let state = INITIAL_SAVE_STATE;
    let settleTimer = null;
    let fadeTimer = null;

    const render = () => {
        const chip = document.getElementById('saveStatusChip');
        const text = document.getElementById('saveStatusText');
        if (!chip || !text) return;
        const key = TEXT_KEYS[state.status];
        chip.classList.toggle('hidden', !key);
        chip.dataset.state = state.status;
        // Only a change of state touches the text, so the polite live region
        // announces Saving once and Saved once, not every request.
        const next = key ? t(key) : '';
        if (text.textContent !== next) text.textContent = next;
    };

    const dispatch = event => {
        const prev = state;
        state = reduceSaveStatus(state, event);
        if (state.status !== prev.status || state.pending !== prev.pending) schedule();
        render();
    };

    const schedule = () => {
        clearTimeout(settleTimer);
        clearTimeout(fadeTimer);
        if (state.status === 'saving' && state.pending === 0) {
            settleTimer = setTimeout(() => dispatch({ type: 'settle' }), SETTLE_MS);
        } else if (state.status === 'saved') {
            fadeTimer = setTimeout(() => dispatch({ type: 'fade' }), SAVED_VISIBLE_MS);
        }
    };

    window.addEventListener(WRITES_CHANGED_EVENT, e => {
        dispatch({ type: 'writes', pending: e.detail?.pending, failed: e.detail?.failed === true });
    });

    // Ask before closing the tab while a save is still in flight. Nothing is
    // prevented when nothing is pending.
    window.addEventListener('beforeunload', e => {
        if (!shouldWarnOnUnload(pendingWriteCount())) return;
        e.preventDefault();
        e.returnValue = '';
    });

    render();
}
