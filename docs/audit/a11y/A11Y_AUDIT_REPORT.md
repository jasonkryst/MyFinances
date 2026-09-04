# MyFinances Accessibility (A11y) Audit Report — 2026-09-02

**Date:** 2026-09-02
**Scope:** Full app — all 10 SPA pages (Health, Accounts, Income, Liabilities, Recurring, Savings, Strategy, Reports, Ledger, Reconcile), light + dark mode, mobile viewport (375×667), 3 automated modal checks (Update Balance, Reconcile, Amortization), `guide.html`, plus a static source review of chart accessibility and modal focus management not covered by the live-DOM walk.
**Method:** Automated Playwright audit (`tests/a11y/run_a11y_audit.py`) against a seeded sample dataset. Raw output: [`raw_findings_2026-09-02.json`](./raw_findings_2026-09-02.json). Cross-checked against source (`src/*.js`, `styles.css`, `styles-csp-classes.css`) and the existing automated coverage in `tests/a11y/test_a11y_audit.py`, `tests/ui/test_accessibility.py`, `tests/ui/test_chart_accessibility.py`, `tests/ui/test_high_contrast_theme.py`, `tests/ui/test_reduced_motion.py`. A Lighthouse CI run against `http://localhost:32900/` did not complete (see "Lighthouse" below).
**Standard:** WCAG 2.1 AA.
**Prior report:** [`A11Y_AUDIT_REPORT_2026-06-19.md`](./A11Y_AUDIT_REPORT_2026-06-19.md), which found no Serious/Moderate defects. This pass goes further than the June 19 live-DOM walk by statically auditing every `new Chart(` call site against the `renderChartDataTable()` convention and every modal's focus-trap/focus-restore logic — two categories the automated script cannot exercise because they require reaching UI states (chart tabs, delete confirmations) the script doesn't visit.

**No application code was changed as part of this audit.**

---

## Summary

| Check | Result | vs. 2026-06-19 |
|---|---|---|
| Dangling ARIA references (all pages + guide) | 0 real findings | unchanged |
| Duplicate IDs | 0 | unchanged |
| Orphaned form inputs | 0 | unchanged |
| Unnamed interactive elements | 0 | unchanged |
| Images missing alt text | 0 | unchanged |
| Site-wide color contrast, static/settled state (light + dark, all pages + guide) | 0 real findings | unchanged |
| Dark-mode nav-group-label contrast during page-switch transition | 2 borderline readings (see F1) | **new** — likely audit-timing artifact, needs a longer settle wait to confirm |
| Mobile tap targets | **1 undersized** (`#healthPrintBtn`, 81×30) | **new** — AAA-level SC, not an AA failure (see F2) |
| Mobile nav `aria-expanded` toggle | Correct | unchanged |
| Update Balance modal focus + Escape + Tab-trap + focus-restore | Correct | unchanged |
| Reconcile modal focus + Escape | Correct on script's checks; **no Tab-trap** (static finding, F3) | **new** (static-only) |
| Amortization modal focus + Escape + Tab-trap + focus-restore | Correct | unchanged |
| Delete Confirm / Account Replacement modals | **No Tab-trap; no focus-restore on dismiss** (F3) | **new** (static-only) |
| Chart.js canvases with an accessible `<table>` fallback | **7 of 16 canvases have none** (F4) | **new** (static-only) |
| `pytest tests/a11y/` | Not re-run this pass (raw findings collected via the standalone script per task instructions) | — |
| Lighthouse CI accessibility score | **Unavailable** — run crashed before producing a report (Windows/chrome-launcher tmp-cleanup `EPERM`, unrelated to app code) | — |

The app remains in good shape on the categories the live-DOM audit script directly measures — structural markup, dangling ARIA, duplicate IDs, orphaned inputs/unnamed controls, and settled-state contrast are all still clean. Going deeper into source this pass surfaced two real, previously-undetected gaps worth fixing: **inconsistent modal focus management** (F3) and **a Chart.js accessibility regression/gap of scope** (F4) affecting 7 canvases that were never covered by the `renderChartDataTable()` convention or by `test_chart_accessibility.py`. Neither is a live-DOM-walk finding — both required reading the modal/chart source directly, which is why they weren't caught on 2026-06-19.

---

