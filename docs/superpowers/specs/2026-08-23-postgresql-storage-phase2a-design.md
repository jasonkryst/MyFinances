# PostgreSQL Storage Layer — Phase 2a: Async Bootstrap, Login, Backend Picker (Issue #53)

**Date:** 2026-08-23
**Issue:** [#53 STORAGE - SQL Storage Layer Implementation](https://github.com/jasonkryst/MyFinances/issues/53) (milestone V5.0.0)

## Summary

Phase 1 (#53, merged in [#94](https://github.com/jasonkryst/MyFinances/pull/94)) shipped a self-hosted Node.js + PostgreSQL backend with granular per-resource REST endpoints and zero frontend changes. This document specs **Phase 2a**: the frontend plumbing everything else needs — an async app bootstrap, a login gate, and a Postgres option in the Settings backend picker. It deliberately stops short of making individual mutations (add/edit/delete a debt, bill, etc.) actually persist to Postgres — that's Phase 2b — and stops short of migrating an existing local user's data to a fresh Postgres account — that's Phase 2c. Phase 2a alone is testable as: pick Postgres in Settings, log in, the app boots showing whatever's already in that Postgres account (empty, on a fresh account).

Local-only mode (`localStorage`/`sessionStorage`) remains the default and is unaffected — this phase only adds a third, opt-in path.

## Why granular REST changes the shape of this phase

Phase 1 chose granular per-resource REST over a bulk `/api/state` endpoint. `storageAdapters.js`'s existing interface (`get(key)`/`set(key, value)` on one whole blob) can't wrap that cleanly: a literal `PostgresAdapter` implementing the same interface would need its `get()` to fan out to all 14 read endpoints and reassemble the blob, and its `set()` to diff the entire app state against "what's known to be on the server" on every save — a hidden sync engine, which defeats the point of choosing granular REST in Phase 1.

Instead, Postgres gets its own load/save code path in `storage.js` (not a `StorageAdapter` implementation):
- **Load** still needs to fan out and reassemble — there's no way around that, regardless of how writes work — but it only happens once per app boot, not per save.
- **Save** shrinks to almost nothing, because Phase 2b will make each mutation site persist itself directly. The only thing `saveToStorage()` still needs to do for Postgres is sync the handful of scalar/settings fields (`monthlyPayment`, `strategy`, `ledgerSettings`, `forecastSettings`) that are read from DOM elements at save time today and have no dedicated mutation site of their own.

## Decisions

| Question | Decision |
|---|---|
| Sync model (from the Phase 1 follow-up decision) | Touch every mutation site directly (Phase 2b) rather than a diff-and-sync adapter. This phase (2a) only builds the load path and the settings-only save path; per-resource mutation wiring is Phase 2b. |
| `PostgresAdapter` as a `StorageAdapter` | No. Postgres gets dedicated `loadFromPostgres(app)`/branches in `saveToStorage(app)`/`loadFromStorage(app)` in `storage.js`, not a class implementing the `get`/`set`/`remove` interface. `storageAdapters.js`'s `LocalStorageAdapter`/`SessionStorageAdapter` are unaffected. |
| Login UI placement | Full-page gate (`#loginGate`), shown before the app shell renders when the backend preference is `postgres` and there's no valid session. Same gate handles first-boot-after-switching and mid-session expiry — one code path, not two. |
| Session-expiry handling mid-use | Any API call that gets a `401` re-shows the full-page login gate. In-memory unsaved edits are lost — consistent with the online-required, no-local-fallback model Phase 1 already chose. |
| Backend-picker "switch to Postgres" flow | Saves the preference (`setStorageBackendPreference('postgres')`) and reloads the page; the normal boot sequence then shows the login gate. No inline login form in the Settings modal — one login UI, not two. |
| Switching away from Postgres | Saves the preference and reloads; does **not** copy current server data back into local storage. Flagged as a known limitation (matches the existing modal's "Done" pattern of just applying the selection, and avoids building a second migration direction beyond Phase 2c's one-way local→Postgres flow). |
| Session-validity check on boot | `GET /api/plan-settings` — it always exists (server creates the row on first access via `getOrCreateRow`), so a `200` means "valid session," a `401` means "show the gate." No new endpoint needed. |

## Architecture

### `app.js` — async bootstrap

The constructor stays synchronous (DOM references, in-memory array defaults) — JS constructors can't be async. A new `async init()` method does everything that currently happens inline at the end of the constructor and is called from `DOMContentLoaded`, awaited before service worker registration:

```js
// DOMContentLoaded handler, was:
//   window.app = new DebtTrackerApp();
//   registerServiceWorker(window.app);
// becomes:
document.addEventListener('DOMContentLoaded', async () => {
    window.app = new DebtTrackerApp();
    await window.app.init();
    registerServiceWorker(window.app);
});
```

`DebtTrackerApp.prototype.init()`:
1. Reads `getStorageBackendPreference()`.
2. If `local`/`session`: calls the existing (synchronous, now just awaited-for-shape-consistency) `loadFromStorage()`, then `backfillIncomeAccountIds()`, `captureNetWorthSnapshot(...)`, version footer text — i.e. exactly what the constructor does today, moved verbatim.
3. If `postgres`: calls `checkPostgresSession()` (`GET /api/plan-settings`).
   - `200` → calls `loadFromPostgres(this)` (see below), then the same `backfillIncomeAccountIds()`/`captureNetWorthSnapshot()`/version-footer sequence.
   - `401` (or a network error — no backend reachable) → calls `showLoginGate(this)` and awaits its returned promise, which resolves only once login succeeds; then proceeds as the `200` case.

This keeps every other constructor-triggered side effect (net worth snapshot capture, version footer, etc.) running in the same relative order as today, just after an await instead of inline.

### Login gate — new module `src/loginGate.js`

Follows the exact `hidden`/`flex-visible` classList pattern already used by `#setupWizardModal`/`#settingsModal` (see `src/setupWizard.js`) — no new CSS pattern, no inline styles (CSP already forbids them).

```js
export function showLoginGate(app) {
    return new Promise((resolve) => {
        const gate = document.getElementById('loginGate');
        const form = document.getElementById('loginGateForm');
        const emailInput = document.getElementById('loginGateEmail');
        const passwordInput = document.getElementById('loginGatePassword');
        const errorEl = document.getElementById('loginGateError');

        gate.classList.add('flex-visible');
        gate.classList.remove('hidden');
        setTimeout(() => emailInput.focus(), 30);

        form.onsubmit = async (event) => {
            event.preventDefault();
            errorEl.textContent = '';
            const res = await fetch('/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: emailInput.value, password: passwordInput.value })
            });
            if (!res.ok) {
                errorEl.textContent = res.status === 429
                    ? 'Too many attempts. Try again later.'
                    : 'Invalid email or password.';
                return;
            }
            form.onsubmit = null;
            gate.classList.add('hidden');
            gate.classList.remove('flex-visible');
            resolve();
        };
    });
}
```

`index.html` gains a new top-level `#loginGate` div (structurally a full-viewport overlay, same z-index tier as the other full-page modals), never removed from the DOM, toggled via the same two classes as everything else — no new CSP surface, no inline handlers (`form.onsubmit` is assigned from the module, matching the existing `modal.onclick =` pattern already used throughout `setupWizard.js`/`reconciliation.js`).

### Postgres load path — `storage.js`

```js
const POSTGRES_RESOURCE_ENDPOINTS = {
    debts: '/api/debts', accounts: '/api/accounts', incomes: '/api/incomes',
    bonuses: '/api/bonuses', bills: '/api/bills', expenses: '/api/expenses',
    recurringTemplates: '/api/recurring-templates', emergencyFunds: '/api/emergency-funds',
    sinkingFunds: '/api/sinking-funds', reconciliations: '/api/reconciliations'
};

export async function checkPostgresSession() {
    const res = await fetch('/api/plan-settings');
    return res.ok;
}

export async function loadFromPostgres(app) {
    const entries = Object.entries(POSTGRES_RESOURCE_ENDPOINTS);
    const [lists, snapshots, settingsRows, overrides, planSettings] = await Promise.all([
        Promise.all(entries.map(([, path]) => fetch(path).then(r => r.json()))),
        fetch('/api/net-worth-snapshots').then(r => r.json()),
        fetch('/api/settings').then(r => r.json()),
        fetch('/api/ledger-overrides').then(r => r.json()),
        fetch('/api/plan-settings').then(r => r.json())
    ]);

    entries.forEach(([field], i) => { app[field] = lists[i]; });
    app.monthlySnapshots = snapshots;
    app.settings = settingsRows;
    app.ledgerAmountOverrides = Object.fromEntries(overrides.map(o => [o.overrideKey, o]));
    app._savedMonthlyPayment = planSettings.monthlyPayment;
    app._savedStrategy = planSettings.strategy;
    app.perMonthStimulus = planSettings.perMonthStimulus;
    app.netWorthMilestonesAwarded = planSettings.netWorthMilestonesAwarded;
    app._ledgerAccountFilter = planSettings.ledgerSettings.accountFilter;
    app._ledgerDateRange = planSettings.ledgerSettings.dateRange;
    app._ledgerSortKey = planSettings.ledgerSettings.sortKey;
    app._ledgerSortDir = planSettings.ledgerSettings.sortDir;
    app._forecastRangeMonths = planSettings.forecastSettings.rangeMonths;
    app._forecastAccountId = planSettings.forecastSettings.accountId;
    app._forecastNotableThresholdPct = planSettings.forecastSettings.notableThresholdPct;
}
```

No client-side re-sanitization is needed here — every value already passed through the matching `sanitize*` function server-side before being stored (Phase 1's design), and `ledger_amount_overrides`'s `override_key` column round-trips as `overrideKey` in the JSON response, reassembled back into the `{ [key]: {...} }` map shape the rest of the app already expects from `sanitizeLedgerOverrides`.

### `saveToStorage(app)` — Postgres branch

```js
export async function saveToStorage(app) {
    if (app._storageBackendKind === 'postgres') {
        try {
            await fetch('/api/plan-settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfCookie() },
                body: JSON.stringify({
                    monthlyPayment: parseFloat(document.getElementById('monthlyPayment')?.value) || null,
                    strategy: document.getElementById('paymentStrategy')?.value || null,
                    ledgerSettings: {
                        accountFilter: app._ledgerAccountFilter || 'all',
                        dateRange: app._ledgerDateRange || 'all',
                        sortKey: app._ledgerSortKey || 'date',
                        sortDir: app._ledgerSortDir || 'desc'
                    },
                    forecastSettings: {
                        rangeMonths: app._forecastRangeMonths || 1,
                        accountId: app._forecastAccountId || 'total',
                        notableThresholdPct: app._forecastNotableThresholdPct || 130
                    }
                })
            });
            return true;
        } catch (error) {
            console.error('Error saving plan settings to Postgres:', error);
            return false;
        }
    }
    // ... existing local/session branch, unchanged
}
```

`getCsrfCookie()` is a small new helper (reads the non-httpOnly `csrf` cookie set at login) shared by every authenticated mutating `fetch` call — used here and, in Phase 2b, by every per-resource mutation site.

This is the **only** call site in Phase 2a's scope that writes to Postgres. Every one of the 50 existing `app.saveToStorage()` call sites across the 17 feature-module files is left completely untouched — for `postgres` mode they still fire, but now resolve to "sync the settings fields" instead of "write everything," and for `local`/`session` mode they behave exactly as today. Phase 2b is where those call sites' surrounding mutation logic (the array push/splice before the save) gets its own direct network call.

### Settings backend picker — `setupWizard.js`

```js
const save = () => {
    setSetting(app, RECONCILIATION_ADJUSTS_BALANCE, adjustsCheckbox.checked);
    if (storageSelect.value === 'postgres') {
        setStorageBackendPreference('postgres');
        location.reload();
        return; // reload takes over; don't also close()/setLocale() into a page that's going away
    }
    app.switchStorageBackend(storageSelect.value);
    app.setLocale(localeSelect.value);
    close();
};
```

`<select id="settingStorageBackend">` in `index.html` gains a third `<option value="postgres">`. No new modal, no new fields beyond the option itself — login happens on the next boot via the gate described above.

## Testing

New Playwright coverage, likely `tests/features/test_postgres_bootstrap.py` (mirroring `test_setup_wizard.py`'s structure), run against the app served through the real docker-compose stack (frontend + server + Postgres) rather than the plain `python -m http.server` used for local-only tests, since this phase has nothing to test without a real backend:

- Boot with `postgres` preference + no session → login gate shown, app shell not rendered underneath
- Successful login → gate hides, app boots with data from the 14 reassembled endpoints (seed a couple of records via the backend's own REST API in test setup, confirm they render)
- Wrong password → gate stays, error message shown, no session cookie set
- Boot with `postgres` preference + an already-valid session cookie (simulate by logging in via API first, then loading the page) → gate never shown, app boots straight through
- Simulate session expiry (delete the session server-side between boot and a later action) → next action that hits a `401` re-shows the gate
- Settings modal: selecting Postgres and clicking Done reloads the page and lands on the login gate; selecting Local/Session still uses the existing migrate-via-save path unchanged (regression coverage for the existing `test_setup_wizard.py` cases)

Existing Playwright suite (local-only, no backend) must keep passing unmodified — this phase adds a new path, it doesn't change the default one.

## Out of scope (this document)

- Any per-resource mutation actually persisting to Postgres (Phase 2b) — `addDebt`/`editBill`/etc. still only mutate local arrays and call the (now settings-only, for Postgres) `saveToStorage()`.
- Migrating an existing local user's data into a fresh Postgres account (Phase 2c).
- Copying Postgres data back into local storage when switching away from Postgres.
- Any change to `dataExport.js` (tracked separately, issue #95).
- Remember-me / longer-than-7-day sessions, password reset flows, or any auth UX beyond a single login form.

## Documentation updates

- `CLAUDE.md`: extend the Phase 1 "Backend service (optional, Phase 1)" bullet (or add a new one) once Phase 2a lands, noting the login gate and that `storage.js` now branches on `app._storageBackendKind` for Postgres.
- `CHANGELOG.md` + `APP_VERSION` bump per repo convention.
