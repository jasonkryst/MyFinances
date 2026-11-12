// Issue #518: render-scoped projection cache.
import {
    withProjectionCache, getCachedProjection, invalidateProjectionCache, isProjectionCacheActive
} from '../../src/projectionCache.js';
import {
    buildProjectedAccountTransactions, getLedgerTransactionsForMonth, getProjectionBuildCount
} from '../../src/ledgerTransactions.js';
import { computeAccountBalance } from '../../src/accounts.js';
import { computeForecastSeries } from '../../src/forecast.js';

// The audit dataset from the issue: 30 accounts, 200 recurring templates, 50 debts.
function auditApp() {
    const accounts = [];
    for (let i = 0; i < 30; i++) {
        accounts.push({
            id: `a${i}`, name: `Account ${i}`, type: i % 5 === 4 ? 'Credit Card' : 'Checking',
            startingBalance: 1000 + i * 250, interestRate: i % 3 === 0 ? 4.5 : 0
        });
    }
    const recurringTemplates = [];
    for (let i = 0; i < 200; i++) {
        recurringTemplates.push({
            id: `r${i}`, name: `Sub ${i}`, amount: 5 + (i % 40), accountId: `a${i % 30}`,
            type: i % 10 === 0 ? 'income' : (i % 15 === 0 ? 'transfer' : 'subscription'),
            targetAccountId: `a${(i + 1) % 30}`, frequency: 'monthly', dayOfMonth: (i % 28) + 1
        });
    }
    const debts = [];
    for (let i = 0; i < 50; i++) {
        debts.push({ id: `d${i}`, name: `Debt ${i}`, dueDate: (i % 28) + 1, minimumPayment: 25 + i, accountId: `a${i % 30}` });
    }
    const incomes = [];
    for (let i = 0; i < 10; i++) {
        incomes.push({ id: `i${i}`, name: `Pay ${i}`, amount: 2000, frequency: 'biweekly', firstPayDate: '2026-01-02', accountId: `a${i}` });
    }
    return {
        accounts, recurringTemplates, debts, incomes,
        bonuses: [], bills: [], expenses: [], transfers: [], emergencyFunds: [], sinkingFunds: [],
        reconciliations: [], ledgerAmountOverrides: {}, ledgerClearedTransactions: {}, settings: {}
    };
}

