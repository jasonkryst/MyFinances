#!/usr/bin/env python3
"""
Offline app-shell test (GitHub issue #75).

sw.js precaches the app shell on first visit so the app can load with zero
network connectivity afterward -- this is the core "offline" promise of a
PWA. Playwright's BrowserContext.set_offline() simulates a fully disconnected
network at the browser level (distinct from just a slow/flaky connection).

Since v7.0.0 the data lives only on the server, so offline the cached shell
shows the "Can't reach your server" gate rather than any data.
"""

import time

import pytest

from tests.conftest import BASE_URL, ensure_session, wait_for_app_ready


def _wait_for_active_service_worker(page, timeout_ms=15000):
    """Polls via page.evaluate (which correctly awaits async functions) rather than
    page.wait_for_function -- in this Playwright version, wait_for_function resolves as soon as
    a predicate returns a (truthy) Promise object, without awaiting what it resolves to, which
    would make an "is it active yet" check here pass immediately regardless of real SW state."""
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        active = page.evaluate("""
            async () => {
                const reg = await navigator.serviceWorker.getRegistration();
                return !!(reg && reg.active);
            }
        """)
        if active:
            return True
    return False


@pytest.mark.integration
@pytest.mark.slow
def test_app_shell_loads_offline_after_first_visit(browser):
    context = browser.new_context()
    ensure_session(context)
    page = context.new_page()

    # First visit online: lets sw.js install and precache the app shell.
    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
    wait_for_app_ready(page)
    assert _wait_for_active_service_worker(page), "Expected an active service worker after the first online visit"

    context.set_offline(True)
    page.reload(wait_until="load", timeout=15000)

    assert page.is_visible('h1'), "Expected the app shell to render from cache while offline"
    assert page.title() != "", "Expected a real page title, not a browser offline-error page"

    context.set_offline(False)
    context.close()


@pytest.mark.integration
@pytest.mark.slow
def test_offline_reload_shows_unreachable_gate_then_recovers(browser):
    """v7.0.0: data lives only on the server. Offline, the SW still serves the
    shell, so the app boots far enough to show the "Can't reach your server"
    gate instead of stale or empty data. Back online, Retry loads the data.
    (Replaces the old "page navigation works offline" test: there is no
    offline data to navigate any more.)"""
    context = browser.new_context()
    ensure_session(context)
    page = context.new_page()

    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
    wait_for_app_ready(page)
    assert _wait_for_active_service_worker(page), "Expected active service worker"
    page.evaluate("""async () => {
        const { replaceForPostgres } = await import('/src/postgresImport.js');
        const { sanitizeParsedState } = await import('/src/sanitizers.js');
        await replaceForPostgres(window.app, sanitizeParsedState({
            accounts: [{ id: 1, name: 'Offline Gate Checking', type: 'Checking', balance: 500 }],
            settings: [{ key: 'reconciliationAdjustsBalance', value: false }],
        }), {});
    }""")

    context.set_offline(True)
    page.reload(wait_until="load", timeout=15000)
    wait_for_app_ready(page)

    page.wait_for_selector('#serverUnreachableGate', state='visible', timeout=10000)
    assert page.is_hidden('#loginGate'), "Offline must not be mistaken for a missing session"
    assert page.locator('#accountList .acct-card').count() == 0, "No data may render behind the gate"
    # Network-only: /api must never be answered from the SW cache.
    cached_api = page.evaluate("""async () => {
        const keys = await caches.keys();
        for (const k of keys) {
            const reqs = await (await caches.open(k)).keys();
            if (reqs.some(r => new URL(r.url).pathname.startsWith('/api/'))) return true;
        }
        return false;
    }""")
    assert not cached_api, "API responses must not be stored in Cache Storage"

    context.set_offline(False)
    page.click('#serverUnreachableRetryBtn')
    page.wait_for_selector('#serverUnreachableGate', state='hidden', timeout=15000)
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountList >> text=Offline Gate Checking', timeout=10000)

    context.close()


@pytest.mark.integration
@pytest.mark.slow
def test_chartjs_renders_from_sw_cache_offline(browser):
    """Chart.js (loaded from CDN) is cached by the SW's staleWhileRevalidate handler
    on first fetch. Going offline after the first visit must still serve the script
    from that cache, so window.Chart is defined while the unreachable gate is up
    (and charts can render as soon as the server is back)."""
    context = browser.new_context()
    ensure_session(context)
    page = context.new_page()

    # Online first visit, so the Chart.js CDN script is fetched and cached by the
    # SW's staleWhileRevalidate handler.
    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
    wait_for_app_ready(page)
    assert _wait_for_active_service_worker(page), "Expected active service worker"
    # A second online load goes through the now-active SW, which caches the CDN response.
    page.reload(wait_until="networkidle", timeout=30000)
    wait_for_app_ready(page)

    context.set_offline(True)
    page.reload(wait_until="load", timeout=15000)
    wait_for_app_ready(page)
    page.wait_for_selector('#serverUnreachableGate', state='visible', timeout=10000)

    # window.Chart being defined proves the CDN script was served from SW cache.
    chart_loaded = page.evaluate("() => typeof window.Chart !== 'undefined'")
    assert chart_loaded, (
        "Expected window.Chart to be defined offline; "
        "Chart.js CDN script was not served from the service worker cache"
    )

    context.set_offline(False)
    context.close()


@pytest.mark.integration
@pytest.mark.slow
def test_first_ever_visit_offline_does_not_load(browser):
    """Documents a known/expected limitation: a browser context that has *never* visited the app
    online has nothing precached yet, so going offline before the very first successful load
    correctly fails to render the app -- this isn't a bug, it's the inherent boundary of
    cache-based offline support."""
    context = browser.new_context()
    page = context.new_page()
    context.set_offline(True)

    navigation_failed = False
    try:
        page.goto(BASE_URL, wait_until="load", timeout=10000)
    except Exception:
        navigation_failed = True

    if not navigation_failed:
        # Some browsers render a local offline-error page instead of raising; either signal is acceptable.
        assert 'MyFinances' not in (page.title() or '')

    context.close()
