# PWA Support — Design

**Date:** 2026-08-06
**Issue:** #75

## Summary

Add installability and offline capability to the app via a web app manifest,
a service worker, and a generated icon set — no framework, no build step,
no new runtime dependencies. This fits the app's existing "all data stays in
your browser" philosophy: static assets get cached so the app shell loads
with zero network connectivity after a first visit, on top of the
`localStorage`-backed data that already works offline.

## Decisions

| Question | Decision |
|---|---|
| Icon source | Generate PNGs from the existing header goal-logo via a zero-dependency Node script (`tools/generate-icons.js`, `zlib` only). Committed output, not run in CI. |
| Offline scope | Full app-shell precaching (network-first with offline fallback) + stale-while-revalidate runtime cache for the Chart.js CDN script — not manifest-only. |
| Update UX | New service worker installs and waits; a dismissible banner prompts "Reload" rather than silently taking over (`skipWaiting`/`clients.claim` deferred until the user opts in). |
| Cache versioning | Cache name is `myfinances-v${APP_VERSION}` — every version bump automatically invalidates old caches on next visit. |
| Scope of `sw.js` | Lives at repo root (not `src/`) so its default scope covers `/`, including `guide.html`. |
| Online app-shell strategy | Network-first with cached offline fallback. The app uses stable, unhashed URLs, so online requests must revalidate rather than cache-first indefinitely. |

## New files

### `manifest.json` (repo root)

```json
{
  "name": "MyFinances",
  "short_name": "MyFinances",
  "description": "Privacy-first personal finance tracker — debt payoff, budgets, net worth, all data stays in your browser.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#2563eb",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

### `tools/generate-icons.js` + `icons/`

One-time dev script (Node, `zlib.deflateSync` only — no image library) that
rasterizes the existing header logo (circle `#e0e7ff` fill / `#2563eb`
stroke, crosshair) into raw RGBA pixel buffers and hand-encodes minimal PNGs
(IHDR/IDAT/IEND chunks). Outputs, committed to `icons/`:

- `icon-192.png`, `icon-512.png` — full-bleed logo, `purpose: "any"`.
- `icon-maskable-512.png` — same logo shrunk to fit Android's maskable
  safe-zone (logo inside the inner ~80% circle, solid `background_color`
  fill to the edges).
- `favicon-32.png` — same design at 32×32, referenced from `<link
  rel="icon">` (the app currently has no favicon at all).

Not part of the shipped app or CI — regenerate manually if the logo design
changes, same as a designer re-exporting PNGs.

### `sw.js` (repo root, classic script — not a module)

```js
const CACHE_NAME = 'myfinances-v4.13.0'; // kept in sync with APP_VERSION by hand, checked by a test
const PRECACHE_URLS = [
  '/', '/index.html', '/styles.css', '/styles-csp-classes.css',
  '/guide.html', '/guide.css', '/manifest.json',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/icons/favicon-32.png',
  // + every src/*.js (enumerated explicitly — no build step to glob them)
];
const CDN_URL = 'https://cdn.jsdelivr.net/npm/chart.js';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('myfinances-v') && k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.url.startsWith(CDN_URL)) {
    event.respondWith(staleWhileRevalidate(request));
  } else if (request.method === 'GET' && new URL(request.url).origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  }
});
```

`networkFirst`/`staleWhileRevalidate` are small local helpers. The app-shell
strategy uses its cache only when the network is unavailable, and both
strategies keep a successful network response usable if `caches.open`/`put`
throws (e.g. private-browsing storage restrictions) — the app never depends
on the cache being writable.

### `src/serviceWorker.js` (new feature module)

`registerServiceWorker(app)` — called once from `app.js`'s
`DOMContentLoaded` handler, feature-detected:

```js
export function registerServiceWorker(app) {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
            const installing = reg.installing;
            installing?.addEventListener('statechange', () => {
                if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                    app.showUpdateAvailableBanner(reg.waiting);
                }
            });
        });
    }).catch(() => { /* registration failure is non-fatal; app works without it */ });

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
    });
}
```

### `ui.js`: `showUpdateAvailableBanner(waitingWorker)`

Same pattern as `showStorageQuotaWarning` (`storage-quota-banner` in
`styles-csp-classes.css`) — a dismissible `role="alert"` banner appended to
`document.body`, id `swUpdateBanner`, with a "Reload" button:

```js
export function showUpdateAvailableBanner(waitingWorker) {
    if (document.getElementById('swUpdateBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'swUpdateBanner';
    banner.className = 'sw-update-banner';
    banner.setAttribute('role', 'alert');

    const text = document.createElement('span');
    text.textContent = 'A new version of MyFinances is available.';

    const reloadBtn = document.createElement('button');
    reloadBtn.className = 'sw-update-banner-reload';
    reloadBtn.textContent = 'Reload';
    reloadBtn.addEventListener('click', () => waitingWorker.postMessage({ type: 'SKIP_WAITING' }));

    const closeBtn = document.createElement('button');
    closeBtn.className = 'sw-update-banner-close';
    closeBtn.setAttribute('aria-label', 'Dismiss update notice');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => banner.remove());

    banner.append(text, reloadBtn, closeBtn);
    document.body.appendChild(banner);
}
```