## F1 — [Minor / needs verification] Dark-mode `.nav-group-label` reads below threshold during the ~150ms page-switch highlight transition

**Severity:** Minor, likely a script-timing artifact rather than a live defect — flagged for verification, not immediate remediation.
**WCAG:** 1.4.3 Contrast (Minimum), if it turns out to be real.
**Location:** `styles.css:1308-1329` (`.nav-group-label`, `.nav-group:has(.page-button.active) .nav-group-label`).

On the Liabilities page in dark mode, `dark_mode_contrast.liabilities` in the raw findings shows two `.nav-group-label` readings below the 4.5:1 threshold:

- `"Overview"` — `color: rgba(188, 198, 231, 0.867)` on `bg: rgba(142, 142, 142, 0.42)` → **1.93:1**
- `"Manage"` — `color: rgba(80, 107, 193, 0.953)` on `bg: rgba(232, 232, 232, 0.733)` → **4.07:1**

These are new since 2026-06-19, where the same elements always measured exactly `ratio: 1` (the known `getBg()`-can't-composite-translucent-backgrounds artifact filtered by `_is_gradient_header_false_positive` in `tests/a11y/test_a11y_audit.py`). The current readings are *not* in that `ratio <= 1.05` band, so they wouldn't be auto-filtered by that helper — but the color/alpha values reported (`rgba(…, 0.867)`, `rgba(…, 0.733)`, etc.) don't match either of the two static CSS states defined for this element:

- Resting state: `background: rgba(0,0,0,0.25); color: rgba(255,255,255,0.82);`
- Active-group state (`:has(.page-button.active)`): `background: rgba(255,255,255,0.90); color: #1e40af;`

`.nav-group-label` has `transition: background 0.15s, color 0.15s;` (styles.css:1322), and the dark-mode contrast pass in `run_a11y_audit.py` calls `switchPage()` then waits **exactly 150ms** before reading computed style (`run_a11y_audit.py:333-336`) — i.e. it samples right at the tail of the CSS transition that fires because switching to the Liabilities page moves the `:has(.page-button.active)` match from one `.nav-group` to another, animating both the outgoing and incoming label's background/color simultaneously. The reported rgba values, which sit between the two defined endpoints, are consistent with mid-transition sampling rather than a genuine new color rule.

**Recommendation:** Bump the dark-mode contrast pass's `wait_for_timeout(150)` to something safely past the 150ms transition (e.g. 300ms) and re-run to confirm the finding disappears. If it does, this is a tooling note only (same lineage as the June 19 report's A1). If it persists at a longer wait, it is a real WCAG 1.4.3 failure and both the resting (`rgba(0,0,0,0.25)`/`rgba(255,255,255,0.82)`) and active (`rgba(255,255,255,0.90)`/`#1e40af`) states should be re-measured against the actual composited dark-mode header background per the code comment's stated ~6.8:1/~12.7:1 baseline. Not blocking; low effort to confirm.

---

## F2 — [Minor] Mobile "Print" button on the Health page is undersized for a AAA/best-practice tap target

**Severity:** Minor. **WCAG 2.1 AA does not require this** — Target Size is SC 2.5.5 at Level **AAA** in WCAG 2.1 (2.5.8 Target Size (Minimum), the AA-level 24×24 version, is a WCAG **2.2** addition, not 2.1). Flagged as a best-practice/mobile-usability note, not an AA compliance gap.
**Location:** `src/health.js:161` — `<button type="button" class="page-print-btn" id="healthPrintBtn" ...>🖨️ Print</button>`.

At the 375×667 mobile viewport, `#healthPrintBtn` measures **81×30px** — below the 44×44px AAA target and also below the 24×24px WCAG 2.2 AA minimum margin, though its 30px height clears 24px so it would actually pass 2.5.8 if that SC were in scope. It has a proper `aria-label` (verified by `tests/ui/test_overview_print.py`), so this is purely a physical hit-area sizing note, not a naming/labeling defect. This did not exist on 2026-06-19 (`tap_targets: []` in that run) — the Print button is new since then.

**Recommendation:** Low priority given it's outside WCAG 2.1 AA scope. If addressed, increase `.page-print-btn`'s min-height to 44px on mobile breakpoints (or pad it) for consistency with the rest of the toolbar, and to get ahead of WCAG 2.2 2.5.8 if the project adopts that standard later.

