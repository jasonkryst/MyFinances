# Storage Abstraction Layer — Design (Issue #41)

**Date:** 2026-07-14
**Issue:** [#41 Storage - Build Abstraction Layer](https://github.com/jasonkryst/MyFinances/issues/41)

## Summary

`storage.js` currently calls `localStorage.getItem/setItem/removeItem` directly.
This change introduces a small synchronous storage-adapter abstraction so the
app can persist to either `localStorage` (default, persists across visits) or
`sessionStorage` (cleared when the tab closes), selectable from the Settings
modal — and so a future async backend (IndexedDB, or eventually a remote API)
has a clear seam to plug into later, without that backend being built now.

## Decisions

| Question | Decision |
|---|---|
| "Database" backend scope | Not implemented in this change. Abstraction + doc seam only; no IndexedDB/SQL adapter yet. |
| Adapter interface | Synchronous (`get`/`set`/`remove` return plain values, not Promises), matching `localStorage`/`sessionStorage` exactly. A future async backend would require promoting the interface and touching every `saveToStorage()`/`loadFromStorage()` call site — documented as a known limitation, not solved here. |
| Where the backend *preference* lives | Always in `localStorage`, under its own dedicated key — a tiny non-financial flag, independent of which backend holds the actual financial data. |
| Switching backends | Automatic migration: copy current in-memory data into the new backend, then remove it from the old backend. No leftover copy, no data loss. |

## Architecture

### New module: `src/storageAdapters.js`

```js
// Adapter shape: get(key) -> string|null, set(key, value) -> void, remove(key) -> void
export class LocalStorageAdapter { /* wraps window.localStorage */ }
export class SessionStorageAdapter { /* wraps window.sessionStorage */ }

export function createStorageAdapter(kind) { /* 'local' | 'session' -> instance */ }

export const STORAGE_BACKEND_PREF_KEY = 'debtTrackerStorageBackend';
export function getStorageBackendPreference() { /* reads window.localStorage directly, defaults 'local' */ }
export function setStorageBackendPreference(kind) { /* writes window.localStorage directly */ }
```

The preference reader/writer bypass the adapter deliberately: the adapter
choice is bootstrap configuration, not app data, and reading it must not
depend on already knowing which backend to read from.

### `app.js`

- Constructor builds `this.storageAdapter = createStorageAdapter(getStorageBackendPreference())`
  *before* `this.loadFromStorage()` runs.
- The existing first-run check (`localStorage.getItem(this.storageKey) === null`)
  becomes `this.storageAdapter.get(this.storageKey) === null`.
- New thin delegating method: `switchStorageBackend(kind) { return switchStorageBackendFeature(this, kind); }`,
  following the existing app.js → feature-module pattern.

### `storage.js`

- `saveToStorage`, `loadFromStorage`, `clearAllData` swap direct `localStorage.*`
  calls on `app.storageKey` for `app.storageAdapter.*`. Serialization, sanitization,
  and the existing try/catch + quota-warning flow (`getStorageUsageInfo`,
  `showStorageQuotaWarning`) are unchanged — the adapter only changes *where*
  the JSON string is written/read, not its shape or size handling. The 5MB
  `STORAGE_ESTIMATED_QUOTA_BYTES` heuristic is reused as-is for both backends
  (browsers commonly cap `sessionStorage` in the same 5-10MB range as
  `localStorage`).
- New function `switchStorageBackend(app, kind)`:
  1. If `kind` already matches the current backend, no-op.
  2. Build the new adapter, point `app.storageAdapter` at it.
  3. Call `app.saveToStorage()` — writes the already-loaded in-memory state
     into the new backend.
  4. Remove `app.storageKey` from the *old* adapter.
  5. Persist the new preference via `setStorageBackendPreference(kind)`.
- `debtTrackerTheme` (dark/light mode) stays a direct, unabstracted
  `localStorage` key in `guideTheme.js`/`ui.js` — it's a device display
  preference, not financial data, and shouldn't disappear because a user
  picked ephemeral session storage for their finances.

### Settings UI (`index.html`, `setupWizard.js`)

- `#settingsModal` gains a new control, e.g. a `<select id="settingStorageBackend">`
  with options "Local Storage (persists across visits)" / "Session Storage
  (cleared when this tab closes)", positioned as its own `form-group` alongside
  the existing reconciliation-mode toggle.
- `initSettingsModal(app)` initializes the select from
  `getStorageBackendPreference()` and wires `onchange` to
  `app.switchStorageBackend(select.value)`.
- No confirmation dialog on switch — the operation is safe (auto-migrates,
  no data loss) and reversible (switching back migrates again).

## Backward compatibility

Default preference is `'local'` when the preference key is absent, so
existing users see no behavior change: the app boots exactly as it does
today, reading/writing the same `localStorage` key it always has.

## Out of scope

- IndexedDB or any real "database" adapter — this change only builds the
  seam and documents it as a future extension point.
- Promoting the adapter interface to async/Promise-based.
- Any change to the theme preference key, export/import format, or
  sanitization pipeline.

## Testing

New Playwright coverage, likely `tests/features/test_storage_backend.py`:

- Default backend is `'local'` when no preference key exists yet.
- Switching to `'session'` via the Settings select migrates existing data
  (verified via `sessionStorage.getItem`) and clears the `localStorage` copy
  under the same key.
- Data survives a same-tab reload while on the session backend (per the
  `sessionStorage` spec) but does not carry over to a brand-new tab/page in
  the same browser context.
- `clearAllData()` clears whichever backend is currently active.
- Existing `tests/features/test_storage_quota.py` tests keep passing
  unmodified (no behavior change to the quota-warning path).

## Documentation updates

- `CLAUDE.md` "Storage & data flow" section: mention `storageAdapters.js`,
  the adapter abstraction, and the backend-switch setting.
- `CHANGELOG.md`: new entry; bump `APP_VERSION` in `src/utils.js` per repo
  convention.
- `ROADMAP.md`: note the delivered abstraction under the BED (Storage /
  data-layer logic) section, and record the "async backend would need an
  interface promotion" limitation as a known future consideration.
