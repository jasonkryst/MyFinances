# Debt & Liability-Account Balance History — Design

**Date:** 2026-09-28
**Status:** Approved (brainstorming), pending implementation plan

## Problem

A debt record keeps only `originalBalance` / `originalMinimumPayment` (set once) and the current
`accountBalance` / `minimumPayment` (overwritten on every change). Accounts keep only a
user-entered `startingBalance`. Every intermediate value is lost, so the user cannot see how a
debt's or liability account's balance and minimum due moved over time.

## Goals

- Record a dated history of balance and minimum payment for:
  - **Every record in `app.debts`**
    - Credit Card / Interest-bearing: `accountBalance` + `minimumPayment`.
    - Fixed Amount (e.g. daycare): the monthly `fixedAmount`.
  - **Accounts of type `Credit Card` or `Loan`**: user-entered `startingBalance` + a new
    `minimumPayment` field.
- Capture automatically whenever a tracked value changes; no manual logging.
- A shared History modal (chart + delete-only entry table) reachable from debt cards and from
  Credit Card / Loan account cards.
- Identical behavior across localStorage, sessionStorage, and Postgres; survives JSON
  export/import round-trips.

## Non-goals

- Sparklines on cards, or a Reports-page cross-item history chart.
- Manually adding or editing history entries (delete only).
- Snapshotting the *projected* account balance (`computeAccountBalance()`); only user-entered values.
- Using the new account `minimumPayment` in forecast/ledger/strategy calculations — it is
  informational only (using it would double-count a card tracked both as an account and a debt).
- Translating new UI strings beyond English.

## Data model

New top-level collection `app.balanceHistory`:

```js
{
  id,
  debtId,          // integer | null
  accountId,       // integer | null   — exactly one of debtId / accountId is non-null
  date,            // YYYY-MM-DD
  balance,         // finite number | null (null only for Fixed Amount debts)
  minimumPayment   // finite number ≥ 0
}
```

Mapping by owner:

| Owner | `balance` | `minimumPayment` |
|---|---|---|
| Interest-bearing debt | `accountBalance` | `minimumPayment` |
| Fixed Amount debt | `null` | `fixedAmount` |
| Credit Card / Loan account | `startingBalance` (as-is; may be negative) | `minimumPayment` |

At most one entry per owner per date.

### New account field

`minimumPayment` on accounts: `sanitizeFiniteNumber(record?.minimumPayment, 0, { min: 0 })` in
`sanitizeAccount`. Shown in the add/edit account forms only when type is Credit Card or Loan.

### Existing debt fields

`originalBalance` / `originalMinimumPayment` stay (progress bar, Health page, strategy summary read
them). The `if (!originalBalance)` falsy check in `updateDebtBalance()` becomes `== null`.

## Module: `src/balanceHistory.js`

Follows the `featureFn(app, ...)` convention. Pure helpers are separated from app-mutating wrappers
so they can be Jest- and Stryker-tested.

Owner references are `{ kind: 'debt' | 'account', id }`.

Pure (no DOM, no `app`):
- `isHistoryTrackedAccount(account)` → `true` for type `Credit Card` / `Loan`.
- `buildHistoryEntry(owner, record, date)` → entry per the mapping table.
- `upsertHistoryEntry(entries, entry)` → `{ entries, action: 'none' | 'insert' | 'update', target }`.
  - `none` when the owner's latest entry (by date) has identical `balance` and `minimumPayment`.
  - `update` when an entry exists for the same owner and date — replace its values.
  - `insert` otherwise.
- `seedHistoryForDebt(debt, today)` → 0–2 entries:
  - "original" from `originalBalance` / `originalMinimumPayment` dated `debtStartDate`, only when
    `debtStartDate` is set, earlier than the current entry's date, and values differ from current.
  - "current" from current values dated `updatedAt` or `today`.
  - Fixed Amount debts seed only the current entry.
- `seedHistoryForAccount(account, today)` → one current entry dated `today`.

