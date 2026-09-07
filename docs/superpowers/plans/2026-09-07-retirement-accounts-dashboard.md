# Retirement Accounts Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Retirement` account type with subtype/rate-of-return/employer-match fields, a manual per-account balance/contribution history log, a growth-projection calculator, and a new "Retirement" nav page with charts — for all three storage backends (localStorage, sessionStorage, and the optional self-hosted Postgres server).

**Architecture:** New account fields ride the existing `accounts` CRUD path everywhere (client sanitizer, server route, Postgres sync) since accounts already sync generically. A new `retirementSnapshots` resource (manual balance+contribution log, one row per account per period) is added end-to-end following the exact recipe the `planHistory` resource used in issue #162: a migration, a `createCrudResource()` server route, a client sanitizer, and entries in every generic array-driven sync/export/import list. A new pure `retirementCalculator.js` module (same style as `debtCalculator.js`) does projection math with no DOM/app access. A new `retirement.js` feature module renders the page, following the `app.js`-delegation pattern used by every other feature.

**Tech Stack:** Vanilla ES6 modules, Chart.js (already loaded via CDN), Playwright/pytest for feature tests, Jest for pure-function unit tests, Stryker for mutation coverage, Express + `node-pg-migrate` + Postgres for the optional backend, Node's built-in `node:test` for server tests.

**Spec:** `docs/superpowers/specs/2026-09-07-retirement-accounts-dashboard-design.md`

## Global Constraints

- New account fields: `retirementSubtype` (enum: `401k` | `Traditional IRA` | `Roth IRA` | `HSA` | `Other`, default `Other`), `rateOfReturn` (0-100, annual %), `employerMatchPercent` (0-100, %). Present on every account record but only meaningful/exposed in the UI when `type === 'Retirement'`.
- `app.retirementSnapshots`: `{ id, accountId, date, balance, contribution }` — manually logged, one row per account per period. `growth` is always derived (`balance − previousBalance − contribution`), never stored.
- `app.retirementTargetDate`: nullable ISO date, a global (not per-account) setting persisted as a plan-settings scalar under Postgres, and as a top-level field in the localStorage/sessionStorage blob.
- `retirementCalculator.js` functions are pure (no `app`/DOM access), matching `debtCalculator.js`'s convention.
- `APP_VERSION` moves `4.48.0` → `5.0.0` (major, per explicit instruction) in both `src/utils.js` and `sw.js`'s `CACHE_NAME`, with a matching `CHANGELOG.md` entry — done once, in the last task, after everything else is verified working.
- No CSP/inline-style/inline-script changes — all new markup uses existing CSS classes plus a small new stylesheet block; all dynamic content goes through `escapeHtml()` or `textContent`.
- No i18n for the new page (matches current scope: only nav/toolbar/Settings/Health are translated).

---

### Task 1: Account data model — retirement fields (client)

**Files:**
- Modify: `src/accounts.js:8` (`ACCOUNT_TYPE_ICONS`), `src/accounts.js:61` (`ACCT_TYPES` inside `renderAccountsList`)
- Modify: `src/sanitizers.js:5-13` (`sanitizeAccount`)
- Test: `tests/unit/sanitizers.test.js`

**Interfaces:**
- Produces: `sanitizeAccount(record, idFallback)` now returns `{ id, name, type, startingBalance, interestRate, retirementSubtype, rateOfReturn, employerMatchPercent }`. `ACCOUNT_TYPE_ICONS.Retirement === '🏛️'`. Later tasks read `account.retirementSubtype`/`account.rateOfReturn`/`account.employerMatchPercent`.

- [ ] **Step 1: Write the failing sanitizer test**

Add to `tests/unit/sanitizers.test.js`, inside the existing `describe('sanitizeAccount', ...)` block (after its last test):

```javascript
    test('adds retirement fields with defaults for a non-retirement account', () => {
        const result = sanitizeAccount({ id: 1, name: 'Checking', type: 'Checking', startingBalance: 100, interestRate: 0 }, 1);
        expect(result.retirementSubtype).toBe('Other');
        expect(result.rateOfReturn).toBe(0);
        expect(result.employerMatchPercent).toBe(0);
    });

    test('accepts a valid retirement subtype and clamps rate/match to [0,100]', () => {
        const result = sanitizeAccount({
            name: '401k', type: 'Retirement', retirementSubtype: '401k',
            rateOfReturn: 250, employerMatchPercent: -5
        }, 1);
        expect(result.retirementSubtype).toBe('401k');
        expect(result.rateOfReturn).toBe(100);
        expect(result.employerMatchPercent).toBe(0);
    });

    test('falls back an unrecognized retirementSubtype to Other', () => {
        const result = sanitizeAccount({ name: 'IRA', type: 'Retirement', retirementSubtype: 'bogus' }, 1);
        expect(result.retirementSubtype).toBe('Other');
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- sanitizers.test.js`
Expected: FAIL — `result.retirementSubtype` is `undefined`.

- [ ] **Step 3: Implement `sanitizeAccount` changes**

Replace `src/sanitizers.js:5-13`:

```javascript
const RETIREMENT_SUBTYPES = ['401k', 'Traditional IRA', 'Roth IRA', 'HSA', 'Other'];

export function sanitizeAccount(record, idFallback) {
    return {
        id: sanitizeInteger(record?.id, idFallback),
        name: normalizeText(record?.name, 80),
        type: normalizeText(record?.type, 30) || 'Other',
        startingBalance: sanitizeFiniteNumber(record?.startingBalance, 0),
        interestRate: sanitizeFiniteNumber(record?.interestRate, 0, { min: 0, max: 100 }),
        retirementSubtype: RETIREMENT_SUBTYPES.includes(record?.retirementSubtype) ? record.retirementSubtype : 'Other',
        rateOfReturn: sanitizeFiniteNumber(record?.rateOfReturn, 0, { min: 0, max: 100 }),
        employerMatchPercent: sanitizeFiniteNumber(record?.employerMatchPercent, 0, { min: 0, max: 100 })
    };
}
```

This keeps every line at or below the original line 13, so it does **not** shift `stryker.config.mjs`'s `'src/sanitizers.js:5-58'` entry's meaning in a way that drops coverage — but it does add 9 lines, pushing everything after it down by 9. After this step, run:

```bash
grep -n "^export function sanitizeIncome" src/sanitizers.js
grep -n "^}" src/sanitizers.js | awk -F: '$1>60' | head -1
```

Find the new closing `}` line for `sanitizeIncome` (the third function in that stryker range) and update `stryker.config.mjs`'s line:
```javascript
        'src/sanitizers.js:5-58', // sanitizeAccount, sanitizeDebt, sanitizeIncome
```
to use the new end-line number in place of `58`. Do the same sanity check for the `'src/sanitizers.js:72-93'` and `'src/sanitizers.js:95-125'` and `'src/sanitizers.js:126-147'` entries (all shift down by the same fixed offset since nothing between them changed) — update all four line-range numbers in `stryker.config.mjs` by the same offset.

- [ ] **Step 4: Update `ACCOUNT_TYPE_ICONS` and `ACCT_TYPES`**

In `src/accounts.js:8`:
```javascript
export const ACCOUNT_TYPE_ICONS = { Checking: '🏦', Savings: '💰', Cash: '💵', Investment: '📈', Retirement: '🏛️', 'Credit Card': '💳', Loan: '🏠', Other: '🗂️' };
```

In `src/accounts.js:61` (inside `renderAccountsList`):
```javascript
    const ACCT_TYPES = ['Checking','Savings','Cash','Investment','Retirement','Credit Card','Loan','Other'];
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:unit -- sanitizers.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/sanitizers.js src/accounts.js stryker.config.mjs tests/unit/sanitizers.test.js
git commit -m "feat: add Retirement account type and subtype/rate/match fields"
```

---

### Task 2: Account form UI — conditional retirement fields

**Files:**
- Modify: `index.html` (Accounts page add-form, `accountType` `<select>` around line 133-141; account edit-grid template in `src/accounts.js:76-89`)
- Modify: `src/accounts.js:160-180` (`addAccount`), `src/accounts.js:245-261` (`saveEditAccount`), `src/accounts.js:117-141` (`renderAccountsList` card display)
- Test: `tests/features/test_accounts.py` (or a new small addition there — check the file first for its existing structure/imports before adding)

**Interfaces:**
- Consumes: `sanitizeAccount` (Task 1), `ACCOUNT_TYPE_ICONS` (Task 1).
- Produces: the add-account form and inline edit form both read/write `retirementSubtype`/`rateOfReturn`/`employerMatchPercent` inputs, gated by a `type === 'Retirement'` visibility toggle; account cards show a subtype/rate/match badge when the account is Retirement.

- [ ] **Step 1: Add the retirement option and conditional fields to the add-account form**

In `index.html`, add `Retirement` to the `#accountType` select (line ~137, after `Investment`):
```html
                                    <option value="Investment">Investment</option>
                                    <option value="Retirement">Retirement</option>
```

Immediately after the existing `accountInterestRate` form-group (closes at `index.html:154`, right before `</div>` at line 155 that closes `account-form-grid`), add a new conditional block:
```html
                            <div class="form-group hidden" id="accountRetirementFieldsGroup">
                                <label for="accountRetirementSubtype">Retirement Subtype</label>
                                <select id="accountRetirementSubtype">
                                    <option value="401k">401k</option>
                                    <option value="Traditional IRA">Traditional IRA</option>
                                    <option value="Roth IRA">Roth IRA</option>
                                    <option value="HSA">HSA</option>
                                    <option value="Other" selected>Other</option>
                                </select>
                            </div>
                            <div class="form-group hidden" id="accountRateOfReturnGroup">
                                <label for="accountRateOfReturn">Expected Rate of Return (% / yr)
                                    <span class="help-icon" tabindex="0" aria-label="Your assumed average annual growth rate for this account, used only for the Retirement page's future-value projection.">?</span>
                                </label>
                                <input type="number" id="accountRateOfReturn" placeholder="0.00" step="0.01" min="0" max="100">
                            </div>
                            <div class="form-group hidden" id="accountEmployerMatchGroup">
                                <label for="accountEmployerMatch">Employer Match (%)
                                    <span class="help-icon" tabindex="0" aria-label="Percent of your contribution your employer matches, e.g. 50 for a 50% match. Used in the Retirement page's projection.">?</span>
                                </label>
                                <input type="number" id="accountEmployerMatch" placeholder="0.00" step="0.01" min="0" max="100">
                            </div>
```

Note: `.hidden` is the existing global utility class (already used throughout `index.html`, e.g. `emptyState`) — confirm with `grep -n "^\.hidden" styles.css` before relying on it; it should already exist.

- [ ] **Step 2: Wire the show/hide toggle and read the new fields in `addAccount`**

In `src/accounts.js`, add a toggle function and call it from an event listener. Add near the top of the file (after the `ACCOUNT_TYPE_ICONS` export, before `refreshAccountSelectors`):

```javascript
export function updateAccountFormRetirementVisibility() {
    const typeEl = document.getElementById('accountType');
    const isRetirement = typeEl?.value === 'Retirement';
    for (const id of ['accountRetirementFieldsGroup', 'accountRateOfReturnGroup', 'accountEmployerMatchGroup']) {
        document.getElementById(id)?.classList.toggle('hidden', !isRetirement);
    }
}
```

