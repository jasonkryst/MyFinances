# App Routing Phase 2 (Phone Tab Bar, More Sheet, Back Closes Overlays) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On phones a bottom tab bar (Health, Ledger, Plan, Reports, More) replaces the hamburger menu, and the browser/Android Back button closes the innermost open thing (dialog, More sheet, inline edit) before it changes the page.

**Architecture:** The router's `popstate` handler gains a guard: if an overlay or inline edit is open, it restores the address it just left and closes that one thing instead of applying the address. The tab bar is static markup in `index.html` whose buttons are ordinary `.page-button[data-page]` buttons, so `switchPage` and the router drive it with no new navigation path; the More sheet is built at startup by cloning the existing nav groups minus the four tab pages.

**Tech Stack:** Vanilla ES modules, no build step; Jest (`tests/unit`), Playwright pytest (`tests/ui`), CSS in `styles.css`.

**Spec:** `docs/superpowers/specs/2026-11-25-app-routing-design.md` ("Phone tab bar" and "Back closes the innermost thing first"). Builds on phase 1 (PR #735), which this branch is stacked on.

## Global Constraints

- Tab bar shown at `max-width: 768px` only, replacing `#navToggle` and the hamburger `.nav-menu`; desktop navigation and the header are unchanged on every width.
- Tabs, in order: Health, Ledger, Plan, Reports, More. More sheet groups: Overview (Accounts · Income · People), Manage (Liabilities · Recurring · Savings), Analyze (Reconcile · Retirement), cloned from the existing `.nav-group` markup, never a second hand-kept list.
- Bar: a `<nav>` landmark with its own accessible name; active tab `aria-current="page"`; More is current on any page that lives in the sheet.
- Sheet: `makeBackgroundInert` (`src/overlayFocus.js`), focus moves in and is trapped, Escape and backdrop tap close it, focus returns to More.
- Page content bottom padding = bar height + `env(safe-area-inset-bottom)`; the bar hides while a text field has focus at phone width.
- Back guard: overlays never add history entries; gates `#loginGate` and `#serverUnreachableGate` are never closed by Back; inline edits are cancelled exactly as their Cancel button does (owner's choice); Back with a dialog on top of Settings closes only that dialog.
- Strings via `t()`/`data-i18n` with real translations in `en.js`, `es.js`, `pl.js`; contrast measured with `tests/ui/contrast_utils.py`; no CSS nesting; no inline styles (CSP); icons inline SVG.
- `router.js` keeps zero imports; `ui.js` exports stay hoisted `function` declarations; no new fixed `wait_for_timeout`; new Playwright files join a `ci.yml` shard.
- Release **8.8.0** (minor): `APP_VERSION`, `sw.js` `CACHE_NAME` `myfinances-v8.8.0`, `CHANGELOG.md`, English `WHATS_NEW_ENTRIES` item (the existing pattern).
- Local testing: Jest in Docker; Playwright only against a dedicated throwaway stack (other local stacks may hold data).

## Review Focus

1. **Two stacked overlays** (Keyboard Shortcuts opened from Settings → About): one Back closes only Shortcuts, focus lands inside Settings, a second Back closes Settings. Test in Task 1.
2. **Address restore after a replace**: open a dialog right after a canonicalising replace (e.g. arriving at `/reports` → `/reports/calendar`), press Back; the address is `/reports/calendar` and the page unchanged. Test in Task 1.
3. **Back while a gate is up**: the gate stays visible and focused after Back. Test in Task 1.
4. **Language switch**: after choosing Español in Settings, the tab bar and More sheet labels are Spanish. Test in Task 4.
5. **Crossing the breakpoint with the sheet open**: resizing 390 → 1280 px closes the sheet, releases `inert`, and shows the desktop nav. Test in Task 4.

---

### Task 1: Back closes the innermost overlay or inline edit

**Files:**
- Modify: `src/router.js` (popstate handler, last-path tracking)
- Test: `tests/unit/router.test.js`, `tests/ui/test_back_overlays.py` (new; add to the `test-ui-c` job or a lighter `test-ui-*` job by measured time)

**Interfaces:**
- Consumes: phase 1 `applyLocation(app)`, `recordView`, `recordSettings`, `initRouter`.
- Produces (in `src/router.js`):
  - `GATE_IDS = ['loginGate', 'serverUnreachableGate']`.
  - `EDIT_CANCELLERS`: `{ editingAccountId: 'cancelEditAccount', editingBillId: 'cancelEditBill', editingBonusId: 'cancelEditBonus', editingExpenseId: 'cancelEditExpense', editingIncomeId: 'cancelEditIncome', editingPersonId: 'cancelEditPerson', editingRecurringId: 'cancelEditRecurring' }`; `editingDebtId` maps to `cancelEdit` when `#cancelEditBtn` is visible (form edit) and `cancelInlineEdit` otherwise.
  - `topOverlay() -> Element|null`: the visible `[role="dialog"]`, `[role="alertdialog"]`, `.modal` or `[data-overlay]` element that is not a gate and not `#settingsModal`, preferring the one containing `document.activeElement`, else the last in DOM order.
  - `closeInnermost(app) -> boolean`: closes `topOverlay()` by dispatching a bubbling `keydown` Escape on it (on its focused descendant if any), else cancels the open inline edit via `app[EDIT_CANCELLERS[field]]()`; returns whether it handled anything.
  - The `popstate` listener: if `closeInnermost(app)` returns true, `history.pushState(null, '', lastPath)` and stop; otherwise `applyLocation(app)`. `lastPath` (path + search of the view on screen) is updated whenever `recordView`, `recordSettings`, `leaveSettings`, or `applyLocation` writes or applies an address.

- [ ] **Step 1: Write the failing tests** in `tests/ui/test_back_overlays.py` (fixtures as in `tests/ui/test_app_routing.py`):
  - `test_back_closes_dialog_and_keeps_page`: on `/ledger`, open the Ledger export dialog (`#ledgerExportModal`); `go_back()`; dialog hidden, `#ledgerSection.active`, `location.pathname == '/ledger'`; a second `go_back()` leaves `/ledger` for the previous page.
  - `test_back_closes_stacked_dialog_first` (Review Focus 1): open Settings, About, Keyboard Shortcuts; `go_back()` → `#keyboardShortcutsModal` hidden, `#settingsModal` visible, `document.activeElement` inside `#settingsModal`; `go_back()` → Settings hidden.
  - `test_back_restores_canonical_address` (Review Focus 2): `goto('/reports')` (becomes `/reports/calendar`), open a Reports dialog (a calendar day, or `#calendarFeedModal` via the account menu); `go_back()`; pathname `/reports/calendar`, dialog hidden.
  - `test_back_with_gate_keeps_gate` (Review Focus 3): navigate Ledger → Accounts, force the sign-in gate (route `/api/**` to 401 and trigger a write, as existing 401 tests do), `go_back()`; `#loginGate` visible.
  - `test_back_cancels_inline_edit` — parametrised over Accounts, Income, Recurring, People and a debt inline edit: start an edit, change a field, `go_back()`; the edit is closed, the page and address are unchanged, and a server GET shows the original value.
  - Jest in `tests/unit/router.test.js`: `closeInnermost` returns false with nothing open; returns true and calls the mapped canceller for each `EDIT_CANCELLERS` field (fake app); prefers the debt form canceller when `#cancelEditBtn` is visible (jsdom-free: stub `document` the way the existing router tests stub `window`/`history`).
- [ ] **Step 2: Run** against the dedicated stack. Expected: FAIL (Back switches the page).
- [ ] **Step 3: Implement** per the Interfaces block.
- [ ] **Step 4: Run** the new tests, all of `tests/ui/test_app_routing.py`, `tests/unit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Back closes the open dialog or edit first (#731)`.

---

### Task 2: Every overlay closes on Escape; palette closes Settings

**Files:**
- Modify: whichever overlay modules lack an Escape close (audit result), `src/commandPalette.js` (page entries)
- Test: `tests/ui/test_back_overlays.py`

**Interfaces:**
- Consumes: Task 1 `closeInnermost` (it relies on Escape closing every overlay).
- Produces: nothing new; every overlay listed below closes on Escape.

- [ ] **Step 1: Audit.** For each of the 29 static modals in `index.html` (`grep -o 'id="[A-Za-z]*Modal"'`) and the 7 dynamically created dialogs (`grep -rn "role', 'dialog'" src`), record in the commit message whether Escape closes it today. Gates and `#settingsModal` are out of scope (Settings already handles Escape).
- [ ] **Step 2: Write the failing test** `test_every_overlay_closes_on_escape`, parametrised over every overlay with a real opener the test can drive (button click or `app.*` call, one line each, listed in the test); each opens, receives Escape, and is hidden. Overlays that cannot be opened without heavy seeding (e.g. `syncConflictModal`, `pgMigrationModal`) are listed with `# skip-ok:` and the reason. Add `test_palette_page_choice_closes_settings`: open Settings, Ctrl+K, choose Accounts; Settings hidden, `#accountsSection.active`, URL `/accounts` with no `?settings`.
- [ ] **Step 3: Run.** Expected: FAIL for each overlay the audit found without Escape, and for the palette test.
- [ ] **Step 4: Implement** an Escape close for each failing overlay, following its existing close path (focus return included). In `commandPalette.js`, page entries close Settings first via `app.closeSettings()` when it is open.
- [ ] **Step 5: Run** the new tests and the feature files of every overlay you changed. Expected: PASS.
- [ ] **Step 6: Commit** `fix: every dialog closes on Escape; palette closes Settings first (#731)`.

---

### Task 3: Phone tab bar

**Files:**
- Modify: `index.html` (bar markup after `#topNav`), `styles.css`, `src/ui.js` (`switchPage` active state, keyboard-hide listener), `src/locales/en.js`, `es.js`, `pl.js`; update `tests/ui/test_design_consistency.py`, `tests/ui/test_table_mobile_scroll.py`, `tests/a11y/run_a11y_audit.py`/`test_a11y_audit.py` where they drive `#navToggle` at phone width
- Test: `tests/ui/test_phone_tab_bar.py` (new; add to a `ci.yml` shard)

**Interfaces:**
- Consumes: phase 1 `switchPage`, router.
- Produces:
  - Markup: `<nav id="phoneTabBar" class="phone-tab-bar" aria-label="…" data-i18n-attr="aria-label:nav.phoneTabsAria">` holding four `button.page-button.phone-tab[data-page]` (`health`, `ledger`, `strategy`, `reports`) and `button#phoneMoreBtn.phone-tab` (`aria-haspopup="dialog"`, `aria-expanded`, `aria-controls="phoneMoreSheet"`), each an inline SVG icon (`aria-hidden="true"`) plus a `data-i18n` label (`nav.health`, `nav.ledger`, `nav.strategy`, `nav.reports`, new `nav.more`).
  - `switchPage` marks **every** `.page-button[data-page=X]` active (today it marks only the first match), and sets `aria-current="page"` on `#phoneMoreBtn` when X is not one of the four tab pages.
  - CSS: at `max-width: 768px` the bar is fixed to the bottom, `#navToggle` and `.nav-menu` are hidden, and `main`/`.page-section` get bottom padding `calc(<bar height> + env(safe-area-inset-bottom))`; above 768 px the bar is `display: none`. Class `phone-tab-bar--hidden` hides it.
  - `ui.js`: a `focusin`/`focusout` listener toggles `phone-tab-bar--hidden` while a text-entry control (the same rule as `liveRefresh.js` `isTyping`) has focus and `matchMedia('(max-width: 768px)')` matches.
  - Locale keys: `nav.more`, `nav.phoneTabsAria` in all three locales (real translations).

- [ ] **Step 1: Write the failing tests** at 390 × 844:
  - `test_tab_bar_visible_on_phone_only`: bar visible at 390 px and hidden at 1280 px; `#navToggle` hidden at 390 px; desktop `.nav-menu` buttons visible at 1280 px.
  - `test_tab_navigates_and_marks_current`: tap Ledger → `#ledgerSection.active`, URL `/ledger`, Ledger tab `aria-current="page"`, others not; tap Plan → `/plan`.
  - `test_more_is_current_for_sheet_pages`: `goto('/accounts')`; `#phoneMoreBtn` has `aria-current="page"` and no tab does.
  - `test_last_row_clears_bar`: Ledger with enough seeded rows to scroll; scroll to the bottom; the last row's bounding box ends above the bar's top.
  - `test_bar_hides_while_typing`: focus `#ledgerSearch` (or any text input) → bar hidden; blur → visible.
  - `test_tab_bar_contrast`: active and inactive labels meet contrast via `contrast_utils.py`, light and dark themes.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** per the Interfaces block; update the listed existing tests that relied on the hamburger at phone width.
- [ ] **Step 4: Run** the new file, `tests/ui/test_mobile*.py`, `tests/ui/test_main_nav.py`, `tests/ui/test_app_routing.py`, `tests/ui/test_design_consistency.py`, `tests/ui/test_table_mobile_scroll.py`, `tests/a11y`, `tests/features/test_css_integrity.py`, `tests/unit` (i18n). Expected: PASS.
- [ ] **Step 5: Commit** `feat: phone bottom tab bar (#731)`.

---

### Task 4: More sheet

**Files:**
- Modify: `index.html` (sheet container), `styles.css`, `src/ui.js` (sheet init/open/close), locales
- Test: `tests/ui/test_phone_tab_bar.py`

**Interfaces:**
- Consumes: Task 3 markup (`#phoneMoreBtn`), Task 1 `closeInnermost` (the sheet carries `role="dialog"` so Back closes it), `makeBackgroundInert`.
- Produces: `<div id="phoneMoreSheet" class="phone-more-sheet hidden" role="dialog" aria-modal="true" aria-labelledby="phoneMoreSheetTitle">` with a backdrop and a panel; `ui.js` functions `openPhoneMoreSheet(app)` / `closePhoneMoreSheet(app)` (hoisted, not exported unless a test needs them). At init the sheet body is filled by cloning each `#navMenu .nav-group` and removing buttons whose `data-page` is a tab page; cloned buttons keep `.page-button[data-page]` and `data-i18n`, so `switchPage`'s active marking and `applyTranslations` cover them. Choosing a page closes the sheet, then navigates.

- [ ] **Step 1: Write the failing tests:**
  - `test_more_sheet_lists_other_pages`: tap More; sheet visible with group labels Overview/Manage/Analyze and exactly Accounts, Income, People, Liabilities, Recurring, Savings, Reconcile, Retirement.
  - `test_more_sheet_focus_and_escape`: open → focus inside the sheet, `#app` (or the main container) `inert`; Tab cycles within; Escape closes, `inert` released, focus on `#phoneMoreBtn`, `aria-expanded="false"`.
  - `test_more_sheet_backdrop_closes`: tap the backdrop → closed.
  - `test_more_sheet_navigates`: open, tap Savings → sheet closed, `/savings/emergency`, More `aria-current="page"`.
  - `test_back_closes_more_sheet`: open the sheet on `/ledger`; `go_back()` → sheet closed, still `/ledger`.
  - `test_tab_labels_follow_language` (Review Focus 4): switch Settings → Language to Español; tab bar and sheet labels equal the `es.js` strings.
  - `test_sheet_closes_when_widened` (Review Focus 5): open at 390 px, resize to 1280 px → sheet hidden, no element `inert`, desktop nav visible.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** per the Interfaces block; a `matchMedia('(max-width: 768px)')` change listener closes the sheet when it stops matching.
- [ ] **Step 4: Run** the file, `tests/ui/test_back_overlays.py`, `tests/a11y`, `tests/unit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: phone More sheet (#731)`.

---

### Task 5: Release and docs

**Files:** `src/utils.js`, `sw.js`, `CHANGELOG.md`, `src/ui.js` (`WHATS_NEW_ENTRIES`), `docs/architecture/features.md`, `ACCESSIBILITY.md` (only if a listed limitation is resolved), `.github/workflows/ci.yml` (shard balance)

- [ ] **Step 1: Bump** to 8.8.0 (`APP_VERSION`, `CACHE_NAME`), `## [8.8.0] — <merge date>` at the top of `CHANGELOG.md` (tab bar, More sheet, Back closes dialogs and edits, Escape fixes), English What's New item.
- [ ] **Step 2: Docs.** `features.md`: extend "App routing" with the Back guard (mechanism, gates excluded, edit cancel map, stacked dialogs) and add "Phone tab bar" (breakpoint, tabs, More sheet built from the nav groups, keyboard hide, safe area). Note in #734 which items this closed.
- [ ] **Step 3: Measure** the new Playwright files' runtime and keep each `test-ui-*` shard under about 360 s.
- [ ] **Step 4: Run** `tests/features/test_versioning.py`, `test_pwa.py`, `test_whats_new.py`, `test_community_files.py`, `test_ci_shard_coverage.py`, `tests/unit`. Expected: PASS.
- [ ] **Step 5: Commit** `chore: release 8.8.0 phone tab bar (#731)`.
