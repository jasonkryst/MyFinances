# Notifications (issue #211)

Bill-due and balance alerts, computed on the server by the background job
runner (#579) from the same pure projection code the browser runs, delivered by
email and/or an in-app list.

## Decisions (owner, 2026-11-15)

- **Channel** is a user setting, default **both** (email and in-app).
- **Delivery** is a user setting, default **one email per event**; the other
  choice is a digest (one email per check listing every new alert).
- **Low-balance threshold** is **per account**.

## Alert types

| Type | Fires when | Dedupe |
|---|---|---|
| `billDueSoon` | An outflow (debt minimum payment, recurring subscription, legacy bill) is due within the next *N* days (*N* = `notifyDaysAhead`, 0-30, default 3) and is not Cleared in the Ledger | Once per occurrence (`billDueSoon|<ledger tx id>`) |
| `billDueToday` | The same outflow is due today and not Cleared | Once per occurrence |
| `lowBalance` | An asset account with a `lowBalanceThreshold` has a balance today at or below it, but above $0 | Once per episode |
| `zeroBalance` | An asset account's balance today is at or below $0 | Once per episode |
| `projectedLow` (recommended extra) | An asset account is not low today but its projected balance drops to its threshold (or $0 without one) within the next *N* days | Once per episode |

- **Asset account:** not archived and not `Credit Card`, `Loan` or `Retirement`.
- **Balance today:** `startingBalance` plus this month's (override-aware)
  projected transactions dated on or before today. This is the same model as
  the Accounts breakdown's running balance.
- **Episodes:** a balance alert stays open while its condition holds and is
  resolved by the first check where it no longer does. The next dip alerts
  again. Transfers, inflows and one-off actuals are never "bills".

Each type has its own on/off setting (all on by default). The rules live in the
pure, Stryker-scoped `src/notificationsCore.js`, so the browser could reuse
them.

## Storage

- **`accounts.low_balance_threshold`** is a nullable `numeric` column. Its
  sanitizer accepts a positive amount and turns anything else into null (no
  alert).
- **`notifications` table:**
  - Columns: `user_id`, `type`, `dedupe_key`, `episode_key`, `params jsonb`,
    `show_in_app`, `email_status` (`none | pending | sent | failed`),
    `email_attempts`, `created_at`, `read_at` and `resolved_at`.
  - Constraint: `UNIQUE (user_id, dedupe_key)`.
  - It is not a user resource: it is not exported, imported or merged.
    `pgDeleteAll` clears it.
  - The prune job deletes rows older than 90 days.
- **Stored params, not text:** a notification stores its params (names,
  amounts, dates), and the browser renders it with `t()`, so the in-app list
  follows the user's language. Emails are English: the server has no locale,
  and amounts are formatted without a currency symbol because currency is a
  device preference.

## Runs

- **`notifications` job:** hourly (`hourPeriodKey`) in the `JOBS` registry. For
  each user it loads `loadUserState`, computes alerts, inserts them with
  `ON CONFLICT DO NOTHING`, resolves finished episodes, then sends pending
  emails (per event or as one digest).
- **Failed emails:** they stay `pending` and are retried on later runs, up to 3
  attempts, then marked `failed`. A send failure never fails the job.
- **No SMTP, or channel `inApp`:** `email_status` is `none`.
- **Channel `email`:** the row is still stored (it is the dedupe record) with
  `show_in_app = false`.
- **`POST /api/notifications/check`:** runs the same check for the signed-in
  user only. It is rate-limited and is what "Check now" in Settings uses. It
  works with `JOBS_ENABLED=false`, which is how the Playwright suite drives it.

## API (`/api/notifications`, session + CSRF)

- **`GET /`:** returns `{ notifications: [...50 newest in-app], unreadCount,
  emailConfigured }`.
- **`POST /:id/read`** and **`POST /read-all`.**
- **`DELETE /`:** removes every notification (used by Clear All Data).
- **`POST /check`.**
- **`POST /test-email`:** unchanged.

## UI

- **Toolbar bell:** `#notificationsBtn` with an unread badge opens
  `#notificationsPanel`, a list with "Mark all read". Clicking an item marks it
  read and opens Ledger (bills) or Accounts (balances). The list is fetched
  after boot, on live refresh and when the panel opens.
- **Settings → Notifications:**
  - A toggle per type, plus "Days ahead", channel and delivery.
  - A note when SMTP is not configured.
  - "Check now".
- **Accounts:** a "Low-balance alert at" field in the add and inline-edit
  forms. The card shows the threshold when one is set.
