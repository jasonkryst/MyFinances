// Lazy ES-module loader (issue #278).
//
// app.js previously imported every feature module statically, so the whole
// module graph — including pages most sessions never visit (Retirement,
// Reconciliation, several Reports sub-tabs, the Strategy page's Calendar
// sub-tab) — was fetched and evaluated before DOMContentLoaded fired. This
// module provides one small, DOM-free cache keyed by a stable module name,
// wrapping native ES module dynamic import() (the no-build-step
// architecture's only available code-splitting mechanism — no bundler, no
// "magic comment" syntax needed or used).
//
// Caching contract:
//   - A module is fetched at most once. Concurrent or repeated calls for the
//     same key reuse the same in-flight/resolved promise.
//   - A failed import() (e.g. a network error) is NOT cached — the cache
//     entry is removed on rejection, so a later retry (user navigates away
//     and back) issues a fresh import() instead of being stuck forever on a
//     rejected promise.
//
// See docs/superpowers/specs/2026-10-25-dynamic-import-code-splitting-design.md
// for the full design, including which modules were deliberately kept
// static (reportsNetWorth.js, forecast.js, spending.js, and the ui.js /
// postgresSync.js / people.js circular-import cycle).

const _cache = new Map();    // key -> in-flight/resolved Promise<module namespace>
const _resolved = new Map(); // key -> resolved module namespace, once settled

/**
 * Generic cache-once-per-key wrapper around a caller-supplied importFn().
 * Exported (rather than kept private) so the caching/retry contract can be
 * unit-tested with a fake importFn — exercising a real import() of an
 * ES-module-syntax source file from Jest's CommonJS test environment isn't
 * viable (Node's native dynamic import() bypasses babel-jest's transform),
 * so tests/unit/lazyModules.test.js verifies this function directly rather
 * than loadRetirementModule()/etc.
 */
export function loadOnce(key, importFn) {
    if (!_cache.has(key)) {
        const promise = importFn()
            .then((mod) => {
                _resolved.set(key, mod);
                return mod;
            })
            .catch((err) => {
                _cache.delete(key);
                throw err;
            });
        _cache.set(key, promise);
    }
    return _cache.get(key);
}

/**
 * Synchronously read an already-resolved lazy module's namespace, or null if
 * it hasn't finished loading yet. Used by "secondary" wrapper methods that
 * are only ever reachable from DOM the module's own entry-point render
 * already produced (so by the time they can run, the module is guaranteed
 * loaded) — avoiding the correctness hazard of making every wrapper async.
 */
export function getResolvedModule(key) {
    return _resolved.get(key) || null;
}

export function loadRetirementModule() {
    return loadOnce('retirement', () => import('./retirement.js'));
}

export function loadReconciliationModule() {
    return loadOnce('reconciliation', () => import('./reconciliation.js'));
}

export function loadStrategyCalendarModule() {
    return loadOnce('strategyCalendar', () => import('./strategyCalendar.js'));
}

/**
 * The five Reports sub-tab modules (calendar, money-flow sankey, cash flow,
 * variance, summary) are loaded together as one unit — they're all reached
 * exclusively through reports.js's single renderReportsPage() dispatcher,
 * and reportsSummary.js/reportsMoneyFlowSankey.js already statically
 * cross-import reportsNetWorth.js/reportsCashFlow.js respectively, so
 * splitting them into separate cache entries would add bookkeeping with no
 * benefit (native ESM module-map memoization means no duplicate fetch
 * either way).
 */
export function loadReportsSubModules() {
    return loadOnce('reportsSubModules', () => Promise.all([
        import('./reportsCalendar.js'),
        import('./reportsMoneyFlowSankey.js'),
        import('./reportsCashFlow.js'),
        import('./reportsVariance.js'),
        import('./reportsSummary.js')
    ]).then(([calendar, sankey, cashFlow, variance, summary]) => ({
        calendar, sankey, cashFlow, variance, summary
    })));
}

/** Test-only: clears both caches so Jest can exercise the caching/retry contract in isolation. */
export function _resetLazyModuleCacheForTests() {
    _cache.clear();
    _resolved.clear();
}
