# Balance History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record a dated history of balance and minimum payment for every debt and every Credit Card / Loan account, viewable in a per-item History modal, across all storage backends.

**Architecture:** A new `app.balanceHistory` collection of `{ id, debtId, accountId, date, balance, minimumPayment }` entries (exactly one owner id set). Pure logic lives in a DOM-free `src/balanceHistoryCore.js` (Jest/Stryker-tested); app-mutating wrappers in `src/balanceHistory.js`; the modal in `src/balanceHistoryModal.js`. Existing mutation sites call `recordBalanceHistory(app, owner)`. Postgres gets a `balance_history` table with two nullable cascading FKs + a CHECK, and a generic CRUD route; imports remap owner ids.

**Tech Stack:** Vanilla ES modules, Chart.js (CDN global), Playwright/pytest, Jest + Stryker, Node/Express + PostgreSQL (`node-pg-migrate`, `node:test`).

**Spec:** `docs/superpowers/specs/2026-09-28-balance-history-design.md`

## Global Constraints

- Strict CSP: no inline `<script>`, no inline `style="..."`, no `eval`. Toggle visibility with `classList` (`hidden` class).
- All user data rendered via `textContent`, or via `innerHTML` only through `escapeHtml()`.
- Every persisted field goes through a `sanitize*` function in `src/sanitizers.js`.
- Feature functions take `app` as first argument; `DebtTrackerApp` gets one-line delegating methods.
- Exports in modules that join the `ui.js` / `postgresSync.js` import cycles must be hoisted `function` declarations (never arrow-function `const`).
- `src/balanceHistoryCore.js` imports nothing and never touches `document`/`app`.
- Tracked account types are exactly `'Credit Card'` and `'Loan'`.
- Fixed Amount debt entries: `balance = null`, `minimumPayment = fixedAmount`.
- Account `minimumPayment` is informational only — never read by forecast/ledger/strategy code.
- Migrations use `pgm.sql(...)`, never `db.query()`.
- Version bump: `APP_VERSION` `6.4.0` → `6.5.0`, `sw.js` `CACHE_NAME` `myfinances-v6.5.0`, CHANGELOG `## [6.5.0] — 2026-09-28`.
- Every new `src/*.js` file must be added to `sw.js` `PRECACHE_URLS` (enforced by `tests/features/test_pwa.py`).
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017gt2yfY8xvi2HZ1r9XviFH
  ```

## Review Focus

1. **Same-day revert** — balance 500 → 400 → 500 on one day must leave that day's entry at 500 (the same-day entry is updated, not skipped because an older entry also says 500). Pinned in Task 1.
2. **`originalBalance` of 0** — a debt created at $0 and later updated keeps `originalBalance: 0` (the falsy-check fix). Pinned in Task 4.
3. **Orphan history in an import file** — entries whose `debtId`/`accountId` has no matching record are silently dropped and the import still succeeds. Pinned in Task 2 (sanitizer) and Task 7 (import).
4. **Account type changed to Credit Card on edit** — a Checking account edited to Credit Card starts recording and gains a History button. Pinned in Task 5.
5. **Deleting the last history entry while the modal is open** — modal re-renders to the empty state with no chart and no console errors. Pinned in Task 6.

---

### Task 1: Pure history core module

**Files:**
- Create: `src/balanceHistoryCore.js`
- Create: `tests/unit/balanceHistoryCore.test.js`
- Modify: `stryker.config.mjs` (`mutate` array)
- Modify: `sw.js` (`PRECACHE_URLS`)

**Interfaces:**
- Produces (all named exports, pure):
  - `HISTORY_TRACKED_ACCOUNT_TYPES: string[]` = `['Credit Card', 'Loan']`
  - `isHistoryTrackedAccount(account) → boolean`
  - `ownerOfEntry(entry) → { kind: 'debt'|'account', id: number }`
  - `entryBelongsTo(entry, owner) → boolean`
  - `sortHistory(entries) → entries[]` (new array, ascending date, tie by id)
  - `buildHistoryEntry(owner, record, date) → { debtId, accountId, date, balance, minimumPayment }`
  - `upsertHistoryEntry(entries, entry, newId) → { entries, action: 'none'|'insert'|'update', target }`
  - `seedHistoryForDebt(debt, today) → entry[]` (no ids)
  - `seedHistoryForAccount(account, today) → entry[]` (no ids)
  - `remapHistoryOwners(entries, debtIdMap: Map, accountIdMap: Map) → entries[]`
  - `excludeExistingHistory(existing, incoming) → incoming entries not already present for the same owner+date`
  - `computeHistoryDeltas(sortedEntries) → entries with balanceDelta, minimumPaymentDelta (number|null)`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/balanceHistoryCore.test.js`:

```js
const {
    HISTORY_TRACKED_ACCOUNT_TYPES,
    isHistoryTrackedAccount,
    ownerOfEntry,
    entryBelongsTo,
    sortHistory,
    buildHistoryEntry,
    upsertHistoryEntry,
    seedHistoryForDebt,
    seedHistoryForAccount,
    remapHistoryOwners,
    excludeExistingHistory,
    computeHistoryDeltas
} = require('../../src/balanceHistoryCore.js');

const DEBT = { kind: 'debt', id: 1 };
const ACCT = { kind: 'account', id: 7 };

describe('isHistoryTrackedAccount', () => {
    test('true only for Credit Card and Loan', () => {
        expect(HISTORY_TRACKED_ACCOUNT_TYPES).toEqual(['Credit Card', 'Loan']);
        expect(isHistoryTrackedAccount({ type: 'Credit Card' })).toBe(true);
        expect(isHistoryTrackedAccount({ type: 'Loan' })).toBe(true);
        expect(isHistoryTrackedAccount({ type: 'Checking' })).toBe(false);
        expect(isHistoryTrackedAccount(null)).toBe(false);
    });
});

describe('ownerOfEntry / entryBelongsTo', () => {
    test('debt entry', () => {
        const e = { debtId: 1, accountId: null };
        expect(ownerOfEntry(e)).toEqual(DEBT);
        expect(entryBelongsTo(e, DEBT)).toBe(true);
        expect(entryBelongsTo(e, { kind: 'account', id: 1 })).toBe(false);
    });
    test('account entry', () => {
        const e = { debtId: null, accountId: 7 };
        expect(ownerOfEntry(e)).toEqual(ACCT);
        expect(entryBelongsTo(e, ACCT)).toBe(true);
        expect(entryBelongsTo(e, { kind: 'debt', id: 7 })).toBe(false);
    });
});

describe('sortHistory', () => {
    test('ascending by date then id, does not mutate input', () => {
        const input = [
            { id: 3, date: '2026-03-01' },
            { id: 2, date: '2026-01-01' },
            { id: 1, date: '2026-03-01' }
        ];
        const out = sortHistory(input);
        expect(out.map(e => e.id)).toEqual([2, 1, 3]);
        expect(input[0].id).toBe(3);
    });
});

describe('buildHistoryEntry', () => {
    test('interest-bearing debt uses accountBalance + minimumPayment', () => {
        const debt = { debtType: 'creditCard', accountBalance: 1200, minimumPayment: 35 };
        expect(buildHistoryEntry(DEBT, debt, '2026-09-28')).toEqual({
            debtId: 1, accountId: null, date: '2026-09-28', balance: 1200, minimumPayment: 35
        });
    });
    test('fixed amount debt has null balance and fixedAmount as minimumPayment', () => {
        const debt = { debtType: 'fixedAmount', fixedAmount: 800, minimumPayment: 1 };
        expect(buildHistoryEntry(DEBT, debt, '2026-09-28')).toEqual({
            debtId: 1, accountId: null, date: '2026-09-28', balance: null, minimumPayment: 800
        });
    });
    test('account uses startingBalance as-is (negative allowed) + minimumPayment', () => {
        const acct = { type: 'Credit Card', startingBalance: -450.5, minimumPayment: 25 };
        expect(buildHistoryEntry(ACCT, acct, '2026-09-28')).toEqual({
            debtId: null, accountId: 7, date: '2026-09-28', balance: -450.5, minimumPayment: 25
        });
    });
    test('missing numbers default to 0', () => {
        expect(buildHistoryEntry(ACCT, { type: 'Loan' }, '2026-09-28').minimumPayment).toBe(0);
        expect(buildHistoryEntry(DEBT, { debtType: 'creditCard' }, '2026-09-28').balance).toBe(0);
    });
});

describe('upsertHistoryEntry', () => {
    const base = [{ id: 10, debtId: 1, accountId: null, date: '2026-09-01', balance: 500, minimumPayment: 25 }];

    test('insert when no entry exists for owner', () => {
        const entry = { debtId: 2, accountId: null, date: '2026-09-28', balance: 100, minimumPayment: 10 };
        const r = upsertHistoryEntry(base, entry, 99);
        expect(r.action).toBe('insert');
        expect(r.target).toEqual({ id: 99, ...entry });
        expect(r.entries).toHaveLength(2);
        expect(base).toHaveLength(1);
    });

    test('none when latest entry has identical values', () => {
        const entry = { debtId: 1, accountId: null, date: '2026-09-28', balance: 500, minimumPayment: 25 };
        const r = upsertHistoryEntry(base, entry, 99);
        expect(r.action).toBe('none');
        expect(r.entries).toBe(base);
        expect(r.target.id).toBe(10);
    });

    test('insert on a new date when values changed', () => {
        const entry = { debtId: 1, accountId: null, date: '2026-09-28', balance: 450, minimumPayment: 25 };
        const r = upsertHistoryEntry(base, entry, 99);
        expect(r.action).toBe('insert');
        expect(r.entries).toHaveLength(2);
    });

    test('update when an entry already exists for the same owner and date', () => {
        const entry = { debtId: 1, accountId: null, date: '2026-09-01', balance: 400, minimumPayment: 20 };
        const r = upsertHistoryEntry(base, entry, 99);
        expect(r.action).toBe('update');
        expect(r.target).toEqual({ ...base[0], balance: 400, minimumPayment: 20 });
        expect(r.entries).toHaveLength(1);
        expect(base[0].balance).toBe(500);
    });

    test('same-day revert updates the same-day entry even though an older entry matches', () => {
        const history = [
            { id: 1, debtId: 1, accountId: null, date: '2026-09-01', balance: 500, minimumPayment: 25 },
            { id: 2, debtId: 1, accountId: null, date: '2026-09-28', balance: 400, minimumPayment: 25 }
        ];
        const entry = { debtId: 1, accountId: null, date: '2026-09-28', balance: 500, minimumPayment: 25 };
        const r = upsertHistoryEntry(history, entry, 99);
        expect(r.action).toBe('update');
        expect(r.target.id).toBe(2);
        expect(r.target.balance).toBe(500);
    });

    test('none when same-day entry already has identical values', () => {
        const entry = { debtId: 1, accountId: null, date: '2026-09-01', balance: 500, minimumPayment: 25 };
        expect(upsertHistoryEntry(base, entry, 99).action).toBe('none');
    });

    test('account and debt with the same numeric id do not collide', () => {
        const entry = { debtId: null, accountId: 1, date: '2026-09-01', balance: 500, minimumPayment: 25 };
        expect(upsertHistoryEntry(base, entry, 99).action).toBe('insert');
    });
});

describe('seedHistoryForDebt', () => {
    test('credit card with earlier start date and changed values seeds original + current', () => {
        const debt = {
            id: 1, debtType: 'creditCard', accountBalance: 800, minimumPayment: 30,
            originalBalance: 1000, originalMinimumPayment: 40,
            debtStartDate: '2026-01-15', updatedAt: '2026-09-01'
        };
        expect(seedHistoryForDebt(debt, '2026-09-28')).toEqual([
            { debtId: 1, accountId: null, date: '2026-01-15', balance: 1000, minimumPayment: 40 },
            { debtId: 1, accountId: null, date: '2026-09-01', balance: 800, minimumPayment: 30 }
        ]);
    });

    test('no start date seeds only current, dated today when updatedAt missing', () => {
        const debt = { id: 1, debtType: 'creditCard', accountBalance: 800, minimumPayment: 30, originalBalance: 1000 };
        expect(seedHistoryForDebt(debt, '2026-09-28')).toEqual([
            { debtId: 1, accountId: null, date: '2026-09-28', balance: 800, minimumPayment: 30 }
        ]);
    });

    test('unchanged original values seed only current', () => {
        const debt = {
            id: 1, debtType: 'creditCard', accountBalance: 800, minimumPayment: 30,
            originalBalance: 800, originalMinimumPayment: 30, debtStartDate: '2026-01-15', updatedAt: '2026-09-01'
        };
        expect(seedHistoryForDebt(debt, '2026-09-28')).toHaveLength(1);
    });

    test('start date not earlier than current date seeds only current', () => {
        const debt = {
            id: 1, debtType: 'creditCard', accountBalance: 800, minimumPayment: 30,
            originalBalance: 1000, originalMinimumPayment: 40, debtStartDate: '2026-09-01', updatedAt: '2026-09-01'
        };
        expect(seedHistoryForDebt(debt, '2026-09-28')).toHaveLength(1);
    });

    test('missing original fields fall back to current values', () => {
        const debt = { id: 1, debtType: 'creditCard', accountBalance: 800, minimumPayment: 30, debtStartDate: '2026-01-15', updatedAt: '2026-09-01' };
        expect(seedHistoryForDebt(debt, '2026-09-28')).toHaveLength(1);
    });

    test('fixed amount seeds only current', () => {
        const debt = { id: 1, debtType: 'fixedAmount', fixedAmount: 800, debtStartDate: '2026-01-15', updatedAt: '2026-09-01' };
        expect(seedHistoryForDebt(debt, '2026-09-28')).toEqual([
            { debtId: 1, accountId: null, date: '2026-09-01', balance: null, minimumPayment: 800 }
        ]);
    });
});

describe('seedHistoryForAccount', () => {
    test('one current entry dated today', () => {
        expect(seedHistoryForAccount({ id: 7, type: 'Loan', startingBalance: -9000, minimumPayment: 210 }, '2026-09-28')).toEqual([
            { debtId: null, accountId: 7, date: '2026-09-28', balance: -9000, minimumPayment: 210 }
        ]);
    });
});

describe('remapHistoryOwners', () => {
    test('maps both owner kinds and drops unmapped entries', () => {
        const entries = [
            { id: 1, debtId: 100, accountId: null, date: '2026-01-01', balance: 1, minimumPayment: 1 },
            { id: 2, debtId: null, accountId: 200, date: '2026-01-01', balance: 2, minimumPayment: 2 },
            { id: 3, debtId: 999, accountId: null, date: '2026-01-01', balance: 3, minimumPayment: 3 },
            { id: 4, debtId: null, accountId: 998, date: '2026-01-01', balance: 4, minimumPayment: 4 }
        ];
        const out = remapHistoryOwners(entries, new Map([[100, 1100]]), new Map([[200, 1200]]));
        expect(out).toEqual([
            { id: 1, debtId: 1100, accountId: null, date: '2026-01-01', balance: 1, minimumPayment: 1 },
            { id: 2, debtId: null, accountId: 1200, date: '2026-01-01', balance: 2, minimumPayment: 2 }
        ]);
        expect(entries[0].debtId).toBe(100);
    });
});

describe('excludeExistingHistory', () => {
    test('drops incoming entries whose owner+date already exist', () => {
        const existing = [{ id: 1, debtId: 5, accountId: null, date: '2026-01-01' }];
        const incoming = [
            { debtId: 5, accountId: null, date: '2026-01-01' },
            { debtId: 5, accountId: null, date: '2026-02-01' },
            { debtId: null, accountId: 5, date: '2026-01-01' }
        ];
        expect(excludeExistingHistory(existing, incoming)).toEqual([incoming[1], incoming[2]]);
    });
});

describe('computeHistoryDeltas', () => {
    test('first entry has null deltas; later entries are rounded differences', () => {
        const out = computeHistoryDeltas([
            { date: '2026-01-01', balance: 100.1, minimumPayment: 10 },
            { date: '2026-02-01', balance: 100, minimumPayment: 12.5 }
        ]);
        expect(out[0].balanceDelta).toBeNull();
        expect(out[0].minimumPaymentDelta).toBeNull();
        expect(out[1].balanceDelta).toBe(-0.1);
        expect(out[1].minimumPaymentDelta).toBe(2.5);
    });
    test('null balances produce null balanceDelta', () => {
        const out = computeHistoryDeltas([
            { date: '2026-01-01', balance: null, minimumPayment: 800 },
            { date: '2026-02-01', balance: null, minimumPayment: 850 }
        ]);
        expect(out[1].balanceDelta).toBeNull();
        expect(out[1].minimumPaymentDelta).toBe(50);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- tests/unit/balanceHistoryCore.test.js`
