# MyFinances Accessibility (A11y) Audit Report

**Date:** 2026-06-13
**Scope:** Full app — all 10 SPA pages (Health, Accounts, Income, Liabilities, Recurring, Savings, Strategy, Reports, Ledger, Reconcile), light + dark mode, mobile viewport (375×667), 3 modals (Update Balance, Reconcile, Amortization), `guide.html`
**Method:** Automated Playwright audit (`run_a11y_audit.py`) against a seeded sample dataset covering every persisted data category, cross-checked against source (`styles.css`, `src/*.js`). Raw automated output: [`raw_findings.json`](./raw_findings.json).
**Standard:** WCAG 2.1 AA (4.5:1 contrast for normal text, 3:1 for large text ≥18px or ≥14px bold, 3:1 for non-text UI components per 1.4.11)

## How to read this report

Findings are grouped by priority. Each item lists the affected location(s), the relevant WCAG criterion, the evidence from the audit, and a remediation suggestion. **No code has been changed** — this report is for review and prioritization. Nothing here should be treated as a queue; pick whichever items matter most and let me know what you'd like fixed first.

---

## Summary

| Priority | Count | Theme |
|---|---|---|
| Serious | 5 | Modal keyboard behavior, site-wide text contrast (footer, success buttons, calendar pills, dark mode) |
| Moderate | 3 | Missing skip link, mobile tap targets, light-mode borderline contrast |
| Minor | 2 | Near-miss contrast ratios, header icon opacity |
| Informational | 3 | Amortization modal not exercised by script, CSP console warning, X-Frame-Options meta tag |
| False positives | 1 (affects every page) | Header "white-on-white" contrast — script artifact, not a real issue |

The good news: heading hierarchy, form labels, ARIA references, image alt text, duplicate IDs, landmarks, and the mobile nav toggle were **all clean** across every page and `guide.html`. The Reconcile modal's focus/keyboard handling is a model for the rest of the app.

---

## Serious

### S1. Update Balance modal has no Escape-to-close and no focus trap
**Location:** `src/debts.js:99-132` (`showUpdateBalanceModal`)
**WCAG:** 2.1.2 (No Keyboard Trap), 2.4.3 (Focus Order), consistency with 2.1.1 (Keyboard)

When opened, focus correctly moves to `#updateBalanceInput`, but:
- Pressing `Escape` does **not** close the modal (`modalHidden: false` before and after in the audit).
- There is no `keydown` listener trapping `Tab`/`Shift+Tab` inside the modal, so keyboard focus can leave the modal into the page behind it while the modal is still visually open and `aria-modal="true"`.

This is inconsistent with the other two modals in the app:
- **Reconcile modal** closes on `Escape` (verified, `tests/ui/test_accessibility.py::test_reconcile_modal_focus_and_keyboard_trap`).
- **Amortization modal** (`src/ui.js:346-383`) implements a full pattern: focus moves to the close button on open, `Escape` closes and returns focus to the trigger, and `Tab`/`Shift+Tab` are trapped within the modal's focusable elements.

**Remediation:** Add the same pattern used for the amortization modal (`src/ui.js:351-369`) to `updateBalanceModal` — a `keydown` listener for `Escape` (call the existing `close()` defined at `debts.js:120`) and a `Tab` focus trap between the modal's first/last focusable elements, plus restoring focus to the triggering "Update Balance" button on close.

---

### S2. Footer version tag fails contrast in both themes (site-wide)
**Location:** `styles.css:4897-4909` (`.app-footer`, `body.dark-mode .app-footer`), rendered via `#appVersion` (`index.html:786`, set in `src/app.js:139-140`)
**WCAG:** 1.4.3 Contrast (Minimum)

The `v3.3.0` tag at the bottom of every page uses:
- Light mode: `color: #9ca3af` on white → **2.54:1** (needs 4.5:1)
- Dark mode: `color: #64748b` on the dark surface → **3.15:1** (needs 4.5:1)