---

## F3 — [Moderate] Three of the app's modal dialogs lack a keyboard focus trap, and two of them never restore focus on dismiss

**RESOLVED 2026-09-04.** All 3 modals (`openReconcileModal()` in `src/reconciliation.js`, `showDeleteConfirmModal()`/`showAccountReplacementModal()` in `src/ui.js`) now implement the same first/last-focusable Tab-cycling pattern already used by the Update Balance/Amortization/Break-even modals, plus focus-restore to the triggering element on dismiss (the two `ui.js` modals previously had neither). 6 new Playwright tests in `tests/ui/test_accessibility.py` cover Tab-wrap in both directions and focus-restore for all 3 modals — genuine Tab-cycling assertions, closing the gap this finding also flagged in the existing (misleadingly-named) `test_reconcile_modal_focus_and_keyboard_trap`/`test_settings_modal_focus_and_keyboard_trap` tests, neither of which actually tested Tab.

**Severity:** Moderate. **WCAG 2.4.3 Focus Order** (and the ARIA Authoring Practices Guide's Dialog (Modal) pattern, which both this app's own conventions and its other modals otherwise follow).
**Not caught by:** `run_a11y_audit.py`'s live-DOM walk (it only exercises Update Balance, Reconcile-open/Escape, and Amortization — none of which probe Tab cycling — see `tests/a11y/run_a11y_audit.py:344-431`), nor by `tests/ui/test_accessibility.py` (which only checks the Reconcile modal's Escape/focus behavior, not Tab).

Grepping every `key === 'Tab'` handler in `src/` shows a focus trap (first/last focusable element cycling via `Shift+Tab`/`Tab`) implemented in exactly three places:

- `src/debts.js:141-159` — Update Balance modal (full trap + focus-restore via `lastFocused`)
- `src/ui.js:397-419` — Amortization modal (full trap + focus-restore)
- `src/debtBreakEven.js:233-239` — Break-even modal (full trap)

Three other modals that use the same `role="dialog" aria-modal="true"` pattern (`index.html:1099-1128`) do **not** have any Tab handling, so a sighted keyboard user or screen-reader user can Tab straight out of the open dialog into background page controls that are still visually present (nothing else — no `inert`, no `aria-hidden` on siblings — constrains Tab order; `aria-modal="true"` alone only affects the accessibility tree exposure for some screen readers, not native Tab order):

- **`src/reconciliation.js`'s `openReconcileModal()`** (`reconciliation.js:283-334`) — has Escape (line 320-325) and Enter-to-confirm (326-329) handlers but no Tab handler at all.
- **`showDeleteConfirmModal()`** (`src/ui.js:782-813`) — the app-wide generic "Confirm/Cancel" replacement for `window.confirm()`, used for virtually every delete action across the app. Has Escape but no Tab trap, **and no focus-restore**: unlike `showAlertModal()` (`ui.js:881-914`), which captures `document.activeElement` before opening and calls `lastFocused.focus()` on dismiss, `showDeleteConfirmModal()`'s `dismiss()` (`ui.js:793-800`) never captures or restores the triggering element's focus — after Escape/Cancel/Confirm, focus is simply lost to `<body>`.
- **`showAccountReplacementModal()`** (`src/ui.js:815-879`) — same two gaps: no Tab trap, and its `dismiss()` (`ui.js:860-868`) doesn't restore focus either.

This is inconsistent with the app's own established pattern (3 of 6 modals do it correctly) and is high-impact for the two generic-confirm modals in particular, since `showDeleteConfirmModal()` is the shared delete-confirmation UI reused everywhere in the app (debts, accounts, bills, expenses, recurring templates, etc.) — every keyboard/screen-reader delete flow in the app currently loses focus context after confirming or canceling a delete.

**Recommendation:** Port the same first/last-focusable Tab-trap block already used in `debts.js`/`ui.js` (amortization)/`debtBreakEven.js` into `openReconcileModal()`, `showDeleteConfirmModal()`, and `showAccountReplacementModal()`; and add `lastFocused` capture/restore to the latter two's `dismiss()` functions, matching `showAlertModal()`. Given `showDeleteConfirmModal` is reused everywhere, this is worth prioritizing above F1/F2.

---

## F4 — [Serious] 7 of 16 Chart.js canvases have no screen-reader-accessible data-table equivalent

