// Saving / All changes saved chip state (#576). Pure and DOM-free (Jest +
// Stryker scope); saveStatusChip.js does the wiring.
//
// status: 'idle' (nothing shown) | 'saving' | 'saved' | 'error'.
// `pending` is postgresSync's pendingWriteCount(). `failed` remembers that a
// write failed since the current burst of saves began, so a burst that
// contained a failure can never end as "saved".

export const SAVED_VISIBLE_MS = 3000;
// Pending must stay at 0 this long before the burst counts as finished, so
// back-to-back saves (a POST then a PATCH) don't flash Saved between them.
export const SETTLE_MS = 400;

export const INITIAL_SAVE_STATE = Object.freeze({ status: 'idle', pending: 0, failed: false });

// events:
//   { type: 'writes', pending, failed? } the in-flight count changed (failed
//                                        is true when a write just failed)
//   { type: 'settle' }                   pending has stayed 0 for SETTLE_MS
//   { type: 'fade' }                     the "saved" message has been shown long enough
export function reduceSaveStatus(state, event) {
    switch (event?.type) {
    case 'writes': {
        const pending = Number.isFinite(event.pending) && event.pending > 0 ? Math.floor(event.pending) : 0;
        const startsBurst = state.status !== 'saving' && pending > 0;
        const failed = (startsBurst ? false : state.failed) || event.failed === true;
        if (pending > 0) return { status: 'saving', pending, failed };
        // A failure with nothing left in flight is final right away.
        if (event.failed === true) return { status: 'error', pending: 0, failed: true };
        return { ...state, pending: 0, failed };
    }
    case 'settle':
        if (state.pending > 0 || state.status !== 'saving') return state;
        return { status: state.failed ? 'error' : 'saved', pending: 0, failed: state.failed };
    case 'fade':
        return state.status === 'saved' ? { ...state, status: 'idle' } : state;
    default:
        return state;
    }
}

// Whether closing the tab should ask for confirmation.
export function shouldWarnOnUnload(pending) {
    return Number.isFinite(pending) && pending > 0;
}
