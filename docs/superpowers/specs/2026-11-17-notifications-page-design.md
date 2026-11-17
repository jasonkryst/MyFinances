# Notifications page — design

Date: 2026-11-17. Builds on #211 (notifications) and the overdrawn/mute change (#641). Target release: 7.17.0.

## Goal

The toolbar bell shows the newest 50 alerts. Users want one place to see every
stored alert (90 days of history), narrow them down, and acknowledge many at
once with little clicking. The bell stays the quick glance.

## Decisions (from the brainstorm)

- **Acknowledge = mark read.** No new alert state, no migration. Read alerts
  stay visible under the Read and All filters. `resolved_at` stays
  server-owned (set when the condition clears).
- **Entry points:** a "View all notifications" link at the bottom of the bell
  panel and a command-palette command. No nav button.
- **In scope:** keyboard shortcuts, a deep-link View action, day grouping,
  and Undo after a bulk mark-read.
- **Approach A:** load up to 500 alerts once and filter in the browser.

## Server (`server/src/routes/notifications.js`)

- `GET /api/notifications?limit=N`: `N` is an integer from 1 to 500. Missing
  means 50 (the bell is unchanged). Anything else (non-integer, 0, over 500)
  is a 400 `VALIDATION_FAILED`. The response gains `total` (all `show_in_app`
  rows for the user), so the page can say "showing 500 of 612".
- `POST /api/notifications/read` with body `{ ids: number[] }`: 1 to 500
  distinct positive safe integers, otherwise 400. It sets
  `read_at = COALESCE(read_at, now())` for the caller's rows only, and returns
  `{ ok, updated, unreadCount }`. Other users' ids are silently ignored
  (never a 404 that reveals they exist).
- `POST /api/notifications/unread` with the same body and validation sets
  `read_at = NULL`. It backs Undo.
- The existing `/:id/read` and `/read-all` stay. Express matches the literal
  `/read` before `/:id/read`, because they differ in segment count anyway.

## Pure core (`src/notificationsFilter.js`)

DOM-free and import-free. It is added to `MUTATE_SCOPE` and covered by Jest.

- `notificationAccountId(n)` returns `params.accountId` as a positive integer,
  or `null`.
- `notificationCategory(type)` returns `bill` (`billDueSoon`, `billDueToday`),
  `balance` (`lowBalance`, `zeroBalance`), `projected` (`projectedLow`) or
  `other`.
- `filterNotifications(items, filters)`. `filters` is
  `{ category, status, accountId, from, to }`. Each part defaults to "all",
  except status, which defaults to `unread`. Status is one of `unread`,
  `read`, `active` (`resolvedAt` null), `resolved` or `all`. `from` and `to`
  are inclusive ISO dates compared against the local date of `createdAt`.
  Unknown values fall back to the default and never throw. The order of the
  input is kept.
- `groupNotificationsByDay(items, now)` returns
  `[{ key: 'today'|'yesterday'|'thisWeek'|'earlier', items }]`. Empty groups
  are left out. "This week" means the 2 to 6 days before today.
- `summarizeNotifications(items)` returns `{ total, unread, active }` for the
  header.

## Shared client state (`src/notificationsCenter.js`)

- It gains `markNotificationsRead(ids)` and `markNotificationsUnread(ids)`.
  Both update `state.items` and `state.unreadCount` optimistically, POST the
  bulk route, and re-sync from the server on failure.
- It gains `loadAllNotifications()`, which fetches `?limit=500` into a separate
  `state.all` list. The bell keeps its own 50-item fetch.
- A read-state change in one list is mirrored into the other by id, and the
  badge is re-rendered. Change subscribers (`onNotificationsChange(fn)`) let
  the page re-render when the bell marks something read.
- The bell panel gets a `#notificationsViewAllBtn` link, which closes the
  panel and calls `app.switchPage('notifications')`.

