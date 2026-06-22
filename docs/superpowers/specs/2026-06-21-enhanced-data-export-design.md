# Enhanced Data Export — Design Spec

**Date**: 2026-06-21
**Roadmap items covered**: "Enhanced Data Export" (Tier 4, LOW/MEDIUM) + "Print-friendly Reports view" (Tier 5 UI/UX)
**Status**: Approved for planning

## Summary

Four independent sub-features, delivered with **zero new dependencies** (no PDF library, no chart-export library), consistent with the project's privacy-first / no-build-step / vanilla-JS architecture:

1. Print stylesheet (`@media print`) for the Reports page — doubles as the PDF mechanism via the browser's native Save-as-PDF.
2. A new printable Monthly/Yearly **Summary Report** tab on the Reports page.
3. Per-chart **PNG export** buttons on every Chart.js canvas app-wide (16 charts).
4. **Custom-column CSV export** for the Ledger's currently filtered transaction list.

None of these touch `localStorage` schema, `sanitize*()` functions, or import — this is export-only, so no `storage.js` version bump and no new persisted fields except one small UI preference (last-used CSV columns, see below).

---

## 1. Print stylesheet + PDF

**Mechanism**: a new `@media print { ... }` block in `styles.css` that:
- Hides `header`, `nav.top-nav`, all `button`/`select`/`input` controls, the tab bar (`.rpt-tab-bar`), and any `.page-section` that is not `.active`.
- Within the active `.page-section`, hides all `.rpt-tab-panel` except `.rpt-tab-panel--active`, so printing always reflects what's on screen.
- Sets `body { background: white }`, removes shadows/borders intended for screen, expands chart canvases to full print width, and adds simple page margins.
- Chart.js canvases render fine under print CSS since they're raster `<canvas>` elements — no special handling needed beyond sizing.

**PDF generation**: a "🖨️ Print / Save as PDF" button (added to the Reports page header, next to the month nav) calls `window.print()`. The browser's print dialog already offers "Save as PDF" as a destination — no library needed. This single mechanism satisfies both roadmap items.

**Why not a PDF library**: `index.html`'s CSP (`script-src 'self' https://cdn.jsdelivr.net`) would need a new allowed origin, the only existing third-party script is Chart.js, and the app explicitly avoids a build step. Browser print-to-PDF needs neither.

## 2. Printable Summary Report (new Reports tab)

- New tab group "Print" in the existing `.rpt-tab-bar`, with one button: `<button data-rptab="summary">🖨️ Summary</button>` and panel `<div id="rptPanel-summary">`.
- A Monthly/Yearly toggle (two buttons, similar styling to existing toggle patterns elsewhere in the app) stored as transient UI state `app._reportSummaryRange` (`'month' | 'year'`, default `'month'`) — not persisted, resets on reload like `_reportMonthOffset`.
- New function `renderReportsSummary(app)` in `reports.js`, called from `renderReportsPage(app)` like the other panels. It reuses existing aggregation helpers already in `reports.js`/`health.js` (income/expense totals, net worth, account balances, debt payoff progress) rather than recomputing them — for the yearly view, it sums/averages the same per-month metrics across the 12 months ending at the current report month.
- Renders a single clean `<table>`: rows = metric, column = value (month) or 12 monthly columns (year) — kept simple, no new chart.
- The existing "🖨️ Print / Save as PDF" button from section 1 works here unchanged, since it just prints whatever tab panel is active.

## 3. Per-chart PNG export

