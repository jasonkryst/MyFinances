// Render-scoped memo for buildProjectedAccountTransactions() (issue #518).
//
// Building the projection walks every income, debt, bill, expense, transfer,
// recurring template and fund for every account. Callers such as Forecast,
// the Accounts balance sort, Health and Net Worth used to rebuild it once per
// account (and per month), so the work grew as accounts x months x records.
//
// The cache only exists inside a synchronous withProjectionCache() scope.
// Data cannot change halfway through a synchronous render, so a scope never
// serves a stale projection; outside a scope nothing is cached at all. Any
// write helper (pgPost/pgPatch/pgDelete/pgPut, override and cleared changes)
// also calls invalidateProjectionCache(), which covers the rare render that
// mutates data part-way through (e.g. reconcileRecurringPaidState).
//
// No imports on purpose: postgresSync.js and ledgerTransactions.js both import
// this module, and keeping it a leaf keeps it out of the ui.js/postgresSync.js
// import cycle described in CLAUDE.md.

let scope = null;

/**
 * Run `fn` with projections for `app` memoized. Nested scopes share the
 * outermost one; a scope for one app object never serves another (the live
 * refresh loads into a scratch object). If `fn` returns a promise, only its
 * synchronous part is covered: the scope closes when `fn` returns.
 */
export function withProjectionCache(app, fn) {
    // Nested: the outermost scope stays in charge and closes the cache. For a
    // different app object, getCachedProjection() simply doesn't cache.
    if (scope) return fn();
    scope = { app, entries: new Map() };
    try {
        return fn();
    } finally {
        scope = null;
    }
}

/** True while a scope for `app` is open. */
export function isProjectionCacheActive(app) {
    return !!scope && scope.app === app;
}

/**
 * Return the cached value for `key` when a scope for `app` is open, otherwise
 * call `build()` (and cache its result if a scope is open).
 */
export function getCachedProjection(app, key, build) {
    if (!scope || scope.app !== app) return build();
    if (scope.entries.has(key)) return scope.entries.get(key);
    const value = build();
    scope.entries.set(key, value);
    return value;
}

/** Drop every cached projection in the open scope, if any. */
export function invalidateProjectionCache() {
    if (scope) scope.entries.clear();
}
