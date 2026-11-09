# Row versions, conflict handling and cross-tab refresh

Issues: #578 (row version), #563 (stale full-record PATCH), #575 (refresh on focus and across tabs), #565 (no refresh; misleading error for records deleted elsewhere).

Ships as two PRs, in order:

| PR | Issues | Version |
|----|--------|---------|
| 1. Row version and conflicts | #578, #563 | 7.4.0 |
| 2. Refresh and "deleted elsewhere" | #575, #565 | 7.5.0 |

## Problem

Since v7.0.0 the server is the only store, but every tab writes optimistically.

- **Whole-record PATCH.** Each edit PATCHes the whole in-memory record. `crudRouter` merges `{...existing, ...body}` with no check. A tab that loaded earlier overwrites fields it never touched: tab A renames a debt, stale tab B edits its balance, and the server ends with the old name.
- **No re-read.** Nothing re-reads the server after boot. Other tabs and devices stay stale.
- **Misleading 404.** Editing a record deleted elsewhere gets a 404, which shows the generic "check your connection" banner.

## Decisions (confirmed with the owner, 2026-11-09)

1. **Same field changed on both sides:** ask. A modal offers "Keep my changes" or "Use the other version". Nothing is overwritten silently. Escape picks "Use the other version", which discards nothing on the server.
2. **PATCH without a version:** accepted, unchecked. This keeps a tab on a cached pre-upgrade app working until the update banner reloads it. The new client always sends a version once it knows one.
3. **Focus refresh threshold:** configurable through env. The default is 60 s (PR 2).
4. **Delivery:** two PRs, in order.

## PR 1: row version and conflicts (#578, #563)

### Server

- **Migration `1755600000032`.** Adds `row_version integer NOT NULL DEFAULT 1` to every `createCrudResource` table: accounts, balance_history, bills, bonuses, debts, emergency_funds, expenses, incomes, persons, plan_history, reconciliations, recurring_templates, retirement_snapshots, sinking_funds and transfers. It is idempotent (`IF NOT EXISTS`). `down()` drops the columns, and only version counters are lost.
- **Not in `columns`.** `crudRouter` handles `row_version` outside the `columns` map, so sanitizers and field parity are unaffected.
  - It is selected and returned on every GET, POST and PATCH as `rowVersion`.
  - POST rows start at 1, and every successful PATCH increments it.
- **PATCH.**
  - `rowVersion` is read from the body and removed before the merge.
  - If present, it must be a non-negative integer, or the request gets 400.
  - The UPDATE adds `AND row_version = $v`, so the check and the write are one atomic statement.
  - If no row is updated, the row is re-read. If it is gone, the response is 404. Otherwise it is `409 { error: { code: 'CONFLICT' }, current: <row> }`.
  - Without `rowVersion`, the update is unconditional but still increments the version.
- **Partial bodies.** A partial PATCH body leaves the other columns untouched (the existing merge behaviour). A server test now pins this.
- **Out of scope.** Keyed upserts (`/api/ledger-overrides`, `/api/ledger-cleared`, `/api/settings`, net-worth snapshots) and `/api/plan-settings` stay last-write-wins. They are single values, and plan-settings has been field-level since #564.

### Client

- **Shadows.** `src/recordVersions.js` is pure, Jest-tested and in the Stryker scope.
  - `createShadowStore()` holds a deep copy of the last server copy of each record, keyed by its item path (`/api/debts/5`).
  - `diffFields(base, body)` returns the body keys whose value differs from the shadow, ignoring `id`, `rowVersion` and `undefined`.
  - `classifyConflict(base, theirs, diff)` splits a 409 into `conflicts` and `theirsChanges`. Conflicts are the diff keys that changed on the server to a different value than ours. `theirsChanges` are the server changes to keys we didn't touch.
- **Seeding shadows.** `postgresSync.js` owns the store. It is seeded from every collection after `loadFromPostgres` and after each import (`seedShadows(app)`), and updated on POST, PATCH and DELETE.
- **`pgPatch(app, path, body)`.** Call sites are unchanged, and it now returns a promise.
  - **Queue.** Requests for one item path run one at a time. Otherwise two fast edits would race and the second would 409 against the first.
  - **Diff.** When its turn comes, the request diffs `body` against the shadow. No differences means no request. With differences it sends `{...diff, rowVersion}`. With no shadow it sends the body unchanged and unversioned.
  - **200.** The response row becomes the shadow.
  - **409, no conflicts.** The server's other changes are applied to the in-memory record, the shadow becomes `current`, the diff is resent with the new version (at most 3 attempts), and the page re-renders. Both edits survive.
  - **409, conflicts.** `#syncConflictModal` names the record.
    - "Keep my changes" resends the diff over `current`'s version.
    - "Use the other version" copies `current` into the in-memory record.
    - Either way the page re-renders. Modals are serialized, so several conflicts are shown one at a time.
  - **Other failures** keep today's behaviour (the sync error banner).
- **Strings.** New `sync.conflict*` keys in en, es and pl.

### Tests

- **Server (`node:test`).** A stale version returns 409 with `current` and leaves the row unchanged. A matching version updates and increments. A missing version updates unconditionally and increments. A non-integer version returns 400. A partial body leaves the other columns untouched. A version for another user's row returns 404, not 409. POST and GET return `rowVersion`.
- **Jest.** `diffFields` and `classifyConflict` get positive and negative cases, including nested objects and arrays, `undefined`, `null` and number-vs-string values.
- **Playwright.**
  - Two tabs (#563): tab A renames a debt, stale tab B edits its balance, and after a reload both changes are present.
  - Same-field conflict: the modal appears. Keep mine wins on the server; Use theirs updates the local copy.
  - Partial bodies: an archive toggle sends only `archived`.
  - Two rapid edits in one tab don't conflict with each other.

## PR 2: refresh and "deleted elsewhere" (#575, #565)

- **Cross-tab broadcast.** After each successful write, `postgresSync.js` posts `{ type: 'changed' }` on `BroadcastChannel('myfinances')`. Other tabs schedule a refresh, debounced by 300 ms.
- **Focus refresh.** On `visibilitychange` to visible, a tab that was hidden for at least `REFRESH_ON_FOCUS_SECONDS` schedules a refresh.
  - The value comes from env, default 60 s, delivered through `window.__ENV__` from the same entrypoint script that writes `GA_MEASUREMENT_ID`.
  - 0 means refresh on every return.
  - A negative or invalid value falls back to 60.
- **Refresh.** `loadFromPostgres(app)` re-runs and re-seeds the shadows, then `refreshCurrentPageData()` and `updateUI()` run.
- **Deferral.** A refresh is deferred, and retried, while:
  - a write is pending;
  - any `app.editing*Id` is set;
  - a modal is open;
  - focus is in a form control inside a page.
- **"Deleted elsewhere".** A 404 on PATCH or DELETE of a record shows a distinct notice, "This item was changed or deleted in another tab or device", with a Reload action that runs the refresh. It replaces the "check your connection" banner, and the stale local record is dropped.
- **Tests.**
  - A record added through the API in "tab A" appears in tab B within a second.
  - A record deleted through the API disappears when the tab regains focus (threshold 0 in the test).
  - An open inline edit survives a refresh attempt; the refresh is deferred.
  - A 404 on edit shows the distinct notice, not the connection banner.
  - The env value is parsed and validated.
