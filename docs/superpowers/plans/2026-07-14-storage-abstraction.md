# Storage Abstraction Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `storage.js`'s direct `localStorage` calls with a small synchronous storage-adapter abstraction, so the app can persist to `localStorage` (default) or `sessionStorage` (selectable from Settings), with a documented seam for a future async backend.

**Architecture:** A new module `src/storageAdapters.js` defines `LocalStorageAdapter`/`SessionStorageAdapter` (both implementing `get(key)`/`set(key, value)`/`remove(key)`) plus a factory and a dedicated always-`localStorage` preference key that bootstraps which adapter `DebtTrackerApp` builds at startup. `storage.js` reads/writes through `app.storageAdapter` instead of the global `localStorage`. A new `switchStorageBackend(app, kind)` migrates in-memory data to a newly chosen adapter and clears the old one. The Settings modal exposes the choice.

**Tech Stack:** Vanilla ES6 modules (no build step), Playwright + pytest for tests (existing conventions in `tests/features/` and `tests/ui/`).

## Global Constraints

- No build step, no framework, no backend — plain ES modules only (per `CLAUDE.md`).
- Adapter interface stays **synchronous** (`get`/`set`/`remove` return plain values, not Promises) — matches `localStorage`/`sessionStorage` exactly; no async backend in this change.
- The backend **preference** itself always lives directly in `window.localStorage` under its own key (`debtTrackerStorageBackend`), independent of which adapter is active — read before the app can know which adapter to build.
- Switching backends **auto-migrates**: copy current in-memory data to the new backend, then remove the data key from the old backend. No leftover copy.
- Default backend is `'local'` when no preference exists — existing users see zero behavior change.
- `debtTrackerTheme` stays a direct, unabstracted `localStorage` key — out of scope.
- No IndexedDB/SQL adapter in this change — seam + docs only.
- CSP remains `script-src 'self' https://cdn.jsdelivr.net`; `style-src 'self'` — no inline scripts/styles in any HTML changes.
- Every user-facing string added to `index.html` must not require `innerHTML`/`eval` — plain static markup only (no sanitization concerns here since nothing is dynamically rendered).

---

### Task 1: Storage adapter module + wire read/write path into app.js and storage.js

**Files:**
- Create: `src/storageAdapters.js`
- Modify: `src/app.js:35` (import), `src/app.js:137-155` (constructor)
- Modify: `src/storage.js:1-24` (imports), `src/storage.js:269-320` (`saveToStorage`), `src/storage.js:322-359` (`loadFromStorage`)
- Test: `tests/features/test_storage_backend.py` (new)

**Interfaces:**
- Produces (used by Task 2 and Task 3):
  - `createStorageAdapter(kind: 'local' | 'session') -> { get(key), set(key, value), remove(key) }`
  - `getStorageBackendPreference() -> 'local' | 'session'`
  - `setStorageBackendPreference(kind: 'local' | 'session') -> void`
  - `STORAGE_BACKEND_PREF_KEY` (string constant, `'debtTrackerStorageBackend'`)
  - `app.storageAdapter` (instance) and `app._storageBackendKind` (`'local' | 'session'`) on `DebtTrackerApp` instances.

- [ ] **Step 1: Write the failing test**

Create `tests/features/test_storage_backend.py`:

