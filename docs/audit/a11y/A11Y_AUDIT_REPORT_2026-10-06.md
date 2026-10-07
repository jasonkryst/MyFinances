# MyFinances Accessibility (A11y) Audit Report — 2026-10-06

**Date:** 2026-10-06
**App version:** 6.10.7 (branch `feature/ui-polish-mobile-2026-10`)
**Scope:** Full static source review of `index.html`, `src/*.js`, `styles.css`, and `styles-csp-classes.css`. Focus areas: ARIA coverage, chart accessibility, modal focus management, form labels, keyboard navigation, color contrast, and reduced motion. Cross-checked against the previous report dated 2026-09-02.
**Standard:** WCAG 2.1 AA.
**Prior report:** [`A11Y_AUDIT_REPORT_2026-09-02.md`](./A11Y_AUDIT_REPORT_2026-09-02.md).
**Method:** Static source review (no live-DOM pass this cycle). Grepped for every `new Chart(`, `renderChartDataTable(`, `key === 'Tab'`, `lastFocused`, `role="tab"`, `role="tabpanel"`, `role="tablist"`, `aria-label`, `aria-live`, `prefers-reduced-motion`, and health-status color values. Contrast ratios computed in Python. App source as of latest commit on `feature/ui-polish-mobile-2026-10`.

**No application code was changed as part of this audit.**

---

## Summary

| Check | Result | vs. 2026-09-02 |
|---|---|---|
| F3 — Modal focus-trap gaps (reconcile, delete-confirm, account-replacement) | **RESOLVED** | Fixed 2026-09-04 |
| F4 — 7 Chart.js canvases without sr-table fallbacks | **RESOLVED** | Fixed 2026-09-03 |
| F1 — Dark-mode nav-group-label contrast (timing artifact) | Still open, needs re-verification | unchanged |
| F2 — Mobile Print button tap target (AAA-level, non-blocking) | Still open | unchanged |
| Chart.js canvases added since Sept audit without sr-tables | **4 new gaps** (N1) | new |
| Modals added since Sept audit without focus-trap/restore | **4 new gaps** (N2) | new |
| Reports page tabpanels missing `role="tabpanel"` | **Open** (N3) | new |
| Strategy Schedule inner sub-tabs missing ARIA roles | **Open** (N4) | new |
| Settings / Data Transfer modals missing Tab focus trap | **Open** (N5) | new |
| Month navigation buttons missing `aria-label` | **Open** (N6) | new |
| Form labels (all inputs/selects associated) | Clean | unchanged |
| Health-status color contrast (light + dark) | Clean — all ≥ 4.5:1 | unchanged |
| Reduced motion (CSS + Chart.js) | Clean | unchanged |
| ARIA live regions (net worth, login errors, PG migration) | Clean | unchanged |
| Strategy results tabs (role/panel/aria-selected) | Clean | unchanged |
| Data Transfer modal tabs | Clean | unchanged |

**Overall status: Similar to September — the two previously-reported Serious/Moderate findings (F3, F4) are fully resolved. The same pattern of gaps (chart sr-tables, modal focus management) has recurred for new features added since then: four new canvases were built without sr-table fallbacks, and four new modals were opened without Tab traps. Two structural ARIA gaps on the Reports and Strategy pages (tab panel roles and inner sub-tab roles) are pre-existing markup issues now identified for the first time through this deeper static review.**

---

## Resolved since 2026-09-02

### F3 — [RESOLVED] Three modals lacked Tab focus-trap and two lacked focus-restore

All three modals cited in F3 have been fully remediated:

- **`openReconcileModal()`** (`src/reconciliation.js`) — now has a full Tab/Shift+Tab cycling trap (`key === 'Tab'` at line 333), `lastFocused` capture, and `lastFocused.focus()` on dismiss (lines 305, 309).
- **`showDeleteConfirmModal()`** (`src/ui.js`) — now has a Tab trap (line 964) and `lastFocused` capture/restore (lines 949, 956).
- **`showAccountReplacementModal()`** (`src/ui.js`) — now has a Tab trap (line 1011) and `lastFocused` capture/restore (lines 996, 1003).

Additionally, two new modals added since September (`showArchiveConfirmModal()` and `showPersonReplacementModal()` in `src/ui.js`) were built with the correct pattern from the start — both have Tab traps (lines 1011, 1162) and `lastFocused` capture/restore (lines 996/1003 and 1146/1153 respectively). The regression-prevention direction from F3 has been followed correctly for these two additions.

