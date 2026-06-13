# Account Reconciliation Tool — Design Spec

**Date**: 2026-06-11
**Status**: Approved (pending user sign-off on this doc)
**Roadmap item**: 🔧 Account Reconciliation Tool (Priority: LOW-MEDIUM, Effort: MEDIUM, v3.4+)

## Goal

Let users compare the app's tracked balance for an account against their real
bank/statement balance, correct discrepancies in a guided and logged way, and
review a history of past adjustments. Also give users a quick way to spot
expected transactions they may have missed when reconciling.

## Non-goals

- No bank feed import or automatic transaction matching — the app has no
  concept of "actual" historical transactions, only projected/scheduled ones
  generated from income, bills, debts, recurring templates, etc.
- Reconciliation does not create ledger transactions or affect
  `ledgerAmountOverrides`. It only adjusts `account.startingBalance`.

## Data model

New top-level state array, `app.reconciliations`, persisted like every other
entity collection:

```js
{
  id,                // Date.now()-based unique id
  accountId,         // int, references app.accounts[].id (may become orphaned if account deleted)
  date,              // ISO date (YYYY-MM-DD), always today's date when the entry is created
  previousBalance,   // account.startingBalance immediately before this reconciliation
  statementBalance,  // user-entered real balance from their bank/statement
  difference,        // statementBalance - previousBalance (stored for convenience/audit)
  note,              // free text, normalizeText(~200 chars), may be empty
  createdAt          // ISO timestamp of when the entry was recorded
}
```

Every entry represents a "🔄 Balance Reconciliation" event — this label is
rendered on every history row regardless of the user's note content, so
reconciliation events are unmistakable in the history table even if the user
leaves a note about something unrelated.

### Storage wiring (`src/storage.js`)

- `sanitizeReconciliation(record, idFallback)`:
  - `id`: `sanitizeInteger`
  - `accountId`: `sanitizeInteger(record?.accountId, null)`
  - `date`: `sanitizeDateISO`, fallback to today if missing/invalid
  - `previousBalance`, `statementBalance`, `difference`: `sanitizeFiniteNumber` (no min/max — accounts like credit cards/loans can be negative)
  - `note`: `normalizeText(record?.note, 200)`
  - `createdAt`: `sanitizeDateISO`, fallback to `new Date().toISOString()`
- Add `reconciliations: (Array.isArray(parsed.reconciliations) ? ... : []).map(...).filter(r => r.accountId !== null && Number.isFinite(r.statementBalance))` to `sanitizeParsedState`
- `saveToStorage` / `loadFromStorage`: add `app.reconciliations` to the persisted payload and restore it
- `exportAllJSON` / `importAllJSON`: include `reconciliations` in both the replace and merge-duplicates branches (merge branch: re-id like other collections to avoid id collisions)
- `clearAllData`: reset `app.reconciliations = []`

Orphaned entries (account later deleted) are kept as historical record; the
UI renders them with an "Unknown account" label rather than crashing.

## New module: `src/reconciliation.js`

Follows the same `export function xyz(app, ...)` pattern as `accounts.js`,
bound onto `DebtTrackerApp` in `app.js`.

- `renderReconciliationPage(app)` — renders the full Reconcile page: one
  reconcile card per account, plus the history table below.
- `applyReconciliation(app, accountId, statementBalance, note, date)` — core
  logic shared by the page form and the ledger modal:
  1. Validate `statementBalance` is finite (reject otherwise, same `alert()`
     pattern as `addAccount`).
  2. Capture `previousBalance = account.startingBalance`.
  3. Set `account.startingBalance = statementBalance`.
  4. Push a new entry to `app.reconciliations` (`difference = statementBalance - previousBalance`).
  5. `app.saveToStorage()`, then re-render reconciliation page, accounts list,
     net worth widget, and ledger page (if currently visible).
- `reconcileAccount(app, accountId)` — reads the per-account form inputs on
  the Reconcile page and calls `applyReconciliation`.
- `deleteReconciliationEntry(app, id)` — removes a history entry (does not
  revert `startingBalance`).
- `getExpectedTransactionsInRange(app, accountId, startDate, endDate)` —
  the "find missing transactions" helper. Iterates each calendar month from
  `startDate` to `endDate`, calls the existing
  `getLedgerTransactionsForMonth(app, year, month, accountId)` from
  `ledger.js` for each, filters to transactions whose date falls within
  `[startDate, endDate]`, and returns them sorted ascending by date.
- `openReconcileModal(app, accountId)` — opens the quick-reconcile modal
  (used from the Ledger page), pre-filled with the account's current tracked
  balance; on confirm calls `applyReconciliation`.

## UI: Reconcile page

- New nav button: `<button class="page-button" data-page="reconcile">Reconcile</button>` in `index.html`
- New section `<section class="reconcile-section page-section" id="reconcileSection">`
- New `switchPage` mapping entry `reconcile: 'reconcileSection'` in `ui.js`,
  calling `app.renderReconciliationPage()` on activation

