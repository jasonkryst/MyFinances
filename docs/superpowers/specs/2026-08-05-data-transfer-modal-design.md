# Consolidated Data Transfer Modal — Design

**Date:** 2026-08-05

## Summary

Replace the toolbar's two separate icon buttons (⬇️ Export, ⬆️ Import) with a
single button that opens a two-tab modal (`#dataTransferModal`): an **Export**
tab and an **Import** tab. Import's current feedback — invalid file, no
recognisable data, file too large, read error, and the Replace-vs-Merge
choice — currently all go through native `alert()`/`confirm()` popups. Those
move into the Import tab as inline UI instead.

## Decisions

| Question | Decision |
|---|---|
| Import feedback | Move into the modal (inline result banner + inline Replace/Merge choice), not native popups. |
| Default tab | Export — lower-risk, more frequently used action. |
| Button glyph | A single up/down swap-style icon, title "Backup & Restore", replacing both toolbar icon buttons. |
| Replace vs Merge choices | Same two options as today (no new "cancel/abort" — the existing `confirm()`'s Cancel already meant Merge, not abort). |
| Existing control ids | `#exportJsonBtn`, `#importJsonBtn`, `#importJsonInput` are **kept** (just relocated inside the modal's panels) to minimize test churn — most existing tests only need "open the modal first," not "find a new selector." |

## Markup (`index.html`)

Toolbar: remove `#exportJsonBtn`/`#importJsonBtn`/`#importJsonInput` from
`.header-toolbar`; add one button. The existing export/import toolbar
buttons use inline SVG arrow icons (not emoji, unlike ⚙️/❓) — the
consolidated button follows that same convention with a combined
up+down-arrow glyph rather than switching to an emoji:

```html
<button id="dataTransferBtn" class="header-icon-btn" title="Backup & Restore" aria-label="Backup and restore data">
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="17 11 21 7 17 3"/><line x1="21" y1="7" x2="9" y2="7"/>
        <polyline points="7 21 3 17 7 13"/><line x1="3" y1="17" x2="15" y2="17"/>
    </svg>
</button>
```

New modal, following the existing `role="dialog"` + `role="tab"`/`aria-selected`/`aria-controls`
pattern already used on the Reports page (`.rpt-tab-btn`/`.rptPanel-*`):

```html
<div id="dataTransferModal" class="modal modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="dataTransferModalTitle" tabindex="-1">
  <div class="modal-content">
    <button id="dataTransferModalCloseBtn" aria-label="Close" class="modal-close">&times;</button>
    <h3 id="dataTransferModalTitle">Backup &amp; Restore</h3>
    <div class="dt-tabs">
      <button class="dt-tab-btn dt-tab-btn--active" data-dt-tab="export" role="tab" aria-selected="true"  aria-controls="dataTransferExportPanel">Export</button>
      <button class="dt-tab-btn"                    data-dt-tab="import" role="tab" aria-selected="false" aria-controls="dataTransferImportPanel">Import</button>
    </div>
    <div id="dataTransferExportPanel" class="dt-panel" role="tabpanel">
      <p class="modal-description">Download a full backup (accounts, debts, income, bills, plan, and settings) as a JSON file.</p>
      <button id="exportJsonBtn" class="btn btn-primary">Export Backup</button>
    </div>
    <div id="dataTransferImportPanel" class="dt-panel dt-panel--hidden" role="tabpanel">
      <p class="modal-description">Restore from a previously exported JSON backup.</p>
      <button id="importJsonBtn" class="btn">Choose File…</button>
      <input type="file" id="importJsonInput" accept=".json,application/json" hidden aria-hidden="true">
      <div id="importResultBanner" class="target-result hidden" role="status"></div>
      <div id="importModeChoice" class="dt-import-choice hidden">
        <p id="importModeSummary"></p>
        <button id="importModeReplaceBtn" class="btn btn-primary">Replace</button>
        <button id="importModeMergeBtn" class="btn">Merge</button>
      </div>
    </div>
  </div>
</div>
```

Tab switching shows/hides `.dt-panel` elements and toggles
`aria-selected`/`.dt-tab-btn--active`, mirroring `switchPage`'s show/hide
pattern in `ui.js`.

## New module: `src/dataTransferModal.js`

Mirrors `setupWizard.js`'s `initSettingsModal(app)` shape — a single
`initDataTransferModal(app)` wires open/close/tab-switching, plus exports two
functions used by `app.js`'s `importAllJSON()`:

- `showImportResult(kind, message)` — kind is `'success' | 'warn' | 'error'`;
  sets `#importResultBanner`'s text and `.target-result--{kind}` class,
  unhides it. (Reuses the existing `.target-result`/`--warn`/`--error`
  banner styling from `strategy.js`'s target-payoff-date panel — no new color
  system.)
- `requestImportModeChoice(parts)` — shows `#importModeSummary` (the same
  "Found: X account(s), Y debt(s)…" text currently interpolated into the
  `confirm()` message) and `#importModeChoice`, wires the Replace/Merge
  buttons for one click each, and returns a `Promise<boolean>` that resolves
  `true`/`false` accordingly (mirrors the existing `confirm()` return value:
  true = Replace, false = Merge).

Called from `app.js` next to the existing `initSettingsModal(app)` call.

## `dataExport.js` change: `importAllJSON`'s async decision point

`requestImportMode` currently returns a boolean synchronously (from
`confirm()`). A modal choice is inherently async, so:

- `reader.onload` becomes `async (e) => { ... }`.
- `const shouldReplace = typeof requestImportMode === 'function' ? requestImportMode(parts) : true;`
  becomes
  `const shouldReplace = typeof requestImportMode === 'function' ? await requestImportMode(parts) : true;`

No other control flow changes — everything after that line already runs
synchronously in order.

**New optional callback: `onImported(parts)`.** Today, a plain Replace (or
a Merge with zero skipped duplicates) calls `app.saveToStorage()` /
`app.updateUI()` with **no** completion feedback at all — the blocking
`confirm()` dialog closing was the only "did it work" signal. That silence
would read as broken in a modal. Add `onImported(parts)` — reusing the same
`parts` array already built for the Replace/Merge summary text (`Found: X
account(s), Y debt(s)...`) — fired right after `app.saveToStorage();
app.updateUI();` in both the replace and merge branches (in addition to the
existing `onMergeDuplicates`, which still fires separately when
`skipped > 0` for the extra duplicate-skip detail). `app.js` wires it to
`showImportResult('success', ...)`.

## `app.js`: `importAllJSON()` method

Swap every `alert`/`confirm` callback for the new module's functions:

```js
importAllJSON(file) {
    return importAllJSONFeature(this, file, {
        onInvalidJSON: () => showImportResult('error', 'Invalid JSON file. Please select a valid backup file.'),
        onNoData: () => showImportResult('error', 'No recognisable data found in the selected file.'),
        requestImportMode: (parts) => requestImportModeChoice(parts),
        onImported: (parts) => showImportResult('success', `Imported: ${parts.join(', ')}.`),
        onMergeDuplicates: (added, skipped) => showImportResult('success', `Merged ${added} debt(s). Skipped ${skipped} duplicate name(s).`),
        onTooLarge: (maxBytes) => showImportResult('error', `Import file is too large. Maximum supported size is ${Math.round(maxBytes / 1024)} KB.`),
        onReadError: () => showImportResult('error', 'Could not read the file. Please try again.')
    });
}
```

## CSS (`styles.css`)

- `.dt-tabs`/`.dt-tab-btn`/`.dt-tab-btn--active` — copy the existing
  `.rpt-tab-btn` pattern (already has light/dark-mode/high-contrast
  coverage) rather than inventing new tab styling.
- `.dt-panel--hidden { display: none; }` (CSP-compliant class toggle,
  matching `.hidden`/`.flex-visible` elsewhere).
- `.dt-import-choice` — simple flex row for the summary text + two buttons.
- No new color tokens: result banner reuses `.target-result` variants,
  buttons reuse `.btn`/`.btn-primary`.

## i18n (`src/locales/{en,es,pl}.js`)

New button/modal is reachable from the always-visible toolbar (same
precedent as Settings), so it gets translated like the rest of the toolbar:
`toolbar.dataTransferTitle`/`AriaLabel`, and a `dataTransfer.*` namespace for
the modal's static strings (tab labels, descriptions, button text). Dynamic
result-banner messages (which interpolate counts/filenames) stay English for
now, consistent with other dynamic/computed strings elsewhere in the app that
aren't yet on the i18n pilot.

## Test impact

- `tests/integration/test_workflows.py`, `tests/integration/test_smoke.py`,
  `tests/security/test_xss.py`: every `page.click('#exportJsonBtn'/'#importJsonBtn')`
  or `page.query_selector(...)` needs `#dataTransferBtn` clicked (and the
  modal waited on) first; ids inside stay the same, so most of these are a
  one-line prefix add, not a rewrite.
- `tests/ui/test_high_contrast_theme.py`'s focus-ring test currently uses
  `#exportJsonBtn` purely as *a* focusable toolbar button — switch it to
  `#dataTransferBtn`, which still lives directly in the toolbar.
- New test file `tests/ui/test_data_transfer_modal.py`: tab switching
  (default Export active, Import shows/hides panels correctly), inline error
  banner for invalid/oversized/empty files (replacing what used to be
  `alert()`-only coverage, if any), and the inline Replace/Merge choice
  (both paths, including the duplicate-skip count).

## Out of scope

- CSV export (`#exportBtn` on the Strategy page, `exportLedgerToCSV`) is
  untouched — this only consolidates the full-JSON-backup buttons.
- No change to the sanitization/import-parsing logic in `dataExport.js`
  beyond the async `requestImportMode` await.