Six Playwright tests covering Tab cycling and focus-restore in `tests/ui/test_accessibility.py` were added alongside the fix.

### F4 — [RESOLVED] 7 Chart.js canvases lacked sr-table fallbacks

All 7 originally cited canvases now call `renderChartDataTable()` immediately after construction:

- `src/charts.js` — `balanceChart`, `pieChart`, `progressChart`, `debtDistributionChart`, `debtToIncomeChart` (lines 77, 121, 253, 322, 387)
- `src/bills.js` — `cashflowDonutChart`, `cashflowBarChart` (lines 289, 336)

Coverage tests `test_strategy_schedule_charts_have_sr_tables` and `test_budget_cashflow_charts_have_sr_tables` in `tests/ui/test_chart_accessibility.py` were added to prevent silent regression.

Additionally, three new canvases introduced for the Retirement page (`retireBalanceChart`, `retireContributionChart`, `retireBreakdownChart` in `src/retirement.js`) and two for the Break-Even modal (`accelerateChart` in `src/debtBreakEven.js`, the per-scenario charts in the same file) were implemented with sr-tables from the start. The Balance History modal canvas (`balanceHistoryChart` in `src/balanceHistoryModal.js`) also follows the pattern correctly.

---

## Open issues

### N1 — [Serious] 4 Chart.js canvases added since September lack `renderChartDataTable()` sr-table fallbacks

**WCAG:** 1.1.1 Non-text Content / project CLAUDE.md convention.
**Severity:** Serious — screen-reader users see no equivalent to these charts; the data they visualize (income breakdown, outflow by category, daily money flow, net-worth contribution growth) is unavailable in a non-visual form.

Four canvases were added to the Reports section after the September audit without the `renderChartDataTable()` convention being applied:

| Canvas ID | File | Line | Chart | Panel |
|---|---|---|---|---|
| `rptIncomeChart` | `src/reportsCashFlow.js` | 212 | Income doughnut | Reports → Income vs Expenses |
| `rptOutflowChart` | `src/reportsCashFlow.js` | 237 | Outflow bar chart | Reports → Income vs Expenses |
| `rptMoneyFlowChart` | `src/reportsCashFlow.js` | 341 | Cumulative income/outflow/net line chart | Reports → Money Flow |
| `rptNetWorthCompositionChart` | `src/reportsNetWorth.js` | 297 | Asset growth / debt reduction bar chart | Reports → Net Worth |

`rptCashFlowTrendChart` (same file, line 447) correctly calls `renderChartDataTable` at line 472 — the other three canvases in `reportsCashFlow.js` do not.

The `rptNetWorthTrendChart` in `reportsNetWorth.js` correctly calls `renderChartDataTable` at line 287, but the second canvas constructed in the same function (`rptNetWorthCompositionChart`, line 297) does not — the pattern was applied to the first chart but not the second.

**Recommendation:** Add `renderChartDataTable(canvasId, { caption, columns, rows })` immediately after each of the four `new Chart(...)` constructions, using the pattern already established in the same files. Extend `tests/ui/test_chart_accessibility.py` with coverage for each new canvas (the test must navigate to the Reports page, switch to the relevant tab, and assert `#rptIncomeChart-sr-table` etc. exists).

---

### N2 — [Moderate] 4 modals added since September lack Tab focus-trap and/or focus-restore

**WCAG:** 2.4.3 Focus Order (Tab trap), 2.1.2 No Keyboard Trap (corollary: trap must also close correctly).
**Severity:** Moderate — keyboard-only and screen-reader users can Tab out of open dialogs into background controls (which remain in the Tab order since no `inert`/`aria-hidden` is set on siblings), and focus context is silently lost on dismiss.

The four modals below were added since the September audit without the Tab-cycling pattern established in the now-fixed F3 modals:

**1. `openLedgerExportModal()` — `src/ledger.js:32`**
- Has: Escape handler (line 68–72), initial focus on close button (line 76).
- Missing: `lastFocused` capture before opening; `lastFocused.focus()` on dismiss (the `close()` function at line 53 does not restore focus); no `Tab` key handler.

**2. `openLedgerMarkAllClearedModal()` — `src/ledger.js:79`**
- Has: Escape handler (line 109), initial focus on close button (line 114).
- Missing: `lastFocused` capture/restore; no `Tab` key handler.

**3. `openCalendarDayModal()` — `src/reportsCalendar.js:155`**
- Has: Escape handler (line 203–206), initial focus on close button (line 210).
- Missing: `lastFocused` capture/restore (the `close()` function at line 194 does not restore focus); no `Tab` key handler. The modal is information-only (no form inputs, only a close button), so the Tab-trap gap is minimal in practice, but the focus-restore gap is real.

