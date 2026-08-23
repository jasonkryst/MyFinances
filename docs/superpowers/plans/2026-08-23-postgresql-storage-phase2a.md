# PostgreSQL Storage Layer — Phase 2a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add async app bootstrap, full-page login gate, and Postgres option in the Settings backend picker so the frontend can boot against a Phase 1 PostgreSQL backend.

**Architecture:** The constructor stays synchronous (DOM references, in-memory defaults); a new `async init()` method replaces the inline boot sequence and branches on `_storageBackendKind === 'postgres'` to check session validity, optionally show a full-page login gate, then fan-out-load from 14 REST endpoints via `Promise.all`. Local/session mode runs the same sync path as today, moved verbatim into `init()`. Per-resource mutations are not wired in this phase (Phase 2b).

**Tech Stack:** Vanilla ES6+ modules, Playwright/pytest for tests, Node.js + PostgreSQL backend (Phase 1) for integration tests, docker-compose for the test-postgres CI job.

**Spec:** `docs/superpowers/specs/2026-08-23-postgresql-storage-phase2a-design.md`

## Global Constraints

- No build step — all JS is plain ES6+ modules loaded directly by `index.html`; no bundler, no transpile
- Strict CSP: no inline `style=""`, no inline `<script>`, no `eval()`; dynamic styling via `classList` only
- `APP_VERSION` in `src/utils.js` and `CACHE_NAME` in `sw.js` must be bumped together (enforced by `tests/features/test_pwa.py`)
- `APP_VERSION` and `CHANGELOG.md` heading must match (enforced by `tests/features/test_versioning.py`)
- All new `fetch` calls to mutating endpoints must include `X-CSRF-Token: getCsrfCookie()` header
- Existing Playwright tests (`tests/features/`, `tests/ui/`, `tests/security/`, `tests/integration/`) must keep passing unmodified

---

### Task 1: Login gate HTML + CSS + storage backend option

**Files:**
- Modify: `index.html` (add `#loginGate` div and `<option value="postgres">`)
- Modify: `styles.css` (add overlay styles)

**Interfaces:**
- Produces: DOM elements `#loginGate`, `#loginGateForm`, `#loginGateEmail`, `#loginGatePassword`, `#loginGateError` used by `showLoginGate()` in Task 2

- [ ] **Step 1: Add `#loginGate` overlay to `index.html`**

Find the first `<div class="modal hidden"` in `index.html` (the setup wizard) and insert the login gate immediately before it at the same DOM level inside `<body>`:

```html
<div id="loginGate" class="login-gate hidden" role="dialog" aria-modal="true" aria-labelledby="loginGateTitle">
    <div class="login-gate-card">
        <h1 id="loginGateTitle" class="login-gate-title">MyFinances</h1>
        <p class="login-gate-subtitle">Sign in to your account</p>
        <form id="loginGateForm" class="login-gate-form" novalidate>
            <div class="form-group">
                <label for="loginGateEmail">Email</label>
                <input type="email" id="loginGateEmail" class="form-control" autocomplete="email" required>
            </div>
            <div class="form-group">
                <label for="loginGatePassword">Password</label>
                <input type="password" id="loginGatePassword" class="form-control" autocomplete="current-password" required>
            </div>
            <p id="loginGateError" class="login-gate-error" role="alert" aria-live="polite"></p>
            <button type="submit" class="btn btn-primary login-gate-submit">Sign In</button>
        </form>
    </div>
</div>
```

- [ ] **Step 2: Add `<option value="postgres">` to the storage backend select**

In `index.html`, find `<select id="settingStorageBackend">` and add a third option after the existing two:

```html
<option value="postgres">PostgreSQL (self-hosted server)</option>
```

- [ ] **Step 3: Add `#loginGate` styles to `styles.css`**

Add at the end of `styles.css`:

```css
/* Login Gate — full-viewport overlay for Postgres backend */
.login-gate {
    position: fixed;
    inset: 0;
    background: var(--bg-primary);
    z-index: 2000;
    display: none;
    align-items: center;
    justify-content: center;
}
.login-gate.flex-visible {
    display: flex;
}
.login-gate-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 2rem;
    width: 100%;
    max-width: 380px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
}
.login-gate-title {
    font-size: 1.5rem;
    font-weight: 700;
    margin: 0 0 0.25rem;
    color: var(--text-primary);
}
.login-gate-subtitle {
    color: var(--text-secondary);
    margin: 0 0 1.5rem;
    font-size: 0.95rem;
}
.login-gate-form .form-group {
    margin-bottom: 1rem;
}
.login-gate-error {
    color: var(--danger-color, #dc3545);
    font-size: 0.875rem;
    min-height: 1.25rem;
    margin: 0.25rem 0 0.75rem;
}
.login-gate-submit {
    width: 100%;
}
```