Expected: FAIL — `Cannot find module '../../src/balanceHistoryCore.js'`.

- [ ] **Step 3: Implement `src/balanceHistoryCore.js`**

```js
// Pure balance-history helpers — no DOM/app state access (same convention as
// retirementCalculator.js), so they can be unit- and mutation-tested.
// Owner refs are { kind: 'debt' | 'account', id }.

export const HISTORY_TRACKED_ACCOUNT_TYPES = ['Credit Card', 'Loan'];

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function roundCents(value) {
    return Math.round(value * 100) / 100;
}

function sameValues(a, b) {
    return a.balance === b.balance && a.minimumPayment === b.minimumPayment;
}

export function isHistoryTrackedAccount(account) {
    return !!account && HISTORY_TRACKED_ACCOUNT_TYPES.includes(account.type);
}

export function ownerOfEntry(entry) {
    return entry.debtId != null
        ? { kind: 'debt', id: entry.debtId }
        : { kind: 'account', id: entry.accountId };
}

export function entryBelongsTo(entry, owner) {
    return owner.kind === 'debt'
        ? entry.debtId != null && Number(entry.debtId) === Number(owner.id)
        : entry.accountId != null && Number(entry.accountId) === Number(owner.id);
}

export function sortHistory(entries) {
    return [...entries].sort((a, b) =>
        a.date.localeCompare(b.date) || (Number(a.id) || 0) - (Number(b.id) || 0));
}

export function buildHistoryEntry(owner, record, date) {
    if (owner.kind === 'account') {
        return { debtId: null, accountId: owner.id, date, balance: toNumber(record.startingBalance), minimumPayment: toNumber(record.minimumPayment) };
    }
    if (record.debtType === 'fixedAmount') {
        return { debtId: owner.id, accountId: null, date, balance: null, minimumPayment: toNumber(record.fixedAmount) };
    }
    return { debtId: owner.id, accountId: null, date, balance: toNumber(record.accountBalance), minimumPayment: toNumber(record.minimumPayment) };
}

export function upsertHistoryEntry(entries, entry, newId) {
    const own = sortHistory(entries.filter(e => entryBelongsTo(e, ownerOfEntry(entry))));
    const sameDay = own.find(e => e.date === entry.date);
    if (sameDay) {
        if (sameValues(sameDay, entry)) return { entries, action: 'none', target: sameDay };
        const updated = { ...sameDay, balance: entry.balance, minimumPayment: entry.minimumPayment };
        return { entries: entries.map(e => (e === sameDay ? updated : e)), action: 'update', target: updated };
    }
    const latest = own[own.length - 1];
    if (latest && sameValues(latest, entry)) return { entries, action: 'none', target: latest };
    const inserted = { id: newId, ...entry };
    return { entries: [...entries, inserted], action: 'insert', target: inserted };
}

export function seedHistoryForDebt(debt, today) {
    const current = buildHistoryEntry({ kind: 'debt', id: debt.id }, debt, debt.updatedAt || today);
    if (debt.debtType === 'fixedAmount') return [current];
    const original = {
        ...current,
        date: debt.debtStartDate,
        balance: toNumber(debt.originalBalance ?? debt.accountBalance),
        minimumPayment: toNumber(debt.originalMinimumPayment ?? debt.minimumPayment)
    };
    if (debt.debtStartDate && debt.debtStartDate < current.date && !sameValues(original, current)) {
        return [original, current];
    }
    return [current];
}

export function seedHistoryForAccount(account, today) {
    return [buildHistoryEntry({ kind: 'account', id: account.id }, account, today)];
}

export function remapHistoryOwners(entries, debtIdMap, accountIdMap) {
    const out = [];
    for (const entry of entries) {
        if (entry.debtId != null) {
            const debtId = debtIdMap.get(entry.debtId);
            if (debtId != null) out.push({ ...entry, debtId, accountId: null });
        } else if (entry.accountId != null) {
            const accountId = accountIdMap.get(entry.accountId);
            if (accountId != null) out.push({ ...entry, debtId: null, accountId });
        }
    }
    return out;
}

export function excludeExistingHistory(existing, incoming) {
    const keyOf = e => (e.debtId != null ? `d${e.debtId}` : `a${e.accountId}`) + `|${e.date}`;
    const seen = new Set(existing.map(keyOf));
    return incoming.filter(e => !seen.has(keyOf(e)));
}

export function computeHistoryDeltas(sortedEntries) {
    return sortedEntries.map((entry, i) => {
        const prev = i > 0 ? sortedEntries[i - 1] : null;
        const balanceDelta = prev && entry.balance !== null && prev.balance !== null
            ? roundCents(entry.balance - prev.balance) : null;
        const minimumPaymentDelta = prev ? roundCents(entry.minimumPayment - prev.minimumPayment) : null;
        return { ...entry, balanceDelta, minimumPaymentDelta };
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- tests/unit/balanceHistoryCore.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Add to Stryker and the service worker precache**

In `stryker.config.mjs`, add to the end of the `mutate` array (the whole file is pure):

```js
        'src/balanceHistoryCore.js', // balance history pure helpers
```

In `sw.js` `PRECACHE_URLS`, change the line `'/src/utils.js',` to:

```js
    '/src/utils.js', '/src/balanceHistoryCore.js',
```

- [ ] **Step 6: Verify precache test and commit**

Run: `pytest tests/features/test_pwa.py -v`
Expected: PASS.

```bash
git add src/balanceHistoryCore.js tests/unit/balanceHistoryCore.test.js stryker.config.mjs sw.js
git commit -m "feat: pure balance-history core helpers"
```

---

### Task 2: Sanitizers — history entries and account minimum payment

**Files:**
- Modify: `src/sanitizers.js` (`sanitizeAccount`, new `sanitizeBalanceHistoryEntry`, `sanitizeParsedState`)
- Modify: `tests/unit/sanitizers.test.js`
- Modify: `stryker.config.mjs`

**Interfaces:**
- Produces: `sanitizeBalanceHistoryEntry(record, idFallback) → entry | null`; `sanitizeAccount` output gains `minimumPayment: number`; `sanitizeParsedState(parsed).balanceHistory: entry[]` (orphans removed).

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/sanitizers.test.js` (add `sanitizeBalanceHistoryEntry` and `sanitizeParsedState` to the existing `require` destructure at the top if not already present):

```js
describe('sanitizeAccount minimumPayment', () => {
    test('defaults to 0 and clamps negatives', () => {
        expect(sanitizeAccount({ name: 'Visa', type: 'Credit Card' }, 1).minimumPayment).toBe(0);
        expect(sanitizeAccount({ name: 'Visa', minimumPayment: -5 }, 1).minimumPayment).toBe(0);
        expect(sanitizeAccount({ name: 'Visa', minimumPayment: '35.5' }, 1).minimumPayment).toBe(35.5);
    });
});

describe('sanitizeBalanceHistoryEntry', () => {
    test('valid debt entry', () => {
        expect(sanitizeBalanceHistoryEntry({ id: 3, debtId: '5', date: '2026-09-01', balance: '120.5', minimumPayment: 25 }, 9))
            .toEqual({ id: 3, debtId: 5, accountId: null, date: '2026-09-01', balance: 120.5, minimumPayment: 25 });
    });
    test('valid account entry keeps negative balance', () => {
        expect(sanitizeBalanceHistoryEntry({ accountId: 7, date: '2026-09-01', balance: -400, minimumPayment: 10 }, 9))
            .toEqual({ id: 9, debtId: null, accountId: 7, date: '2026-09-01', balance: -400, minimumPayment: 10 });
    });
    test('null/absent balance stays null (fixed amount)', () => {
        expect(sanitizeBalanceHistoryEntry({ debtId: 5, date: '2026-09-01', balance: null, minimumPayment: 800 }, 9).balance).toBeNull();
        expect(sanitizeBalanceHistoryEntry({ debtId: 5, date: '2026-09-01', minimumPayment: 800 }, 9).balance).toBeNull();
    });
    test('non-numeric balance becomes null', () => {
        expect(sanitizeBalanceHistoryEntry({ debtId: 5, date: '2026-09-01', balance: 'abc' }, 9).balance).toBeNull();
    });
    test('minimumPayment defaults to 0 and clamps negatives', () => {
        expect(sanitizeBalanceHistoryEntry({ debtId: 5, date: '2026-09-01' }, 9).minimumPayment).toBe(0);
        expect(sanitizeBalanceHistoryEntry({ debtId: 5, date: '2026-09-01', minimumPayment: -1 }, 9).minimumPayment).toBe(0);
    });
    test('rejects both owners, neither owner, and missing/invalid date', () => {
        expect(sanitizeBalanceHistoryEntry({ debtId: 5, accountId: 7, date: '2026-09-01' }, 9)).toBeNull();
        expect(sanitizeBalanceHistoryEntry({ date: '2026-09-01' }, 9)).toBeNull();
        expect(sanitizeBalanceHistoryEntry({ debtId: 5 }, 9)).toBeNull();
        expect(sanitizeBalanceHistoryEntry({ debtId: 5, date: 'not-a-date' }, 9)).toBeNull();
        expect(sanitizeBalanceHistoryEntry(null, 9)).toBeNull();
    });
});

describe('sanitizeParsedState balanceHistory', () => {
    test('keeps entries whose owner exists and drops orphans', () => {
        const state = sanitizeParsedState({
            debts: [{ id: 1, name: 'Visa' }],
            accounts: [{ id: 7, name: 'Loan', type: 'Loan' }],
            balanceHistory: [
                { id: 1, debtId: 1, date: '2026-09-01', balance: 10, minimumPayment: 1 },
                { id: 2, accountId: 7, date: '2026-09-01', balance: -10, minimumPayment: 1 },
                { id: 3, debtId: 99, date: '2026-09-01', balance: 10, minimumPayment: 1 },
                { id: 4, accountId: 98, date: '2026-09-01', balance: 10, minimumPayment: 1 },
                { id: 5, date: '2026-09-01' }
            ]
        });
        expect(state.balanceHistory.map(h => h.id)).toEqual([1, 2]);
    });
    test('missing balanceHistory yields empty array', () => {
        expect(sanitizeParsedState({}).balanceHistory).toEqual([]);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- tests/unit/sanitizers.test.js`
Expected: FAIL — `sanitizeBalanceHistoryEntry is not a function` and `minimumPayment` undefined.

- [ ] **Step 3: Implement**

In `src/sanitizers.js` `sanitizeAccount`, after the line `pensionYearsOfService: sanitizeInteger(record?.pensionYearsOfService, 0, { min: 0 })`, change it to end with a comma and add:

