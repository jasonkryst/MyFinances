# PostgreSQL Phase 2b — Per-Resource Mutation Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire every add/edit/delete mutation in the frontend to its Postgres REST endpoint so that Postgres mode persists all data across page reloads.

**Architecture:** A new `src/postgresSync.js` module provides `pgPost`/`pgPatch`/`pgDelete`/`pgPut`/`pgDeleteAll` helpers. Each feature module imports the relevant helpers and calls them after its in-memory array mutation, before `updateUI()`. `add*` functions become `async` because they must await `pgPost` to get the DB-assigned id and swap it into the in-memory object before the DOM renders.

**Tech Stack:** Vanilla ES6+ modules (no build step), Playwright (Python) for integration tests, existing docker-compose stack for Postgres tests.

**Spec:** `docs/superpowers/specs/2026-08-24-postgresql-storage-phase2b-design.md`

## Global Constraints

- No build step — all files are ES6 modules loaded directly by the browser; no bundler, no transpilation.
- CSP: no inline `<script>`, no `eval()`, no inline `style=""`. All logic in `.js` module files.
- Local-only mode (`localStorage`/`sessionStorage`) must remain completely unaffected — every Postgres branch is behind `if (app._storageBackendKind === 'postgres')`.
- `pgPost` is the only helper that must be `await`ed at the call site — it returns the server-assigned id. `pgPatch`, `pgDelete`, `pgPut` are fire-and-forget (no `await` at call site).
- All Postgres helpers are in `src/postgresSync.js`; do not add Postgres fetch logic to feature modules directly.
- Error handling in Phase 2b: `console.error` only — no rollback, no user-facing toast.
- Postgres integration tests run only against the docker-compose stack. Run them with: `pytest tests/postgres/ -v` (requires the stack to be up). Regular tests run with: `pytest tests/ -v -k "not postgres"`.

---

### Task 1: Server delete-all routes

**Files:**
- Modify: `server/src/crudRouter.js`
- Modify: `server/src/keyedRouter.js`
- Modify: `server/test/crudResources.test.js`
- Modify: `server/test/keyedResources.test.js`

**Interfaces:**
- Produces: `DELETE /api/<resource>` (no id segment) — wipes all authenticated user rows, responds 204. Used by `pgDeleteAll` in Task 2.

- [ ] **Step 1: Add delete-all route to `crudRouter.js`**

Open `server/src/crudRouter.js`. After the existing `router.delete('/:id', ...)` block (around line 103), add:

```js
router.delete('/', async (req, res, next) => {
    try {
        await query(`DELETE FROM ${table} WHERE user_id = $1`, [req.userId]);
        res.status(204).end();
    } catch (err) {
        next(err);
    }
});
```

- [ ] **Step 2: Add delete-all route to `keyedRouter.js`**

Open `server/src/keyedRouter.js`. After the existing `router.delete('/:key', ...)` block (around line 65), add:

```js
router.delete('/', async (req, res, next) => {
    try {
        await query(`DELETE FROM ${table} WHERE user_id = $1`, [req.userId]);
        res.status(204).end();
    } catch (err) {
        next(err);
    }
});
```

- [ ] **Step 3: Add server-side tests for the new route**

In `server/test/crudResources.test.js`, find the describe block that covers DELETE (search for `'DELETE /:id'`). Add a new describe block after it:

```js
describe('DELETE / (delete all)', () => {
    it('deletes all resources owned by the user and returns 204', async () => {
        await request(app).post('/api/debts')
            .set('Cookie', authCookie).set('X-CSRF-Token', csrfToken)
            .send({ name: 'A', debtType: 'creditCard', accountBalance: 100, interestRate: 5, minimumPayment: 10, dueDate: 1 });
        await request(app).post('/api/debts')
            .set('Cookie', authCookie).set('X-CSRF-Token', csrfToken)
            .send({ name: 'B', debtType: 'creditCard', accountBalance: 200, interestRate: 5, minimumPayment: 10, dueDate: 1 });

        const res = await request(app).delete('/api/debts')
            .set('Cookie', authCookie).set('X-CSRF-Token', csrfToken);
        expect(res.status).toBe(204);

        const list = await request(app).get('/api/debts').set('Cookie', authCookie);
        expect(list.body).toHaveLength(0);
    });

    it('returns 401 without auth', async () => {
        const res = await request(app).delete('/api/debts');
        expect(res.status).toBe(401);
    });
});
```

In `server/test/keyedResources.test.js`, add a similar describe block for a keyed resource (e.g., net-worth-snapshots):

```js
describe('DELETE / (delete all)', () => {
    it('deletes all keyed entries owned by the user and returns 204', async () => {
        await request(app).put('/api/net-worth-snapshots/2026-01-01')
            .set('Cookie', authCookie).set('X-CSRF-Token', csrfToken)
            .send({ date: '2026-01-01', totalAssets: 1000, totalLiabilities: 500, netWorth: 500, debtPaymentMade: null, incomeReceived: null, source: 'auto' });

        const res = await request(app).delete('/api/net-worth-snapshots')
            .set('Cookie', authCookie).set('X-CSRF-Token', csrfToken);
        expect(res.status).toBe(204);

        const list = await request(app).get('/api/net-worth-snapshots').set('Cookie', authCookie);
        expect(list.body).toHaveLength(0);
    });
});
```

- [ ] **Step 4: Run server tests**

```bash
cd server && npm test
```