App-level:
- `recordBalanceHistory(app, owner)` — looks up the record, builds today's entry, upserts into
  `app.balanceHistory`; on Postgres awaits `pgPost` (swapping in the server id) for inserts or calls
  `pgPatch` for updates. For accounts, no-op unless `isHistoryTrackedAccount`.
- `getBalanceHistory(app, owner)` — entries sorted ascending by date.
- `deleteBalanceHistoryEntry(app, id)` — removes one entry; `pgDelete` on Postgres.
- `removeHistoryForOwner(app, owner)` — local cascade on debt/account delete (server cascades via FK).
- `seedMissingBalanceHistory(app)` — after load/import, seeds every debt and every tracked account
  with zero entries; persists only if something was seeded.

`DebtTrackerApp` gets one-line delegating methods for the app-level functions.

## Capture triggers

`recordBalanceHistory` is called after the in-memory mutation in:
- Debts: `addDebt` (after server id assigned on Postgres), `updateDebtBalance`, `saveEdit`, the
  inline-edit save path (`debts.js` ~line 706).
- Accounts: `addAccount`, the account edit-save (`accounts.js` ~line 322).

Deleting a debt or account calls `removeHistoryForOwner`. Archiving a debt keeps history. Changing
an account's type away from Credit Card / Loan keeps existing history; new changes are not recorded.

## UI

- **History** button (`data-debt-action="history"`) in every debt card's action row, and
  (`data-account-action="history"`) on Credit Card / Loan account cards.
- `#balanceHistoryModal` in `index.html`, reusing existing modal markup and the Update Balance
  modal's focus-trap pattern. Opened with an owner ref; title shows the item's name.
  - Chart.js line chart: two lines, **Balance** (left y-axis) and **Min. payment** (right y-axis);
    Fixed Amount debts show a single **Monthly amount** line (chosen by `balance === null`).
    Followed by `renderChartDataTable()`. Chart destroyed on close / re-open.
  - Entry table, newest first: Date · Balance · Min. payment · Change vs. previous · Delete.
    Delete uses an inline two-step confirm (no `window.confirm`).
  - One-entry state: "History starts here — updates you make will be recorded."
  - Mobile: rows restack into label/value cards via `data-label` + `::before`.
- Account add/edit forms: a **Minimum payment ($)** input shown only for Credit Card / Loan types
  (toggled via `classList`, not inline style).
- All user data via `textContent` or `escapeHtml()`; no inline styles (CSP).

## Storage

- `app.js`: `this.balanceHistory = []`.
- `sanitizers.js`: `sanitizeBalanceHistoryEntry(record, idFallback)` — returns `null` (filtered)
  unless exactly one of `debtId` / `accountId` is a valid integer and `date` passes
  `sanitizeDateISO`; `balance` finite or `null`; `minimumPayment` finite ≥ 0 (default 0). The
  load/import pass also drops entries whose owner does not exist.
- `storage.js`: save/load `balanceHistory`; `clearAllData` resets it; `seedMissingBalanceHistory`
  after load.

## Export / import (`dataExport.js`)

- Export includes `balanceHistory`. Format version unchanged (`"3.0"`); the field is optional.
- Import builds `debtIdMap` and `accountIdMap` (old → new) while assigning ids, remaps each entry's
  owner id, and drops entries whose owner is absent from the file.
- Merge mode: entries for a name-matched existing debt map to that debt's id, skipping any
  `(owner, date)` already present.
- Legacy files without `balanceHistory` get seeded by `seedMissingBalanceHistory`.

## Postgres

Migration `server/migrations/1755600000017_add-balance-history.js`:

```sql
ALTER TABLE accounts ADD COLUMN minimum_payment numeric NOT NULL DEFAULT 0;

CREATE TABLE balance_history (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    debt_id bigint REFERENCES debts(id) ON DELETE CASCADE,
    account_id bigint REFERENCES accounts(id) ON DELETE CASCADE,
    date date NOT NULL,
    balance numeric,
    minimum_payment numeric NOT NULL DEFAULT 0,
    CONSTRAINT balance_history_one_owner CHECK ((debt_id IS NULL) <> (account_id IS NULL))
);
CREATE INDEX idx_balance_history_user_id ON balance_history (user_id);
CREATE INDEX idx_balance_history_debt_id ON balance_history (debt_id);
CREATE INDEX idx_balance_history_account_id ON balance_history (account_id);
```

