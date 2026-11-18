# Bell follows Notifications page filters — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The toolbar bell list and badge follow the Notifications page's saved filters (#649). The same branch also takes #646, #647 and #648.

**Architecture:**
- The filters (type, status, account) are saved per user as three generic settings in Postgres.
- `GET /api/notifications` and `POST /read-all` filter on the server, using the type categories from the pure `src/notificationsFilter.js`.
- The bell sends the saved filters, and the page reads and writes them.
- The From/To dates stay in memory on the page only.

**Spec:** the design approved in chat and recorded in issue #649. It refines #643's spec `docs/superpowers/specs/2026-11-17-notifications-page-design.md`.

## Global Constraints

- **Settings:**
  - `notifyFilterType`: one of `all`, `bill`, `lowBalance`, `overdrawn`, `projected`. Default `all`.
  - `notifyFilterStatus`: one of `unread`, `read`, `active`, `resolved`, `all`. Default `unread`.
  - `notifyFilterAccount`: an integer, 0 means all accounts. Default 0.
  - Allowed by `isAllowedSetting`, and never in `SETTINGS_EXPORT_SCHEMA`, so they are not exported.
- **Query params** on `GET /api/notifications` and `POST /api/notifications/read-all`:
  - `type` (the same values as `notifyFilterType`), `status` (the same values as `notifyFilterStatus`), `account` (a positive integer or `all`).
  - Missing means `all`. Any other value is a 400 `VALIDATION_FAILED`.
  - The type-to-alert mapping comes from `src/notificationsFilter.js`; never write a second copy.
- **`unreadCount`** in the GET response counts unread rows that match `type` and `account`; `status` is ignored for it. `total` counts rows matching all three filters. `/read-all` marks only the unread rows matching `type` and `account`.
- **No filter params** means the behaviour is identical to 7.17.0. Old clients and tests keep working.
- **Bell default:** with no saved setting, the bell sends `status=unread`.
- **Strings:** every new string goes in en, es and pl, translated for real. No inline styles. `escapeHtml` every `innerHTML` value.
- **Release** 7.18.0: `APP_VERSION`, `CACHE_NAME`, CHANGELOG and What's New.

## Review Focus

1. **The saved account was deleted or archived.** The bell must fall back to all accounts instead of showing nothing forever. When the account id is no longer in `app.accounts`, treat it as 0 (Task 3, Playwright).
2. **The page loads 500 rows unfiltered while the bell is filtered.** The shared `state.unreadCount` must stay the filtered count; a page load or bulk-route response must never overwrite it with the unfiltered number (Task 3, Playwright: the badge stays filtered after visiting the page and bulk-marking).
3. **An invalid saved setting**, for example from an older value or a manual edit, normalizes to the defaults and never sends a 400 from the bell (Task 2, Jest).
4. **Another device changes the filters.** A live refresh re-reads the settings and re-fetches the bell (Task 3: refetch on the settings change in `refreshCurrentPageData`, or on `onNotificationsChange`).
5. **Mark all read in the bell with a filter active** must not mark hidden alerts read (Task 1 server test, Task 3 Playwright).

---

### Task 1: Server — filter params

**Files:**
- `server/src/routes/notifications.js`
- the `server/README.md` notifications section
- Test: `server/test/notificationsFilterParams.test.js` (new)

**Interfaces:**
- **Produces:** `parseNotificationFilterQuery(query) -> { types: string[]|null, status, accountId: number|null } | null`, where `null` means invalid (400). Export it for tests.
- **Consumes:** a new pure export `typesForCategory(category) -> string[]|null` from `src/notificationsFilter.js`, which this task adds there with its Jest case. It returns `null` for `all`.
- **SQL** for the filters:
  - type: `type = ANY($n::text[])`
  - account: `params->>'accountId' = $n::text`
  - unread: `read_at IS NULL`
  - read: `read_at IS NOT NULL`
  - active: `resolved_at IS NULL`
  - resolved: `resolved_at IS NOT NULL`

- [ ] **Step 1: Write failing tests.**
  - Each `type` and `status` value returns only the matching rows.
  - `account=2` returns only that account's rows. Rows with no `accountId` are excluded.
  - `unreadCount` ignores `status` but follows `type` and `account`.
  - `total` follows all three filters.
  - `/read-all?type=overdrawn` leaves `lowBalance` rows unread, and with no params it marks everything (as today).
  - 400 for `type=bogus`, `status=x`, `account=0`, `account=-1`, `account=1.5` and a repeated `type`.
  - Another user's rows never appear and are never counted.
- [ ] **Step 2: Implement.** Also #647 server item: `GET` uses `countUnread` (extend it to take the filter).
- [ ] **Step 3: Run the server suite** with the Docker recipe. Commit.

### Task 2: Pure helpers, settings schema, #647 pure items, #648 label