- [ ] **Step 4: Verify existing tests still pass (regression)**

```
pytest tests/ui/test_setup_wizard.py -v
```
Expected: all pass (no structural change to the settings modal).

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css
git commit -m "feat: add login gate overlay HTML/CSS and Postgres storage backend option"
```

---

### Task 2: `src/loginGate.js` — new module

**Files:**
- Create: `src/loginGate.js`

**Interfaces:**
- Consumes: DOM elements from Task 1
- Produces: `export function showLoginGate(app): Promise<void>` — resolves when login succeeds; imported by `app.js` (Task 5)

- [ ] **Step 1: Create `src/loginGate.js`**

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
            let res;
            try {
                res = await fetch('/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: emailInput.value,
                        password: passwordInput.value
                    })
                });
            } catch {
                errorEl.textContent = 'Could not reach the server. Check your connection.';
                return;
            }
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

- [ ] **Step 2: Commit**

```bash
git add src/loginGate.js
git commit -m "feat: add showLoginGate module (returns Promise, resolves on successful login)"
```

---

### Task 3: `src/storageAdapters.js` — safe fallback for `'postgres'`

**Files:**
- Modify: `src/storageAdapters.js`

**Interfaces:**
- `createStorageAdapter('postgres')` must return a valid adapter without throwing — the `DebtTrackerApp` constructor calls it before `init()` determines the Postgres path, and the adapter is never actually used in Postgres mode

- [ ] **Step 1: Read `createStorageAdapter` in `storageAdapters.js`**

Open `src/storageAdapters.js` and find the `createStorageAdapter` function.

- [ ] **Step 2: Add `'postgres'` fallback**

Ensure `createStorageAdapter` falls through to `LocalStorageAdapter` for any unrecognized value (including `'postgres'`). The typical pattern is already an `if (kind === 'session')` guard; `'postgres'` automatically falls through to the `return new LocalStorageAdapter()` default. Verify no `switch` or `else if` block would throw on an unknown value. If there is one, add `case 'postgres':` falling through to the local branch.

The adapter will be assigned but never used — `init()` calls `loadFromPostgres()` instead of `this.storageAdapter.get()` when `_storageBackendKind === 'postgres'`.

- [ ] **Step 3: Commit**

```bash
git add src/storageAdapters.js
git commit -m "fix: createStorageAdapter falls back to LocalStorageAdapter for 'postgres' (safe unused placeholder)"
```

---

### Task 4: `src/storage.js` — Postgres helpers, load path, and async save branch

**Files:**
- Modify: `src/storage.js`

**Interfaces:**
- Produces:
  - `export function getCsrfCookie(): string` — reads non-httpOnly `csrf` cookie; used here and by Phase 2b mutation sites
  - `export async function checkPostgresSession(): Promise<boolean>` — `GET /api/plan-settings` → `true` if 200
  - `export async function loadFromPostgres(app): Promise<void>` — fans out to 14 endpoints, populates `app.*`
  - `saveToStorage(app)` is now `async` and has a Postgres branch that PATCHes `/api/plan-settings`

- [ ] **Step 1: Add `getCsrfCookie()` and `checkPostgresSession()` to `storage.js`**

After the existing imports at the top of `src/storage.js`, add:

```js
export function getCsrfCookie() {
    const match = document.cookie.split('; ').find(row => row.startsWith('csrf='));
    return match ? match.split('=')[1] : '';
}