`app.js` gets a one-line delegating method `showUpdateAvailableBanner(waitingWorker)`
following the existing thin-wrapper pattern, and calls
`registerServiceWorker(this)` next to `window.app = new DebtTrackerApp()`.

## `index.html` changes

```html
<link rel="manifest" href="manifest.json">
<link rel="icon" href="icons/favicon-32.png">
<link rel="apple-touch-icon" href="icons/icon-192.png">
<meta name="theme-color" content="#2563eb">
```

## CSS (`styles-csp-classes.css`)

`.sw-update-banner`/`.sw-update-banner-reload`/`.sw-update-banner-close` —
copy `.storage-quota-banner`'s layout/color pattern (fixed bottom banner,
dark-mode/high-contrast coverage already established there) rather than
inventing new banner styling.

## Deploy wiring

- `Dockerfile`: `COPY` line gains `manifest.json sw.js`; new
  `COPY icons/ /usr/share/nginx/html/icons/`.
- `nginx.conf`: serve `index.html`, `manifest.json`, `sw.js`, CSS, and
  JavaScript with `Cache-Control: no-cache, must-revalidate`. These are
  stable URLs, so a one-year immutable browser cache would otherwise retain
  old releases. Images and fonts may retain the one-year immutable policy.
- No CSP changes — `sw.js` is same-origin (`script-src 'self'`), its CDN
  fetch is already covered by `connect-src https://cdn.jsdelivr.net`.

## Versioning

`APP_VERSION` (`src/utils.js`): `4.12.1` → `4.13.0` (new feature, not a
fix). `CACHE_NAME` in `sw.js` is manually kept in sync — a new
`tests/features/test_pwa.py` assertion checks `sw.js`'s `CACHE_NAME` string
contains the current `APP_VERSION`, so a future version bump that forgets to
touch `sw.js` fails CI instead of silently serving stale assets forever.

## Test impact

- `tests/security/test_static_scan.py`: `manifest.json` is valid JSON with
  required fields (`name`, `icons`, `start_url`, `display`); every icon path
  referenced in the manifest/HTML resolves to a committed file; CSP
  unchanged.
- `tests/features/test_pwa.py` (new):
  - Positive: manifest `<link>`, favicon, apple-touch-icon, theme-color meta
    all present in `index.html`; `sw.js` registers successfully and
    `navigator.serviceWorker.controller` becomes set after reload; `sw.js`'s
    `CACHE_NAME` matches `APP_VERSION`.
  - Negative: stubbing `navigator.serviceWorker` as `undefined` (simulating
    an old/unsupported browser) causes no console errors and the app still
    loads and functions.
- `tests/integration/test_pwa_offline.py` (new): load the app once (letting
  the SW precache), go offline (`context.set_offline(True)`), reload — app
  shell still renders (positive). A first-ever visit while offline correctly
  fails to load, since no SW has precached anything yet (negative, documents
  the known limitation rather than treating it as a bug).
- `tests/ui/test_pwa_update_banner.py` (new): banner appears when a mocked
  `updatefound`/`installed` sequence fires, is dismissible, and "Reload"
  posts `SKIP_WAITING` to the waiting worker.

## Docs

- `README.md`: new "Installable / offline (PWA)" section.
- `CLAUDE.md`: add a short cross-cutting-features bullet describing the
  manifest/service-worker/icon pieces and where they live.
- `DEPLOYMENT.md`: note on `sw.js`'s `no-cache` header and why it matters
  for the update flow.
- `CHANGELOG.md` + `APP_VERSION`: `4.13.0` entry under `### Added`.

## Out of scope

- No offline *write* queue or background sync — the app never talks to a
  network backend for data, only for the static Chart.js CDN script, so
  there's nothing to queue.
- No push notifications.
- No i18n for the update banner's strings — consistent with other
  dynamic/computed strings elsewhere that aren't yet on the i18n pilot
  (`toolbar.*`/`dataTransfer.*` are the only namespaces covered so far).
- `guide.html` is precached (it's linked from the toolbar and covered by
  `sw.js`'s root scope) but not otherwise changed.

## Issue #83 update

Chrome can retain a response marked `immutable` even after a new service
worker cache name is deployed. The original cache-first app-shell strategy
could also continue serving an active worker's old cache while online.
The implementation therefore uses network-first handling for same-origin
app-shell requests, with the precache as an offline fallback, and requires
browser revalidation for every stable app-shell URL.
