# Account Transfer Tracking — Design

**Date:** 2026-10-26
**Status:** Approved — signed off 2026-10-26, see Decisions below

## Problem

Moving money between two of the user's own accounts (e.g. $500 from Checking to Savings) is
invisible today: it shows as an unexplained outflow on one account and an unexplained inflow on
the other, since there is no record type that ties the two sides together. There is no zero-sum
"transfer" concept for one-off, dated money movements.

## Key finding: this is 80% already built

`src/recurring.js` already has a full `type: 'transfer'` option on **recurring templates**, with a
`targetAccountId` field, a "Transfer" category, a 🔄 badge, and a source/target account selector in
the Add/Edit form. `src/ledgerTransactions.js` (lines ~191–209) already generates **two** ledger
legs per occurrence — a negative-amount leg on `tmpl.accountId` and a positive-amount leg on
`tmpl.targetAccountId`, both tagged `type: 'recurring'`, `sourceId: tmpl.id` — and that's the whole
mechanism. No other file special-cases it: `computeAccountBalance()` (`accounts.js`) sums whatever
`getLedgerTransactionsForMonth()` returns for an account, so the two legs net to zero across the
pair of accounts automatically, and Reports/Forecast/Health inherit correctness for free because
they all derive from the same generator (per the existing cross-cutting-features note in
`CLAUDE.md`).

This means the hard part of #248 — proving a two-leg, opposite-signed transaction pair keeps every
downstream balance/net-worth calculation correct with zero bespoke math — is **already shipped and
running in production** for the recurring case. What's actually missing is narrower than the
original "1+ week" P2 framing suggested:

1. A **one-off, dated** sibling to the recurring-transfer concept — `app.transfers`, not bound to a
   recurring schedule. (A truly one-time transfer forced through `recurringTemplates` would need an
   awkward single-occurrence schedule and would clutter the Recurring page with non-recurring
   entries.)
2. A dedicated Ledger **visual indicator** for transfer rows — the one acceptance-criterion item the
   existing recurring-transfer legs do *not* yet have (they render as plain `type: 'recurring'` rows
   with "Transfer (out)"/"Transfer (in)" text, no distinct icon/badge).
3. The storage/export/Postgres plumbing for the new collection.

The one-off, exact-dated generation pattern (as opposed to a recurring schedule) is itself already
proven too: `app.expenses` records carry a plain `date` field and are filtered into a given
(year, month) with `expDate.getFullYear() === year && expDate.getMonth() === month` before a single
`addTx()` call (`ledgerTransactions.js` lines ~161–174). Transfers combine that exact-date filter
with the recurring-transfer's two-`addTx()`-calls shape.

## Goals

- New `transfer` record type in `app.transfers`: `{ id, fromAccountId, toAccountId, amount, date, memo, createdAt }`.
- `sanitizeTransfer()` in `src/sanitizers.js`; survives export/import round-trip.
- A lightweight transfer form (modal), reachable from both the Accounts page and the Ledger page.
- Ledger shows both legs with a distinct visual "transfer" indicator (not reusing `type: 'recurring'`).
- `computeAccountBalance()` factors transfer legs in automatically, with **no changes to that
  function** — it already sums every transaction `getLedgerTransactionsForMonth()` returns.
- Wired through local/session storage, export/import, and the optional Postgres backend.
- Running Ledger balance stays correct in the presence of transfers (follows from the generator
  reuse above — no new balance math).

## Non-goals

- Editing a transfer's two legs *independently*. A transfer is one record with two generated legs;
  edit and delete act on the whole record (see Decisions — edit is in scope for v1, but always
  edits the record, never a single leg).
- Scheduled/recurring transfers — already covered by `recurring.js`'s existing `transfer` type. This
  issue is for one-off/ad hoc transfers only.
