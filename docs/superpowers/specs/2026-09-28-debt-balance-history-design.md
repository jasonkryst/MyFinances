# Debt Balance & Minimum-Payment History — Design

**Date:** 2026-09-28
**Status:** Approved (brainstorming), pending implementation plan

## Problem

A debt record keeps only `originalBalance` / `originalMinimumPayment` (set once) and the current
`accountBalance` / `minimumPayment` (overwritten on every change). Every intermediate value is lost,
so the user cannot see how a debt's balance or minimum due moved over time.

## Goals

- Record a dated history of balance and minimum payment for **every record in `app.debts`**:
  - Credit Card / Interest-bearing debts: `accountBalance` + `minimumPayment`.
  - Fixed Amount debts (e.g. daycare): the monthly `fixedAmount`.
- Capture automatically whenever a tracked value changes; no manual logging.
- Show a per-debt History modal with a chart and an editable (delete-only) entry table.
- Work identically across all three storage backends (localStorage, sessionStorage, Postgres) and
  survive JSON export/import round-trips.

## Non-goals

- History for Accounts of type Credit Card / Loan.
- Sparklines on debt cards, or a Reports-page cross-debt history chart.
- Manually adding or editing history entries (delete only).
- Translating the new UI strings beyond English (Liabilities page is not yet localized).

## Data model

New top-level collection `app.debtHistory`:

```js
{ id, debtId, date /* YYYY-MM-DD */, balance /* number ≥ 0 | null */, minimumPayment /* number ≥ 0 */ }
```

- Interest-bearing debt: `balance = accountBalance`, `minimumPayment = minimumPayment`.
- Fixed Amount debt: `balance = null`, `minimumPayment = fixedAmount`.
- At most one entry per `(debtId, date)`.

`originalBalance` / `originalMinimumPayment` remain on the debt record (progress bar, Health page, and
strategy summary read them). The `if (!originalBalance)` falsy check in `updateDebtBalance()` becomes
`== null` so a legitimate `0` is not overwritten.

## Module: `src/debtHistory.js`

Follows the `featureFn(app, ...)` convention. Pure helpers are separated from app-mutating wrappers
so they can be Jest-tested and mutation-tested.

Pure (DOM-free, no `app`):
- `buildHistoryEntry(debt, date)` → `{ debtId, date, balance, minimumPayment }` per the mapping above.
- `upsertHistoryEntry(entries, entry)` → `{ entries, action: 'none' | 'insert' | 'update', target }`.
  - `none` when the latest existing entry for that debt (by date) has identical `balance` and
    `minimumPayment`.
  - `update` when an entry already exists for `(debtId, date)` — replace its values.
  - `insert` otherwise.
- `seedHistoryForDebt(debt, today)` → array of 0–2 entries for a debt with no history:
  - "original" entry from `originalBalance` / `originalMinimumPayment` dated `debtStartDate`, only when
    `debtStartDate` is set, is earlier than the current entry's date, and its values differ from current.
  - "current" entry from current values dated `updatedAt` or `today`.
  - Fixed Amount debts seed only the current entry.

App-level:
- `recordDebtHistory(app, debt)` — builds today's entry, upserts into `app.debtHistory`, and on
  Postgres awaits `pgPost` (swapping in the server id) for inserts or calls `pgPatch` for updates.
- `getDebtHistory(app, debtId)` — entries for a debt sorted ascending by date.
- `deleteDebtHistoryEntry(app, id)` — removes one entry; `pgDelete` on Postgres.
- `removeHistoryForDebt(app, debtId)` — local cascade when a debt is deleted (server cascades via FK).
- `seedMissingDebtHistory(app)` — runs after load/import; seeds every debt that has zero entries.
  Persists only if anything was seeded.

`DebtTrackerApp` gets one-line delegating methods for the app-level functions.

## Capture triggers

`recordDebtHistory(app, debt)` is called after the in-memory mutation in:
- `addDebt` (seeds the first entry, after the server id is assigned on Postgres),
- `updateDebtBalance` (Update Balance modal),
- `saveEdit` (Edit form),
- the inline-edit save path (`debts.js` ~line 706).

Deleting a debt calls `removeHistoryForDebt`. Archiving keeps history.

## UI

- A **History** button in every debt card's action row (both debt types, archived included),
  `data-debt-action="history"`.
- `#debtHistoryModal` in `index.html`, reusing the existing modal markup and the focus-trap pattern
  from the Update Balance modal.
  - Chart.js line chart. Interest-bearing: **Balance** (left y-axis) and **Min. payment** (right y-axis).
    Fixed Amount: single **Monthly amount** line. Followed by `renderChartDataTable()`.
  - Entry table, newest first: Date · Balance · Min. payment · Change vs. previous · Delete.
    Delete uses an inline two-step confirm (no `window.confirm`).
  - One-entry empty state: "History starts here — updates you make will be recorded."
  - Mobile: rows restack to label/value cards via `data-label` + `::before` (the "few-column summary"
    responsive pattern).
