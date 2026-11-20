# Settings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `#settingsModal` into a phone-style grouped list with drill-in pages (two panes when the viewport is at least 768px wide), save each control on change, add an About group, and merge `#dataTransferModal` into a Backup & Restore page.

**Architecture:**
- The modal markup in `index.html` is restructured in place, keeping every existing control id.
- A new focused module, `src/settingsNav.js`, owns the list, page switching, deep links, focus and keys.
- `src/setupWizard.js` `initSettingsModal` keeps the value loading. It replaces `save()` with per-control `change` handlers and exports `openSettings`.
- `src/dataTransferModal.js` binds to the Backup page instead of its own modal.

**Tech Stack:** vanilla ES modules, no build step, strict CSP (no inline style/script), Playwright + pytest (sync and async), Jest for pure logic.

**Spec:** `docs/superpowers/specs/2026-11-20-settings-redesign-design.md` (read it first; this plan follows it).

## Global Constraints

- **CSP:** no inline `style=`, no inline `<script>`. Dynamic styling only via `classList`. SVG icons are inline markup with `stroke="currentColor"` and a 24×24 viewBox.
- **Ids:** every existing control id inside `#settingsModal` and `#dataTransferModal` keeps its id. `#settingsModalDoneBtn`, `#dataTransferModal`, `#dataTransferModalCloseBtn`, `data-settings-tab` and `data-dt-tab` cease to exist.
- **Breakpoint:** 768px. `(min-width: 768px)` is two-pane; below it is drill-in.
- **Page ids (exact):** `appearance`, `language`, `notifications`, `backup`, `advanced`, `security`, `about`. Default `appearance`. The last page is remembered in memory only.
- **Strings:** every new user-visible string is a key in `src/locales/en.js`, `es.js` and `pl.js`, with real translations. Use `t()` and `data-i18n` on leaf elements only. Run `tests/features/test_i18n_coverage.py`.
- **CSS:**
  - New rules go in one `/* Settings redesign (7.20.0) */` section appended to `styles.css`, with no nesting.
  - Text colours are `--text-muted` / `--danger-text` / `--primary-color`, never `opacity`.
  - Minimum row height is 44px.
- **Function exports:** `ui.js` and `postgresSync.js` exports stay hoisted `function` declarations (import-cycle rule).
- **Shortcuts:** any new `keydown` shortcut goes in `KEYBOARD_SHORTCUTS` (`src/keyboardShortcuts.js`).
- **CI shards:** a new test file goes in a shard in `.github/workflows/ci.yml` (`test_ci_shard_coverage.py`). Keep each shard under ~360 s.
- **Release:** 7.20.0. `APP_VERSION` (`src/utils.js`), `sw.js` `CACHE_NAME` `myfinances-v7.20.0`, a CHANGELOG `## [7.20.0] — <date>` entry, and a new top `WHATS_NEW_ENTRIES` entry in `src/ui.js`.
- **No native dialogs:** never `alert`/`confirm`/`prompt`.

## Review Focus

1. **Two quick toggles of one switch** while the first write is pending: the server ends at the final state. Task 2 test `test_rapid_toggle_ends_at_final_value`.
2. **Crossing 768px with a page open** (phone rotation, window resize):
   - Widening shows two panes with that page selected.
   - Narrowing shows that page drilled in, not the list.
   - Task 1 test `test_resize_keeps_current_page`.
3. **Re-opening Settings after an import result was shown:** the banner, warnings list and Replace/Merge choice are cleared, as the old modal's `close()` did. Task 3 test `test_backup_result_cleared_on_reopen`.
4. **Changing language while on a sub-page:** the page stays open, its heading and the row values re-render in the new language, and focus stays on the language select. Task 2 test `test_language_change_keeps_page_and_focus`.
5. **What's New or Shortcuts opened from About:** Escape closes only the top modal, Settings stays open on About, and focus returns to the row. Task 4 test `test_about_modal_escape_returns_to_settings`.

---

### Task 1: Navigation shell — list, pages, two-pane / drill-in, focus, keys