Expected: all tests pass, including the two new delete-all tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/crudRouter.js server/src/keyedRouter.js server/test/crudResources.test.js server/test/keyedResources.test.js
git commit -m "feat(server): add delete-all route to crudRouter and keyedRouter"
```

---

### Task 2: `src/postgresSync.js` — shared Postgres mutation helpers

**Files:**
- Create: `src/postgresSync.js`

**Interfaces:**
- Consumes: `getCsrfCookie()` from `./storage.js`; `showLoginGate(app)` from `./loginGate.js`
- Produces:
  - `pgPost(app, path, body)` → `Promise<object|null>` — awaitable, returns parsed response body
  - `pgPatch(app, path, body)` → `void` (fire-and-forget)
  - `pgDelete(app, path)` → `void` (fire-and-forget)
  - `pgPut(app, path, body)` → `void` (fire-and-forget)
  - `pgDeleteAll(app)` → `Promise<void>` — fans out DELETE to all 13 resource endpoints

- [ ] **Step 1: Create `src/postgresSync.js`**

```js
import { getCsrfCookie } from './storage.js';
import { showLoginGate } from './loginGate.js';

const ALL_RESOURCE_PATHS = [
    '/api/debts',
    '/api/accounts',
    '/api/incomes',
    '/api/bonuses',
    '/api/bills',
    '/api/expenses',
    '/api/recurring-templates',
    '/api/emergency-funds',
    '/api/sinking-funds',
    '/api/reconciliations',
    '/api/ledger-overrides',
    '/api/net-worth-snapshots',
    '/api/settings',
];

async function pgFetch(app, method, path, body) {
    try {
        const res = await fetch(path, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': getCsrfCookie()
            },
            body: body !== undefined ? JSON.stringify(body) : undefined
        });
        if (res.status === 401) {
            await showLoginGate(app);
            return null;
        }
        if (!res.ok) {
            console.error(`[postgresSync] ${method} ${path} failed: ${res.status}`);
            return null;
        }
        if (res.status === 204) return null;
        return await res.json();
    } catch (err) {
        console.error(`[postgresSync] ${method} ${path} error:`, err);
        return null;
    }
}

export async function pgPost(app, path, body) {
    return pgFetch(app, 'POST', path, body);
}

export function pgPatch(app, path, body) {
    pgFetch(app, 'PATCH', path, body);
}

export function pgDelete(app, path) {
    pgFetch(app, 'DELETE', path);
}

export function pgPut(app, path, body) {
    pgFetch(app, 'PUT', path, body);
}

export async function pgDeleteAll(app) {
    await Promise.all(ALL_RESOURCE_PATHS.map(path => pgFetch(app, 'DELETE', path)));
}
```

- [ ] **Step 2: Verify `showLoginGate` is exported from `loginGate.js`**

```bash
grep -n "export.*showLoginGate" src/loginGate.js
```

Expected: one matching line. If the export is named differently, update the import in `postgresSync.js` to match.

- [ ] **Step 3: Run existing local tests to confirm nothing broke**

```bash
pytest tests/ -v -k "not postgres"
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/postgresSync.js
git commit -m "feat: add postgresSync.js — shared Postgres mutation helpers"
```

---

### Task 3: Wire debts mutations

**Files:**
- Modify: `src/debts.js`

**Interfaces:**
- Consumes: `pgPost`, `pgPatch`, `pgDelete` from `./postgresSync.js`

- [ ] **Step 1: Import helpers at top of `src/debts.js`**

```js
import { pgPost, pgPatch, pgDelete } from './postgresSync.js';
```

- [ ] **Step 2: Wire `addDebt` — make async, await pgPost, swap id**

Change `export function addDebt(app)` to `export async function addDebt(app)`. Insert the Postgres block between `app.saveToStorage()` and the next render call:

```js
app.debts.push(debt);
app.saveToStorage();
if (app._storageBackendKind === 'postgres') {
    const saved = await pgPost(app, '/api/debts', debt);
    if (saved?.id) debt.id = saved.id;
}
recalculateIfConfigured(app);
app.updateUI();
app.cancelEdit();
```

- [ ] **Step 3: Wire `editDebt` — fire-and-forget pgPatch**

After `app.saveToStorage()` in `editDebt`:

```js
if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/debts/${app.debts[idx].id}`, app.debts[idx]);
```

- [ ] **Step 4: Wire `updateDebtBalance` — fire-and-forget pgPatch**

After `app.saveToStorage()` in `updateDebtBalance`:

```js
if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/debts/${debt.id}`, debt);
```

- [ ] **Step 5: Wire `deleteDebt` — fire-and-forget pgDelete**

Capture the id before the filter:

```js
export function deleteDebt(app, debtId) {
    const confirmed = confirm('Delete this debt?');
    if (!confirmed) return;
    app.debts = app.debts.filter(d => d.id !== debtId);
    if (app.editingDebtId === debtId) app.editingDebtId = null;
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/debts/${debtId}`);
    recalculateIfConfigured(app);
    app.updateUI();
}
```

- [ ] **Step 6: Run local tests**

```bash
pytest tests/ -v -k "not postgres"
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/debts.js
git commit -m "feat(postgres): wire debt mutations to REST API"
```

---

### Task 4: Wire accounts mutations

**Files:**
- Modify: `src/accounts.js`

**Interfaces:**
- Consumes: `pgPost`, `pgPatch`, `pgDelete` from `./postgresSync.js`

- [ ] **Step 1: Import helpers**

```js
import { pgPost, pgPatch, pgDelete } from './postgresSync.js';
```

- [ ] **Step 2: Wire `addAccount` — async, pgPost + id swap**

Change to `export async function addAccount(app)`. Capture the account reference before pushing:

```js
const account = { id: Date.now(), name, type, startingBalance, interestRate };
app.accounts.push(account);
app.saveToStorage();
if (app._storageBackendKind === 'postgres') {
    const saved = await pgPost(app, '/api/accounts', account);
    if (saved?.id) account.id = saved.id;
}
// existing render calls unchanged
```

- [ ] **Step 3: Wire `editAccount` — pgPatch**

After `app.saveToStorage()`:

```js
if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/accounts/${app.accounts[idx].id}`, app.accounts[idx]);
```

- [ ] **Step 4: Wire `deleteAccount` — pgDelete**

```js
export function deleteAccount(app, id) {
    app.accounts = app.accounts.filter(a => a.id !== id);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/accounts/${id}`);
    // existing render calls unchanged
}
```

- [ ] **Step 5: Run local tests and commit**

```bash
pytest tests/ -v -k "not postgres"
git add src/accounts.js
git commit -m "feat(postgres): wire account mutations to REST API"
```

---

### Task 5: Wire income and bonus mutations

**Files:**
- Modify: `src/income.js`

**Interfaces:**
- Consumes: `pgPost`, `pgPatch`, `pgDelete` from `./postgresSync.js`

- [ ] **Step 1: Import helpers**

```js
import { pgPost, pgPatch, pgDelete } from './postgresSync.js';
```

- [ ] **Step 2: Wire `addIncome` — async, pgPost + id swap**

```js
const income = { id: Date.now(), name, amount, firstPayDate, frequency, accountId };
app.incomes.push(income);
app.saveToStorage();
if (app._storageBackendKind === 'postgres') {
    const saved = await pgPost(app, '/api/incomes', income);
    if (saved?.id) income.id = saved.id;
}
```

- [ ] **Step 3: Wire `saveEditIncome` — pgPatch**

After `app.saveToStorage()`:

```js
if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/incomes/${app.incomes[idx].id}`, app.incomes[idx]);
```

- [ ] **Step 4: Wire `deleteIncome` — pgDelete**

```js
export function deleteIncome(app, incomeId) {
    app.incomes = app.incomes.filter(i => i.id !== incomeId);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/incomes/${incomeId}`);
    // existing render calls unchanged
}
```

- [ ] **Step 5: Wire `addBonus` — async, pgPost + id swap**

```js
const bonus = { id: Date.now(), name, amount, date, category, accountId, purpose };
app.bonuses.push(bonus);
app.saveToStorage();
if (app._storageBackendKind === 'postgres') {
    const saved = await pgPost(app, '/api/bonuses', bonus);
    if (saved?.id) bonus.id = saved.id;
}
```

- [ ] **Step 6: Wire `saveEditBonus` — pgPatch**

After `app.saveToStorage()`:

```js
if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/bonuses/${app.bonuses[idx].id}`, app.bonuses[idx]);
```

- [ ] **Step 7: Wire `deleteBonus` — pgDelete**

```js
export function deleteBonus(app, bonusId) {
    app.bonuses = app.bonuses.filter(b => b.id !== bonusId);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/bonuses/${bonusId}`);
    // existing render calls unchanged
}
```

- [ ] **Step 8: Run local tests and commit**

```bash
pytest tests/ -v -k "not postgres"
git add src/income.js
git commit -m "feat(postgres): wire income and bonus mutations to REST API"
```

---

### Task 6: Wire bills and expense mutations

**Files:**
- Modify: `src/bills.js`

**Interfaces:**
- Consumes: `pgPost`, `pgPatch`, `pgDelete` from `./postgresSync.js`

- [ ] **Step 1: Import helpers**

```js
import { pgPost, pgPatch, pgDelete } from './postgresSync.js';
```

- [ ] **Step 2: Wire `addBill` — async, pgPost + id swap**

```js
const bill = { id: Date.now(), name, amount, dueDay, category, accountId };
app.bills.push(bill);
app.saveToStorage();
if (app._storageBackendKind === 'postgres') {
    const saved = await pgPost(app, '/api/bills', bill);
    if (saved?.id) bill.id = saved.id;
}
```

- [ ] **Step 3: Wire `saveEditBill` — pgPatch**

After `app.saveToStorage()`:

```js
if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/bills/${app.bills[idx].id}`, app.bills[idx]);
```

- [ ] **Step 4: Wire `deleteBill` — pgDelete**

```js
export function deleteBill(app, id) {
    app.bills = app.bills.filter(b => b.id !== id);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/bills/${id}`);
    // existing render calls unchanged
}
```

- [ ] **Step 5: Wire `addExpense` — async, pgPost + id swap**

```js
const expense = { id: Date.now(), name, budgetAmount, date, category, accountId };
app.expenses.push(expense);
app.saveToStorage();
if (app._storageBackendKind === 'postgres') {
    const saved = await pgPost(app, '/api/expenses', expense);
    if (saved?.id) expense.id = saved.id;
}
```

- [ ] **Step 6: Wire `saveEditExpense` — pgPatch**

After `app.saveToStorage()`:

```js
if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/expenses/${app.expenses[idx].id}`, app.expenses[idx]);
```

- [ ] **Step 7: Wire `deleteExpense` — pgDelete**

```js
export function deleteExpense(app, id) {
    app.expenses = app.expenses.filter(e => e.id !== id);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/expenses/${id}`);
    // existing render calls unchanged
}
```

- [ ] **Step 8: Run local tests and commit**

```bash
pytest tests/ -v -k "not postgres"
git add src/bills.js
git commit -m "feat(postgres): wire bill and expense mutations to REST API"
```

---

### Task 7: Wire recurring template mutations

**Files:**
- Modify: `src/recurring.js`

**Interfaces:**
- Consumes: `pgPost`, `pgPatch`, `pgDelete` from `./postgresSync.js`
- Note: 4 PATCH operations — pause, skip month, mark paid, full field edit.

- [ ] **Step 1: Import helpers**

```js
import { pgPost, pgPatch, pgDelete } from './postgresSync.js';
```

- [ ] **Step 2: Wire `addRecurringTemplate` — async, pgPost + id swap**

Make `async`. After push and `saveToStorage`:

```js
if (app._storageBackendKind === 'postgres') {
    const saved = await pgPost(app, '/api/recurring-templates', tmpl);
    if (saved?.id) tmpl.id = saved.id;
}
```

- [ ] **Step 3: Wire `deleteRecurringTemplate` — pgDelete**

```js
export function deleteRecurringTemplate(app, id) {
    if (!app.recurringTemplates) return;
    app.recurringTemplates = app.recurringTemplates.filter(t => t.id !== id);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/recurring-templates/${id}`);
    app.renderRecurringPage();
}
```

- [ ] **Step 4: Wire `pauseRecurringTemplate` — pgPatch**

After `app.saveToStorage()`:

```js
if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/recurring-templates/${id}`, t);
```