**4. `_openSpendingDrilldown()` — `src/spending.js:65`**
- Has: backdrop click to close (line 102).
- Missing: Escape key handler entirely; no initial `focus()` call (the modal opens but focus stays on whatever triggered it in the background, or is lost); no `lastFocused` capture/restore; no Tab trap; the close button is injected via `innerHTML` (line 98) and referenced immediately after via `document.getElementById` (line 101) — this works but bypasses the CSP-safe pattern used elsewhere and makes it harder to add a Tab trap cleanly. As an informational drilldown with a single close button it is lower impact than the ledger modals, but the absence of Escape handling is a keyboard-only regression.

**Recommendation:** Apply the same `lastFocused`/Tab-trap/focus-restore pattern used in `showDeleteConfirmModal()` (`src/ui.js:949–982`) to all four modals. For `_openSpendingDrilldown`, also add an Escape handler matching `openCalendarDayModal`'s pattern. Priority: Ledger modals > Calendar Day > Spending Drilldown.

---

### N3 — [Moderate] Reports page tabpanels missing `role="tabpanel"`

**WCAG:** 4.1.2 Name, Role, Value.
**Severity:** Moderate — the eight `rpt-tab-panel` panel divs on the Reports page are controlled by `role="tab"` buttons with `aria-controls` pointing to them, but the panels themselves lack `role="tabpanel"`. Screen readers that honor `aria-controls` will navigate to the element but won't announce it as a tab panel, and the association between tab and content is incomplete for ATs that rely on the full APG tab widget contract.

**Affected elements** (`index.html` lines 1000–1033):

```
#rptPanel-calendar   (line 1000) — no role="tabpanel"
#rptPanel-incomeexp  (line 1005) — no role="tabpanel"
#rptPanel-moneyflow  (line 1010) — no role="tabpanel"
#rptPanel-variance   (line 1017) — no role="tabpanel"
#rptPanel-networth   (line 1021) — no role="tabpanel"
#rptPanel-forecast   (line 1025) — no role="tabpanel"
#rptPanel-spending   (line 1029) — no role="tabpanel"
#rptPanel-summary    (line 1033) — no role="tabpanel"
```

Contrast: the Strategy page's three result panels (`rPanel-overview`, `rPanel-debt-summary`, `rPanel-schedule`) and the Data Transfer modal's two panels correctly carry `role="tabpanel"`. The Reports tab buttons already have `role="tab"`, `aria-selected`, and `aria-controls="rptPanel-*"` — adding `role="tabpanel"` to the panels closes the APG contract.

The ARIA spec also recommends `aria-labelledby` on tabpanels pointing to their controlling tab button, but none of the app's tabpanel elements (including the correctly-roled Strategy and DataTransfer ones) carry it. This is a secondary gap: `aria-controls` is the primary relationship, and most screen readers surface the tab's label when navigating into the panel, but `aria-labelledby` is recommended for completeness.

**Recommendation:** Add `role="tabpanel"` to all eight `rpt-tab-panel` divs. Optionally add matching `aria-labelledby="<tab-button-id>"` pairs — this requires adding `id` attributes to the tab buttons and matching `aria-labelledby` on each panel (the current tab buttons lack `id` attributes). The `role="tabpanel"` change alone is a one-line-per-panel addition and is the minimum needed for WCAG 4.1.2.

---

### N4 — [Moderate] Strategy Schedule inner sub-tabs missing tablist/tab ARIA roles

**WCAG:** 4.1.2 Name, Role, Value.
**Severity:** Moderate — keyboard and screen-reader users interacting with the Strategy page's Schedule panel cannot identify the three view-switcher buttons (Tabular / Calendar / Chart) as tabs. The buttons activate correctly with keyboard Enter/Space (they are `<button>` elements), but their role as a tab group is not expressed to ATs.

**Affected markup** (`index.html:896–900`):

```html
<div class="tabs">
    <button class="tab-button active" data-tab="tabular">Tabular View</button>
    <button class="tab-button" data-tab="calendar">Calendar View</button>
    <button class="tab-button" data-tab="chart">Chart View</button>
</div>
```

The container lacks `role="tablist"` and `aria-label`. The buttons lack `role="tab"`, `aria-selected`, and `aria-controls`. The tab content divs (`#tabular-tab`, `#calendar-tab`, `#chart-tab`) lack `role="tabpanel"`.