**Files:**
- Create: `src/settingsNav.js`
- Modify: `index.html` (`#settingsModal`, ~lines 1975-2172), `src/setupWizard.js` (`initSettingsModal`), `src/app.js` (one wrapper), `src/keyboardShortcuts.js`, `src/locales/{en,es,pl}.js`, `styles.css`
- Test: `tests/ui/test_settings_redesign.py` (new), `tests/conftest.py`

**Interfaces:**
- Produces, in `src/settingsNav.js` (all hoisted `function` declarations):
  - `export const SETTINGS_PAGES = ['appearance','language','notifications','backup','advanced','security','about']`
  - `export function initSettingsNav(modal)`: wires row clicks, ↑/↓/Enter/Space on rows, the back button and the Tab trap. Idempotent.
  - `export function showSettingsPage(page, { focus = true } = {})`: shows the page. Wide: selects its row. Narrow: drills in. With `focus`, moves focus to the page heading. Unknown page falls back to `'appearance'`.
  - `export function showSettingsList()`: narrow only. Back to the list, with focus on the row of the page left.
  - `export function getActiveSettingsPage()`: returns the page id string.
  - `export function isSettingsNarrow()`: `!matchMedia('(min-width: 768px)').matches`.
  - `export function handleSettingsEscape()`: returns `true` when it went back (narrow sub-page), `false` when the caller should close.
- Produces, in `src/setupWizard.js`: `export function openSettings(app, { page } = {})`. It opens the modal (the same value loading `open()` does today) and calls `showSettingsPage(page ?? lastPage)`. On narrow with no `page`, it shows the list.
- Produces, in `src/app.js`: `openSettings(opts) { return openSettingsFeature(this, opts); }`
- Produces, in `tests/conftest.py`: `def open_settings_page(page, name: str) -> None` and `async def open_settings_page_async(page, name: str) -> None`. Each opens Settings with `page.evaluate("n => window.app.openSettings({ page: n })", name)` and waits for `#settingsPage-{name}` to be visible.
- Markup ids:
  - nav `#settingsNav`;
  - rows `button.settings-row[data-settings-page="<id>"]`;
  - pages `section#settingsPage-<id>.settings-page`, each with heading `h4#settingsPageTitle-<id>` (`tabindex="-1"`);
  - narrow header back button `#settingsBackBtn`;
  - row value spans `.settings-row-value#settingsRowValue-<id>` (only `appearance` and `language` have values).
- Root classes:
  - `#settingsModal` gets `settings-shell`;
  - in narrow drill-in, `settings-shell--page` is added (list hidden, page shown).

- [x] **Step 1: Write the failing tests** in `tests/ui/test_settings_redesign.py` (sync API, `app_page` fixture). Narrow tests use `page.set_viewport_size({'width': 390, 'height': 844})` before opening.

```python
def test_wide_shows_two_panes_with_appearance_selected(app_page):
    app_page.set_viewport_size({'width': 1280, 'height': 800})
    app_page.click('#settingsBtn')
    assert app_page.locator('#settingsNav').is_visible()
    assert app_page.locator('#settingsPage-appearance').is_visible()
    assert app_page.locator('[data-settings-page="appearance"]').get_attribute('aria-current') == 'page'
    assert app_page.locator('#settingsPage-advanced').is_hidden()

def test_narrow_list_then_drill_in_and_back(app_page): ...
    # 390x844: open -> #settingsNav visible, no .settings-page visible
    # click [data-settings-page="notifications"] -> #settingsPage-notifications visible, #settingsNav hidden,
    #   document.activeElement.id == 'settingsPageTitle-notifications'
    # click #settingsBackBtn -> #settingsNav visible, focused element is the notifications row

def test_escape_on_narrow_subpage_goes_back_then_closes(app_page): ...
    # narrow, drill into advanced, Escape -> list visible & modal open; Escape again -> modal hidden

def test_arrow_keys_move_between_rows(app_page): ...
    # wide, focus appearance row, ArrowDown -> language row focused, Enter -> #settingsPage-language visible

def test_tab_never_leaves_settings(app_page): ...
    # wide, open, press Tab 40 times; each time document.activeElement is inside #settingsModal   (#495)

def test_resize_keeps_current_page(app_page): ...   # Review Focus 2
    # wide, open security; resize to 390 -> #settingsPage-security visible, #settingsNav hidden;
    # resize to 1280 -> both visible, security row aria-current=page

def test_open_settings_deep_link_narrow_opens_drilled_in(app_page): ...
    # narrow, open_settings_page(page,'backup') -> #settingsPage-backup visible, Back -> list

def test_focus_returns_to_opener_on_close(app_page): ...
    # click #settingsBtn, then #settingsModalCloseBtn -> document.activeElement.id == 'settingsBtn'
```

