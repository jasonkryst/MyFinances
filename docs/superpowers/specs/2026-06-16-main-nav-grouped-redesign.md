# Main Nav Grouped Redesign — Design Spec

**Date**: June 16, 2026  
**Status**: Approved  
**Feature**: Replace flat 10-button main nav with three grouped clusters + full A11y

---

## Overview

The current `.top-nav` bar renders 10 page-buttons with `flex: 1; max-width: 160px`, which stretches them to fill the entire header width on desktop — making the nav feel unnecessarily wide. The redesign organises the 10 pages into three labeled groups (**Overview · Manage · Analyze**) using the same pill-badge label pattern established for the Reports tab bar, while adding the a11y attributes the current nav is missing.

---

## Groups and Membership

| Group | Pages (in order) |
|---|---|
| Overview | Health, Accounts, Income |
| Manage | Liabilities, Recurring, Savings, Plan |
| Analyze | Reports, Ledger, Reconcile |

---

## Visual Design

### Layout

```
┌─ nav (rgba(0,0,0,.18) overlay, border-top) ──────────────────────────────┐
│  [● Overview]              [● Manage]                 [● Analyze]         │
│  Health  Accounts  Income │ Liabilities Recurring Savings Plan │ Reports Ledger Reconcile │
└──────────────────────────────────────────────────────────────────────────┘
```

### Group structure
Each group is a `<div class="nav-group">` containing:
1. A `<span class="nav-group-label">` pill badge (non-interactive)
2. A `<div class="nav-group-btns">` row of `.page-button` elements

### Group pill badge (label)

- `font-size: 9px`, `font-weight: 700`, `letter-spacing: 0.07em`, `text-transform: uppercase`
- `padding: 2px 8px`, `border-radius: 999px`
- **Active group** (contains the active page): `background: rgba(255,255,255,0.90)`, `color: #1e40af` (blue-800)
- **Inactive group**: `background: rgba(255,255,255,0.18)`, `color: rgba(255,255,255,0.60)`
- Transition: `opacity 0.15s`, no size change
- Implemented via `nav-group:has(.page-button.active) .nav-group-label` (no JS required)

### Page button

- `padding: 6px 11px` (reduced from `12px 16px`)
- `font-size: 11px` (was `0.88rem` ≈ 14px)
- `font-weight: 600`
- `border-radius: 4px`
- `background: transparent`, `border: none`, `border-bottom: 2px solid transparent`
- Inactive: `color: rgba(255,255,255,0.65)`
- Hover: `color: #fff`, `background: rgba(255,255,255,0.10)`, `border-bottom-color: rgba(255,255,255,0.40)`
- Active: `color: #fff`, `background: rgba(255,255,255,0.15)`, `border-bottom: 2px solid #fff`
- **No** `flex: 1` — buttons are only as wide as their label
- `:focus-visible`: `outline: 2px solid rgba(255,255,255,0.80)`, `outline-offset: 2px`

### Group separator

`<div class="nav-group-sep" aria-hidden="true">` — `width: 1px`, `height: 30px`, `background: rgba(255,255,255,0.18)`, `align-self: flex-end`, `margin-bottom: 2px`, `flex-shrink: 0`

### Nav bar container

`.top-nav` / `<nav>`:
- `display: flex`, `gap: 8px`, `justify-content: center`, `align-items: flex-end`
- `padding: 6px 16px`
- `background: rgba(0,0,0,0.18)`, `border-top: 1px solid rgba(255,255,255,0.10)`
- Existing `flex-wrap: wrap` and `position: relative` preserved

---

## Accessibility Improvements

This redesign adds the a11y attributes the current nav is missing:

| What | How |
|---|---|
| Navigation landmark | `<nav class="top-nav" aria-label="Main navigation">` — currently `<nav>` has no label |
| Active page signal | `aria-current="page"` on the active `.page-button` — `switchPage()` must set/clear this alongside `.active` |
| Decorative separators | `aria-hidden="true"` on `.nav-group-sep` |
| Non-interactive group labels | Group labels are `<span>` (not `<button>`) — not in tab order |
| Keyboard focus ring | `.page-button:focus-visible` gets a white outline — currently no focus-visible rule exists |
| Dark mode focus ring | `body.dark-mode .page-button:focus-visible`: `outline-color: rgba(255,255,255,0.70)` |

### `aria-current` wiring

`switchPage(app, pageName)` in `src/ui.js` currently:
1. Removes `.active` from all `.page-button` elements
2. Adds `.active` to the matching button

