# Reconciliations on the Ledger + Reconciliation Mode Setting — Design Spec

**Date**: 2026-06-21
**Status**: Implemented (v4.0.0)
**Roadmap item**: Reconciliations on the Ledger + Reconciliation Mode Setting

## Goal

Show reconciliations as line items on the unified Ledger for transparency, and let
users decide — once, via a first-run setup wizard, and changeable later via a
Settings modal — whether a reconciliation actually mutates the account's tracked
balance ("Adjust balance", today's existing behavior) or is purely informational
("Visible only").

## Non-goals

- No per-account override of the mode — it is one global setting.
- No migration code for existing data — `getSetting()`'s default-value fallback
  means pre-4.0.0 exports/localStorage (no `settings` key) load cleanly and behave
  as visible-mode by default.

## Data model: `app.settings`

A generic, extensible config array: `[{ key: string, value: boolean|number|string }, ...]`,
so future settings append to the same array without a schema change. New module
`src/settings.js` exports `getSetting(app, key, defaultValue)`, `setSetting(app, key, value)`,
and the constant `RECONCILIATION_ADJUSTS_BALANCE = 'reconciliationAdjustsBalance'`
(default `false`). `DebtTrackerApp` gets thin delegating `getSetting`/`setSetting` methods.

`src/storage.js` adds `sanitizeSetting(record)`: drops entries with an empty/invalid
key (via `normalizeText(key, 60)`), and drops the entry entirely if `value` isn't a
`boolean`, `number`, or a `normalizeText`-cleaned/length-capped string (objects,
arrays, functions are rejected). Wired into `sanitizeParsedState()`, `exportAllJSON`,
`importAllJSON`, and `clearAllData`. Storage format version bumped `'3.0'` → `'4.0.0'`
(`src/utils.js`'s `APP_VERSION` bumped to match).

## First-run setup wizard

New `src/setupWizard.js`: `maybeShowSetupWizard(app)`, called once from the `app.js`
constructor, checks `localStorage.getItem('debtTrackerData') === null` (true first
run only) and shows a static modal (`#setupWizardModal` in `index.html`, mirroring
the `reconcileModal` pattern — ARIA dialog role, focus management, no cancel/escape
since a choice is required) offering "Adjust balance" vs. "Visible only". Existing
users (any prior data, even empty) never see it and default silently to visible mode.

## Settings modal

A new gear `header-icon-btn` in the toolbar and a "Settings" command-palette entry
open `#settingsModal`, a single-row toggle today (reuses the same `app.settings`
array, so a second setting is just another row, no redesign) for changing the
reconciliation mode after first run.

## Ledger integration

`src/ledger.js`'s `buildProjectedAccountTransactions` folds in each account's
`app.reconciliations` entries that fall within the projected window as a row with
`type: 'reconciliation'`, `transactionId: null` (mirrors the existing `rollover`
convention so it's naturally excluded from the amount-override modal), and
`originalAmount: 0` (correct in both modes — in adjust mode the balance jump already
happened synchronously in `applyReconciliation`; in visible mode nothing should move
the balance). `meta: { previousBalance, statementBalance, difference, note }` flows
through to the renderer, which shows "🔄 Balance Reconciliation (prev → statement)"
and color-codes the difference.

## Reconciliation gating

`src/reconciliation.js`'s `applyReconciliation` only mutates `account.startingBalance`
when `getSetting(app, RECONCILIATION_ADJUSTS_BALANCE, false)` is `true`. The
reconciliation entry (previousBalance/statementBalance/difference/note) is recorded
identically in both modes.

## Tests

New: `tests/features/test_settings.py`, `tests/ui/test_setup_wizard.py`. Extended:
`tests/features/test_reconciliation.py`, `tests/features/test_ledger.py`,
`tests/security/test_input_validation.py`, `tests/security/test_xss.py`,
`tests/integration/test_workflows.py`, `tests/ui/test_accessibility.py`. Full suite:
405 passed.