describe('projectionCache module', () => {
    test('outside a scope nothing is cached', () => {
        const app = {};
        let calls = 0;
        getCachedProjection(app, 'k', () => ++calls);
        getCachedProjection(app, 'k', () => ++calls);
        expect(calls).toBe(2);
        expect(isProjectionCacheActive(app)).toBe(false);
    });

    test('inside a scope the same key is built once', () => {
        const app = {};
        let calls = 0;
        const result = withProjectionCache(app, () => {
            const a = getCachedProjection(app, 'k', () => ({ n: ++calls }));
            const b = getCachedProjection(app, 'k', () => ({ n: ++calls }));
            getCachedProjection(app, 'other', () => ({ n: ++calls }));
            return a === b;
        });
        expect(result).toBe(true);
        expect(calls).toBe(2);
    });

    test('the scope closes after the call, so a later call rebuilds', () => {
        const app = {};
        let calls = 0;
        withProjectionCache(app, () => getCachedProjection(app, 'k', () => ++calls));
        withProjectionCache(app, () => getCachedProjection(app, 'k', () => ++calls));
        expect(calls).toBe(2);
        expect(isProjectionCacheActive(app)).toBe(false);
    });

    test('nested scopes share the outer cache and only the outer one closes it', () => {
        const app = {};
        let calls = 0;
        withProjectionCache(app, () => {
            getCachedProjection(app, 'k', () => ++calls);
            withProjectionCache(app, () => getCachedProjection(app, 'k', () => ++calls));
            expect(isProjectionCacheActive(app)).toBe(true);
            getCachedProjection(app, 'k', () => ++calls);
        });
        expect(calls).toBe(1);
        expect(isProjectionCacheActive(app)).toBe(false);
    });

    test('a scope for one app never serves another app object', () => {
        const app = {};
        const scratch = {};
        let calls = 0;
        withProjectionCache(app, () => {
            getCachedProjection(scratch, 'k', () => ++calls);
            getCachedProjection(scratch, 'k', () => ++calls);
            withProjectionCache(scratch, () => getCachedProjection(scratch, 'k', () => ++calls));
            expect(isProjectionCacheActive(scratch)).toBe(false);
        });
        expect(calls).toBe(3);
    });

    test('invalidate drops cached entries inside an open scope', () => {
        const app = {};
        let calls = 0;
        withProjectionCache(app, () => {
            getCachedProjection(app, 'k', () => ++calls);
            invalidateProjectionCache();
            getCachedProjection(app, 'k', () => ++calls);
        });
        expect(calls).toBe(2);
        expect(() => invalidateProjectionCache()).not.toThrow();
    });

    test('a throwing render still closes the scope', () => {
        const app = {};
        expect(() => withProjectionCache(app, () => { throw new Error('boom'); })).toThrow('boom');
        expect(isProjectionCacheActive(app)).toBe(false);
        expect(() => withProjectionCache(app, () => withProjectionCache(app, () => { throw new Error('inner'); }))).toThrow('inner');
        expect(isProjectionCacheActive(app)).toBe(false);
    });

    test('an async render is only covered for its synchronous part', async () => {
        const app = {};
        const p = withProjectionCache(app, async () => {
            expect(isProjectionCacheActive(app)).toBe(true);
            await null;
            return isProjectionCacheActive(app);
        });
        expect(isProjectionCacheActive(app)).toBe(false);
        await expect(p).resolves.toBe(false);
    });

    test('returns the value of fn', () => {
        expect(withProjectionCache({}, () => 42)).toBe(42);
    });
});