This is different from the outer Strategy results tabs (`results-tab-bar`) and the Reports tab bar, both of which have full ARIA tab markup. The inner Schedule sub-tabs appear to predate the app's ARIA tab conventions.

The JavaScript that manages `.active` class toggling for these buttons is in `strategyScheduleTable.js` (or `strategy.js`) — wherever `.active` is toggled, `aria-selected` will also need to be toggled.

**Recommendation:** Add `role="tablist" aria-label="Schedule view"` to the `.tabs` container; `role="tab"` + `aria-selected` + `aria-controls="<panel-id>"` to each `.tab-button`; and `role="tabpanel"` + `aria-labelledby="<tab-id>"` to each content div. Update the tab-switching JavaScript to mirror `.active` class changes onto `aria-selected="true/false"`.

---

### N5 — [Minor] Settings modal and Data Transfer modal missing Tab focus trap

**WCAG:** 2.4.3 Focus Order.
**Severity:** Minor — both modals have `lastFocused` capture + restore on close and Escape handling, so focus context is preserved. The only gap is that a keyboard user holding Tab inside either modal can escape to background controls. Given the static page behind these modals has no interactive elements other than the toolbar (which is visually obscured), the practical impact is low, but it is inconsistent with the app's established pattern.

- **Settings modal** (`initSettingsModal()`, `src/setupWizard.js:119–125`): `onkeydown` handles only Escape; no `Tab` handler.
- **Data Transfer modal** (`src/dataTransferModal.js`): same pattern — `lastFocused` + Escape, no Tab handler.

Both modals have multiple interactive elements (checkboxes, selects, buttons) that a Tab trap would cycle through.

**Recommendation:** Add the standard Tab-cycling block (already used in `showDeleteConfirmModal()` and five other modals) to the `onkeydown` handlers of both modals. Low effort; brings them into line with the rest of the app.

---

### N6 — [Minor] Reports month navigation buttons rely on `title` only for accessible name

