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


_SEED_SCRIPT = """
    localStorage.setItem('debtTrackerData', JSON.stringify({ accounts: [], debts: [], settings: [] }));
"""


@pytest.mark.integration
@pytest.mark.slow
def test_data_page_navigation_works_offline(browser):
    """Switching pages while offline relies only on cached resources — all routing
    is client-side JS and the SW precaches every app-shell file on first visit."""
    context = browser.new_context()
    page = context.new_page()
    context.add_init_script(_SEED_SCRIPT)

    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
    assert _wait_for_active_service_worker(page), "Expected active service worker"

    context.set_offline(True)
    page.reload(wait_until="load", timeout=15000)

    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=8000)

    content = page.inner_text('#healthSection')
    assert len(content.strip()) > 50, (
        "Expected substantive rendered content in Health section offline; "
        "got only empty or shell-level text — cached JS may not have run"
    )

    context.set_offline(False)
    context.close()


@pytest.mark.integration
@pytest.mark.slow
def test_add_debt_offline_persists_to_localstorage(browser):
    """Adding a debt while offline writes it to localStorage — the full add-debt
    flow (form fill → submit → re-render) is purely client-side with no network calls."""
    context = browser.new_context()
    page = context.new_page()
    context.add_init_script(_SEED_SCRIPT)

    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
    assert _wait_for_active_service_worker(page), "Expected active service worker"

    context.set_offline(True)
    page.reload(wait_until="load", timeout=15000)

    # Navigate to Liabilities → Debts tab.
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_selector('[data-liabilities-subtab="debts"].active', timeout=5000)

    # Open the add-debt form and fill it.
    page.click('#debtFormToggle')
    page.wait_for_selector('#debtFormBody:not([hidden])', timeout=5000)
    page.fill('#debtName', 'Offline Test Debt')
    page.select_option('#debtType', value='creditCard')
    page.fill('#accountBalance', '1500')
    page.fill('#interestRate', '19.99')
    page.fill('#minimumPayment', '35')
    page.fill('#dueDate', '15')
    page.click('#debtFormSubmit')

    page.wait_for_selector('text=Offline Test Debt', timeout=5000)

    # Confirm the debt was persisted to localStorage (no network path involved).
    stored = page.evaluate("""
        () => {
            const raw = localStorage.getItem('debtTrackerData');
            if (!raw) return null;
            const data = JSON.parse(raw);
            return (data.debts || []).find(d => d.name === 'Offline Test Debt') || null;
        }
    """)
    assert stored is not None, "Expected the new debt to be saved in localStorage while offline"
    assert stored['accountBalance'] == 1500

    context.set_offline(False)
    context.close()


@pytest.mark.integration
@pytest.mark.slow
def test_chartjs_renders_from_sw_cache_offline(browser):
    """Chart.js (loaded from CDN) is cached by the SW's staleWhileRevalidate handler
    on first fetch. Going offline after the first visit must still serve the script
    from that cache so window.Chart is defined and charts render."""
    context = browser.new_context()
    page = context.new_page()
    context.add_init_script(_SEED_SCRIPT)

    # Online first visit — navigate to Health so Chart.js CDN is fetched and cached
    # by the SW's staleWhileRevalidate handler (sw.js:99-101).
    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
    assert _wait_for_active_service_worker(page), "Expected active service worker"
    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=8000)
    # Give the SW time to finish caching the CDN response.
    page.wait_for_load_state("networkidle", timeout=10000)

    context.set_offline(True)
    page.reload(wait_until="load", timeout=15000)

    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=8000)
    page.wait_for_selector('#healthDtiGauge', timeout=5000)

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