This needs to run on `accountType`'s `change` event and once on initial render. Find where `accountType`'s existing listeners (if any) or the account form's initialization happens — search `grep -n "accountType" src/ui.js src/app.js` — and add, in `initializeEventListeners` (or wherever the account form's other listeners are attached in `src/ui.js`):
```javascript
    document.getElementById('accountType')?.addEventListener('change', updateAccountFormRetirementVisibility);
```
Import `updateAccountFormRetirementVisibility` from `./accounts.js` at the top of `src/ui.js`, and call `updateAccountFormRetirementVisibility()` once inside `renderPageData`'s `pageName === 'accounts'` branch (`src/ui.js:615-618`) so navigating to Accounts resets the field visibility to match the (possibly browser-autofilled) select value.

Update `addAccount` in `src/accounts.js:160-180`:
```javascript
export async function addAccount(app) {
    const name = normalizeText(document.getElementById('accountName').value, 80);
    const type = normalizeText(document.getElementById('accountType').value, 30);
    const startingBalance = sanitizeFiniteNumber(document.getElementById('accountStartingBalance').value, NaN);
    const interestRate = sanitizeFiniteNumber(document.getElementById('accountInterestRate')?.value, 0, { min: 0, max: 100 });
    const retirementSubtype = normalizeText(document.getElementById('accountRetirementSubtype')?.value, 30) || 'Other';
    const rateOfReturn = sanitizeFiniteNumber(document.getElementById('accountRateOfReturn')?.value, 0, { min: 0, max: 100 });
    const employerMatchPercent = sanitizeFiniteNumber(document.getElementById('accountEmployerMatch')?.value, 0, { min: 0, max: 100 });

    if (!name) { await showAlertModal('Please enter an account name.'); return; }
    if (isNaN(startingBalance)) { await showAlertModal('Please enter a starting balance (use 0 if unknown).'); return; }

    const account = { id: Date.now(), name, type, startingBalance, interestRate, retirementSubtype, rateOfReturn, employerMatchPercent };
    app.accounts.push(account);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') {
        const saved = await pgPost(app, '/api/accounts', account);
        if (saved?.id) account.id = saved.id;
    }
    app.renderAccountsList();
    app.renderNetWorthWidget();
    refreshAccountSelectors(app);
    document.getElementById('accountForm').reset();
    updateAccountFormRetirementVisibility();
}
```
(The trailing `updateAccountFormRetirementVisibility()` call re-hides the conditional fields after `.reset()`, since `.reset()` restores the select to its first `<option>`, not necessarily hiding the fields if `Retirement` was mid-list — calling the toggle function re-syncs visibility to the reset value.)

- [ ] **Step 3: Add the same fields to the inline edit form and `saveEditAccount`**