- [ ] **Step 5: Wire `skipRecurringOccurrence` — pgPatch**

After `app.saveToStorage()`:

```js
if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/recurring-templates/${id}`, t);
```

- [ ] **Step 6: Wire `markRecurringPaid` — pgPatch**

After `app.saveToStorage()`:

```js
if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/recurring-templates/${id}`, t);
```

- [ ] **Step 7: Wire `saveEditRecurring` — pgPatch**

After template assignment and `saveToStorage`:

```js
if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/recurring-templates/${id}`, app.recurringTemplates[idx]);
```

- [ ] **Step 8: Run local tests and commit**

```bash
pytest tests/ -v -k "not postgres"
git add src/recurring.js
git commit -m "feat(postgres): wire recurring template mutations to REST API"
```

---

### Task 8: Wire savings mutations (emergency funds + sinking funds)

**Files:**
- Modify: `src/savings.js`

**Interfaces:**
- Consumes: `pgPost`, `pgPatch`, `pgDelete` from `./postgresSync.js`
- Note: These functions are private (not exported). `addEmergencyFund` is an upsert — it PATCHes if a fund already exists for the account, POSTs if new. Emergency funds use string ids `ef-${Date.now()}`, sinking funds use `sf-${Date.now()}` — both replaced by DB bigserial on POST.

- [ ] **Step 1: Import helpers**

```js
import { pgPost, pgPatch, pgDelete } from './postgresSync.js';
```

- [ ] **Step 2: Wire `addEmergencyFund` — async upsert**

Make `async`. Add Postgres branches inside each arm of the existing `if (existingFund)` check:

```js
async function addEmergencyFund(app) {
    // ... read inputs, validate unchanged ...
    const existingFund = app.emergencyFunds.find(f => f.accountId === accountId);
    if (existingFund) {
        Object.assign(existingFund, { targetAmount, currentAmount, monthlyContribution, autoContribute, notes });
        app.saveToStorage();
        if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/emergency-funds/${existingFund.id}`, existingFund);
    } else {
        const fund = { id: `ef-${Date.now()}`, accountId, targetAmount, currentAmount, monthlyContribution, autoContribute, notes };
        app.emergencyFunds.push(fund);
        app.saveToStorage();
        if (app._storageBackendKind === 'postgres') {
            const saved = await pgPost(app, '/api/emergency-funds', fund);
            if (saved?.id) fund.id = saved.id;
        }
    }
    // ... existing render calls unchanged ...
}
```

- [ ] **Step 3: Wire `deleteEmergencyFund` — pgDelete**

```js
function deleteEmergencyFund(app, fundId) {
    if (!confirm('Delete this emergency fund?')) return;
    app.emergencyFunds = app.emergencyFunds.filter(f => f.id !== fundId);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/emergency-funds/${fundId}`);
    // existing render calls unchanged
}
```

- [ ] **Step 4: Wire contribution to emergency fund — pgPatch**

Find the function handling the contribute-to-emergency action. After `app.saveToStorage()`:

```js
if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/emergency-funds/${fundId}`, fund);
```

- [ ] **Step 5: Wire `addSinkingFund` — async, pgPost + id swap**

Make `async`:

```js
async function addSinkingFund(app) {
    // ... read inputs, validate unchanged ...
    const fund = { id: `sf-${Date.now()}`, name, allocationMethod, monthlyAllocation, targetAmount, currentAmount, autoContribute, accountId, notes };
    app.sinkingFunds.push(fund);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') {
        const saved = await pgPost(app, '/api/sinking-funds', fund);
        if (saved?.id) fund.id = saved.id;
    }
    // existing render calls unchanged
}
```

- [ ] **Step 6: Wire `deleteSinkingFund` — pgDelete**

```js
function deleteSinkingFund(app, fundId) {
    if (!confirm('Delete this sinking fund?')) return;
    app.sinkingFunds = app.sinkingFunds.filter(f => f.id !== fundId);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/sinking-funds/${fundId}`);
    // existing render calls unchanged
}
```

- [ ] **Step 7: Wire contribution to sinking fund — pgPatch**

Find the function handling the contribute-to-sinking action. After `app.saveToStorage()`:

```js
if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/sinking-funds/${fundId}`, fund);
```

- [ ] **Step 8: Run local tests and commit**

```bash
pytest tests/ -v -k "not postgres"
git add src/savings.js
git commit -m "feat(postgres): wire savings fund mutations to REST API"
```

---

### Task 9: Wire reconciliation mutations

**Files:**
- Modify: `src/reconciliation.js`

**Interfaces:**
- Consumes: `pgPost`, `pgPatch`, `pgDelete` from `./postgresSync.js`
- Note: `applyReconciliation` creates a reconciliation entry AND optionally modifies `account.startingBalance` when `RECONCILIATION_ADJUSTS_BALANCE` is true — both changes must be sent to the server.

- [ ] **Step 1: Import helpers**

```js
import { pgPost, pgPatch, pgDelete } from './postgresSync.js';
```

- [ ] **Step 2: Wire `applyReconciliation` — async, pgPost + optional pgPatch account**