## Page (`#notificationsPage`, lazy `src/notificationsPage.js`)

- It is a `section` in `index.html`, with no nav button. It is registered in
  `switchPage`/`renderPageData`, gets a command-palette entry, and is added to
  `TRANSLATED_PAGES`. It loads through a new `loadNotificationsPageModule()`
  in `lazyModules.js`.
- **Header:** the page title, the summary "N unread · M active", and a Refresh
  button.
- **Filters:** a `.filters-disclosure` with selects for Type, Status (default
  Unread) and Account (non-archived accounts plus "All"), and From/To date
  inputs. A Clear button resets them. The filters are held in memory only
  (`app._notificationsFilters`) and are never written to browser storage.
- **Bulk bar:** a "Select all visible" checkbox, "Mark selected read"
  (disabled when nothing is selected) and "Mark all matching read". After a
  bulk action, `offerUndo` shows "Marked N read" for 10 s, and Undo POSTs
  `/unread` with exactly those ids. The ids are only the rows that were
  unread before the action.
- **List:** day-group headings, each with a `ul`. A row has a checkbox labelled
  with its message, an icon, the message text, the date, Unread/Resolved tags,
  and "View" and "Mark read" buttons whose `aria-label`s name the message.
  Read rows are visually muted, with no `opacity` on the text.
- **Empty states:** no alerts at all; no alerts match the filters (with Clear
  filters); and failed to load (with Retry).
- **Deep links (View):** they mark the alert read.
  - A bill alert with an account sets `app._ledgerAccountFilter` and opens the
    Ledger. Without an account it opens the Ledger unfiltered.
  - A balance or projected alert opens Accounts and scrolls to and highlights
    `[data-account-id]`, if that card exists.
- **Keyboard:** only while the page is visible, and never while focus is in an
  input, select or textarea. `j`/`k` move a roving focus between rows, `x`
  toggles the selection, `e` marks the focused row read, and `Enter` runs
  View. All of them are added to `KEYBOARD_SHORTCUTS`.
- **Mobile:** below 768px the filters collapse and each row stacks as a
  card. 40px tap targets.
- **Live refresh:** the page re-renders when the shared state changes. A
  `myfinances:data-written` refresh reloads the list only while the page is
  visible.

## i18n

New `notifyPage.*` keys, plus `notify.viewAll`, in en, es and pl, with real
translations. Plurals go through `plural()`.

## Tests

- **Server** (`server/test/notificationsPage.test.js`): the `limit` default,
  bounds and 400s, and `total`. Bulk read/unread: success, partial (other
  user's ids are ignored and not updated), and validation 400s (empty, over
  500, non-integer, duplicates, non-array). The unread count is returned.
- **Jest** (`tests/unit/notificationsFilter.test.js`): every filter dimension,
  both positive and negative; bad filter values; date boundaries;
  day-grouping edges (midnight, 6 vs 7 days); `notificationAccountId` with
  junk input.
- **Playwright** (`tests/features/test_notifications_page.py`, added to a CI
  shard): seed alerts through `POST /api/notifications/check`, or by inserting
  state that raises them. Cover:
  - reaching the page from "View all" and from the palette;
  - each filter, and Clear;
  - select and bulk mark read, with the badge updating;
  - mark all matching;
  - Undo restoring unread;
  - the keyboard flow, and keys ignored while typing;
  - both View deep links;
  - the empty and no-match states.
- The existing guards keep passing: i18n coverage and render guard,
  aria-labels, the keyboard-shortcuts panel, CSS integrity and mobile
  clipping.

## Release

- Bump to 7.17.0: `APP_VERSION`, `CACHE_NAME`, a CHANGELOG entry and a What's
  New entry.
- Docs: CLAUDE.md (Notifications bullet), `server/README.md` (routes), and the
  in-app guide if it documents the bell.

## Out of scope

Dismiss and delete, server-side filtering and paging, and collapsing repeated
alerts.