```python
#!/usr/bin/env python3
"""
Storage Adapter Abstraction Tests
storage.js persists through app.storageAdapter (src/storageAdapters.js)
instead of calling localStorage directly, so the app can be backed by either
localStorage (default) or sessionStorage. These tests exercise the adapter
selection, the default/backward-compatible path, and (later in this file)
the switchStorageBackend migration behavior.
"""

import pytest

from tests.conftest import BASE_URL

_TEST_DEBT = (
    "{ id: 1, name: 'Test Debt', category: 'Other', debtType: 'creditCard', "
    "accountBalance: 100, originalBalance: 100, interestRate: 0, "
    "minimumPayment: 10, originalMinimumPayment: 10, priority: 1 }"
)


@pytest.mark.feature
def test_default_backend_is_local_storage(app_page):
    """With no backend preference set, the app persists via localStorage,
    matching pre-abstraction behavior."""
    page = app_page

    result = page.evaluate(f"""() => {{
        window.app.debts = [{_TEST_DEBT}];
        window.app.saveToStorage();
        return {{
            backend: window.app._storageBackendKind,
            local: localStorage.getItem('debtTrackerData'),
            session: sessionStorage.getItem('debtTrackerData')
        }};
    }}""")

    assert result['backend'] == 'local'
    assert result['local'] is not None
    assert 'Test Debt' in result['local']
    assert result['session'] is None


@pytest.mark.feature
def test_session_preference_makes_app_read_write_session_storage(page):
    """When debtTrackerStorageBackend is 'session' before the app boots, it
    builds a SessionStorageAdapter and saves/loads through sessionStorage."""
    page.add_init_script("""
        try {
            localStorage.setItem('debtTrackerStorageBackend', 'session');
            sessionStorage.setItem('debtTrackerData', JSON.stringify({ accounts: [], debts: [], settings: [] }));
        } catch (e) {}
    """)
    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)

    backend = page.evaluate("() => window.app._storageBackendKind")
    assert backend == 'session'

    result = page.evaluate(f"""() => {{
        window.app.debts = [{_TEST_DEBT}];
        window.app.saveToStorage();
        return {{
            session: sessionStorage.getItem('debtTrackerData'),
            local: localStorage.getItem('debtTrackerData')
        }};
    }}""")
    assert result['session'] is not None
    assert 'Test Debt' in result['session']
    assert result['local'] is None
```

- [ ] **Step 2: Run tests to verify they fail**

Start the app server first (a separate terminal/background process):

```bash
python -m http.server 5500
```

Then run:

```bash
pytest tests/features/test_storage_backend.py -v
```

Expected: both tests FAIL — `window.app._storageBackendKind` is `undefined` (no such property exists yet).

- [ ] **Step 3: Create `src/storageAdapters.js`**

```js
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
```

- [ ] **Step 4: Wire the adapter into `src/app.js`**

Modify the import line at `src/app.js:35` — add a new import right after it:

```js
import { saveToStorage, loadFromStorage, exportAllJSON as exportAllJSONFeature, exportToCSV as exportToCSVFeature, exportLedgerToCSV as exportLedgerToCSVFeature, importAllJSON as importAllJSONFeature, clearAllData as clearAllDataFeature } from './storage.js';
import { createStorageAdapter, getStorageBackendPreference } from './storageAdapters.js';
```

In the constructor (`src/app.js:137-155`), change:

```js
        this.storageKey = 'debtTrackerData';
    this._netWorthRangeMonths = 6;
```

to:

```js
        this.storageKey = 'debtTrackerData';
        this._storageBackendKind = getStorageBackendPreference();
        this.storageAdapter = createStorageAdapter(this._storageBackendKind);
    this._netWorthRangeMonths = 6;
```

Then change the first-run check a few lines below it, from:

```js
        const isFirstRun = localStorage.getItem(this.storageKey) === null;
```

to:

```js
        const isFirstRun = this.storageAdapter.get(this.storageKey) === null;
```

- [ ] **Step 5: Wire the adapter into `src/storage.js`**

Add the import at the top of `src/storage.js` (after the existing `utils.js`/`ledger.js` imports at line 4):

```js
import { normalizeText, sanitizeFiniteNumber, sanitizeInteger, sanitizeDateISO, todayISO } from './utils.js';
import { getFilteredSortedLedgerTransactions } from './ledger.js';
import { createStorageAdapter, getStorageBackendPreference, setStorageBackendPreference } from './storageAdapters.js';
```

In `saveToStorage` (`src/storage.js:302-303`), change:

```js
        const json = JSON.stringify(data);
        localStorage.setItem(app.storageKey, json);
```

to:

```js
        const json = JSON.stringify(data);
        app.storageAdapter.set(app.storageKey, json);
```

In `loadFromStorage` (`src/storage.js:324-326`), change:

```js
    try {
        const data = localStorage.getItem(app.storageKey);
        if (data) {
```

to:

```js
    try {
        const data = app.storageAdapter.get(app.storageKey);
        if (data) {
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pytest tests/features/test_storage_backend.py -v
```

Expected: both tests PASS.

- [ ] **Step 7: Run the full existing suite for regressions**