- [x] **Step 2: Run to verify failure.** Run `pytest tests/ui/test_settings_redesign.py -v`. Expected: FAIL (`#settingsNav` not found).
- [x] **Step 3: Restructure the markup** in `index.html`:
  - Replace the tab bar with `<nav id="settingsNav" aria-label=…>` holding one `<ul>` per group (General, Data, Account, About) plus the danger card, using the spec's row table.
  - Each row is `<button type="button" class="settings-row" data-settings-page="…">` containing an icon tile, `<span class="settings-row-label">` and an optional `.settings-row-value` span. The chevron `<span aria-hidden="true">›</span>` is omitted on the Version row and the Clear All Data row.
  - The Clear All Data row keeps `id="clearDataBtn"`, so existing tests and wiring still find it. Delete the old `#clearDataBtn` button in the Data & Storage panel.
  - Wrap the existing panel contents into the seven `section.settings-page` elements:
    - Appearance keeps the theme.
    - Language gets the locale and currency selects.
    - The settings-only backup block moves into `#settingsPage-backup`.
    - The rest of Data & Storage moves to Advanced.
  - Add the narrow header with `#settingsBackBtn` (text from `settings.back`). Delete `#settingsModalDoneBtn`.
  - Version row text: `<span id="settingsAboutVersion">`, filled with `APP_VERSION`.
- [x] **Step 4: Implement `src/settingsNav.js`** per the Interfaces.
  - Use `matchMedia('(min-width: 768px)')` with a `change` listener that re-applies the current page (Review Focus 2).
  - Tab trap: on `keydown` Tab in the modal, wrap between the first and last focusable visible elements (`offsetParent !== null`).
  - The accessible name of a row with a value is set with `aria-label` built as `t('settings.rowWithValue', { label, value })`, where the en string is `"{label}, {value}"`. It is refreshed by `refreshSettingsRowValues()` (Task 4).
- [x] **Step 5: Wire it up.** In `setupWizard.js`:
  - Delete the tab code (`tabBtns`, `showSettingsTab`).
  - `initSettingsModal` calls `initSettingsNav(modal)`.
  - `open()` becomes the body of `openSettings`.
  - `modal.onkeydown` Escape: `if (!handleSettingsEscape()) close();`.
  - The 30 ms focus-on-open now targets the active page heading (wide) or the first row (narrow).
  - `settingsBtn.onclick = () => openSettings(app)`.
  - Add the app wrapper.
  - Add a `KEYBOARD_SHORTCUTS` entry `{ keys: 'Esc', descKey: 'shortcuts.settingsBack' }`, matching the existing entry shape.
- [x] **Step 6: CSS.** Add the spec's Visuals for the shell, the panes, list groups, rows, icon tiles (one class per row colour), the selected row, the danger row and the narrow sheet with its slide. Switch styling comes in Task 2.
- [x] **Step 7: Add the locale keys:**
  - `settings.navAria`, `settings.groupGeneral`, `settings.groupData`, `settings.groupAccount`, `settings.groupAbout`;
  - `settings.pageAppearance`, `settings.pageLanguage`, `settings.pageNotifications`, `settings.pageBackup`, `settings.pageAdvanced`, `settings.pageSecurity`, `settings.pageAbout`;
  - `settings.back`, `settings.rowWithValue`, `settings.version`, `shortcuts.settingsBack`.
  - Delete the now-unused `settings.tab*` and `settings.done` keys from all three files.
