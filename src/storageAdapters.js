// Storage adapter abstraction — lets the app persist to different
// synchronous key/value backends (localStorage today, sessionStorage as an
// alternative) behind one interface. See
// docs/superpowers/specs/2026-07-14-storage-abstraction-design.md for the
// full design, including why a future async backend (IndexedDB, a remote
// API) would require promoting this interface to Promises rather than
// dropping in cleanly.
//
// Adapter shape: get(key) -> string|null, set(key, value) -> void, remove(key) -> void

export class LocalStorageAdapter {
    get(key) { return window.localStorage.getItem(key); }
    set(key, value) { window.localStorage.setItem(key, value); }
    remove(key) { window.localStorage.removeItem(key); }
}

export class SessionStorageAdapter {
    get(key) { return window.sessionStorage.getItem(key); }
    set(key, value) { window.sessionStorage.setItem(key, value); }
    remove(key) { window.sessionStorage.removeItem(key); }
}

export function createStorageAdapter(kind) {
    return kind === 'session' ? new SessionStorageAdapter() : new LocalStorageAdapter();
}

// The backend choice itself always lives directly in window.localStorage,
// under its own key, independent of whichever adapter is currently active —
// reading it can't depend on already knowing which backend to read from.
export const STORAGE_BACKEND_PREF_KEY = 'debtTrackerStorageBackend';

export function getStorageBackendPreference() {
    const raw = window.localStorage.getItem(STORAGE_BACKEND_PREF_KEY);
    return raw === 'session' ? 'session' : 'local';
}

export function setStorageBackendPreference(kind) {
    window.localStorage.setItem(STORAGE_BACKEND_PREF_KEY, kind === 'session' ? 'session' : 'local');
}
