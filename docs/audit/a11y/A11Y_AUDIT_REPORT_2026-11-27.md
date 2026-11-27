# Accessibility Audit: v8.8.6 (2026-11-27)

**Baseline:** [A11Y_AUDIT_REPORT_2026-11-04.md](A11Y_AUDIT_REPORT_2026-11-04.md) (0 Critical / 7 Major / 14 Minor).
**Method:** static review of `index.html`, `styles.css` and `src/`, plus a re-check of the previous findings by code. **No axe-core run, no keyboard walk, no screen-reader session and no measured contrast this pass**, so anything that depends on a rendered value is marked "needs measurement". The CI suites (`tests/a11y/`, `tests/ui/test_a11y_gates_focus.py`, `test_contrast_fixes.py`, `test_label_in_name.py`, `test_chart_accessibility.py`, `test_mobile_no_card_clipping.py`) are the standing guard.

## Summary

| | Count |
|---|---|
| Previous findings re-checked in code | 8 |
| Verified resolved | 7 |
| Not re-measured (need a browser) | the remaining 2026-11-04 items (P2 to P6, O2 to O5, O8, R1, R2, R4) |
| New findings | 1 (Low to Medium, needs measurement) |

## Verified resolved since 2026-11-04

| Prior | Check | Evidence |
|---|---|---|
| U1 `<html lang>` never updated | `document.documentElement.lang = currentLocale` | `src/i18n.js:111` |
| U2 account-menu strings English | button carries `data-i18n-attr="title:accountMenu.title,aria-label:accountMenu.ariaLabel"` | `index.html:93` |
| U3 login errors not linked to fields | `markFieldInvalid` used by 16 call sites | `src/` |
| R3 `role="alert"` with `aria-live="polite"` | 0 occurrences of the pair | `index.html` |
| O6 account menu has no menu keyboard model | ArrowDown opens and moves focus, ArrowUp/Down cycle | `src/ui.js:663-667` |
| P1 dark-mode error text contrast | `--danger-text: #f87171` (5.3:1 on `#1e293b`) in dark, `#dc2626` in light | `styles.css:877,1096` |
| O1 / O7 no focus containment | `makeBackgroundInert` used in 5 modules; `test_a11y_gates_focus.py` guards gates | `src/` |

## Positive static checks

- 0 inline `style="..."` attributes, 0 `<img>` without `alt`, 0 `tabindex` above 0 in `index.html`.
- `prefers-reduced-motion` and `forced-colors` blocks exist in `styles.css`.
- Viewport meta does not disable zoom.
- Login gate is a `role="dialog"` with `aria-modal`, `aria-labelledby` and `aria-describedby`.
- ACCESSIBILITY.md's only listed limitation (#505, untranslated chrome) is still accurate.

## New finding

### A11Y-01 (Low to Medium, WCAG 1.4.3): opacity-dimmed content
CLAUDE.md says "don't dim text with `opacity`". `styles.css` has 21 `opacity: 0.x` declarations. Most are hover or disabled states, but these dim a whole card and therefore all text inside it:

| Selector | Opacity | Line |
|---|---|---|
| `.acct-card--archived` | 0.65 | 6363 |
| `.sinking-card--archived` | 0.65 | 7038 |
| `.recurring-card--paused` | 0.6 | 6696 |
| `.recurring-card--archived` | 0.55 | 6808 |
| `.recurring-pause-resume-note` | 0.85 | 6806 |
| `.bonus-filter-nav:disabled` | 0.3 | 4531 |

At 0.55 to 0.65 body text on a white or dark card almost certainly falls below 4.5:1. Archived and paused items are still read by users (the toggle to show them exists), so this is a real barrier, not only a disabled state.
**Fix:** replace card-level opacity with explicit muted colour tokens that were measured with `tests/ui/contrast_utils.py`, keeping a non-colour cue (badge text "Archived"/"Paused"). Add a `test_contrast_fixes.py` case per state in both themes.
**Confidence:** high that the rule is broken; contrast value needs measurement.

## Not covered this pass
Manual screen-reader testing (still listed as "not yet tested by hand" in ACCESSIBILITY.md), Firefox/Safari, and the touch-target measurements (`test_phone_polish.py` covers dialog close buttons, Health links and checkboxes). A manual NVDA or VoiceOver walk of the phone tab bar and More sheet (8.8.0) is the most valuable next step; the routing and overlay changes since 7.0.0 are the biggest unreviewed accessibility surface.
