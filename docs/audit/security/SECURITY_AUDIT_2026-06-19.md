# Security Audit — MyFinances

**Date**: June 19, 2026
**Version**: v3.6.4 (branch `nav-and-theme-fixes`, post-PR #18 test expansion)
**Auditor**: Automated + manual static review (Claude Code)
**Status**: ✅ **LOW RISK** — one **Medium** data-integrity finding, no Critical/High issues
**Scope**: Full source review (`src/*.js`, `index.html`, `nginx.conf`, `guide.html`), `pytest tests/security/` execution, manual cross-check of sanitization pipeline and import path.

This supersedes `SECURITY_AUDIT.md` and `SECURITY_REVIEW.md` (both dated May 29–31, 2026), which predate the Reconciliation, Cash Flow Forecasting, Spending Analysis, and Accessibility-audit features, and predate this session's test-suite expansion (264→324 tests) and bug-fix pass. Nothing here was auto-fixed — this is audit-only, for review and prioritization.

> **Resolution update (June 19, 2026, v3.8.0)**: Finding **M1** below has been fixed in `src/income.js` and `src/debts.js` (validate the raw input string before clamping, matching the existing `bills.js`/`recurring.js` pattern), with regression tests added for all 5 call sites — see [`ROADMAP.md`](../../../ROADMAP.md) Tier 0. The findings text below is left unmodified as the historical record of the audit; see ROADMAP.md for current remediation status.

> **Update (June 21, 2026, v4.0.0)**: Storage format moved to `4.0.0` with a new generic `app.settings` array (`src/settings.js`), backing a reconciliation-mode setting and a first-run setup wizard. The array is sanitized on load/import via a new `sanitizeSetting()` in `src/storage.js`: keys are run through `normalizeText(key, 60)` and dropped if empty after stripping `<>"\``/control characters; values are kept only if `boolean`, `number`, or a `normalizeText`-cleaned/length-capped string — objects, arrays, and functions are dropped entirely. New adversarial coverage: `tests/security/test_input_validation.py::test_sanitize_setting_rejects_xss_and_object_values`, `tests/security/test_xss.py::test_xss_in_reconciliation_ledger_row_account_name`. No new injection surface introduced — same `escapeHtml()`-at-render-site pattern is followed for the new reconciliation ledger marker rows.

---

## Executive Summary

MyFinances remains a client-side-only app (no backend, no auth, no network writes) with **XSS via `localStorage`/import as the primary threat model** — there is no server-side injection surface. The CSP is strict and consistently enforced, `escapeHtml()` is applied consistently at every `innerHTML` injection site that renders user data (sampled ~70 sites across all modules), and the import path enforces a 2 MB size cap, wraps `JSON.parse` in try/catch, and runs every incoming record through a dedicated `sanitizeX()` function before it touches app state.

The one finding worth fixing is **Medium severity**: the same "validate-the-already-clamped-value" bug class that was found and fixed in `src/bills.js` and `src/recurring.js` earlier this session is **still present, unfixed, in `src/income.js` (4 call sites) and `src/debts.js` (1 call site)**. It allows a negative income/bonus/fixed-debt-payment amount to silently become `$0.01` instead of being rejected — a data-integrity bug, not an XSS/injection vector, but real and currently shipping.

All 51 tests in `tests/security/` pass.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 2 |
| Informational | 3 |

---

## Findings

### M1 — Negative-amount validation bypass in Income/Bonus and Fixed-Amount Debt forms (Medium)

**Locations**:
- `src/income.js:160-161` (`addIncome`)
- `src/income.js:211-217` (`saveEditIncome`)
- `src/income.js:233-236` (`addBonus`)
- `src/income.js:279-285` (`saveEditBonus`)
- `src/debts.js:46-50` (`addDebt`, fixed-amount debt type branch)

**Issue**: Each of these calls `sanitizeFiniteNumber(rawValue, NaN, { min: 0.01 })` and then validates with `isNaN(amount) || amount <= 0`. But `sanitizeFiniteNumber` (src/utils.js:25-31) clamps any finite value below `min` **up to `min`**, not to the fallback:

```js
export function sanitizeFiniteNumber(value, fallback = 0, { min = null, max = null } = {}) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    if (min !== null && n < min) return min;   // <-- a negative input becomes 0.01, not NaN
    ...
}
```

So entering `-500` for an income amount produces `amount = 0.01` (finite, not `<= 0`), which **passes** the `isNaN(amount) || amount <= 0` check and gets silently saved as a one-cent income source. The same applies to one-time bonuses and fixed-amount debt payments.

This is the exact bug class found and fixed in `src/bills.js` (`addExpense`/`saveEditExpense`) and `src/recurring.js` (`addRecurringTemplate`/`saveEditRecurring`) during this session's test-suite expansion — those two files were corrected to validate against the **raw input string** before clamping; income.js and the debts.js fixed-amount path were not.

**Impact**: Data integrity only (no XSS/injection). A user who fat-fingers a negative sign gets a wrong, hard-to-notice $0.01 entry instead of a validation error — this can silently corrupt cash-flow forecasts, health dashboard ratios, and net-worth snapshots that consume these values.

**Remediation**: Apply the same fix pattern used in `src/bills.js`/`src/recurring.js`: capture the raw `.value` string before calling `sanitizeFiniteNumber`, and validate `!raw || isNaN(Number(raw)) || Number(raw) <= 0` against the raw value, not the clamped one.

---

### L1 — Inconsistent escaping of caught-exception messages (Low)

**Location**: `src/ui.js:123`

```js
if (resultEl) resultEl.innerHTML = `<div class="target-result target-result--error">Error: ${err && err.message ? err.message : String(err)}</div>`;
```

This renders `err.message` directly into `innerHTML` without `escapeHtml()`. The equivalent error-rendering paths in `src/strategy.js:102` and `src/strategy.js:542` do wrap the same kind of value in `escapeHtml()`. In practice `err.message` here originates from internal `DebtCalculator`/app exceptions (not direct user input), so this is not an exploitable XSS path today, but it's an inconsistency that becomes a real risk if any future exception path ever surfaces user-controlled text in `.message` (e.g. a custom validation error that echoes a field value).

**Remediation**: Wrap with `escapeHtml()` for consistency with the rest of the codebase's error-rendering convention.

---

### L2 — `accounts.js:16` generic `innerHTML` setter takes a raw `opts` argument (Low / Informational-leaning)

**Location**: `src/accounts.js:16` — `el.innerHTML = opts;`

This is a small helper (`setOptions`-style) used to populate `<select>` `<option>` lists. All current call sites pass pre-built, already-escaped option HTML constructed from internal account data flowing through `escapeHtml()` upstream. No live issue found, but the helper itself has no defensive escaping at its boundary, so a future caller passing unescaped user text would silently introduce an XSS hole with no warning at the call site.

**Remediation**: Either rename the parameter/add a comment documenting the "caller must pre-escape" contract, or have the helper itself defensively escape if it ever needs to take raw option labels.

---

### Informational

**I1 — CSP and security headers**: `index.html`'s CSP meta tag and `nginx.conf`'s `Content-Security-Policy` header are byte-for-byte in sync (verified by direct diff and by the passing `test_csp_meta_and_nginx_header_stay_in_sync` test). `script-src 'self' https://cdn.jsdelivr.net`, `style-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` are all present. No inline `<script>` or `style="..."` attributes were found anywhere in `index.html`, `guide.html`, or `src/*.js`-rendered markup. No `eval(`/`new Function(` usage anywhere in `src/`.

**I2 — Chart.js dependency pinning**: The CDN `<script>` tag (`index.html:830`) pins an exact version (`chart.js@4.4.3`) and includes a Subresource Integrity hash (`integrity="sha384-..."`) with `crossorigin="anonymous"` — this is the correct mitigation for a CDN-hosted dependency and was already in place; no action needed.

**I3 — Import path hardening**: `importAllJSON` (src/storage.js) enforces the 2 MB cap (`MAX_IMPORT_BYTES`) by checking `file.size` **before** reading/parsing, wraps `JSON.parse` in try/catch with a dedicated `onInvalidJSON` callback, and routes every field of the parsed payload through `sanitizeParsedState()` → per-record `sanitizeX()` functions before it ever reaches app state or re-renders. Legacy v1.0 bare-array (`Array.isArray(parsed) ? { debts: parsed } : parsed`) and `version` field formats are both handled and covered by `tests/features/test_storage_import.py`. No DoS or parser-confusion risk identified.

---

## Sanitization Pipeline Cross-Check

Every persisted `DebtTrackerApp` state array (`debts`, `accounts`, `incomes`, `bonuses`, `bills`, `expenses`, `recurringTemplates`, `emergencyFunds`, `sinkingFunds`, `monthlySnapshots`, `reconciliations`, `ledgerAmountOverrides`) has a corresponding `sanitizeX()` function in `src/storage.js`, confirmed by direct cross-reference against `src/app.js`'s state initialization (lines 106-118). No persisted field was found without sanitizer coverage.

## Test Suite Results

```
pytest tests/security/ -v
51 passed in 79.45s
```
All XSS (17), input-validation (19), CSP (5), and static-scan (12) tests pass cleanly, including the CSP-sync regression test and the three new XSS tests added this session (reports calendar expense name, recurring template name, sinking fund name/notes).

## Overall Risk Rating: **LOW**

The app's threat model (client-side only, no auth, no server) is narrow and well-defended: CSP is strict and verified in sync across both deployment surfaces, `escapeHtml()` discipline is consistent, and the import/sanitization pipeline has full coverage. The one Medium finding (M1) is a data-correctness bug, not a security vulnerability in the traditional sense, but is flagged here because it's the same root-cause pattern (clamp-before-validate) that was just fixed elsewhere in the same codebase this session — worth closing out for consistency before it's forgotten.