```bash
pytest tests/features/ tests/integration/ tests/ui/test_setup_wizard.py -v
```

Expected: all PASS — this change is purely additive/backward-compatible for the default `'local'` path.

- [ ] **Step 8: Commit**

```bash
git add src/storageAdapters.js src/app.js src/storage.js tests/features/test_storage_backend.py
git commit -m "Adds storage adapter abstraction behind localStorage default per #41"
```

---

### Task 2: `switchStorageBackend` migration + `clearAllData` backend reset

**Files:**
- Modify: `src/app.js` (new delegating method, near `clearAllData()`/`saveToStorage()`/`loadFromStorage()` around line 493-530)
- Modify: `src/storage.js` (new exported `switchStorageBackend`; update `clearAllData`)
- Test: `tests/features/test_storage_backend.py` (append)

**Interfaces:**
- Consumes: `createStorageAdapter`, `getStorageBackendPreference`, `setStorageBackendPreference` from Task 1's `src/storageAdapters.js`; `app.storageAdapter`, `app._storageBackendKind`, `app.storageKey`, `app.saveToStorage()`.
- Produces (used by Task 3): `switchStorageBackend(app, kind)` exported from `src/storage.js`; `app.switchStorageBackend(kind)` method on `DebtTrackerApp`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/features/test_storage_backend.py`:

```python
@pytest.mark.feature
def test_switch_to_session_migrates_data_and_clears_local(app_page):
    """switchStorageBackend('session') copies current data into
    sessionStorage and removes the localStorage copy."""
    page = app_page

    result = page.evaluate(f"""() => {{
        window.app.debts = [{_TEST_DEBT.replace("Test Debt", "Migrate Me")}];
        window.app.saveToStorage();
        window.app.switchStorageBackend('session');
        return {{
            local: localStorage.getItem('debtTrackerData'),
            session: sessionStorage.getItem('debtTrackerData'),
            pref: localStorage.getItem('debtTrackerStorageBackend'),
            backend: window.app._storageBackendKind
        }};
    }}""")

    assert result['backend'] == 'session'
    assert result['local'] is None
    assert result['session'] is not None
    assert 'Migrate Me' in result['session']
    assert result['pref'] == 'session'


@pytest.mark.feature
def test_switch_back_to_local_migrates_data_and_clears_session(app_page):
    """Switching session -> local migrates again and clears the session
    copy, so no stale copy is left in either backend."""
    page = app_page

    result = page.evaluate(f"""() => {{
        window.app.debts = [{_TEST_DEBT.replace("Test Debt", "Round Trip")}];
        window.app.switchStorageBackend('session');
        window.app.switchStorageBackend('local');
        return {{
            local: localStorage.getItem('debtTrackerData'),
            session: sessionStorage.getItem('debtTrackerData')
        }};
    }}""")

    assert result['session'] is None
    assert result['local'] is not None
    assert 'Round Trip' in result['local']


@pytest.mark.feature
def test_switch_to_same_backend_is_noop(app_page):
    """Switching to the currently-active backend doesn't wipe data."""
    page = app_page

    result = page.evaluate(f"""() => {{
        window.app.debts = [{_TEST_DEBT.replace("Test Debt", "Stay Put")}];
        window.app.saveToStorage();
        window.app.switchStorageBackend('local');
        return localStorage.getItem('debtTrackerData');
    }}""")

    assert result is not None
    assert 'Stay Put' in result


@pytest.mark.feature
def test_backend_preference_persists_across_reload(app_page):
    """The chosen backend survives a page reload."""
    page = app_page

    page.evaluate("() => window.app.switchStorageBackend('session')")
    page.reload(wait_until="networkidle")

    backend = page.evaluate("() => window.app._storageBackendKind")
    assert backend == 'session'


