# Settings redesign: phone-style settings with Backup & Restore merged in

Date: 2026-11-20. Status: approved in brainstorming, spec under review. Target release: 7.20.0.

## Goal

Rework Settings to feel like iOS/Android settings: easier on a phone, easier to find things in, and a modern look. Backup & Restore stops being its own modal and becomes a Settings page. Success means every setting is reachable from one grouped list, each row shows its current value, and the modal works by touch, keyboard and screen reader.

Owner decisions:
- Two-pane layout on wide screens; drill-in list on phones.
- Saving: each control saves on change; there is no Done button.
- An About group is added.
- Calendar feed and Sign out stay in the account menu.

## Current state

- `#settingsModal` (`index.html`, wired in `src/setupWizard.js` `initSettingsModal`) has five `data-settings-tab` tabs: Appearance, Data & Storage, Notifications, Advanced, Security.
  - Values save only on **Done** (`save()`). ✕ and Escape discard. An invalid *Days ahead* blocks the whole save.
  - Theme applies immediately.
  - Sub-modules: `notificationSettings.js`, `securitySettings.js`, `settingsBackup.js`.
- `#dataTransferModal` (`src/dataTransferModal.js`) has Export and Import tabs (`data-dt-tab`).
  - Holds `exportJsonBtn`, `exportChartsPngBtn`, `importJsonBtn`, the Replace/Merge choice (`importModeReplaceBtn`, `importModeMergeBtn`) and the import result with its warnings list (`showImportResult`).
  - Opened from the account menu (`accountMenuBackupBtn`), `dataTransferBtn`, and the command palette (which clicks `[data-dt-tab="import"]`).