**Files:**
- `src/notificationsFilter.js`
- `src/settingsSchema.js`
- `tests/unit/notificationsFilter.test.js`
- `tests/unit/settingsExport.test.js`, if its exclusion list needs the new keys
- `tools/strykerScope.mjs` for new exports
- `src/locales/{en,es,pl}.js` for `notifyPage.group.thisWeek`

**Interfaces (produces):**
- `NOTIFY_FILTER_TYPE`, `NOTIFY_FILTER_STATUS`, `NOTIFY_FILTER_ACCOUNT` constants, with `isAllowedSetting` accepting the values in Global Constraints.
- `filtersFromSettings({ type, status, account }) -> normalized filters`: `account` 0 or invalid gives `'all'`, and invalid values fall back to the defaults.
- `filtersToSettings(filters) -> { type, status, account }`
- `filtersToQuery(filters) -> string`: `''` when everything is `all`, otherwise `type=…&status=…&account=…`, leaving out the `all` parts.

- [ ] **Step 1: Write failing Jest tests,** positive and negative:
  - round-trips, junk values, and `filtersToQuery` omitting the defaults;
  - `isAllowedSetting` accepts and rejects each key;
  - the keys are not in `SETTINGS_EXPORT_SCHEMA`;
  - #647: `isSafeInteger` (`'99999999999999999999'` gives `'all'`), `summarize` uses `Math.max(total, loaded)`, and an unparseable `createdAt` groups as `earlier`.
- [ ] **Step 2: Implement.** #648: rename the label to "Last 7 days" in en, es and pl. Keep the key and the 2–6 day rule.
- [ ] **Step 3: Run Jest** (Docker) including `strykerScope`, `settingsExport` and `i18n` coverage. Commit.

### Task 3: Bell and page wiring, #646, #647 client items

**Files:**
- `src/notificationsCenter.js`
- `src/notificationsPage.js`
- `index.html` (bell filter line markup)
- `src/locales/*`
- the `styles.css` end section
- Test: `tests/features/test_notification_bell_filters.py` (new; add it to a `ci.yml` shard with headroom)
- extend `tests/features/test_notifications_page.py` for #646

**Rules:**
- The bell reads the saved filters from `app.settings` through `filtersFromSettings` and an account-exists check, then fetches `/api/notifications?` + `filtersToQuery(...)`.
- `state.unreadCount` is set **only** from that bell response. `loadAllNotifications` and the bulk-route responses must not overwrite it; after a mark, call `refreshNotifications()` to re-sync.
- The bell's "Mark all read" sends the same `type` and `account` to `/read-all`.
- **Filtered line:** when any of the three filters is not the default, `#notificationsFilterNote` shows "Filtered: <type> · <status> · <account>" with a `#notificationsFilterClearBtn` (Clear) button and the existing View all link.
- **Empty states:** with no match, show `notify.emptyFiltered`; under the default Unread filter with nothing unread, show `notify.emptyUnread`.
- **Saving:** the page's Type, Status and Account changes call `setSetting` for that key only. Clear (page or bell) sets all three back to the defaults. The dates stay in `app._notificationsFilters` in memory.
- **Live refresh:** when settings change from another tab or device, re-fetching the bell picks up the new filters.
- **#646:** when `e.getModifierState('CapsLock')` and not `shiftKey`, compare the lowercased key. Shift stays ignored.
- **#647 client items:** `markNotificationRead` delegates to `markNotificationsRead`, and `resyncAfterFailure` forces a fresh fetch (no in-flight reuse).

- [ ] **Step 1: Write failing Playwright tests** (seed like `test_notifications_page.py`: 3 overdrawn, 1 low balance):
  - A Type=Overdrawn choice on the page shows 3 rows in the bell and a badge of 3, and survives a reload.
  - A negative case: with Type=Low balance, the 3 new overdrawn alerts leave the badge at 1 and the bell shows only the low-balance row.
  - The filtered line shows, and Clear from the bell resets both the bell and the page's selects.
  - Status default: after marking all read, the bell shows the "no unread" empty state and the badge is hidden.
  - A filtered Mark all read in the bell leaves hidden alerts unread (API check).
  - Saved account deleted: the bell falls back to all.
  - The badge stays filtered after visiting the page and bulk-marking there.
  - #646: Caps Lock `J`/`E` work, and Shift+X still does nothing.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** the new file, `test_notifications_page.py`, `test_notifications.py`, the i18n coverage and render guards, `test_aria_labels`, `test_css_integrity` and `test_keyboard_shortcuts`. Commit.

### Task 4: Release + docs

- 7.18.0: `APP_VERSION`, `sw.js` `CACHE_NAME`, a CHANGELOG entry and a What's New entry.
- CLAUDE.md: update the Notifications "Page (#643)" bullet (saved filters, bell follows them, server filter params).
- `server/README.md`: verify Task 1 covered it.
- Run the versioning, whats_new, pwa and community_files tests and full Jest. Commit.