- Multi-currency conversion.
- Retrofitting the new Ledger visual indicator onto existing recurring-transfer-sourced rows (both
  currently render as generic `type: 'recurring'`). Spun out as its own fast-follow: **issue #399**.
- A dedicated "Transfers" list/history page. The Ledger (filterable per account) and each account's
  balance breakdown already surface them; a standalone list view is a follow-up if requested.
- Letting a transfer leg participate in `ledgerAmountOverrides`. Overriding one leg without the
  other would break the zero-sum guarantee — each leg may still be independently marked "cleared"
  (informational/per-account), per the Decisions below.

## Data model

```js
{
  id,              // integer
  fromAccountId,   // integer, required
  toAccountId,     // integer, required, must differ from fromAccountId
  amount,          // finite number > 0 (magnitude; sign applied per leg at generation time)
  date,            // YYYY-MM-DD
  memo,            // optional, normalizeText <= 200 chars
  createdAt        // ISO timestamp
}
```

`sanitizeTransfer(record, idFallback)` mirrors `sanitizeExpense`'s shape (`sanitizeInteger`,
`sanitizeFiniteNumber`, `sanitizeDateISO`, `normalizeText`) and is called by the same
`_sanitizeRecordArray` helper every other collection uses in `sanitizeParsedState`/`importAllJSON`
(per the `CLAUDE.md` warning: using a bare `.map().filter()` here would silently opt the collection
out of the #291 import-warnings system). A record is dropped (not coerced) when `fromAccountId`/
`toAccountId` are missing or equal, or `amount` is non-positive — the same "reject invalid, keep
valid" convention `sanitizeReconciliation` already follows.

## Ledger generation (`src/ledgerTransactions.js`)

Add a loop alongside the existing `app.expenses` loop in `buildProjectedAccountTransactions`,
filtered the same way (`transfer.date` falls in the (year, month) being built), emitting two
`addTx()` calls per in-range transfer:

```js
for (const t of app.transfers || []) {
    if (!t.date) continue;
    const tDate = new Date(`${t.date}T00:00:00`);
    if (tDate.getFullYear() !== year || tDate.getMonth() !== month) continue;
    const toAcct = (app.accounts || []).find(a => a.id === t.toAccountId);
    const fromAcct = (app.accounts || []).find(a => a.id === t.fromAccountId);
    addTx({
        accountId: t.fromAccountId, date: tDate,
        name: `Transfer to ${toAcct?.name || 'account'}`,
        amount: -Math.abs(Number(t.amount)), type: 'transfer', sourceId: t.id,
        category: 'Transfer'
    });
    addTx({
        accountId: t.toAccountId, date: tDate,
        name: `Transfer from ${fromAcct?.name || 'account'}`,
        amount: Math.abs(Number(t.amount)), type: 'transfer', sourceId: t.id,
        category: 'Transfer'
    });
}
```

Both legs share `sourceId: t.id` but differ by `accountId`, so `makeLedgerTransactionId()`
(`type|sourceId|accountId|date`) naturally produces two distinct ids — no collision handling needed.
If either account was since deleted, `addTx()`'s existing `accountMap[accountId] ? accountId :
UNLINKED_KEY` fallback already handles the orphan generically (same path every other source type
gets); no transfer-specific orphan logic is required.

## Balance / net worth math

No changes to `computeAccountBalance()`, `reportsNetWorth.js`, `forecast.js`, or `health.js`. Each
already derives entirely from `getLedgerTransactionsForMonth()`'s output, and a transfer is just two
more entries in that stream — exactly how the recurring-transfer legs already net to zero today.
This is the direct, demonstrable answer to the issue's "avoids double-counting in net worth and cash
flow calculations" requirement: it's satisfied by construction, not by new logic.

## Ledger UI (`src/ledger.js`)

- New visual indicator for `tx.type === 'transfer'` rows: a prefix icon in `nameCell`, parallel to
  reconciliation's `🔄` prefix. Recommend **⇄** to stay visually distinct from reconciliation's `🔄`
  and the Recurring page's own `🔄` type badge (see Open Questions).
- The outflow/inflow leg names already encode the counterpart account (`Transfer to Savings` /
  `Transfer from Checking`) per the generation design above, so no extra per-row lookup is needed in
  `ledger.js` itself.
- `canOverride`'s existing condition (any non-rollover, non-reconciliation type with a
  `transactionId`) would currently also cover `type: 'transfer'` — this needs an explicit exclusion
  (`!isTransfer`) alongside `isReconciliation`, since overriding a single leg's amount independently
  breaks the zero-sum guarantee. Cleared-checkbox and row-select, which key off the same
  `canOverride` flag, need the same exclusion or a separate flag if cleared-marking should stay
  available while override doesn't.
- `navableTypes` (`['debt', 'income', 'recurring']`) intentionally does not gain `'transfer'` — there
  is no transfer "page" to navigate to (non-goal: no dedicated Transfers page).

## Entry points

A `#transferModal`, structurally modeled on `#reconcileModal` (focus trap, Escape to close, Enter
confirms on an input, focus-restore on close) — same established no-native-dialogs pattern. Opened
from:
- **Accounts page**: a new "⇄ Transfer" action on each account card, pre-filling `fromAccountId`.
- **Ledger page toolbar**: a new button, with both accounts left for the user to pick (matches the
  issue's "Transfer form accessible from Accounts or Ledger page" criterion literally — both, not
  either/or).