**Per-account reconcile card** (styled like `.acct-card`):
- Account name/type icon (reuse `typeIcon` map from `accounts.js`)
- "Current Tracked Balance" = `account.startingBalance`
- "Statement Balance" number input
- Live-computed difference (oninput handler, no save), color-coded:
  positive = green, negative = red, zero = neutral
- Optional note input
- "Reconcile" button → `reconcileAccount(app, accountId)`
- Collapsible `<details>` "Expected transactions since {date}" — `{date}` is
  this account's most recent reconciliation date, or the 1st of the current
  month if none exists. Lists date/name/amount/category from
  `getExpectedTransactionsInRange`. Empty state: "No expected transactions in
  this period."

**History table** (below all cards, styled like `.ledger-table`):
- Columns: Date, Account, 🔄 Balance Reconciliation badge + note, Previous → Statement (with diff, color-coded), Delete action
- Account filter dropdown (same pattern as `#ledgerAccountFilter`), stored as `app._reconciliationAccountFilter`
- Sorted by date descending
- Empty state if `app.accounts.length === 0`: "No accounts yet. Add an account first to reconcile its balance." (mirrors `accounts.js` empty state)

## Ledger page integration

- In `ledger.js`'s `renderLedgerPage`, when `selectedAccount !== 'all'`, add a
  **"🔄 Reconcile this account"** button to `filterHtml`.
- New modal `#reconcileModal` in `index.html`, structured like the existing
  `#ledgerOverrideModal` (title, current tracked balance, statement balance
  input, note input, confirm/cancel/close buttons, Escape-to-close,
  Enter-to-confirm).
- Button's click handler calls `app.openReconcileModal(accountId)` —
  cross-module call through the `app` instance (same pattern as
  `app.renderAccountsList()` from `ledger.js`), avoiding a circular import
  between `ledger.js` and `reconciliation.js`.
- On confirm, `applyReconciliation` runs, then `renderLedgerPage(app)` is
  called to refresh the displayed running balances.

## CSS

New rules added to `styles-csp-classes.css` (or wherever account/ledger
styles live): `.recon-card`, `.recon-diff--pos/neg/zero`, `.recon-history-table`,
`.recon-badge`, following existing naming conventions (`acct-*`, `ledger-*`).

## Testing plan

### Backend/feature tests — `tests/features/test_reconciliation.py`
- `applyReconciliation` updates `account.startingBalance` to `statementBalance`
- History entry recorded with correct `previousBalance`/`statementBalance`/`difference`/`date`
- Reconciling with `difference === 0` still records an entry
- `getExpectedTransactionsInRange` returns correct transactions across a
  month boundary (e.g., range spanning end of one month into the next)
- `deleteReconciliationEntry` removes the entry without altering `startingBalance`
- Storage round-trip: `sanitizeReconciliation` rejects entries with
  non-finite balances or missing `accountId`; `exportAllJSON`/`importAllJSON`
  preserve `reconciliations` in both replace and merge modes; `clearAllData`
  resets `app.reconciliations`
- Orphaned reconciliation entries (account deleted) don't throw when rendering

### UI/UX tests — `tests/ui/test_reconciliation_actions.py`
- Empty state renders when no accounts exist
- Reconcile card shows correct current tracked balance and live difference
  color-coding as the statement balance input changes
- Clicking "Reconcile" updates the account's balance shown on the Accounts
  page and adds a row to the history table with the "🔄 Balance
  Reconciliation" badge
- History table account filter and delete action work correctly
- "Expected transactions since {date}" `<details>` shows the right
  transactions and an empty-state message when none exist
- Ledger page: "Reconcile this account" button only appears when a specific
  account is selected; opens `#reconcileModal`; confirming updates the ledger's
  running balances; Escape closes the modal, Enter confirms

### Security tests — additions to `tests/security/test_xss.py` and `tests/security/test_input_validation.py`
- XSS payload in the reconciliation note field is escaped in the history table
  (`test_xss_in_reconciliation_note`)
- Non-numeric/garbage statement balance input is rejected with an alert,
  matching `addAccount`'s validation behavior
- Negative statement balances are accepted (valid for credit cards/loans),
  consistent with `test_negative_balance`
- Extremely long note text is truncated per `normalizeText(..., 200)` on
  save/reload

### Accessibility tests — additions to `tests/ui/test_accessibility.py`
- All new inputs on the Reconcile page (`statement balance`, `note`) have
  associated `id`s/labels
- "Reconcile" buttons and the history table's delete buttons are real
  `<button>` elements, keyboard-focusable
- `#reconcileModal` traps Escape/Enter the same way `#ledgerOverrideModal`
  does, and focus moves to the statement balance input on open

## Docs

- `ROADMAP.md`: move "🔧 Account Reconciliation Tool" from the v3.4+ PROPOSED
  list to a shipped entry, following the format used for Cash Flow
  Forecasting (date-stamped "shipped early" note).
