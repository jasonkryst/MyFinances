# MyFinances Accessibility (A11y) Audit Report — 2026-06-19

**Date:** 2026-06-19
**Scope:** Full app — all 10 SPA pages (Health, Accounts, Income, Liabilities, Recurring, Savings, Strategy, Reports, Ledger, Reconcile), light + dark mode, mobile viewport (375×667), 3 modals (Update Balance, Reconcile, Amortization), `guide.html`.
**Method:** Automated Playwright audit (`tests/a11y/run_a11y_audit.py`) against a seeded sample dataset, cross-checked against source (`styles.css`, `src/*.js`). Raw output: [`raw_findings_2026-06-19.json`](./raw_findings_2026-06-19.json). Supplemented by `pytest tests/a11y/ -v` (8 tests) and `pytest tests/ui/test_accessibility.py -v` (28 tests).
**Standard:** WCAG 2.1 AA.
**Prior report:** [`A11Y_AUDIT_REPORT.md`](./A11Y_AUDIT_REPORT.md) (2026-06-13). This is a fresh pass, not a copy-forward — substantial feature work shipped since (Spending Analysis, grouped main-nav redesign, grouped Reports tab bar, a dedicated `tests/a11y/` pytest suite, and a dark-mode contrast fix for `.rpt-tab-group-label`).

**No application code was changed as part of this audit.** One change *was* made to the audit tooling itself (`tests/a11y/run_a11y_audit.py`) to fix a script bug that was preventing the amortization modal from being exercised at all — see Finding A1.

---

## Summary

| Check | Result |
|---|---|
| Dangling ARIA references (all pages + guide) | 0 real findings |
| Duplicate IDs | 0 |
| Orphaned form inputs | 0 |
| Unnamed interactive elements | 0 |
| Images missing alt text | 0 |
| Site-wide color contrast (light + dark, all pages + guide) | 0 real findings |
| Mobile tap targets | 0 undersized |
| Mobile nav `aria-expanded` toggle | Correct |
| Update Balance modal focus + Escape | Correct |
| Reconcile modal focus + Escape | Correct |
| Amortization modal focus + Escape | Correct (after fixing the audit script — see A1) |
| `pytest tests/a11y/` | 8/8 passed |
| `pytest tests/ui/test_accessibility.py` | 28/28 passed |

The app is in good accessibility shape. There are no Serious or Moderate structural/contrast defects on this pass. One test-tooling bug was found and fixed, and one test-coverage gap is flagged below.

---

## A1 — [Tooling, fixed] Audit script couldn't reach the Amortization modal

**Severity:** N/A (test-tooling defect, not an app defect)

The automated script called `calculatePaymentPlanFromInputs()` then immediately tried to click `[data-amortization]` ("View" button) inside the Debt Summary results table. That button lives inside `#rPanel-debt-summary`, one of three tabs (`📊 Overview` / `📋 Debt Summary` / `📅 Schedule`) under `#resultsSection` (`index.html:545-580`, `role="tablist"`). Overview is the default-active tab, so the Debt Summary panel is `display:none` until its tab is clicked — the button existed in the DOM but had a `0×0` bounding rect, and Playwright's click correctly timed out waiting for it to become visible.

This was masking the modal's actual behavior in every prior automated run. Fixed by adding a click on `[data-rtab="debt-summary"]` before locating the button (`tests/a11y/run_a11y_audit.py`, in the amortization modal section). After the fix, the modal opens, traps Tab inside it, focuses `#closeAmortization` on open, and Escape correctly hides it and restores focus to the originating "View" button (confirmed by manual `getAttribute('data-amortization')` check on `document.activeElement` after Escape — the script's own `activeId` field reads `''` because that button has no `id`, which is a script-reporting quirk, not a missing-focus bug).

**No remediation needed in app code.** Recorded here so the next person investigating an "amortization modal click times out" report doesn't have to re-derive this.

---

## A2 — [Minor / test-coverage gap] Strategy results tab bar has no dedicated a11y test coverage

**Severity:** Minor (process gap, not a live defect)

`#resultsSection`'s `.results-tab-btn` tab bar (`role="tablist"`/`role="tab"`/`aria-selected`/`aria-controls`, wired in `src/ui.js:278-289`) is implemented correctly and dynamically updates `aria-selected` on click, the same pattern as the Reports tab bar. The Reports tab bar has 8 dedicated tests in `tests/ui/test_accessibility.py` (`test_reports_tab_buttons_have_role_tab`, `test_reports_active_tab_aria_selected_true`, `test_reports_tab_keyboard_focus_reachable`, `test_reports_active_tab_has_focus_visible_outline`, etc.) — the Strategy results tab bar has none. Nothing is currently broken, but a future regression (e.g. someone refactoring `renderDebtSummaryTable`) would go undetected.

**Recommendation:** Add a `test_results_tab_*` block to `tests/ui/test_accessibility.py` mirroring the existing Reports tab tests, scoped to `.results-tab-btn`/`.results-tab-panel`. Folded into the roadmap/test-audit follow-ups.

---

## Known tool limitations (already filtered, not re-litigated here)

These are mechanical artifacts of the audit script's contrast/ARIA detection, already excluded by `tests/a11y/test_a11y_audit.py`'s `_is_gradient_header_false_positive` (contrast `ratio <= 1.05`, from `getBg()` not compositing CSS gradients/translucent overlays against ancestors) and `_is_dynamic_modal_title_false_positive` (`#spendingDrilldownModal` → `#spendingDrilldownTitle`, an `aria-labelledby` target that only exists once the modal is actually opened). Confirmed both still apply cleanly on this pass with zero non-filtered findings remaining.

---

## What's verified clean since the 2026-06-13 report

- The dark-mode `.rpt-tab-group-label` contrast fix (`body.dark-mode .rpt-tab-group-label { color: #60a5fa; }`, added this cycle) holds in both themes — 0 contrast findings on the Reports page in light or dark mode.
- The grouped main-nav redesign (Overview/Manage/Analyze) and grouped Reports tab bar introduced no new dangling ARIA refs, duplicate IDs, or unnamed-interactive findings across any of the 10 pages.
- Spending Analysis page (new since the last audit) passes all structural and contrast checks.
- `guide.html` is clean: 0 findings across every category, in both themes.

## Conclusion

No Serious or Moderate WCAG 2.1 AA defects found in this pass. One audit-tooling bug fixed (A1); one test-coverage gap flagged for follow-up (A2). Recommend re-running this audit after any large UI restructuring (new tab bars, new modals) given how easily a tab-panel visibility gate can hide an element from a naive automated walk (see A1).