**RESOLVED 2026-09-03:** All 7 canvases now call `renderChartDataTable()` immediately after construction (`src/charts.js`, `src/bills.js`), following the exact pattern this finding recommended. `tests/ui/test_chart_accessibility.py` gained `test_strategy_schedule_charts_have_sr_tables` (all 5 `charts.js` canvases) and `test_budget_cashflow_charts_have_sr_tables` (both `bills.js` canvases), closing the coverage gap described below.

**Severity:** Serious. **WCAG 1.1.1 Non-text Content** / the project's own documented "Chart accessibility" convention in `CLAUDE.md` ("every Chart.js canvas should have a `renderChartDataTable(...)` call ... immediately after construction").
**Not caught by:** `tests/ui/test_chart_accessibility.py`, which only asserts sr-tables exist for `healthDtiGauge`, `healthSavingsGauge`, `rptSpendingPieChart`, `rptSpendingBarChart`, `cfForecastChart`, and `rptNetWorthTrendChart` — i.e. exactly the canvases in the 7 modules that *do* call `renderChartDataTable()` (`reportsNetWorth.js`, `reportsCashFlow.js`, `reportsMoneyFlowSankey.js`, `health.js`, `spending.js`, `forecast.js`, `debtBreakEven.js`). Nor by `run_a11y_audit.py`, whose live-DOM walk never triggers a payment-plan calculation + clicks into the Strategy page's "Chart" results tab or the Budget page's cash-flow-charts tab, so these canvases are never actually rendered during the automated pass.

Grepping every `new Chart(` call site against every `renderChartDataTable(` call site shows two source files construct Chart.js instances with **zero** matching sr-table calls anywhere in the file:

**`src/charts.js`** — all 5 exported chart functions, all rendered together on the **Strategy (Plan) page's "📊 Chart" results tab** (`index.html:659-675`, `#chart-tab`), wired from `ui.js:482-486`:
- `renderBalanceChart()` (`charts.js:4-76`) → `#balanceChart` — per-debt balance-over-time line chart
- `renderProgressChart()` (`charts.js:116-`) → `#progressChart`
- `renderPieChart()` (`charts.js:78-`) → `#pieChart`
- `renderDebtDistributionChart()` (`charts.js:239-`) → `#debtDistributionChart`
- `renderDebtToIncomeChart()` (`charts.js:302-`) → `#debtToIncomeChart`

**`src/bills.js`** — both charts on the **Liabilities → Budget subtab's cash-flow "Charts" tab** (`bills.js:313-378`, `renderCashFlowCharts()`):
- `#cashflowDonutChart` (`bills.js:326-336`) — income/debt/bills/expenses donut
- `#cashflowBarChart` (`bills.js:363-377`) — outflow breakdown bar chart