- [x] **Step 8: Run** `pytest tests/ui/test_settings_redesign.py -v`. Expected: PASS. Also run `node --check src/settingsNav.js src/setupWizard.js`.
- [x] **Step 9: Commit**: `feat(settings): grouped list, drill-in and two-pane navigation (#495)`.

### Task 2: Save on change and switches

**Files:**
- Modify: `src/setupWizard.js`, `src/notificationSettings.js`, `index.html` (toggles), `styles.css`
- Test: `tests/ui/test_settings_redesign.py`

**Interfaces:**
- Consumes: `openSettings`, `open_settings_page` (Task 1).
- Produces, in `src/notificationSettings.js`: `export function saveNotificationField(app, id) -> boolean`.
  - Writes only that control's setting if it changed.
  - For `settingNotifyDaysAhead` with an invalid value, it calls `setDaysError(true)` and returns `false` without writing. A valid value clears the error.
  - `saveNotificationSettingsForm` is deleted, so no caller remains.
- `initNotificationSettings` attaches `change` → `saveNotificationField(app, id)` to every notification control. Days ahead also validates on `input`, showing the error without writing.

- [x] **Step 1: Write the failing tests.** Assert the server copy through `wait_for_api(page, '/api/settings', check)` (the settings GET returns the list of `{key, value}`); use a small helper `_setting(rows, key)`.
  - `test_advanced_switch_saves_on_change_without_done`: `open_settings_page(page,'advanced')`, click `#settingShowArchivedDebts`, then `wait_for_api` until `showArchivedDebts` is `True`, and `#settingsModalDoneBtn` has count 0.
  - `test_close_does_not_revert`: change `#settingZeroAmountPolicy` to `'warn'`, click `#settingsModalCloseBtn`, `wait_for_api` until `'warn'`, then reopen and confirm the select value is `'warn'`.
  - `test_invalid_days_ahead_not_saved`: fill `#settingNotifyDaysAhead` with `'99'` and press Tab. `#settingNotifyDaysAheadError` is visible, the input has `aria-invalid="true"`, and the server `notifyDaysAhead` is unchanged (3) after 1 s. Then fill `'5'` and press Tab: the error is hidden, `aria-invalid="false"`, and the server value is 5. Parametrize the invalid value over `'99'`, `'-1'`, `'abc'` and `''`.
  - `test_rapid_toggle_ends_at_final_value` (Review Focus 1): click `#settingNotifyBillDue` twice with no wait, then `wait_for_api` until `notifyBillDue` is `True`, and again after 1 s it is still `True`.
  - `test_language_change_keeps_page_and_focus` (Review Focus 4): `open_settings_page(page,'language')`, `select_option('#settingLocale','es')`. `#settingsPage-language` stays visible, `#settingsPageTitle-language` text equals the es `settings.pageLanguage`, and `document.activeElement.id == 'settingLocale'`.
  - `test_toggles_are_switches`: every `#settingsModal input[type=checkbox]` except hidden file inputs has `role="switch"` and a non-empty accessible name (the `label[for]` text).
- [x] **Step 2: Run to verify failure.** Run `pytest tests/ui/test_settings_redesign.py -k "saves or revert or days or rapid or language_change or switches" -v`. Expected: FAIL.
- [x] **Step 3: Implement.** In `setupWizard.js`, replace `save()` with `change` listeners that perform `save()`'s per-control calls:
  - `adjustsCheckbox` → `setSetting(app, RECONCILIATION_ADJUSTS_BALANCE, checked)`, and likewise for the other three switches and `zeroPolicySelect`;
  - `localeSelect` → `app.setLocale(value)`, then `refreshSettingsRowValues()` (Task 4; a no-op stub until then);
  - `currencySelect` → `setCurrencyCode(value); app.refreshCurrentPageData();`.
  Delete `doneBtn`. Then implement `saveNotificationField`.
