'use strict';

// Kept in sync with APP_VERSION (src/utils.js) by hand -- every version bump
// must touch this string too, or old cached assets never get evicted.
// Checked by tests/features/test_pwa.py::test_sw_cache_name_matches_app_version.
const CACHE_NAME = 'myfinances-v4.15.1';

const CDN_URL = 'https://cdn.jsdelivr.net/npm/chart.js';

// The whole app shell -- enumerated explicitly since there's no build step
// to glob these. tests/features/test_pwa.py::test_sw_precache_list_includes_every_src_js_file
// fails CI if a new src/*.js file is added here without updating this list.
const PRECACHE_URLS = [
    '/', '/index.html', '/styles.css', '/styles-csp-classes.css',
    '/guide.html', '/guide.css', '/manifest.json',
    '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/icons/favicon-32.png',
    '/src/accounts.js', '/src/app.js', '/src/bills.js', '/src/bonusAdvisor.js',
    '/src/breakEven.js', '/src/charts.js', '/src/commandPalette.js', '/src/dataExport.js',
    '/src/dataTransferModal.js', '/src/debtBreakEven.js', '/src/debtCalculator.js', '/src/debts.js',
    '/src/forecast.js', '/src/guideNav.js', '/src/guideTheme.js', '/src/health.js',
    '/src/i18n.js', '/src/income.js', '/src/ledger.js', '/src/ledgerOverrides.js',
    '/src/ledgerTransactions.js', '/src/reconciliation.js', '/src/recurring.js', '/src/reports.js',
    '/src/reportsCalendar.js', '/src/reportsCashFlow.js', '/src/reportsMoneyFlowSankey.js', '/src/reportsNetWorth.js', '/src/reportsSummary.js',
    '/src/reportsVariance.js', '/src/sanitizers.js', '/src/savings.js', '/src/serviceWorker.js',
    '/src/settings.js', '/src/setupWizard.js', '/src/spending.js', '/src/storage.js',
    '/src/storageAdapters.js', '/src/strategy.js', '/src/strategyCalendar.js', '/src/strategyComparison.js',
    '/src/strategyPlanCalculation.js', '/src/strategyScheduleTable.js', '/src/strategySummaryTable.js', '/src/ui.js',
    '/src/utils.js',
    '/src/locales/en.js', '/src/locales/es.js', '/src/locales/pl.js',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE_URLS))
            .catch((err) => console.error('[sw] precache failed', err))
    );
});

self.addEventListener('activate', (event) => {
    // Deliberately no skipWaiting()/clients.claim() here -- a new version
    // installs and waits; src/serviceWorker.js prompts the user to reload
    // instead of silently swapping assets under an open session.
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key.startsWith('myfinances-v') && key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            )
        )
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

async function networkFirst(request) {
    let response;
    try {
        response = await fetch(request);
    } catch (err) {
        try {
            const cache = await caches.open(CACHE_NAME);
            const cached = await cache.match(request);
            if (cached) return cached;
        } catch (cacheErr) {
            // Storage can be unavailable in private browsing; preserve the
            // original network error rather than making cache access required.
        }
        throw err;
    }

    try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
    } catch (err) {
        // A failed cache write must not prevent an online response from loading.
    }
    return response;
}

async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    const fetchPromise = fetch(request).then((response) => {
        cache.put(request, response.clone()).catch(() => {});
        return response;
    }).catch(() => cached);
    return cached || fetchPromise;
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    if (request.url.startsWith(CDN_URL)) {
        event.respondWith(staleWhileRevalidate(request));
    } else if (new URL(request.url).origin === self.location.origin) {
        // App-shell filenames are stable between releases. Prefer the network
        // while online so an active older worker cannot keep serving a stale
        // release; fall back to the precache only when offline.
        event.respondWith(networkFirst(request));
    }
});