@pytest.mark.feature
def test_clear_all_data_clears_active_backend_and_resets_preference(app_page):
    """clearAllData wipes whichever backend is active and resets the
    preference back to 'local', mirroring how it already resets the theme
    preference to a blank-slate state."""
    page = app_page

    result = page.evaluate("""() => {
        window.app.switchStorageBackend('session');
        window.app.clearAllData();
        return {
            session: sessionStorage.getItem('debtTrackerData'),
            local: localStorage.getItem('debtTrackerData'),
            pref: localStorage.getItem('debtTrackerStorageBackend'),
            backend: window.app._storageBackendKind
        };
    }""")

    assert result['session'] is None
    assert result['local'] is None
    assert result['pref'] == 'local'
    assert result['backend'] == 'local'
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/features/test_storage_backend.py -v
```

Expected: the 5 new tests FAIL — `window.app.switchStorageBackend is not a function`.

- [ ] **Step 3: Add `switchStorageBackend` to `src/storage.js`**

Add this new exported function, placed directly after `loadFromStorage` (after `src/storage.js:359`, before the `exportAllJSON` section):

```js
// Switch the active persistence backend, migrating current in-memory state
// into the new backend and removing the old backend's copy so nothing is
// left behind (e.g. financial data lingering in localStorage after a user
// picks Session Storage for privacy).
export function switchStorageBackend(app, kind) {
    const normalized = kind === 'session' ? 'session' : 'local';
    if (normalized === app._storageBackendKind) return;

    const oldAdapter = app.storageAdapter;
    app.storageAdapter = createStorageAdapter(normalized);
    app._storageBackendKind = normalized;
    app.saveToStorage();
    oldAdapter.remove(app.storageKey);
    setStorageBackendPreference(normalized);
}
```

- [ ] **Step 4: Update `clearAllData` in `src/storage.js`**

Change the storage-clearing lines (`src/storage.js:776-777`), from:

```js
    localStorage.removeItem(app.storageKey);
    localStorage.removeItem('debtTrackerTheme');
```

to:

```js
    app.storageAdapter.remove(app.storageKey);
    app.storageAdapter = createStorageAdapter('local');
    app._storageBackendKind = 'local';
    setStorageBackendPreference('local');
    localStorage.removeItem('debtTrackerTheme');
```

- [ ] **Step 5: Add the delegating method to `src/app.js`**

Add the import for `switchStorageBackend` at `src/app.js:35`, updating the existing storage.js import line to:

```js
import { saveToStorage, loadFromStorage, exportAllJSON as exportAllJSONFeature, exportToCSV as exportToCSVFeature, exportLedgerToCSV as exportLedgerToCSVFeature, importAllJSON as importAllJSONFeature, clearAllData as clearAllDataFeature, switchStorageBackend as switchStorageBackendFeature } from './storage.js';
```

Add the new method right after `loadFromStorage()` (`src/app.js:528-530`):

```js
    loadFromStorage() {
        return loadFromStorage(this);
    }

    /**
     * Switch the active persistence backend ('local' | 'session'),
     * migrating current data into the new backend and clearing the old one.
     */
    switchStorageBackend(kind) {
        return switchStorageBackendFeature(this, kind);
    }
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pytest tests/features/test_storage_backend.py -v
```

Expected: all 7 tests in the file PASS.

- [ ] **Step 7: Run the full existing suite for regressions**

```bash
pytest tests/ -v
```

Expected: all PASS (in particular `tests/features/test_reconciliation.py::test_clear_all_data_resets_reconciliations` and the `tests/integration/test_workflows.py` clear-data workflows, since `clearAllData`'s signature and most behavior are unchanged).

- [ ] **Step 8: Commit**

```bash
git add src/app.js src/storage.js tests/features/test_storage_backend.py
git commit -m "Adds switchStorageBackend migration and clearAllData backend reset per #41"
```

---

### Task 3: Settings modal UI for choosing the storage backend

**Files:**
- Modify: `index.html` (around line 997-1012, `#settingsModal`)
- Modify: `src/setupWizard.js` (`initSettingsModal`)
- Test: `tests/ui/test_setup_wizard.py` (append)

**Interfaces:**
- Consumes: `getStorageBackendPreference()` from `src/storageAdapters.js` (Task 1); `app.switchStorageBackend(kind)` (Task 2).
- Produces: DOM element `#settingStorageBackend` (a `<select>` with `value` `'local' | 'session'`), read/written by `initSettingsModal`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui/test_setup_wizard.py`:

```python
@pytest.mark.ui
def test_settings_modal_shows_current_storage_backend(app_page):
    """Opening Settings reflects the active storage backend in the select."""
    page = app_page

    page.click('#settingsBtn')
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)

    value = page.evaluate("() => document.getElementById('settingStorageBackend').value")
    assert value == 'local'