```js
        pensionYearsOfService: sanitizeInteger(record?.pensionYearsOfService, 0, { min: 0 }),
        minimumPayment: sanitizeFiniteNumber(record?.minimumPayment, 0, { min: 0 })
```

After `sanitizeRetirementSnapshot` (before `sanitizeParsedState`), add:

```js
// Exactly one of debtId / accountId must be set; returns null (filtered out
// by callers, 400 on the server) otherwise. balance is null for Fixed Amount
// debts and may be negative for Credit Card / Loan accounts.
export function sanitizeBalanceHistoryEntry(record, idFallback) {
    const debtId = sanitizeInteger(record?.debtId, null);
    const accountId = sanitizeInteger(record?.accountId, null);
    const date = sanitizeDateISO(record?.date);
    if ((debtId === null) === (accountId === null) || !date) return null;
    const rawBalance = record?.balance;
    return {
        id: sanitizeInteger(record?.id, idFallback),
        debtId,
        accountId,
        date,
        balance: rawBalance === null || rawBalance === undefined || rawBalance === '' ? null : sanitizeFiniteNumber(rawBalance, null),
        minimumPayment: sanitizeFiniteNumber(record?.minimumPayment, 0, { min: 0 })
    };
}
```

In `sanitizeParsedState`, change `return {` to `const state = {`, add this property after the `retirementSnapshots:` line:

```js
        balanceHistory: (Array.isArray(parsed.balanceHistory) ? parsed.balanceHistory : []).map((h, i) => sanitizeBalanceHistoryEntry(h, now + 8000 + i)).filter(Boolean),
```

and replace the closing `};` of that object with:

```js
    };
    const debtIds = new Set(state.debts.map(d => d.id));
    const accountIds = new Set(state.accounts.map(a => a.id));
    state.balanceHistory = state.balanceHistory.filter(h =>
        h.debtId !== null ? debtIds.has(h.debtId) : accountIds.has(h.accountId));
    return state;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit`
Expected: PASS (whole Jest suite).

- [ ] **Step 5: Update Stryker line ranges**

The one-line insertion in `sanitizeAccount` shifts every later range in `sanitizers.js` by +1. Confirm with:

```bash
grep -n "^export function sanitize" src/sanitizers.js
```

Update `stryker.config.mjs` so the existing entries become `'src/sanitizers.js:5-64'`, `'src/sanitizers.js:78-99'`, `'src/sanitizers.js:101-131'`, `'src/sanitizers.js:132-153'` (adjust if the grep shows different start/end lines — each range must still start at the first function's `export function` line and end at the last function's closing `}`), and add one entry covering exactly `sanitizeBalanceHistoryEntry` (its `export function` line through its closing `}`, per the grep), e.g.:

```js
        'src/sanitizers.js:283-297', // sanitizeBalanceHistoryEntry
```

- [ ] **Step 6: Commit**

```bash
git add src/sanitizers.js tests/unit/sanitizers.test.js stryker.config.mjs
git commit -m "feat: sanitize balance history entries and account minimum payment"
```

---

### Task 3: App-level history module, state, persistence, and load-time seeding

**Files:**
- Create: `src/balanceHistory.js`
- Modify: `src/app.js` (state field, imports, delegating methods, `init()` seeding)
- Modify: `src/storage.js` (`saveToStorage` data, `loadFromStorage`, `clearAllData`)
- Modify: `sw.js` (`PRECACHE_URLS`)
- Create: `tests/features/test_balance_history.py`

**Interfaces:**
- Consumes: Task 1 core helpers.
- Produces (all `export function` / `export async function` declarations):
  - `recordBalanceHistory(app, owner) → Promise<entry|null>`
  - `getBalanceHistory(app, owner) → entry[]` (ascending)
  - `deleteBalanceHistoryEntry(app, id) → void`
  - `removeHistoryForOwner(app, owner) → void` (does not save; caller saves)
  - `seedMissingBalanceHistory(app) → Promise<number>` (count seeded)
  - `DebtTrackerApp` methods: `recordBalanceHistory(owner)`, `getBalanceHistory(owner)`, `deleteBalanceHistoryEntry(id)`, `seedMissingBalanceHistory()`

- [ ] **Step 1: Write the failing Playwright tests**

Create `tests/features/test_balance_history.py`:

```python
#!/usr/bin/env python3
"""
Balance history tests — debts and Credit Card / Loan accounts.
See docs/superpowers/specs/2026-09-28-balance-history-design.md.
"""
import json
import pytest

from tests.conftest import assert_no_errors, create_debt


def _reload_app(page):
    page.reload(wait_until="networkidle")
    page.wait_for_function("() => window.app && window.app._currentPage === 'health'", timeout=15000)


def _history(page):
    return page.evaluate("() => window.app.balanceHistory")


@pytest.mark.feature
def test_legacy_data_is_seeded_on_load(app_page):
    """Stored data with no balanceHistory gets entries seeded for debts and tracked accounts."""
    page = app_page
    page.evaluate("""() => {
        localStorage.setItem('debtTrackerData', JSON.stringify({
            debts: [
                { id: 1, name: 'Visa', debtType: 'creditCard', accountBalance: 800, minimumPayment: 30,
                  originalBalance: 1000, originalMinimumPayment: 40, debtStartDate: '2026-01-15', updatedAt: '2026-09-01',
                  interestRate: 20, dueDate: 5 },
                { id: 2, name: 'Daycare', debtType: 'fixedAmount', fixedAmount: 900, minimumPayment: 900,
                  fixedStartDate: '2026-01-01', fixedEndDate: '2027-01-01', updatedAt: '2026-09-01' }
            ],
            accounts: [
                { id: 7, name: 'Car Loan', type: 'Loan', startingBalance: -9000, minimumPayment: 210 },
                { id: 8, name: 'Checking', type: 'Checking', startingBalance: 500 }
            ]
        }));
    }""")
    _reload_app(page)
    history = _history(page)
    visa = sorted([h for h in history if h['debtId'] == 1], key=lambda h: h['date'])
    assert [(h['date'], h['balance'], h['minimumPayment']) for h in visa] == [
        ('2026-01-15', 1000, 40), ('2026-09-01', 800, 30)]
    daycare = [h for h in history if h['debtId'] == 2]
    assert len(daycare) == 1 and daycare[0]['balance'] is None and daycare[0]['minimumPayment'] == 900
    loan = [h for h in history if h['accountId'] == 7]
    assert len(loan) == 1 and loan[0]['balance'] == -9000 and loan[0]['minimumPayment'] == 210
    assert not [h for h in history if h['accountId'] == 8]


@pytest.mark.feature
def test_seeding_is_idempotent_and_history_persists(app_page):
    page = app_page
    page.evaluate("""() => {
        localStorage.setItem('debtTrackerData', JSON.stringify({
            debts: [{ id: 1, name: 'Visa', debtType: 'creditCard', accountBalance: 800, minimumPayment: 30, interestRate: 20, dueDate: 5 }]
        }));
    }""")
    _reload_app(page)
    first = _history(page)
    assert len(first) == 1
    _reload_app(page)
    assert _history(page) == first


@pytest.mark.feature
def test_clear_all_data_resets_history(app_page):
    page = app_page
    page.evaluate("""() => {
        window.app.balanceHistory = [{ id: 1, debtId: 1, accountId: null, date: '2026-09-01', balance: 1, minimumPayment: 1 }];
        window.app.saveToStorage();
    }""")
    page.evaluate("() => import('/src/storage.js').then(m => m.clearAllData(window.app))")
    assert _history(page) == []
```

(`clearAllData(app, options = {})` in `src/storage.js` resets state directly with no confirmation prompt.)

- [ ] **Step 2: Run tests to verify they fail**

Start the server if needed: `python -m http.server 32900` (background).
Run: `pytest tests/features/test_balance_history.py -v`
Expected: FAIL — `window.app.balanceHistory` is `undefined` / seeding assertions fail.

- [ ] **Step 3: Create `src/balanceHistory.js`**

```js
// Balance & minimum-payment history for debts and Credit Card / Loan accounts.
// Pure logic lives in balanceHistoryCore.js; this module mutates app state and
// syncs to Postgres. Exports stay hoisted function declarations: this module
// is imported by debts.js/accounts.js, which sit in the ui.js/postgresSync.js
// import cycles (see CLAUDE.md "Module import constraints").

import { todayISO } from './utils.js';
import { pgPost, pgPatch, pgDelete } from './postgresSync.js';
import {
    buildHistoryEntry, upsertHistoryEntry, seedHistoryForDebt, seedHistoryForAccount,
    isHistoryTrackedAccount, entryBelongsTo, sortHistory
} from './balanceHistoryCore.js';

let lastLocalId = 0;

// Monotonic Date.now()-based id so entries created in the same millisecond
// (e.g. seeding an original + current entry) never collide.
function nextLocalId() {
    const now = Date.now();
    lastLocalId = now > lastLocalId ? now : lastLocalId + 1;
    return lastLocalId;
}

function findOwnerRecord(app, owner) {
    return owner.kind === 'debt'
        ? (app.debts || []).find(d => Number(d.id) === Number(owner.id))
        : (app.accounts || []).find(a => Number(a.id) === Number(owner.id));
}

export async function recordBalanceHistory(app, owner) {
    const record = findOwnerRecord(app, owner);
    if (!record) return null;
    if (owner.kind === 'account' && !isHistoryTrackedAccount(record)) return null;

    const entry = buildHistoryEntry({ kind: owner.kind, id: record.id }, record, todayISO());
    const result = upsertHistoryEntry(app.balanceHistory || [], entry, nextLocalId());
    if (result.action === 'none') return result.target;

    app.balanceHistory = result.entries;
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') {
        if (result.action === 'insert') {
            const saved = await pgPost(app, '/api/balance-history', result.target);
            if (saved?.id) result.target.id = saved.id;
        } else {
            pgPatch(app, `/api/balance-history/${result.target.id}`, result.target);
        }
    }
    return result.target;
}

export function getBalanceHistory(app, owner) {
    return sortHistory((app.balanceHistory || []).filter(e => entryBelongsTo(e, owner)));
}

export function deleteBalanceHistoryEntry(app, id) {
    app.balanceHistory = (app.balanceHistory || []).filter(e => e.id !== id);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/balance-history/${id}`);
}

// Local mirror of the server's ON DELETE CASCADE — no DELETE requests needed.
// Does not save: callers (deleteDebt/deleteAccount) save right after.
export function removeHistoryForOwner(app, owner) {
    app.balanceHistory = (app.balanceHistory || []).filter(e => !entryBelongsTo(e, owner));
}

export async function seedMissingBalanceHistory(app) {
    const today = todayISO();
    const history = app.balanceHistory || [];
    const debtIdsWithHistory = new Set(history.filter(e => e.debtId != null).map(e => Number(e.debtId)));
    const accountIdsWithHistory = new Set(history.filter(e => e.accountId != null).map(e => Number(e.accountId)));

    const seeded = [];
    for (const debt of app.debts || []) {
        if (!debtIdsWithHistory.has(Number(debt.id))) seeded.push(...seedHistoryForDebt(debt, today));
    }
    for (const account of app.accounts || []) {
        if (isHistoryTrackedAccount(account) && !accountIdsWithHistory.has(Number(account.id))) {
            seeded.push(...seedHistoryForAccount(account, today));
        }
    }
    if (seeded.length === 0) return 0;

    const withIds = seeded.map(e => ({ id: nextLocalId(), ...e }));
    app.balanceHistory = [...history, ...withIds];
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') {
        await Promise.all(withIds.map(async entry => {
            const saved = await pgPost(app, '/api/balance-history', entry);
            if (saved?.id) entry.id = saved.id;
        }));
    }
    return withIds.length;
}
```

- [ ] **Step 4: Wire into `app.js`**

Near the other feature imports at the top of `src/app.js` add:

```js
import {
    recordBalanceHistory as recordBalanceHistoryFeature,
    getBalanceHistory as getBalanceHistoryFeature,
    deleteBalanceHistoryEntry as deleteBalanceHistoryEntryFeature,
    seedMissingBalanceHistory as seedMissingBalanceHistoryFeature
} from './balanceHistory.js';
```

In the constructor, after `this.retirementTargetDate = null;` add:

```js
        this.balanceHistory = [];
```

In `init()`, right after `backfillIncomeAccountIds(this);` add:

```js
        await this.seedMissingBalanceHistory();
```

Next to the retirement delegating methods (`addRetirementSnapshot(...)`), add:

```js
    recordBalanceHistory(owner) { return recordBalanceHistoryFeature(this, owner); }
    getBalanceHistory(owner) { return getBalanceHistoryFeature(this, owner); }
    deleteBalanceHistoryEntry(id) { return deleteBalanceHistoryEntryFeature(this, id); }
    seedMissingBalanceHistory() { return seedMissingBalanceHistoryFeature(this); }
```

- [ ] **Step 5: Persist in `storage.js`**

In `saveToStorage`'s `data` object, after `retirementSnapshots: app.retirementSnapshots || [],` add:

```js
            balanceHistory: app.balanceHistory || [],
```

In `loadFromStorage`, after `app.retirementSnapshots = clean.retirementSnapshots;` add:

```js
            app.balanceHistory = clean.balanceHistory;
```

In `clearAllData`, after `app.retirementSnapshots = [];` add:

```js
    app.balanceHistory = [];
