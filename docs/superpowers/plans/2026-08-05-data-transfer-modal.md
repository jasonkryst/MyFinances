# Consolidated Data Transfer Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the toolbar's separate ⬇️ Export / ⬆️ Import buttons with one `#dataTransferBtn` button that opens a two-tab modal (`#dataTransferModal`), and move Import's `alert()`/`confirm()` feedback (invalid file, no data, too large, read error, Replace-vs-Merge choice) into inline modal UI.

**Architecture:** New `src/dataTransferModal.js` module (mirrors `setupWizard.js`'s `initSettingsModal` shape) owns the modal's open/close/tab-switching and the relocated `#exportJsonBtn`/`#importJsonBtn`/`#importJsonInput` wiring (moved out of `ui.js`). `dataExport.js`'s `importAllJSON` gets a minimal async change so its Replace-vs-Merge decision can await a real UI interaction instead of a blocking `confirm()`. `app.js`'s `importAllJSON()` method swaps its `alert`/`confirm` callbacks for the new module's `showImportResult`/`requestImportModeChoice`.

**Tech Stack:** Vanilla ES6 modules, no build step. Playwright (Python, sync + async) for feature tests.

## Global Constraints

- CSP is `script-src 'self' https://cdn.jsdelivr.net; style-src 'self'` — no inline `<script>`/`style=`, no `eval`. All dynamic styling toggles CSS classes; all dynamic text uses `textContent`/`setAttribute`, never `innerHTML`.
- Existing control ids `#exportJsonBtn`, `#importJsonBtn`, `#importJsonInput` are **kept** (only relocated into the modal) — do not rename them.
- Every feature module exports plain functions taking `app` as first arg; `DebtTrackerApp` gets thin delegating methods (existing `exportAllJSON()`/`importAllJSON()` methods already do this and are unchanged in shape).
- `APP_VERSION` in `src/utils.js` and the top `CHANGELOG.md` heading must move together (enforced by `tests/features/test_versioning.py`). Current version: `4.11.0` → this plan bumps to `4.12.0`.
- Toolbar buttons are translated (`toolbar.*` keys in `src/locales/{en,es,pl}.js`) — the new consolidated button and modal follow the same convention; `en.js` is canonical, `es.js`/`pl.js` only need the same pilot-scope keys added here (per `CLAUDE.md`'s i18n section).
- Modals in this codebase show/hide via `classList.add('hidden')`/`classList.add('flex-visible')` (never inline `style=`), and the pattern of `data-i18n`/`data-i18n-attr` on static markup, applied by `applyStaticTranslations()` — follow both.

---

### Task 1: Toolbar button, modal markup, tab-switching, CSS, and `en.js` strings

**Files:**
- Modify: `index.html:20-34` (toolbar), insert new modal after `index.html:1059` (right after `#settingsModal`'s closing `</div>`, before the `<!-- First-run setup -->` comment)
- Modify: `styles.css` (new rule block, insert after the `.rpt-tab-panel--active` rule so it sits near its source pattern — search for `.rpt-tab-panel--active { display: block; }` and insert after it)
- Modify: `src/locales/en.js:8-11` (replace `toolbar.exportTitle`/`exportAriaLabel`/`importTitle`/`importAriaLabel` with `toolbar.dataTransferTitle`/`AriaLabel`), and after `settings.done` add a new `dataTransfer.*` block
- Test: `tests/ui/test_data_transfer_modal.py` (new file — this task only adds the structural tests; behavior tests come in later tasks)

**Interfaces:**
- Produces (used by later tasks): `#dataTransferBtn` (toolbar button), `#dataTransferModal` (`.modal.modal-overlay`), `#dataTransferModalCloseBtn`, tab buttons `[data-dt-tab="export"]`/`[data-dt-tab="import"]` with class `.dt-tab-btn`, panels `#dataTransferPanel-export`/`#dataTransferPanel-import` with class `.dt-tab-panel`, `#exportJsonBtn` (now inside `#dataTransferPanel-export`), `#importJsonBtn`/`#importJsonInput` (now inside `#dataTransferPanel-import`), `#importResultBanner`, `#importModeChoice`/`#importModeSummary`/`#importModeReplaceBtn`/`#importModeMergeBtn` (present in markup but not yet wired — Task 4).

- [ ] **Step 1: Write the failing structural test**

Create `tests/ui/test_data_transfer_modal.py`:

```python
#!/usr/bin/env python3
"""
Consolidated Export/Import "Backup & Restore" modal tests.

The toolbar's separate Export/Import icon buttons were replaced with one
#dataTransferBtn that opens a two-tab modal (#dataTransferModal). Import's
former alert()/confirm() feedback (invalid file, no data, too large, read
error, Replace-vs-Merge choice) now renders inline in the Import tab
instead. #exportJsonBtn/#importJsonBtn/#importJsonInput kept their ids,
just moved inside the modal.
"""

import pytest

from tests.conftest import open_data_transfer, close_data_transfer, assert_no_errors


@pytest.mark.ui
def test_toolbar_no_longer_has_separate_export_import_buttons(app_page):
    """Negative: the old standalone toolbar buttons are gone."""
    page = app_page
    assert page.query_selector('.header-toolbar > #exportJsonBtn') is None
    assert page.query_selector('.header-toolbar > #importJsonBtn') is None
    assert page.query_selector('#dataTransferBtn') is not None


@pytest.mark.ui
def test_data_transfer_modal_hidden_until_opened(app_page):
    """Negative: the modal (and everything in it) is not visible/interactable
    before the toolbar button is clicked."""
    page = app_page
    assert page.is_visible('#dataTransferModal') is False
    assert page.is_visible('#exportJsonBtn') is False
    assert page.is_visible('#importJsonBtn') is False


@pytest.mark.ui
def test_opening_modal_defaults_to_export_tab(app_page):
    """Positive: Export is the default active tab (lower-risk, more
    frequently used action)."""
    page = app_page
    open_data_transfer(page)

    assert page.is_visible('#exportJsonBtn') is True
    assert page.is_visible('#importJsonBtn') is False
    export_selected = page.get_attribute('[data-dt-tab="export"]', 'aria-selected')
    import_selected = page.get_attribute('[data-dt-tab="import"]', 'aria-selected')
    assert export_selected == 'true'
    assert import_selected == 'false'
    assert_no_errors(page)


@pytest.mark.ui
def test_switching_to_import_tab_shows_import_panel(app_page):
    """Positive: clicking the Import tab swaps visible panels and
    aria-selected state."""
    page = app_page
    open_data_transfer(page)

    page.click('[data-dt-tab="import"]')
    page.wait_for_timeout(100)

    assert page.is_visible('#importJsonBtn') is True
    assert page.is_visible('#exportJsonBtn') is False
    export_selected = page.get_attribute('[data-dt-tab="export"]', 'aria-selected')
    import_selected = page.get_attribute('[data-dt-tab="import"]', 'aria-selected')
    assert export_selected == 'false'
    assert import_selected == 'true'


@pytest.mark.ui
def test_close_button_hides_modal(app_page):
    """Positive: the × close button hides the modal again."""
    page = app_page
    open_data_transfer(page)
    close_data_transfer(page)

    assert page.is_visible('#dataTransferModal') is False
```

- [ ] **Step 2: Add `open_data_transfer`/`close_data_transfer` helpers to `tests/conftest.py`**

Add right after `close_settings` (which ends at the `def assert_no_errors(page):` line — insert before that line):

```python
def open_data_transfer(page):
    """Open the Backup & Restore modal (#exportJsonBtn/#importJsonBtn live
    here now) and wait for it to be visible before interacting with any
    control inside it."""
    page.click('#dataTransferBtn')
    page.wait_for_selector('#dataTransferModal.flex-visible', timeout=5000)


def close_data_transfer(page):
    """Close the Backup & Restore modal via its × close button."""
    page.click('#dataTransferModalCloseBtn')
    page.wait_for_selector('#dataTransferModal', state='hidden', timeout=5000)
```

- [ ] **Step 3: Run the new test file to verify it fails**

Run: `pytest tests/ui/test_data_transfer_modal.py -v`
Expected: FAIL — `#dataTransferBtn` doesn't exist yet, `open_data_transfer` times out / `ImportError` for the new conftest helpers not yet used correctly (they exist as plain functions, so no import error — the failures will be assertion/timeout failures from missing markup).

- [ ] **Step 4: Replace the toolbar buttons in `index.html`**

Find (around line 24-34):

```html
                    <div class="header-toolbar-divider"></div>
                    <button id="exportJsonBtn" class="header-icon-btn" data-i18n-attr="title:toolbar.exportTitle,aria-label:toolbar.exportAriaLabel" title="Export backup (debts, income, strategy) as JSON" aria-label="Export JSON">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </button>
                    <button id="importJsonBtn" class="header-icon-btn" data-i18n-attr="title:toolbar.importTitle,aria-label:toolbar.importAriaLabel" title="Import from a previously exported JSON backup" aria-label="Import JSON">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    </button>
                    <input type="file" id="importJsonInput" accept=".json,application/json" hidden aria-hidden="true">
                    <div class="header-toolbar-divider"></div>
```

Replace with:

```html
                    <div class="header-toolbar-divider"></div>
                    <button id="dataTransferBtn" class="header-icon-btn" data-i18n-attr="title:toolbar.dataTransferTitle,aria-label:toolbar.dataTransferAriaLabel" title="Backup &amp; Restore" aria-label="Backup and restore data">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="17 11 21 7 17 3"/><line x1="21" y1="7" x2="9" y2="7"/>
                            <polyline points="7 21 3 17 7 13"/><line x1="3" y1="17" x2="15" y2="17"/>
                        </svg>
                    </button>
                    <div class="header-toolbar-divider"></div>
```

- [ ] **Step 5: Insert the modal markup in `index.html`**

Find the line `    <!-- First-run setup -->` (right after `#settingsModal`'s closing `</div>`). Insert this new block immediately before it:

```html
    <!-- Data Transfer (Export/Import) -->
    <div id="dataTransferModal" class="modal modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="dataTransferModalTitle" tabindex="-1">
        <div class="modal-content">
            <button id="dataTransferModalCloseBtn" data-i18n-attr="aria-label:settings.close" aria-label="Close" class="modal-close">&times;</button>
            <h3 id="dataTransferModalTitle" data-i18n="dataTransfer.title">Backup &amp; Restore</h3>
            <div class="dt-tabs" role="tablist">
                <button type="button" class="dt-tab-btn dt-tab-btn--active" data-dt-tab="export" role="tab" aria-selected="true" aria-controls="dataTransferPanel-export" data-i18n="dataTransfer.tabExport">Export</button>
                <button type="button" class="dt-tab-btn" data-dt-tab="import" role="tab" aria-selected="false" aria-controls="dataTransferPanel-import" data-i18n="dataTransfer.tabImport">Import</button>
            </div>
            <div id="dataTransferPanel-export" class="dt-tab-panel dt-tab-panel--active" role="tabpanel">
                <p class="modal-description" data-i18n="dataTransfer.exportDescription">Download a full backup (accounts, debts, income, bills, plan, and settings) as a JSON file.</p>
                <button id="exportJsonBtn" class="btn btn-primary" data-i18n="dataTransfer.exportButton">Export Backup</button>
            </div>
            <div id="dataTransferPanel-import" class="dt-tab-panel" role="tabpanel">
                <p class="modal-description" data-i18n="dataTransfer.importDescription">Restore from a previously exported JSON backup.</p>
                <button id="importJsonBtn" class="btn" data-i18n="dataTransfer.importButton">Choose File…</button>
                <input type="file" id="importJsonInput" accept=".json,application/json" hidden aria-hidden="true">
                <div id="importResultBanner" class="target-result hidden" role="status"></div>
                <div id="importModeChoice" class="dt-import-choice hidden">
                    <p id="importModeSummary"></p>
                    <button id="importModeReplaceBtn" class="btn btn-primary" data-i18n="dataTransfer.replaceButton">Replace</button>
                    <button id="importModeMergeBtn" class="btn" data-i18n="dataTransfer.mergeButton">Merge</button>
                </div>
            </div>
        </div>
    </div>
    <!-- First-run setup -->
```

- [ ] **Step 6: Add tab-switching CSS to `styles.css`**

Find `.rpt-tab-panel--active { display: block; }` and insert this block immediately after it:

```css

/* ── Data Transfer modal tabs — same pill pattern as .rpt-tab-btn ───────── */
.dt-tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 16px;
}
.dt-tab-btn {
    padding: 8px 14px;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
    cursor: pointer;
}
.dt-tab-btn:hover {
    background: var(--light-bg);
    color: var(--text-primary);
    border-color: var(--primary-color);
}
.dt-tab-btn:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 2px;
}
.dt-tab-btn--active {
    background: var(--primary-color);
    color: #fff;
    border-color: var(--primary-color);
}
body.dark-mode .dt-tab-btn--active {
    background: #60a5fa;
    border-color: #60a5fa;
    color: #0f172a;
}
body.dark-mode .dt-tab-btn:hover {
    background: #1e293b;
    color: #e2e8f0;
}
.dt-tab-panel { display: none; }
.dt-tab-panel--active { display: block; }
.dt-import-choice {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--border-color);
}
.dt-import-choice .btn {
    margin-right: 8px;
}
```

- [ ] **Step 7: Create `src/dataTransferModal.js` with open/close/tab-switching only**

```js
// Backup & Restore modal: consolidates the old separate Export/Import
// toolbar buttons into a two-tab modal, following the same show/hide-via-
// classList pattern as settingsModal (see setupWizard.js). This module
// owns all of #dataTransferModal's internal wiring, including the
// relocated #exportJsonBtn/#importJsonBtn/#importJsonInput.

export function initDataTransferModal(app) {
    const modal = document.getElementById('dataTransferModal');
    const openBtn = document.getElementById('dataTransferBtn');
    const closeBtn = document.getElementById('dataTransferModalCloseBtn');
    if (!modal || !openBtn || !closeBtn) return;

    let lastFocused = null;

    const close = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex-visible');
        modal.onkeydown = null;
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    };

    const open = () => {
        lastFocused = document.activeElement;
        modal.classList.add('flex-visible');
        modal.classList.remove('hidden');
        modal.onkeydown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
            }
        };
        const exportBtn = document.getElementById('exportJsonBtn');
        setTimeout(() => exportBtn && exportBtn.focus(), 30);
    };

    openBtn.onclick = open;
    closeBtn.onclick = close;
    modal.onclick = (event) => {
        if (event.target === modal) close();
    };

    document.querySelectorAll('.dt-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-dt-tab');
            document.querySelectorAll('.dt-tab-btn').forEach(b => {
                const active = b === btn;
                b.classList.toggle('dt-tab-btn--active', active);
                b.setAttribute('aria-selected', String(active));
            });
            document.querySelectorAll('.dt-tab-panel').forEach(panel => {
                panel.classList.toggle('dt-tab-panel--active', panel.id === `dataTransferPanel-${target}`);
            });
        });
    });
}
```

- [ ] **Step 8: Wire the new module into `app.js`**

Find (`app.js:115`):

```js
import { maybeShowSetupWizard as maybeShowSetupWizardFeature, initSettingsModal as initSettingsModalFeature } from './setupWizard.js';
```

Add right after it:

```js
import { initDataTransferModal } from './dataTransferModal.js';
```

Find (`app.js:179`):

```js
    initSettingsModalFeature(this);
```

Add right after it:

```js
    initDataTransferModal(this);
```

- [ ] **Step 9: Add `en.js` strings**

Find (`src/locales/en.js:8-11`):

```js
    'toolbar.exportTitle': 'Export backup (debts, income, strategy) as JSON',
    'toolbar.exportAriaLabel': 'Export JSON',
    'toolbar.importTitle': 'Import from a previously exported JSON backup',
    'toolbar.importAriaLabel': 'Import JSON',
```

Replace with:

```js
    'toolbar.dataTransferTitle': 'Backup & Restore',
    'toolbar.dataTransferAriaLabel': 'Backup and restore data',
```

Find (`src/locales/en.js`, the line `    'settings.done': 'Done',`) and add this new block right after it (before the blank line + `'health.title'`):

```js

    'dataTransfer.title': 'Backup & Restore',
    'dataTransfer.tabExport': 'Export',
    'dataTransfer.tabImport': 'Import',
    'dataTransfer.exportDescription': 'Download a full backup (accounts, debts, income, bills, plan, and settings) as a JSON file.',
    'dataTransfer.exportButton': 'Export Backup',
    'dataTransfer.importDescription': 'Restore from a previously exported JSON backup.',
    'dataTransfer.importButton': 'Choose File…',
    'dataTransfer.replaceButton': 'Replace',
    'dataTransfer.mergeButton': 'Merge',
```

- [ ] **Step 10: Run the new test file to verify it passes**

Run: `pytest tests/ui/test_data_transfer_modal.py -v`
Expected: PASS (all 5 tests)

- [ ] **Step 11: Commit**

```bash
git add index.html styles.css src/dataTransferModal.js src/app.js src/locales/en.js tests/ui/test_data_transfer_modal.py tests/conftest.py
git commit -m "Add consolidated Backup & Restore modal (markup, tabs, CSS)"
```

---

### Task 2: Move Export/Import button wiring out of `ui.js` into `dataTransferModal.js`

**Files:**
- Modify: `src/ui.js:145-164` (remove — this logic moves to `dataTransferModal.js`)
- Modify: `src/dataTransferModal.js` (add the button wiring)
- Test: `tests/ui/test_data_transfer_modal.py` (add export/import trigger tests)

**Interfaces:**
- Consumes: `app.exportAllJSON()` (existing method, unchanged), `app.importAllJSON(file)` (existing method, unchanged signature — its internal callbacks change in Task 4).
- Produces: clicking `#exportJsonBtn` calls `app.exportAllJSON()`; clicking `#importJsonBtn` opens the file picker via `#importJsonInput`; selecting a file calls `app.importAllJSON(file)`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui/test_data_transfer_modal.py`:

```python
@pytest.mark.ui
def test_export_button_triggers_download(app_page):
    """Positive: clicking Export Backup in the modal downloads a JSON file
    (same underlying app.exportAllJSON(), just relocated)."""
    page = app_page
    open_data_transfer(page)

    with page.expect_download() as download_info:
        page.click('#exportJsonBtn')
    download = download_info.value
    assert download.suggested_filename.startswith('debt-tracker-backup-')


@pytest.mark.ui
def test_import_button_opens_file_picker_and_triggers_import(app_page):
    """Positive: clicking Choose File then selecting a file calls
    app.importAllJSON (verified via a resulting localStorage write)."""
    import json
    import tempfile
    import os

    page = app_page
    open_data_transfer(page)
    page.click('[data-dt-tab="import"]')

    test_data = {"accounts": [{"id": 1, "name": "DT Modal Test", "type": "Checking", "startingBalance": 100}], "debts": []}
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(test_data, f)
        temp_file = f.name

    try:
        file_input = page.query_selector('#importJsonInput')
        assert file_input, "Expected #importJsonInput inside the Import panel"
        file_input.set_input_files(temp_file)
        page.wait_for_timeout(500)
        # A valid, unambiguous single-account file still triggers the
        # Replace/Merge choice (app.js always supplies requestImportMode) -
        # picking either completes the import; Replace is simplest to assert.
        page.click('#importModeReplaceBtn')
        page.wait_for_timeout(300)

        stored = page.evaluate('() => localStorage.getItem(window.app?.storageKey || "debtTrackerData")')
        assert stored and 'DT Modal Test' in stored
    finally:
        os.unlink(temp_file)
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/ui/test_data_transfer_modal.py -v -k "export_button_triggers_download or import_button_opens"`
Expected: FAIL — `#exportJsonBtn`/`#importJsonBtn` have no click handlers yet (nothing downloads; `#importModeReplaceBtn` never appears since nothing calls `app.importAllJSON`).

- [ ] **Step 3: Remove the old wiring from `ui.js`**

Find and delete (`src/ui.js:145-164`):

```js
    const exportJsonBtn = document.getElementById('exportJsonBtn');
    if (exportJsonBtn) {
        exportJsonBtn.addEventListener('click', () => app.exportAllJSON());
    }

    const importJsonBtn = document.getElementById('importJsonBtn');
    const importJsonInput = document.getElementById('importJsonInput');
    if (importJsonBtn && importJsonInput) {
        importJsonBtn.addEventListener('click', () => {
            importJsonInput.click();
        });

        importJsonInput.addEventListener('change', () => {
            const [file] = importJsonInput.files || [];
            if (file) {
                app.importAllJSON(file);
            }
            importJsonInput.value = '';
        });
    }

```

(Leave the surrounding `clearDataBtn`/`exportBtn` blocks untouched — only this export/import block moves.)

- [ ] **Step 4: Add the wiring to `dataTransferModal.js`**

In `initDataTransferModal(app)`, after the tab-switching `document.querySelectorAll('.dt-tab-btn')...` block, add:

```js

    const exportBtn = document.getElementById('exportJsonBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => app.exportAllJSON());
    }

    const importBtn = document.getElementById('importJsonBtn');
    const importInput = document.getElementById('importJsonInput');
    if (importBtn && importInput) {
        importBtn.addEventListener('click', () => {
            importInput.click();
        });

        importInput.addEventListener('change', () => {
            const [file] = importInput.files || [];
            if (file) {
                app.importAllJSON(file);
            }
            importInput.value = '';
        });
    }
```

- [ ] **Step 5: Run to verify pass**

Run: `pytest tests/ui/test_data_transfer_modal.py -v`
Expected: PASS (all 7 tests — note `test_import_button_opens_file_picker_and_triggers_import` needs `#importModeReplaceBtn` to actually appear and work, which still relies on the *existing* `confirm()`-based `requestImportMode` in `app.js` at this point since Task 4 hasn't run yet — **skip ahead**: this specific assertion (`page.click('#importModeReplaceBtn')`) will fail until Task 4 rewires `requestImportMode`. Mark this one test `@pytest.mark.skip(reason="inline Replace/Merge choice wired in Task 4")` for now and un-skip it in Task 4.)

- [ ] **Step 6: Commit**

```bash
git add src/ui.js src/dataTransferModal.js tests/ui/test_data_transfer_modal.py
git commit -m "Move Export/Import button wiring from ui.js into dataTransferModal.js"
```

---

### Task 3: Async `requestImportMode` in `dataExport.js`

**Files:**
- Modify: `src/dataExport.js:223-386` (`importAllJSON`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `importAllJSON(app, file, options)` — `options.requestImportMode` may now return either a plain boolean (old behavior, still supported) **or** a `Promise<boolean>` (new — awaited). `options.onImported(parts)` — new optional callback, fired exactly once per completed import: after a plain Replace, or after a Merge that skipped zero duplicates (a Merge that skips ≥1 duplicate fires `onMergeDuplicates` instead, not both, so the richer duplicate-count message isn't clobbered).

This task is a pure behavior-preserving refactor (existing `app.js` still uses synchronous `confirm()` at this point, via `requestImportMode: (parts) => confirm(...)`, which awaiting a non-Promise value handles transparently) — no existing test should change behavior, but two new focused tests confirm the new mechanics work before `app.js` starts relying on them in Task 4.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/dataExport.test.js`:

```js
/**
 * @jest-environment jsdom
 */
const { importAllJSON } = require('../../src/dataExport.js');

function makeFile(obj) {
    const json = JSON.stringify(obj);
    return new File([json], 'backup.json', { type: 'application/json' });
}

function makeApp() {
    return {
        debts: [],
        accounts: [],
        saveToStorage: jest.fn(),
        updateUI: jest.fn(),
    };
}

describe('importAllJSON requestImportMode', () => {
    test('accepts a Promise-returning requestImportMode (awaits it before applying)', async () => {
        const app = makeApp();
        const file = makeFile({ accounts: [{ id: 1, name: 'Test', type: 'Checking', startingBalance: 10 }], debts: [] });

        await new Promise((resolve) => {
            importAllJSON(app, file, {
                requestImportMode: () => Promise.resolve(true),
                onImported: () => resolve(),
            });
        });

        expect(app.accounts).toHaveLength(1);
        expect(app.accounts[0].name).toBe('Test');
    });

    test('onImported fires on a plain Replace with no requestImportMode override needed', async () => {
        const app = makeApp();
        const file = makeFile({ accounts: [{ id: 1, name: 'Solo', type: 'Checking', startingBalance: 5 }], debts: [] });
        const onImported = jest.fn();

        await new Promise((resolve) => {
            importAllJSON(app, file, {
                onImported: (parts) => { onImported(parts); resolve(); },
            });
        });

        expect(onImported).toHaveBeenCalledTimes(1);
        expect(onImported.mock.calls[0][0]).toEqual(expect.arrayContaining([expect.stringContaining('account')]));
    });

    test('onImported does NOT fire when onMergeDuplicates already reported (skipped > 0), avoiding a clobbered message', async () => {
        const app = makeApp();
        app.debts = [{ id: 99, name: 'Existing Card', accountBalance: 100 }];
        const file = makeFile({ debts: [{ name: 'Existing Card', accountBalance: 50 }] });
        const onImported = jest.fn();
        const onMergeDuplicates = jest.fn();

        await new Promise((resolve) => {
            importAllJSON(app, file, {
                requestImportMode: () => Promise.resolve(false), // Merge
                onMergeDuplicates: (added, skipped) => { onMergeDuplicates(added, skipped); resolve(); },
                onImported,
            });
        });

        expect(onMergeDuplicates).toHaveBeenCalledWith(0, 1);
        expect(onImported).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- dataExport.test.js`
Expected: FAIL — `onImported` isn't called (doesn't exist yet), third test's `onMergeDuplicates` assertion may hang/timeout since nothing currently resolves the promise via `onImported` not existing changes nothing about `onMergeDuplicates` itself (that already exists), so only tests 1 and 2 fail; test 3 should actually already pass since `onMergeDuplicates` already exists — run all three to confirm exactly which fail.

- [ ] **Step 3: Make `reader.onload` async and await `requestImportMode`**

Find (`src/dataExport.js`, inside `importAllJSON`):

```js
export function importAllJSON(app, file, options = {}) {
    const {
        onInvalidJSON,
        onNoData,
        requestImportMode,
        onMergeDuplicates,
        onReadError,
        onTooLarge
    } = options;
```

Replace with:

```js
export function importAllJSON(app, file, options = {}) {
    const {
        onInvalidJSON,
        onNoData,
        requestImportMode,
        onMergeDuplicates,
        onImported,
        onReadError,
        onTooLarge
    } = options;
```

Find:

```js
    const reader = new FileReader();
    reader.onload = (e) => {
```

Replace with:

```js
    const reader = new FileReader();
    reader.onload = async (e) => {
```

Find:

```js
        const shouldReplace = typeof requestImportMode === 'function'
            ? requestImportMode(parts)
            : true;
```

Replace with:

```js
        const shouldReplace = typeof requestImportMode === 'function'
            ? await requestImportMode(parts)
            : true;
```

- [ ] **Step 4: Track whether merge-duplicates feedback already fired, and call `onImported` once**

Find:

```js
            app.debts = [...app.debts, ...toAdd];
            if (skipped > 0 && typeof onMergeDuplicates === 'function') {
                onMergeDuplicates(toAdd.length, skipped);
            }
```

Replace with:

```js
            app.debts = [...app.debts, ...toAdd];
            if (skipped > 0 && typeof onMergeDuplicates === 'function') {
                onMergeDuplicates(toAdd.length, skipped);
                mergeDuplicatesReported = true;
            }
```

Find (just above the `if (validDebts.length === 0 ...)` early-return block, i.e. right after `const validDebts = incomingDebts.filter(d => d && d.name);`):

```js
        const validDebts = incomingDebts.filter(d => d && d.name);
```

Replace with:

```js
        const validDebts = incomingDebts.filter(d => d && d.name);
        let mergeDuplicatesReported = false;
```

Find:

```js
        app.saveToStorage();
        app.updateUI();
    };
```

Replace with:

```js
        app.saveToStorage();
        app.updateUI();
        if (!mergeDuplicatesReported && typeof onImported === 'function') {
            onImported(parts);
        }
    };
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test:unit -- dataExport.test.js`
Expected: PASS (all 3 tests)

- [ ] **Step 6: Run the full existing Jest suite to confirm no regression**

Run: `npm run test:unit`
Expected: PASS (all existing tests still pass — this task is purely additive/backward-compatible)

- [ ] **Step 7: Commit**

```bash
git add src/dataExport.js tests/unit/dataExport.test.js
git commit -m "Make importAllJSON's requestImportMode awaitable, add onImported callback"
```

---

### Task 4: Wire `app.js`'s `importAllJSON()` to the modal instead of `alert`/`confirm`

**Files:**
- Modify: `src/app.js:473-490` (`importAllJSON` method)
- Modify: `src/dataTransferModal.js` (add `showImportResult`, `requestImportModeChoice` exports)
- Modify: `tests/ui/test_data_transfer_modal.py` (un-skip the test from Task 2, add banner/choice tests)

**Interfaces:**
- Produces: `showImportResult(kind, message)` where `kind` is `'success' | 'warn' | 'error'` — sets `#importResultBanner`'s text and CSS class, unhides it. `requestImportModeChoice(parts)` — returns `Promise<boolean>`; shows `#importModeSummary`/`#importModeChoice`, resolves `true` on Replace click, `false` on Merge click.

- [ ] **Step 1: Un-skip and extend the Task 2 test, add banner/choice tests**

In `tests/ui/test_data_transfer_modal.py`, remove the `@pytest.mark.skip(...)` decorator added in Task 2 on `test_import_button_opens_file_picker_and_triggers_import`. Then append:

```python
@pytest.mark.ui
def test_invalid_json_file_shows_inline_error_banner(app_page):
    """Positive: selecting a non-JSON file shows an inline error banner
    instead of a native alert()."""
    import tempfile
    import os

    page = app_page
    open_data_transfer(page)
    page.click('[data-dt-tab="import"]')

    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        f.write('not valid json {{{')
        temp_file = f.name

    try:
        page.query_selector('#importJsonInput').set_input_files(temp_file)
        page.wait_for_timeout(300)

        banner = page.query_selector('#importResultBanner')
        assert banner.is_visible()
        assert 'Invalid JSON' in banner.inner_text()
        assert 'target-result--error' in banner.get_attribute('class')
    finally:
        os.unlink(temp_file)


@pytest.mark.ui
def test_empty_data_file_shows_inline_error_banner(app_page):
    """Positive: a syntactically valid JSON file with no recognisable data
    shows an inline error banner."""
    import json
    import tempfile
    import os

    page = app_page
    open_data_transfer(page)
    page.click('[data-dt-tab="import"]')

    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump({"foo": "bar"}, f)
        temp_file = f.name

    try:
        page.query_selector('#importJsonInput').set_input_files(temp_file)
        page.wait_for_timeout(300)

        banner = page.query_selector('#importResultBanner')
        assert banner.is_visible()
        assert 'No recognisable data' in banner.inner_text()
    finally:
        os.unlink(temp_file)


@pytest.mark.ui
def test_replace_vs_merge_choice_shown_inline_not_as_native_confirm(app_page):
    """Positive: importing over existing data shows the inline
    Replace/Merge choice (no native confirm() dialog — the page fixture
    would auto-accept any native dialog, which would mean OK/Replace; here
    we explicitly click Merge and verify merge semantics took effect)."""
    import json
    import tempfile
    import os

    page = app_page
    page.click('button[data-page="accounts"]')
    page.fill('#accountName', 'Pre-existing Account')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '1000')
    page.click('#accountFormSubmit')
    page.wait_for_selector('text=Pre-existing Account', timeout=10000)

    open_data_transfer(page)
    page.click('[data-dt-tab="import"]')

    new_data = {"accounts": [{"id": 2, "name": "Imported Account", "type": "Savings", "startingBalance": 500}], "debts": []}
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(new_data, f)
        temp_file = f.name

    try:
        page.query_selector('#importJsonInput').set_input_files(temp_file)
        page.wait_for_timeout(300)

        assert page.is_visible('#importModeChoice')
        summary = page.inner_text('#importModeSummary')
        assert 'account' in summary.lower()

        page.click('#importModeMergeBtn')
        page.wait_for_timeout(300)

        assert page.is_visible('#importModeChoice') is False
        banner = page.query_selector('#importResultBanner')
        assert banner.is_visible()
    finally:
        os.unlink(temp_file)


@pytest.mark.ui
def test_merge_with_skipped_duplicates_shows_duplicate_count_not_generic_message(app_page):
    """Regression guard for the onImported/onMergeDuplicates ordering fix in
    dataExport.js: when duplicates are skipped during a Merge, the banner
    must show the duplicate-count message, not get overwritten by the
    generic "Imported: ..." message."""
    import json
    import tempfile
    import os

    page = app_page
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.click('#debtFormToggle')
    page.fill('#debtName', 'Dup Card')
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', '100')
    page.fill('#interestRate', '10')
    page.fill('#minimumPayment', '25')
    page.fill('#dueDate', '5')
    page.click('#debtFormSubmit')
    page.wait_for_selector('text=Dup Card', timeout=10000)

    open_data_transfer(page)
    page.click('[data-dt-tab="import"]')

    dup_data = {"debts": [{"name": "Dup Card", "accountBalance": 200, "interestRate": 15, "minimumPayment": 30}]}
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(dup_data, f)
        temp_file = f.name

    try:
        page.query_selector('#importJsonInput').set_input_files(temp_file)
        page.wait_for_timeout(300)
        page.click('#importModeMergeBtn')
        page.wait_for_timeout(300)

        banner_text = page.inner_text('#importResultBanner')
        assert 'Skipped 1 duplicate' in banner_text
    finally:
        os.unlink(temp_file)
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/ui/test_data_transfer_modal.py -v`
Expected: FAIL on the un-skipped test and all 4 new tests — `app.js` still uses native `alert`/`confirm`, so `#importResultBanner`/`#importModeChoice` never populate.

- [ ] **Step 3: Add `showImportResult` and `requestImportModeChoice` to `dataTransferModal.js`**

Append to `src/dataTransferModal.js`:

```js

export function showImportResult(kind, message) {
    const banner = document.getElementById('importResultBanner');
    if (!banner) return;
    banner.textContent = message;
    const modifier = kind === 'success' ? '' : ` target-result--${kind}`;
    banner.className = `target-result${modifier}`;
}

export function requestImportModeChoice(parts) {
    return new Promise((resolve) => {
        const choice = document.getElementById('importModeChoice');
        const summary = document.getElementById('importModeSummary');
        const replaceBtn = document.getElementById('importModeReplaceBtn');
        const mergeBtn = document.getElementById('importModeMergeBtn');
        if (!choice || !summary || !replaceBtn || !mergeBtn) {
            resolve(true);
            return;
        }
        summary.textContent = `Found: ${parts.join(', ')}. Replace your current data entirely, or merge debts only (income & strategy will still be restored; duplicate debt names are skipped)?`;
        choice.classList.remove('hidden');

        const cleanup = () => {
            choice.classList.add('hidden');
            replaceBtn.onclick = null;
            mergeBtn.onclick = null;
        };
        replaceBtn.onclick = () => { cleanup(); resolve(true); };
        mergeBtn.onclick = () => { cleanup(); resolve(false); };
    });
}
```

Also reset the banner/choice UI whenever the modal closes, so reopening it starts clean. In the `close` function inside `initDataTransferModal`, find:

```js
    const close = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex-visible');
        modal.onkeydown = null;
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    };
```

Replace with:

```js
    const close = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex-visible');
        modal.onkeydown = null;
        const banner = document.getElementById('importResultBanner');
        if (banner) { banner.textContent = ''; banner.className = 'target-result hidden'; }
        const choice = document.getElementById('importModeChoice');
        if (choice) choice.classList.add('hidden');
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    };
```

- [ ] **Step 4: Rewire `app.js`'s `importAllJSON()` method**

Find (`app.js:115`, from Task 1's Step 8 — now import both functions):

```js
import { initDataTransferModal } from './dataTransferModal.js';
```

Replace with:

```js
import { initDataTransferModal, showImportResult, requestImportModeChoice } from './dataTransferModal.js';
```

Find (`app.js:473-490`):

```js
    importAllJSON(file) {
        return importAllJSONFeature(this, file, {
            onInvalidJSON: () => alert('Invalid JSON file. Please select a valid backup file.'),
            onNoData: () => alert('No recognisable data found in the selected file.'),
            requestImportMode: (parts) => confirm(
                `Found: ${parts.join(', ')}.\n\n` +
                `• OK     — Replace your current data entirely\n` +
                `• Cancel — Merge debts only (income & strategy will still be restored; duplicate debt names are skipped)\n`
            ),
            onMergeDuplicates: (addedCount, skippedCount) => {
                alert(`Merged ${addedCount} debt(s). Skipped ${skippedCount} duplicate name(s).`);
            },
            onTooLarge: (maxBytes) => {
                alert(`Import file is too large. Maximum supported size is ${Math.round(maxBytes / 1024)} KB.`);
            },
            onReadError: () => alert('Could not read the file. Please try again.')
        });
    }
```

Replace with:

```js
    importAllJSON(file) {
        return importAllJSONFeature(this, file, {
            onInvalidJSON: () => showImportResult('error', 'Invalid JSON file. Please select a valid backup file.'),
            onNoData: () => showImportResult('error', 'No recognisable data found in the selected file.'),
            requestImportMode: (parts) => requestImportModeChoice(parts),
            onImported: (parts) => showImportResult('success', `Imported: ${parts.join(', ')}.`),
            onMergeDuplicates: (addedCount, skippedCount) => {
                showImportResult('success', `Merged ${addedCount} debt(s). Skipped ${skippedCount} duplicate name(s).`);
            },
            onTooLarge: (maxBytes) => {
                showImportResult('error', `Import file is too large. Maximum supported size is ${Math.round(maxBytes / 1024)} KB.`);
            },
            onReadError: () => showImportResult('error', 'Could not read the file. Please try again.')
        });
    }
```

- [ ] **Step 5: Run to verify pass**

Run: `pytest tests/ui/test_data_transfer_modal.py -v`
Expected: PASS (all tests, including the newly un-skipped and added ones)

- [ ] **Step 6: Commit**

```bash
git add src/app.js src/dataTransferModal.js tests/ui/test_data_transfer_modal.py
git commit -m "Replace Import's alert()/confirm() feedback with inline modal UI"
```

---

### Task 5: Update `commandPalette.js`'s Import action

**Files:**
- Modify: `src/commandPalette.js:30-35`
- Test: `tests/ui/test_command_palette.py` (add one test)

**Interfaces:**
- Consumes: `#dataTransferBtn` (Task 1), `[data-dt-tab="import"]` (Task 1).

- [ ] **Step 1: Write the failing test**

Add to `tests/ui/test_command_palette.py`:

```python
@pytest.mark.ui
def test_import_command_opens_data_transfer_modal_on_import_tab(app_page):
    """The 'Import backup from JSON' palette action opens the consolidated
    modal directly on the Import tab, not the old standalone toolbar
    button (which no longer exists)."""
    page = app_page
    page.keyboard.press('Control+k')
    page.wait_for_timeout(200)
    page.fill('#commandPaletteInput', 'Import backup')
    page.wait_for_timeout(150)
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)

    assert page.is_visible('#dataTransferModal')
    assert page.is_visible('#importJsonBtn')
    import_selected = page.get_attribute('[data-dt-tab="import"]', 'aria-selected')
    assert import_selected == 'true'
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/ui/test_command_palette.py::test_import_command_opens_data_transfer_modal_on_import_tab -v`
Expected: FAIL — the command still tries `document.getElementById('importJsonBtn')?.click()`, which is now inside a hidden modal (clicking a hidden button's handler still runs, but the modal itself never opens, so `#dataTransferModal`/`#importJsonBtn` stay non-visible).

- [ ] **Step 3: Update the command**

Find (`src/commandPalette.js:30-35`):

```js
        {
            label: 'Import backup from JSON',
            hint: 'Action',
            icon: '⬆️',
            run: () => document.getElementById('importJsonBtn')?.click()
        },
```

Replace with:

```js
        {
            label: 'Import backup from JSON',
            hint: 'Action',
            icon: '⬆️',
            run: () => {
                document.getElementById('dataTransferBtn')?.click();
                document.querySelector('[data-dt-tab="import"]')?.click();
            }
        },
```

- [ ] **Step 4: Run to verify it passes**

Run: `pytest tests/ui/test_command_palette.py -v`
Expected: PASS (all tests in the file, including the new one)

- [ ] **Step 5: Commit**

```bash
git add src/commandPalette.js tests/ui/test_command_palette.py
git commit -m "Update command palette's Import action for the consolidated modal"
```

---

### Task 6: Spanish/Polish translations for the new strings

**Files:**
- Modify: `src/locales/es.js:9-13`
- Modify: `src/locales/pl.js:9-13`

**Interfaces:** none (pure content addition, no new keys beyond what Task 1 defined in `en.js`).

- [ ] **Step 1: Update `es.js`**

Find (`src/locales/es.js:9-13`):

```js
    'toolbar.exportTitle': 'Exportar copia de seguridad (deudas, ingresos, estrategia) como JSON',
    'toolbar.exportAriaLabel': 'Exportar JSON',
    'toolbar.importTitle': 'Importar desde una copia de seguridad JSON exportada previamente',
    'toolbar.importAriaLabel': 'Importar JSON',
```

Replace with:

```js
    'toolbar.dataTransferTitle': 'Copia de Seguridad y Restauración',
    'toolbar.dataTransferAriaLabel': 'Hacer copia de seguridad y restaurar datos',
```

Find (`src/locales/es.js`, the line `    'settings.done': 'Listo',`) and add right after it:

```js

    'dataTransfer.title': 'Copia de Seguridad y Restauración',
    'dataTransfer.tabExport': 'Exportar',
    'dataTransfer.tabImport': 'Importar',
    'dataTransfer.exportDescription': 'Descarga una copia de seguridad completa (cuentas, deudas, ingresos, facturas, plan y configuración) como archivo JSON.',
    'dataTransfer.exportButton': 'Exportar Copia de Seguridad',
    'dataTransfer.importDescription': 'Restaura desde una copia de seguridad JSON exportada previamente.',
    'dataTransfer.importButton': 'Elegir Archivo…',
    'dataTransfer.replaceButton': 'Reemplazar',
    'dataTransfer.mergeButton': 'Combinar',
```

- [ ] **Step 2: Update `pl.js`**

Find (`src/locales/pl.js:9-13`):

```js
    'toolbar.exportTitle': 'Eksportuj kopię zapasową (długi, dochody, strategia) jako JSON',
    'toolbar.exportAriaLabel': 'Eksportuj JSON',
    'toolbar.importTitle': 'Importuj z wcześniej wyeksportowanej kopii zapasowej JSON',
    'toolbar.importAriaLabel': 'Importuj JSON',
```

Replace with:

```js
    'toolbar.dataTransferTitle': 'Kopia Zapasowa i Przywracanie',
    'toolbar.dataTransferAriaLabel': 'Utwórz kopię zapasową i przywróć dane',
```

Find (`src/locales/pl.js`, the line `    'settings.done': 'Gotowe',`) and add right after it:

```js

    'dataTransfer.title': 'Kopia Zapasowa i Przywracanie',
    'dataTransfer.tabExport': 'Eksportuj',
    'dataTransfer.tabImport': 'Importuj',
    'dataTransfer.exportDescription': 'Pobierz pełną kopię zapasową (konta, długi, dochody, rachunki, plan i ustawienia) jako plik JSON.',
    'dataTransfer.exportButton': 'Eksportuj Kopię Zapasową',
    'dataTransfer.importDescription': 'Przywróć z wcześniej wyeksportowanej kopii zapasowej JSON.',
    'dataTransfer.importButton': 'Wybierz Plik…',
    'dataTransfer.replaceButton': 'Zastąp',
    'dataTransfer.mergeButton': 'Scal',
```

- [ ] **Step 3: Verify with the existing i18n test suite**

Run: `pytest tests/features/test_i18n.py -v`
Expected: PASS (no existing test asserts on `toolbar.export*`/`toolbar.import*` text directly, so nothing should break; this confirms locale switching still works generally)

- [ ] **Step 4: Commit**

```bash
git add src/locales/es.js src/locales/pl.js
git commit -m "Translate Backup & Restore modal strings into Spanish and Polish"
```

---

### Task 7: Fix `tests/integration/test_workflows.py`

**Files:**
- Modify: `tests/integration/test_workflows.py` (six test functions)

- [ ] **Step 1: Update `test_export_data_format`**

Find (line 25):

```python
    export_btn = page.query_selector('#exportJsonBtn')
```

Replace with:

```python
    from tests.conftest import open_data_transfer
    open_data_transfer(page)
    export_btn = page.query_selector('#exportJsonBtn')
```

- [ ] **Step 2: Update `test_import_json_file`**

Find (lines 132, 159):

```python
    import_btn = page.query_selector('#importJsonBtn')
    
    if import_btn:
```

Replace with:

```python
    from tests.conftest import open_data_transfer
    open_data_transfer(page)
    page.click('[data-dt-tab="import"]')
    import_btn = page.query_selector('#importJsonBtn')

    if import_btn:
```

Find (line 159, now shifted — the `page.click('#importJsonBtn')` inside the `try:` block):

```python
            # Click import
            page.click('#importJsonBtn')
            page.wait_for_timeout(300)
            
            # Upload file
            file_input = page.query_selector('#importJsonInput')
            if file_input:
                file_input.set_input_files(temp_file)
                page.wait_for_timeout(1000)
                
                # Verify data was imported
                stored_data = page.evaluate('() => localStorage.getItem(window.app?.storageKey || "debtTrackerData")')
                assert stored_data, "Data should be imported"
```

Replace with:

```python
            # Click import
            page.click('#importJsonBtn')
            page.wait_for_timeout(300)
            
            # Upload file
            file_input = page.query_selector('#importJsonInput')
            if file_input:
                file_input.set_input_files(temp_file)
                page.wait_for_timeout(500)
                if page.is_visible('#importModeChoice'):
                    page.click('#importModeReplaceBtn')
                page.wait_for_timeout(500)
                
                # Verify data was imported
                stored_data = page.evaluate('() => localStorage.getItem(window.app?.storageKey || "debtTrackerData")')
                assert stored_data, "Data should be imported"
```

- [ ] **Step 3: Update `test_import_replaces_data`**

Find (line 190):

```python
    # Import new data
    import_btn = page.query_selector('#importJsonBtn')
    if import_btn:
```

Replace with:

```python
    # Import new data
    from tests.conftest import open_data_transfer
    open_data_transfer(page)
    page.click('[data-dt-tab="import"]')
    import_btn = page.query_selector('#importJsonBtn')
    if import_btn:
```

Find (lines 213-223, the upload block inside `try:`):

```python
            page.click('#importJsonBtn')
            page.wait_for_timeout(300)
            
            file_input = page.query_selector('#importJsonInput')
            if file_input:
                file_input.set_input_files(temp_file)
                page.wait_for_timeout(1000)
                
                # Data should be replaced
                stored = page.evaluate('() => localStorage.getItem(window.app?.storageKey || "debtTrackerData")')
                assert stored, "Import should update data"
```

Replace with:

```python
            page.click('#importJsonBtn')
            page.wait_for_timeout(300)
            
            file_input = page.query_selector('#importJsonInput')
            if file_input:
                file_input.set_input_files(temp_file)
                page.wait_for_timeout(500)
                if page.is_visible('#importModeChoice'):
                    page.click('#importModeReplaceBtn')
                page.wait_for_timeout(500)
                
                # Data should be replaced
                stored = page.evaluate('() => localStorage.getItem(window.app?.storageKey || "debtTrackerData")')
                assert stored, "Import should update data"
```

- [ ] **Step 4: Update `test_roundtrip_export_import`**

Find (lines 247-248):

```python
        export_btn = page.query_selector('#exportJsonBtn')
        import_btn = page.query_selector('#importJsonBtn')
        
        if export_btn and import_btn:
```

Replace with:

```python
        from tests.conftest import open_data_transfer
        open_data_transfer(page)
        export_btn = page.query_selector('#exportJsonBtn')
        import_btn = page.query_selector('#importJsonBtn')

        if export_btn and import_btn:
```

Find (lines 262-272, the upload block inside the nested `try:`):

```python
            try:
                page.click('#importJsonBtn')
                page.wait_for_timeout(300)

                file_input = page.query_selector('#importJsonInput')
                if file_input:
                    file_input.set_input_files(temp_file)
                    page.wait_for_timeout(1000)

                    # Data should match
                    reimported = page.evaluate('() => localStorage.getItem(window.app?.storageKey || "debtTrackerData")')
                    assert reimported, "Roundtrip data preservation failed"
```

Replace with:

```python
            try:
                page.click('[data-dt-tab="import"]')
                page.click('#importJsonBtn')
                page.wait_for_timeout(300)

                file_input = page.query_selector('#importJsonInput')
                if file_input:
                    file_input.set_input_files(temp_file)
                    page.wait_for_timeout(500)
                    if page.is_visible('#importModeChoice'):
                        page.click('#importModeReplaceBtn')
                    page.wait_for_timeout(500)

                    # Data should match
                    reimported = page.evaluate('() => localStorage.getItem(window.app?.storageKey || "debtTrackerData")')
                    assert reimported, "Roundtrip data preservation failed"
```

- [ ] **Step 5: Update `test_clear_all_data_then_reimport_renders_every_page_cleanly`**

Find (lines 322-327):

```python
    # --- Export the seeded data ---
    export_btn = page.query_selector('#exportJsonBtn')
    assert export_btn, "Export button (#exportJsonBtn) should exist"
    with page.expect_download() as download_info:
        export_btn.click()
    download = download_info.value
```

Replace with:

```python
    # --- Export the seeded data ---
    from tests.conftest import open_data_transfer
    open_data_transfer(page)
    export_btn = page.query_selector('#exportJsonBtn')
    assert export_btn, "Export button (#exportJsonBtn) should exist"
    with page.expect_download() as download_info:
        export_btn.click()
    download = download_info.value
```

Find (lines 354-360):

```python
    try:
        page.click('#importJsonBtn')
        page.wait_for_timeout(300)
        file_input = page.query_selector('#importJsonInput')
        assert file_input, "Expected the import file input (#importJsonInput) to exist"
        file_input.set_input_files(temp_file)
        page.wait_for_timeout(1000)
```

Replace with:

```python
    try:
        open_data_transfer(page)
        page.click('[data-dt-tab="import"]')
        page.click('#importJsonBtn')
        page.wait_for_timeout(300)
        file_input = page.query_selector('#importJsonInput')
        assert file_input, "Expected the import file input (#importJsonInput) to exist"
        file_input.set_input_files(temp_file)
        page.wait_for_timeout(500)
        if page.is_visible('#importModeChoice'):
            page.click('#importModeReplaceBtn')
        page.wait_for_timeout(500)
```

`open_data_transfer(page)`'s click on `#dataTransferBtn` is safe to call again here even though the modal may still be open from the earlier export step: `initDataTransferModal`'s `open()` handler just re-adds `flex-visible`/re-removes `hidden` and resets focus tracking, which is a harmless no-op repeat if the modal is already showing.

- [ ] **Step 6: Run the full file**

Run: `pytest tests/integration/test_workflows.py -v`
Expected: PASS (all tests)

- [ ] **Step 7: Commit**

```bash
git add tests/integration/test_workflows.py
git commit -m "Fix test_workflows.py for the consolidated Backup & Restore modal"
```

---

### Task 8: Fix `tests/integration/test_smoke.py` and `tests/security/test_xss.py`

**Files:**
- Modify: `tests/integration/test_smoke.py:156-179` (`test_smoke_export_import`)
- Modify: `tests/security/test_xss.py:~130-140` (the import-XSS test)

- [ ] **Step 1: Update `test_smoke.py`**

Find (`tests/integration/test_smoke.py`, inside `test_smoke_export_import`):

```python
    # Look for export button
    export_btn = page.query_selector('#exportJsonBtn')
    if export_btn:
        # Export functionality exists
        assert export_btn.evaluate('(el) => el.offsetHeight > 0'), "Export button should be visible"
    
    # Look for import button
    import_btn = page.query_selector('#importJsonBtn')
    if import_btn:
        assert import_btn.evaluate('(el) => el.offsetHeight > 0'), "Import button should be visible"
```

Replace with:

```python
    from tests.conftest import open_data_transfer
    open_data_transfer(page)

    # Look for export button (Export tab is the default active tab)
    export_btn = page.query_selector('#exportJsonBtn')
    if export_btn:
        assert export_btn.evaluate('(el) => el.offsetHeight > 0'), "Export button should be visible"

    # Look for import button (switch to the Import tab first)
    page.click('[data-dt-tab="import"]')
    import_btn = page.query_selector('#importJsonBtn')
    if import_btn:
        assert import_btn.evaluate('(el) => el.offsetHeight > 0'), "Import button should be visible"
```

- [ ] **Step 2: Update `test_xss.py`**

Find (`tests/security/test_xss.py`):

```python
    try:
        # Upload file
        await page.click('#importJsonBtn')
        await page.wait_for_timeout(300)
        
        file_input = await page.query_selector('#importJsonInput')
        if file_input:
            await file_input.set_input_files(temp_file)
            await page.wait_for_timeout(1000)
            
            # Verify data was imported but rendered safely
            debts_count = await page.evaluate('() => document.querySelectorAll(".debt-card").length')
            assert debts_count > 0, "Debt was not imported"
```

Replace with:

```python
    try:
        # Open the Backup & Restore modal, switch to Import, upload file
        await page.click('#dataTransferBtn')
        await page.wait_for_selector('#dataTransferModal.flex-visible', timeout=5000)
        await page.click('[data-dt-tab="import"]')
        await page.click('#importJsonBtn')
        await page.wait_for_timeout(300)
        
        file_input = await page.query_selector('#importJsonInput')
        if file_input:
            await file_input.set_input_files(temp_file)
            await page.wait_for_timeout(500)
            if await page.is_visible('#importModeChoice'):
                await page.click('#importModeReplaceBtn')
            await page.wait_for_timeout(500)
            
            # Verify data was imported but rendered safely
            debts_count = await page.evaluate('() => document.querySelectorAll(".debt-card").length')
            assert debts_count > 0, "Debt was not imported"
```

- [ ] **Step 3: Run both files**

Run: `pytest tests/integration/test_smoke.py tests/security/test_xss.py -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/integration/test_smoke.py tests/security/test_xss.py
git commit -m "Fix test_smoke.py and test_xss.py for the consolidated Backup & Restore modal"
```

---

### Task 9: Fix `tests/ui/test_high_contrast_theme.py`'s focus-ring test

**Files:**
- Modify: `tests/ui/test_high_contrast_theme.py` (`test_high_contrast_focus_visible_outline_is_bold`)

`#exportJsonBtn` is used there purely as *a* generic focusable toolbar button to check the shared HC focus-ring CSS — it's no longer directly in the toolbar, so swap to `#dataTransferBtn`, which is.

- [ ] **Step 1: Update the test**

Find:

```python
    page.focus('#exportJsonBtn')
    outline = page.evaluate("""
        () => {
            const s = getComputedStyle(document.getElementById('exportJsonBtn'));
            return { style: s.outlineStyle, width: s.outlineWidth };
        }
    """)
```

Replace with:

```python
    page.focus('#dataTransferBtn')
    outline = page.evaluate("""
        () => {
            const s = getComputedStyle(document.getElementById('dataTransferBtn'));
            return { style: s.outlineStyle, width: s.outlineWidth };
        }
    """)
```

- [ ] **Step 2: Run to verify it passes**

Run: `pytest tests/ui/test_high_contrast_theme.py -v`
Expected: PASS (all tests)

- [ ] **Step 3: Commit**

```bash
git add tests/ui/test_high_contrast_theme.py
git commit -m "Point the HC focus-ring regression test at #dataTransferBtn"
```

---

### Task 10: Version bump and changelog

**Files:**
- Modify: `src/utils.js` (`APP_VERSION`)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump the version**

Find (`src/utils.js`):

```js
export const APP_VERSION = '4.11.0';
```

Replace with:

```js
export const APP_VERSION = '4.12.0';
```

- [ ] **Step 2: Add the changelog entry**

Find (`CHANGELOG.md`, right after the `---` separator before the top-most entry):

```markdown
---

## [4.11.0] — 2026-08-04
```

Replace with:

```markdown
---

## [4.12.0] — 2026-08-05

### Changed
- **Consolidated Export/Import into a Backup & Restore modal** — the toolbar's separate ⬇️ Export / ⬆️ Import icon buttons are now one `#dataTransferBtn` button that opens a two-tab modal (Export / Import). `#exportJsonBtn`/`#importJsonBtn`/`#importJsonInput` kept their ids and behavior, just relocated. Import's feedback (invalid file, no recognisable data, file too large, read error, and the Replace-vs-Merge choice) moved from native `alert()`/`confirm()` popups into inline modal UI, styled with the existing `.target-result` success/warning/error banner pattern.

---

## [4.11.0] — 2026-08-04
```

- [ ] **Step 3: Verify with the versioning test suite**

Run: `pytest tests/features/test_versioning.py -v`
Expected: PASS (all tests)

- [ ] **Step 4: Commit**

```bash
git add src/utils.js CHANGELOG.md
git commit -m "Bump version to 4.12.0 for the Backup & Restore modal"
```

---

### Task 11: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Start the local server**

Run: `python -m http.server 5500` (in the background, if not already running)

- [ ] **Step 2: Run the full Python test suite**

Run: `pytest tests/ -v`
Expected: PASS (all tests — this is the final confirmation that nothing else in the app referenced the old `#exportJsonBtn`/`#importJsonBtn` toolbar placement or relied on `alert()`/`confirm()` timing for import)

- [ ] **Step 3: Run the full Jest suite**

Run: `npm run test:unit`
Expected: PASS (all tests, including the new `dataExport.test.js` from Task 3)

- [ ] **Step 4: Manually verify in a real browser**

With the server running, open `http://localhost:5500/`, click the new toolbar button, confirm both tabs render and switch correctly, export a backup, then import it back and walk through both the Replace and Merge paths at least once each, in both light and dark mode (the CSS is copied from `.rpt-tab-btn`, which already has dark-mode coverage, but confirm visually since this is a new UI surface).