Make `async`. After `app.reconciliations.push(entry)` and `app.saveToStorage()`:

```js
if (app._storageBackendKind === 'postgres') {
    const saved = await pgPost(app, '/api/reconciliations', entry);
    if (saved?.id) entry.id = saved.id;
    if (adjustsBalance) pgPatch(app, `/api/accounts/${accountId}`, account);
}
```

`adjustsBalance` is the boolean computed earlier in the function from the `RECONCILIATION_ADJUSTS_BALANCE` setting. `account` is the account object found earlier in the function.

- [ ] **Step 3: Wire `deleteReconciliationEntry` — pgDelete**

```js
export function deleteReconciliationEntry(app, id) {
    app.reconciliations = (app.reconciliations || []).filter(r => r.id !== id);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/reconciliations/${id}`);
    if (typeof app.renderReconciliationPage === 'function') app.renderReconciliationPage();
}
```

- [ ] **Step 4: Run local tests and commit**

```bash
pytest tests/ -v -k "not postgres"
git add src/reconciliation.js
git commit -m "feat(postgres): wire reconciliation mutations to REST API"
```

---

### Task 10: Wire keyed resource mutations (ledger overrides, net-worth snapshots, settings)

**Files:**
- Modify: `src/ledgerOverrides.js`
- Modify: `src/reportsNetWorth.js`
- Modify: `src/settings.js`

**Interfaces:**
- Consumes: `pgPut`, `pgDelete` from `./postgresSync.js`
- No id-swap needed — keys are client-controlled strings.

- [ ] **Step 1: Wire `setLedgerAmountOverride` in `src/ledgerOverrides.js`**

Add import:
```js
import { pgPut, pgDelete } from './postgresSync.js';
```

After `app.ledgerAmountOverrides[transactionId] = entry`:

```js
if (app._storageBackendKind === 'postgres') {
    pgPut(app, `/api/ledger-overrides/${transactionId}`, { ...entry, overrideKey: transactionId });
}
```

The `overrideKey` field is the natural key column that `keyedRouter` expects in the request body for the `ON CONFLICT` upsert.

- [ ] **Step 2: Wire `clearLedgerAmountOverride` in `src/ledgerOverrides.js`**

After `delete app.ledgerAmountOverrides[transactionId]`:

```js
if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/ledger-overrides/${transactionId}`);
```

- [ ] **Step 3: Confirm saveToStorage is called by the ledger caller**

```bash
grep -n "setLedgerAmountOverride\|clearLedgerAmountOverride\|saveToStorage" src/ledger.js src/ledgerOverrides.js
```

Confirm `saveToStorage()` is called in the calling function in `ledger.js` after the override functions run. No changes needed to `ledger.js`.

- [ ] **Step 4: Wire `captureNetWorthSnapshot` in `src/reportsNetWorth.js`**

Add import:
```js
import { pgPut } from './postgresSync.js';
```

After `app.saveToStorage()` in `captureNetWorthSnapshot`:

```js
if (app._storageBackendKind === 'postgres') pgPut(app, `/api/net-worth-snapshots/${snapshot.date}`, snapshot);
```

`snapshot.date` is a `YYYY-MM-DD` string — the natural key for the net-worth-snapshots table. The server's `ON CONFLICT ... DO UPDATE` makes this safe for both new and existing months.

- [ ] **Step 5: Wire `setSetting` in `src/settings.js`**

Add import:
```js
import { pgPut } from './postgresSync.js';
```

After `app.saveToStorage()` in `setSetting`:

```js
if (app._storageBackendKind === 'postgres') pgPut(app, `/api/settings/${key}`, { value });
```

- [ ] **Step 6: Run local tests and commit**

```bash
pytest tests/ -v -k "not postgres"
git add src/ledgerOverrides.js src/reportsNetWorth.js src/settings.js
git commit -m "feat(postgres): wire ledger overrides, net-worth snapshots, and settings to REST API"
```

---

### Task 11: Wire clearAllData

**Files:**
- Modify: `src/storage.js`

**Interfaces:**
- Consumes: `pgDeleteAll` from `./postgresSync.js`

- [ ] **Step 1: Import `pgDeleteAll` in `src/storage.js`**

```js
import { pgDeleteAll } from './postgresSync.js';
```

- [ ] **Step 2: Capture `wasPostgres` and call `pgDeleteAll` in `clearAllData`**

`clearAllData` in `storage.js` resets arrays and then sets the backend to local. Add `wasPostgres` capture at the very start and the `pgDeleteAll` call after the backend reset:

```js
export function clearAllData(app, options = {}) {
    const wasPostgres = app._storageBackendKind === 'postgres'; // must capture before reset
    const { onCleared } = options;

    app.debts = [];
    // ... rest of array resets unchanged ...

    app.storageAdapter.remove(app.storageKey);
    app.storageAdapter = createStorageAdapter('local');
    app._storageBackendKind = 'local';
    setStorageBackendPreference('local');
    localStorage.removeItem('debtTrackerTheme');

    if (wasPostgres) pgDeleteAll(app); // fire-and-forget; backend kind is already 'local'

    app.updateUI();
    // ... rest of UI reset and onCleared callback unchanged ...
}
```

`wasPostgres` must be captured before `app._storageBackendKind` is reset so the CSRF cookie is still valid when `pgDeleteAll` fires its requests.

- [ ] **Step 3: Run local tests and commit**

```bash
pytest tests/ -v -k "not postgres"
git add src/storage.js
git commit -m "feat(postgres): wire clearAllData to delete all server-side rows"
```

---

### Task 12: Postgres mutation integration tests

**Files:**
- Create: `tests/postgres/test_postgres_mutations.py`