```

In `sw.js` `PRECACHE_URLS`, change `'/src/utils.js', '/src/balanceHistoryCore.js',` to:

```js
    '/src/utils.js', '/src/balanceHistoryCore.js', '/src/balanceHistory.js',
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/features/test_balance_history.py tests/features/test_pwa.py -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/balanceHistory.js src/app.js src/storage.js sw.js tests/features/test_balance_history.py
git commit -m "feat: balance history state, persistence, and load-time seeding"
```

---

### Task 4: Record debt history on every debt change

**Files:**
- Modify: `src/debts.js` (`addDebt`, `deleteDebt`, `updateDebtBalance`, `saveEdit`, `saveInlineEdit`)
- Modify: `tests/features/test_balance_history.py`

**Interfaces:**
- Consumes: `recordBalanceHistory(app, owner)`, `removeHistoryForOwner(app, owner)` from Task 3.
- Produces: `updateDebtBalance(app, debtId, newBalance, newMinPayment)` becomes `async` (callers don't await; behavior otherwise unchanged).

- [ ] **Step 1: Write the failing tests**

Append to `tests/features/test_balance_history.py`:

```python
def _debt_history(page, debt_id):
    return page.evaluate(f"() => window.app.getBalanceHistory({{ kind: 'debt', id: {debt_id} }})")


def _only_debt_id(page):
    return page.evaluate("() => window.app.debts[0].id")


@pytest.mark.feature
def test_adding_debt_records_first_entry(app_page, debt_data):
    page = app_page
    create_debt(page, debt_data)
    debt_id = _only_debt_id(page)
    history = _debt_history(page, debt_id)
    assert len(history) == 1
    assert history[0]['balance'] == 2500 and history[0]['minimumPayment'] == 100


@pytest.mark.feature
def test_update_balance_same_day_updates_and_new_day_inserts(app_page, debt_data):
    page = app_page
    create_debt(page, debt_data)
    debt_id = _only_debt_id(page)

    page.evaluate(f"() => window.app.updateDebtBalance({debt_id}, 2300, 95)")
    history = _debt_history(page, debt_id)
    assert len(history) == 1 and history[0]['balance'] == 2300 and history[0]['minimumPayment'] == 95

    # Backdate the existing entry so the next update lands on a new day.
    page.evaluate("() => { window.app.balanceHistory[0].date = '2026-01-01'; }")
    page.evaluate(f"() => window.app.updateDebtBalance({debt_id}, 2100, 90)")
    history = _debt_history(page, debt_id)
    assert [(h['balance'], h['minimumPayment']) for h in history] == [(2300, 95), (2100, 90)]


@pytest.mark.feature
def test_inline_edit_records_and_unchanged_save_does_not(app_page, debt_data):
    page = app_page
    create_debt(page, debt_data)
    debt_id = _only_debt_id(page)
    page.evaluate("() => { window.app.balanceHistory[0].date = '2026-01-01'; }")

    # Save with no value change -> no new entry.
    page.evaluate(f"() => window.app.startEdit({debt_id})")
    page.evaluate(f"() => window.app.saveInlineEdit({debt_id})")
    assert len(_debt_history(page, debt_id)) == 1

    page.evaluate(f"() => window.app.startEdit({debt_id})")
    page.fill(f'#inline-balance-{debt_id}', '1999')
    page.evaluate(f"() => window.app.saveInlineEdit({debt_id})")
    history = _debt_history(page, debt_id)
    assert len(history) == 2 and history[-1]['balance'] == 1999


@pytest.mark.feature
def test_fixed_amount_change_is_recorded(app_page):
    page = app_page
    page.evaluate("""() => {
        window.app.debts = [{ id: 42, name: 'Daycare', debtType: 'fixedAmount', fixedAmount: 900, minimumPayment: 900,
                              fixedStartDate: '2026-01-01', fixedEndDate: '2027-01-01' }];
        window.app.balanceHistory = [{ id: 1, debtId: 42, accountId: null, date: '2026-01-01', balance: null, minimumPayment: 900 }];
        window.app.updateUI();
    }""")
    page.click('button[data-page="liabilities"]')
    page.evaluate("() => window.app.startEdit(42)")
    page.fill('#inline-fixed-amount-42', '950')
    page.evaluate("() => window.app.saveInlineEdit(42)")
    history = _debt_history(page, 42)
    assert [(h['balance'], h['minimumPayment']) for h in history] == [(None, 900), (None, 950)]


@pytest.mark.feature
def test_original_balance_of_zero_is_preserved(app_page):
    page = app_page
    page.evaluate("""() => {
        window.app.debts = [{ id: 43, name: 'New Card', debtType: 'creditCard', accountBalance: 0, originalBalance: 0,
                              minimumPayment: 0, originalMinimumPayment: 0, interestRate: 20, dueDate: 1 }];
        window.app.updateUI();
    }""")
    page.evaluate("() => window.app.updateDebtBalance(43, 300, 25)")
    assert page.evaluate("() => window.app.debts[0].originalBalance") == 0


@pytest.mark.feature
def test_deleting_debt_removes_its_history(app_page, debt_data):
    page = app_page
    create_debt(page, debt_data)
    debt_id = _only_debt_id(page)
    page.evaluate("""() => {
        window.app.balanceHistory.push({ id: 5, debtId: null, accountId: 777, date: '2026-01-01', balance: 1, minimumPayment: 1 });
    }""")
    page.click(f'[data-debt-action="delete"][data-debt-id="{debt_id}"]')
    # showDeleteConfirmModal is an in-app modal (#deleteConfirmModal), not a native dialog.
    page.click('#deleteConfirmBtn')
    page.wait_for_function(f"() => !window.app.debts.some(d => d.id === {debt_id})")
    history = _history(page)
    assert all(h['debtId'] != debt_id for h in history)
    assert any(h['accountId'] == 777 for h in history)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/features/test_balance_history.py -v -k "debt or fixed or original"`
Expected: FAIL — no entries recorded after add/update/edit; `originalBalance` becomes 300.

- [ ] **Step 3: Implement in `src/debts.js`**

Add the import below the existing `postgresSync.js` import:

```js
import { recordBalanceHistory, removeHistoryForOwner } from './balanceHistory.js';
```

In `addDebt`, after the Postgres id-swap block (`if (saved?.id) debt.id = saved.id;` and its closing `}`), add:

```js
    await recordBalanceHistory(app, { kind: 'debt', id: debt.id });
```

In `deleteDebt`, after `app.debts = app.debts.filter(d => d.id !== debtId);` add:

```js
    removeHistoryForOwner(app, { kind: 'debt', id: debtId });