This is the single most repeated contrast failure in the audit — it appears on all 10 pages in both themes.

**Remediation:** Darken the light-mode color (e.g., `#6b7280` ≈ 4.6:1 on white, or `#4b5563` for more margin) and lighten the dark-mode color (e.g., `#94a3b8` ≈ 4.6:1+ on the dark surfaces used here). Since this is purely decorative version text, an alternative is to mark it `aria-hidden="true"` if it's not meant to be informative to AT users — but it should still be legible for sighted users, so a color fix is the better primary fix.

---

### S3. Calendar event "pills" — white text on category colors fails contrast (Strategy & Reports calendar)
**Location:** `styles.css:1289-1299` (`.cal-event`, `color: #fff` on `background: var(--event-bg, #2563eb)`); colors assigned per-debt from the palette in `src/strategy.js:270-273` (`#2563eb, #dc2626, #d97706, #7c3aed, #db2777, #0891b2, #65a30d, #ea580c, #6366f1`) and applied via `data-event-bg`/`--event-bg` (`src/strategy.js:379-384, 407-408`)
**WCAG:** 1.4.3 Contrast (Minimum) — `.cal-event-name`/`.cal-event-amount` render at ~10.9px (`0.68rem`), which does **not** qualify as "large text" even at `font-weight: 600/700`, so 4.5:1 applies.

The audit measured white text against several of these palette colors and found most fail:

| Background | Ratio | Pass 4.5:1? |
|---|---|---|
| `#f59e0b` (amber) | 2.15 | ✗ |
| `#06b6d4` (cyan) | 2.43 | ✗ |
| `#10b981` (green) | 2.54 | ✗ |
| `#d97706` (orange) | 3.19 | ✗ |
| `#8b5cf6` (purple) | 4.23 | ✗ (close) |

Only the darkest colors in the palette (e.g., `#2563eb`, `#dc2626`) are likely to pass. This affects the per-debt color-coded payment pills on the Strategy page's payment calendar and the equivalent view on Reports.

**Remediation:** Either (a) replace the palette with darker shades that all reach ≥4.5:1 against white (e.g., shift amber→`#b45309`, cyan→`#0e7490`, green→`#047857`, orange→`#9a3412`), or (b) increase the pill font size to ≥14px and bump to `font-weight: 700` so the 3:1 "large text" threshold applies (still fails for amber/cyan/green at that threshold too, so option (a) is more robust), or (c) keep the palette for the *border/accent* only and use a consistent dark text color (e.g., `--text-primary`) with a light tint of the category color as background.

---

### S4. `.btn-success` (white-on-green) fails contrast for normal text — used on primary action buttons throughout the app
**Location:** `styles.css:1538-1541`
```css
.btn-success {
    background: var(--success-color); /* #16a34a */
    color: white;
}
```
**WCAG:** 1.4.3 Contrast (Minimum)

White text on `#16a34a` measures **3.3:1**, below the 4.5:1 required for normal-size button text (these buttons use the default ~14-15px body font, not large text). This class is used for primary "success" actions across the app (e.g., "Add Account", "Add Income", "Calculate Payment Plan" — wherever `.btn.btn-success` appears).

**Remediation:** Darken `--success-color` for button backgrounds specifically (e.g., `#15803d`, which is already defined as `--success-hover` and measures ~4.5:1+ with white text), or keep `#16a34a` for non-text uses (badges, icons) and introduce a separate `--success-btn-bg` darker shade for `.btn-success`.

---

### S5. Dark mode: multiple widgets fall below contrast thresholds
**WCAG:** 1.4.3 Contrast (Minimum) / 1.4.11 (for "large text" cases at 3:1)

The audit's dark-mode pass found a cluster of related failures, all following the same pattern — a color from the *light-mode* palette (often `--primary-color: #2563eb` or a success/green shade) reused as-is on a dark surface, where it no longer has enough contrast:

| Page | Element | Colors | Ratio | Threshold |
|---|---|---|---|---|
| Health | "Manage debts →" link | `#2563eb` on `#1e293b` | 2.83 | 4.5 (normal text) |
| Health | "+$5,960.00" cashflow figure (large) | `#16a34a` on `#14532d` | 2.76 | 3.0 (large text) |
| Accounts | Net worth widget delta ("+$6,436.01 vs last snapshot") | `#15803d` on `#23272f` | 2.98 | 4.5 |
| Liabilities | "≈ $80.09/mo" monthly interest | `#6b7280` on `#1e293b` | 3.03 | 4.5 |
| Liabilities | Debt overview stat values (large) | `#2563eb` on `#1e293b` | 2.83 | 3.0 (large text) |
| Reports | Calendar "13" day number | `#2563eb` on `#1e3a5f` | 2.23 | 4.5 |
| Reports | Active "Calendar" tab label | `#2563eb` on `#23272f` | 2.90 | 4.5 |
| Reconcile | `<summary>` "Expected transactions since…" | `#2563eb` on `#1e293b` | 2.83 | 4.5 |
| Strategy/Health | "Run a plan to see…" muted helper text | `#64748b` on dark surface | 3.07 | 4.5 |

(Exact selectors weren't individually traced for every row above, but they share the same root cause.)

**Remediation:** Introduce dark-mode-specific accent colors rather than reusing the light-mode `--primary-color`/`--success-color` directly. A common pattern is to define `--primary-color-dark: #60a5fa` (a lighter blue, ~7:1+ on `#1e293b`/`#23272f`) and `--success-color-dark: #4ade80`/`#34d399`, then apply them under `body.dark-mode` for text/links/active-tab states (background fills like progress bars can keep darker tones since they're not text). This is the same approach already used in a few places (e.g., `body.dark-mode .app-footer { color: #64748b; }`) but needs to be applied more consistently — and that particular value (`#64748b`) is itself one of the failures (S2).

---

## Moderate

### M1. No skip-to-content link
**Location:** `index.html` (no `<a href="#main">`/`<a href="#content">` found anywhere)
**WCAG:** 2.4.1 Bypass Blocks

The tab-order check (starting from the Accounts page) goes: `exportJsonBtn → importJsonBtn → themeSwitcher → helpBtn → Health → Accounts → Income → Liabilities → …`. A keyboard or screen-reader user must tab through all 4 header icon buttons and then **all 10 primary navigation buttons** before reaching the page's actual content — on every page.

**Remediation:** Add a visually-hidden "Skip to main content" link as the first focusable element in `index.html`, targeting the `<main>` element (e.g., `<a href="#main" class="skip-link">Skip to main content</a>` with CSS that makes it visible only on focus). `tests/ui/test_accessibility.py::test_skip_link` already has a placeholder check (`a[href="#main"], a[href="#content"]`) that would start meaningfully passing once this exists.

---

### M2. Mobile header icon buttons are 36×36px — below the app's own 44px standard
**Location:** `styles.css:2279-2282` (mobile media query override for `.header-icon-btn`)

At the 375×667 mobile viewport, `#exportJsonBtn`, `#importJsonBtn`, and `#themeSwitcher` are 36×36px. This still clears the WCAG 2.2 AA 2.5.8 minimum (24×24px) but falls short of:
- The 44×44px "Touch-Friendly" standard the project documents for itself (per README/ROADMAP mobile-nav notes), and
- The 48×48px target recommended by web.dev/Material guidance.

`#helpBtn` and the primary nav buttons were not flagged, so this is isolated to the three header toolbar icons.

**Remediation:** Bump `.header-icon-btn` to at least 40px (ideally 44px) in the mobile media query, adjusting `.header-toolbar` gap/padding as needed to keep them from wrapping.

---

### M3. Light-mode borderline contrast on a few specific elements
**WCAG:** 1.4.3 Contrast (Minimum)

| Page | Element | Colors | Ratio | Threshold |
|---|---|---|---|---|
| Health | "$8,500.00" income figure | `#16a34a` (`.health-cf-income`, `styles.css:5037`) on white | 3.30 | 4.5 |
| Income | "✅ Included in this month's income" badge | `#16a34a` on `#f0fdf4` | 3.15 | 4.5 |
| Liabilities | "since Jan 2024" sub-label (`.iptd-sub`, `styles.css:2613-2618`) | `#9ca3af` on `#f8fafc` | 2.43 | 4.5 |

`.iptd-sub` uses the same `#9ca3af` gray as the footer (S2) — fixing that color globally (e.g., introducing a slightly darker shared "muted" token) would resolve both at once.

**Remediation:** For the green income figures, `--success-hover` (`#15803d`) reaches ~4.7:1 on white and ~5.4:1 on `#f0fdf4` — reuse it for text instead of `#16a34a`. For `.iptd-sub`, see S2's remediation for the shared gray token.

---

## Minor

### N1. Header icon button color is a borderline pass for non-text contrast
**Location:** `styles.css:923-957` (`.header-icon-btn`, `color: rgba(255,255,255,0.70)` / dark mode `rgba(255,255,255,0.55)`)

The audit's automated script reported these as "ratio 1 (white-on-white)" — that's a **false positive** (see below). Computing it properly against the actual header gradient background (`#2563eb` → `#1d4ed8`, `styles.css:894-899`), `rgba(255,255,255,0.70)` measures **≈3.3:1**, which just clears the 3:1 non-text-contrast requirement (WCAG 1.4.11) for icon buttons. The dark-mode value (`rgba(255,255,255,0.55)`) is lower still and worth checking with a similar calculation.

**Remediation:** Optional — bump to `rgba(255,255,255,0.80)` (light) / `rgba(255,255,255,0.70)` (dark) for more margin. Low priority since both currently pass or are very close.

### N2. Two near-miss "large text" contrast ratios
- Strategy (light mode): "$5,960.00" green-on-light-green = **4.42** vs 4.5 required.
- Health (dark mode): "$8,500.00" green-on-dark-green = **4.44** vs 4.5 required.

Both are within 0.1 of passing and likely imperceptible. If S5's dark-mode green token or S4's `.btn-success` fix touches these same colors, double-check these two pass afterward — otherwise low priority on their own.

---

## Informational / Follow-ups

### I1. Amortization modal not exercised by the automated script
The script's click on `[data-amortization]` (the "View" button in the Debt Summary table, `src/strategy.js:679, 699-704`) timed out — the element wasn't visible/interactable in the harness, likely because the Debt Summary table requires the Strategy page's payment plan to be calculated and a specific tab/section active before the row renders.

However, a source review of the modal's handler (`src/ui.js:346-383`) shows it already implements the **same robust pattern** recommended as the fix for S1: focus moves to the close button on open, `Escape` closes and restores focus to the trigger, and `Tab`/`Shift+Tab` are trapped within the modal. This modal is likely fine — recommend a quick manual click-through (Strategy page → calculate a plan → Debt Summary tab → "View" on a debt → Tab/Escape) to confirm, but it's not currently believed to be a problem.

### I2. CSP `style-src 'self'` inline-style violation (console, 2 occurrences)
Two identical console errors were captured during the audit:
> "Applying inline style violates the following Content Security Policy directive: style-src 'self'" (hash `sha256-mVQ9uH067TIY+PyNplvYkzHPbsrnOXHX/IPZupV7LbY=`)

The app makes heavy use of `element.style.setProperty(...)` for progress bars, calendar event colors, and confetti animations (`src/debts.js:450`, `src/health.js:339`, `src/savings.js:35`, `src/strategy.js:408`, `src/ui.js:589-596`) — these are CSSOM property writes, which generally don't trigger `style-src` violations in Chromium. The two errors share one specific hash, suggesting a single `<style>` element or `style="..."` attribute somewhere with fixed content (possibly injected by the Chart.js CDN bundle, or a one-time setup path not covered by the seeded sample data). This didn't surface as a visible a11y defect in the audit, but it's worth a follow-up to identify the source — if it's blocking a style that affects focus indicators or visibility toggles, it could become an a11y issue. **Not prioritized in this report; flagged for awareness.**

### I3. `X-Frame-Options` set via `<meta>` tag has no effect (console warning, 2 occurrences)
> "X-Frame-Options may only be set via an HTTP header sent along with a document. It may not be set inside `<meta>`."

This is a **security** header issue, not an accessibility one — `X-Frame-Options` must be sent as an HTTP response header by the server to provide clickjacking protection; the `<meta>` tag version is silently ignored by browsers. Mentioned here only because it appeared during the audit; not in scope for this report's prioritization.

---

## False Positives (no action needed)

### F1. "White text on white background (ratio 1)" — header H1, icon buttons, help link, on every page and `guide.html`, light AND dark mode
The automated contrast script's `getBg()` helper walks up the DOM checking only `getComputedStyle(el).backgroundColor`, and does not account for `background-image` (CSS gradients). Both `index.html`'s `<header>` (`styles.css:894-899`) and `guide.html`'s `.guide-header` (`guide.html` inline `<style>`, line ~55-60) use:
```css
background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
color: #ffffff; /* (or rgba(255,255,255,*) for icon buttons) */
```
Since no ancestor sets a plain `background-color`, the script fell through to the page's white background and reported `ratio: 1`. Computing white text against the actual gradient stops:
- White on `#2563eb` ≈ **5.2:1** (passes 4.5:1)
- White on `#1d4ed8` ≈ **6.7:1** (passes 4.5:1)

The H1 ("MyFinances" / "MyFinances Usage Guide") and the help link text are **not** a real contrast problem. The header *icon buttons* (`rgba(255,255,255,0.70)`) are addressed separately in N1, since their reduced opacity does meaningfully lower the ratio (to ~3.3:1).

**No action needed for the H1/help-link instances of this finding.** If you want the audit script itself fixed for future runs, `getBg()` would need to detect `background-image`/`background` shorthand and either skip those elements or sample via screenshot pixel color.

---

## Clean areas (no issues found)

Across all 10 pages, both themes, mobile, and `guide.html`:
- **Heading hierarchy** — no skipped levels; `guide.html` has an exemplary 58-heading h1→h4 structure.
- **Form labels** — no orphaned inputs (the Reconcile card's label associations are a good reference pattern).
- **Interactive element names** — no unnamed buttons/links/controls.
- **Images** — none missing `alt` (the app uses emoji/icon glyphs, not `<img>`, for iconography).
- **ARIA references** — no dangling `aria-labelledby`/`aria-describedby`/`aria-controls` targets.
- **Duplicate IDs** — none across any page's rendered DOM.
- **Landmarks** — both `index.html` and `guide.html` have `lang="en"`, a `<main>`, exactly one `<nav>`, and exactly one `<h1>`.
- **Mobile nav toggle** — `#navToggle`'s `aria-expanded` correctly flips `false → true` and `#navMenu` becomes visible.
- **Reconcile modal** — focus moves to `#reconcileModalBalance` on open, `Escape` closes it, matching `tests/ui/test_accessibility.py::test_reconcile_modal_focus_and_keyboard_trap`.

---

## Suggested next step

This report doesn't prescribe an order — happy to tackle whichever of these you'd like, in any combination (e.g., "just the Serious items," "start with S1 and S4," "fix the shared gray token used in S2/M3 first since it's one change with wide impact," etc.). Let me know how you'd like to proceed.