None of these 7 canvases have a `<canvasId>-sr-table` sibling, so a screen-reader user gets no equivalent to the payoff-plan balance trend, debt distribution, debt-to-income ratio, or cash-flow breakdown that sighted users see in these two very central views (the Plan page is one of the app's primary features). This appears to predate the `renderChartDataTable()` convention (the other 7 chart-producing modules all follow it correctly) and was simply never retrofitted — it is not a regression introduced recently, but it is a real, currently-live gap that both the CLAUDE.md-documented pattern and the existing test suite's *coverage* imply is closed when it isn't.

**Recommendation:** Add a `renderChartDataTable(app, '<canvasId>', { caption, columns, rows })` call immediately after each of these 7 `new Chart(...)` constructions, following the exact pattern already used in `health.js`/`spending.js`/`forecast.js`/`debtBreakEven.js`/`reportsNetWorth.js`/`reportsCashFlow.js`. Extend `tests/ui/test_chart_accessibility.py` with `test_strategy_charts_have_sr_tables` (all 5 `charts.js` canvases, after calculating a plan and switching to the Chart results tab) and `test_cashflow_charts_have_sr_tables` (both `bills.js` canvases, after switching to the Budget subtab's Charts tab), so this doesn't silently regress again. This is the single highest-severity, most durable-value finding from this pass — it's real, static, and would otherwise keep evading both the live-DOM audit script and the existing test suite indefinitely, since neither visits these UI states.

---

## Lighthouse

A Lighthouse CI run (`lhci collect` against `http://localhost:32900/` and `http://localhost:32900/guide.html`) was launched alongside this audit but **did not produce a usable report**. Per `[scratchpad]/lighthouse.log`: Run #1 completed all of its accessibility audits (the log shows every a11y-category audit — ARIA roles/names, color contrast, heading order, landmark usage, tab order, form labels, etc. — running to completion around `2026-09-03T02:13:21`) and reached "Generating results...", but then crashed with `Error: EPERM, Permission denied: ...\lighthouse.36574139` while `chrome-launcher` tried to clean up its Chrome temp profile directory during shutdown (`taskkill` also failed to find the already-exited Chrome PID first). This is a Windows-specific `chrome-launcher`/npx-cache tmpdir-cleanup bug, unrelated to MyFinances application code, and it aborted before any score or JSON report was written to `.lighthouseci/` (only a `flags-*.json` config-echo file exists there). **No Lighthouse accessibility score is available for this pass.**

**Recommendation (tooling, not app code):** Re-run `lhci` outside this sandboxed/agent shell (a plain interactive terminal, or with the temp dir cleanup issue worked around, e.g. `--chrome-flags="--no-sandbox"` or a non-conflicting `--user-data-dir`) if a Lighthouse accessibility score is wanted for this cycle. Not blocking for this report, since the Playwright-based audit already covers the ARIA/contrast/structure ground Lighthouse's a11y category checks.

---

## Known tool limitations (already filtered, not re-litigated here)

Same two filters as the 2026-06-19 report, both still confirmed applicable:

- `_is_gradient_header_false_positive` (`ratio <= 1.05`) — filters the recurring `header-icon-btn`/`H1`/`page-button.active` "ratio: 1" readings across every page (light and dark), which reflect the contrast script's inability to composite translucent overlay backgrounds against the header gradient, not real failures. Still present, still consistent, still filtered correctly.
- `_is_dynamic_modal_title_false_positive` (`#spendingDrilldownModal` → `#spendingDrilldownTitle`) — the drilldown modal's title element only exists once a user opens a spending drilldown; every page load correctly shows this as a "dangling" ref in the closed/static DOM. Still present on every page in this run, still not a real defect.

---

## What's verified clean since the 2026-06-19 report

- Structural checks (headings, orphaned inputs, unnamed interactive elements, image alt text, duplicate IDs, dangling ARIA refs) are unchanged and clean across all 10 pages, both themes, and guide.html.
- Update Balance and Amortization modal focus/Escape/Tab-trap/focus-restore behavior is unchanged and correct.
- Mobile nav `aria-expanded` toggle behavior is unchanged and correct.
- `console_errors` is empty across the full run (no JS errors surfaced while seeding data, switching pages/themes, opening modals, or the mobile pass).
- `guide.html` remains structurally clean (headings, ARIA, duplicate IDs); its 2 contrast "findings" are the same `ratio: 1` gradient-header artifact as before, not new.

## Conclusion

No new Serious live-DOM defects surfaced from the automated walk itself — that surface area (structure, contrast, dangling ARIA, orphaned inputs, modal Escape behavior, mobile nav) remains as clean as the June 19 pass reported. Going beyond the live-DOM walk into static source review, this pass found two findings worth prioritizing: **F4** (7 Chart.js canvases with no screen-reader data-table fallback, on the Strategy/Plan and Budget cash-flow pages — Serious, WCAG 1.1.1) and **F3** (3 of 6 modal dialogs missing a Tab focus-trap, 2 of them also missing focus-restore, including the app-wide delete-confirmation modal — Moderate, WCAG 2.4.3). Both are durable gaps that neither the audit script nor the existing pytest suite currently has any way to detect, since neither visits the UI states (Strategy Chart tab, Budget Charts tab, Tab-cycling inside Reconcile/Delete-Confirm/Account-Replacement modals) where they're observable. F1 (dark-mode nav-group-label contrast) and F2 (mobile Print button tap target) are minor/needs-verification items, not blocking. Lighthouse could not be run to completion this pass due to an unrelated Windows tooling bug.

**Recommended priority for remediation:** F4 (Serious, high durable value) > F3 (Moderate, high blast radius since `showDeleteConfirmModal` is app-wide) > F1 (verify first — may be a non-issue) > F2 (out of WCAG 2.1 AA scope, low priority).