@pytest.mark.ui
def test_settings_modal_switching_backend_migrates_on_done(app_page):
    """Selecting Session Storage and clicking Done switches the active
    backend and migrates existing data into it."""
    page = app_page

    page.evaluate("""() => {
        window.app.debts = [{ id: 1, name: 'UI Switch Debt', category: 'Other', debtType: 'creditCard', accountBalance: 10, originalBalance: 10, interestRate: 0, minimumPayment: 5, originalMinimumPayment: 5, priority: 1 }];
        window.app.saveToStorage();
    }""")

    page.click('#settingsBtn')
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)
    page.select_option('#settingStorageBackend', 'session')
    page.click('#settingsModalDoneBtn')
    page.wait_for_timeout(200)

    result = page.evaluate("""() => ({
        backend: window.app._storageBackendKind,
        session: sessionStorage.getItem('debtTrackerData'),
        local: localStorage.getItem('debtTrackerData')
    })""")
    assert result['backend'] == 'session'
    assert result['session'] is not None
    assert 'UI Switch Debt' in result['session']
    assert result['local'] is None


@pytest.mark.ui
def test_settings_modal_escape_does_not_switch_backend(app_page):
    """Pressing Escape after changing the select, without clicking Done,
    leaves the active backend unchanged — matching the existing
    reconciliation-checkbox discard-on-escape behavior."""
    page = app_page

    page.click('#settingsBtn')
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)
    page.wait_for_function(
        "() => document.activeElement && document.activeElement.id === 'settingReconciliationAdjusts'",
        timeout=2000
    )
    page.select_option('#settingStorageBackend', 'session')
    page.keyboard.press('Escape')
    page.wait_for_timeout(200)

    backend = page.evaluate("() => window.app._storageBackendKind")
    assert backend == 'local'
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/ui/test_setup_wizard.py -v
```

Expected: the 3 new tests FAIL — `#settingStorageBackend` doesn't exist yet (`document.getElementById(...)` returns `null`, `.value` throws / select_option can't find the element).

- [ ] **Step 3: Add the select to `index.html`**

In `#settingsModal` (currently `index.html:997-1012`), change:

```html
    <div id="settingsModal" class="modal modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="settingsModalTitle" tabindex="-1">
        <div class="modal-content">
            <button id="settingsModalCloseBtn" aria-label="Close" class="modal-close">&times;</button>
            <h3 id="settingsModalTitle">Settings</h3>
            <div class="form-group modal-form-group">
                <label class="settings-toggle-row" for="settingReconciliationAdjusts">
                    <input type="checkbox" id="settingReconciliationAdjusts">
                    <span>Reconciliations adjust the tracked balance</span>
                </label>
                <p class="modal-helper-text">When on, reconciling an account replaces its tracked balance with the statement balance you enter. When off, reconciliations are recorded and shown on the Ledger for transparency, but the tracked balance keeps being computed from your transactions.</p>
            </div>
            <div class="modal-actions">
                <button id="settingsModalDoneBtn" class="btn btn-success">Done</button>
            </div>
        </div>
    </div>
```

to:

```html
    <div id="settingsModal" class="modal modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="settingsModalTitle" tabindex="-1">
        <div class="modal-content">
            <button id="settingsModalCloseBtn" aria-label="Close" class="modal-close">&times;</button>
            <h3 id="settingsModalTitle">Settings</h3>
            <div class="form-group modal-form-group">
                <label class="settings-toggle-row" for="settingReconciliationAdjusts">
                    <input type="checkbox" id="settingReconciliationAdjusts">
                    <span>Reconciliations adjust the tracked balance</span>
                </label>
                <p class="modal-helper-text">When on, reconciling an account replaces its tracked balance with the statement balance you enter. When off, reconciliations are recorded and shown on the Ledger for transparency, but the tracked balance keeps being computed from your transactions.</p>
            </div>
            <div class="form-group modal-form-group">
                <label for="settingStorageBackend">Data Storage</label>
                <select id="settingStorageBackend">
                    <option value="local">Local Storage (persists across visits)</option>
                    <option value="session">Session Storage (cleared when this tab closes)</option>
                </select>
                <p class="modal-helper-text">Local Storage keeps your data saved on this device between visits. Session Storage keeps it only for as long as this browser tab stays open, then clears it automatically when the tab closes.</p>
            </div>
            <div class="modal-actions">
                <button id="settingsModalDoneBtn" class="btn btn-success">Done</button>
            </div>
        </div>
    </div>
```

