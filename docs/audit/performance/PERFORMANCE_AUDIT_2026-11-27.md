# Performance Audit: v8.8.6 (2026-11-27)

**Baseline:** [PERFORMANCE_SUSTAINABILITY_AUDIT_2026-11-04.md](PERFORMANCE_SUSTAINABILITY_AUDIT_2026-11-04.md). **Method:** static review and file-size inspection. **Nothing was measured this pass** (no Lighthouse, no trace, no timings), so all numbers below are sizes and structure, not latency. The previous report's measurements remain the last timing data.

## Status of the 2026-11-04 findings

| ID | Finding then | Now | Evidence |
|---|---|---|---|
| PERF-02 / PERF-12 | Unbounded import fan-out, no bulk endpoint | **Resolved** | `POST /api/import`, one transaction, 25 MB limit and 120 s read timeout in nginx (#529, 8.4.0) |
| PERF-03 | Import left stale ledger keys | **Resolved** | `ledgerKeyRemap.js` `SOURCE_MAP_BY_TYPE`, `settingsRemap.js` |
| PERF-05 | All three locales load eagerly | **Resolved** | `src/i18n.js:65-66` dynamic `import()` for `es`/`pl` (7.32.1); `en` static |
| PERF-06 | Chart.js parser-blocking | **Resolved** | `<script ... defer>` with SRI at `index.html:1509` |
| PERF-13 | Frontend healthcheck always fails | **Resolved** | `docker-compose.yml:36` uses `127.0.0.1:80` |
| PERF-14 | 4xx turned into 500s | **Resolved** | `errorHandler` in `server/src/app.js` |
| PERF-18 | Unindexed `incomes.person_id` | **Resolved** | migration 038 |
| PERF-19 | Expired sessions never pruned | **Resolved** | `jobs/pruneSessions.js` |
| PERF-22 | CLAUDE.md 80.9 KB loaded every session | **Resolved** | now 25.6 KB (164 lines) with detail moved to `docs/architecture/` |
| PERF-01 | Per-account projection recomputed for every call | **Mitigated** | `withProjectionCache(app, fn)` (rule in CLAUDE.md); not re-measured |
| PERF-04 | Every mutation PATCHes the whole plan-settings row | **Resolved** | `saveToStorage(app, fields)` sends named fields only |
| PERF-07 | SW `networkFirst` revalidates every asset every load | **Unchanged** | `sw.js` `networkFirst`; see PERF-01 below |
| PERF-08 | Long boot task | **Mitigated** | boot renders only the landing page (`deferHiddenPages`), lazy page modules, first-paint module budget test (`firstPaintModules.test.js`); #713 closed; not re-measured |
| PERF-16 | `/api/plan-settings` fetched twice at boot | **Not re-checked** | `probeServer()` still does the GET; CLAUDE.md describes the single probe |

## Size inventory (uncompressed)

| Asset | Size |
|---|---|
| `styles.css` | 309 KB (one render-blocking stylesheet) |
| `index.html` | 223 KB (all page markup in one document) |
| `src/ui.js` | 130 KB |
| `src/app.js` | 64 KB |
| `src/locales/en.js` / `es.js` / `pl.js` | 145 / 157 / 155 KB (only the active locale loads) |
| `src/` modules | 127 files, 35,794 lines in `src/*.js` |
| Modulepreload hints | 9 |

## Findings

### PERF-01 (Low, carried from PERF-07): every load revalidates every asset
`nginx.conf` sends `Cache-Control: no-cache, must-revalidate` for all `.css`/`.js` (to avoid stale app code after a release) and `sw.js` uses `networkFirst`. A warm load therefore sends one conditional request per module (about 127), CSS and HTML even when nothing changed. Behind HTTP/2 this is cheap but not free, and it costs more on a high-latency or metered phone link. The one-file `styles.css` (309 KB) and `index.html` (223 KB) are also served with gzip only (no brotli).
**Options:** (a) serve versioned, content-hashed asset URLs with `immutable` caching and keep only `index.html`/`sw.js` as `no-cache`, which needs a small release-time stamping step and keeps the "no build step" rule intact if done by the Docker build; (b) switch the service worker to stale-while-revalidate for `src/*.js` keyed by `CACHE_NAME` (the bump rule already exists); (c) enable brotli in the base image. (b) is the lowest-risk change. Measure with Lighthouse and a throttled trace before and after; the project's own CI Lighthouse audits the login gate only (#470).

### PERF-02 (Info): large single files
`index.html` and `styles.css` keep growing with each page. Splitting CSS per lazy page would let the first paint load less, but the CSP forbids inline styles, so any split must stay as `<link>` files. Not worth doing before PERF-01 is measured.

## Server
Pool of 10, 30 s statement timeout, `no-store` on API responses, hourly pruning, per-request session lookup (one indexed query, plus a throttled `last_seen_at` write). No hot spot found statically. The authenticated API has no rate limiter (SEC-03), which is a protection concern more than a performance one.

## Recommendation
Take one real Lighthouse and trace measurement of the warm and cold loads on the current release before choosing between PERF-01's options. A fresh measurement also replaces the stale 2026-11-04 timings in this folder.