**WCAG:** 4.1.2 Name, Role, Value (advisory); WCAG 2.1 AA does not strictly prohibit `title`-only naming.
**Severity:** Minor. `title` provides an accessible name for most screen readers and is sufficient under the current standard, but `aria-label` is more universally supported and announced in more contexts (e.g. touch screen readers that don't surface tooltips).

**Affected elements** (`index.html:958–960`):

```html
<button class="rpt-month-btn" id="rptPrevMonth" title="Previous month">&#8249;</button>
<button class="rpt-month-btn" id="rptNextMonth" title="Next month">&#8250;</button>
```

The button content (`‹` / `›`) is a non-descriptive symbol. All other navigation/action buttons in the app use `aria-label` directly. These two are the only interactive elements relying solely on `title`.

**Recommendation:** Add `aria-label="Previous month"` / `aria-label="Next month"` to these two buttons. Two-character change; removes the `title`-only edge case.

---

### F1 — [Minor / needs verification] Dark-mode nav-group-label contrast during page-switch transition

**Status:** Unchanged since 2026-09-02. Still needs a longer settle wait (≥ 300ms) in `run_a11y_audit.py` to confirm whether the reported rgba values are a script-timing artifact (likely) or a genuine contrast failure. No app code change warranted until confirmed. See the full discussion in the September report.

---

### F2 — [Minor] Mobile Print button tap target

**Status:** Unchanged since 2026-09-02. Multiple `.page-print-btn` elements exist in the app (Health, Accounts, Liabilities, Income, Ledger, Recurring, Strategy pages). Still out of WCAG 2.1 AA scope (SC 2.5.5 is AAA; SC 2.5.8 from WCAG 2.2 is not yet adopted). Still low priority unless the project adopts WCAG 2.2.

---

## Verified clean (no change from September)

- **Reduced motion:** `@media (prefers-reduced-motion: reduce)` global rule present at `styles.css:35` collapsing all CSS animations/transitions to 0.01ms. `Chart.defaults.animation = false` set in `src/app.js:219` when the media query matches at startup.
- **Form labels:** All `<input>`, `<select>`, and `<textarea>` elements in `index.html` have associated `<label for="...">` elements or explicit `aria-label` attributes. No orphaned inputs found.
- **Health status colors:** All eight `.health-status--*` classes (light + dark mode) pass WCAG AA 4.5:1 minimum contrast: green 4.57:1, yellow 4.58:1, orange 4.52:1, red 5.30:1 (light); 6.49:1, 11.70:1, 9.28:1, 8.51:1 (dark).
- **ARIA live regions:** `aria-live="polite"` present on `#netWorthWidget`, login gate errors (`#loginGateError`, `#loginGateForgotError`, `#loginGateResetError`), and PG migration error (`#pgMigrationError`).
- **Modal ARIA structure:** All modals use `role="dialog" aria-modal="true"` with `aria-labelledby` pointing to their title element. `#spendingDrilldownModal`'s dangling `aria-labelledby` reference (title is dynamically injected) is the pre-existing known false-positive from the June 2026 audit.
- **Tablist/tab roles (Strategy results tabs):** `rPanel-overview`, `rPanel-debt-summary`, `rPanel-schedule` correctly carry `role="tabpanel"`. Their controlling buttons carry `role="tab"`, `aria-selected`, `aria-controls`.
- **Tablist/tab roles (Data Transfer modal):** Both panels and buttons are correctly marked up.
- **New Retirement page tabs:** The retirement page's tab switching is handled inline with the same `.results-tab-btn`/`.results-tab-panel` classes as the Strategy page, so it inherits correct ARIA markup.
- **New modals with correct focus management:** `showArchiveConfirmModal()` and `showPersonReplacementModal()` (both `src/ui.js`) — correct Tab trap, `lastFocused`, Escape, focus-restore. `balanceHistoryModal` (`src/balanceHistoryModal.js`) — correct Tab trap, `lastFocused`, initial focus. `retirementSnapshotModal` (`src/retirement.js`) — correct Tab trap, `lastFocused`, initial focus. `openReconcileModal()` (`src/reconciliation.js`) — now correct (F3 resolved).
- **`aria-current="page"`:** Set on the Health nav button by default in `index.html:120`; managed dynamically by `switchPage()` in `src/ui.js`.
- **`aria-expanded` on disclosure buttons:** Present on all form-toggle buttons (`debtFormToggle`, `expenseFormToggle`, `bonusFormToggle`, `recurringFormToggle`, `targetDateToggle`, `planHistoryToggle`). The mobile `navToggle` button correctly toggles `aria-expanded`.
- **Chart sr-tables (all pre-existing canvases):** All canvases that existed at the September audit now have `renderChartDataTable()` calls. All new canvases added for the Retirement dashboard, Break-Even accelerate, and Balance History features also have them.

---

## Prioritized remediation list

| Priority | Finding | WCAG | Effort | Impact |
|---|---|---|---|---|
| **P0** | N1 — 4 new charts missing sr-tables | 1.1.1 | Low (4 `renderChartDataTable()` calls + 4 test cases) | Serious — chart data inaccessible to screen readers on Reports page |
| **P1** | N2 — 4 new modals missing focus-trap/restore | 2.4.3 | Low–Medium (add `lastFocused` + Tab handler to each) | Moderate — keyboard users lose focus context; can Tab out of open modals |
| **P1** | N3 — Reports tabpanels missing `role="tabpanel"` | 4.1.2 | Low (8 `role="tabpanel"` additions) | Moderate — tab widget contract broken for ATs on the most-used section of Reports |
| **P1** | N4 — Strategy Schedule inner tabs missing ARIA | 4.1.2 | Medium (add roles + update JS to mirror `aria-selected`) | Moderate — three view-switching buttons not announced as a tab group |
| **P2** | N5 — Settings + Data Transfer modals missing Tab trap | 2.4.3 | Low (add Tab handler to 2 `onkeydown` handlers) | Minor — focus can escape, but restore-on-close is working |
| **P2** | N6 — Month nav buttons `title`-only accessible name | 4.1.2 | Trivial (add `aria-label` to 2 buttons) | Minor — universally supported in most ATs via `title`, but `aria-label` is preferred |
| **P3** | F1 — Dark-mode nav-group-label contrast (tooling) | 1.4.3 | Trivial (bump settle wait in `run_a11y_audit.py`) | Needs verification before any app change |
| **P3** | F2 — Mobile Print button tap target (AAA, out of scope) | 2.5.5 (AAA) | Low (increase min-height on `.page-print-btn`) | Out of WCAG 2.1 AA scope |

**N1 and N2 follow the same pattern as F3/F4 from September: newly built features missed the established conventions.** The same conventions that the September report recommended codifying as checklists (chart sr-tables for every `new Chart(`, focus management for every new modal) should be enforced before landing new feature code, not caught by post-hoc audit. Extending `tests/ui/test_chart_accessibility.py` to cover each new canvas ID as it is added (rather than in a follow-up audit) is the most durable way to prevent N1-category regressions from accumulating.
