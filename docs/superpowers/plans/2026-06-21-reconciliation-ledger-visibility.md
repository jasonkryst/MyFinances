# Reconciliations on the Ledger + Reconciliation Mode Setting — Implementation Plan

**Status:** Complete (v4.0.0)

**Goal:** Show reconciliations as transparent marker rows on the unified Ledger, and
add a generic, extensible `app.settings` array backing a reconciliation-mode setting
(adjust vs. visible-only), decided once via a first-run setup wizard and changeable
later via a Settings modal. Storage format bumped `3.0` → `4.0.0`.

**Architecture:** New `src/settings.js` (`getSetting`/`setSetting`,
`RECONCILIATION_ADJUSTS_BALANCE`) backs `app.settings`. New `src/setupWizard.js`
renders both the first-run wizard modal and the Settings modal. `src/storage.js` gets
`sanitizeSetting()` wired into load/import/export/clear. `src/ledger.js` folds
`app.reconciliations` into each account's transaction list as `type: 'reconciliation'`,
`transactionId: null` rows. `src/reconciliation.js`'s `applyReconciliation` gates the
`account.startingBalance` mutation on the setting.

**Tech Stack:** Vanilla ES6 modules, Playwright + pytest, served via
`python -m http.server 5500`.

---

## Setup

```bash
python -m http.server 5500
```

---

### Task 1: `app.settings` model + `src/settings.js` — ✅ Done
- [x] `getSetting(app, key, defaultValue)`, `setSetting(app, key, value)`,
      `RECONCILIATION_ADJUSTS_BALANCE` constant
- [x] `DebtTrackerApp` delegating `getSetting`/`setSetting` methods
- [x] `tests/features/test_settings.py`

### Task 2: Storage sanitizer + version bump — ✅ Done
- [x] `sanitizeSetting()` in `src/storage.js`, wired into
      `sanitizeParsedState`/`exportAllJSON`/`importAllJSON`/`clearAllData`
- [x] `version: '4.0.0'` in export payload; `APP_VERSION` bumped in `src/utils.js`
- [x] Legacy import (no `settings` key) defaults cleanly to `[]`

### Task 3: Gate `applyReconciliation` on the setting — ✅ Done
- [x] `src/reconciliation.js`: mutate `account.startingBalance` only when
      `getSetting(app, RECONCILIATION_ADJUSTS_BALANCE, false)` is `true`
- [x] Entry (previousBalance/statementBalance/difference/note) recorded in both modes
- [x] `tests/features/test_reconciliation.py` extended for both modes

### Task 4: Ledger reconciliation marker rows — ✅ Done
- [x] `buildProjectedAccountTransactions` folds in matching `app.reconciliations`
      entries with `transactionId: null`, `originalAmount: 0`, `meta: {...}`
- [x] `renderLedgerPage` special-cases `type === 'reconciliation'` rows (icon, diff
      coloring, no override actions)
- [x] `tests/features/test_ledger.py` extended

### Task 5: First-run setup wizard — ✅ Done
- [x] `#setupWizardModal` in `index.html`; `maybeShowSetupWizard(app)` in
      `src/setupWizard.js`, called from the `app.js` constructor before
      `loadFromStorage()`
- [x] `tests/ui/test_setup_wizard.py`

### Task 6: Settings modal + gear button + command palette entry — ✅ Done
- [x] `#settingsModal`, gear `header-icon-btn` in toolbar
- [x] Command palette "Settings" entry
- [x] `tests/ui/test_setup_wizard.py`, `tests/ui/test_accessibility.py`

### Task 7: Security/XSS/integration coverage — ✅ Done
- [x] `tests/security/test_input_validation.py::test_sanitize_setting_rejects_xss_and_object_values`
- [x] `tests/security/test_xss.py::test_xss_in_reconciliation_ledger_row_account_name`
- [x] `tests/integration/test_workflows.py::test_clear_all_data_then_reload_retriggers_setup_wizard`

### Task 8: Full suite green — ✅ Done
- [x] `pytest tests/ -v` — 405 passed, 0 failed (after fixing 8 tests that assumed
      unconditional reconciliation-balance mutation, and 3 tests blocked by the new
      first-run wizard modal on non-`app_page` fixtures)

### Task 9: Documentation — ✅ Done
- [x] `README.md`, `ROADMAP.md` (version bump + changelog entry), `guide.html`
      (Reconciliation Mode + Settings + Ledger marker-row sections)
- [x] `docs/audit/security/SECURITY_AUDIT_2026-06-19.md` resolution-update note
- [x] This plan + the paired design spec