- New helper in `utils.js`: `addChartImageExportButton(canvasId, chart, filename)`. Inserts a small icon button (`.chart-export-btn`, CSS class added to `styles.css`) absolutely positioned in the canvas's parent (same insertion point as `renderChartDataTable`'s sibling table), with `aria-label="Download {chart title} as image"`.
- On click: `const url = chart.toBase64Image('image/png', 1); ` then the same Blob-less `<a download>` trick already used elsewhere (data URLs don't need `URL.createObjectURL`).
- Called once immediately after each `new Chart(...)` call, alongside the existing `renderChartDataTable(...)` call, in all 6 files that create charts: `charts.js` (5), `reports.js` (5), `bills.js` (2), `spending.js` (2), `forecast.js` (1), `health.js` (1).
- `filename` follows the existing CSV/JSON download naming convention: `<chart-slug>-${new Date().toISOString().split('T')[0]}.png`.
- Button is hidden under the print stylesheet (section 1) since it's a `button` element — no extra CSS needed.

## 4. Ledger custom-column CSV export

- New "⬇️ Export CSV" button added to `.filter-controls` in `renderLedgerPage` (`ledger.js`), next to the existing "Reconcile this account" button.
- Click opens a new modal `#ledgerExportModal` (markup added to `index.html`, follows the exact pattern of `#ledgerOverrideModal`: `.modal` hidden/flex-visible toggle, close/cancel/confirm buttons, `Escape`/`Enter` handling). Contains one checkbox per exportable column: Date, Account, Transaction Name, Amount, Category, Running Balance, Type. All checked by default.
- Selected columns persist across sessions as `app.settings.ledgerExportColumns` (array of column keys) — small enough to warrant a `sanitizeLedgerExportColumns()` entry in `storage.js` (whitelist against the known column-key set, default to "all columns" if missing/invalid) so it survives export/import round-trips per the project's sanitization rule.
- Confirm calls new `exportLedgerToCSV(app, columns)` in `storage.js`, which:
  - Refactors the filter/sort logic currently inlined in `renderLedgerPage` (account filter, date-range filter, sort key/dir) into a shared `getFilteredSortedLedgerTransactions(app)` in `ledger.js`, used by both the table render and the export — avoiding duplicated filter logic.
  - Builds CSV rows with only the selected columns, reusing the existing `csvField()` quoting helper.
  - Downloads as `ledger-export-${date}.csv` via the same Blob+`<a download>` pattern as `exportToCSV`.

---

## Data flow

No new data sources. All four sub-features read existing in-memory state (`app.debts`, `app.accounts`, ledger transactions, `monthlySnapshots`, Chart.js instances) and produce client-side downloads or print output. The only new persisted field is `app.settings.ledgerExportColumns` (sanitized whitelist, see above).

## Error handling

- Summary Report: if there's no data for the selected month/year (e.g. new user), render a "Not enough data yet" empty state — same convention as other Reports panels.
- Chart export: `toBase64Image()` cannot fail under normal use (canvas always rendered before the button exists); no special handling needed.
- Ledger CSV export: if the filtered transaction list is empty, disable the modal's confirm button and show "No transactions to export" — mirrors `exportToCSV`'s existing `onMissingPlan` empty-state pattern.
- Print: no error states — it's a browser-native dialog.

## Testing plan

- **Features** (`tests/features/test_export.py`, new): `exportLedgerToCSV` column selection produces correct headers/rows for a fixed fixture dataset; `renderReportsSummary` month vs year aggregation math against known account/income/debt fixtures; `sanitizeLedgerExportColumns` whitelist/round-trip behavior.
- **UI** (`tests/ui/`, new `test_export_ui.py` + additions to `test_reports_actions.py`): Summary tab navigation and Monthly/Yearly toggle; ledger export modal open/close/Escape/Enter; chart export buttons present on every canvas and clickable; print button present and triggers `window.print` (mocked).
- **Accessibility/A11y** (`tests/a11y/test_a11y_audit.py` additions): export modal focus trap and labels; chart-export buttons have `aria-label`; Summary Report table has proper `<caption>`/`<th scope>` like other tables; print stylesheet doesn't strip content needed by screen readers (sr-only tables remain in DOM, just visually hidden controls are removed from print, not from the accessibility tree at large).
- **Security** (`tests/security/`): CSV injection check — column values are run through `csvField()` quoting (already covers `=`/`+`/`-`/`@` leading-character CSV-formula-injection risk only if Excel auto-executes; verify existing `csvField` behavior and add a regression test); static scan confirms no inline `<style>`/`<script>` introduced; CSP test confirms no new external origins.
- **E2E** (`tests/integration/`): full flow — open Ledger, filter to one account, export CSV with 3 of 7 columns checked, verify downloaded content; open Reports → Summary tab → toggle to Yearly → click Print (verify `window.print` called); click a chart's export button and verify a PNG download is triggered.

## Documentation updates

- `ROADMAP.md`: mark "Enhanced Data Export" and "Print-friendly Reports view" as ✅ Delivered with a one-line summary, same convention as other delivered Tier 5 items.
- `README.md`: add the four capabilities to the feature list under Reports/Ledger.
- `guide.html`: extend the existing "Exporting Data" / "Exporting Schedule to CSV" sections with the new column-picker CSV export, the Summary Report tab, the Print/PDF button, and per-chart PNG export.
- `SECURITY.md`: no changes expected (no new dependencies, no new external origins, no new persisted PII-bearing fields beyond a column-name whitelist) — confirm during implementation.