**Interfaces:**
- Consumes: `pg_page`, `base_url`, `credentials` fixtures from `tests/postgres/conftest.py`
- Start the stack before running: `docker compose up -d`
- Run with: `pytest tests/postgres/test_postgres_mutations.py -v`

- [ ] **Step 1: Create `tests/postgres/test_postgres_mutations.py`**

```python
"""
Postgres mutation integration tests — require docker-compose stack to be running.
Run: pytest tests/postgres/test_postgres_mutations.py -v
"""
import pytest

pytestmark = pytest.mark.asyncio


def _capture_console(page):
    messages = []
    page.on('console', lambda m: messages.append(f'[{m.type}] {m.text}'))
    return messages


async def _login(page, base_url, credentials):
    await page.goto(base_url)
    await page.locator('#loginGate').wait_for(state='visible', timeout=8000)
    await page.fill('#loginGateEmail', credentials['email'])
    await page.fill('#loginGatePassword', credentials['password'])
    async with page.expect_response(lambda r: '/auth/login' in r.url, timeout=10000):
        await page.click('.login-gate-submit')
    await page.locator('#loginGate').wait_for(state='hidden', timeout=12000)
    await page.wait_for_selector('#topNav', state='visible', timeout=8000)


async def _csrf(page):
    return await page.evaluate(
        "document.cookie.split('; ').find(r => r.startsWith('csrf='))?.split('=')[1] || ''"
    )


async def _api_post(page, path, body):
    csrf = await _csrf(page)
    return await page.request.post(path, data=body, headers={'X-CSRF-Token': csrf})


async def _api_delete(page, path):
    csrf = await _csrf(page)
    return await page.request.delete(path, headers={'X-CSRF-Token': csrf})


async def _api_get(page, path):
    return await page.request.get(path)


async def _ensure_account(page):
    accounts = await (await _api_get(page, '/api/accounts')).json()
    if not accounts:
        r = await _api_post(page, '/api/accounts', {'name': 'Checking', 'type': 'Checking', 'startingBalance': 0})
        assert r.status == 201
        await page.reload()
        await page.wait_for_selector('#topNav', state='visible', timeout=8000)
    return (await (await _api_get(page, '/api/accounts')).json())[0]


# ---------------------------------------------------------------------------
# Debt CRUD — full three-step (validates POST+id-swap, PATCH, DELETE)
# ---------------------------------------------------------------------------

async def test_debt_add_persists(pg_page, base_url, credentials):
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)
    await pg_page.click('[data-page="liabilities"]')
    await pg_page.wait_for_selector('#debtName', state='visible', timeout=5000)

    await pg_page.fill('#debtName', 'Test Visa')
    await pg_page.select_option('#debtType', 'creditCard')
    await pg_page.fill('#accountBalance', '5000')
    await pg_page.fill('#interestRate', '19.99')
    await pg_page.fill('#minimumPayment', '100')
    await pg_page.fill('#dueDate', '15')
    await pg_page.click('#addDebtBtn')
    await pg_page.wait_for_selector('text=Test Visa', timeout=5000)

    await pg_page.reload()
    await pg_page.wait_for_selector('#topNav', state='visible', timeout=8000)
    await pg_page.click('[data-page="liabilities"]')
    assert await pg_page.locator('text=Test Visa').count() > 0, f'Debt not found after reload. Console: {logs}'

    # Cleanup
    debts = await (await _api_get(pg_page, '/api/debts')).json()
    for d in debts:
        if d.get('name') == 'Test Visa':
            await _api_delete(pg_page, f'/api/debts/{d["id"]}')


async def test_debt_delete_persists(pg_page, base_url, credentials):
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)

    seed = await _api_post(pg_page, '/api/debts', {
        'name': 'Delete Me', 'debtType': 'creditCard',
        'accountBalance': 500, 'interestRate': 15,
        'minimumPayment': 20, 'dueDate': 1
    })
    assert seed.status == 201
    debt_id = (await seed.json())['id']

    await pg_page.reload()
    await pg_page.wait_for_selector('#topNav', state='visible', timeout=8000)
    await pg_page.click('[data-page="liabilities"]')
    await pg_page.wait_for_selector('text=Delete Me', timeout=5000)

    pg_page.once('dialog', lambda d: d.accept())
    await pg_page.click(f'[data-delete-debt="{debt_id}"]')
    await pg_page.wait_for_timeout(500)

    await pg_page.reload()
    await pg_page.wait_for_selector('#topNav', state='visible', timeout=8000)
    await pg_page.click('[data-page="liabilities"]')
    assert await pg_page.locator('text=Delete Me').count() == 0, f'Deleted debt still present. Console: {logs}'


# ---------------------------------------------------------------------------
# Smoke: add → reload → persists (one per remaining resource)
# ---------------------------------------------------------------------------

async def test_account_add_persists(pg_page, base_url, credentials):
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)
    await pg_page.click('[data-page="accounts"]')
    await pg_page.fill('#accountName', 'Smoke Checking')
    await pg_page.select_option('#accountType', 'Checking')
    await pg_page.fill('#startingBalance', '1000')
    await pg_page.click('#addAccountBtn')
    await pg_page.wait_for_selector('text=Smoke Checking', timeout=5000)
    await pg_page.reload()
    await pg_page.wait_for_selector('#topNav', state='visible', timeout=8000)
    await pg_page.click('[data-page="accounts"]')
    assert await pg_page.locator('text=Smoke Checking').count() > 0, f'Account not persisted. Console: {logs}'


async def test_income_add_persists(pg_page, base_url, credentials):
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)
    await _ensure_account(pg_page)
    await pg_page.click('[data-page="income"]')
    await pg_page.fill('#incomeName', 'Smoke Salary')
    await pg_page.fill('#incomeAmount', '5000')
    await pg_page.fill('#incomeFirstDate', '2026-01-01')
    await pg_page.select_option('#incomeFrequency', 'monthly')
    await pg_page.click('#addIncomeBtn')
    await pg_page.wait_for_selector('text=Smoke Salary', timeout=5000)
    await pg_page.reload()
    await pg_page.wait_for_selector('#topNav', state='visible', timeout=8000)
    await pg_page.click('[data-page="income"]')
    assert await pg_page.locator('text=Smoke Salary').count() > 0, f'Income not persisted. Console: {logs}'


async def test_bill_add_persists(pg_page, base_url, credentials):
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)
    await pg_page.click('[data-page="liabilities"]')
    await pg_page.click('[data-liab-tab="budget"]')
    await pg_page.click('#billFormToggle')
    await pg_page.fill('#billName', 'Smoke Electric')
    await pg_page.fill('#billAmount', '120')
    await pg_page.fill('#billDueDay', '10')
    await pg_page.click('#addBillBtn')
    await pg_page.wait_for_selector('text=Smoke Electric', timeout=5000)
    await pg_page.reload()
    await pg_page.wait_for_selector('#topNav', state='visible', timeout=8000)
    await pg_page.click('[data-page="liabilities"]')
    await pg_page.click('[data-liab-tab="budget"]')
    assert await pg_page.locator('text=Smoke Electric').count() > 0, f'Bill not persisted. Console: {logs}'


async def test_recurring_add_persists(pg_page, base_url, credentials):
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)
    account = await _ensure_account(pg_page)
    await pg_page.click('[data-page="recurring"]')
    await pg_page.fill('#recurringName', 'Smoke Netflix')
    await pg_page.fill('#recurringAmount', '15.99')
    await pg_page.select_option('#recurringAccount', str(account['id']))
    await pg_page.click('#addRecurringBtn')
    await pg_page.wait_for_selector('text=Smoke Netflix', timeout=5000)
    await pg_page.reload()
    await pg_page.wait_for_selector('#topNav', state='visible', timeout=8000)
    await pg_page.click('[data-page="recurring"]')
    assert await pg_page.locator('text=Smoke Netflix').count() > 0, f'Recurring not persisted. Console: {logs}'


async def test_reconciliation_add_persists(pg_page, base_url, credentials):
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)
    account = await _ensure_account(pg_page)
    await pg_page.click('[data-page="reconcile"]')
    await pg_page.fill(f'#recon-balance-{account["id"]}', '1050')
    await pg_page.fill(f'#recon-date-{account["id"]}', '2026-01-31')
    await pg_page.click(f'#recon-submit-{account["id"]}')
    await pg_page.wait_for_timeout(800)
    await pg_page.reload()
    await pg_page.wait_for_selector('#topNav', state='visible', timeout=8000)
    recons = await (await _api_get(pg_page, '/api/reconciliations')).json()
    assert len(recons) > 0, f'Reconciliation not persisted. Console: {logs}'


# ---------------------------------------------------------------------------
# Keyed resources
# ---------------------------------------------------------------------------

async def test_setting_persists(pg_page, base_url, credentials):
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)
    await pg_page.click('#settingsBtn')
    await pg_page.wait_for_selector('#settingsModal', state='visible', timeout=5000)
    checkbox = pg_page.locator('#settingReconciliationAdjustsBalance')
    initial_state = await checkbox.is_checked()
    await checkbox.click()
    await pg_page.click('#settingsModalDoneBtn')
    await pg_page.reload()
    await pg_page.wait_for_selector('#topNav', state='visible', timeout=8000)
    await pg_page.click('#settingsBtn')
    await pg_page.wait_for_selector('#settingsModal', state='visible', timeout=5000)
    new_state = await pg_page.locator('#settingReconciliationAdjustsBalance').is_checked()
    assert new_state != initial_state, f'Setting not persisted after reload. Console: {logs}'


async def test_net_worth_snapshot_persists(pg_page, base_url, credentials):
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)
    await pg_page.click('[data-page="reports"]')
    await pg_page.wait_for_selector('#captureSnapshotBtn', state='visible', timeout=5000)
    await pg_page.click('#captureSnapshotBtn')
    await pg_page.wait_for_timeout(800)
    await pg_page.reload()
    await pg_page.wait_for_selector('#topNav', state='visible', timeout=8000)
    snapshots = await (await _api_get(pg_page, '/api/net-worth-snapshots')).json()
    assert len(snapshots) > 0, f'Snapshot not persisted. Console: {logs}'


# ---------------------------------------------------------------------------
# clearAllData wipes server rows
# ---------------------------------------------------------------------------

async def test_clear_all_data_wipes_server(pg_page, base_url, credentials):
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)

    seed = await _api_post(pg_page, '/api/debts', {
        'name': 'To Clear', 'debtType': 'creditCard',
        'accountBalance': 100, 'interestRate': 5,
        'minimumPayment': 10, 'dueDate': 1
    })
    assert seed.status == 201

    await pg_page.click('#settingsBtn')
    await pg_page.wait_for_selector('#settingsModal', state='visible', timeout=5000)
    pg_page.once('dialog', lambda d: d.accept())
    await pg_page.click('#clearAllDataBtn')
    await pg_page.wait_for_timeout(1500)

    # Re-enter postgres mode and log back in to verify server state is empty
    await pg_page.evaluate("localStorage.setItem('debtTrackerStorageBackend', 'postgres')")
    await pg_page.reload()
    await pg_page.locator('#loginGate').wait_for(state='visible', timeout=8000)
    await pg_page.fill('#loginGateEmail', credentials['email'])
    await pg_page.fill('#loginGatePassword', credentials['password'])
    async with pg_page.expect_response(lambda r: '/auth/login' in r.url, timeout=10000):
        await pg_page.click('.login-gate-submit')
    await pg_page.locator('#loginGate').wait_for(state='hidden', timeout=12000)

    debts = await (await _api_get(pg_page, '/api/debts')).json()
    assert len(debts) == 0, f'Debts still present after clearAllData. Console: {logs}'


# ---------------------------------------------------------------------------
# 401 mid-session shows login gate
# ---------------------------------------------------------------------------

async def test_401_shows_login_gate(pg_page, base_url, credentials):
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)
    await pg_page.click('[data-page="liabilities"]')
    await pg_page.wait_for_selector('#addDebtBtn', state='visible', timeout=5000)

    # Clear cookies to simulate session expiry
    await pg_page.context.clear_cookies()

    await pg_page.fill('#debtName', 'Post-expiry Debt')
    await pg_page.select_option('#debtType', 'creditCard')
    await pg_page.fill('#accountBalance', '100')
    await pg_page.fill('#interestRate', '5')
    await pg_page.fill('#minimumPayment', '10')
    await pg_page.fill('#dueDate', '1')
    await pg_page.click('#addDebtBtn')

    await pg_page.locator('#loginGate').wait_for(state='visible', timeout=8000)
    assert await pg_page.locator('#loginGate').is_visible(), f'Login gate not shown on 401. Console: {logs}'
```

