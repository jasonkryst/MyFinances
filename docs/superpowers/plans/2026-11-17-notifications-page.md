# Notifications Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Notifications page that shows up to 500 stored alerts, filters them, and acknowledges them in bulk (#643).

**Architecture:** The server adds a `limit` query and bulk read/unread routes. A pure, Stryker-scoped `src/notificationsFilter.js` does filtering, grouping and view targets. `notificationsCenter.js` owns the shared state for the bell and the page. The lazy `src/notificationsPage.js` renders the page.

**Tech Stack:** Vanilla ES modules, Express + Postgres, node:test, Jest/Stryker, Playwright (pytest).

**Spec:** `docs/superpowers/specs/2026-11-17-notifications-page-design.md`

## Global Constraints

- `GET /api/notifications` `limit`: an integer from 1 to 500; missing means 50; anything else is 400 `VALIDATION_FAILED`.
- Bulk `ids`: 1 to 500 distinct positive safe integers; anything else is 400. Other users' ids are ignored, never a 404.
- Default status filter: `unread`. Filters live only in memory (`app._notificationsFilters`) and are never written to browser storage.
- Bell and page reads/writes use plain `fetch` (not `pgFetch`): no save chip, no live-refresh broadcast.
- Every new string goes in en/es/pl (`notifyPage.*`, `notify.viewAll`), with real translations.
- No inline styles. `escapeHtml` everything in `innerHTML`. Per-item buttons get `aria-label`s that start with their visible word and name the item.
- Release 7.17.0: `APP_VERSION`, `sw.js` `CACHE_NAME`, CHANGELOG, What's New.

## Review Focus

1. **More than 500 alerts.** When `total > loaded`, the header says "Showing 500 of N", and "Mark all matching" acts only on the loaded ones. Covered by a Jest test of `summarizeNotifications` with `total` (Task 2).
2. **The account was deleted or archived.** View must not throw. With no `[data-account-id]` card, it still opens Accounts. `notificationViewTarget` returns `accountId`, and the page checks that the card exists (Task 4, Playwright).
3. **Double-clicking a bulk button.** It must send a single POST. The bulk bar is wrapped in `withBusy` (Task 4, Playwright: the badge count drops exactly once).
4. **A live refresh during a selection.** Selected ids that are still present stay selected, and vanished ids are dropped (Task 4, Jest for `pruneSelection`).
5. **Undo after a check pruned or changed alerts.** `/unread` with stale ids returns 200 with `updated` < ids.length and doesn't fail (Task 1, server test).

---

### Task 1: Server — limit, total, bulk read/unread

**Files:**
- Modify: `server/src/routes/notifications.js`
- Test: `server/test/notificationsPage.test.js` (create; copy the session/csrf setup from `server/test/notifications.test.js`)
- Docs: `server/README.md` notifications routes section

**Interfaces:**
- Produces: `GET /api/notifications?limit=N` → `{ notifications, unreadCount, total, emailConfigured }`; `POST /api/notifications/read` and `POST /api/notifications/unread`, body `{ ids }`, → `{ ok: true, updated, unreadCount }`. Export `MAX_LIST_LIMIT = 500` and `parseIdList(value) -> number[] | null`.