In `src/accounts.js:76-89` (inside `renderAccountsList`'s editing-card template), after the existing `ac-rate-${a.id}` form-group, add:
```javascript
                    <div class="form-group form-no-margin">
                        <label class="label-compact">Retirement Subtype</label>
                        <select id="ac-retiresub-${a.id}" class="form-full-width">
                            ${['401k','Traditional IRA','Roth IRA','HSA','Other'].map(s => `<option value="${s}" ${a.retirementSubtype===s?'selected':''}>${s}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group form-no-margin">
                        <label class="label-compact">Rate of Return (%/yr)</label>
                        <input type="number" id="ac-ror-${a.id}" value="${Number(a.rateOfReturn) || 0}" step="0.01" min="0" max="100" class="form-full-width">
                    </div>
                    <div class="form-group form-no-margin">
                        <label class="label-compact">Employer Match (%)</label>
                        <input type="number" id="ac-match-${a.id}" value="${Number(a.employerMatchPercent) || 0}" step="0.01" min="0" max="100" class="form-full-width">
                    </div>
```
(These three fields are always rendered in the edit card, not conditionally hidden — the edit card is compact/dense already and always showing them avoids adding a `change`-listener inside a per-row template string. Non-Retirement accounts simply ignore these values.)

Update `saveEditAccount` in `src/accounts.js:245-261`:
```javascript
export async function saveEditAccount(app, id) {
    const idx = app.accounts.findIndex(a => a.id === id);
    if (idx === -1) return;
    const name = normalizeText(document.getElementById(`ac-name-${id}`)?.value, 80);
    const type = normalizeText(document.getElementById(`ac-type-${id}`)?.value, 30);
    const startingBalance = sanitizeFiniteNumber(document.getElementById(`ac-bal-${id}`)?.value, NaN);
    const interestRate = sanitizeFiniteNumber(document.getElementById(`ac-rate-${id}`)?.value, 0, { min: 0, max: 100 });
    const retirementSubtype = normalizeText(document.getElementById(`ac-retiresub-${id}`)?.value, 30) || 'Other';
    const rateOfReturn = sanitizeFiniteNumber(document.getElementById(`ac-ror-${id}`)?.value, 0, { min: 0, max: 100 });
    const employerMatchPercent = sanitizeFiniteNumber(document.getElementById(`ac-match-${id}`)?.value, 0, { min: 0, max: 100 });
    if (!name) { await showAlertModal('Please enter an account name.'); return; }
    if (isNaN(startingBalance)) { await showAlertModal('Please enter a valid starting balance.'); return; }
    app.accounts[idx] = { ...app.accounts[idx], name, type, startingBalance, interestRate, retirementSubtype, rateOfReturn, employerMatchPercent };
    app.editingAccountId = null;
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/accounts/${app.accounts[idx].id}`, app.accounts[idx]);
    app.renderAccountsList();
    app.renderNetWorthWidget();
    refreshAccountSelectors(app);
}
```

- [ ] **Step 4: Show a retirement badge on the account card**

In `src/accounts.js:117-123` (card header, non-editing branch), after the existing `acct-rate-badge` line, add:
```javascript
                    ${a.type === 'Retirement' ? `<span class="acct-rate-badge">🏛️ ${escapeHtml(a.retirementSubtype)} · ${Number(a.rateOfReturn).toFixed(1)}% est.</span>` : ''}
```

- [ ] **Step 5: Manual verification (no dedicated Playwright test needed for this UI-only step — Task 10 covers end-to-end Retirement-page behavior which exercises this form)**

Run the app locally and confirm: selecting "Retirement" in `#accountType` reveals the three new fields; selecting any other type hides them; saving a Retirement account round-trips its subtype/rate/match through Edit.

```bash
python -m http.server 32900
```
Open `http://localhost:32900/`, go to Accounts, add a Retirement account, verify the fields appear and the badge shows on the card.

- [ ] **Step 6: Commit**

```bash
git add index.html src/accounts.js src/ui.js
git commit -m "feat: add conditional retirement fields to account add/edit forms"
```

---

### Task 3: `retirementCalculator.js` — pure projection math

**Files:**
- Create: `src/retirementCalculator.js`
- Test: `tests/unit/retirementCalculator.test.js`
- Modify: `stryker.config.mjs`

**Interfaces:**
- Produces: `computeRetirementProjection(currentBalance, monthlyContribution, annualRatePct, monthsUntilTarget) → number` and `splitGrowthFromContribution(snapshotsForOneAccount) → [{date, contribution, growth}]`, both pure (no `app`/DOM). Later tasks (Task 5) import both from `./retirementCalculator.js`.

- [ ] **Step 1: Write the failing test file**

Create `tests/unit/retirementCalculator.test.js`:
```javascript
const { computeRetirementProjection, splitGrowthFromContribution } = require('../../src/retirementCalculator.js');

describe('computeRetirementProjection', () => {
    test('returns currentBalance unchanged when monthsUntilTarget is zero or negative', () => {
        expect(computeRetirementProjection(10000, 500, 7, 0)).toBe(10000);
        expect(computeRetirementProjection(10000, 500, 7, -5)).toBe(10000);
    });

    test('zero rate of return sums contributions linearly', () => {
        const result = computeRetirementProjection(1000, 100, 0, 12);
        expect(result).toBeCloseTo(1000 + 100 * 12, 5);
    });

    test('compounds monthly at the given annual rate with contributions', () => {
        // Hand-computed: $10,000 at 12%/yr (1%/mo) for 3 months, $100/mo contribution
        // m1: 10000*1.01+100=10200; m2: 10200*1.01+100=10402; m3: 10402*1.01+100=10606.02
        const result = computeRetirementProjection(10000, 100, 12, 3);
        expect(result).toBeCloseTo(10606.02, 2);
    });

    test('zero contribution still compounds the existing balance', () => {
        const result = computeRetirementProjection(1000, 0, 12, 12);
        expect(result).toBeCloseTo(1000 * Math.pow(1.01, 12), 5);
    });
});

describe('splitGrowthFromContribution', () => {
    test('single snapshot has zero growth (no prior balance to diff against)', () => {
        const result = splitGrowthFromContribution([{ date: '2026-01-01', balance: 5000, contribution: 200 }]);
        expect(result).toEqual([{ date: '2026-01-01', contribution: 200, growth: 0 }]);
    });

    test('computes growth as balance delta minus contribution across multiple snapshots', () => {
        const result = splitGrowthFromContribution([
            { date: '2026-01-01', balance: 5000, contribution: 200 },
            { date: '2026-02-01', balance: 5300, contribution: 200 }
        ]);
        expect(result[1]).toEqual({ date: '2026-02-01', contribution: 200, growth: 100 });
    });

    test('sorts input by date before diffing, regardless of input order', () => {
        const result = splitGrowthFromContribution([
            { date: '2026-02-01', balance: 5300, contribution: 200 },
            { date: '2026-01-01', balance: 5000, contribution: 200 }
        ]);
        expect(result.map(r => r.date)).toEqual(['2026-01-01', '2026-02-01']);
        expect(result[1].growth).toBe(100);
    });

    test('handles a mid-series contribution change', () => {
        const result = splitGrowthFromContribution([
            { date: '2026-01-01', balance: 1000, contribution: 100 },
            { date: '2026-02-01', balance: 1150, contribution: 50 }
        ]);
        expect(result[1]).toEqual({ date: '2026-02-01', contribution: 50, growth: 100 });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- retirementCalculator.test.js`
Expected: FAIL — cannot find module `../../src/retirementCalculator.js`.

- [ ] **Step 3: Implement `src/retirementCalculator.js`**

```javascript
// Pure retirement projection calculations — no DOM/app state access.

export function computeRetirementProjection(currentBalance, monthlyContribution, annualRatePct, monthsUntilTarget) {
    if (!(monthsUntilTarget > 0)) return currentBalance;
    const monthlyRate = (Number(annualRatePct) || 0) / 100 / 12;
    let balance = Number(currentBalance) || 0;
    const contribution = Number(monthlyContribution) || 0;
    for (let i = 0; i < monthsUntilTarget; i++) {
        balance = balance * (1 + monthlyRate) + contribution;
    }
    return balance;
}

export function splitGrowthFromContribution(snapshotsForOneAccount) {
    const sorted = [...(snapshotsForOneAccount || [])].sort((a, b) => a.date.localeCompare(b.date));
    return sorted.map((snap, i) => {
        const contribution = Number(snap.contribution) || 0;
        if (i === 0) return { date: snap.date, contribution, growth: 0 };
        const prevBalance = Number(sorted[i - 1].balance) || 0;
        const balance = Number(snap.balance) || 0;
        return { date: snap.date, contribution, growth: balance - prevBalance - contribution };
    });
}
```

This file is exactly 23 lines: `computeRetirementProjection` spans lines 3-12, `splitGrowthFromContribution` spans lines 14-23. Verify with `grep -n "" src/retirementCalculator.js` before proceeding — if your editor added/removed a blank line, adjust the ranges in Step 5 to match reality.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- retirementCalculator.test.js`
Expected: PASS

- [ ] **Step 5: Add to Stryker's mutate scope**

In `stryker.config.mjs`, add two new lines inside the `mutate` array (after the `sanitizers.js` entries):
```javascript
        'src/retirementCalculator.js:3-12', // computeRetirementProjection
        'src/retirementCalculator.js:14-23', // splitGrowthFromContribution
```

- [ ] **Step 6: Commit**

```bash
git add src/retirementCalculator.js tests/unit/retirementCalculator.test.js stryker.config.mjs
git commit -m "feat: add pure retirement projection calculator"
```

---

### Task 4: `retirementSnapshots` sanitizer + import wiring (client)

**Files:**
- Modify: `src/sanitizers.js` (add `sanitizeRetirementSnapshot`, extend `sanitizeParsedState`)
- Test: `tests/unit/sanitizers.test.js`

**Interfaces:**
- Consumes: `sanitizeInteger`, `sanitizeFiniteNumber`, `sanitizeDateISO`, `todayISO` (all already imported in `sanitizers.js`).
- Produces: `sanitizeRetirementSnapshot(record, idFallback) → { id, accountId, date, balance, contribution }`. `sanitizeParsedState(parsed)` now also returns `retirementSnapshots: [...]` and `retirementTargetDate: string|null`. Task 9 and Task 14 both call `sanitizeParsedState`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/sanitizers.test.js` (a new `describe` block, anywhere after the existing ones):
```javascript
describe('sanitizeRetirementSnapshot', () => {
    const { sanitizeRetirementSnapshot } = require('../../src/sanitizers.js');

    test('passes through a well-formed record', () => {
        const result = sanitizeRetirementSnapshot({ id: 1, accountId: 5, date: '2026-01-01', balance: 10000, contribution: 500 }, 99);
        expect(result).toEqual({ id: 1, accountId: 5, date: '2026-01-01', balance: 10000, contribution: 500 });
    });

    test('defaults date to today and numbers to 0 when missing', () => {
        const result = sanitizeRetirementSnapshot({ accountId: 5 }, 42);
        expect(result.id).toBe(42);
        expect(result.accountId).toBe(5);
        expect(result.balance).toBe(0);
        expect(result.contribution).toBe(0);
        expect(typeof result.date).toBe('string');
    });

    test('rejects a negative balance by clamping to 0', () => {
        const result = sanitizeRetirementSnapshot({ accountId: 1, date: '2026-01-01', balance: -500 }, 1);
        expect(result.balance).toBe(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- sanitizers.test.js`
Expected: FAIL — `sanitizeRetirementSnapshot` is not a function.

- [ ] **Step 3: Implement `sanitizeRetirementSnapshot` and wire it into `sanitizeParsedState`**

In `src/sanitizers.js`, add this function immediately **before** `export function sanitizeParsedState` (so it lands after every stryker-tracked range and doesn't shift any of those line numbers):
```javascript
export function sanitizeRetirementSnapshot(record, idFallback) {
    return {
        id: sanitizeInteger(record?.id, idFallback),
        accountId: sanitizeInteger(record?.accountId, null),
        date: sanitizeDateISO(record?.date) || todayISO(),
        balance: sanitizeFiniteNumber(record?.balance, 0, { min: 0 }),
        contribution: sanitizeFiniteNumber(record?.contribution, 0, { min: 0 })
    };
}

```

Then in `sanitizeParsedState`, add two new fields to the returned object (alongside the existing `planHistory`/`settings` lines):
```javascript
        retirementSnapshots: (Array.isArray(parsed.retirementSnapshots) ? parsed.retirementSnapshots : []).map((s, i) => sanitizeRetirementSnapshot(s, now + 6500 + i)).filter(s => s.accountId !== null),
        retirementTargetDate: sanitizeDateISO(parsed.retirementTargetDate),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- sanitizers.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sanitizers.js tests/unit/sanitizers.test.js
git commit -m "feat: add retirement snapshot sanitizer and import wiring"
```

---

### Task 5: `retirement.js` core module — CRUD, getters, projection

**Files:**
- Create: `src/retirement.js`
- Modify: `src/app.js` (constructor state, delegating methods)

**Interfaces:**
- Consumes: `computeRetirementProjection` (Task 3), `sanitizeRetirementSnapshot` is NOT called here (sanitization happens at load/import time, Task 4/9) — this module works with already-sanitized `app.retirementSnapshots`. Uses the global `DebtCalculator.calculateMonthsBetweenDates` (already loaded as a classic script before any ES module runs, per `index.html`'s script order — same convention `dataExport.js` relies on).
- Produces: `getRetirementAccounts(app)`, `getSnapshotsForAccount(app, accountId)`, `addRetirementSnapshot(app, accountId, date, balance, contribution)`, `deleteRetirementSnapshot(app, id)`, `computeAccountProjection(app, accountId)`. Task 6/7/8 build `renderRetirementPage` on top of these.

- [ ] **Step 1: Create `src/retirement.js` with the data-layer functions**

```javascript
// Retirement accounts: history log, projection, and page rendering.

import { computeRetirementProjection } from './retirementCalculator.js';
import { pgPost, pgDelete } from './postgresSync.js';

export function getRetirementAccounts(app) {
    return (app.accounts || []).filter(a => a.type === 'Retirement');
}

export function getSnapshotsForAccount(app, accountId) {
    return (app.retirementSnapshots || [])
        .filter(s => s.accountId === accountId)
        .sort((a, b) => a.date.localeCompare(b.date));
}

export async function addRetirementSnapshot(app, accountId, date, balance, contribution) {
    const snapshot = { id: Date.now(), accountId, date, balance, contribution };
    app.retirementSnapshots.push(snapshot);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') {
        const saved = await pgPost(app, '/api/retirement-snapshots', snapshot);
        if (saved?.id) snapshot.id = saved.id;
    }
    app.renderRetirementPage();
}

export function deleteRetirementSnapshot(app, id) {
    app.retirementSnapshots = app.retirementSnapshots.filter(s => s.id !== id);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/retirement-snapshots/${id}`);
    app.renderRetirementPage();
}

// Projects an account's value at app.retirementTargetDate, assuming the
// account's rateOfReturn compounds monthly and its most recently logged
// contribution (boosted by employerMatchPercent) recurs every month until
// then. Returns null if no target date is set or the account doesn't exist.
export function computeAccountProjection(app, accountId) {
    if (!app.retirementTargetDate) return null;
    const account = (app.accounts || []).find(a => a.id === accountId);
    if (!account) return null;

    const snapshots = getSnapshotsForAccount(app, accountId);
    const latest = snapshots[snapshots.length - 1];
    const currentBalance = latest ? latest.balance : (Number(account.startingBalance) || 0);
    const lastContribution = latest ? latest.contribution : 0;
    const employerMultiplier = 1 + (Number(account.employerMatchPercent) || 0) / 100;
    const monthlyContribution = lastContribution * employerMultiplier;

    const monthsUntilTarget = DebtCalculator.calculateMonthsBetweenDates(
        new Date(),
        new Date(`${app.retirementTargetDate}T12:00:00`)
    );

    return computeRetirementProjection(currentBalance, monthlyContribution, Number(account.rateOfReturn) || 0, monthsUntilTarget);
}
```

- [ ] **Step 2: Add state fields to `DebtTrackerApp` constructor**

In `src/app.js`, in the constructor (near `this.reconciliations = [];` / `this.planHistory = [];`, around line 150-151):
```javascript
        this.retirementSnapshots = [];
        this.retirementTargetDate = null;
```

- [ ] **Step 3: Add delegating methods**

In `src/app.js`, import at the top (alongside the other feature-module imports):
```javascript
import {
    getRetirementAccounts,
    getSnapshotsForAccount,
    addRetirementSnapshot as addRetirementSnapshotFeature,
    deleteRetirementSnapshot as deleteRetirementSnapshotFeature,
    computeAccountProjection
} from './retirement.js';
```
Add delegating methods near the other feature methods (e.g. near `renderReconciliationPage()` at `src/app.js:931`):
```javascript
    getRetirementAccounts() { return getRetirementAccounts(this); }
    getSnapshotsForAccount(accountId) { return getSnapshotsForAccount(this, accountId); }
    addRetirementSnapshot(accountId, date, balance, contribution) { return addRetirementSnapshotFeature(this, accountId, date, balance, contribution); }
    deleteRetirementSnapshot(id) { return deleteRetirementSnapshotFeature(this, id); }
    computeAccountProjection(accountId) { return computeAccountProjection(this, accountId); }
    renderRetirementPage() { /* implemented in Task 6 */ }
```
(`renderRetirementPage()` is a placeholder body only for this task — Task 6 replaces it with a real delegating call once `renderRetirementPage` exists in `retirement.js`. Do not leave a placeholder body past Task 6.)

- [ ] **Step 4: Manual verification via browser console**

```bash
python -m http.server 32900
```
Open the app, in the browser console run:
```javascript
window.app.accounts.push({ id: 999, name: 'Test 401k', type: 'Retirement', retirementSubtype: '401k', startingBalance: 1000, rateOfReturn: 7, employerMatchPercent: 50 });
await window.app.addRetirementSnapshot(999, '2026-01-01', 1000, 200);
window.app.getSnapshotsForAccount(999);
```
Expected: returns `[{ id: ..., accountId: 999, date: '2026-01-01', balance: 1000, contribution: 200 }]` with no console errors.

- [ ] **Step 5: Commit**

```bash
git add src/retirement.js src/app.js
git commit -m "feat: add retirement.js core module (CRUD, getters, projection)"
```

---

### Task 6: Retirement page — nav, routing, and account-card rendering

**Files:**
- Modify: `index.html` (nav button, page section, snapshot modal)
- Modify: `src/ui.js` (`switchPage` mapping, `renderPageData` dispatch)
- Modify: `src/commandPalette.js`
- Modify: `src/retirement.js` (`renderRetirementPage`, `openRetirementSnapshotModal`)
- Modify: `src/app.js` (replace the Task 5 placeholder `renderRetirementPage()`)
- Modify: `styles.css`

**Interfaces:**
- Consumes: `getRetirementAccounts`, `getSnapshotsForAccount`, `addRetirementSnapshot`, `deleteRetirementSnapshot` (Task 5); `formatCurrency`, `escapeHtml`, `todayISO`, `sanitizeDateISO` (`utils.js`).
- Produces: `renderRetirementPage(app)`, `openRetirementSnapshotModal(app, accountId)` — both exported from `retirement.js`. Task 7 extends `renderRetirementPage` with charts/projection; this task only needs account cards + empty states + target-date input + snapshot list/modal to work end-to-end.

- [ ] **Step 1: Add the nav button**

In `index.html`, in the "Analyze" nav group (after the Reconcile button, line 88):
```html
                            <button class="page-button" data-page="retirement">Retirement</button>
```

- [ ] **Step 2: Add the page section**

In `index.html`, after the `reconcileSection` (closes at line 910), before the Savings Section comment:
```html
            <!-- ═══════════════════════════════════════════════════════════ -->
            <!-- Retirement Section                                          -->
            <!-- ═══════════════════════════════════════════════════════════ -->
            <section class="retirement-section page-section" id="retirementSection">
                <!-- Content dynamically rendered by renderRetirementPage() -->
            </section>
```

- [ ] **Step 3: Add the snapshot modal**

In `index.html`, alongside the other modals (near `reconcileModal`, after its closing `</div>` — find it via `grep -n "reconcileModal" index.html`):
```html
    <div id="retirementSnapshotModal" class="modal modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="retirementSnapshotModalTitle" tabindex="-1">
        <div class="modal-content">
            <button id="retirementSnapshotModalCloseBtn" aria-label="Close" class="modal-close">&times;</button>
            <h3 id="retirementSnapshotModalTitle">Log Balance</h3>
            <div class="form-group modal-form-group">
                <label for="retirementSnapshotModalDate">Date</label>
                <input type="date" id="retirementSnapshotModalDate">
            </div>
            <div class="form-group modal-form-group">
                <label for="retirementSnapshotModalBalance">Balance ($)</label>
                <input type="number" id="retirementSnapshotModalBalance" step="0.01" placeholder="0.00">
            </div>
            <div class="form-group modal-form-group">
                <label for="retirementSnapshotModalContribution">Contribution This Period ($)</label>
                <input type="number" id="retirementSnapshotModalContribution" step="0.01" placeholder="0.00">
            </div>
            <div class="modal-actions">
                <button id="retirementSnapshotModalConfirmBtn" class="btn btn-success">Save</button>
                <button id="retirementSnapshotModalCancelBtn" class="btn btn-secondary">Cancel</button>
            </div>
        </div>
    </div>
```

- [ ] **Step 4: Wire routing**

In `src/ui.js`'s `switchPage` mapping (around line 577-588), add:
```javascript
        retirement: 'retirementSection'
```
In `renderPageData` (around line 646-648, after the `reconcile` branch), add:
```javascript
    if (pageName === 'retirement') {
        app.renderRetirementPage();
    }
```

In `src/commandPalette.js`, after `nav('reconcile', 'Reconcile', '🔄'),`:
```javascript
        nav('retirement', 'Retirement', '🏛️'),
```

- [ ] **Step 5: Implement `renderRetirementPage` and `openRetirementSnapshotModal` in `src/retirement.js`**

Add to the top imports:
```javascript
import { formatCurrency, escapeHtml, todayISO } from './utils.js';
```

Append to `src/retirement.js`:
```javascript
export function openRetirementSnapshotModal(app, accountId) {
    const modal = document.getElementById('retirementSnapshotModal');
    const account = (app.accounts || []).find(a => a.id === accountId);
    if (!modal || !account) return;

    const dateInput = document.getElementById('retirementSnapshotModalDate');
    const balanceInput = document.getElementById('retirementSnapshotModalBalance');
    const contributionInput = document.getElementById('retirementSnapshotModalContribution');
    const confirmBtn = document.getElementById('retirementSnapshotModalConfirmBtn');
    const cancelBtn = document.getElementById('retirementSnapshotModalCancelBtn');
    const closeBtn = document.getElementById('retirementSnapshotModalCloseBtn');
    if (!dateInput || !balanceInput || !contributionInput || !confirmBtn || !cancelBtn || !closeBtn) return;

    const snapshots = getSnapshotsForAccount(app, accountId);
    const latest = snapshots[snapshots.length - 1];
    dateInput.value = todayISO();
    balanceInput.value = latest ? latest.balance : (Number(account.startingBalance) || 0);
    contributionInput.value = latest ? latest.contribution : 0;

    const lastFocused = document.activeElement;
    const close = () => {
        modal.classList.add('hidden'); modal.classList.remove('flex-visible');
        modal.onkeydown = null;
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    };

    confirmBtn.onclick = async () => {
        const balance = Number(balanceInput.value);
        const contribution = Number(contributionInput.value) || 0;
        if (!Number.isFinite(balance) || balance < 0) return;
        await app.addRetirementSnapshot(accountId, dateInput.value || todayISO(), balance, contribution);
        close();
    };
    cancelBtn.onclick = close;
    closeBtn.onclick = close;
    modal.onclick = (event) => { if (event.target === modal) close(); };
    modal.onkeydown = (event) => {
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        if (event.key === 'Enter') { event.preventDefault(); confirmBtn.click(); }
    };

    modal.classList.add('flex-visible'); modal.classList.remove('hidden');
    setTimeout(() => balanceInput.focus(), 30);
}

function renderAccountCard(app, account) {
    const snapshots = getSnapshotsForAccount(app, account.id);
    const latest = snapshots[snapshots.length - 1];
    const currentBalance = latest ? latest.balance : (Number(account.startingBalance) || 0);

    const rows = snapshots.length === 0
        ? `<tr><td colspan="4" class="retire-empty-msg">No balances logged yet.</td></tr>`
        : [...snapshots].reverse().map(s => `
            <tr>
                <td>${escapeHtml(s.date)}</td>
                <td>${formatCurrency(s.balance)}</td>
                <td>${formatCurrency(s.contribution)}</td>
                <td><button class="btn btn-danger btn-small" data-retire-action="delete-snapshot" data-retire-snapshot-id="${s.id}">Delete</button></td>
            </tr>`).join('');

    return `
        <div class="retire-card">
            <div class="retire-card-header">
                <span class="acct-type-icon">🏛️</span>
                <div class="acct-card-info">
                    <span class="acct-card-name">${escapeHtml(account.name)} (${escapeHtml(account.retirementSubtype)})</span>
                    <span class="acct-rate-badge">📈 ${Number(account.rateOfReturn).toFixed(1)}% est. return${Number(account.employerMatchPercent) > 0 ? ` · ${Number(account.employerMatchPercent).toFixed(0)}% match` : ''}</span>
                </div>
                <div class="retire-stat">
                    <span class="acct-balance-label">Current Balance</span>
                    <span class="acct-balance-value">${formatCurrency(currentBalance)}</span>
                </div>
                <button class="btn btn-primary btn-small" data-retire-action="add-snapshot" data-retire-account-id="${account.id}">+ Add Snapshot</button>
            </div>
            <div class="table-wrapper">
                <table class="retire-snapshot-table">
                    <thead><tr><th>Date</th><th>Balance</th><th>Contribution</th><th></th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>`;
}

export function renderRetirementPage(app) {
    const container = document.getElementById('retirementSection');
    if (!container) return;

    const accounts = getRetirementAccounts(app);

    if (accounts.length === 0) {
        container.innerHTML = `
            <div class="page-header-row"><h2>🏛️ Retirement</h2></div>
            <p class="retire-empty-msg">No retirement accounts yet. Add one from the <button class="btn-link" data-retire-action="goto-accounts">Accounts page</button> (choose type "Retirement") to start tracking it here.</p>`;
        container.onclick = (event) => {
            if (event.target.closest('[data-retire-action="goto-accounts"]')) app.switchPage('accounts');
        };
        return;
    }

    container.innerHTML = `
        <div class="page-header-row"><h2>🏛️ Retirement</h2></div>
        <div class="retire-target-date-row form-group">
            <label for="retirementTargetDateInput">Target Retirement Date</label>
            <input type="date" id="retirementTargetDateInput" value="${app.retirementTargetDate || ''}">
        </div>
        <div class="retire-cards">${accounts.map(a => renderAccountCard(app, a)).join('')}</div>
    `;

    document.getElementById('retirementTargetDateInput').onchange = (event) => {
        app.retirementTargetDate = event.target.value || null;
        app.saveToStorage();
        app.renderRetirementPage();
    };

    container.onclick = (event) => {
        const actionEl = event.target.closest('[data-retire-action]');
        if (!actionEl) return;
        const action = actionEl.getAttribute('data-retire-action');
        if (action === 'add-snapshot') {
            openRetirementSnapshotModal(app, parseInt(actionEl.getAttribute('data-retire-account-id'), 10));
        }
        if (action === 'delete-snapshot') {
            app.deleteRetirementSnapshot(parseInt(actionEl.getAttribute('data-retire-snapshot-id'), 10));
        }
        if (action === 'goto-accounts') {
            app.switchPage('accounts');
        }
    };
}
```

- [ ] **Step 6: Replace the Task 5 placeholder in `src/app.js`**

Change:
```javascript
    renderRetirementPage() { /* implemented in Task 6 */ }
```
to:
```javascript
    renderRetirementPage() { return renderRetirementPageFeature(this); }
```
and update the Task 5 import to also bring in `renderRetirementPage as renderRetirementPageFeature`.

- [ ] **Step 7: Add minimal CSS**

In `styles.css`, add near the existing `.acct-card` rules (after line ~5300, `body.dark-mode .acct-rate-badge`):
```css
.retire-cards { display: flex; flex-direction: column; gap: 16px; }
.retire-card { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; }
.retire-card-header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.retire-stat { display: flex; flex-direction: column; margin-left: auto; }
.retire-target-date-row { max-width: 260px; margin-bottom: 20px; }
.retire-snapshot-table { width: 100%; border-collapse: collapse; }
.retire-snapshot-table th, .retire-snapshot-table td { padding: 6px 10px; text-align: left; border-bottom: 1px solid var(--border-color); font-size: 0.85rem; }
.retire-empty-msg { text-align: center; color: var(--text-muted); padding: 24px 0; }
```

- [ ] **Step 8: Manual verification**

```bash
python -m http.server 32900
```
Add a Retirement account (Task 2's form), navigate to the new Retirement nav button, confirm the card renders, "+ Add Snapshot" opens the modal, saving adds a row, "Delete" removes it, and the target-date input persists across a page reload.

- [ ] **Step 9: Commit**

```bash
git add index.html src/ui.js src/commandPalette.js src/retirement.js src/app.js styles.css
git commit -m "feat: add Retirement page with account cards and snapshot logging"
```

---

### Task 7: Charts — balance over time, contribution vs. growth, breakdown, projection

**Files:**
- Modify: `src/retirement.js` (`renderRetirementPage`, three new chart-render helpers)
- Modify: `styles.css` (reuses `.rpt-chart-card`/`.rpt-charts-row`/`.rpt-chart-canvas-wrap` from `styles.css` — no new classes needed here)

**Interfaces:**
- Consumes: `splitGrowthFromContribution` (Task 3), `computeAccountProjection` (Task 5), `renderChartDataTable` (`utils.js`).
- Produces: `renderRetirementPage` now also renders three `<canvas>`-backed charts plus a projection panel; chart `Chart` instances stored on `app._retireBalanceChart`, `app._retireContributionChart`, `app._retireBreakdownChart` (destroyed/recreated on every render, matching `reportsNetWorth.js`'s convention).

- [ ] **Step 1: Extend the page template with chart containers and a projection panel**

In `src/retirement.js`, in `renderRetirementPage`, replace the `container.innerHTML` template (from Task 6 Step 5) to add chart/projection markup after `retire-cards`:
```javascript
    container.innerHTML = `
        <div class="page-header-row"><h2>🏛️ Retirement</h2></div>
        <div class="retire-target-date-row form-group">
            <label for="retirementTargetDateInput">Target Retirement Date</label>
            <input type="date" id="retirementTargetDateInput" value="${app.retirementTargetDate || ''}">
        </div>
        <div class="retire-cards">${accounts.map(a => renderAccountCard(app, a)).join('')}</div>
        <div class="rpt-charts-row">
            <div class="rpt-chart-card">
                <h4 class="rpt-chart-title">Balance Over Time</h4>
                <p class="rpt-chart-sub">Logged balance per retirement account</p>
                <div class="rpt-chart-canvas-wrap"><canvas id="retireBalanceChart"></canvas></div>
            </div>
            <div class="rpt-chart-card">
                <h4 class="rpt-chart-title">Contribution vs. Growth</h4>
                <p class="rpt-chart-sub">Per period, summed across all retirement accounts (growth includes any employer match, since match amounts aren't logged separately)</p>
                <div class="rpt-chart-canvas-wrap"><canvas id="retireContributionChart"></canvas></div>
            </div>
            <div class="rpt-chart-card">
                <h4 class="rpt-chart-title">Current Balance by Account</h4>
                <p class="rpt-chart-sub">Share of total retirement balance</p>
                <div class="rpt-chart-canvas-wrap"><canvas id="retireBreakdownChart"></canvas></div>
            </div>
        </div>
        <div class="retire-card" id="retireProjectionPanel"></div>
    `;
```

- [ ] **Step 2: Add chart-rendering functions**

Add to the top of `src/retirement.js`:
```javascript
import { splitGrowthFromContribution } from './retirementCalculator.js';
import { renderChartDataTable } from './utils.js';
```

Append these functions (called from `renderRetirementPage`, added in Step 3):
```javascript
function destroyChart(app, key) {
    if (app[key]) { app[key].destroy(); app[key] = null; }
}

function isDarkMode() { return document.body.classList.contains('dark-mode'); }

function chartColors() {
    const dark = isDarkMode();
    return { grid: dark ? '#374151' : '#e5e7eb', label: dark ? '#d1d5db' : '#374151' };
}

const ACCOUNT_LINE_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2'];

function renderBalanceChart(app, accounts) {
    const canvas = document.getElementById('retireBalanceChart');
    if (!canvas) return;
    destroyChart(app, '_retireBalanceChart');

    const allDates = [...new Set(accounts.flatMap(a => getSnapshotsForAccount(app, a.id).map(s => s.date)))].sort();
    if (allDates.length === 0) return;

    const { grid, label } = chartColors();
    const datasets = accounts.map((a, i) => {
        const byDate = Object.fromEntries(getSnapshotsForAccount(app, a.id).map(s => [s.date, s.balance]));
        return {
            label: a.name,
            data: allDates.map(d => byDate[d] ?? null),
            borderColor: ACCOUNT_LINE_COLORS[i % ACCOUNT_LINE_COLORS.length],
            spanGaps: true,
            tension: 0.3,
            pointRadius: 3
        };
    });

    app._retireBalanceChart = new Chart(canvas, {
        type: 'line',
        data: { labels: allDates, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { color: label } }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}` } } },
            scales: { y: { ticks: { color: label, callback: v => formatCurrency(v) }, grid: { color: grid } }, x: { ticks: { color: label }, grid: { color: grid } } }
        }
    });

    renderChartDataTable('retireBalanceChart', {
        caption: 'Retirement account balances over time',
        columns: ['Date', ...accounts.map(a => a.name)],
        rows: allDates.map((d, i) => [d, ...datasets.map(ds => ds.data[i] != null ? formatCurrency(ds.data[i]) : '—')])
    });
}

function renderContributionChart(app, accounts) {
    const canvas = document.getElementById('retireContributionChart');
    if (!canvas) return;
    destroyChart(app, '_retireContributionChart');

    const byDate = new Map();
    for (const account of accounts) {
        const split = splitGrowthFromContribution(getSnapshotsForAccount(app, account.id));
        for (const row of split) {
            const entry = byDate.get(row.date) || { contribution: 0, growth: 0 };
            entry.contribution += row.contribution;
            entry.growth += row.growth;
            byDate.set(row.date, entry);
        }
    }
    const dates = [...byDate.keys()].sort();
    if (dates.length === 0) return;

    const { grid, label } = chartColors();
    const contributionData = dates.map(d => byDate.get(d).contribution);
    const growthData = dates.map(d => byDate.get(d).growth);

    app._retireContributionChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: dates,
            datasets: [
                { label: 'Contribution', data: contributionData, backgroundColor: '#2563eb', stack: 's', borderRadius: 4 },
                { label: 'Growth', data: growthData, backgroundColor: '#10b981', stack: 's', borderRadius: 4 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { color: label } }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}` } } },
            scales: { y: { stacked: true, ticks: { color: label, callback: v => formatCurrency(v) }, grid: { color: grid } }, x: { stacked: true, ticks: { color: label }, grid: { color: grid } } }
        }
    });

    renderChartDataTable('retireContributionChart', {
        caption: 'Contribution vs. growth per period, summed across retirement accounts',
        columns: ['Date', 'Contribution', 'Growth'],
        rows: dates.map((d, i) => [d, formatCurrency(contributionData[i]), formatCurrency(growthData[i])])
    });
}