- Settings has no Tab focus trap (#495).

## Design

### Structure

The modal keeps the id `#settingsModal` and **every existing control id**. The tab bar is replaced by a navigation list, and panels become pages.

| Group | Row (value shown) | Page contents |
|---|---|---|
| General | Appearance (theme name) | Theme |
| General | Language & Region ("English · USD") | Language, Currency |
| General | Notifications | Today's Notifications panel, unchanged controls |
| Data | Backup & Restore | **Full backup:** Export Backup, Export Charts as PNG, Import (Choose File, Replace/Merge, result + warnings). **Settings only:** today's settings export/import block |
| Data | Advanced | Reconciliation adjusts balance, Show archived debts/recurring, Auto net-worth snapshot, $0 amount policy |
| Account | Security | Change password form |
| About | Version (static, e.g. "7.20.0") | — |
| About | What's New › | Opens the existing What's New modal on top |
| About | Keyboard shortcuts › | Opens the existing Keyboard Shortcuts modal on top |
| Danger zone | Clear All Data (red) | Existing confirm flow (closes Settings first, as today) |

Page ids: `appearance`, `language`, `notifications`, `backup`, `advanced`, `security`, `about`. About also exists as a page, so the phone layout and deep links work.

`#dataTransferModal` and its markup are removed. `dataTransferModal.js` keeps its exports (`initDataTransferModal`, `showImportResult`, `requestImportModeChoice`) and now binds to the controls on the Backup page.

### Layout

- **Wide (≥768px):** a two-pane modal of about 900×640px.
  - The left list pane is about 260px and the right pane is the page.
  - Opening Settings selects the last page used this session, or Appearance by default (in memory only, like today's active tab).
- **Narrow (<768px):** a full-screen sheet.
  - The list shows first. A row opens its page, which slides in (CSS transform; none under the global reduced-motion rule).
  - A sticky header shows "‹ Settings" and ✕.
- **Deep link:** `openSettings(app, { page })`, exposed as `app.openSettings({ page })`.
  - Wide: selects the page.
  - Narrow: opens drilled in, and Back goes to the list.
  - The account menu's Backup & Restore item, `dataTransferBtn` and the command palette use `{ page: 'backup' }`.

### Saving

- Each control commits on `change` through the calls `save()` makes today:
  - `setSetting`, `app.setLocale` and `setCurrencyCode`, followed by `app.refreshCurrentPageData()` where `save()` did that.
  - Notifications: `saveNotificationSettingsForm` is split so that one field can be written on its own `change`. It still writes only values that changed.
  - *Days ahead* that fails validation shows the existing inline error (`aria-describedby`), keeps the typed text, and writes nothing until it is valid.
- ✕ and Escape only close the modal (Escape on a narrow sub-page goes back first; see below). Nothing is discarded or reverted.
- Feedback comes from the existing header save chip (`#saveStatus`); no new UI.
- `#settingsModalDoneBtn` is removed.

### Semantics and keyboard

- **List:** `<nav aria-label="Settings sections">` holding one `<ul>` per group, each introduced by a visible group heading.
  - Rows are `<button>`s.
  - The selected row has `aria-current="page"`.
  - The accessible name includes the value ("Appearance, System").
- **Page:** a `<section>` labelled by its `<h4>`.
- **Toggles:** keep their ids, become `<input type="checkbox" role="switch">`, and are restyled with CSS.
- **Focus:**
  - Tab and Shift+Tab are trapped inside the modal (fixes #495).
  - Opening a page moves focus to its heading (`tabindex="-1"`).
  - Back returns focus to the row it came from.
  - Closing returns focus to the opener.
- **Keys:**
  - ↑ and ↓ move between list rows; Enter or Space opens the focused row.
  - Escape on a narrow sub-page goes back; elsewhere it closes Settings.
  - `KEYBOARD_SHORTCUTS` gains the Escape-back entry.

### Visuals

- **Tokens and CSS:** only existing tokens, in a new `/* Settings redesign (7.20.0) */` section of `styles.css`, with no nesting.
- **Group headings:** small, uppercase, `--text-muted`.
- **Rows:**
  - Grouped into rounded cards with hairline dividers inset past the icon; minimum height 44px.
  - Each row has an icon tile: a coloured rounded square holding an inline SVG (`stroke="currentColor"`, 24×24 viewBox, the toolbar icons' style), with its colour set by a CSS class per row.
  - Then the label, the value right-aligned in `--text-muted`, and a › chevron (`aria-hidden`).
  - The selected row on wide screens has a `--primary-color` tint.
- **Danger row:** `--danger-text`, no chevron, in its own card.
- **Page content:**
  - Setting rows have the label on the left (with an optional muted help line under it) and the control on the right.
  - Selects stay native.
  - Longer content (backup explanations, the import result, the password form) goes in full-width blocks inside a card.
- **Switch:** a pill with a sliding knob, built from the real checkbox (`appearance: none`).
  - On state uses `--primary-color`, and the knob position also changes, so colour isn't the only signal.
  - It has a visible `:focus-visible` ring.
- **Contrast:** values and help text use `--text-muted` (≥4.5:1). Light, dark and high-contrast themes are all checked.

### i18n

- New keys: group names, row labels, page titles, back link, nav label and About strings. All in en/es/pl with real translations.
- Existing control labels keep their keys.
- Every page is added to `TRANSLATED_PAGES`. Row values use existing labels (theme names, language endonyms, currency code).

## Testing

**Migration** (measured on main at 6552bb1):
- 50 test files click Settings tabs. They switch to a new conftest helper, `open_settings_page(page, name)`, plus an async twin, which works at any viewport.
- 31 files click `#settingsModalDoneBtn`. The click is removed. Where the test reloads afterwards, it first calls `wait_for_api` for the setting.
- 33 files use `#dataTransferModal` or `data-dt-tab`. They switch to `open_settings_page(page, 'backup')`.
- A static guard (shard K) fails if a test or `src/` file references `settingsModalDoneBtn`, `data-settings-tab`, `dataTransferModal` as a DOM id, or `data-dt-tab`.

**New tests:** `tests/ui/test_settings_redesign.py`, registered in a `ci.yml` shard.
- Positive:
  - Desktop shows two panes with Appearance selected.
  - At 390×844 the list shows first, drill-in works, and Back returns focus to the row.
  - Row values update.
  - Each control saves on change (checked against the server with `wait_for_api`).
  - Language re-renders live.
  - The account menu and command palette open the Backup page.
  - Export, Import (Replace and Merge) and the warnings list work on the Backup page.
  - About shows `APP_VERSION` and opens What's New and Shortcuts.
  - Clear All Data still confirms first.
  - A deep link at narrow width opens drilled in.
- Negative:
  - Days ahead = 99 shows the error and the server value is unchanged.
  - ✕ after a change keeps it.
  - `#dataTransferModal` does not exist.
  - Tab never leaves the modal.
  - Escape on a narrow sub-page goes back and does not close.
- Accessibility:
  - `aria-current` is on the selected row.
  - `role="switch"` controls have names.
  - Row names include their values.
  - Contrast is measured with `tests/ui/contrast_utils.py`.
  - The new card classes are in `CARD_SELECTORS` (phone clipping guard).
  - `KEYBOARD_SHORTCUTS` matches the panel.
- Existing suites must stay green: i18n render guard, `test_aria_labels.py`, `test_css_integrity.py`, `test_mobile_no_card_clipping.py` and `test_data_transfer_modal.py` (rewritten for the Backup page).

## Rollout

- **Branch:** `feat/settings-redesign`, one PR, built in these commits:
  1. Markup, CSS and navigation.
  2. Save-on-change.
  3. Backup merge and entry points.
  4. Test migration and guard.
  5. Docs.
- **Release 7.20.0:**
  - `APP_VERSION`, `sw.js` `CACHE_NAME`, CHANGELOG.
  - A What's New entry.
  - CLAUDE.md: the Settings modal tabs bullet (#322), Backup & Restore modal references, and the import-warnings rendering note.
  - `guide.html`.
  - CONTRIBUTING.md if it mentions either modal.
- Closes #495.
- Draft PR; marked ready only when CI is green.

## Out of scope

- Search inside Settings.
- Moving Calendar feed or Sign out.
- Changes to the setup wizard.
- Persisting the last-opened page across reloads.