- [ ] **Step 2: Run the Postgres test suite against the live stack**

```bash
docker compose up -d --build
pytest tests/postgres/ -v
```

Expected: all ~15 tests pass. If a mutation test fails with "not found after reload", the browser console output in the failure message will show whether the `pgPost` call returned an error.

- [ ] **Step 3: Commit**

```bash
git add tests/postgres/test_postgres_mutations.py
git commit -m "test(postgres): add mutation persistence integration tests"
```

---

### Task 13: CHANGELOG, APP_VERSION, and CLAUDE.md update

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `src/utils.js` (APP_VERSION)
- Modify: `CLAUDE.md`

**Interfaces:**
- `tests/features/test_versioning.py` enforces that `APP_VERSION` in `utils.js` matches the latest `## [x.y.z]` entry at the top of `CHANGELOG.md` and that heading versions are in descending order.

- [ ] **Step 1: Find the current APP_VERSION**

```bash
grep "APP_VERSION" src/utils.js
```

- [ ] **Step 2: Bump APP_VERSION in `src/utils.js`**

Increment the minor version. Example — if current is `'4.22.0'`:

```js
export const APP_VERSION = '4.23.0';
```

- [ ] **Step 3: Add CHANGELOG entry**

At the top of `CHANGELOG.md`, before the previous release entry, add (adjust version to match Step 2):