- [x] **Step 4: Switch markup and CSS.** Add `role="switch"` to the toggle checkboxes in `index.html`. Style `.settings-shell input[role="switch"]` as a pill: `appearance: none`, 44×26 track, knob via `::before`, translated when `:checked`, track `--primary-color` when on, `:focus-visible` outline.
- [x] **Step 5: Run the tests.** Same command as Step 2. Expected: PASS.
- [x] **Step 6: Commit**: `feat(settings): save each control on change; switches`.

### Task 3: Backup & Restore page and entry points

**Files:**
- Modify: `index.html` (move `#dataTransferModal` contents into `#settingsPage-backup`, delete the modal and `#dataTransferBtn` if it exists only to open it), `src/dataTransferModal.js`, `src/ui.js` (~606-630), `src/commandPalette.js` (~60-95), `src/locales/*`, `styles.css`
- Test: `tests/ui/test_data_transfer_modal.py` (rewrite in place for the Backup page), `tests/ui/test_settings_redesign.py`

**Interfaces:**
- Consumes: `app.openSettings({ page })` (Task 1).
- Produces:
  - `initDataTransferModal(app)` keeps its name and exports. It binds `exportJsonBtn`, `exportChartsPngBtn`, `importJsonBtn` and the mode choice inside `#settingsPage-backup`.
  - New `export function resetBackupPage()` in `dataTransferModal.js` holds the old `close()` reset body (banner, warnings, choice). `openSettings` calls it on every open (Review Focus 3).
  - `showImportResult` and `requestImportModeChoice` keep their signatures.
- Entry points:
  - account menu `accountMenuBackupBtn` → `app.openSettings({ page: 'backup' })`;
  - command palette Backup/Import commands → `app.openSettings({ page: 'backup' })` (the Import command also focuses `#importJsonBtn`).
  - Grep `src/` and `index.html` for `dataTransferBtn` and repoint every reference.

- [x] **Step 1: Write the failing tests:**
  - `test_account_menu_backup_opens_backup_page`: click `#accountMenuBtn`, then `#accountMenuBackupBtn` → `#settingsPage-backup` visible.
  - `test_command_palette_import_opens_backup_page`: Ctrl+K, type "Import", Enter → `#settingsPage-backup` visible and `#importJsonBtn` focused.
  - `test_data_transfer_modal_is_gone`: `#dataTransferModal` count is 0, and so is `[data-dt-tab]`.
  - `test_backup_result_cleared_on_reopen` (Review Focus 3): call `showImportResult('error','x',[{recordType:'debt',recordName:'d',kind:'rejected',reason:'r'}])` through `page.evaluate` with a dynamic import, close, reopen at `backup` → `#importResultBanner` hidden and `#importWarningsList` empty.
  - Rewrite every test in `tests/ui/test_data_transfer_modal.py`: replace opening the modal with `open_settings_page(page, 'backup')`, drop tab clicks, keep each test's assertions (no native dialogs, inline error banner, `<details>` warnings built without `innerHTML`, Replace/Merge choice).
- [x] **Step 2: Run to verify failure.** Run `pytest tests/ui/test_settings_redesign.py tests/ui/test_data_transfer_modal.py -v`. Expected: FAIL.
- [x] **Step 3: Implement the markup move, `resetBackupPage`, the bindings and the entry points.**
  - Group the Backup page into two cards titled by new keys `settings.backupFull` and `settings.backupSettingsOnly`.
  - Delete the now-unused `dataTransfer.title`, `dataTransfer.tabExport` and `dataTransfer.tabImport` keys if nothing references them (grep first).
- [x] **Step 4: Run the tests** (same command). Expected: PASS.
- [x] **Step 5: Commit**: `feat(settings): Backup & Restore becomes a Settings page`.

### Task 4: About page, row values, icons

**Files:**
- Modify: `index.html`, `src/settingsNav.js`, `src/setupWizard.js`, `src/locales/*`, `styles.css`
- Test: `tests/ui/test_settings_redesign.py`

