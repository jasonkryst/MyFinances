#!/usr/bin/env python3
"""
Offline app-shell test (GitHub issue #75).

sw.js precaches the app shell on first visit so the app can load with zero
network connectivity afterward -- this is the core "offline" promise of a
PWA. Playwright's BrowserContext.set_offline() simulates a fully disconnected
network at the browser level (distinct from just a slow/flaky connection).
"""

import time

import pytest

from tests.conftest import BASE_URL


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
        page.wait_for_timeout(150)
    return False


@pytest.mark.integration
@pytest.mark.slow
def test_app_shell_loads_offline_after_first_visit(browser):
    context = browser.new_context()
    page = context.new_page()

    # First visit online: lets sw.js install and precache the app shell.
    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
    assert _wait_for_active_service_worker(page), "Expected an active service worker after the first online visit"

    context.set_offline(True)
    page.reload(wait_until="load", timeout=15000)

    assert page.is_visible('h1'), "Expected the app shell to render from cache while offline"
    assert page.title() != "", "Expected a real page title, not a browser offline-error page"

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