```

Replace `updateDebtBalance` with:

```js
export async function updateDebtBalance(app, debtId, newBalance, newMinPayment) {
    const idx = app.debts.findIndex(d => Number(d.id) === Number(debtId));
    if (idx === -1) return;

    if (app.debts[idx].originalBalance == null) {
        app.debts[idx].originalBalance = app.debts[idx].accountBalance;
    }
    app.debts[idx].accountBalance = newBalance;

    if (newMinPayment !== undefined) {
        if (app.debts[idx].originalMinimumPayment === undefined) {
            app.debts[idx].originalMinimumPayment = app.debts[idx].minimumPayment ?? 0;
        }
        app.debts[idx].minimumPayment = newMinPayment;
    }
    app.debts[idx].updatedAt = todayISO();
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/debts/${app.debts[idx].id}`, app.debts[idx]);
    await recordBalanceHistory(app, { kind: 'debt', id: app.debts[idx].id });
    recalculateIfConfigured(app);
    app.renderDebtsList();
}
```

In `saveEdit`, after the line `if (app._storageBackendKind === 'postgres') pgPatch(app, \`/api/debts/${app.debts[idx].id}\`, app.debts[idx]);` add:

```js
    await recordBalanceHistory(app, { kind: 'debt', id: app.debts[idx].id });
```

In `saveInlineEdit`, after `if (app._storageBackendKind === 'postgres') pgPatch(app, \`/api/debts/${debt.id}\`, debt);` add:

```js
        await recordBalanceHistory(app, { kind: 'debt', id: debt.id });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/features/test_balance_history.py tests/features/test_debts.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/debts.js tests/features/test_balance_history.py
git commit -m "feat: record debt balance history on add/update/edit, cascade on delete"
```

---

### Task 5: Account minimum-payment field and account history capture

**Files:**
- Modify: `index.html` (`#accountForm`)
- Modify: `src/accounts.js` (`updateAccountFormRetirementVisibility`, edit card markup, card actions, `container.onchange`, `addAccount`, `saveEditAccount`, `deleteAccount`)
- Modify: `tests/features/test_balance_history.py`

**Interfaces:**
- Consumes: `recordBalanceHistory`, `removeHistoryForOwner` (Task 3); `isHistoryTrackedAccount`, `HISTORY_TRACKED_ACCOUNT_TYPES` (Task 1).
- Produces: DOM ids `#accountMinimumPaymentGroup`, `#accountMinimumPayment`, `#ac-minpay-group-{id}`, `#ac-minpay-{id}`; account card button `[data-account-action="history"][data-account-id]` (click handler wired in Task 6).

- [ ] **Step 1: Write the failing tests**

Append to `tests/features/test_balance_history.py`:

```python
def _add_account(page, name, acct_type, balance, min_payment=None):
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)
    page.fill('#accountName', name)
    page.select_option('#accountType', label=acct_type)
    page.fill('#accountStartingBalance', balance)
    if min_payment is not None:
        page.fill('#accountMinimumPayment', min_payment)
    page.click('#accountFormSubmit')
    page.wait_for_selector(f'text={name}', timeout=10000)
    return page.evaluate(f"() => window.app.accounts.find(a => a.name === {json.dumps(name)}).id")


def _account_history(page, account_id):
    return page.evaluate(f"() => window.app.getBalanceHistory({{ kind: 'account', id: {account_id} }})")


@pytest.mark.feature
def test_min_payment_field_visibility_follows_type(app_page):
    page = app_page
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)
    group = page.locator('#accountMinimumPaymentGroup')
    page.select_option('#accountType', label='Checking')
    assert group.is_hidden()
    page.select_option('#accountType', label='Credit Card')
    assert group.is_visible()
    page.select_option('#accountType', label='Loan')
    assert group.is_visible()


@pytest.mark.feature
def test_credit_card_account_add_and_edit_record_history(app_page):
    page = app_page
    acct_id = _add_account(page, 'Amex', 'Credit Card', '-1200', '40')
    assert page.evaluate(f"() => window.app.accounts.find(a => a.id === {acct_id}).minimumPayment") == 40
    history = _account_history(page, acct_id)
    assert len(history) == 1 and history[0]['balance'] == -1200 and history[0]['minimumPayment'] == 40

    page.evaluate("() => { window.app.balanceHistory.forEach(h => { h.date = '2026-01-01'; }); }")
    page.click(f'[data-account-action="edit"][data-account-id="{acct_id}"]')
    page.fill(f'#ac-bal-{acct_id}', '-1000')
    page.fill(f'#ac-minpay-{acct_id}', '35')
    page.click(f'[data-account-action="save"][data-account-id="{acct_id}"]')
    page.wait_for_function(f"() => window.app.balanceHistory.filter(h => h.accountId === {acct_id}).length === 2")
    history = _account_history(page, acct_id)
    assert (history[-1]['balance'], history[-1]['minimumPayment']) == (-1000, 35)
    assert page.locator(f'[data-account-action="history"][data-account-id="{acct_id}"]').count() == 1


@pytest.mark.feature
def test_checking_account_records_nothing_and_has_no_history_button(app_page):
    page = app_page
    acct_id = _add_account(page, 'Everyday', 'Checking', '500')
    assert _account_history(page, acct_id) == []
    assert page.locator(f'[data-account-action="history"][data-account-id="{acct_id}"]').count() == 0


@pytest.mark.feature
def test_account_changed_to_credit_card_starts_recording(app_page):
    page = app_page
    acct_id = _add_account(page, 'Switcher', 'Checking', '0')
    page.click(f'[data-account-action="edit"][data-account-id="{acct_id}"]')
    page.select_option(f'#ac-type-{acct_id}', 'Credit Card')
    assert page.locator(f'#ac-minpay-group-{acct_id}').is_visible()
    page.fill(f'#ac-minpay-{acct_id}', '15')
    page.click(f'[data-account-action="save"][data-account-id="{acct_id}"]')
    page.wait_for_function(f"() => window.app.balanceHistory.some(h => h.accountId === {acct_id})")
    assert _account_history(page, acct_id)[0]['minimumPayment'] == 15
    assert page.locator(f'[data-account-action="history"][data-account-id="{acct_id}"]').count() == 1


@pytest.mark.feature
def test_deleting_account_removes_its_history(app_page):
    page = app_page
    acct_id = _add_account(page, 'Old Loan', 'Loan', '-500', '50')
    assert len(_account_history(page, acct_id)) == 1
    page.click(f'[data-account-action="delete"][data-account-id="{acct_id}"]')
    page.click('#deleteConfirmBtn')
    page.wait_for_function(f"() => !window.app.accounts.some(a => a.id === {acct_id})")
    assert _account_history(page, acct_id) == []
```


- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/features/test_balance_history.py -v -k account`
Expected: FAIL — `#accountMinimumPaymentGroup` not found.

- [ ] **Step 3: Add the form field to `index.html`**

In `#accountForm`, immediately after the `accountInterestRate` `form-group` `</div>`, add:

```html
                            <div class="form-group hidden" id="accountMinimumPaymentGroup">
                                <label for="accountMinimumPayment">Minimum Payment ($)
                                    <span class="help-icon" tabindex="0" aria-label="Optional. The current minimum payment due on this credit card or loan. It is recorded in the account's balance history and does not change forecasts or the ledger.">?</span>
                                </label>
                                <input type="number" id="accountMinimumPayment" placeholder="0.00" step="0.01" min="0">
                            </div>
```

- [ ] **Step 4: Implement in `src/accounts.js`**

Add imports below the existing `ui.js` import:

```js
import { recordBalanceHistory, removeHistoryForOwner } from './balanceHistory.js';
import { isHistoryTrackedAccount, HISTORY_TRACKED_ACCOUNT_TYPES } from './balanceHistoryCore.js';
```

At the end of `updateAccountFormRetirementVisibility()` (before its closing `}`), add:

```js
    document.getElementById('accountMinimumPaymentGroup')?.classList.toggle('hidden', !HISTORY_TRACKED_ACCOUNT_TYPES.includes(typeEl?.value));
```

In the editing-card template, immediately after the `Interest Rate (% APY)` `form-group` `</div>`, add:

```js
                    <div class="form-group form-no-margin ${isHistoryTrackedAccount(a) ? '' : 'hidden'}" id="ac-minpay-group-${a.id}">
                        <label class="label-compact">Minimum Payment ($)</label>
                        <input type="number" id="ac-minpay-${a.id}" value="${Number(a.minimumPayment) || 0}" step="0.01" min="0" class="form-full-width">
                    </div>
```

In the display card's `.debt-actions`, change:

```js
                    <button class="btn-edit" data-account-action="edit" data-account-id="${a.id}">Edit</button>
```

to:

```js
                    ${isHistoryTrackedAccount(a) ? `<button class="btn btn-secondary btn-small" data-account-action="history" data-account-id="${a.id}">History</button>` : ''}
                    <button class="btn-edit" data-account-action="edit" data-account-id="${a.id}">Edit</button>
```

After the `container.onclick = (event) => { ... };` block, add:

```js
    container.onchange = (event) => {
        const typeSelect = event.target.closest('select[id^="ac-type-"]');
        if (!typeSelect) return;
        const id = typeSelect.id.slice('ac-type-'.length);
        document.getElementById(`ac-minpay-group-${id}`)?.classList.toggle('hidden', !HISTORY_TRACKED_ACCOUNT_TYPES.includes(typeSelect.value));
    };
```

In `addAccount`: after the `pensionYearsOfService` read, add

```js
    const minimumPayment = sanitizeFiniteNumber(document.getElementById('accountMinimumPayment')?.value, 0, { min: 0 });
```

add `minimumPayment` to the end of the `account` object literal (`..., pensionYearsOfService, minimumPayment };`), and after the Postgres id-swap block's closing `}` add:

```js
    await recordBalanceHistory(app, { kind: 'account', id: account.id });
```

In `deleteAccount`, after `app.accounts = app.accounts.filter(a => a.id !== id);` add:

```js
    removeHistoryForOwner(app, { kind: 'account', id });
```

In `saveEditAccount`: after the `pensionYearsOfService` read, add

```js
    const minimumPayment = sanitizeFiniteNumber(document.getElementById(`ac-minpay-${id}`)?.value, 0, { min: 0 });
```

add `minimumPayment` to the end of the `app.accounts[idx] = { ... }` spread literal, and after the `pgPatch` line add:

```js
    await recordBalanceHistory(app, { kind: 'account', id: app.accounts[idx].id });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/features/test_balance_history.py tests/features/test_accounts.py tests/features/test_retirement.py -v`
Expected: PASS. (If `tests/features/test_accounts.py` does not exist, run `pytest tests/features -k account -v`.)

- [ ] **Step 6: Commit**

```bash
git add index.html src/accounts.js tests/features/test_balance_history.py
git commit -m "feat: account minimum payment field and Credit Card/Loan balance history"
```

---

### Task 6: History modal and History buttons

**Files:**
- Create: `src/balanceHistoryModal.js`
- Modify: `index.html` (modal markup, next to `#updateBalanceModal`)
- Modify: `styles.css` (append)
- Modify: `src/debts.js` (History button + click handler)
- Modify: `src/accounts.js` (click handler)
- Modify: `src/app.js` (import + `showBalanceHistoryModal` delegate)
- Modify: `sw.js`
- Modify: `tests/features/test_balance_history.py`, `tests/security/test_xss.py`

**Interfaces:**
- Consumes: `getBalanceHistory`, `deleteBalanceHistoryEntry` (Task 3); `computeHistoryDeltas` (Task 1).
- Produces: `showBalanceHistoryModal(app, owner)`; `DebtTrackerApp.showBalanceHistoryModal(owner)`; DOM ids `#balanceHistoryModal`, `#balanceHistoryName`, `#balanceHistoryEmpty`, `#balanceHistoryChart`, `#balanceHistoryRows`, `#balanceHistoryClose`, `#balanceHistoryCloseBtn`; row delete buttons `[data-bh-delete="<id>"]`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/features/test_balance_history.py`:

```python
@pytest.mark.feature
def test_history_modal_shows_chart_table_and_rows(app_page, debt_data):
    page = app_page
    create_debt(page, debt_data)
    debt_id = _only_debt_id(page)
    page.evaluate("() => { window.app.balanceHistory[0].date = '2026-01-01'; }")
    page.evaluate(f"() => window.app.updateDebtBalance({debt_id}, 2000, 80)")

    page.click(f'[data-debt-action="history"][data-debt-id="{debt_id}"]')
    modal = page.locator('#balanceHistoryModal')
    modal.wait_for(state='visible')
    assert page.locator('#balanceHistoryName').text_content() == debt_data['name']
    assert page.locator('#balanceHistoryRows tr').count() == 2
    # newest first
    assert '2,000' in page.locator('#balanceHistoryRows tr').first.text_content()
    assert page.locator('#balanceHistoryChart-sr-table').count() == 1
    assert page.locator('#balanceHistoryEmpty').is_hidden()

    page.keyboard.press('Escape')
    modal.wait_for(state='hidden')


@pytest.mark.feature
def test_history_button_present_on_archived_and_fixed_debts(app_page):
    page = app_page
    page.evaluate("""() => {
        window.app.debts = [
            { id: 51, name: 'Paid Card', debtType: 'creditCard', accountBalance: 0, minimumPayment: 0, interestRate: 10, dueDate: 1, archived: true },
            { id: 52, name: 'Daycare', debtType: 'fixedAmount', fixedAmount: 900, minimumPayment: 900, fixedStartDate: '2026-01-01', fixedEndDate: '2027-01-01' }
        ];
        window.app.settings = [{ key: 'showArchivedDebts', value: true }];
        window.app.updateUI();
    }""")
    page.click('button[data-page="liabilities"]')
    assert page.locator('[data-debt-action="history"][data-debt-id="52"]').count() == 1
    assert page.locator('[data-debt-action="history"][data-debt-id="51"]').count() == 1


@pytest.mark.feature
def test_fixed_amount_modal_uses_monthly_amount_column(app_page):
    page = app_page
    page.evaluate("""() => {
        window.app.debts = [{ id: 52, name: 'Daycare', debtType: 'fixedAmount', fixedAmount: 900, minimumPayment: 900, fixedStartDate: '2026-01-01', fixedEndDate: '2027-01-01' }];
        window.app.balanceHistory = [
            { id: 1, debtId: 52, accountId: null, date: '2026-01-01', balance: null, minimumPayment: 900 },
            { id: 2, debtId: 52, accountId: null, date: '2026-05-01', balance: null, minimumPayment: 950 }
        ];
        window.app.showBalanceHistoryModal({ kind: 'debt', id: 52 });
    }""")
    page.locator('#balanceHistoryModal').wait_for(state='visible')
    assert page.locator('#bhColMin').text_content() == 'Monthly amount'
    assert 'bh-table--fixed' in page.locator('.bh-table').get_attribute('class')


@pytest.mark.feature
def test_delete_entry_requires_two_clicks_and_last_delete_shows_empty_state(app_page):
    page = app_page
    msgs = []
    page.on('console', lambda m: msgs.append(m) if m.type == 'error' else None)
    page.evaluate("""() => {
        window.app.debts = [{ id: 60, name: 'Visa', debtType: 'creditCard', accountBalance: 500, minimumPayment: 25, interestRate: 20, dueDate: 1 }];
        window.app.balanceHistory = [{ id: 61, debtId: 60, accountId: null, date: '2026-01-01', balance: 500, minimumPayment: 25 }];
        window.app.showBalanceHistoryModal({ kind: 'debt', id: 60 });
    }""")
    btn = page.locator('[data-bh-delete="61"]')
    btn.click()
    assert page.evaluate("() => window.app.balanceHistory.length") == 1
    assert btn.text_content() == 'Confirm'
    btn.click()
    assert page.evaluate("() => window.app.balanceHistory.length") == 0
    assert page.locator('#balanceHistoryRows tr').count() == 0
    assert page.locator('#balanceHistoryEmpty').is_visible()
    assert page.locator('#balanceHistoryChartWrap').is_hidden()
    assert msgs == []


@pytest.mark.feature
def test_account_history_button_opens_modal(app_page):
    page = app_page
    acct_id = _add_account(page, 'Mortgage', 'Loan', '-200000', '1500')
    page.click(f'[data-account-action="history"][data-account-id="{acct_id}"]')
    page.locator('#balanceHistoryModal').wait_for(state='visible')
    assert page.locator('#balanceHistoryName').text_content() == 'Mortgage'
    assert page.locator('#balanceHistoryRows tr').count() == 1
```

Append to `tests/security/test_xss.py`:

```python
@pytest.mark.security
def test_xss_in_balance_history_modal_names(app_page):
    """Debt and account names render inertly in the Balance History modal."""
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        const payload = '<img src=x onerror="window.__xss_bh=1">';
        app.debts = [{ id: 9601, name: payload, debtType: 'creditCard', accountBalance: 10, minimumPayment: 1, interestRate: 1, dueDate: 1 }];
        app.accounts = [{ id: 9602, name: payload, type: 'Loan', startingBalance: -10, minimumPayment: 1 }];
        app.balanceHistory = [
            { id: 1, debtId: 9601, accountId: null, date: '2026-01-01', balance: 10, minimumPayment: 1 },
            { id: 2, debtId: null, accountId: 9602, date: '2026-01-01', balance: -10, minimumPayment: 1 }
        ];
        app.showBalanceHistoryModal({ kind: 'debt', id: 9601 });
    }""")
    assert page.locator('#balanceHistoryName').text_content().startswith('<img')
    page.evaluate("() => window.app.showBalanceHistoryModal({ kind: 'account', id: 9602 })")
    assert not page.evaluate('() => !!window.__xss_bh'), "XSS payload executed via balance history modal"
    assert page.evaluate('() => document.querySelectorAll("#balanceHistoryModal img").length') == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/features/test_balance_history.py -v -k "modal or button or delete_entry" && pytest tests/security/test_xss.py -v -k balance_history`
Expected: FAIL — History button / modal not found; `showBalanceHistoryModal` is not a function.

- [ ] **Step 3: Add modal markup to `index.html`**

Immediately after the closing `</div>` of `#updateBalanceModal`, add:

```html
    <!-- Balance History Modal (top-level so position:fixed works from any page) -->
    <div id="balanceHistoryModal" class="modal modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="balanceHistoryTitle" tabindex="-1">
        <div class="modal-content modal-content--history">
            <button id="balanceHistoryClose" aria-label="Close" class="modal-close">&times;</button>
            <h3 id="balanceHistoryTitle">Balance History</h3>
            <p class="modal-subtitle"><strong id="balanceHistoryName"></strong></p>
            <p id="balanceHistoryEmpty" class="modal-helper-text hidden">History starts here — updates you make will be recorded.</p>
            <div class="bh-chart-wrap" id="balanceHistoryChartWrap"><canvas id="balanceHistoryChart"></canvas></div>
            <div class="bh-table-wrap">
                <table class="bh-table">
                    <thead>
                        <tr>
                            <th scope="col">Date</th>
                            <th scope="col" class="bh-col-balance">Balance</th>
                            <th scope="col" id="bhColMin">Min. payment</th>
                            <th scope="col">Change</th>
                            <th scope="col"><span class="sr-only">Actions</span></th>
                        </tr>
                    </thead>
                    <tbody id="balanceHistoryRows"></tbody>
                </table>
            </div>
            <div class="modal-actions">
                <button id="balanceHistoryCloseBtn" class="btn btn-secondary">Close</button>
            </div>
        </div>
    </div>
```

- [ ] **Step 4: Append styles to `styles.css`**

```css
/* ── Balance History modal ──────────────────────────────────────────────── */
.modal-content--history { max-width: 720px; width: 100%; }
.bh-chart-wrap { position: relative; height: 260px; margin: 12px 0; }
.bh-table-wrap { max-height: 320px; overflow-y: auto; }
.bh-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.bh-table th,
.bh-table td { padding: 6px 8px; border-bottom: 1px solid var(--border-color); text-align: right; }
.bh-table th:first-child,
.bh-table td:first-child { text-align: left; }
.bh-table--fixed .bh-col-balance { display: none; }

@media (max-width: 640px) {
    .bh-table thead { display: none; }
    .bh-table,
    .bh-table tbody,
    .bh-table tr,
    .bh-table td { display: block; width: 100%; }
    .bh-table tr { margin-bottom: 8px; border: 1px solid var(--border-color); border-radius: 8px; padding: 2px 10px; }
    .bh-table td { display: flex; justify-content: space-between; align-items: center; gap: 10px; text-align: right; }
    .bh-table td:last-child { border-bottom: none; }
    .bh-table td::before {
        content: attr(data-label);
        text-align: left;
        font-size: 0.76rem;
        letter-spacing: 0.03em;
        text-transform: uppercase;
        color: var(--text-muted);
        font-weight: 600;
    }
    .bh-table--fixed .bh-col-balance { display: none; }
}
```

- [ ] **Step 5: Create `src/balanceHistoryModal.js`**

```js
// Balance History modal — chart + delete-only entry table for one debt or
// Credit Card / Loan account. All user data is rendered via textContent.

import { formatCurrency, formatShortDate, renderChartDataTable } from './utils.js';
import { getBalanceHistory, deleteBalanceHistoryEntry } from './balanceHistory.js';
import { computeHistoryDeltas } from './balanceHistoryCore.js';

const CHART_KEY = '_balanceHistoryChart';

function destroyHistoryChart(app) {
    if (app[CHART_KEY]) { app[CHART_KEY].destroy(); app[CHART_KEY] = null; }
}

function findOwnerRecord(app, owner) {
    return owner.kind === 'debt'
        ? (app.debts || []).find(d => Number(d.id) === Number(owner.id))
        : (app.accounts || []).find(a => Number(a.id) === Number(owner.id));
}

function formatDelta(value) {
    if (value === null) return '—';
    return value > 0 ? `+${formatCurrency(value)}` : formatCurrency(value);
}

function renderHistoryChart(app, entries, isFixed, minLabel) {
    destroyHistoryChart(app);
    const canvas = document.getElementById('balanceHistoryChart');
    if (!canvas) return;
    // Hide the wrapper, not the canvas: Chart.js sets inline display styles on
    // the canvas itself that would override the .hidden class.
    document.getElementById('balanceHistoryChartWrap')?.classList.toggle('hidden', entries.length === 0);
    const staleTable = document.getElementById('balanceHistoryChart-sr-table');
    if (entries.length === 0) {
        if (staleTable) staleTable.remove();
        return;
    }
    if (typeof Chart === 'undefined') return;

    const dark = document.body.classList.contains('dark-mode');
    const grid = dark ? '#374151' : '#e5e7eb';
    const label = dark ? '#d1d5db' : '#374151';
    const money = v => formatCurrency(v);

    const datasets = [];
    if (!isFixed) {
        datasets.push({ label: 'Balance', data: entries.map(e => e.balance), borderColor: '#dc2626', yAxisID: 'y', tension: 0.3, pointRadius: 3 });
    }
    datasets.push({ label: minLabel, data: entries.map(e => e.minimumPayment), borderColor: '#2563eb', yAxisID: isFixed ? 'y' : 'y1', tension: 0.3, pointRadius: 3 });

    const scales = {
        x: { ticks: { color: label }, grid: { color: grid } },
        y: { position: 'left', ticks: { color: label, callback: money }, grid: { color: grid } }
    };
    if (!isFixed) scales.y1 = { position: 'right', ticks: { color: label, callback: money }, grid: { drawOnChartArea: false } };

    app[CHART_KEY] = new Chart(canvas, {
        type: 'line',
        data: { labels: entries.map(e => e.date), datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { color: label } },
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}` } }
            },
            scales
        }
    });

    renderChartDataTable('balanceHistoryChart', {
        caption: isFixed ? 'Monthly amount over time' : 'Balance and minimum payment over time',
        columns: isFixed ? ['Date', minLabel] : ['Date', 'Balance', minLabel],
        rows: entries.map(e => isFixed
            ? [e.date, formatCurrency(e.minimumPayment)]
            : [e.date, formatCurrency(e.balance), formatCurrency(e.minimumPayment)])
    });
}

function makeCell(text, labelText, className) {
    const td = document.createElement('td');
    td.textContent = text;
    td.dataset.label = labelText;
    if (className) td.className = className;
    return td;
}

function renderHistoryRows(app, owner, entries, isFixed, minLabel) {
    const tbody = document.getElementById('balanceHistoryRows');
    tbody.replaceChildren();
    const withDeltas = computeHistoryDeltas(entries);
    for (const entry of [...withDeltas].reverse()) {
        const tr = document.createElement('tr');
        tr.appendChild(makeCell(formatShortDate(entry.date), 'Date'));
        tr.appendChild(makeCell(entry.balance === null ? '—' : formatCurrency(entry.balance), 'Balance', 'bh-col-balance'));
        tr.appendChild(makeCell(formatCurrency(entry.minimumPayment), minLabel));
        const change = entry.minimumPaymentDelta === null
            ? '—'
            : isFixed
                ? formatDelta(entry.minimumPaymentDelta)
                : `Bal ${formatDelta(entry.balanceDelta)} · Min ${formatDelta(entry.minimumPaymentDelta)}`;
        tr.appendChild(makeCell(change, 'Change'));

        const actionTd = makeCell('', '');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-secondary btn-small';
        btn.textContent = 'Delete';
        btn.dataset.bhDelete = String(entry.id);
        btn.setAttribute('aria-label', `Delete entry from ${entry.date}`);
        btn.onclick = () => {
            if (btn.dataset.armed !== 'true') {
                btn.dataset.armed = 'true';
                btn.textContent = 'Confirm';
                btn.classList.remove('btn-secondary');
                btn.classList.add('btn-danger');
                return;
            }
            deleteBalanceHistoryEntry(app, entry.id);
            renderBalanceHistoryContent(app, owner);
        };
        actionTd.appendChild(btn);
        tr.appendChild(actionTd);
        tbody.appendChild(tr);
    }
}

function renderBalanceHistoryContent(app, owner) {
    const record = findOwnerRecord(app, owner);
    if (!record) return;
    const isFixed = owner.kind === 'debt' && record.debtType === 'fixedAmount';
    const minLabel = isFixed ? 'Monthly amount' : 'Min. payment';
    const entries = getBalanceHistory(app, owner);

    document.getElementById('balanceHistoryName').textContent = record.name;
    document.getElementById('bhColMin').textContent = minLabel;
    document.querySelector('#balanceHistoryModal .bh-table').classList.toggle('bh-table--fixed', isFixed);
    document.getElementById('balanceHistoryEmpty').classList.toggle('hidden', entries.length > 1);

    renderHistoryChart(app, entries, isFixed, minLabel);
    renderHistoryRows(app, owner, entries, isFixed, minLabel);
}

export function showBalanceHistoryModal(app, owner) {
    const modal = document.getElementById('balanceHistoryModal');
    if (!modal || !findOwnerRecord(app, owner)) return;

    const lastFocused = document.activeElement;
    modal.classList.add('flex-visible'); modal.classList.remove('hidden');
    renderBalanceHistoryContent(app, owner);
    setTimeout(() => document.getElementById('balanceHistoryCloseBtn')?.focus(), 50);

    const close = () => {
        destroyHistoryChart(app);
        modal.classList.add('hidden'); modal.classList.remove('flex-visible');
        modal.onkeydown = null;
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    };
    document.getElementById('balanceHistoryClose').onclick = close;
    document.getElementById('balanceHistoryCloseBtn').onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };
    modal.onkeydown = (e) => {
        if (e.key === 'Escape') { close(); return; }
        if (e.key === 'Tab') {
            const focusable = modal.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])');
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (!first || !last) return;
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault(); last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault(); first.focus();
            }
        }
    };
}
```

- [ ] **Step 6: Wire buttons and delegate**

`src/app.js` — add import near the Task 3 import:

```js
import { showBalanceHistoryModal as showBalanceHistoryModalFeature } from './balanceHistoryModal.js';
```

and a delegate next to the Task 3 delegates:

```js
    showBalanceHistoryModal(owner) { return showBalanceHistoryModalFeature(this, owner); }
```

`src/debts.js` — in the `.debt-actions` template, change the archived branch:

```js
                        ? `<span class="debt-archived-badge">Archived</span>
                           <button class="btn btn-secondary btn-small" data-debt-action="history" data-debt-id="${debt.id}">History</button>
                           <button class="btn btn-secondary btn-small" data-debt-action="unarchive" data-debt-id="${debt.id}">Unarchive</button>`
```

and in the non-archived branch, right after the `update-balance` button line, add:

```js
                           <button class="btn btn-secondary btn-small" data-debt-action="history" data-debt-id="${debt.id}">History</button>
```

In `debtsList.onclick`, after `if (action === 'update-balance') app.showUpdateBalanceModal(id);` add:

```js
        if (action === 'history') app.showBalanceHistoryModal({ kind: 'debt', id });
```

`src/accounts.js` — in `container.onclick`, after `if (action === 'delete') app.deleteAccount(id);` add:

```js
        if (action === 'history') app.showBalanceHistoryModal({ kind: 'account', id });
```

`sw.js` — change `'/src/utils.js', '/src/balanceHistoryCore.js', '/src/balanceHistory.js',` to:

```js
    '/src/utils.js', '/src/balanceHistoryCore.js', '/src/balanceHistory.js', '/src/balanceHistoryModal.js',
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pytest tests/features/test_balance_history.py tests/security/ tests/ui/ tests/features/test_pwa.py -v`
Expected: PASS (includes the static CSP scan — confirms no inline styles were added).

- [ ] **Step 8: Commit**

```bash
git add src/balanceHistoryModal.js src/app.js src/debts.js src/accounts.js index.html styles.css sw.js tests/features/test_balance_history.py tests/security/test_xss.py
git commit -m "feat: Balance History modal with chart, entry table, and History buttons"
```

---

### Task 7: JSON export/import (local & session storage)

**Files:**
- Modify: `src/dataExport.js` (export payload, replace + merge import branches, post-import seeding)
- Modify: `tests/features/test_balance_history.py`

**Interfaces:**
- Consumes: `remapHistoryOwners`, `excludeExistingHistory` (Task 1); `seedMissingBalanceHistory` (Task 3); `clean.balanceHistory` (Task 2).

- [ ] **Step 1: Write the failing tests**

Append to `tests/features/test_balance_history.py`:

```python
def _import_json(page, payload, replace=True):
    # A merge that skips name-duplicates calls onMergeDuplicates mid-import and
    # never calls onImported, so completion is detected via the last step both
    # import paths share: app.refreshCurrentPageData().
    return page.evaluate(
        """([json, replace]) => new Promise((resolve) => {
            const app = window.app;
            const origRefresh = app.refreshCurrentPageData;
            app.refreshCurrentPageData = function (...args) {
                app.refreshCurrentPageData = origRefresh;
                const result = origRefresh.apply(app, args);
                resolve('imported');
                return result;
            };
            const file = new File([new Blob([json], { type: 'application/json' })], 'backup.json', { type: 'application/json' });
            import('/src/dataExport.js').then(({ importAllJSON }) => {
                importAllJSON(app, file, {
                    requestImportMode: async () => replace,
                    onNoData: () => resolve('no-data'),
                    onInvalidJSON: () => resolve('invalid'),
                    onImportError: () => resolve('error')
                });
            });
        })""",
        [json.dumps(payload), replace])


BACKUP = {
    "accounts": [{"id": 700, "name": "Car Loan", "type": "Loan", "startingBalance": -9000, "minimumPayment": 210}],
    "debts": [{"id": 100, "name": "Visa", "debtType": "creditCard", "accountBalance": 800, "minimumPayment": 30,
               "interestRate": 20, "dueDate": 5}],
    "balanceHistory": [
        {"id": 1, "debtId": 100, "date": "2026-01-01", "balance": 1000, "minimumPayment": 40},
        {"id": 2, "debtId": 100, "date": "2026-05-01", "balance": 800, "minimumPayment": 30},
        {"id": 3, "accountId": 700, "date": "2026-02-01", "balance": -9500, "minimumPayment": 210},
        {"id": 4, "debtId": 555, "date": "2026-02-01", "balance": 1, "minimumPayment": 1}
    ]
}


@pytest.mark.feature
def test_replace_import_remaps_owner_ids_and_drops_orphans(app_page):
    page = app_page
    assert _import_json(page, BACKUP, replace=True) == 'imported'
    state = page.evaluate("() => ({ debts: window.app.debts, accounts: window.app.accounts, history: window.app.balanceHistory })")
    debt_id = state['debts'][0]['id']
    acct_id = state['accounts'][0]['id']
    assert state['accounts'][0]['minimumPayment'] == 210
    debt_rows = sorted([h for h in state['history'] if h['debtId'] == debt_id], key=lambda h: h['date'])
    assert [h['balance'] for h in debt_rows] == [1000, 800]
    assert [h['balance'] for h in state['history'] if h['accountId'] == acct_id] == [-9500]
    assert len(state['history']) == 3


@pytest.mark.feature
def test_merge_import_maps_to_name_matched_debt_and_skips_duplicate_dates(app_page):
    page = app_page
    page.evaluate("""() => {
        window.app.debts = [{ id: 1, name: 'Visa', debtType: 'creditCard', accountBalance: 700, minimumPayment: 28, interestRate: 20, dueDate: 5 }];
        window.app.accounts = [];
        window.app.balanceHistory = [{ id: 11, debtId: 1, accountId: null, date: '2026-05-01', balance: 777, minimumPayment: 28 }];
        window.app.saveToStorage();
    }""")
    assert _import_json(page, BACKUP, replace=False) == 'imported'
    history = page.evaluate("() => window.app.balanceHistory")
    visa = sorted([h for h in history if h['debtId'] == 1], key=lambda h: h['date'])
    # 2026-01-01 imported; 2026-05-01 already existed and keeps its local value.
    assert [(h['date'], h['balance']) for h in visa] == [('2026-01-01', 1000), ('2026-05-01', 777)]


@pytest.mark.feature
def test_legacy_import_without_history_is_seeded(app_page):
    page = app_page
    legacy = {k: v for k, v in BACKUP.items() if k != 'balanceHistory'}
    assert _import_json(page, legacy, replace=True) == 'imported'
    history = page.evaluate("() => window.app.balanceHistory")
    assert len([h for h in history if h['debtId'] is not None]) == 1
    assert len([h for h in history if h['accountId'] is not None]) == 1


@pytest.mark.feature
def test_export_includes_balance_history(app_page):
    page = app_page
    page.evaluate("""() => {
        window.app.debts = [{ id: 1, name: 'Visa', debtType: 'creditCard', accountBalance: 700, minimumPayment: 28, interestRate: 20, dueDate: 5 }];
        window.app.balanceHistory = [{ id: 11, debtId: 1, accountId: null, date: '2026-05-01', balance: 700, minimumPayment: 28 }];
    }""")
    with page.expect_download() as dl:
        page.evaluate("() => import('/src/dataExport.js').then(m => m.exportAllJSON(window.app))")
    exported = json.loads(open(dl.value.path(), encoding='utf-8').read())
    assert exported['balanceHistory'] == [{"id": 11, "debtId": 1, "accountId": None, "date": "2026-05-01", "balance": 700, "minimumPayment": 28}]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/features/test_balance_history.py -v -k "import or export"`
Expected: FAIL — imported `balanceHistory` empty / export lacks the key.

- [ ] **Step 3: Implement in `src/dataExport.js`**

Add imports:

```js
import { remapHistoryOwners, excludeExistingHistory } from './balanceHistoryCore.js';
import { seedMissingBalanceHistory } from './balanceHistory.js';
```

In `exportAllJSON`'s `payload`, after `retirementSnapshots: app.retirementSnapshots || [],` add:

```js
        balanceHistory: app.balanceHistory || [],
```

In the import handler, after `const incomingRetirementSnapshots = clean.retirementSnapshots;` add:

```js
        const incomingBalanceHistory = clean.balanceHistory || [];
```

In the **replace** branch, after `app.retirementSnapshots = incomingRetirementSnapshots.map(...);` add:

```js
            // Debts get fresh ids by index; accounts keep their ids in replace mode.
            const debtIdMap = new Map(validDebts.map((d, i) => [d.id, app.debts[i].id]));
            const accountIdMap = new Map(app.accounts.map(a => [a.id, a.id]));
            app.balanceHistory = remapHistoryOwners(incomingBalanceHistory, debtIdMap, accountIdMap)
                .map((h, i) => ({ ...h, id: Date.now() + 8000 + i }));
```

In the **merge** branch, after `app.retirementSnapshots = [...app.retirementSnapshots, ...];` add:

```js
            // Name-matched debts/accounts resolve to the surviving record's id.
            const debtIdByName = new Map(app.debts.map(d => [d.name.toLowerCase(), d.id]));
            const accountIdByName = new Map(app.accounts.map(a => [a.name.toLowerCase(), a.id]));
            const debtIdMap = new Map(validDebts.map(d => [d.id, debtIdByName.get(d.name.toLowerCase())]));
            const accountIdMap = new Map(incomingAccounts.map(a => [a.id, accountIdByName.get(a.name.toLowerCase())]));
            const remappedHistory = remapHistoryOwners(incomingBalanceHistory, debtIdMap, accountIdMap);
            app.balanceHistory = [
                ...(app.balanceHistory || []),
                ...excludeExistingHistory(app.balanceHistory || [], remappedHistory)
                    .map((h, i) => ({ ...h, id: Date.now() + 8000 + i }))
            ];
```

Right before the local-path `app.saveToStorage();` that follows the `if (incomingStrategy) { ... }` block, add:

```js
        await seedMissingBalanceHistory(app);
```

In the Postgres path (the `if (app._storageBackendKind === 'postgres') { ... }` block), right before its `app.updateUI();`, add the same line:

```js
            await seedMissingBalanceHistory(app);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/features/test_balance_history.py tests/features/test_retirement.py tests/features -k "import or export" -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dataExport.js tests/features/test_balance_history.py
git commit -m "feat: export/import balance history with owner id remapping"
```

---

### Task 8: Postgres server — table, route, null-sanitizer guard, account column

**Files:**
- Create: `server/migrations/1755600000017_add-balance-history.js`
- Create: `server/src/routes/balanceHistory.js`
- Modify: `server/src/crudRouter.js` (POST + PATCH null guard)
- Modify: `server/src/routes/accounts.js` (column)
- Modify: `server/src/app.js` (mount)
- Modify: `src/storage.js` (`POSTGRES_RESOURCE_ENDPOINTS`)
- Modify: `src/postgresSync.js` (`ALL_RESOURCE_PATHS`)
- Modify: `server/test/crudResources.test.js`
- Create: `server/test/balanceHistory.test.js`

**Interfaces:**
- Consumes: `sanitizeBalanceHistoryEntry` (re-exported automatically by `server/src/sanitizers/index.js` via `export *`).
- Produces: `GET/POST/PATCH/DELETE /api/balance-history`; `accounts.minimumPayment` persisted.

- [ ] **Step 1: Write the failing server tests**

In `server/test/crudResources.test.js`, add to the `cases` array (after the retirement-snapshots case):

```js
    {
        path: '/api/balance-history',
        validPayload: () => ({ accountId, date: '2026-01-01', balance: -500, minimumPayment: 25 }),
        updatePayload: { balance: -450 },
        updatedField: 'balance',
        updatedValue: -450,
        invalidPayload: () => ({ date: '2026-01-01' })
    }
```

Create `server/test/balanceHistory.test.js`:

```js
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';

let server, baseUrl, cookies, accountId, debtId;

before(() => {
    server = createApp().listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    server.close();
    await pool.end();
});

function headers() {
    const csrfToken = cookies.match(/csrf=([^;]+)/)[1];
    return { 'Content-Type': 'application/json', Cookie: cookies, 'X-CSRF-Token': csrfToken };
}

async function post(path, body) {
    return fetch(`${baseUrl}${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
}

async function list(path) {
    return (await fetch(`${baseUrl}${path}`, { headers: { Cookie: cookies } })).json();
}

beforeEach(async () => {
    await resetDb();
    const user = await createTestUser();
    const loginRes = await loginTestUser(baseUrl, user.email, user.password);
    cookies = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    accountId = (await (await post('/api/accounts', { name: 'Visa', type: 'Credit Card', startingBalance: -100, minimumPayment: 35 })).json()).id;
    debtId = (await (await post('/api/debts', { name: 'Visa Debt', debtType: 'creditCard', accountBalance: 100, minimumPayment: 10, interestRate: 20, dueDate: 1 })).json()).id;
});

test('account minimumPayment round-trips', async () => {
    const accounts = await list('/api/accounts');
    assert.equal(accounts[0].minimumPayment, 35);
});

test('debt-owned entry with null balance (fixed amount) is stored', async () => {
    const res = await post('/api/balance-history', { debtId, date: '2026-01-01', balance: null, minimumPayment: 800 });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.debtId, debtId);
    assert.equal(body.accountId, null);
    assert.equal(body.balance, null);
    assert.equal(body.minimumPayment, 800);
    assert.equal(body.date, '2026-01-01');
});

test('rejects both owners and neither owner with 400 (not 500)', async () => {
    const both = await post('/api/balance-history', { debtId, accountId, date: '2026-01-01' });
    assert.equal(both.status, 400);
    const neither = await post('/api/balance-history', { date: '2026-01-01' });
    assert.equal(neither.status, 400);
});

test('PATCH that would clear the date is rejected with 400', async () => {
    const created = await (await post('/api/balance-history', { accountId, date: '2026-01-01', balance: -1 })).json();
    const res = await fetch(`${baseUrl}/api/balance-history/${created.id}`, {
        method: 'PATCH', headers: headers(), body: JSON.stringify({ date: 'garbage' })
    });
    assert.equal(res.status, 400);
});

test('deleting a debt cascades its history; deleting an account cascades its history', async () => {
    await post('/api/balance-history', { debtId, date: '2026-01-01', balance: 1 });
    await post('/api/balance-history', { accountId, date: '2026-01-01', balance: -1 });
    assert.equal((await list('/api/balance-history')).length, 2);

    await fetch(`${baseUrl}/api/debts/${debtId}`, { method: 'DELETE', headers: headers() });
    const afterDebt = await list('/api/balance-history');
    assert.equal(afterDebt.length, 1);
    assert.equal(afterDebt[0].accountId, accountId);

    await fetch(`${baseUrl}/api/accounts/${accountId}`, { method: 'DELETE', headers: headers() });
    assert.equal((await list('/api/balance-history')).length, 0);
});

test("rejects a debtId belonging to another user (IDOR)", async () => {
    const other = await createTestUser('other@example.com', 'another correct horse battery');
    const otherLogin = await loginTestUser(baseUrl, other.email, other.password);
    const otherCookies = otherLogin.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const otherCsrf = otherCookies.match(/csrf=([^;]+)/)[1];
    const res = await fetch(`${baseUrl}/api/balance-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: otherCookies, 'X-CSRF-Token': otherCsrf },
        body: JSON.stringify({ debtId, date: '2026-01-01', balance: 1 })
    });
    assert.equal(res.status, 400);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Server tests need the Postgres test DB. Check how CI runs them: `grep -n "test" server/docker-compose.test.yml .github/workflows/*.yml | head -20`, then run the same command (typically `docker compose -f server/docker-compose.test.yml up -d` then `cd server && npm test`).
Expected: FAIL — `/api/balance-history` 404; `minimumPayment` undefined.

- [ ] **Step 3: Create the migration**

`server/migrations/1755600000017_add-balance-history.js`:

```js
export const shorthands = undefined;

// First migration that alters a populated table (accounts). ADD COLUMN with a
// constant NOT NULL DEFAULT is safe forward: existing rows are backfilled with
// 0. down() drops the column, discarding any user-entered account minimum
// payments -- accepted because the field is informational and new in this
// migration (see docs/superpowers/specs/2026-09-28-balance-history-design.md).
export async function up(pgm) {
    pgm.sql(`
        ALTER TABLE accounts ADD COLUMN minimum_payment numeric NOT NULL DEFAULT 0;

        CREATE TABLE balance_history (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            debt_id bigint REFERENCES debts(id) ON DELETE CASCADE,
            account_id bigint REFERENCES accounts(id) ON DELETE CASCADE,
            date date NOT NULL,
            balance numeric,
            minimum_payment numeric NOT NULL DEFAULT 0,
            CONSTRAINT balance_history_one_owner CHECK ((debt_id IS NULL) <> (account_id IS NULL))
        );

        CREATE INDEX idx_balance_history_user_id ON balance_history (user_id);
        CREATE INDEX idx_balance_history_debt_id ON balance_history (debt_id);
        CREATE INDEX idx_balance_history_account_id ON balance_history (account_id);
    `);
}

export async function down(pgm) {
    pgm.sql(`
        DROP TABLE balance_history;
        ALTER TABLE accounts DROP COLUMN minimum_payment;
    `);
}
```

- [ ] **Step 4: Route, guard, account column, mount**

`server/src/routes/balanceHistory.js`:

```js
import { createCrudResource } from '../crudRouter.js';
import { sanitizeBalanceHistoryEntry } from '../sanitizers/index.js';

// "Exactly one of debtId / accountId" can't be expressed via requiredFields;
// sanitizeBalanceHistoryEntry returns null for it (-> 400) and the
// balance_history_one_owner CHECK constraint backs it up.
export default createCrudResource({
    table: 'balance_history',
    sanitize: sanitizeBalanceHistoryEntry,
    foreignKeys: { debtId: 'debts', accountId: 'accounts' },
    columns: {
        id: 'id',
        debtId: 'debt_id',
        accountId: 'account_id',
        date: 'date',
        balance: 'balance',
        minimumPayment: 'minimum_payment'
    }
});
```

`server/src/crudRouter.js` — in the POST handler, change:

```js
            const clean = sanitize(req.body, Date.now());
            if (requiredFields.some(f => isMissing(clean[f]))) {
```

to:

```js
            const clean = sanitize(req.body, Date.now());
            if (!clean) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid payload' } });
            }
            if (requiredFields.some(f => isMissing(clean[f]))) {
```

and in the PATCH handler, change:

```js
            const clean = sanitize(merged, existing.rows[0].id);
            if (requiredFields.some(f => isMissing(clean[f]))) {
```

to:

```js
            const clean = sanitize(merged, existing.rows[0].id);
            if (!clean) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid payload' } });
            }
            if (requiredFields.some(f => isMissing(clean[f]))) {
```

`server/src/routes/accounts.js` — change the last column line to:

```js
        pensionYearsOfService: 'pension_years_of_service',
        minimumPayment: 'minimum_payment'
```

`server/src/app.js` — add `import balanceHistoryRouter from './routes/balanceHistory.js';` after the `retirementSnapshotsRouter` import, and `api.use('/balance-history', balanceHistoryRouter);` after `api.use('/retirement-snapshots', retirementSnapshotsRouter);`.

`src/storage.js` — in `POSTGRES_RESOURCE_ENDPOINTS`, change `retirementSnapshots: '/api/retirement-snapshots'` to:

```js
    retirementSnapshots: '/api/retirement-snapshots',
    balanceHistory: '/api/balance-history'
```

`src/postgresSync.js` — in `ALL_RESOURCE_PATHS`, after `'/api/retirement-snapshots',` add:

```js
    '/api/balance-history',
```

- [ ] **Step 5: Run tests to verify they pass**

Run the server suite the same way as Step 2 (e.g. `cd server && npm test`).
Expected: PASS, including the existing crud cases (the null guard doesn't affect sanitizers that never return null).

- [ ] **Step 6: Commit**

```bash
git add server/migrations/1755600000017_add-balance-history.js server/src/routes/balanceHistory.js server/src/crudRouter.js server/src/routes/accounts.js server/src/app.js src/storage.js src/postgresSync.js server/test/crudResources.test.js server/test/balanceHistory.test.js
git commit -m "feat(server): balance_history table and /api/balance-history route"
```

---

### Task 9: Postgres bulk import/rollback for balance history

**Files:**
- Modify: `src/postgresImport.js` (`snapshotAppState`, `postAllResources`, `applyResultsToApp`, `snapshotToPostData`, `mergeForPostgres`)
- Create: `tests/postgres/test_postgres_balance_history.py`

**Interfaces:**
- Consumes: `remapHistoryOwners`, `excludeExistingHistory` (Task 1); `/api/balance-history` (Task 8).
- Produces: `postAllResources(data)` result gains `balanceHistoryResults: entry[]`.

- [ ] **Step 1: Write the failing Postgres integration tests**

Create `tests/postgres/test_postgres_balance_history.py`:

```python
"""
Balance history Postgres integration tests -- require docker-compose stack.
Run: pytest tests/postgres/test_postgres_balance_history.py -v
"""
import json
import pytest

from tests.postgres.test_postgres_mutations import _login, _api_get, _api_post, _wait_for_app_ready

pytestmark = pytest.mark.asyncio


async def _reset(page, base_url):
    await page.evaluate("() => import('/src/postgresSync.js').then(m => m.pgDeleteAll(window.app))")
    await page.reload()
    await _wait_for_app_ready(page)


async def _import(page, payload, replace):
    return await page.evaluate(
        """([json, replace]) => new Promise((resolve) => {
            // Resolve on refreshCurrentPageData(), the last step of a successful
            // import (onImported is skipped when merge reports name duplicates).
            const app = window.app;
            const origRefresh = app.refreshCurrentPageData;
            app.refreshCurrentPageData = function (...args) {
                app.refreshCurrentPageData = origRefresh;
                const result = origRefresh.apply(app, args);
                resolve('imported');
                return result;
            };
            const file = new File([new Blob([json], { type: 'application/json' })], 'b.json', { type: 'application/json' });
            import('/src/dataExport.js').then(({ importAllJSON }) => importAllJSON(app, file, {
                requestImportMode: async () => replace,
                onImportError: () => resolve('error'),
                onNoData: () => resolve('no-data')
            }));
        })""",
        [json.dumps(payload), replace])


BACKUP = {
    "accounts": [{"id": 700, "name": "Car Loan", "type": "Loan", "startingBalance": -9000, "minimumPayment": 210}],
    "debts": [{"id": 100, "name": "Visa", "debtType": "creditCard", "accountBalance": 800, "minimumPayment": 30,
               "interestRate": 20, "dueDate": 5}],
    "balanceHistory": [
        {"id": 1, "debtId": 100, "date": "2026-01-01", "balance": 1000, "minimumPayment": 40},
        {"id": 2, "debtId": 100, "date": "2026-05-01", "balance": 800, "minimumPayment": 30},
        {"id": 3, "accountId": 700, "date": "2026-02-01", "balance": -9500, "minimumPayment": 210}
    ]
}


async def test_update_balance_persists_history(pg_page, base_url, credentials):
    await _login(pg_page, base_url, credentials)
    await _reset(pg_page, base_url)
    r = await _api_post(pg_page, base_url, '/api/debts', {
        'name': 'PG Visa', 'debtType': 'creditCard', 'accountBalance': 500, 'minimumPayment': 25, 'interestRate': 20, 'dueDate': 1})
    debt_id = (await r.json())['id']
    await pg_page.reload()
    await _wait_for_app_ready(pg_page)  # load-time seeding POSTs the first entry

    await pg_page.evaluate(
        f"() => {{ window.app.balanceHistory.forEach(h => {{ h.date = '2026-01-01'; }}); }}")
    rows = await (await _api_get(pg_page, base_url, '/api/balance-history')).json()
    seeded = [h for h in rows if h['debtId'] == debt_id]
    assert len(seeded) == 1

    await pg_page.evaluate(f"() => window.app.updateDebtBalance({debt_id}, 400, 20)")
    rows = await (await _api_get(pg_page, base_url, '/api/balance-history')).json()
    assert sorted(h['balance'] for h in rows if h['debtId'] == debt_id) == [400, 500]


async def test_replace_import_remaps_to_server_ids(pg_page, base_url, credentials):
    await _login(pg_page, base_url, credentials)
    await _reset(pg_page, base_url)
    assert await _import(pg_page, BACKUP, True) == 'imported'
    debts = await (await _api_get(pg_page, base_url, '/api/debts')).json()
    accounts = await (await _api_get(pg_page, base_url, '/api/accounts')).json()
    rows = await (await _api_get(pg_page, base_url, '/api/balance-history')).json()
    assert accounts[0]['minimumPayment'] == 210
    assert sorted(h['balance'] for h in rows if h['debtId'] == debts[0]['id']) == [800, 1000]
    assert [h['balance'] for h in rows if h['accountId'] == accounts[0]['id']] == [-9500]
    assert len(rows) == 3


async def test_merge_import_maps_to_existing_debt(pg_page, base_url, credentials):
    await _login(pg_page, base_url, credentials)
    await _reset(pg_page, base_url)
    r = await _api_post(pg_page, base_url, '/api/debts', {
        'name': 'Visa', 'debtType': 'creditCard', 'accountBalance': 700, 'minimumPayment': 28, 'interestRate': 20, 'dueDate': 5})
    debt_id = (await r.json())['id']
    await _api_post(pg_page, base_url, '/api/balance-history', {'debtId': debt_id, 'date': '2026-05-01', 'balance': 777, 'minimumPayment': 28})
    await pg_page.reload()
    await _wait_for_app_ready(pg_page)

    assert await _import(pg_page, BACKUP, False) == 'imported'
    rows = await (await _api_get(pg_page, base_url, '/api/balance-history')).json()
    visa = sorted([(h['date'], h['balance']) for h in rows if h['debtId'] == debt_id])
    assert visa == [('2026-01-01', 1000), ('2026-05-01', 777)]
```

(`pgDeleteAll(app)` is an exported async function in `src/postgresSync.js`; `tests/postgres/` is a package with `__init__.py`, so the helpers import directly from `test_postgres_mutations.py`.)

- [ ] **Step 2: Run tests to verify they fail**

Start the stack: `docker compose up -d` (per `tests/postgres` README/CI job).
Run: `pytest tests/postgres/test_postgres_balance_history.py -v`
Expected: `test_update_balance_persists_history` PASSES already (Tasks 3–8); the two import tests FAIL — no `balance_history` rows after import.

- [ ] **Step 3: Implement in `src/postgresImport.js`**

Add import:

```js
import { remapHistoryOwners, excludeExistingHistory } from './balanceHistoryCore.js';
```

Add a helper above `postAllResources`:

```js
// idMap is a plain object keyed by stringified local account ids.
function accountIdMapFrom(idMap) {
    return new Map(Object.entries(idMap).map(([localId, serverId]) => [Number(localId), serverId]));
}
```

`snapshotAppState` — after `retirementSnapshots: ...,` add:

```js
        balanceHistory:        (app.balanceHistory || []).map(r => ({ ...r })),
```

`postAllResources` — after the `resourceResults` `Promise.all` block, add:

```js
    // Balance history FKs to debts (which remapFk doesn't handle), so it is
    // posted after debts exist, remapping debtId via the debt POST responses.
    const debtsIndex = CRUD_RESOURCES.findIndex(r => r.field === 'debts');
    const debtIdMap = new Map();
    (data.debts || []).forEach((d, i) => {
        const rec = resourceResults[debtsIndex][i];
        if (rec) debtIdMap.set(d.id, rec.id);
    });
    const balanceHistoryResults = await Promise.all(
        remapHistoryOwners(data.balanceHistory || [], debtIdMap, accountIdMapFrom(idMap))
            .map(h => apiFetch('POST', '/api/balance-history', h))
    );
```

and change the return to:

```js
    return { accountResults, personResults, resourceResults, balanceHistoryResults, idMap, personIdMap, overrideEntries, clearedEntries };
```

`applyResultsToApp` — change its destructured parameter to include `balanceHistoryResults`, and after the `CRUD_RESOURCES.forEach(...)` block add:

```js
    app.balanceHistory = (balanceHistoryResults || []).filter(Boolean);
```

`snapshotToPostData` — after `retirementSnapshots: snapshot.retirementSnapshots,` add:

```js
        balanceHistory:        snapshot.balanceHistory,
```

`mergeForPostgres` — after the `for (const { field, path } of CRUD_RESOURCES) { ... }` loop, add:

```js
        // Balance history: debts are name-deduped, so resolve each incoming
        // debt to the surviving (existing or newly posted) debt by name.
        const debtIdByName = new Map(app.debts.map(d => [d.name?.toLowerCase(), d.id]));
        const debtIdMap = new Map((clean.debts || []).map(d => [d.id, debtIdByName.get(d.name?.toLowerCase())]));
        const historyToPost = excludeExistingHistory(
            app.balanceHistory || [],
            remapHistoryOwners(clean.balanceHistory || [], debtIdMap, accountIdMapFrom(idMap))
        );
        const historyResults = await Promise.all(historyToPost.map(h => apiFetch('POST', '/api/balance-history', h)));
        historyResults.forEach(rec => {
            if (rec) {
                newlyCreatedPaths.push(`/api/balance-history/${rec.id}`);
                (app.balanceHistory = app.balanceHistory || []).push(rec);
            }
        });
```

and in the merge rollback `Object.assign(app, { ... })`, after `retirementSnapshots:  snapshot.retirementSnapshots,` add:

```js
            balanceHistory:       snapshot.balanceHistory,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/postgres/test_postgres_balance_history.py tests/postgres/test_postgres_import.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/postgresImport.js tests/postgres/test_postgres_balance_history.py
git commit -m "feat: Postgres import/rollback remaps balance history owners"
```

---

### Task 10: Version bump, changelog, docs, full verification

**Files:**
- Modify: `src/utils.js` (`APP_VERSION`)
- Modify: `sw.js` (`CACHE_NAME`)
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md`
- Modify: `README.md` only if it lists the version or a feature list (`grep -n "6.4.0\|Retirement" README.md`)

- [ ] **Step 1: Bump versions**

`src/utils.js`: `export const APP_VERSION = '6.5.0';`
`sw.js`: `const CACHE_NAME = 'myfinances-v6.5.0';`

- [ ] **Step 2: Add the changelog entry at the top of `CHANGELOG.md`** (above `## [6.4.0]`)

```markdown
## [6.5.0] — 2026-09-28

### Added
- **Balance history** — every debt (Credit Card / Interest-bearing and Fixed Amount) and every Credit Card / Loan account now keeps a dated history of its balance and minimum payment. Entries are recorded automatically on add, Update Balance, Edit, and inline edit (one entry per item per day — a later change the same day updates that day's entry; saves that change nothing record nothing). Existing data is seeded on first load from the stored original and current values. A new **History** button on debt cards and Credit Card / Loan account cards opens a modal with a balance / minimum-payment chart (with a screen-reader data table) and a per-entry table with delete. History round-trips through JSON export/import (owner ids remapped; merge skips dates already present) and all three storage backends, including a new `balance_history` Postgres table (`/api/balance-history`) whose rows cascade-delete with their debt or account.
- **Account minimum payment** — Credit Card and Loan accounts have an optional Minimum Payment field (informational; it feeds balance history only, not forecasts or the ledger).

### Fixed
- `updateDebtBalance()` no longer overwrites an `originalBalance` of `0` with the current balance.
- The generic server CRUD router now returns 400 instead of 500 when a sanitizer rejects a payload outright.
```

- [ ] **Step 3: Update `CLAUDE.md`**

In the Architecture feature-module list sentence, add `balanceHistory.js`, `balanceHistoryCore.js`, `balanceHistoryModal.js` after `accounts.js`. In "Cross-cutting features", add after the Retirement bullet:

```markdown
- **Balance history** — `app.balanceHistory` holds `{ id, debtId, accountId, date, balance, minimumPayment }` entries with exactly one owner id set (debts of both types, plus accounts of type Credit Card / Loan — `HISTORY_TRACKED_ACCOUNT_TYPES` in `src/balanceHistoryCore.js`). Fixed Amount debts store `balance: null` and their `fixedAmount` as `minimumPayment`; account entries store the user-entered `startingBalance` (not the projected balance) and the account's informational `minimumPayment` field. Every debt/account mutation site calls `recordBalanceHistory(app, { kind, id })` (`src/balanceHistory.js`), which upserts one entry per owner per day and skips unchanged values; `seedMissingBalanceHistory()` runs after load and after imports. Pure logic lives in DOM-free `balanceHistoryCore.js` (Jest/Stryker-tested). On Postgres, `balance_history` has two nullable FKs (`debt_id`, `account_id`, both `ON DELETE CASCADE`) plus a one-owner CHECK, so the client only mirrors deletes locally (`removeHistoryForOwner`). `postgresImport.js` posts balance history in a dedicated step after debts (it is deliberately *not* in `CRUD_RESOURCES`, because `remapFk` doesn't remap `debtId`). Migration `1755600000017` is the first to alter a populated table (`accounts.minimum_payment`); its `down()` drops that column.
```

- [ ] **Step 4: Full verification**

Run each and confirm PASS:

```bash
npm run test:unit
pytest tests/ -v -m "not slow"
pytest tests/features/test_versioning.py tests/features/test_pwa.py tests/security/ -v
```

Server + Postgres suites (with the docker stacks up, as in Tasks 8–9):

```bash
cd server && npm test
pytest tests/postgres/ -v
```

Optionally run `npm run test:mutation` and confirm the score stays above the `break` threshold (38).

- [ ] **Step 5: Commit**

```bash
git add src/utils.js sw.js CHANGELOG.md CLAUDE.md README.md
git commit -m "chore: release 6.5.0 — balance history"
```