**Interfaces:**
- Produces, in `settingsNav.js`: `export function refreshSettingsRowValues()`. It sets:
  - `#settingsRowValue-appearance` to the selected `#themeSwitcher` option's text;
  - `#settingsRowValue-language` to `` `${localeSelect selected text} · ${currencySelect.value}` ``.
  It then rebuilds both rows' `aria-label`. It is called from `openSettings`, after a theme change, and after locale or currency changes.
- About page:
  - Version row (static).
  - `#settingsAboutWhatsNewBtn` calls the same function `accountMenuWhatsNewBtn` calls in `ui.js`.
  - `#settingsAboutShortcutsBtn` calls `app.openKeyboardShortcuts()`.
- Both open on top of Settings. Settings' Escape handler must ignore keydown while another `.modal-overlay:not(.hidden)` with a higher z-index is open (Review Focus 5).

- [x] **Step 1: Write the failing tests:**
  - `test_row_values_show_theme_and_language`: open, then `#settingsRowValue-language` text contains `·` and `USD`. Change the theme select → the appearance value text equals the selected option's text. The row's `aria-label` starts with its label and contains the value.
  - `test_about_shows_version`: `open_settings_page(page,'about')` → `#settingsAboutVersion` text equals `window.APP_VERSION`-equivalent (read it with `page.evaluate` importing `/src/utils.js`).
  - `test_about_modal_escape_returns_to_settings` (Review Focus 5): click `#settingsAboutShortcutsBtn` → `#keyboardShortcutsModal` visible. Escape → shortcuts hidden, `#settingsModal` visible, `#settingsPage-about` visible, focus on `#settingsAboutShortcutsBtn`. Repeat with What's New.
  - `test_clear_all_data_row_still_confirms`: click `#clearDataBtn` → `#deleteConfirmModal` visible, and Settings is closed (the existing behaviour).
- [x] **Step 2: Run to verify failure.** Expected: FAIL.
- [x] **Step 3: Implement the About markup and handlers, `refreshSettingsRowValues`, the Escape guard, and the icons.**
  - Draw seven 24×24 inline SVGs, one per row, in the toolbar icons' stroke style: palette, globe, bell, archive-box, sliders, lock, info. Add a trash icon for Clear All Data.
  - Add the tile colour classes `settings-icon--blue|purple|red|green|gray|orange|slate`.
  - New locale keys: `settings.aboutWhatsNew`, `settings.aboutShortcuts`.
- [x] **Step 4: Run the tests.** Expected: PASS.
- [x] **Step 5: Commit**: `feat(settings): About group, live row values, icons`.

### Task 5: Migrate the existing tests and add the guard

**Files:**
- Modify: every test file that matches the guard patterns. On main at 6552bb1 that is 50 files with Settings tab clicks, 31 with Done clicks and 33 with the data transfer modal. Measure again with the guard's own scan.
- Modify: `tests/features/i18n_render_support.py` (`settings-*` entries at ~504+, plus any data-transfer entries)
- Create: `tests/features/test_settings_redesign_guard.py`
- Modify: `.github/workflows/ci.yml` (register the new test files: the guard in shard K, `test_settings_redesign.py` in a light `test-ui-*` shard)

**Interfaces:**
- Consumes: `open_settings_page`, `open_settings_page_async` (Task 1), `wait_for_api` (existing).

- [x] **Step 1: Write the guard test.**
  - It scans `tests/**/*.py`, `src/**/*.js` and `index.html` for `settingsModalDoneBtn`, `data-settings-tab`, `data-dt-tab`, `settings-tab-btn`, `dt-tab-btn`, and for the regex `['"#]dataTransferModal['"\b]` (the id, not the module name `dataTransferModal.js`).
  - It asserts there are no hits, listing `file:line` for each.
  - It also asserts every name in `SETTINGS_PAGES` has a `TRANSLATED_PAGES` key `settings-<name>`.