function renderBreakdownChart(app, accounts) {
    const canvas = document.getElementById('retireBreakdownChart');
    if (!canvas) return;
    destroyChart(app, '_retireBreakdownChart');

    const balances = accounts.map(a => {
        const snaps = getSnapshotsForAccount(app, a.id);
        return snaps.length > 0 ? snaps[snaps.length - 1].balance : (Number(a.startingBalance) || 0);
    });
    if (balances.every(b => b <= 0)) return;

    const { label } = chartColors();
    app._retireBreakdownChart = new Chart(canvas, {
        type: 'doughnut',
        data: { labels: accounts.map(a => a.name), datasets: [{ data: balances, backgroundColor: ACCOUNT_LINE_COLORS }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: label } }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatCurrency(ctx.parsed)}` } } }
        }
    });

    renderChartDataTable('retireBreakdownChart', {
        caption: 'Current retirement balance by account',
        columns: ['Account', 'Balance'],
        rows: accounts.map((a, i) => [a.name, formatCurrency(balances[i])])
    });
}

function renderProjectionPanel(app, accounts) {
    const panel = document.getElementById('retireProjectionPanel');
    if (!panel) return;

    if (!app.retirementTargetDate) {
        panel.innerHTML = `<p class="retire-empty-msg">Set a target retirement date above to see a projected future value.</p>`;
        return;
    }

    const rows = accounts.map(a => {
        const projected = app.computeAccountProjection(a.id);
        return `<div class="acct-balance-item"><span class="acct-balance-label">${escapeHtml(a.name)}</span><span class="acct-balance-value">${formatCurrency(projected)}</span></div>`;
    });
    const total = accounts.reduce((sum, a) => sum + (app.computeAccountProjection(a.id) || 0), 0);

    panel.innerHTML = `
        <h4 class="rpt-chart-title">Projected Value at ${escapeHtml(app.retirementTargetDate)}</h4>
        <p class="rpt-chart-sub">Assumes each account's rate of return compounds monthly and its most recently logged contribution (plus employer match) recurs every month until then.</p>
        <div class="acct-balances">${rows.join('')}</div>
        <div class="acct-balance-item"><span class="acct-balance-label">Combined Total</span><span class="acct-balance-value">${formatCurrency(total)}</span></div>
    `;
}
```

- [ ] **Step 3: Call the new render functions from `renderRetirementPage`**

At the end of `renderRetirementPage` (after the `container.onclick = ...` block from Task 6), add:
```javascript
    renderBalanceChart(app, accounts);
    renderContributionChart(app, accounts);
    renderBreakdownChart(app, accounts);
    renderProjectionPanel(app, accounts);
```

- [ ] **Step 4: Add app state fields for the chart instances**

In `src/app.js` constructor, alongside `this.retirementSnapshots = [];`:
```javascript
        this._retireBalanceChart = null;
        this._retireContributionChart = null;
        this._retireBreakdownChart = null;
```

- [ ] **Step 5: Manual verification**

```bash
python -m http.server 32900
```
Add a Retirement account, log 2-3 snapshots with different dates/balances/contributions, navigate to the Retirement page, verify all three charts render with data, set a target date, verify the projection panel shows a number for the account and the combined total.

- [ ] **Step 6: Commit**

```bash
git add src/retirement.js src/app.js
git commit -m "feat: add balance/contribution/breakdown charts and projection panel to Retirement page"
```

---

### Task 8: Local/session storage export, import, and clear wiring

**Files:**
- Modify: `src/dataExport.js` (`exportAllJSON`, `importAllJSON`)
- Modify: `src/storage.js` (`saveToStorage`, `loadFromStorage`, `clearAllData` — local/session branches only; Postgres branch is Task 14)
- Test: `tests/features/test_retirement.py` (create the file; Task 10 fills it out fully, but add the export/import round-trip test here since it belongs with this task's deliverable)

**Interfaces:**
- Consumes: `sanitizeParsedState` (Task 4), `app.retirementSnapshots`/`app.retirementTargetDate` (Task 5).
- Produces: retirement data survives export→import and reload, for local/session backends.

- [ ] **Step 1: Write the failing export/import test**

Create `tests/features/test_retirement.py`:
```python
#!/usr/bin/env python3
"""
Retirement Accounts Dashboard tests (issue: retirement accounts + charts).
Covers the account type/fields, snapshot logging, charts, projection, and
export/import round-trip for the local/session storage backends.
"""

import json
import pytest

from tests.conftest import assert_no_errors


def _add_retirement_account(page, name="401k Test", rate="7", match="50"):
    page.click('button[data-page="accounts"]')
    page.fill('#accountName', name)
    page.select_option('#accountType', 'Retirement')
    page.fill('#accountStartingBalance', '10000')
    page.fill('#accountRateOfReturn', rate)
    page.fill('#accountEmployerMatch', match)
    page.click('#accountFormSubmit')
    page.wait_for_selector(f'text={name}', timeout=10000)


@pytest.mark.feature
def test_export_then_import_round_trips_retirement_data(app_page):
    """Exporting and re-importing preserves retirement accounts, snapshots, and target date."""
    page = app_page
    _add_retirement_account(page)

    account_id = page.evaluate("() => window.app.accounts.find(a => a.type === 'Retirement').id")
    page.evaluate(f"() => window.app.addRetirementSnapshot({account_id}, '2026-01-01', 10500, 300)")
    page.evaluate("() => { window.app.retirementTargetDate = '2050-01-01'; window.app.saveToStorage(); }")

    exported = page.evaluate("""
        () => {
            const data = {
                version: window.app.constructor.name,
                accounts: window.app.accounts,
                debts: window.app.debts,
                retirementSnapshots: window.app.retirementSnapshots,
                retirementTargetDate: window.app.retirementTargetDate
            };
            return JSON.stringify(data);
        }
    """)

    # Clear in-memory state, then import the exported JSON back in.
    page.evaluate("""
        () => { window.app.accounts = []; window.app.retirementSnapshots = []; window.app.retirementTargetDate = null; }
    """)

    import_result = page.evaluate(
        """(json) => {
            return new Promise((resolve) => {
                const blob = new Blob([json], { type: 'application/json' });
                const file = new File([blob], 'backup.json', { type: 'application/json' });
                window.app.importFromJSON = window.app.importFromJSON || null;
                import('/src/dataExport.js').then(({ importAllJSON }) => {
                    importAllJSON(window.app, file, {
                        requestImportMode: async () => true,
                        onImported: () => resolve('imported'),
                        onNoData: () => resolve('no-data'),
                        onInvalidJSON: () => resolve('invalid')
                    });
                });
            });
        }""",
        exported
    )
    assert import_result == "imported"

    page.wait_for_timeout(300)
    restored_snapshots = page.evaluate("() => window.app.retirementSnapshots")
    restored_target = page.evaluate("() => window.app.retirementTargetDate")
    assert len(restored_snapshots) == 1
    assert restored_snapshots[0]["balance"] == 10500
    assert restored_target == "2050-01-01"
    assert_no_errors(page)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/features/test_retirement.py -v`
Expected: FAIL — `retirementSnapshots`/`retirementTargetDate` not in the exported/imported payload (the import handler drops unrecognized keys since `exportAllJSON`/`importAllJSON` don't reference them yet).

- [ ] **Step 3: Wire `exportAllJSON`**

In `src/dataExport.js`, in the `payload` object (around line 26-61), add two lines after `planHistory: app.planHistory || [],`:
```javascript
        retirementSnapshots: app.retirementSnapshots || [],
        retirementTargetDate: app.retirementTargetDate || null,
```

- [ ] **Step 4: Wire `importAllJSON`**

In `src/dataExport.js`'s `importAllJSON`, add alongside the other `incoming*` declarations (around line 289-293):
```javascript
        const incomingRetirementSnapshots = clean.retirementSnapshots;
        const incomingRetirementTargetDate = clean.retirementTargetDate;
```
Add to the `hasData` check (around line 302-309):
```javascript
            || incomingRetirementSnapshots.length > 0 || !!incomingRetirementTargetDate
```
Add to the `parts` summary list (around line 315-322), after the recurring-templates line:
```javascript
        if (incomingRetirementSnapshots.length) parts.push(`${incomingRetirementSnapshots.length} retirement snapshot(s)`);
```
In the `shouldReplace` branch (around line 355-383, the non-Postgres local branch), add:
```javascript
            app.retirementSnapshots = incomingRetirementSnapshots.map((s, i) => ({ ...s, id: Date.now() + 6500 + i }));
            app.retirementTargetDate = incomingRetirementTargetDate || null;
```
In the merge (`else`) branch (around line 384-431), add:
```javascript
            app.retirementSnapshots = [...app.retirementSnapshots, ...incomingRetirementSnapshots.map((s, i) => ({ ...s, id: Date.now() + 6500 + i }))];
            if (incomingRetirementTargetDate) app.retirementTargetDate = incomingRetirementTargetDate;
```

- [ ] **Step 5: Wire `storage.js`'s local/session `saveToStorage`/`loadFromStorage`/`clearAllData`**

In `src/storage.js`'s `saveToStorage`, in the local/session `data` object (around line 145-177), add:
```javascript
            retirementSnapshots: app.retirementSnapshots || [],
            retirementTargetDate: app.retirementTargetDate || null,
```
In `loadFromStorage` (around line 201-235), add:
```javascript
            app.retirementSnapshots = clean.retirementSnapshots;
            app.retirementTargetDate = clean.retirementTargetDate;
```
In `clearAllData` (around line 305-318), add:
```javascript
    app.retirementSnapshots = [];
    app.retirementTargetDate = null;
```

- [ ] **Step 6: Run test to verify it passes**

Requires the app server running:
```bash
python -m http.server 32900
```
In another terminal:
```bash
pytest tests/features/test_retirement.py -v
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/dataExport.js src/storage.js tests/features/test_retirement.py
git commit -m "feat: wire retirement data into local/session export, import, and clear"
```

---

### Task 9: Full Playwright coverage for the Retirement page

**Files:**
- Modify: `tests/features/test_retirement.py` (add to the file created in Task 8)

**Interfaces:**
- Consumes: everything built in Tasks 1-8. No new production code — this task is pure test coverage.

- [ ] **Step 1: Add UI/CRUD/chart/empty-state tests**

Append to `tests/features/test_retirement.py`:
```python
@pytest.mark.feature
def test_retirement_account_shows_conditional_fields(app_page):
    """Selecting Retirement in the account type dropdown reveals subtype/rate/match fields."""
    page = app_page
    page.click('button[data-page="accounts"]')
    assert page.is_hidden('#accountRateOfReturnGroup')
    page.select_option('#accountType', 'Retirement')
    assert page.is_visible('#accountRateOfReturnGroup')
    assert page.is_visible('#accountRetirementFieldsGroup')
    assert page.is_visible('#accountEmployerMatchGroup')
    page.select_option('#accountType', 'Checking')
    assert page.is_hidden('#accountRateOfReturnGroup')
    assert_no_errors(page)


@pytest.mark.feature
def test_retirement_page_empty_state_links_to_accounts(app_page):
    """With no retirement accounts, the Retirement page prompts to add one."""
    page = app_page
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('text=No retirement accounts yet', timeout=5000)
    page.click('[data-retire-action="goto-accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)
    assert_no_errors(page)


@pytest.mark.feature
def test_add_and_delete_snapshot_via_modal(app_page):
    """Add Snapshot modal creates a row; Delete removes it."""
    page = app_page
    _add_retirement_account(page)
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('.retire-card', timeout=5000)

    page.click('[data-retire-action="add-snapshot"]')
    page.wait_for_selector('#retirementSnapshotModal.flex-visible', timeout=5000)
    page.fill('#retirementSnapshotModalBalance', '11000')
    page.fill('#retirementSnapshotModalContribution', '400')
    page.click('#retirementSnapshotModalConfirmBtn')
    page.wait_for_selector('#retirementSnapshotModal.hidden', timeout=5000)

    row_count = page.evaluate("() => document.querySelectorAll('.retire-snapshot-table tbody tr').length")
    assert row_count == 1

    page.click('[data-retire-action="delete-snapshot"]')
    page.wait_for_timeout(300)
    snapshots = page.evaluate("() => window.app.retirementSnapshots")
    assert snapshots == []
    assert_no_errors(page)


@pytest.mark.feature
def test_charts_render_with_two_snapshots(app_page):
    """Balance, contribution, and breakdown charts render canvases once data exists."""
    page = app_page
    _add_retirement_account(page)
    account_id = page.evaluate("() => window.app.accounts.find(a => a.type === 'Retirement').id")
    page.evaluate(f"() => window.app.addRetirementSnapshot({account_id}, '2026-01-01', 10000, 300)")
    page.evaluate(f"() => window.app.addRetirementSnapshot({account_id}, '2026-02-01', 10500, 300)")
    page.click('button[data-page="retirement"]')
    page.wait_for_timeout(300)

    for canvas_id in ['retireBalanceChart', 'retireContributionChart', 'retireBreakdownChart']:
        assert page.locator(f'#{canvas_id}').count() == 1, f'{canvas_id} did not render'
        sr_rows = page.evaluate(f"() => document.querySelectorAll('#{canvas_id}-sr-table tbody tr').length")
        assert sr_rows > 0, f'{canvas_id} has no accessible data table rows'
    assert_no_errors(page)


@pytest.mark.feature
def test_projection_panel_requires_target_date(app_page):
    """Projection panel prompts for a target date until one is set, then shows a number."""
    page = app_page
    _add_retirement_account(page)
    account_id = page.evaluate("() => window.app.accounts.find(a => a.type === 'Retirement').id")
    page.evaluate(f"() => window.app.addRetirementSnapshot({account_id}, '2026-01-01', 10000, 300)")
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('text=Set a target retirement date', timeout=5000)

    page.fill('#retirementTargetDateInput', '2050-01-01')
    page.dispatch_event('#retirementTargetDateInput', 'change')
    page.wait_for_selector('text=Combined Total', timeout=5000)
    assert_no_errors(page)


@pytest.mark.feature
def test_reload_persists_retirement_data(app_page):
    """Retirement account, snapshot, and target date survive a page reload (localStorage)."""
    page = app_page
    _add_retirement_account(page)
    account_id = page.evaluate("() => window.app.accounts.find(a => a.type === 'Retirement').id")
    page.evaluate(f"() => window.app.addRetirementSnapshot({account_id}, '2026-01-01', 10000, 300)")
    page.evaluate("() => { window.app.retirementTargetDate = '2050-01-01'; window.app.saveToStorage(); }")

    page.reload(wait_until="networkidle")
    page.wait_for_timeout(500)
    snapshots = page.evaluate("() => window.app.retirementSnapshots")
    target = page.evaluate("() => window.app.retirementTargetDate")
    assert len(snapshots) == 1
    assert target == "2050-01-01"
    assert_no_errors(page)
```

- [ ] **Step 2: Run the full new test file**

```bash
python -m http.server 32900
```
```bash
pytest tests/features/test_retirement.py -v
```
Expected: PASS (all tests, including the Task 8 export/import test)

- [ ] **Step 3: Run the full existing suite to check for regressions**

```bash
pytest tests/ -v -m "not slow"
```
Expected: PASS — no regressions in Accounts, Reports, or export/import tests.

- [ ] **Step 4: Commit**

```bash
git add tests/features/test_retirement.py
git commit -m "test: add full Playwright coverage for the Retirement page"
```

---

### Task 10: Server migration — account fields, retirement_snapshots table, plan_settings column

**Files:**
- Create: `server/migrations/1755600000009_add-retirement-fields.js`
- Test: `server/test/migrations.test.js`

**Interfaces:**
- Produces: `accounts.retirement_subtype` (text, CHECK constraint), `accounts.rate_of_return` (numeric), `accounts.employer_match_percent` (numeric); new `retirement_snapshots` table (`id`, `user_id`, `account_id`, `date`, `balance`, `contribution`); `plan_settings.retirement_target_date` (date). Task 12 (route) and Task 13 (tests) depend on these exact column names.

- [ ] **Step 1: Write the failing migration test**

Add to `server/test/migrations.test.js`, extend the `expectedIndexedColumns` object (in the `'every user_id/account_id FK column has an index'` test) to include:
```javascript
        retirement_snapshots: ['user_id', 'account_id']
```
Add a new test at the end of the file:
```javascript
test('accounts.retirement_subtype rejects a value outside the allow-list', async () => {
    await resetDb();
    const user = await createTestUser();
    await assert.rejects(
        pool.query(
            "INSERT INTO accounts (user_id, name, retirement_subtype) VALUES ($1, 'x', 'bogus')",
            [user.id]
        ),
        /violates check constraint "accounts_retirement_subtype_check"/
    );
});

test('plan_settings accepts a retirement_target_date', async () => {
    await resetDb();
    const user = await createTestUser();
    await pool.query('INSERT INTO plan_settings (user_id) VALUES ($1)', [user.id]);
    await pool.query('UPDATE plan_settings SET retirement_target_date = $1 WHERE user_id = $2', ['2050-01-01', user.id]);
    const { rows } = await pool.query('SELECT retirement_target_date FROM plan_settings WHERE user_id = $1', [user.id]);
    assert.equal(rows[0].retirement_target_date.toISOString().slice(0, 10), '2050-01-01');
});
```

- [ ] **Step 2: Run test to verify it fails**

Requires the Postgres test stack running (see `server/README.md` / `docker-compose.yml` for the test database). Run:
```bash
cd server && npm test -- migrations.test.js
```
Expected: FAIL — `retirement_snapshots` table / `retirement_subtype` column / `retirement_target_date` column don't exist yet.

- [ ] **Step 3: Write the migration**

Create `server/migrations/1755600000009_add-retirement-fields.js`:
```javascript
export const shorthands = undefined;

export async function up(pgm) {
    pgm.sql(`
        ALTER TABLE accounts
            ADD COLUMN retirement_subtype text NOT NULL DEFAULT 'Other',
            ADD COLUMN rate_of_return numeric NOT NULL DEFAULT 0,
            ADD COLUMN employer_match_percent numeric NOT NULL DEFAULT 0;

        ALTER TABLE accounts
            ADD CONSTRAINT accounts_retirement_subtype_check
                CHECK (retirement_subtype IN ('401k', 'Traditional IRA', 'Roth IRA', 'HSA', 'Other'));

        CREATE TABLE retirement_snapshots (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            date date NOT NULL,
            balance numeric NOT NULL DEFAULT 0,
            contribution numeric NOT NULL DEFAULT 0
        );

        CREATE INDEX idx_retirement_snapshots_user_id ON retirement_snapshots (user_id);
        CREATE INDEX idx_retirement_snapshots_account_id ON retirement_snapshots (account_id);

        ALTER TABLE plan_settings ADD COLUMN retirement_target_date date;
    `);
}

export async function down(pgm) {
    pgm.sql(`
        ALTER TABLE plan_settings DROP COLUMN retirement_target_date;
        DROP TABLE retirement_snapshots;
        ALTER TABLE accounts DROP CONSTRAINT accounts_retirement_subtype_check;
        ALTER TABLE accounts
            DROP COLUMN retirement_subtype,
            DROP COLUMN rate_of_return,
            DROP COLUMN employer_match_percent;
    `);
}
```

- [ ] **Step 4: Run migrations and re-run the test**

```bash
cd server && npm run migrate up
npm test -- migrations.test.js
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/migrations/1755600000009_add-retirement-fields.js server/test/migrations.test.js
git commit -m "feat: add retirement fields/table migration"
```

---

### Task 11: Server route — accounts columns, retirement-snapshots CRUD, plan-settings field

**Files:**
- Modify: `server/src/routes/accounts.js`
- Create: `server/src/routes/retirementSnapshots.js`
- Modify: `server/src/app.js` (route registration)
- Modify: `server/src/routes/planSettings.js` (`rowToJson`, PATCH handler)

**Interfaces:**
- Consumes: `sanitizeAccount`, `sanitizeRetirementSnapshot` (both re-exported from `src/sanitizers.js` via `server/src/sanitizers/index.js`'s `export *`), `createCrudResource` (`server/src/crudRouter.js`), `sanitizeDateISO` (`src/utils.js`, same re-export path).
- Produces: `GET/POST/PATCH/DELETE /api/retirement-snapshots(/:id)`; `GET/PATCH /api/plan-settings` now includes `retirementTargetDate`.

- [ ] **Step 1: Update the accounts route's column map**

In `server/src/routes/accounts.js`, update the `columns` object:
```javascript
import { createCrudResource } from '../crudRouter.js';
import { sanitizeAccount } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'accounts',
    sanitize: sanitizeAccount,
    requiredFields: ['name'],
    columns: {
        id: 'id',
        name: 'name',
        type: 'type',
        startingBalance: 'starting_balance',
        interestRate: 'interest_rate',
        retirementSubtype: 'retirement_subtype',
        rateOfReturn: 'rate_of_return',
        employerMatchPercent: 'employer_match_percent'
    }
});
```

- [ ] **Step 2: Create the retirement-snapshots route**

Create `server/src/routes/retirementSnapshots.js`:
```javascript
import { createCrudResource } from '../crudRouter.js';
import { sanitizeRetirementSnapshot } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'retirement_snapshots',
    sanitize: sanitizeRetirementSnapshot,
    requiredFields: ['accountId'],
    foreignKeys: { accountId: 'accounts' },
    columns: {
        id: 'id',
        accountId: 'account_id',
        date: 'date',
        balance: 'balance',
        contribution: 'contribution'
    }
});
```

- [ ] **Step 3: Register the route**

In `server/src/app.js`, add the import near the other route imports (after `planHistoryRouter`):
```javascript
import retirementSnapshotsRouter from './routes/retirementSnapshots.js';
```
Add the mount near `api.use('/plan-history', planHistoryRouter);`:
```javascript
    api.use('/retirement-snapshots', retirementSnapshotsRouter);
```

- [ ] **Step 4: Add `retirementTargetDate` to plan-settings**

In `server/src/routes/planSettings.js`:
- Add the import: `import { normalizeText, sanitizeFiniteNumber, sanitizeInteger, sanitizeDateISO } from '../sanitizers/index.js';` (extend the existing import line).
- In `rowToJson` (around line 10-19), add:
```javascript
        retirementTargetDate: row.retirement_target_date ? row.retirement_target_date.toISOString().slice(0, 10) : null,
```
- In the PATCH handler (around line 45-87), add after the `forecastSettings` line:
```javascript
        const retirementTargetDate = body.retirementTargetDate === undefined ? undefined : sanitizeDateISO(body.retirementTargetDate);
```
and in the `sets`/`values` building block, add:
```javascript
        if (retirementTargetDate !== undefined) { values.push(retirementTargetDate); sets.push(`retirement_target_date = $${values.length}`); }
```

- [ ] **Step 5: Manual verification**

Requires the docker-compose Postgres stack running (`docker compose up -d` from repo root, or however `server/README.md` describes local dev). With the server running:
```bash
curl -c cookies.txt -X POST http://localhost:PORT/auth/login -H 'Content-Type: application/json' -d '{"email":"...","password":"..."}'
curl -b cookies.txt http://localhost:PORT/api/plan-settings
```
Confirm the response includes `"retirementTargetDate": null`.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/accounts.js server/src/routes/retirementSnapshots.js server/src/app.js server/src/routes/planSettings.js
git commit -m "feat: add server routes for retirement account fields and snapshots"
```

---

### Task 12: Server-side tests — CRUD resource, plan-settings field

**Files:**
- Modify: `server/test/crudResources.test.js`
- Modify: `server/test/planSettings.test.js`

**Interfaces:**
- Consumes: Task 10 (migration) and Task 11 (route) must both be applied for these tests to pass.

- [ ] **Step 1: Add the retirement-snapshots case to the shared CRUD test loop**

In `server/test/crudResources.test.js`, add a new entry to the `cases` array (after `reconciliations`):
```javascript
    {
        path: '/api/retirement-snapshots',
        validPayload: () => ({ accountId, date: '2026-01-01', balance: 10000, contribution: 300 }),
        updatePayload: { balance: 10500 },
        updatedField: 'balance',
        updatedValue: 10500,
        invalidPayload: () => ({ date: '2026-01-01' })
    },
```

- [ ] **Step 2: Run test to verify it passes (this is coverage for already-built code, so no red step)**

```bash
cd server && npm test -- crudResources.test.js
```
Expected: PASS (all four generated tests for `/api/retirement-snapshots`: round trip, missing-field rejection, cross-user isolation, IDOR rejection)

If it fails, re-check Task 10's migration ran and Task 11's route/column names match exactly.

- [ ] **Step 3: Add plan-settings retirementTargetDate test**

Add to `server/test/planSettings.test.js`:
```javascript
test('PATCH accepts and persists retirementTargetDate', async () => {
    await fetch(`${baseUrl}/api/plan-settings`, {
        method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify({ retirementTargetDate: '2050-01-01' })
    });
    const res = await fetch(`${baseUrl}/api/plan-settings`, { headers: { Cookie: cookies } });
    const body = await res.json();
    assert.equal(body.retirementTargetDate, '2050-01-01');
});
```

- [ ] **Step 4: Run to verify**

```bash
cd server && npm test -- planSettings.test.js
```
Expected: PASS

- [ ] **Step 5: Run the full server test suite for regressions**

```bash
cd server && npm test
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/test/crudResources.test.js server/test/planSettings.test.js
git commit -m "test: add server-side coverage for retirement snapshots and target date"
```

---

### Task 13: Frontend Postgres sync wiring

**Files:**
- Modify: `src/postgresSync.js` (`ALL_RESOURCE_PATHS`, `DEFAULT_PLAN_SETTINGS`)
- Modify: `src/storage.js` (`POSTGRES_RESOURCE_ENDPOINTS`, `loadFromPostgres`, `saveToStorage`'s Postgres branch)
- Modify: `src/postgresImport.js` (`CRUD_RESOURCES`, `snapshotAppState`, `snapshotToPostData`, `postAllResources`'s and `mergeForPostgres`'s PATCH bodies, `applyResultsToApp`, the merge-failure rollback `Object.assign`)

**Interfaces:**
- Consumes: `/api/retirement-snapshots` (Task 11), `retirementTargetDate` on `/api/plan-settings` (Task 11).
- Produces: `app.retirementSnapshots`/`app.retirementTargetDate` now round-trip correctly for the Postgres storage backend — load, save, export/import (replace and merge), and `clearAllData`.

- [ ] **Step 1: `postgresSync.js`**

Add `/api/retirement-snapshots` to `ALL_RESOURCE_PATHS` (`src/postgresSync.js:5-21`), after `/api/plan-history`:
```javascript
    '/api/retirement-snapshots',
```
Add `retirementTargetDate: null` to `DEFAULT_PLAN_SETTINGS` (`src/postgresSync.js:71-77`):
```javascript
const DEFAULT_PLAN_SETTINGS = {
    strategy: null,
    monthlyPayment: null,
    perMonthStimulus: [],
    ledgerSettings: { accountFilter: 'all', dateRange: 'all', sortKey: 'date', sortDir: 'desc' },
    forecastSettings: { rangeMonths: 1, accountId: 'total', notableThresholdPct: 130 },
    retirementTargetDate: null
};
```

- [ ] **Step 2: `storage.js`**

Add to `POSTGRES_RESOURCE_ENDPOINTS` (`src/storage.js:47-59`):
```javascript
    retirementSnapshots: '/api/retirement-snapshots'
```
In `loadFromPostgres` (`src/storage.js:61-92`), add after `app._forecastNotableThresholdPct = ...`:
```javascript
    app.retirementTargetDate = planSettings.retirementTargetDate ?? null;
```
(`app.retirementSnapshots` is already populated automatically by the existing `entries.forEach(([field], i) => { app[field] = lists[i]; });` loop, since it now iterates `POSTGRES_RESOURCE_ENDPOINTS` including the new `retirementSnapshots` key — no separate line needed.)

In `saveToStorage`'s Postgres branch (`src/storage.js:116-143`), add to the PATCH body:
```javascript
                retirementTargetDate: app.retirementTargetDate || null,
```

- [ ] **Step 3: `postgresImport.js`**

Add to `CRUD_RESOURCES` (`src/postgresImport.js:7-18`):
```javascript
    { field: 'retirementSnapshots',   path: '/api/retirement-snapshots' },
```
(`remapFk` already remaps `accountId` generically, so `retirementSnapshots` records get their `accountId` remapped for free during both replace and merge import.)

Add to `snapshotAppState` (`src/postgresImport.js:50-84`):
```javascript
        retirementSnapshots:   (app.retirementSnapshots || []).map(r => ({ ...r })),
```
and:
```javascript
        retirementTargetDate:  app.retirementTargetDate ?? null,
```

Add to `snapshotToPostData` (`src/postgresImport.js:182-206`):
```javascript
        retirementSnapshots:   snapshot.retirementSnapshots,
```
and:
```javascript
        retirementTargetDate:  snapshot.retirementTargetDate,
```

In `postAllResources`'s plan-settings PATCH call (`src/postgresImport.js:134-140`), add:
```javascript
        retirementTargetDate: data.retirementTargetDate ?? null
```

In `applyResultsToApp` (`src/postgresImport.js:146-177`), add after `app._savedStrategy = ...`:
```javascript
    app.retirementTargetDate = data.retirementTargetDate ?? null;
```
(`app.retirementSnapshots` is populated automatically by the existing `CRUD_RESOURCES.forEach` loop.)

In `mergeForPostgres`'s plan-settings section (`src/postgresImport.js:346-367`), add:
```javascript
        if (clean.retirementTargetDate) app.retirementTargetDate = clean.retirementTargetDate;
```
and add `retirementTargetDate: app.retirementTargetDate,` to its trailing `apiFetch('PATCH', '/api/plan-settings', {...})` body.

In `mergeForPostgres`'s failure-path `Object.assign` rollback (`src/postgresImport.js:372-399`), add:
```javascript
            retirementSnapshots:  snapshot.retirementSnapshots,
            retirementTargetDate: snapshot.retirementTargetDate,
```

- [ ] **Step 4: Manual verification**

Requires the docker-compose Postgres stack. Log in, add a Retirement account and a snapshot, set a target date, reload — confirm all three persist. Export JSON, clear data, import back — confirm restored. This overlaps with Task 14's automated coverage; a quick manual pass here is enough before writing the automated test.

- [ ] **Step 5: Commit**

```bash
git add src/postgresSync.js src/storage.js src/postgresImport.js
git commit -m "feat: wire retirement snapshots and target date into Postgres sync/import"
```

---

### Task 14: Postgres integration smoke test

**Files:**
- Modify: `tests/postgres/test_postgres_mutations.py`

**Interfaces:**
- Consumes: Tasks 10-13, and the existing `pg_page`/`base_url`/`credentials` fixtures from `tests/postgres/conftest.py`.

- [ ] **Step 1: Add a smoke test following the existing `test_bill_add_persists` pattern (API-based, since there's a UI form but API POST + reload is simpler and consistent with the file's other resource-without-dedicated-CRUD-UI tests)**

Add to `tests/postgres/test_postgres_mutations.py`, near `test_reconciliation_add_persists`:
```python
async def test_retirement_snapshot_add_persists(pg_page, base_url, credentials):
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)
    account = await _ensure_account(pg_page, base_url)

    r = await _api_post(pg_page, base_url, '/api/retirement-snapshots', {
        'accountId': account['id'], 'date': '2026-01-01', 'balance': 10000, 'contribution': 300
    })
    assert r.status == 201, f'Retirement snapshot POST failed: {await r.text()}. Console: {logs}'
    snapshot_id = (await r.json())['id']

    await pg_page.reload()
    await _wait_for_app_ready(pg_page)
    snapshots = await (await _api_get(pg_page, base_url, '/api/retirement-snapshots')).json()
    assert any(s['id'] == snapshot_id for s in snapshots), f'Retirement snapshot not persisted. Console: {logs}'

    # Cleanup
    await _api_delete(pg_page, base_url, f'/api/retirement-snapshots/{snapshot_id}')


async def test_retirement_target_date_persists(pg_page, base_url, credentials):
    logs = _capture_console(pg_page)
    await _login(pg_page, base_url, credentials)

    async with pg_page.expect_response(
        lambda r: '/api/plan-settings' in r.url and r.request.method == 'PATCH',
        timeout=8000
    ):
        await pg_page.evaluate("""
            () => { window.app.retirementTargetDate = '2050-01-01'; window.app.saveToStorage(); }
        """)

    await pg_page.reload()
    await _wait_for_app_ready(pg_page)
    target = await pg_page.evaluate("() => window.app.retirementTargetDate")
    assert target == '2050-01-01', f'Target date not persisted. Console: {logs}'
```

- [ ] **Step 2: Run against the docker-compose Postgres stack**

```bash
docker compose up -d
pytest tests/postgres/test_postgres_mutations.py -v -k retirement
```
Expected: PASS

- [ ] **Step 3: Run the full Postgres suite for regressions**

```bash
pytest tests/postgres/ -v
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/postgres/test_postgres_mutations.py
git commit -m "test: add Postgres integration smoke tests for retirement snapshots/target date"
```

---

### Task 15: Documentation and version bump

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`
- Modify: `src/utils.js` (`APP_VERSION`)
- Modify: `sw.js` (`CACHE_NAME`)

**Interfaces:**
- Consumes: nothing (documentation only) — but this task must run last, after every other task's tests are green, since `tests/features/test_versioning.py` checks `APP_VERSION`/`CHANGELOG.md` stay in sync and a premature bump would make earlier tasks' partial states inconsistent with the changelog.

- [ ] **Step 1: Run the full test suite once more to confirm everything from Tasks 1-14 is green**

```bash
python -m http.server 32900
```
```bash
pytest tests/ -v -m "not slow"
npm run test:unit
cd server && npm test
```
Expected: all PASS. Do not proceed until this is true.

- [ ] **Step 2: Add a CLAUDE.md bullet**

In `CLAUDE.md`'s "Cross-cutting features" section, add a new bullet (after the Email notifications bullet, following the same style — bold feature name, plain-language description, key files/functions named):
```markdown
- **Retirement accounts dashboard** — a `Retirement` account type (`src/accounts.js` `ACCT_TYPES`) with a subtype (401k/Traditional IRA/Roth IRA/HSA/Other), an assumed annual rate of return, and an optional employer-match percentage, all sanitized in `sanitizeAccount()`. Balance/contribution history is tracked separately from the ledger via `app.retirementSnapshots` (`{ id, accountId, date, balance, contribution }`, manually logged per account per period through an "Add Snapshot" modal on the new Retirement page) — retirement account balances move by statement, not by day-to-day ledger transactions, so this deliberately doesn't reuse `computeAccountBalance()`. `src/retirementCalculator.js` is a pure, DOM-free module (same convention as `debtCalculator.js`) providing `computeRetirementProjection()` (monthly-compounding future-value projection to a user-set `app.retirementTargetDate`, factoring in each account's `employerMatchPercent`) and `splitGrowthFromContribution()` (derives growth from logged balance deltas minus contributions — growth includes any employer match, since match amounts aren't logged separately). `src/retirement.js` renders the page: account cards with a snapshot log, and three Chart.js charts (balance over time, contribution vs. growth, current-balance breakdown) plus a projection panel, following the existing `renderChartDataTable()` a11y convention. Wired end-to-end through all three storage backends: local/session storage (`dataExport.js`/`storage.js`), and the optional Postgres backend via a new `retirement_snapshots` table/`/api/retirement-snapshots` CRUD route (following the exact `plan_history` recipe from issue #162) plus a `retirement_target_date` column on `plan_settings`.
```

- [ ] **Step 3: Bump `APP_VERSION` and `CACHE_NAME`**

In `src/utils.js`:
```javascript
export const APP_VERSION = '5.0.0';
```
In `sw.js`:
```javascript
const CACHE_NAME = 'myfinances-v5.0.0';
```

- [ ] **Step 4: Add the CHANGELOG.md entry**

At the top of `CHANGELOG.md`, after the header block, before the existing `## [4.48.0]` entry:
```markdown
## [5.0.0] — 2026-09-07

### Added
- **Retirement accounts dashboard** — a new `Retirement` account type (subtype, assumed rate of return, employer match %) alongside a manually-logged per-account balance/contribution history (`app.retirementSnapshots`), a pure projection calculator (`src/retirementCalculator.js`) that compounds monthly to a user-set target retirement date, and a new "Retirement" nav page with balance-over-time, contribution-vs-growth, and current-balance-breakdown charts plus a per-account and combined projected-value panel. Wired through all three storage backends, including a new `retirement_snapshots` table and `/api/retirement-snapshots` CRUD endpoint on the optional self-hosted Postgres server. New `tests/features/test_retirement.py`, `tests/unit/retirementCalculator.test.js`, `server/test/crudResources.test.js` case, and `tests/postgres/test_postgres_mutations.py` cases.
```

- [ ] **Step 5: Run the versioning test and full suite one final time**

```bash
pytest tests/features/test_versioning.py -v
pytest tests/ -v -m "not slow"
npm run test:unit
```
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md CHANGELOG.md src/utils.js sw.js
git commit -m "docs: document retirement accounts dashboard, bump version to 5.0.0"
```

---

## Self-Review Notes

- **Spec coverage:** account type/subtype/rate/match (Tasks 1-2), retirement snapshots + history (Tasks 4-5), calculation engine (Task 3), page/charts/projection (Tasks 6-7), export/import (Task 8), full Postgres parity (Tasks 10-14), docs/version (Task 15) — every section of the spec has a task.
- **Type consistency:** `sanitizeAccount` (Task 1) → `retirementSubtype`/`rateOfReturn`/`employerMatchPercent` used identically in `src/accounts.js` (Task 2), `server/src/routes/accounts.js` columns (Task 11), and `retirement.js` (Tasks 5-7). `sanitizeRetirementSnapshot` (Task 4) → `{ id, accountId, date, balance, contribution }` used identically in `retirement.js` (Task 5), the server route (Task 11), and every sync/import list (Tasks 8, 13).
- **Line-number drift:** Tasks that reference specific line numbers in files touched by earlier tasks (e.g. Task 8 editing `dataExport.js` after Task 1 touched `sanitizers.js`, not `dataExport.js`) are unaffected by earlier tasks' edits, since each task edits a different region or a different file than the one whose line numbers it cites — the one intra-file case (Task 1's `sanitizers.js` edit shifting later stryker ranges) has an explicit re-verification step built in.