- All user data via `textContent` or `escapeHtml()`; no inline styles (CSP); styling via classes in
  `styles.css`.
- The chart instance is destroyed on modal close / re-open.

## Storage

- `app.js`: `this.debtHistory = []`.
- `sanitizers.js`: `sanitizeDebtHistoryEntry(record, idFallback)` — `debtId` required (return `null`
  if missing so it is filtered), `date` via `sanitizeDateISO` (required), `balance` finite ≥ 0 or
  `null`, `minimumPayment` finite ≥ 0 (default 0). Wired into the load/import sanitize pass; entries
  whose `debtId` does not match a debt are dropped.
- `storage.js`: save/load `debtHistory`; `clearAllData` resets it; `seedMissingDebtHistory` after load.

## Export / import (`dataExport.js`)

- Export includes `debtHistory`. Format version unchanged (`"3.0"`); the field is optional.
- Import builds `debtIdMap` (old id → new id) while assigning debt ids, then remaps each entry's
  `debtId`, dropping entries whose debt is absent from the file.
- Merge mode: when an imported debt is name-matched to an existing debt, its entries map to the
  existing debt's id, skipping any `(debtId, date)` already present.
- Legacy files without `debtHistory` get seeded by `seedMissingDebtHistory`.

## Postgres

- Migration `server/migrations/1755600000017_add-debt-history.js`:
  ```sql
  CREATE TABLE debt_history (
      id bigserial PRIMARY KEY,
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      debt_id bigint NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
      date date NOT NULL,
      balance numeric,
      minimum_payment numeric NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_debt_history_user_id ON debt_history (user_id);
  CREATE INDEX idx_debt_history_debt_id ON debt_history (debt_id);
  ```
  `down()` drops the table (new table — safe).
- `server/src/routes/debtHistory.js` via `createCrudResource`, `requiredFields: ['debtId']`,
  `foreignKeys: { debtId: 'debts' }`, columns `id, debtId→debt_id, date, balance,
  minimumPayment→minimum_payment`. Mounted at `/api/debt-history` in `server/src/app.js`.
  `server/src/sanitizers/index.js` re-exports `sanitizeDebtHistoryEntry`.
- Frontend: `POSTGRES_RESOURCE_ENDPOINTS` (`storage.js`) and `ALL_RESOURCE_PATHS`
  (`postgresSync.js`) gain `debtHistory` / `/api/debt-history`.
- `postgresImport.js`: debt history is **not** added to the generic `CRUD_RESOURCES` loop (it FKs
  to debts, which `remapFk` does not handle). A dedicated step runs after debts are POSTed: build
  `debtIdMap` from the server responses (or name-matched existing debts in merge mode), remap
  `debtId`, POST entries, and include created paths in the rollback list. Snapshot/restore include
  `debtHistory`.
- Server-side, deleting a debt cascades its history; the client mirrors this locally without extra
  DELETE calls.

## Testing

- **Jest** (`tests/unit/debtHistory.test.js`): `buildHistoryEntry` (both debt types),
  `upsertHistoryEntry` (none/insert/update), `seedHistoryForDebt` (all branches),
  `sanitizeDebtHistoryEntry`. Pure functions added to `stryker.config.mjs` `mutate` line ranges.
- **Playwright** (`tests/features/test_debt_history.py`): adding a debt seeds one entry; Update
  Balance on two different (mocked) dates → 2 entries, same day twice → 1 entry; Edit form and
  inline edit record; unchanged save records nothing; Fixed Amount change recorded; delete single
  entry; deleting a debt removes its history; export→import round-trip remaps `debtId` (replace and
  merge); legacy import seeds history; modal chart has its sr-only data table; persisted across reload.
- **Security** (`tests/security/test_xss.py`): XSS payload in a debt name renders inertly in the
  History modal.
- **Postgres** (`tests/postgres/`): CRUD on `/api/debt-history`, FK rejection for foreign `debtId`,
  cascade on debt delete, import replace/merge remapping.

## Versioning & docs

- Minor bump of `APP_VERSION` (6.4.0 → 6.5.0) with matching `sw.js` `CACHE_NAME` and `CHANGELOG.md`
  entry; `src/debtHistory.js` added to the service worker precache list.
- CLAUDE.md: add `debtHistory.js` to the module list and a "Debt history" Cross-cutting features
  bullet (including the `postgresImport.js` special-case step).
