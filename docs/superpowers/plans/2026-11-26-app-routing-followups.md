# App Routing Follow-ups (#734) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining items of #734 so the routing epic (#733) can be closed: Back and Forward over open dialogs leave no stray history entries, Back also closes the notifications panel and account menu, the router's edge cases are hardened, and the dead hamburger code and test debt are removed.

**Architecture:** Every history entry the router creates carries `history.state = { mf: <index> }` where the index is the entry's position in the app's own history (a push is `current + 1`, a replace keeps it). The Back guard undoes an over-an-overlay navigation with `history.go(currentIndex - newIndex)` instead of `pushState(lastPath)`, so no entry is added or dropped and Back is told apart from Forward. Settings marks the entry its open pushed (`state.settings = true`), replacing the module-level `settingsPushed` flag.

**Tech Stack:** Vanilla ES modules, no build step; Jest (`tests/unit`), Playwright pytest (`tests/ui`), CSS in `styles.css`.

**Spec:** `docs/superpowers/specs/2026-11-25-app-routing-design.md` (sections "History behaviour" and "Back closes the innermost thing first"); issue #734 lists the items. Builds on phases 1 and 2 and the phone polish passes (8.8.3 on this branch's base).

## Global Constraints

- `router.js` keeps zero imports; `ui.js` and `postgresSync.js` exports stay hoisted `function` declarations (import cycles); `ui.js` may import `router.js`.
- Overlays still add no history entries. Gates (`#loginGate`, `#serverUnreachableGate`) are never closed by Back. Inline edits are cancelled only while their edit UI is shown.
- A history entry without `state.mf` (written by other code, e.g. `loginGate.js:215`'s `replaceState`) is treated as unknown: the guard falls back to today's `pushState(lastPath)` restore.
- No new fixed `wait_for_timeout`; new Playwright files join a `ci.yml` shard (`test-ui-*` shards should stay under about 360 s; last CI: a 266 s, b 264 s, c 285 s, d 325 s, so prefer a or b).
- Strings through `t()` with real en / es / pl translations if any are added; contrast measured with `tests/ui/contrast_utils.py`; no CSS nesting; no inline styles.
- Release **8.8.4** (patch): `APP_VERSION`, `sw.js` `CACHE_NAME` `myfinances-v8.8.4`, `CHANGELOG.md`.
- Local testing: Jest in Docker (copy `package.json`, `package-lock.json`, `jest.config.js`, `babel.config.cjs`, `stryker.config.mjs`, `src`, `tests`, `tools`, `sw.js` and `server/src`); Playwright only against a dedicated throwaway stack (other local stacks may hold data).

## Review Focus

1. **Multi-step Back** (Android's long-press Back menu, or `history.go(-2)`) over an open dialog returns to the starting entry in one `history.go`, not several. Test in Task 1.
2. **Reload keeps the index**: after a reload `history.state.mf` is read back, so a Back over a dialog still undoes correctly. Test in Task 1.
3. **Entries without `mf`** (the loginGate rewrite) fall back to the old restore and never throw. Test in Task 1.
4. **Settings reached by Forward or a refresh** closes by stepping back (no duplicate entry); a bookmarked `?settings` (first entry) closes in place. Test in Task 1.
5. **A render that throws** still leaves the address matching the view that was switched to. Test in Task 2.

---

### Task 1: Entry index, undo with `history.go`, Settings entry marker

**Files:**
- Modify: `src/router.js`
- Test: `tests/unit/router.test.js`, `tests/ui/test_back_overlays.py`, `tests/ui/test_app_routing.py`

**Interfaces:**
- Produces (in `src/router.js`):
  - `currentIndex` (module state, number or `null`): the `mf` of the entry on screen; set at `initRouter` from `history.state?.mf`, else `replaceState({ mf: 0 })` on the current entry and `0`.
  - Every `pushState` the router writes uses `{ mf: currentIndex + 1 }` (plus `settings: true` for Settings' opening push) and updates `currentIndex`; every `replaceState` keeps the entry's index and its `settings` marker when the entry already had one.
  - `onPopState(app)`: reads `history.state?.mf` as `newIndex`. If a router-initiated navigation is expected (`expectedIndex === newIndex`) it clears the expectation; for the Settings step-back it then applies the address as today, for an undo it only syncs `currentIndex`. Otherwise, when `closeInnermost(app)` handles the pop and both indexes are known it calls `history.go(currentIndex - newIndex)` after setting `expectedIndex = currentIndex` (no `pushState`); with an unknown index it keeps the old `pushState(lastPath)` restore. When nothing handles the pop it sets `currentIndex = newIndex` and applies the address.
  - `leaveSettings()`: steps back with `history.back()` iff the entry on screen has `history.state.settings === true`, else replaces the address without `?settings`.
  - `recordView(app, view, mode)`: leaving a `?settings` address for the **same** page (the palette choosing the page already under Settings) steps back with `history.back()` instead of replacing; for a different page it replaces the Settings entry as today. `settingsPushed` is removed.
- Removes: module-level `settingsPushed` and `expectedPop`.

- [ ] **Step 1: Write the failing tests.**
  - Jest (`router.test.js`, fake `history`/`location` as the existing router tests do): push writes `{ mf: n + 1 }` and replace keeps `mf`; `initRouter` adopts a stored `mf` and assigns `0` when absent; popstate to a lower index over an open dialog calls `history.go(+delta)` and never `pushState`; a higher index (Forward) calls `history.go(-delta)`; a pop two entries back returns with one `go(2)`; an entry without `mf` uses `pushState(lastPath)`; the expected pop after an undo does not re-trigger the guard; `leaveSettings` steps back only when the entry has `settings: true`; same-page palette choice steps back, different-page replaces.
  - Playwright (`test_back_overlays.py`): `test_forward_over_dialog_leaves_no_extra_entry` (Ledger → Accounts, Back to Ledger, open a dialog, Forward → dialog closes, still `/ledger`, `history.length` unchanged, then Forward again reaches `/accounts`); `test_multi_step_back_over_dialog` (three pages, open a dialog, `page.evaluate("history.go(-2)")`, dialog closes and the address is where it started); `test_reload_keeps_index_for_back_guard` (Review Focus 2); `test_settings_reached_by_forward_closes_by_back` and `test_bookmarked_settings_closes_in_place` (Review Focus 4); `test_entry_without_index_falls_back` (Review Focus 3: clear `history.state` with `replaceState(null, ...)`, open a dialog, Back → dialog closes, page unchanged); `test_palette_same_page_over_settings_leaves_no_duplicate` (Settings open over `/ledger`, palette picks Ledger, `history.length` unchanged).
- [ ] **Step 2: Run** against the dedicated stack. Expected: FAIL (the router still pushes).
- [ ] **Step 3: Implement** per the Interfaces block; keep `GATE_IDS`, `topOverlay`, `closeInnermost` as they are.
- [ ] **Step 4: Run** the new tests, all of `tests/ui/test_back_overlays.py`, `tests/ui/test_app_routing.py`, `tests/ui/test_phone_tab_bar.py`, `tests/unit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: history entries carry an index; Back over a dialog undoes with history.go (#734)`.

---

### Task 2: Router hardening

**Files:**
- Modify: `src/router.js`, `src/ui.js`, `src/commandPalette.js`, `src/settingsNav.js`, `src/setupWizard.js` (as needed)
- Test: `tests/unit/router.test.js`, `tests/ui/test_app_routing.py`

**Interfaces:**
- Consumes: Task 1's index and Settings marker.
- Produces: `isSettingsOpen()` exported from `router.js` (the DOM check `#settingsModal` not `.hidden`); `commandPalette.js` uses it instead of its own `flex-visible` check. `buildPath` validates `subTab` against `ROUTE_SUB_TABS[page]` (an unknown sub-tab is dropped, an unknown `settings` name falls back to `''`). `parseLocation` reads `settings` with `URLSearchParams` (`has('settings')`, `get('settings')`), no substring test.

- [ ] **Step 1: Write the failing tests.**
  - Jest: `buildPath({ page: 'liabilities', subTab: 'bogus' })` is `/liabilities`; `parseLocation('/', '?foo=a_settings=1&settings')` is canonical with `settings: ''`; `?settings=` (empty value) is not canonical.
  - Playwright (`test_app_routing.py`): `test_render_error_still_records_address` (Review Focus 5: make `app.renderLedgerPage` / the page's renderer throw once via `page.evaluate`, click Ledger, assert the URL is `/ledger` and Back returns); `test_bare_settings_on_wide_screen_is_canonicalised` (`goto('/?settings')` at 1280 px: the address becomes `/?settings=<page shown>`); `test_resize_narrow_to_wide_updates_settings_address` (open the narrow list at 390 px, resize to 1280 px, the address names the page now shown).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `switchPage` (`ui.js`) records the address in a `try/finally` around `renderPageData` so a throwing render still updates it (the error still propagates). A wide-screen open or a width change with Settings open canonicalises the address through `recordSettings(activeSettingsPage, 'replace')` (the settings nav already tracks `getActiveSettingsPage()`; hook the existing breakpoint listener in `settingsNav.js`, calling the router through the `app` or a DOM event, since `settingsNav.js` is lazy and `router.js` is static).
- [ ] **Step 4: Run** the new tests, `tests/ui/test_app_routing.py`, `tests/ui/test_settings_redesign.py`, `tests/features/test_settings*.py`, `tests/unit`. Expected: PASS.
- [ ] **Step 5: Commit** `fix: router hardening from the phase 1 reviews (#734)`.

---

### Task 3: Back closes the notifications panel and the account menu; the More sheet yields to a dialog above it

**Files:**
- Modify: `src/router.js` (`topOverlay`), `src/ui.js` (sheet Escape handler, account menu), `src/notificationsCenter.js` (Escape if missing)
- Test: `tests/ui/test_back_overlays.py`, `tests/ui/test_phone_tab_bar.py`

**Interfaces:**
- Consumes: Task 1 (`history.go` undo). Produces: `topOverlay()` also returns `#notificationsPanel` or `#accountMenuDropdown` when visible (popovers rank below dialogs: a dialog opened from a popover wins); each closes on Escape and returns focus to its trigger.

- [ ] **Step 1: Write the failing tests.** `test_back_closes_account_menu` and `test_back_closes_notifications_panel` (open on `/ledger`, Back → popover hidden, still `/ledger`, `history.length` unchanged); `test_escape_closes_dialog_above_more_sheet` (open the sheet, append a visible `[role=dialog]` modal over it, Escape closes the dialog first, then a second Escape the sheet).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** In the sheet's capture-phase Escape handler (`ui.js`), return without acting when `topOverlay()` is a visible element other than the sheet. Make sure the popovers close on Escape (check `initAccountMenu`, `notificationsCenter.js`) and restore focus to their buttons.
- [ ] **Step 4: Run** the new tests, `tests/ui/test_account_menu*.py`, `tests/features/test_notifications.py`, `tests/ui/test_phone_tab_bar.py`, `tests/ui/test_back_overlays.py`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Back closes the account menu and notifications panel (#734)`.

---

### Task 4: Dead code, high-contrast tab indicator, test debt

**Files:**
- Modify: `src/ui.js`, `index.html`, `styles.css`, `src/router.js`, `src/bills.js`, `tests/unit/router.test.js`, `tests/unit/swNavigateFallback.test.js`, `tests/features/test_pwa.py`, `tests/ui/test_app_routing.py`, `tests/ui/test_phone_tab_bar.py`, `tests/ui/test_back_overlays.py`
- Test: as listed

- [ ] **Step 1: Remove dead code**, each with its test updated: the hamburger (`#navToggle` button, the `.nav-toggle` and `.menu-open` CSS and the `ui.js` handlers, plus `tests/a11y` and design tests that drive it) since the phone tab bar replaces it at every width it showed; the Add Debt form-edit canceller branch in `closeInnermost` (`#cancelEditBtn` is never shown) and its Jest case; the `be-name-` bonus-prefix read in `bills.js` (bills have no edit UI).
- [ ] **Step 2: High-contrast tab indicator.** Under `body.dark-mode.high-contrast-mode` the active phone tab gets its own indicator (`box-shadow: inset 0 3px 0 #ffd60a`, text `#ffffff`); extend the contrast test in `test_phone_tab_bar.py` to cover the hover backgrounds and the high-contrast theme (use `tests/ui/contrast_utils.py`).
- [ ] **Step 3: Test debt** (one fix each, no behaviour change): `router.test.js` resets module state between tests (`jest.resetModules()` or an exported test-only reset) so `initRouter`'s listener flag does not leak; `swNavigateFallback.test.js` uses a minimal real-shaped `Request` stub (url, method, mode) instead of `function Request() {}`; `test_pwa.py` shortcut test asserts each shortcut URL equals one of the route table's built addresses, not just the first segment; the lazy-render test in `test_app_routing.py` waits with `expect_request` / a route handler event instead of the `page.evaluate` spin loop; the Back-to-Spending test clicks the Reports tab instead of setting classes by hand.
- [ ] **Step 4: Run** `tests/unit`, `tests/a11y` (alone), `tests/ui/test_phone_tab_bar.py`, `tests/ui/test_app_routing.py`, `tests/ui/test_back_overlays.py`, `tests/ui/test_design_consistency.py`, `tests/ui/test_main_nav.py`, `tests/features/test_pwa.py`, `tests/features/test_css_integrity` equivalent (`tests/ui/test_css_integrity.py`). Expected: PASS.
- [ ] **Step 5: Commit** `chore: remove the dead hamburger and branches; high-contrast tab indicator; test tidy (#734)`.

---

### Task 5: Release and docs

**Files:** `src/utils.js`, `sw.js`, `CHANGELOG.md`, `docs/architecture/features.md`, `CLAUDE.md` (only if a rule changes)

- [ ] **Step 1: Bump** to 8.8.4 (`APP_VERSION`, `CACHE_NAME`), `## [8.8.4] — <date>` at the top of `CHANGELOG.md`: Forward and Back over a dialog no longer leave or drop history entries, Back closes the account menu and notifications panel, the More sheet yields to a dialog above it, Settings reached by Forward closes cleanly, hardening, hamburger code removed.
- [ ] **Step 2: Docs.** In `features.md` "App routing" replace the Back-guard description (it restores `lastPath` with a push) with the index and `history.go` design, remove both "known limitation" sentences (Forward over an overlay; a dialog over the More sheet needing a second Escape), describe `state.mf` and `state.settings`, and list the popovers as overlays.
- [ ] **Step 3: Run** `tests/features/test_versioning.py`, `test_pwa.py`, `test_whats_new.py`, `test_community_files.py`, `test_ci_shard_coverage.py`, `test_skip_guard.py`, `test_sleep_ratchet.py`, `tests/unit`. Expected: PASS.
- [ ] **Step 4: Commit** `chore: release 8.8.4 routing follow-ups (#734)`.
