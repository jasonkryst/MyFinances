# PostgreSQL Storage Layer — Phase 2b: Per-Resource Mutation Wiring (Issue #53)

**Date:** 2026-08-24
**Issue:** [#53 STORAGE - SQL Storage Layer Implementation](https://github.com/jasonkryst/MyFinances/issues/53) (milestone V5.0.0)

## Summary

Phase 2a (merged in [#99](https://github.com/jasonkryst/MyFinances/pull/99)) added the frontend plumbing — async bootstrap, login gate, and a Postgres option in the Settings picker — but left every `add*`/`edit*`/`delete*` mutation writing only to in-memory arrays. `saveToStorage()` in Postgres mode only syncs scalar plan-settings fields. As a result, any change the user makes (add a debt, edit an account, delete a bill) is lost on the next page reload.

Phase 2b wires every mutation site to its corresponding REST endpoint so that Postgres mode is a fully functional, persistent storage backend. Local-only mode (`localStorage`/`sessionStorage`) is untouched.

## Architecture

### New module: `src/postgresSync.js`

Single-responsibility module for per-resource Postgres writes. Keeps `storage.js` focused on load/save/adapter concerns.

```js
export async function pgPost(app, path, body)  // returns parsed response or null
export function pgPatch(app, path, body)        // fire-and-forget
export function pgDelete(app, path)             // fire-and-forget
export function pgPut(app, path, body)          // fire-and-forget (keyed upsert)
export async function pgDeleteAll(app)          // fans out DELETE to all resource endpoints
```

All helpers share an internal `pgFetch(app, method, path, body)` that:
- Sets `Content-Type: application/json` and `X-CSRF-Token: getCsrfCookie()` on every mutating request
- On `401`: calls `showLoginGate(app)` and awaits it (re-auth gate — session expired mid-use). Does **not** retry the original mutation after re-auth; the user must repeat their action.
- On any other network/server error: `console.error(...)` only. No rollback, no error toast in Phase 2b. Mutations are optimistic — the in-memory change stands; Postgres simply may not have it if the call fails.

`pgPost` is `async` and returns the parsed JSON response — callers need the server-assigned `id`. The others return `void` (fire-and-forget at the call site is fine; the id is already stable for edits and deletes).

`pgDeleteAll(app)` fans out parallel `DELETE /api/<resource>` calls to all 10 array-resource endpoints and the 3 keyed-resource endpoints (ledger-overrides, net-worth-snapshots, settings). It requires a new "delete all" route added to `crudRouter.js` and `keyedRouter.js` (see server changes below). Plan-settings is left intact — the row holds safe defaults and is recreated by `getOrCreateRow` on next login anyway.

### Server change: delete-all route in `crudRouter.js` and `keyedRouter.js`

Add one route to each generic router:

```js
// crudRouter.js
router.delete('/', async (req, res, next) => {
    try {
        await query(`DELETE FROM ${table} WHERE user_id = $1`, [req.userId]);
        res.status(204).end();
    } catch (err) {
        next(err);
    }
});

// keyedRouter.js — same shape
router.delete('/', async (req, res, next) => {
    try {
        await query(`DELETE FROM ${table} WHERE user_id = $1`, [req.userId]);
        res.status(204).end();
    } catch (err) {
        next(err);
    }
});
```

This makes `DELETE /api/debts` (no id segment) wipe all of the authenticated user's rows in that table.

### ID ownership — the core constraint

The browser currently generates `id: Date.now()` for new records. `crudRouter.js` ignores this field on INSERT (`const insertFields = jsFields.filter(f => f !== 'id')`) and returns a DB-assigned bigserial. Every `add*` function must therefore:

1. Push the new object (with temp `Date.now()` id) into `app.<resource>`
2. `await pgPost(...)` to get the server response
3. Assign `savedRecord.id` back to the in-memory object (same object reference — mutates the array entry in place)
4. Only then call `app.updateUI()` — so DOM `data-id` attributes render the real DB id

This makes every `add*` function `async`. Event listeners that call them are fire-and-forget at their level (they don't await the return value), so no callers need updating.

Edit and delete functions do **not** need to be async — the id is already stable (either from a prior POST or from `loadFromPostgres`).

## Call-site changes by resource

### Array CRUD resources (10 resources, ~30 mutation sites across 6 files)

**Create pattern** (`add*` → async, await pgPost):
```js
export async function addDebt(app) {
    // ... build debt object with id: Date.now() ...
    app.debts.push(debt);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') {
        const saved = await pgPost(app, '/api/debts', debt);
        if (saved?.id) debt.id = saved.id;
    }
    recalculateIfConfigured(app);
    app.updateUI();
    app.cancelEdit();
}
```

**Update pattern** (`edit*` → sync, fire-and-forget pgPatch):
```js
app.debts[idx] = updated;
app.saveToStorage();
pgPatch(app, `/api/debts/${updated.id}`, updated);
```

**Delete pattern** (`delete*` → sync, fire-and-forget pgDelete):
```js
app.debts = app.debts.filter(d => d.id !== id);
app.saveToStorage();
pgDelete(app, `/api/debts/${id}`);
```

**Resources and their files:**

| Resource | File | Endpoint |
|---|---|---|
| debts | `src/debts.js` | `/api/debts` |
| accounts | `src/accounts.js` | `/api/accounts` |
| incomes | `src/income.js` | `/api/incomes` |
| bonuses | `src/income.js` | `/api/bonuses` |
| bills | `src/bills.js` | `/api/bills` |
| expenses | `src/bills.js` | `/api/expenses` |
| recurringTemplates | `src/recurring.js` | `/api/recurring-templates` |
| emergencyFunds | `src/savings.js` | `/api/emergency-funds` |
| sinkingFunds | `src/savings.js` | `/api/sinking-funds` |
| reconciliations | `src/reconciliation.js` | `/api/reconciliations` |

Note: `debts.js` has an additional `updateDebtBalance` function (edits balance + minimum payment on an existing debt) — this uses the same `PATCH /api/debts/:id` pattern as `editDebt`.

### Keyed resources (3 resources — fire-and-forget, no id swap)

**Ledger amount overrides** (`src/ledgerOverrides.js`):
```js
// setLedgerAmountOverride — after writing to app.ledgerAmountOverrides:
pgPut(app, `/api/ledger-overrides/${transactionId}`, entry);

// clearLedgerAmountOverride — after deleting from app.ledgerAmountOverrides:
pgDelete(app, `/api/ledger-overrides/${transactionId}`);
```

**Net-worth snapshots** (`src/reportsNetWorth.js`):
```js
// captureNetWorthSnapshot — after updating app.monthlySnapshots:
pgPut(app, `/api/net-worth-snapshots/${snapshot.date}`, snapshot);
```
The snapshot date (`YYYY-MM-DD`) is the upsert key — same as the server's `keyColumn: 'date'`. The keyed router's `PUT /:key` uses `ON CONFLICT ... DO UPDATE`, so capture is safe to call for both new and existing months.

**App settings** (`src/settings.js`):
```js
// setSetting — after writing to app.settings:
pgPut(app, `/api/settings/${key}`, { value });
```

### `clearAllData` (`src/storage.js`)

```js
export function clearAllData(app, options = {}) {
    const wasPostgres = app._storageBackendKind === 'postgres';
    // ... existing reset of all app.* arrays and UI state ...
    app.storageAdapter.remove(app.storageKey);
    app.storageAdapter = createStorageAdapter('local');
    app._storageBackendKind = 'local';
    setStorageBackendPreference('local');

    if (wasPostgres) pgDeleteAll(app); // fire-and-forget after backend kind is reset
    // ... rest of UI reset (updateUI, clear inputs, onCleared callback) ...
}
```

`wasPostgres` is captured before `app._storageBackendKind` is reset to `'local'`, so `pgDeleteAll` still has the session context it needs but won't interfere with subsequent local-mode operations.

### Plan-settings scalars — no change

`perMonthStimulus`, `netWorthMilestonesAwarded`, `monthlyPayment`, `strategy`, `ledgerSettings`, `forecastSettings` are already handled by `saveToStorage()`'s existing Postgres branch (`PATCH /api/plan-settings`). No changes needed.

## Out of scope

- **Phase 2c**: Migrating an existing local user's data into a fresh Postgres account (one-way local→Postgres transfer).
- **Error toasts**: User-visible feedback on failed Postgres writes. Console-only in Phase 2b; a notification/retry system is follow-up work.
- **Offline queue**: Queuing mutations when the server is unreachable and replaying on reconnect.
- **dataExport.js**: Reconciling bulk JSON export/import with the granular REST API (tracked separately under issue #95).
- **Auth flows**: Password reset, remember-me, multi-user — out of scope for all Phase 2 work.

## Testing

New tests in `tests/postgres/test_postgres_mutations.py`, run in the existing `test-postgres` CI job (docker-compose stack). Tests authenticate via the REST API before driving the browser in Postgres mode.

### Array CRUD — debts (full three-step):
- Add a debt → reload → assert it persists (validates POST + id swap)
- Edit the debt → reload → assert the change persisted (validates PATCH)
- Delete the debt → reload → assert it's gone (validates DELETE)

### Array CRUD — remaining 9 resources (smoke test each):
- Add → reload → assert persists. One test per resource. Enough to catch a broken endpoint or missing `pgPost` call.

### Keyed resources:
- Set a ledger override → reload → assert it persists
- Clear the override → reload → assert it's gone
- Capture a net-worth snapshot → reload → assert date and amount appear
- Set a setting (RECONCILIATION_ADJUSTS_BALANCE) → reload → assert checkbox state matches

### clearAllData:
- Seed data via REST API, load app in Postgres mode, trigger "Clear all data" in Settings, assert empty state, reload and assert still empty (all server rows gone)

### 401 mid-session:
- Log in, delete the session server-side via the test DB helper, trigger a mutation, assert the login gate re-appears

**Total: ~20 new test cases.** No CI changes needed — the `test-postgres` job already handles the docker-compose setup.

## Files changed

**New:**
- `src/postgresSync.js`
- `tests/postgres/test_postgres_mutations.py`

**Modified (server):**
- `server/src/crudRouter.js` — add `DELETE /` route
- `server/src/keyedRouter.js` — add `DELETE /` route

**Modified (frontend):**
- `src/debts.js` — `addDebt` (async), `editDebt`, `updateDebtBalance`, `deleteDebt`
- `src/accounts.js` — `addAccount` (async), `editAccount`, `deleteAccount`
- `src/income.js` — `addIncome` (async), `editIncome`, `deleteIncome`, `addBonus` (async), `editBonus`, `deleteBonus`
- `src/bills.js` — `addBill` (async), `editBill`, `deleteBill`, `addExpense` (async), `editExpense`, `deleteExpense`
- `src/recurring.js` — add/edit/delete recurring template functions
- `src/savings.js` — add/edit/delete emergency fund and sinking fund functions
- `src/reconciliation.js` — add/edit/delete reconciliation functions
- `src/ledgerOverrides.js` — `setLedgerAmountOverride`, `clearLedgerAmountOverride`
- `src/reportsNetWorth.js` — `captureNetWorthSnapshot`
- `src/storage.js` — `clearAllData` (import `pgDeleteAll`, capture `wasPostgres`, call after reset)
- `src/settings.js` — `setSetting` (add `pgPut` call)

**Not modified:**
- `src/app.js` — delegating wrappers stay synchronous at the method level; async bubbles up only inside the module functions
- `src/storageAdapters.js`, `src/loginGate.js` — untouched
- All render/report/calculation modules — untouched
