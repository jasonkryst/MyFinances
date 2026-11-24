# Transactional bulk import (`POST /api/import`) — design

Issue: #529 (audit finding PERF-12, features audit REC-06). Target version: 8.4.0.

## Problem

Restoring a backup (replace) or merging one is driven from the browser, one HTTP request per record:
`pgDeleteAll` wipes the server collection by collection, then `postAllResources` (`src/postgresImport.js`)
POSTs accounts, persons, every CRUD collection, PUTs every keyed entry, PATCHes plan settings and POSTs
balance history. The audit dataset (432 KB) took 1,881 requests and 6.7 s. Atomicity is emulated: on a
failure, replace wipes again and re-POSTs a client-side snapshot; merge DELETEs what it created. Either
rollback can fail half-way and leave the account inconsistent (`showSyncErrorBanner`).

## Decisions (owner, 2026-11-24)

- **Both replace and merge** move to the server and run in **one database transaction**.
- **Audit log (#580): one row per record**, as today. The per-record audit CTEs stay and run inside the
  transaction, so a rolled-back import leaves no audit rows either.
- The per-record REST routes stay for normal edits.

## Shape

```
browser                                   server
-------                                   ------
sanitizeParsedState (unchanged, dataExport.js / pgMigrationModal.js / seed_state)
replaceForPostgres / mergeForPostgres
  └─ POST /api/import ───────────────────▶ routes/import.js
       { mode, data, strategy }               BEGIN; lock user row
                                              existing = loadUserState(userId, tx)   (merge)
                                              runImport({mode, data, strategy, existing, store})
                                                 └─ src/importCore.js (pure, shared)
                                                      store.* → crud/keyed helpers on `tx`
                                              COMMIT   (any throw → ROLLBACK)
  ◀─────────────────────────── 200 { warnings, skipped }
  loadFromPostgres(app)  (adopts server state, seeds shadows)
```

### `src/importCore.js` (new, pure)

The algorithm that is in `postgresImport.js` today (`postAllResources`, the merge body, `remapFk`,
`idPairs`, `savingsPairs`, `remapKeyedEntries`, `remapSettingsForImport`, `CRUD_RESOURCES`), moved
verbatim in behaviour and made transport-agnostic. Pure: imports only other pure modules (mergeDedupe,
ledgerKeyRemap, settingsRemap, sanitizers' remap helpers, balanceHistoryCore, planHistoryCompare,
settingsSchema, utils' pure helpers). It must never import ui.js, postgresSync.js, storage.js or any
DOM/network module, because the server imports it by relative path.

```js
export const CRUD_RESOURCES = [ { field: 'debts', path: '/api/debts' }, ... ];  // same order as today
export async function runImport({ mode, data, strategy, existing, store }) → { warnings, skipped }
```

`store` is the only side-effecting dependency:

| method | replaces today's | returns |
|---|---|---|
| `deleteAll()` | `pgDeleteAll` (replace only) | — |
| `create(field, record)` | `POST /api/<field>` (accounts, persons, CRUD_RESOURCES, balanceHistory) | stored row (API shape) |
| `putKeyed(kind, key, value)` kind ∈ `ledgerOverride`, `ledgerCleared`, `netWorthSnapshot`, `setting` | keyed PUTs | stored row |
| `addMilestone(m)` | `POST /api/plan-settings/milestones` | — |
| `patchPlanSettings(patch)` | `PATCH /api/plan-settings` | — |

Calls are sequential (one connection). `existing` (merge only) is the user's current state in browser
shape plus the plan-settings fields merge reads (`budgetCategories`, `retirementTargetDate`,
`homePurchasePlan`, `netWorthMilestonesAwarded`). Replace ignores it.

Semantics are exactly today's, including: name-based merge dedupe and in-file repeats (#478, #567),
`skipped` counts, Ledger key remapping with drop warnings (#520), account-id settings remap with
rejection warnings (#651), Plan History debt-id remap (#312), balance-history owner remap and
existing-history exclusion, person FK remap (#421/#471), merge's plan-settings merge rules
(budgetCategories shallow-merged, retirementTargetDate/homePurchasePlan only when present), replace
resetting plan settings to defaults first (the shared `DEFAULT_PLAN_SETTINGS`, moved to a pure module so
`pgDeleteAll` and the server use one copy) and leaving `reconDrafts` empty (#587).

### Server

- `server/src/routes/import.js`, mounted at `/api/import` (session + CSRF like every `/api` route).
  Read-only API tokens (#581) are already refused on non-GET methods; a test pins it.
- Body: `{ mode: 'replace' | 'merge', data: object, strategy?: { paymentStrategy, monthlyPayment } }`.
  Anything else → 400 `VALIDATION_FAILED`.
- **Defence in depth**: the server never trusts `data`. It runs `sanitizeParsedState(data, warnings)`
  (pure, already re-exported by `server/src/sanitizers/index.js`) first, then every record still goes
  through its route's own sanitizer/validity check and foreign-key ownership checks inside `store`.
  A record the route would answer 400 aborts the import: ROLLBACK, 400
  `{ error: { code: 'VALIDATION_FAILED', message, collection, index } }`.
- `crudRouter.js` / `keyedRouter.js` / `planSettings.js` are refactored so the INSERT/UPSERT/PATCH bodies
  (sanitize, required fields, FK ownership, insert + audit CTE) are functions taking a `db` (`{ query }`)
  and `userId`. The routes call them with the pool; the import calls them with the transaction client.
  The routes' HTTP behaviour is unchanged (existing tests prove it). The functions are exposed on
  `router.crudConfig` / a `keyedConfig` the same way `listForUser` already is, so `importStore.js` can use
  `USER_STATE_COLLECTIONS`-style lookups.
- `loadUserState(userId, db = pool)` gains the optional db so merge reads `existing` inside the
  transaction.
- `deleteAll` (replace) deletes every table in `RESOURCE_TABLES` with the same audit CTE as the routes'
  `DELETE /` (children first, `deletionLayers`), the milestones, the notifications history and resets plan
  settings to `DEFAULT_PLAN_SETTINGS`, all on the transaction client. It does **not** empty the audit log
  (an import keeps the history, as today).
- Concurrency: the transaction starts with `SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, so two imports
  for the same user serialize instead of interleaving.
- Size limits: `app.js` skips the global `express.json({ limit: '1mb' })` for `POST /api/import` and that
  route uses `express.json({ limit: '25mb' })`. `nginx.conf` gets an exact-match `location = /api/import`
  with `client_max_body_size 25m` and `proxy_read_timeout 120s` (no `add_header`: a location-level
  add_header would drop the inherited security headers). DEPLOYMENT.md notes the limit for anyone with
  their own reverse proxy in front. The per-statement `statement_timeout` (30 s) still applies.

### Browser

- `replaceForPostgres(app, clean, incomingStrategy, warnings)` and `mergeForPostgres(...)` keep their
  signatures (callers: `dataExport.js`, `pgMigrationModal.js`, `tests/conftest.py` `seed_state`, tests).
  Each sends one `POST /api/import` inside `trackWrite()` (so live refresh and the Saving chip see it),
  reads the body on every branch (#461), appends the server's `warnings` to `warnings`, then
  `await loadFromPostgres(app)` (which seeds shadows) and returns `{ skipped }` (merge).
- On a non-OK response nothing changed on the server and `app` is untouched: no snapshot, no rollback.
  Throw an Error carrying the server message; callers already show their import-failed UI. A 401 goes
  through `requestLogin(app)` like other writes.
- Deleted from the client: `snapshotAppState`, `snapshotToPostData`, `doReplaceRollback`,
  `applyResultsToApp`, the merge rollback block, and the per-record fan-out. `pgDeleteAll` stays (Clear All
  Data uses it).

## Lists that name every CRUD resource

`CRUD_RESOURCES` moves from `postgresImport.js` to `importCore.js`; CLAUDE.md's "Adding a CRUD resource"
list, `docs/architecture/storage.md` and any server/Jest test that cross-checks the lists are updated to
point at it. The server store maps `field → router` via `USER_STATE_COLLECTIONS` (persons, accounts and
balanceHistory included), so a new resource is still one entry per list.

## Tests

Positive and negative, at every layer.

- **Jest (`tests/unit/importCore.test.js`)** with an in-memory fake store: replace order (deleteAll first;
  accounts, persons, CRUD in order, keyed, milestones, plan settings, balance history), FK remap, Ledger
  key remap + drop warnings, settings remap + rejection warning, Plan History debt remap; merge name dedupe,
  in-file repeats, `skipped` counts, existing-history exclusion, plan-settings merge rules; a store that
  throws mid-way propagates the error (no partial "success").
- **Server (`server/test/import.test.js`)**: replace of a representative export in one request, then GET
  routes return the remapped data; merge into existing data dedupes and reports `skipped`; one audit row
  per created record; **rollback**: a payload whose last record is invalid (e.g. a manual transaction
  pointing at another user's account, or an invalid transfer) → 400 and every table, plan settings,
  milestones and the audit log are byte-for-byte unchanged, for both modes; bad `mode`/non-object `data`
  → 400; no session → 401; no CSRF → 403; read-only API token → 403; a > 1 MB body is accepted and a
  > 25 MB body → 413; two concurrent imports serialize (final state equals one of them, never a mix); the
  audit-size dataset (~1,900 records, generated) imports in one request, with the duration logged and
  asserted under a generous CI bound.
- **Playwright**: replace and merge through the real UI still work (existing `test_postgres_import.py`,
  `test_import_*`, `test_sync_device_state.py`, `test_legacy_local_data.py`); a new test asserts an import
  sends exactly one `/api/import` request and no per-record POSTs; a failed import (route the request to a
  500) leaves the page's data and the server unchanged. `test_import_concurrency.py` (client fan-out
  bound) is rewritten for the new single-request path or retired with its rule.

## Docs and rules

- CLAUDE.md "Import" bullet: imports go through `POST /api/import` and `src/importCore.js`; the
  `mapWithConcurrency` rule now covers the remaining client fan-outs only. "Adding a CRUD resource" points
  at `importCore.js`'s `CRUD_RESOURCES`. Mirror in `docs/architecture/storage.md`, AGENTS.md,
  CONTRIBUTING.md where they repeat it.
- DEPLOYMENT.md: the 25 MB import limit and the nginx location.
- CHANGELOG 8.4.0 and a What's New entry ("Restoring or merging a backup is much faster and is now
  all-or-nothing").

## Implementation notes (what the code found)

- **JSON round trip on the server.** `sanitizeParsedState` returns expense dates as local-midnight `Date`
  objects, which the expense route's own sanitizer then rejects (it expects the JSON string a request
  carries). The server therefore passes the sanitized state through `toWireJson` (`importCore.js`) before
  `runImport`, exactly as a body sent to the per-record route would arrive. `toWireJson` also writes a
  local-midnight `Date` as its calendar date instead of a UTC instant, which on the client fixes an
  off-by-one-day expense date for users east of Greenwich (the old per-record path had it).
- **Ownership-check cache.** Each insert re-checked its foreign keys with one query; the transaction store
  carries a Set of ids already proven to be the user's (`db.ownedIds`), so records on the same few accounts
  cost one check each. Only positive results are cached, and the cache starts empty after the wipe.
- **Serialized queries.** `loadUserState` fans out with `Promise.all`; the transaction client is wrapped so
  its queries run one after another (node-postgres deprecates overlapping queries on one client).
- **Server-side sanitize warnings** are returned in `warnings` too. For a file the browser already
  sanitized there are none.
- **Shared modules.** `src/planSettingsDefaults.js` holds `DEFAULT_PLAN_SETTINGS`. The browser imports
  `importCore.js` only for `toWireJson`; both new modules are in `sw.js` PRECACHE_URLS.
- **Tests.** `tests/features/test_import_concurrency.py` is retired with the rule it checked (the client
  no longer fans out an import); `tests/postgres/test_bulk_import.py` replaces it. What's New entries are
  English literals by convention, so the 8.4.0 entry has no es/pl keys.

## Out of scope

- Server-side id remapping for ordinary edits (PERF-03) beyond what import needs.
- Streaming or chunked uploads; a 25 MB JSON body covers backups far larger than any seen so far.