## Module: `src/transfers.js`

Follows the `featureFn(app, ...)` convention used throughout. Lazy-loaded via `src/lazyModules.js`
(the issue #278 code-splitting pattern already covers `reconciliation.js`/`retirement.js`/etc. — a
Transfers module that most sessions never touch is a clean fit), with `app.js` wrapper methods
following that group's `async ... { const mod = await loadTransfersModule(); return mod.xxx(this, ...); }`
shape.

- `addTransfer(app, fromAccountId, toAccountId, amount, date, memo)` — validates
  `fromAccountId !== toAccountId` and `amount > 0` before pushing (mirrors `applyReconciliation`'s
  `{ success, error }` return shape); calls `pgPost` when `app._storageBackendKind === 'postgres'`.
- `editTransfer(app, id, { fromAccountId, toAccountId, amount, date, memo })` — same validation as
  `addTransfer`, applied to the existing record in place; calls `pgPatch` on Postgres. Edit is in
  scope for v1 (see Decisions), so `openTransferModal` needs an edit mode mirroring
  `editingDebtId`/`editingIncomeId`'s pattern in `app.js` (an `app._editingTransferId` flag the modal
  checks to decide `addTransfer` vs. `editTransfer` on submit, and to pre-fill fields).
- `deleteTransfer(app, id)` — removes the one record (both legs disappear together on next render,
  since they're generated from it, not stored separately).
- `openTransferModal(app, { fromAccountId, editId } = {})` — `editId` pre-fills from the existing
  record and switches the modal into edit mode.

## Storage / export (`src/storage.js`, `src/dataExport.js`)

- `app.transfers = []` added to the `app.js` constructor and to `clearAllData` (`storage.js`).
- `sanitizeParsedState` (the normal load-from-storage path) and `importAllJSON` both sanitize
  `app.transfers` via `sanitizeTransfer` using the standard `_sanitizeRecordArray` helper.
- Export payload gains `transfers: app.transfers || []` — additive array, format version stays
  `"3.0"` (consistent with how `reconciliations`/`planHistory` were added without a version bump).
- **FK remap on import**: `fromAccountId`/`toAccountId` must be remapped through the same
  `accountIdMap` construction already used for `balanceHistory` owners
  (`dataExport.js`, both the "replace" and "merge by name" code paths). A transfer whose account
  can't be resolved during a merge-by-name import is dropped with a warning rather than imported
  with a dangling reference — follow the #291 warnings convention (`{recordType: 'transfer', kind:
  'rejected', reason: ...}`).
- Id remapping on import: `Date.now() + 7000 + i` (next unused offset after `planHistory`'s `+6000`).

## Postgres

Follows the exact recipe `CLAUDE.md` already documents for `planHistory` (issue #162) and
`retirementSnapshots` (issue #345) — "no new sync logic needed since those are generic field-driven
loops":

- New migration: `transfers` table (`id`, `from_account_id` FK→`accounts`, `to_account_id`
  FK→`accounts`, `amount`, `date`, `memo`, `created_at`).
- `server/src/routes/transfers.js`:
  ```js
  export default createCrudResource({
      table: 'transfers',
      sanitize: sanitizeTransfer,
      requiredFields: ['fromAccountId', 'toAccountId'],
      foreignKeys: { fromAccountId: 'accounts', toAccountId: 'accounts' },
      columns: { id: 'id', fromAccountId: 'from_account_id', toAccountId: 'to_account_id',
                 amount: 'amount', date: 'date', memo: 'memo' }
  });
  ```
  (`crudRouter.js`'s `foreignKeys` is a plain field→table map iterated per field, so two FK fields
  pointing at the same `accounts` table needs no special casing there.)
- `postgresSync.js` (`POSTGRES_RESOURCE_ENDPOINTS`), `postgresImport.js` (`CRUD_RESOURCES`/
  `ALL_RESOURCE_PATHS`) each gain one entry.
- `pgDeleteAll` gains a `transfers` DELETE.
- `transfers.js`'s `addTransfer`/`deleteTransfer` call `pgPost`/`pgDelete` immediately after the
  in-memory mutation, per the Phase 2b convention (optimistic, console-only error handling).

## Testing

- **Unit/feature**: `sanitizeTransfer` positive/negative cases (equal accounts rejected,
  non-positive amount rejected, valid entries round-trip); ledger generation emits exactly two legs
  with opposite signs whose sum is zero when both accounts' months are combined; a transfer moves
  `computeAccountBalance()` correctly on both the source and destination account; a transfer
  referencing a since-deleted account generates/renders without throwing; export/import round-trip
  including FK remap in both replace and merge-by-name modes; `clearAllData` resets `app.transfers`
  (and triggers a `transfers` DELETE when the backend was Postgres).
- **UI**: transfer modal opens from both the Accounts card and the Ledger toolbar; submitting
  creates both legs; the Ledger row shows the new `⇄` indicator and correct From/To names on each
  leg; a transfer appears in both accounts' per-account Ledger filter views; `canOverride`/cleared
  checkbox are excluded (or scoped per the Open Questions decision) for transfer rows.
- **Postgres** (`tests/postgres/`): CRUD round-trip via the new route; behavior when an account
  referenced by a transfer is deleted (verify against whatever the existing `accounts` route already
  does for other FK-referencing resources — needs a direct check against `server/src/routes/accounts.js`
  at implementation time, not assumed here).

## Versioning & docs

Bump `APP_VERSION`/`CHANGELOG.md` per the usual convention. Add a `CLAUDE.md` Cross-cutting-features
bullet (same shape as the Home Purchase/Retirement entries), explicitly cross-referencing this spec
and the relationship to `recurring.js`'s existing transfer type.

## Decisions (signed off 2026-10-26)

1. **Ledger icon** — `⇄`, as suggested.
2. **Edit support** — in scope for v1. `editTransfer()` and an edit mode on `openTransferModal()`,
   per the Module section above.
3. **Retrofit the new indicator onto existing recurring-transfer legs?** No, split out as its own
   issue: **#399**.
4. **Entry points** — both (Accounts card action + Ledger toolbar button).
5. **Override/cleared exclusion scope** — agreed as proposed: transfer legs are excluded from
   `ledgerAmountOverrides` entirely, but each leg may still be independently marked "cleared."