- [x] **Step 2: Run it.** Run `pytest tests/features/test_settings_redesign_guard.py -v`. Expected: FAIL, listing the hits.
- [x] **Step 3: Migrate each hit.** Apply these rules, in this order:
  - A tab click becomes `open_settings_page(page, <mapped page>)`. Tab mapping: `appearance` → `appearance`, except locale/currency → `language`; `data` → `backup` for settings export/import and `advanced` for Clear All Data; `notifications` → `notifications`; `advanced` → `advanced`; `security` → `security`.
  - For a Done click: delete it. If the test then reloads or reads the server, insert `wait_for_api` for the changed setting first. If it asserted the modal closed after Done, click `#settingsModalCloseBtn` instead.
  - Opening `#dataTransferModal` becomes `open_settings_page(page,'backup')`. A visibility wait on `#dataTransferModal` becomes one on `#settingsPage-backup`.
  - In `i18n_render_support.py`, the `settings-*` entries call `window.app.openSettings({ page })`. Add entries for `settings-language`, `settings-backup` and `settings-about`. Replace any `#dataTransferModal` entry with `settings-backup`.
- [x] **Step 3a: Prove the migration** without a full local stack where none is available: re-run the guard (expect PASS) and `python -m py_compile` on every touched file. The Playwright run is CI's job, and the PR stays draft until it is green.
- [x] **Step 4: Commit**: `test: migrate tests to the Settings pages; add a guard`.

### Task 6: Accessibility, contrast and clipping coverage

**Files:**
- Modify: `tests/ui/test_mobile_no_card_clipping.py` (`CARD_SELECTORS` gets `.settings-group`, `.settings-card`), `tests/ui/test_settings_redesign.py`
- Possibly modify: `styles.css` (fixes only)

- [ ] **Step 1: Write the tests:**
  - `test_settings_text_contrast[light|dark|hc]`: with `contrast_utils.set_theme`, assert `text_contrast` ≥ 4.5 for a row label, a `.settings-row-value`, a group heading, a page help line and the danger row.
  - `test_switch_state_not_color_only`: the switch knob's computed `transform` differs between checked and unchecked.
  - Add a Settings case to the phone clipping walk: at 390×844, open each page and assert no card clipping, reusing the file's helper.
- [ ] **Step 2: Run** `pytest tests/ui/test_settings_redesign.py tests/ui/test_mobile_no_card_clipping.py tests/ui/test_aria_labels.py tests/ui/test_css_integrity.py -v`. Fix the CSS for any failure. Expected: PASS.
- [ ] **Step 3: Commit**: `test(a11y): settings contrast, switch state, phone clipping`.

### Task 7: Release and docs

**Files:**
- Modify: `src/utils.js`, `sw.js`, `CHANGELOG.md`, `src/ui.js` (`WHATS_NEW_ENTRIES`), `CLAUDE.md`, `guide.html`, `CONTRIBUTING.md` (only if it mentions either modal), and `sw.js` `PRECACHE_URLS` (add `/src/settingsNav.js`)

- [ ] **Step 1: Bump to 7.20.0:**
  - `APP_VERSION` and `CACHE_NAME`.
  - CHANGELOG `### Changed` (Settings redesign, Backup & Restore merged, save on change) and `### Fixed` (#495).
  - What's New entry: one short paragraph covering the grouped list, Backup & Restore now in Settings, and saving as you go.
- [ ] **Step 2: Docs:**
  - **CLAUDE.md:** rewrite the "Settings modal tabs (issue #322)" bullet into "Settings (7.20.0)" covering the pages, `settingsNav.js`, `openSettings`, save on change and the no-Done rule. Update the Backup & Restore references in "Import warning collection" and "Clear All Data" (#429), and the browser `prompt()` note if it references the modal.
  - **guide.html:** update the Settings and Backup instructions.
- [ ] **Step 3: Run** `pytest tests/features/test_versioning.py tests/features/test_whats_new.py tests/features/test_pwa.py tests/features/test_community_files.py tests/features/test_ci_shard_coverage.py -v`. These need the stack except `test_versioning` and the coverage test. Expected: PASS where runnable.
- [ ] **Step 4: Commit**: `chore: 7.20.0 settings redesign`. Then push and open a **draft** PR with `Closes #495`. Mark it ready only when CI is fully green.