- [ ] **Step 4: Wire the select in `src/setupWizard.js`**

Add the import at the top of `src/setupWizard.js`:

```js
import { getSetting, setSetting, RECONCILIATION_ADJUSTS_BALANCE } from './settings.js';
import { getStorageBackendPreference } from './storageAdapters.js';
```

In `initSettingsModal`, change:

```js
export function initSettingsModal(app) {
    const modal = document.getElementById('settingsModal');
    const settingsBtn = document.getElementById('settingsBtn');
    const closeBtn = document.getElementById('settingsModalCloseBtn');
    const doneBtn = document.getElementById('settingsModalDoneBtn');
    const adjustsCheckbox = document.getElementById('settingReconciliationAdjusts');
    if (!modal || !settingsBtn || !closeBtn || !doneBtn || !adjustsCheckbox) return;
```

to:

```js
export function initSettingsModal(app) {
    const modal = document.getElementById('settingsModal');
    const settingsBtn = document.getElementById('settingsBtn');
    const closeBtn = document.getElementById('settingsModalCloseBtn');
    const doneBtn = document.getElementById('settingsModalDoneBtn');
    const adjustsCheckbox = document.getElementById('settingReconciliationAdjusts');
    const storageSelect = document.getElementById('settingStorageBackend');
    if (!modal || !settingsBtn || !closeBtn || !doneBtn || !adjustsCheckbox || !storageSelect) return;
```

Then change the `open` and `save` functions from:

```js
    const open = () => {
        lastFocused = document.activeElement;
        adjustsCheckbox.checked = Boolean(getSetting(app, RECONCILIATION_ADJUSTS_BALANCE, false));
        modal.classList.add('flex-visible');
        modal.classList.remove('hidden');
        modal.onkeydown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
            }
        };
        setTimeout(() => adjustsCheckbox.focus(), 30);
    };

    const save = () => {
        setSetting(app, RECONCILIATION_ADJUSTS_BALANCE, adjustsCheckbox.checked);
        close();
    };
```

to:

```js
    const open = () => {
        lastFocused = document.activeElement;
        adjustsCheckbox.checked = Boolean(getSetting(app, RECONCILIATION_ADJUSTS_BALANCE, false));
        storageSelect.value = getStorageBackendPreference();
        modal.classList.add('flex-visible');
        modal.classList.remove('hidden');
        modal.onkeydown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
            }
        };
        setTimeout(() => adjustsCheckbox.focus(), 30);
    };

    const save = () => {
        setSetting(app, RECONCILIATION_ADJUSTS_BALANCE, adjustsCheckbox.checked);
        app.switchStorageBackend(storageSelect.value);
        close();
    };
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pytest tests/ui/test_setup_wizard.py -v
```

Expected: all tests in the file PASS, including the 3 new ones.

- [ ] **Step 6: Run the full existing suite for regressions**

```bash
pytest tests/ -v
```

Expected: all PASS, including `tests/ui/test_accessibility.py` (which references the Settings modal) and `tests/security/test_static_scan.py`/`tests/security/test_xss.py` (new markup is plain static HTML, no inline scripts/styles, no `innerHTML`).

- [ ] **Step 7: Manually verify in a real browser**

```bash
python -m http.server 5500
```

Open `http://localhost:5500/`, click the gear icon, confirm the new "Data Storage" select appears with correct default, switch to Session Storage, click Done, add a debt, reload the page (data should still be there — same tab), then close and reopen the tab fresh (data should be gone, and Settings should show Session Storage still selected since the preference itself persists in localStorage).

- [ ] **Step 8: Commit**

```bash
git add index.html src/setupWizard.js tests/ui/test_setup_wizard.py
git commit -m "Adds Settings-modal control for choosing the storage backend per #41"
```

---

### Task 4: Documentation updates

**Files:**
- Modify: `CLAUDE.md` (Storage & data flow section)
- Modify: `CHANGELOG.md`
- Modify: `ROADMAP.md` (BED section)
- Modify: `src/utils.js` (`APP_VERSION`)