- [ ] **Step 1: Write failing tests:**
  - `limit defaults to 50`: insert 60 rows, so the list has 50 and `total === 60`;
  - `limit=500 returns all 60`;
  - `limit=0, 501, 1.5, abc each 400`;
  - `bulk read marks only the given ids and returns unreadCount`;
  - `bulk read ignores another user's ids` (their row's `read_at` stays null, and `updated` counts only own rows);
  - `bulk unread clears read_at`;
  - `stale ids are fine`: deleted ids give 200, `updated: 0`;
  - `ids validation`, a 400 for each of: missing, `[]`, 501 ids, `[1,1]`, `[0]`, `[-3]`, `['2']`, `[1.5]`, a non-array, `null`;
  - `requires a session` (401) and `requires csrf` (403) for both POSTs.
  Insert rows directly with `query('INSERT INTO notifications (user_id,type,dedupe_key,params,show_in_app) …')`.
- [ ] **Step 2: Run** `cd server && npm test -- test/notificationsPage.test.js` (Docker Postgres recipe from the memory notes). Expected: FAIL.
- [ ] **Step 3: Implement.** `parseIdList` rejects non-arrays, a length of 0 or over 500, duplicates, and any value that is not a `Number.isSafeInteger` or is `<= 0`. The UPDATE uses `WHERE user_id = $1 AND id = ANY($2::bigint[])`, and the unread count is computed afterwards. Register `/read` and `/unread` before `/:id/read`.
- [ ] **Step 4: Run.** The new file and `notifications.test.js` pass.
- [ ] **Step 5: Commit** `Notifications: list limit, total and bulk read/unread routes (#643)`.

### Task 2: Pure core `src/notificationsFilter.js`

**Files:**
- Create: `src/notificationsFilter.js` (no imports)
- Test: `tests/unit/notificationsFilter.test.js`
- Modify: `tools/strykerScope.mjs` (`MUTATE_SCOPE` entry, every exported function)

**Interfaces (all hoisted `function` exports):**
- `notificationAccountId(n) -> number|null`
- `notificationCategory(type) -> 'bill'|'balance'|'projected'|'other'`
- `normalizeNotificationFilters(f) -> { category, status, accountId, from, to }`. Defaults: `'all'`, `'unread'`, `'all'`, `null`, `null`. Invalid values become the defaults. `accountId` is a positive int or `'all'`, and dates must match `YYYY-MM-DD`.
- `filterNotifications(items, filters) -> items[]`. It calls normalize, keeps the input order, and compares dates on the local date of `createdAt`.
- `groupNotificationsByDay(items, now: Date) -> [{ key, items }]`. `key` is one of `today`, `yesterday`, `thisWeek` (2 to 6 days ago) or `earlier`; empty groups are left out and the order is kept.
- `summarizeNotifications(items, total) -> { loaded, total, unread, active, truncated }`
- `notificationViewTarget(n) -> { page: 'ledger'|'accounts', accountId: number|null }`: bills go to the Ledger, everything else to Accounts.
- `pruneSelection(selectedIds: Set<number>, items) -> Set<number>`

- [ ] **Step 1: Write failing Jest tests.** Each dimension gets a positive and a negative case:
  - Category: `bill` keeps `billDueSoon` and `billDueToday` and drops `lowBalance`.
  - Status: `unread`, `read`, `active` (`resolvedAt` null), `resolved` and `all`.
  - `accountId`: given as a number or as a string `'2'`, and a row without one is excluded.
  - `from`/`to`: inclusive at both ends, using local-midnight `createdAt` values.
  - Junk filters (`status:'bogus'`, `from:'2026-13-99'`, `accountId:-1`, `null`) fall back to the defaults.
  - Grouping at 00:00 today, 23:59 yesterday, exactly 6 vs 7 days ago, and with an empty input.
  - `notificationAccountId` with a missing `params`, `'abc'`, `0` or `2.5`.
  - `summarizeNotifications` with `truncated` true when `total > loaded`.
  - `pruneSelection` drops ids that have gone.
- [ ] **Step 2: Run** `npx jest tests/unit/notificationsFilter.test.js tests/unit/strykerScope.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the module and add the scope entry.
- [ ] **Step 4: Run the same command.** It passes. Optionally run `npx stryker run --mutate src/notificationsFilter.js` and aim for 100% killed.
- [ ] **Step 5: Commit** `Notifications: pure filter/group core (#643)`.

### Task 3: Shared client state + bell "View all"

**Files:**
- Modify: `src/notificationsCenter.js`, `index.html` (bell panel footer `#notificationsViewAllBtn`, `data-i18n="notify.viewAll"`), `src/locales/{en,es,pl}.js`, `styles.css` (append a small section for the footer link)

**Interfaces:**
- Consumes: the Task 1 routes.
- Produces (exports from `notificationsCenter.js`):
  - `loadAllNotifications() -> Promise<state>`, which fills `state.all` and `state.total`, and sets `<html data-notifications-all-loaded="true|failed">`;
  - `markNotificationsRead(ids: number[]) -> Promise<number[]>`, which resolves to the ids that changed from unread to read;
  - `markNotificationsUnread(ids) -> Promise<void>`;
  - `onNotificationsChange(fn) -> unsubscribe`.
  Every local read-state change applies to both `state.items` and `state.all` by id, updates `unreadCount`, re-renders the bell, and notifies the subscribers. A failed POST re-syncs both lists.

- [ ] **Step 1: Implement** the exports. `markNotificationRead` and `markAllNotificationsRead` also mirror into `state.all` and notify. "View all" closes the panel and calls `app.switchPage('notifications')`.
- [ ] **Step 2: Verify** with `node --check src/notificationsCenter.js` and `pytest tests/features/test_notifications.py -v`; there are no regressions.
- [ ] **Step 3: Commit** `Notifications: shared bulk state and bell View all link (#643)`.

### Task 4: The page

**Files:**
- Create: `src/notificationsPage.js`
- Modify:
  - `src/lazyModules.js`: `loadNotificationsPageModule()`;
  - `src/app.js`: an async wrapper `renderNotificationsPage()`;
  - `src/ui.js`: `renderPageData` gets `pageName === 'notifications'`, and `switchPage` page mapping;
  - `src/commandPalette.js`: `nav('notifications', …, '🔔')`;
  - `index.html`: `<section id="notificationsPage">` markup with the filter disclosure, bulk bar, and `#notificationsPageList`;
  - `src/locales/*`;
  - `styles.css`: a "Notifications page (#643)" section at the end, with mobile card rules;
  - `tests/features/i18n_render_support.py`: `TRANSLATED_PAGES`;
  - `tests/ui/test_mobile_no_card_clipping.py`: page list, plus `CARD_SELECTORS` if there is a new card class.
- Test: `tests/features/test_notifications_page.py`

**Interfaces:**
- Consumes: everything Tasks 2 and 3 produce, plus `offerUndo(message, undoFn)` (`src/undo.js`), `withBusy(root, fn)` (`utils.js`), `plural()` and `t()` (`i18n.js`), and `notificationMessage(type, params)` (`notificationsCenter.js`).
- Produces: `renderNotificationsPage(app)` and `initNotificationsPage(app)` (idempotent, delegated listeners). DOM ids: `#notifFilterType`, `#notifFilterStatus`, `#notifFilterAccount`, `#notifFilterFrom`, `#notifFilterTo`, `#notifFilterClear`, `#notifSelectAll`, `#notifMarkSelectedBtn`, `#notifMarkMatchingBtn`, `#notifRefreshBtn`, `#notifSummary`. Each row is `li.notif-row[data-notification-id]`, with `input.notif-row-select`, `button.notif-row-view` and `button.notif-row-read`.

- [ ] **Step 1: Write failing Playwright tests.** Seed alerts by seeding accounts and then calling `POST /api/notifications/check` through the page (`page.evaluate(fetch…)` with the csrf cookie):
  - 3 overdrawn accounts give `zeroBalance` alerts;
  - 1 account under its threshold gives `lowBalance`;
  - 1 muted overdrawn account gives no alert.
  Tests:
  - `test_view_all_opens_page`: "View all" in the bell opens the page and the list has 4 rows;
  - `test_palette_opens_page`;
  - `test_status_filter_default_unread_and_all`: mark one read, it disappears under Unread and shows under All;
  - `test_type_filter`: Low balance shows 1;
  - `test_account_filter`;
  - `test_date_filter_excludes`: From tomorrow shows the no-match state, and Clear restores the list;
  - `test_bulk_mark_selected_read_updates_badge`: double-click Mark selected, and the badge drops by exactly 2;
  - `test_mark_all_matching`;
  - `test_undo_restores_unread`;
  - `test_view_balance_alert_scrolls_to_account`: the alert is read and the card is highlighted;
  - `test_view_with_deleted_account_still_navigates`;
  - `test_empty_state` and `test_load_failed_shows_retry` (stub `/api/notifications?limit=500` with `service_workers='block'`).
  Add the file to a CI shard in `.github/workflows/ci.yml`, picking one with headroom.
- [ ] **Step 2: Run** `pytest tests/features/test_notifications_page.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement the page.**
  - Render flow: `loadAllNotifications()` → `filterNotifications` → `groupNotificationsByDay(new Date())`.
  - The account select lists non-archived `app.accounts`.
  - Selection is a module `Set`, passed through `pruneSelection` on every render.
  - Mark selected and Mark all matching call `markNotificationsRead`. If the result is non-empty, `offerUndo(plural('notifyPage.markedRead', n), () => markNotificationsUnread(changed))`.
  - View calls `markNotificationsRead([id])`. Then for the Ledger it sets `app._ledgerAccountFilter = accountId ?? 'all'` and `switchPage('ledger')`. For Accounts it calls `switchPage('accounts')`, then scrolls to `[data-account-id="…"]` if present and adds a 2 s `.notif-highlight` class.
  - Subscribe through `onNotificationsChange` and re-render only while `app._currentPage === 'notifications'`. After a live refresh (wherever `refreshNotifications()` is already called), call `loadAllNotifications()` too, but only if the page is current.
  - Set `data-notifications-page-ready` after each render, for the tests.
- [ ] **Step 4: Run.** The new tests pass, plus `tests/features/test_i18n_coverage.py`, `test_i18n_render_guard.py`, `test_i18n_render_guard_empty.py`, `tests/ui/test_aria_labels.py`, `tests/ui/test_css_integrity.py`, `tests/ui/test_mobile_no_card_clipping.py` and `tests/features/test_ci_shard_coverage.py`.
- [ ] **Step 5: Commit** `Notifications page: view all, filter, bulk mark read, undo, deep links (#643)`.

### Task 5: Keyboard shortcuts

**Files:**
- Modify: `src/notificationsPage.js`, `src/keyboardShortcuts.js` (new group "Notifications page": `j`/`k`, `x`, `e`, `Enter`)
- Test: `tests/features/test_notifications_page.py`

- [ ] **Step 1: Write failing tests.**
  - `test_keyboard_flow`: `j` focuses row 1, `j` moves to row 2, `x` selects it, `e` marks the focused row read, `k` moves back.
  - `test_keys_ignored_while_typing`: type `jxe` into `#notifFilterFrom`, or a text input, and nothing changes.
  - `test_keys_inactive_off_page`: on Health, `j` doesn't throw and changes nothing.
  - `tests/ui/test_keyboard_shortcuts.py` passes with the new rows.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** one `keydown` listener on `document`. It skips events with a modifier, while a dialog is open, while focus is in an input, select, textarea or contenteditable, and when the page isn't current. Use roving `tabindex` on the rows.
- [ ] **Step 4: Run.** The tests pass.
- [ ] **Step 5: Commit** `Notifications page: keyboard triage shortcuts (#643)`.

### Task 6: Release + docs

**Files:** `src/utils.js` (`APP_VERSION = '7.17.0'`), `sw.js` (`CACHE_NAME`), `CHANGELOG.md`, `src/ui.js` (`WHATS_NEW_ENTRIES` top entry, with strings in all locales if they're keyed), `CLAUDE.md` (Notifications bullet: the page, routes, pure core, shared state), `guide.html` (only if it documents the bell), `ACCESSIBILITY.md`/`CONTRIBUTING.md` (only if affected).

- [ ] **Step 1: Edit** the files.
- [ ] **Step 2: Run** `pytest tests/features/test_versioning.py tests/features/test_whats_new.py tests/features/test_pwa.py tests/features/test_community_files.py -v`. They pass.
- [ ] **Step 3: Run** the full local check: `npx jest`, the server suite, and `pytest tests/features/test_notifications.py tests/features/test_notifications_page.py tests/ui -v`.
- [ ] **Step 4: Commit** `Release 7.17.0: Notifications page (#643)`, push, and open a draft PR with `Closes #643`. Once CI is green, mark it ready.
