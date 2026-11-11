// Bounded-concurrency mapping for request fan-outs (issue #519).
//
// Import, merge, rollback and balance-history seeding used to start one fetch
// per record with a bare Promise.all. A backup with a few thousand Ledger
// overrides put ~2,000 requests in flight and Chromium aborted some with
// net::ERR_INSUFFICIENT_RESOURCES, failing the import and sometimes its
// rollback. These helpers keep at most `limit` calls running.
//
// Pure and import-free (tests/unit/concurrency.test.js, Stryker scope).

// Browsers open about six HTTP/1.1 connections per host, so more than six
// requests in flight would only queue inside the browser.
export const IMPORT_CONCURRENCY = 6;

function _normalizeLimit(limit) {
    const n = Math.floor(Number(limit));
    return Number.isFinite(n) && n >= 1 ? n : 1;
}

// Like Promise.all(items.map(fn)), with at most `limit` calls of `fn` running
// at once. Results keep the input order. `fn` gets (item, index).
//
// On the first rejection no further calls start; the calls already running
// are allowed to settle, and then the first error is thrown. Unlike
// Promise.all, nothing is still writing to the server when the caller's
// rollback begins.
export async function mapWithConcurrency(items, limit, fn) {
    const list = Array.from(items || []);
    const results = new Array(list.length);
    const workers = Math.min(_normalizeLimit(limit), list.length);
    let next = 0;
    let failed = false;
    let firstError;

    async function worker() {
        while (!failed && next < list.length) {
            const index = next++;
            try {
                results[index] = await fn(list[index], index);
            } catch (err) {
                if (!failed) {
                    failed = true;
                    firstError = err;
                }
            }
        }
    }

    await Promise.all(Array.from({ length: workers }, worker));
    if (failed) throw firstError;
    return results;
}

// Like Promise.allSettled(items.map(fn)), with at most `limit` calls running.
// Never rejects; every item is attempted.
export async function mapSettledWithConcurrency(items, limit, fn) {
    return mapWithConcurrency(items, limit, async (item, index) => {
        try {
            return { status: 'fulfilled', value: await fn(item, index) };
        } catch (reason) {
            return { status: 'rejected', reason };
        }
    });
}