No new tests — this task is documentation-only, verified by reading the diffs.

- [ ] **Step 1: Update `CLAUDE.md`**

In the "### Storage & data flow" section, change:

```markdown
### Storage & data flow
- `storage.js` handles `localStorage` persistence under key `debtTrackerData`, plus JSON export/import (current format version `"3.0"`) and CSV export.
```

to:

```markdown
### Storage & data flow
- `storage.js` persists app state under key `debtTrackerData` through a storage-adapter abstraction (`src/storageAdapters.js`), plus JSON export/import (current format version `"3.0"`) and CSV export.
- **Storage adapters**: `app.storageAdapter` is either a `LocalStorageAdapter` (default) or `SessionStorageAdapter`, chosen at startup from `getStorageBackendPreference()` — a dedicated `debtTrackerStorageBackend` key always read/written directly against `localStorage` (never through the adapter, since it decides which adapter to build). Users switch backends from the Settings modal, which calls `app.switchStorageBackend(kind)`; this migrates current data into the new backend and removes it from the old one. The adapter interface (`get`/`set`/`remove`) is deliberately synchronous to match `localStorage`/`sessionStorage`; a future async backend (IndexedDB, a remote API) would require promoting the interface to Promises and updating every `saveToStorage()`/`loadFromStorage()` call site — see `docs/superpowers/specs/2026-07-14-storage-abstraction-design.md`.
```

- [ ] **Step 2: Add a `CHANGELOG.md` entry**

At the top of `CHANGELOG.md`, right after the header block (before `## [4.5.0] — 2026-07-14`), insert:

```markdown
## [4.6.0] — 2026-07-14

### Added
- **Storage abstraction layer (#41)** — `storage.js` now persists through a swappable adapter (`src/storageAdapters.js`) instead of calling `localStorage` directly. Users can choose Local Storage (default, persists across visits) or Session Storage (cleared when the tab closes) from the Settings modal; switching migrates existing data into the new backend and clears the old copy. The adapter interface stays synchronous by design — a documented seam for a future async backend (e.g. IndexedDB) exists but isn't implemented in this change. See `docs/superpowers/specs/2026-07-14-storage-abstraction-design.md`.

---

```

- [ ] **Step 3: Bump `APP_VERSION` in `src/utils.js`**

Change:

```js
export const APP_VERSION = '4.5.0';
```

to:

```js
export const APP_VERSION = '4.6.0';
```

- [ ] **Step 4: Update `ROADMAP.md`**

In the "#### 🗄️ BED (Storage / data-layer logic)" section, change:

```markdown
- ~~**localStorage quota monitoring**~~ ✅ **Delivered June 20, 2026** — `storage.js` now estimates the serialized payload size against a conservative 5MB quota on every save and shows a dismissible warning banner above ~80% usage (or on an actual write failure).
- **Web Worker for `debtCalculator.js`** — the daily-compounding payoff engine runs synchronously on the main thread; fine today, but a future "10 debts × 30-year amortization schedule" scenario could janky the UI. Worth profiling before committing to this.
```

to:

```markdown
- ~~**localStorage quota monitoring**~~ ✅ **Delivered June 20, 2026** — `storage.js` now estimates the serialized payload size against a conservative 5MB quota on every save and shows a dismissible warning banner above ~80% usage (or on an actual write failure).
- ~~**Storage abstraction layer**~~ ✅ **Delivered July 14, 2026 (#41)** — `storage.js` now persists through `app.storageAdapter` (`src/storageAdapters.js`) instead of calling `localStorage` directly; users can pick Local Storage or Session Storage from Settings, with auto-migration on switch. The adapter interface stays synchronous — a future async backend (IndexedDB, a remote API) would need the interface promoted to Promises and every call site touched, which is *not* done here.
- **Web Worker for `debtCalculator.js`** — the daily-compounding payoff engine runs synchronously on the main thread; fine today, but a future "10 debts × 30-year amortization schedule" scenario could janky the UI. Worth profiling before committing to this.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md CHANGELOG.md ROADMAP.md src/utils.js
git commit -m "Documents storage abstraction layer and bumps version to 4.6.0 per #41"
```