It must also:
1. Set `aria-current="page"` on the activated button
2. Remove `aria-current` (or set to `"false"`) from all others

---

## HTML Changes (`index.html`)

Replace the existing `<nav class="top-nav">` contents with:

```html
<nav class="top-nav" id="topNav" aria-label="Main navigation">
    <button class="nav-toggle" id="navToggle" aria-label="Toggle menu" aria-expanded="false" aria-controls="navMenu">
        ☰
    </button>
    <div class="nav-menu" id="navMenu">
        <div class="nav-group">
            <span class="nav-group-label">Overview</span>
            <div class="nav-group-btns">
                <button class="page-button" data-page="health" aria-current="page">Health</button>
                <button class="page-button" data-page="accounts">Accounts</button>
                <button class="page-button" data-page="income">Income</button>
            </div>
        </div>
        <div class="nav-group-sep" aria-hidden="true"></div>
        <div class="nav-group">
            <span class="nav-group-label">Manage</span>
            <div class="nav-group-btns">
                <button class="page-button" data-page="liabilities">Liabilities</button>
                <button class="page-button" data-page="recurring">Recurring</button>
                <button class="page-button" data-page="savings">Savings</button>
                <button class="page-button" data-page="strategy">Plan</button>
            </div>
        </div>
        <div class="nav-group-sep" aria-hidden="true"></div>
        <div class="nav-group">
            <span class="nav-group-label">Analyze</span>
            <div class="nav-group-btns">
                <button class="page-button" data-page="reports">Reports</button>
                <button class="page-button" data-page="ledger">Ledger</button>
                <button class="page-button" data-page="reconcile">Reconcile</button>
            </div>
        </div>
    </div>
</nav>
```

`data-page` values are **unchanged** — `switchPage()` queries `[data-page]` and this is the only attribute it needs.

---

## CSS Changes (`styles.css`)

### Remove / replace

Replace the existing `.page-button`, `.page-button:hover`, `.page-button.active` rules and their dark-mode equivalents with the new rules below. The `.top-nav`, `.nav-toggle`, `.nav-menu` rules are updated in-place (not removed).

### New / updated rules

```css
/* ── Main nav container ─────────────────────────────────────── */
.top-nav {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: flex-end;
    gap: 8px;
    padding: 6px 16px;
    margin-top: 12px;
    background: rgba(0,0,0,0.18);
    border-top: 1px solid rgba(255,255,255,0.10);
    position: relative;
}

/* ── Group wrapper ───────────────────────────────────────────── */
.nav-group {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
}

/* ── Group pill label ────────────────────────────────────────── */
.nav-group-label {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(255,255,255,0.18);
    color: rgba(255,255,255,0.60);
    transition: background 0.15s, color 0.15s;
    white-space: nowrap;
}
.nav-group:has(.page-button.active) .nav-group-label {
    background: rgba(255,255,255,0.90);
    color: #1e40af;
}

/* ── Button row inside a group ───────────────────────────────── */
.nav-group-btns {
    display: flex;
    gap: 2px;
}

/* ── Page button ─────────────────────────────────────────────── */
.page-button {
    padding: 6px 11px;
    border-radius: 4px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: rgba(255,255,255,0.65);
    cursor: pointer;
    font-weight: 600;
    font-size: 11px;
    letter-spacing: 0.02em;
    white-space: nowrap;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.page-button:hover {
    color: #fff;
    background: rgba(255,255,255,0.10);
    border-bottom-color: rgba(255,255,255,0.40);
}
.page-button:focus-visible {
    outline: 2px solid rgba(255,255,255,0.80);
    outline-offset: 2px;
}
.page-button.active {
    color: #fff;
    background: rgba(255,255,255,0.15);
    border-bottom: 2px solid #fff;
}

/* ── Group separator ─────────────────────────────────────────── */
.nav-group-sep {
    width: 1px;
    height: 30px;
    background: rgba(255,255,255,0.18);
    align-self: flex-end;
    margin-bottom: 2px;
    flex-shrink: 0;
}

/* ── Dark mode overrides ─────────────────────────────────────── */
body.dark-mode .top-nav {
    background: rgba(0,0,0,0.30);
    border-top-color: rgba(255,255,255,0.08);
}
body.dark-mode .page-button {
    color: rgba(255,255,255,0.60);
}
body.dark-mode .page-button:hover {
    color: #fff;
    background: rgba(255,255,255,0.06);
}
body.dark-mode .page-button:focus-visible {
    outline-color: rgba(255,255,255,0.70);
}
body.dark-mode .page-button.active {
    color: #fff;
    border-bottom-color: #93c5fd;
}
```

