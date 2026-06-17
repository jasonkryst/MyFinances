# Reports Nav Redesign — Design Spec

**Date**: June 16, 2026
**Status**: Approved
**Feature**: Grouped two-level tab nav for the Reports page

---

## Overview

Replace the flat 7-button horizontal scroll bar on the Reports page with a **two-level grouped nav**: a row of colored group chip badges above clusters of outlined chip/pill tab buttons. The nav is sticky so it stays visible as the user scrolls through report content.

---

## Visual Design

### Layout

```
┌─ sticky nav (page-bg, border-bottom) ─────────────────────────────────────┐
│  [● Activity]        [● Trends]          [● Planning]                      │
│  📅 Calendar  🏷️ Spending  📊 Income  │  💰 Flow  📈 What Changed  📉 NW  │  🔮 Forecast  │
└───────────────────────────────────────────────────────────────────────────┘
```

### Groups and membership

| Group | Tabs (in order) |
|---|---|
| Activity | 📅 Calendar, 🏷️ Spending, 📊 Income vs Expenses |
| Trends | 💰 Money Flow, 📈 What Changed, 📉 Net Worth |
| Planning | 🔮 Forecast |

### Tab button (chip/pill outline style)

- Border: `1px solid var(--border-color)` (inactive) / none (active)
- Border-radius: `999px`
- Padding: `8px 14px`
- Font size: `12px`, font-weight: `600`
- Inactive: background transparent, color `var(--text-muted)`
- Hover: background `var(--hover-bg)`, border-color lightens slightly
- Active: background `var(--primary-color)`, color `#fff`, border: none

### Group chip label

- Non-interactive `<span>` (not a button)
- Style: `font-size: 10px`, `font-weight: 700`, `letter-spacing: 0.06em`, `text-transform: uppercase`
- Background: `hsla(primary-hue, sat%, 56%, 0.10)`
- Border: `1px solid hsla(primary-hue, sat%, 56%, 0.25)`
- Border-radius: `999px`
- Padding: `2px 8px`
- Color: `var(--primary-color)` (slightly dimmed in light mode)
- When the active tab belongs to this group: chip is at full accent intensity; otherwise muted

### Group separator

Thin vertical rule (`1px solid var(--border-color)`, height `28px`, `align-self: center`) between group clusters. Uses `<div class="rpt-tab-group-sep">`.

### Spacing

- Gap between groups: `10px`
- Gap between tabs within a group: `4px`
- Group label to tabs gap: `6px` (margin-bottom on label)

### Sticky behavior

`.rpt-tab-bar` gets `position: sticky; top: 0; z-index: 20`. Background is set to `var(--bg-color)` (the page background) so report content scrolls cleanly underneath. A `border-bottom: 1px solid var(--border-color)` provides visual separation.

---

## HTML Changes (`index.html`)

Replace the existing flat `.rpt-tab-bar` contents with three `.rpt-tab-group` wrappers separated by `.rpt-tab-group-sep` dividers:

```html
<div class="rpt-tab-bar">
  <div class="rpt-tab-group">
    <span class="rpt-tab-group-label">Activity</span>
    <div class="rpt-tab-group-tabs">
      <button class="rpt-tab-btn rpt-tab-btn--active" data-rptab="calendar" aria-selected="true">📅 Calendar</button>
      <button class="rpt-tab-btn" data-rptab="spending" aria-selected="false">🏷️ Spending</button>
      <button class="rpt-tab-btn" data-rptab="incomeexp" aria-selected="false">📊 Income vs Expenses</button>
    </div>
  </div>
  <div class="rpt-tab-group-sep" aria-hidden="true"></div>
  <div class="rpt-tab-group">
    <span class="rpt-tab-group-label">Trends</span>
    <div class="rpt-tab-group-tabs">
      <button class="rpt-tab-btn" data-rptab="moneyflow" aria-selected="false">💰 Money Flow</button>
      <button class="rpt-tab-btn" data-rptab="variance" aria-selected="false">📈 What Changed</button>
      <button class="rpt-tab-btn" data-rptab="networth" aria-selected="false">📉 Net Worth</button>
    </div>
  </div>
  <div class="rpt-tab-group-sep" aria-hidden="true"></div>
  <div class="rpt-tab-group">
    <span class="rpt-tab-group-label">Planning</span>
    <div class="rpt-tab-group-tabs">
      <button class="rpt-tab-btn" data-rptab="forecast" aria-selected="false">🔮 Forecast</button>
    </div>
  </div>
</div>
```

`data-rptab` values are **unchanged** — this is the only attribute `switchTab` in `ui.js` queries. No JS changes are needed.

---

## CSS Changes (`styles.css`)

Replace the existing `.rpt-tab-bar`, `.rpt-tab-btn`, `.rpt-tab-btn--active` rules (and mobile override) with:

```css
/* ── CSS variable additions (add inside :root and body.dark-mode blocks) ── */
/* :root */         /* --primary-hsl: 217 89% 61%; */
/* body.dark-mode *//* --primary-hsl: 213 93% 68%; */

/* ── Reports tab bar — grouped chip nav ─────────────────────────────────── */
.rpt-tab-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 10px 0 10px;
    border-bottom: 1px solid var(--border-color);
    position: sticky;
    top: 0;
    z-index: 20;
    background: white;          /* light mode: .container bg is white */
}
body.dark-mode .rpt-tab-bar {
    background: var(--bg-color); /* #0f172a — defined in dark-mode block */
}

.rpt-tab-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.rpt-tab-group-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: 999px;
    background: hsla(var(--primary-hsl), 0.10);
    border: 1px solid hsla(var(--primary-hsl), 0.25);
    color: var(--primary-color);
    align-self: flex-start;
    opacity: 0.55;
    transition: opacity 0.15s;
}
.rpt-tab-group:has(.rpt-tab-btn--active) .rpt-tab-group-label {
    opacity: 1;
}

.rpt-tab-group-tabs {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
}

.rpt-tab-btn {
    padding: 8px 14px;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.rpt-tab-btn:hover {
    background: var(--light-bg);   /* #f8fafc light / #1e293b dark — already defined */
    color: var(--text-primary);
    border-color: var(--primary-color);
}
.rpt-tab-btn--active {
    background: var(--primary-color);
    color: #fff;
    border-color: var(--primary-color);
}
body.dark-mode .rpt-tab-btn--active {
    background: #60a5fa;    /* blue-400 — matches existing dark-mode accent usage */
    border-color: #60a5fa;
    color: #0f172a;         /* dark text on light-blue chip for contrast */
}
body.dark-mode .rpt-tab-btn:hover {
    background: #1e293b;
    color: #e2e8f0;
}

.rpt-tab-group-sep {
    width: 1px;
    height: 28px;
    background: var(--border-color);
    align-self: flex-end;
    margin-bottom: 2px;
    flex-shrink: 0;
}

/* ── Tab panels (unchanged) ─────────────────────────────────────────────── */
.rpt-tab-panel { display: none; padding: 24px 0 0; }
.rpt-tab-panel--active { display: block; }

@media (max-width: 640px) {
    .rpt-tab-bar { flex-wrap: nowrap; overflow-x: auto; gap: 8px; padding-bottom: 10px; }
    .rpt-tab-group-sep { display: none; }
}
```

### CSS variable additions

Add `--primary-hsl` to the existing `:root` block (after `--primary-color`) and to the `body.dark-mode` block:

```css
/* In :root { } */
--primary-hsl: 217 89% 61%;   /* matches --primary-color: #2563eb */

/* In body.dark-mode { } */
--primary-hsl: 213 93% 68%;   /* matches dark-mode accent #60a5fa */
```

`--primary-hsl` is a raw `h s% l%` triplet (no `hsl()` wrapper) so it can be used inside `hsla(var(--primary-hsl), alpha)`.

### Sticky and `overflow: hidden` note

`.container` has `overflow: hidden` (for border-radius clipping). In practice this does not create a scroll container — scrolling happens on `body` — so `position: sticky` should work without changes. If sticky is clipped unexpectedly during testing, change `.container` to `overflow: clip` (which preserves clipping without creating a scroll container) as a one-line fix.

---

## JS Changes (`ui.js`)

**None.** The `switchTab` function queries `[data-rptab]` and toggles `rpt-tab-btn--active` — the new group wrapper `<div>`s are transparent to that selector. The `aria-selected` attribute update also remains correct.

---

## Dark Mode

- `.rpt-tab-bar` sticky background uses `var(--bg-color)` which already switches correctly
- Active tab uses hardcoded `#6366f1` (indigo-500) in dark mode for consistent contrast — same as the existing dark-mode rule
- Group label chip inherits accent at 10% alpha; the muted/active opacity toggle works in both modes

---

## Accessibility

- `aria-selected` remains on each `<button>` (already present, unchanged)
- Group labels are `<span>` not `<button>` — they carry no interactive role
- `aria-hidden="true"` on `.rpt-tab-group-sep` so screen readers skip decorative dividers
- Tab focus order is natural left-to-right across all three groups

---

## Testing

### Existing tests (must still pass)

All existing `tests/ui/test_spending_ui.py` tests navigate to the Spending tab via `page.click('[data-rptab="spending"]')` — the attribute is unchanged so these pass without modification.

### New tests — `tests/ui/test_reports_nav.py`

- `test_reports_nav_groups_exist` — three `.rpt-tab-group` elements are present in the DOM
- `test_reports_nav_group_labels` — group labels contain "Activity", "Trends", "Planning"
- `test_reports_nav_active_group_label_highlighted` — when "Money Flow" is active, the Trends group label has full opacity (`.rpt-tab-group:has(.rpt-tab-btn--active) .rpt-tab-group-label`)
- `test_reports_nav_tab_switching_still_works` — clicking each tab activates its panel (regression coverage of the existing switch logic)
- `test_reports_nav_sticky_class` — `.rpt-tab-bar` has `position: sticky` in computed styles

---

## Files Changed

| File | Change |
|---|---|
| `index.html` | Replace flat tab buttons with grouped structure (no new panels, no data-rptab changes) |
| `styles.css` | Replace `.rpt-tab-bar` / `.rpt-tab-btn` / `.rpt-tab-btn--active` / mobile rules; add group/sep/label rules; add `--primary-hsl` vars |
| `src/utils.js` | Bump `APP_VERSION` from `'3.6.0'` to `'3.6.1'` |
| `tests/ui/test_reports_nav.py` | New file — 5 tests |

No changes to `src/ui.js`, `src/reports.js`, or any other JS module.