describe('projection builds (issue #518)', () => {
    test('all account balances in one scope build the month once', () => {
        const app = auditApp();
        const before = getProjectionBuildCount();
        withProjectionCache(app, () => {
            for (const a of app.accounts) computeAccountBalance(app, a.id, 2026, 5);
        });
        expect(getProjectionBuildCount() - before).toBe(1);
    });

    test('without a scope each balance rebuilds (the old cost)', () => {
        const app = auditApp();
        const before = getProjectionBuildCount();
        for (const a of app.accounts.slice(0, 3)) computeAccountBalance(app, a.id, 2026, 5);
        expect(getProjectionBuildCount() - before).toBe(3);
    });

    test('balances are identical with and without the cache', () => {
        const app = auditApp();
        const plain = app.accounts.map(a => computeAccountBalance(app, a.id, 2026, 5));
        const cached = withProjectionCache(app, () => app.accounts.map(a => computeAccountBalance(app, a.id, 2026, 5)));
        expect(cached).toEqual(plain);
    });

    test('forecast total over 12 months is unchanged and builds at most 13 projections', () => {
        const app = auditApp();
        const plain = computeForecastSeries(app, 'total', 12);
        const before = getProjectionBuildCount();
        const cached = withProjectionCache(app, () => computeForecastSeries(app, 'total', 12));
        // One 12-month horizon shared by every account, plus one per month for the intra-month low.
        expect(getProjectionBuildCount() - before).toBeLessThanOrEqual(13);
        expect(cached).toEqual(plain);
    });

    test('forecast total intra-month lows match the old per-account walk', () => {
        const app = auditApp();
        // Same-day transactions on different accounts make the walk order matter.
        app.accounts.push({ id: 7, name: 'Numeric id', type: 'Checking', startingBalance: 50 });
        app.recurringTemplates.push({ id: 'rx', name: 'Big', amount: 900, accountId: 7, frequency: 'monthly', dayOfMonth: 1, type: 'subscription' });
        const series = computeForecastSeries(app, 'total', 12);
        const assets = app.accounts.filter(a => a.type !== 'Credit Card' && a.type !== 'Loan');
        for (let i = 1; i < series.length; i++) {
            const txs = [];
            for (const a of assets) txs.push(...getLedgerTransactionsForMonth(app, series[i].year, series[i].month, a.id));
            txs.sort((a, b) => new Date(a.date) - new Date(b.date));
            let running = series[i - 1].balance;
            let low = running;
            for (const tx of txs) { running += tx.amount; if (running < low - 1e-9) low = running; }
            expect(series[i].lowBalance).toBeCloseTo(Math.round(low * 100) / 100, 2);
        }
    });

    test('forecast total over 12 months is several times faster with the cache', () => {
        // The absolute <150 ms target is measured in the browser (see the PR);
        // Jest's VM sandbox is too variable for a millisecond gate.
        const app = auditApp();
        computeForecastSeries(app, 'total', 12); // warm the JIT
        let start = performance.now();
        computeForecastSeries(app, 'total', 12);
        const uncached = performance.now() - start;
        start = performance.now();
        withProjectionCache(app, () => computeForecastSeries(app, 'total', 12));
        const cached = performance.now() - start;
        expect(cached * 4).toBeLessThan(uncached);
    });

    test('an override written mid-scope is visible to the next read', () => {
        const app = auditApp();
        withProjectionCache(app, () => {
            const before = computeAccountBalance(app, 'a1', 2026, 5);
            const tx = getLedgerTransactionsForMonth(app, 2026, 5, 'a1').find(x => x.type === 'debt');
            app.ledgerAmountOverrides[tx.transactionId] = { amount: tx.amount - 100 };
            // Overrides are applied when reading, so the balance moves at once.
            expect(computeAccountBalance(app, 'a1', 2026, 5)).toBeCloseTo(before - 100, 2);
        });
    });

    test('a record added mid-scope needs invalidation, which the write helpers do', () => {
        const app = auditApp();
        withProjectionCache(app, () => {
            const before = computeAccountBalance(app, 'a2', 2026, 5);
            app.debts.push({ id: 'dNew', name: 'New', dueDate: 3, minimumPayment: 40, accountId: 'a2' });
            // Stale on purpose: nothing has invalidated yet.
            expect(computeAccountBalance(app, 'a2', 2026, 5)).toBe(before);
            invalidateProjectionCache();
            expect(computeAccountBalance(app, 'a2', 2026, 5)).toBeCloseTo(before - 40, 2);
        });
    });

    test('a later scope sees edits, deletes and cleared changes', () => {
        const app = auditApp();
        const r = () => withProjectionCache(app, () => computeAccountBalance(app, 'a5', 2026, 5));
        const base = r();
        const debt = app.debts.find(d => d.accountId === 'a5');
        debt.minimumPayment += 10;                                   // edit
        expect(r()).toBeCloseTo(base - 10, 2);
        app.debts = app.debts.filter(d => d !== debt);               // delete
        expect(r()).toBeCloseTo(base + debt.minimumPayment - 10, 2);
        const tx = withProjectionCache(app, () => getLedgerTransactionsForMonth(app, 2026, 5, 'a3'))[0];
        app.ledgerClearedTransactions[tx.transactionId] = { clearedAt: '2026-06-01T00:00:00Z' };
        const cleared = withProjectionCache(app, () => getLedgerTransactionsForMonth(app, 2026, 5, 'a3'))
            .find(x => x.transactionId === tx.transactionId);
        expect(cleared.cleared).toBe(true);
    });

    test('the cached map is shared, so callers get the same object within a scope only', () => {
        const app = auditApp();
        withProjectionCache(app, () => {
            expect(buildProjectedAccountTransactions(app, 2026, 5, 1)).toBe(buildProjectedAccountTransactions(app, 2026, 5, 1));
            expect(buildProjectedAccountTransactions(app, 2026, 5, 2)).not.toBe(buildProjectedAccountTransactions(app, 2026, 5, 1));
        });
        expect(buildProjectedAccountTransactions(app, 2026, 5, 1)).not.toBe(buildProjectedAccountTransactions(app, 2026, 5, 1));
    });
});