### Mobile overrides (inside `@media (max-width: 768px)`)

The existing hamburger collapse behaviour is unchanged. Add/update these rules:

```css
/* Mobile: hide group separators and labels (vertical stack layout) */
.nav-group-sep  { display: none; }
.nav-group-label { display: none; }
.nav-group      { gap: 0; }
.nav-group-btns { flex-direction: column; }
.page-button {
    max-width: 100%;
    font-size: 0.9rem;
    padding: 14px 16px;
    border-bottom: 1px solid rgba(255,255,255,0.10);
    border-right: 3px solid transparent;
    text-align: left;
    white-space: normal;
    min-height: 44px;
    display: flex;
    align-items: center;
}
.page-button:hover {
    background: rgba(255,255,255,0.08);
    border-bottom-color: rgba(255,255,255,0.10);
    border-right-color: rgba(255,255,255,0.40);
}
.page-button.active {
    background: rgba(255,255,255,0.05);
    border-bottom-color: rgba(255,255,255,0.10);
    border-right: 3px solid #fff;
}
```

---

## JS Changes (`src/ui.js`)

`switchPage(app, pageName)` must set `aria-current="page"` when activating a page button and clear it from all others. The current logic already loops `[data-page]` buttons — add one line per pass:

```js
// Inside the loop that sets/clears .active:
btn.classList.toggle('active', isActive);
btn.setAttribute('aria-current', isActive ? 'page' : 'false');
```

No other JS changes needed. `data-page` query selectors remain unchanged.

---

## Dark Mode

- Active group label: `background: rgba(255,255,255,0.90); color: #1e40af` — same in both modes (white pill on blue header)
- Active page button underline: `#93c5fd` (blue-300) in dark mode — matches the existing dark-mode rule
- Focus ring: `rgba(255,255,255,0.70)` in dark mode

---

## Testing

### Existing tests (must still pass)

All existing tests that navigate pages via `page.click('button[data-page="..."]')` are unaffected — `data-page` values are unchanged.

### New tests

#### `tests/features/test_main_nav_groups.py` (feature / structure)

- `test_main_nav_three_groups_exist` — three `.nav-group` elements inside `#topNav`
- `test_main_nav_group_labels` — labels read "Overview", "Manage", "Analyze"
- `test_main_nav_pages_in_correct_groups` — each `data-page` button is inside the correct `.nav-group`
- `test_main_nav_all_ten_pages_present` — all 10 `[data-page]` buttons present
- `test_main_nav_page_switching_still_works` — clicking each page-button activates its section

#### `tests/ui/test_main_nav.py` (behavioral / edge-case)

- `test_active_group_label_highlights` — active group label has white pill bg (via computed style)
- `test_inactive_group_labels_dimmed` — inactive group labels are ghost pill (opacity/bg check)
- `test_cross_group_navigation` — switching from one group's page to another moves `.active`
- `test_only_one_page_active_at_a_time` — exactly one `.page-button.active` at any time
- `test_nav_group_separators_hidden_on_mobile` — `.nav-group-sep` display:none at 480px

#### `tests/ui/test_accessibility.py` (a11y — append)

- `test_main_nav_has_landmark_role` — `<nav>` has `aria-label="Main navigation"`
- `test_main_nav_active_page_aria_current` — active button has `aria-current="page"`, others have `"false"`
- `test_main_nav_group_labels_are_spans` — `.nav-group-label` elements are `<span>` not `<button>`
- `test_main_nav_separators_aria_hidden` — `.nav-group-sep` elements have `aria-hidden="true"`
- `test_main_nav_focus_visible_ring` — `.page-button:focus-visible` outline is non-none in stylesheet
- `test_main_nav_all_pages_keyboard_reachable` — Tab navigation reaches all 10 page buttons

---

## Files Changed

| File | Change |
|---|---|
| `index.html` | Replace flat `.nav-menu` contents with 3 `.nav-group` wrappers |
| `styles.css` | Replace `.page-button` rules; add `.nav-group`, `.nav-group-label`, `.nav-group-btns`, `.nav-group-sep`; update mobile query |
| `src/ui.js` | `switchPage()` adds `aria-current="page"` on active button |
| `tests/features/test_main_nav_groups.py` | New: 5 feature/structure tests |
| `tests/ui/test_main_nav.py` | New: 5 behavioral/edge-case tests |
| `tests/ui/test_accessibility.py` | Append: 6 a11y tests |