`down()`: `DROP TABLE balance_history; ALTER TABLE accounts DROP COLUMN minimum_payment;`

**Migration-guardrail note (CLAUDE.md):** this is the first migration that alters a populated table.
The `ADD COLUMN ... NOT NULL DEFAULT 0` is safe forward (constant default backfills existing rows).
The `down()` column drop discards any user-entered account minimum payments; this is accepted for
a rollback since the field is informational and newly introduced.

- `routes/balanceHistory.js` via `createCrudResource`, `foreignKeys: { debtId: 'debts', accountId:
  'accounts' }`, columns `id, debtId→debt_id, accountId→account_id, date, balance,
  minimumPayment→minimum_payment`; mounted at `/api/balance-history`. The CRUD router's
  `requiredFields` cannot express "exactly one of"; the shared sanitizer (null result → 400) and the
  DB CHECK enforce it. `server/src/sanitizers/index.js` re-exports `sanitizeBalanceHistoryEntry`.
- `routes/accounts.js` column map gains `minimumPayment: 'minimum_payment'`.
- Frontend: `POSTGRES_RESOURCE_ENDPOINTS` (`storage.js`) and `ALL_RESOURCE_PATHS`
  (`postgresSync.js`) gain `balanceHistory` / `/api/balance-history`.
- `postgresImport.js`: balance history is **not** in the generic `CRUD_RESOURCES` loop (it FKs to
  debts, which `remapFk` does not handle). A dedicated step runs after accounts and debts are POSTed:
  remap `accountId` via the existing account `idMap` and `debtId` via a new `debtIdMap` built from
  the debt POST responses (or name-matched existing debts in merge mode), POST entries, and add
  created paths to the rollback list. Snapshot/restore include `balanceHistory`.

## Testing

- **Jest** (`tests/unit/balanceHistory.test.js`): `isHistoryTrackedAccount`, `buildHistoryEntry`
  (all three owner shapes), `upsertHistoryEntry` (none/insert/update), `seedHistoryForDebt` (all
  branches), `seedHistoryForAccount`, `sanitizeBalanceHistoryEntry` (both/neither owner rejected).
  Pure functions added to `stryker.config.mjs` `mutate` line ranges.
- **Playwright** (`tests/features/test_balance_history.py`):
  - Debts: add seeds one entry; Update Balance on two mocked dates → 2 entries, same day twice → 1;
    Edit form and inline edit record; unchanged save records nothing; Fixed Amount change recorded.
  - Accounts: Credit Card/Loan add seeds an entry, edit records; Checking account records nothing
    and has no History button; min-payment input shows/hides with type.
  - Delete a single entry; deleting a debt/account removes its history.
  - Export → import (replace and merge) remaps owner ids; account `minimumPayment` round-trips;
    legacy import seeds history; persisted across reload; modal chart has its sr-only data table.
- **Security** (`tests/security/test_xss.py`): XSS payload in debt and account names renders inertly
  in the History modal.
- **Postgres** (`tests/postgres/`): CRUD on `/api/balance-history`; rejects both/neither owner and a
  foreign owner id; cascade on debt and account delete; account `minimumPayment` persisted; import
  replace/merge remapping.

## Versioning & docs

- Minor bump `APP_VERSION` 6.4.0 → 6.5.0 with matching `sw.js` `CACHE_NAME` and `CHANGELOG.md`
  entry; `src/balanceHistory.js` added to the `sw.js` precache list.
- CLAUDE.md: add `balanceHistory.js` to the module list and a "Balance history" Cross-cutting
  features bullet (owner model, informational account min payment, `postgresImport.js` special step).