export async function checkPostgresSession() {
    try {
        const res = await fetch('/api/plan-settings');
        return res.ok;
    } catch {
        return false;
    }
}
```

- [ ] **Step 2: Add `loadFromPostgres(app)` to `storage.js`**

Add after `checkPostgresSession()`:

```js
const POSTGRES_RESOURCE_ENDPOINTS = {
    debts: '/api/debts',
    accounts: '/api/accounts',
    incomes: '/api/incomes',
    bonuses: '/api/bonuses',
    bills: '/api/bills',
    expenses: '/api/expenses',
    recurringTemplates: '/api/recurring-templates',
    emergencyFunds: '/api/emergency-funds',
    sinkingFunds: '/api/sinking-funds',
    reconciliations: '/api/reconciliations'
};

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
    app.ledgerAmountOverrides = Object.fromEntries(
        overrides.map(o => [o.overrideKey, o])
    );
    app._savedMonthlyPayment = planSettings.monthlyPayment;
    app._savedStrategy = planSettings.strategy;
    app.perMonthStimulus = planSettings.perMonthStimulus;
    app.netWorthMilestonesAwarded = planSettings.netWorthMilestonesAwarded;
    app._ledgerAccountFilter = planSettings.ledgerSettings?.accountFilter ?? 'all';
    app._ledgerDateRange = planSettings.ledgerSettings?.dateRange ?? 'all';
    app._ledgerSortKey = planSettings.ledgerSettings?.sortKey ?? 'date';
    app._ledgerSortDir = planSettings.ledgerSettings?.sortDir ?? 'desc';
    app._forecastRangeMonths = planSettings.forecastSettings?.rangeMonths ?? 1;
    app._forecastAccountId = planSettings.forecastSettings?.accountId ?? 'total';
    app._forecastNotableThresholdPct = planSettings.forecastSettings?.notableThresholdPct ?? 130;
}
```

- [ ] **Step 3: Make `saveToStorage` async and add Postgres branch**

Change `export function saveToStorage(app)` → `export async function saveToStorage(app)` and add the Postgres branch at the very top of the function body, before the existing `try {`:

```js
export async function saveToStorage(app) {
    if (app._storageBackendKind === 'postgres') {
        try {
            await fetch('/api/plan-settings', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': getCsrfCookie()
                },
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
    // existing local/session branch unchanged below...
    try {
        // ... (all existing code stays as-is)
```

The 50 existing `app.saveToStorage()` call sites don't await or check the return value, so making the function async (which wraps the return value in a Promise) is safe — they become fire-and-forget Promises.

- [ ] **Step 4: Verify local/session save path still works**

```
pytest tests/features/test_debts.py tests/features/test_setup_wizard.py -v
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/storage.js
git commit -m "feat: add getCsrfCookie, checkPostgresSession, loadFromPostgres; async saveToStorage with Postgres branch"
```

---

### Task 5: `src/app.js` — async bootstrap

**Files:**
- Modify: `src/app.js`

**Interfaces:**
- Consumes: `showLoginGate(app)` from `./loginGate.js` (Task 2); `checkPostgresSession`, `loadFromPostgres` from `./storage.js` (Task 4)
- Produces: `async init(): Promise<void>` method on `DebtTrackerApp`; `DOMContentLoaded` handler awaits `init()` before registering the service worker

- [ ] **Step 1: Add imports for new functions**

In `src/app.js`, add the `loginGate.js` import after the existing import block:

```js
import { showLoginGate } from './loginGate.js';
```

Extend the existing `./storage.js` import line to include the two new functions:

```js
import { saveToStorage, loadFromStorage, backfillIncomeAccountIds, clearAllData as clearAllDataFeature, switchStorageBackend as switchStorageBackendFeature, checkPostgresSession, loadFromPostgres } from './storage.js';
```

- [ ] **Step 2: Strip the boot sequence from the constructor**

In the `constructor()`, keep everything up through `applyStaticTranslations()` and `this.initializeEventListeners()`. Remove from the `isFirstRun` line through `this.switchPage('health')` — those 11 lines move verbatim into `init()`:

Lines to remove:
```js
        const isFirstRun = this.storageAdapter.get(this.storageKey) === null;

        this.initializeEventListeners();
        this.loadFromStorage();
        const versionEl = document.getElementById('appVersion');
        if (versionEl) versionEl.textContent = `v${APP_VERSION}`;
    this.captureNetWorthSnapshot({ source: 'auto', silent: true, skipMilestone: true });
    initSettingsModalFeature(this);
    initDataTransferModal(this);
    maybeShowSetupWizardFeature(this, isFirstRun);
    backfillIncomeAccountIds(this);

        this.updateUI();
        this.updateFormVisibility();
        this.switchPage('health');
```

Keep `this.initializeEventListeners()` inside the constructor — it only wires DOM event handlers and doesn't need loaded data. The constructor ends after `applyStaticTranslations()` and `this.initializeEventListeners()`.

After removing, the end of the constructor should look like:

```js
        applyStaticTranslations();

        const isFirstRun = this.storageAdapter.get(this.storageKey) === null;
        this._isFirstRun = isFirstRun;  // stash for init()

        this.initializeEventListeners();
    }
```

- [ ] **Step 3: Add `async init()` method immediately after the constructor's closing brace**

```js
    async init() {
        if (this._storageBackendKind === 'postgres') {
            const hasSession = await checkPostgresSession();
            if (!hasSession) {
                await showLoginGate(this);
            }
            await loadFromPostgres(this);
        } else {
            this.loadFromStorage();
            maybeShowSetupWizardFeature(this, this._isFirstRun);
        }

        const versionEl = document.getElementById('appVersion');
        if (versionEl) versionEl.textContent = `v${APP_VERSION}`;
        this.captureNetWorthSnapshot({ source: 'auto', silent: true, skipMilestone: true });
        backfillIncomeAccountIds(this);
        initSettingsModalFeature(this);
        initDataTransferModal(this);
        this.updateUI();
        this.updateFormVisibility();
        this.switchPage('health');
    }
```

- [ ] **Step 4: Update the `DOMContentLoaded` handler**

At the bottom of `app.js`, find:

```js
document.addEventListener('DOMContentLoaded', () => {
    window.app = new DebtTrackerApp();
    registerServiceWorker(window.app);
});
```

Replace with:

```js
document.addEventListener('DOMContentLoaded', async () => {
    window.app = new DebtTrackerApp();
    await window.app.init();
    registerServiceWorker(window.app);
});
```

- [ ] **Step 5: Verify local-only boot still works end-to-end**

```
pytest tests/features/ tests/integration/ -v
```
Expected: all pass. The local-only path (`!== 'postgres'`) must behave identically to before.

- [ ] **Step 6: Commit**

```bash
git add src/app.js
git commit -m "feat: async app bootstrap — init() handles Postgres session check, login gate, and loadFromPostgres"
```

---

### Task 6: `src/setupWizard.js` — Postgres backend picker

**Files:**
- Modify: `src/setupWizard.js`

**Interfaces:**
- Consumes: `setStorageBackendPreference` from `./storageAdapters.js` (verify it is already imported)

- [ ] **Step 1: Verify `setStorageBackendPreference` is imported in `setupWizard.js`**

```
grep "setStorageBackendPreference" src/setupWizard.js
```

If missing, add it to the existing `storageAdapters.js` import in that file.

- [ ] **Step 2: Update `save()` in `setupWizard.js`**

Find:
```js
    const save = () => {
        setSetting(app, RECONCILIATION_ADJUSTS_BALANCE, adjustsCheckbox.checked);
        app.switchStorageBackend(storageSelect.value);
        app.setLocale(localeSelect.value);
        close();
    };
```

Replace with:
```js
    const save = () => {
        setSetting(app, RECONCILIATION_ADJUSTS_BALANCE, adjustsCheckbox.checked);
        if (storageSelect.value === 'postgres') {
            setStorageBackendPreference('postgres');
            location.reload();
            return;
        }
        app.switchStorageBackend(storageSelect.value);
        app.setLocale(localeSelect.value);
        close();
    };
```

- [ ] **Step 3: Verify existing settings tests still pass**

```
pytest tests/ui/test_setup_wizard.py -v
```
Expected: all pass. The local/session switch path is unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/setupWizard.js
git commit -m "feat: settings modal Postgres option — saves preference and reloads into login gate"
```

---

### Task 7: Postgres integration tests

**Files:**
- Create: `tests/postgres/__init__.py` (empty)
- Create: `tests/postgres/conftest.py`
- Create: `tests/postgres/test_postgres_bootstrap.py`

These tests require the running docker-compose stack (frontend + server + Postgres). They are **not** included in any existing CI job — Task 8 adds the dedicated `test-postgres` CI job. To run locally: bring up `docker compose up -d`, create a user with `docker compose exec server node scripts/create-user.js`, then `POSTGRES_TEST_PASSWORD=<pw> pytest tests/postgres -v`.

- [ ] **Step 1: Create `tests/postgres/__init__.py`** (empty file)

- [ ] **Step 2: Create `tests/postgres/conftest.py`**

```python
import os
import pytest


BASE_URL = os.environ.get('POSTGRES_TEST_BASE_URL', 'http://localhost:5500')
TEST_EMAIL = os.environ.get('POSTGRES_TEST_EMAIL', 'testuser@example.com')
TEST_PASSWORD = os.environ.get('POSTGRES_TEST_PASSWORD', '')


@pytest.fixture
def base_url():
    return BASE_URL


@pytest.fixture
def credentials():
    return {'email': TEST_EMAIL, 'password': TEST_PASSWORD}


@pytest.fixture
async def pg_page(base_url):
    """Browser page with postgres backend preference pre-set."""
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context()
        page = await ctx.new_page()
        await page.goto(base_url)
        await page.evaluate("localStorage.setItem('debtTrackerStorageBackend', 'postgres')")
        yield page
        await browser.close()
```

- [ ] **Step 3: Create `tests/postgres/test_postgres_bootstrap.py`**

```python
import pytest

pytestmark = pytest.mark.asyncio


async def test_login_gate_shown_when_no_session(pg_page, base_url):
    """Boot with postgres preference + no session → login gate visible, app shell hidden."""
    await pg_page.goto(base_url)
    gate = pg_page.locator('#loginGate')
    await gate.wait_for(state='visible', timeout=8000)
    assert await gate.is_visible()
    # Nav bar should not be visible behind the gate
    nav = pg_page.locator('.tab-bar')
    assert not await nav.is_visible()


async def test_wrong_password_shows_error_gate_stays(pg_page, base_url, credentials):
    """Wrong password → error message shown, gate remains visible."""
    await pg_page.goto(base_url)
    await pg_page.locator('#loginGate').wait_for(state='visible', timeout=8000)

    await pg_page.fill('#loginGateEmail', credentials['email'])
    await pg_page.fill('#loginGatePassword', 'definitely-wrong-password-xyz')
    await pg_page.click('.login-gate-submit')

    error = pg_page.locator('#loginGateError')
    await error.wait_for(state='visible', timeout=5000)
    text = await error.text_content()
    assert text.strip() != ''
    assert await pg_page.locator('#loginGate').is_visible()


async def test_successful_login_hides_gate_and_boots_app(pg_page, base_url, credentials):
    """Correct credentials → gate hides, app shell renders."""
    await pg_page.goto(base_url)
    gate = pg_page.locator('#loginGate')
    await gate.wait_for(state='visible', timeout=8000)

    await pg_page.fill('#loginGateEmail', credentials['email'])
    await pg_page.fill('#loginGatePassword', credentials['password'])
    await pg_page.click('.login-gate-submit')

    await gate.wait_for(state='hidden', timeout=8000)
    assert not await gate.is_visible()
    await pg_page.wait_for_selector('.tab-bar', state='visible', timeout=8000)


async def test_valid_session_skips_gate(pg_page, base_url, credentials):
    """After login, page reload with valid session cookie skips gate entirely."""
    # Establish a session via the gate
    await pg_page.goto(base_url)
    gate = pg_page.locator('#loginGate')
    await gate.wait_for(state='visible', timeout=8000)
    await pg_page.fill('#loginGateEmail', credentials['email'])
    await pg_page.fill('#loginGatePassword', credentials['password'])
    await pg_page.click('.login-gate-submit')
    await gate.wait_for(state='hidden', timeout=8000)

    # Reload — session cookie persists, gate must not appear
    await pg_page.reload()
    await pg_page.wait_for_selector('.tab-bar', state='visible', timeout=8000)
    assert not await gate.is_visible()


async def test_settings_postgres_option_reloads_to_gate(base_url):
    """Selecting Postgres in Settings and clicking Done reloads to login gate."""
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context()
        page = await ctx.new_page()
        # Start in local mode (default)
        await page.goto(base_url)
        await page.wait_for_selector('.tab-bar', state='visible', timeout=8000)

        # Open settings modal
        settings_btn = page.locator('#settingsBtn, [data-action="settings"]')
        await settings_btn.click()
        await page.wait_for_selector('#settingsModal', state='visible', timeout=5000)

        # Select Postgres and click Done
        await page.select_option('#settingStorageBackend', 'postgres')
        await page.click('#settingsDoneBtn, #settingsModal button:has-text("Done")')

        # Page reloads and shows login gate
        gate = page.locator('#loginGate')
        await gate.wait_for(state='visible', timeout=10000)
        assert await gate.is_visible()
        await browser.close()
```

- [ ] **Step 4: Commit**

```bash
git add tests/postgres/
git commit -m "test: add Postgres bootstrap integration tests (requires docker-compose stack)"
```

---

### Task 8: CI job for Postgres integration tests

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add `test-postgres` job after `test-security`**

```yaml
  test-postgres:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.14"
      - run: pip install playwright pytest pytest-asyncio
      - run: playwright install --with-deps chromium
      - name: Create postgres secret
        run: |
          mkdir -p secrets
          echo "ci-test-password" > secrets/postgres_password.txt
      - name: Start full stack
        run: |
          docker compose up -d --build
          for i in $(seq 1 60); do
            curl -sf http://localhost:5500/ > /dev/null && break
            sleep 2
          done
          curl -sf http://localhost:5500/ > /dev/null || exit 1
      - name: Seed test user
        run: |
          docker compose exec -T server node scripts/create-user.js <<'EOF'
          testuser@example.com
          ci-test-password
          EOF
      - name: Run Postgres bootstrap tests
        env:
          POSTGRES_TEST_BASE_URL: http://localhost:5500
          POSTGRES_TEST_EMAIL: testuser@example.com
          POSTGRES_TEST_PASSWORD: ci-test-password
        run: pytest tests/postgres -v
      - name: Stop stack
        if: always()
        run: docker compose down -v
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add test-postgres job — spins up docker-compose stack and runs Postgres bootstrap tests"
```

---

### Task 9: Version bump and changelog

**Files:**
- Modify: `src/utils.js` (bump `APP_VERSION`)
- Modify: `sw.js` (bump `CACHE_NAME`)
- Modify: `CHANGELOG.md` (new entry)

- [ ] **Step 1: Bump `APP_VERSION` in `src/utils.js`**

Find `export const APP_VERSION = '4.21.0';` and change to:
```js
export const APP_VERSION = '4.22.0';
```

- [ ] **Step 2: Bump `CACHE_NAME` in `sw.js`**

Find `const CACHE_NAME = 'myfinances-v4.21.0';` and change to:
```js
const CACHE_NAME = 'myfinances-v4.22.0';
```

- [ ] **Step 3: Add changelog entry at the top of `CHANGELOG.md`**

```markdown
## [4.22.0] — 2026-08-23

### Added
- PostgreSQL backend option in Settings modal: selecting "PostgreSQL (self-hosted server)" saves the preference and reloads the page
- Full-page `#loginGate` overlay shown before the app shell when Postgres is selected and no valid session exists
- Async app bootstrap: `DebtTrackerApp.init()` (called from an async `DOMContentLoaded` handler) handles session check, login gate, and parallel load from 14 REST endpoints via `Promise.all`
- `getCsrfCookie()` helper in `storage.js` for all authenticated Postgres mutation calls (Phase 2b will use this at every mutation site)
```

- [ ] **Step 4: Verify PWA and versioning tests pass**

```
pytest tests/features/test_pwa.py tests/features/test_versioning.py -v
```
Expected: both pass (`CACHE_NAME` matches `APP_VERSION`, `CHANGELOG.md` heading matches `APP_VERSION`).

- [ ] **Step 5: Commit**

```bash
git add src/utils.js sw.js CHANGELOG.md
git commit -m "chore: bump version to 4.22.0 for Phase 2a (async bootstrap + login gate + Postgres backend picker)"
```

---

### Task 10: `CLAUDE.md` update

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Extend the backend service bullet**

Find the `- **Backend service (optional, Phase 1)** — ...` bullet and update or append to cover Phase 2a:

```
- **Backend service (optional, Phase 2a)** — Frontend integration for the Phase 1 server: `app.js`'s `async init()` method (called from the `DOMContentLoaded` handler) checks `app._storageBackendKind === 'postgres'`, calls `checkPostgresSession()` (`GET /api/plan-settings` → `true` if 200), shows the full-page `#loginGate` overlay if no valid session, then calls `loadFromPostgres(app)` which fans out to 14 endpoints via `Promise.all` and reassembles `app.*` state. `saveToStorage()` in `storage.js` is now `async` and has a Postgres branch that PATCHes `/api/plan-settings` for scalar settings fields only; per-resource mutations are Phase 2b. The Settings modal has a third backend option ("PostgreSQL (self-hosted server)") that saves `debtTrackerStorageBackend = 'postgres'` and reloads. `getCsrfCookie()` in `storage.js` reads the non-httpOnly `csrf` cookie for use on all mutating fetch calls.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for Phase 2a async bootstrap and login gate"
```