```markdown
## [4.23.0] — 2026-08-25

PostgreSQL Phase 2b — per-resource mutation wiring. Every add/edit/delete operation in the frontend now persists directly to the Postgres REST API when the Postgres backend is selected. New `src/postgresSync.js` module provides `pgPost`/`pgPatch`/`pgDelete`/`pgPut`/`pgDeleteAll` helpers shared by all 11 feature modules. `addEmergencyFund` handles both create and update paths. `clearAllData` fans out delete-all requests to all 13 resource endpoints. Server adds `DELETE /` to both `crudRouter.js` and `keyedRouter.js` for bulk deletion. See `docs/superpowers/specs/2026-08-24-postgresql-storage-phase2b-design.md`.
```

- [ ] **Step 4: Update CLAUDE.md — extend the Phase 2a bullet**

Find the **Backend service (optional, Phase 2a)** bullet and append at the end:

```
**Phase 2b** extends this: every mutation site in the 11 frontend feature modules calls `pgPost`/`pgPatch`/`pgDelete`/`pgPut` from `src/postgresSync.js` immediately after its in-memory array mutation, before `updateUI()`. `add*` functions are `async` because they must await `pgPost` to receive the DB-assigned id and swap it into the in-memory object before the DOM renders. `clearAllData` calls `pgDeleteAll(app)` (13 parallel DELETEs) when the backend was Postgres. Error handling is console-only in Phase 2b (optimistic updates, no rollback).
```

- [ ] **Step 5: Verify versioning test passes**

```bash
pytest tests/features/test_versioning.py -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md src/utils.js CLAUDE.md
git commit -m "chore: bump version to 4.23.0 for Phase 2b (per-resource Postgres mutation wiring)"
```

---

### Task 14: Push and open PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feature/postgresql-storage-phase2b
```

- [ ] **Step 2: Open a pull request**

```bash
gh pr create --title "feat: PostgreSQL Phase 2b — per-resource mutation wiring" --body "## Summary
- New src/postgresSync.js module with pgPost/pgPatch/pgDelete/pgPut/pgDeleteAll helpers
- All 10 array CRUD resources and 3 keyed resources wired to their REST endpoints
- clearAllData fans out parallel DELETE-all requests when Postgres backend is active
- Server adds DELETE / bulk-delete route to crudRouter and keyedRouter
- ~15 new integration tests in tests/postgres/test_postgres_mutations.py

## Test plan
- [ ] All existing tests pass: pytest tests/ -v -k 'not postgres'
- [ ] Server tests pass: cd server && npm test
- [ ] Postgres mutation tests pass: pytest tests/postgres/ -v (requires docker-compose stack)
- [ ] Versioning test passes: pytest tests/features/test_versioning.py -v
- [ ] CI test-postgres job passes

Implements spec: docs/superpowers/specs/2026-08-24-postgresql-storage-phase2b-design.md"
```

- [ ] **Step 3: Watch CI — confirm `test-postgres` job passes**

Monitor the Actions tab. The `test-postgres` job runs the docker-compose stack and executes both `tests/postgres/test_postgres_bootstrap.py` and the new `tests/postgres/test_postgres_mutations.py`.
