#!/usr/bin/env python3
"""
Performance batch (issues #523, #524, #533).

#523  Chart.js is deferred (still ahead of the module app.js).
#524  The service worker serves precached static assets cache-first; the
      document stays network-first; /api, /auth and /calendar.ics stay
      network-only.
#533  A signed-in boot GETs /api/plan-settings exactly once.
"""

import re
import time
from pathlib import Path

import pytest

from tests.conftest import BASE_URL, TEST_EMAIL, TEST_PASSWORD, ensure_session, wait_for_app_ready

ROOT = Path(__file__).resolve().parents[2]
INDEX = (ROOT / 'index.html').read_text(encoding='utf-8')
SW = (ROOT / 'sw.js').read_text(encoding='utf-8')


# --- #523: static ---

def _script_tags(html):
    return re.findall(r'<script\b[^>]*>', html)


def _chart_tag_is_deferred(html):
    tags = [t for t in _script_tags(html) if 'chart.umd' in t]
    return len(tags) == 1 and re.search(r'\sdefer(\s|>|=)', tags[0]) is not None


@pytest.mark.feature
def test_chart_js_script_is_deferred():
    assert _chart_tag_is_deferred(INDEX)


@pytest.mark.feature
def test_chart_deferred_check_rejects_blocking_tag():
    blocking = '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js" crossorigin="anonymous"></script>'
    assert not _chart_tag_is_deferred(blocking)


@pytest.mark.feature
def test_chart_script_still_precedes_module_entry_and_keeps_sri():
    chart = INDEX.index('chart.umd')
    app = INDEX.index('src="src/app.js"')
    assert chart < app, 'Chart.js must stay before app.js so deferred execution order holds'
    tag = [t for t in _script_tags(INDEX) if 'chart.umd' in t][0]
    assert 'integrity="sha384-' in tag and 'crossorigin="anonymous"' in tag


@pytest.mark.feature
def test_chart_defined_when_app_starts(app_page):
    assert app_page.evaluate("typeof window.Chart") == 'function'


# --- #524: static ---

@pytest.mark.feature
def test_sw_serves_precached_assets_cache_first_but_not_the_document():
    assert 'async function cacheFirst(request)' in SW
    assert 'event.respondWith(cacheFirst(request));' in SW
    # the document and navigations are excluded, and networkFirst remains the default
    assert "request.mode !== 'navigate'" in SW
    assert "url !== '/' && url !== '/index.html'" in SW
    assert 'event.respondWith(networkFirst(request));' in SW


@pytest.mark.feature
def test_sw_keeps_api_auth_calendar_network_only_before_any_respond():
    network_only = SW.index('if (isNetworkOnlyPath(pathname)) return;')
    assert network_only < SW.index('event.respondWith(cacheFirst(request));')
    for path in ("'/api/'", "'/auth/'", "'/calendar.ics'"):
        assert path in SW


# --- #524: runtime ---

def _wait_controlled_and_precached(page):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        ready = page.evaluate("""async () => {
            const reg = await navigator.serviceWorker.getRegistration();
            if (!reg || !reg.active) return false;
            const keys = await caches.keys();
            if (!keys.length) return false;
            const cache = await caches.open(keys[0]);
            return !!(await cache.match('/src/app.js')) && !!(await cache.match('/styles.css'));
        }""")
        if ready:
            return
        time.sleep(0.3)
    raise AssertionError('service worker never activated with a complete precache')


def _sw_fetch_log(page):
    """Patch the active worker's fetch to record every network fetch it makes."""
    worker = None
    for _ in range(50):
        workers = page.context.service_workers
        if workers:
            worker = workers[0]
            break
        time.sleep(0.2)
    assert worker, 'no service worker found on the context'
    worker.evaluate("""() => {
        if (self.__netLog) return;
        self.__netLog = [];
        const orig = self.fetch.bind(self);
        self.fetch = (input, init) => {
            self.__netLog.push(new URL(typeof input === 'string' ? input : input.url, self.location.href).pathname);
            return orig(input, init);
        };
    }""")
    return worker


@pytest.mark.feature
def test_warm_reload_makes_no_static_network_requests_but_revalidates_document(app_page):
    page = app_page
    _wait_controlled_and_precached(page)
    page.reload()  # first reload puts the page under the worker's control
    wait_for_app_ready(page)
    assert page.evaluate("!!navigator.serviceWorker.controller")

    worker = _sw_fetch_log(page)
    api_requests = []
    page.on('request', lambda r: api_requests.append(r.url) if '/api/plan-settings' in r.url else None)
    page.reload()
    wait_for_app_ready(page)

    log = worker.evaluate("() => self.__netLog || null")
    assert log is not None, 'worker restarted mid-test; patch lost'
    static = [p for p in log if p.startswith('/src/') or p in ('/styles.css', '/styles-csp-classes.css', '/manifest.json')]
    assert static == [], f'precached assets hit the network on a warm reload: {static[:10]}'
    # the document still revalidates
    assert any(p in ('/', '/index.html') for p in log), f'document did not go to the network: {log}'
    # /api is never answered by the worker: the page saw a real request for it
    assert api_requests, 'expected a network /api/plan-settings request on boot'
    assert not any(p.startswith('/api/') for p in log), 'the worker must not handle /api requests'


@pytest.mark.feature
def test_asset_missing_from_cache_falls_back_to_network(app_page):
    page = app_page
    _wait_controlled_and_precached(page)
    page.reload()
    wait_for_app_ready(page)
    worker = _sw_fetch_log(page)
    page.evaluate("""async () => {
        const keys = await caches.keys();
        const cache = await caches.open(keys[0]);
        await cache.delete('/src/saveStatus.js');
    }""")
    status = page.evaluate("fetch('/src/saveStatus.js').then(r => r.status)")
    assert status == 200
    assert '/src/saveStatus.js' in worker.evaluate("() => self.__netLog")


# --- #533 ---

def _plan_settings_responses(page):
    seen = []
    page.on('response', lambda r: seen.append((r.status, r.request.method))
            if r.url.split('?')[0].endswith('/api/plan-settings') else None)
    return seen


@pytest.mark.feature
def test_signed_in_boot_fetches_plan_settings_once(page, stack_user):
    ensure_session(page.context)
    seen = _plan_settings_responses(page)
    page.goto(BASE_URL, wait_until='networkidle', timeout=60000)
    wait_for_app_ready(page)
    gets = [s for s in seen if s[1] == 'GET']
    assert gets == [(200, 'GET')], gets
    # the loaded value really came from that one response
    assert page.evaluate("window.app._savedStrategy !== undefined")


@pytest.mark.feature
def test_boot_after_login_gate_still_fetches_plan_settings(browser, stack_user):
    context = browser.new_context(service_workers='block')
    page = context.new_page()
    seen = _plan_settings_responses(page)
    try:
        page.goto(BASE_URL, wait_until='networkidle', timeout=60000)
        page.wait_for_selector('#loginGateForm', state='visible', timeout=30000)
        page.fill('#loginGateEmail', TEST_EMAIL)
        page.fill('#loginGatePassword', TEST_PASSWORD)
        page.click('#loginGateSubmit')
        page.wait_for_function('() => window.app && window.app._savedStrategy !== undefined', timeout=30000)
        wait_for_app_ready(page)
        for _ in range(50):  # response events are delivered asynchronously
            if len([x for x in seen if x[1] == 'GET']) >= 2:
                break
            page.wait_for_timeout(100)
        gets = [s[0] for s in seen if s[1] == 'GET']
        # the probe (401), then the load fetches it itself: the probe had no body
        assert gets == [401, 200], gets
    finally:
        context.close()


@pytest.mark.feature
def test_expired_session_between_probe_and_load_reprobes(browser, stack_user):
    context = browser.new_context(service_workers='block')
    ensure_session(context)
    page = context.new_page()
    state = {'debts': 0}

    def debts_route(route):
        state['debts'] += 1
        if state['debts'] == 1:
            route.fulfill(status=401, body='{}', content_type='application/json')
        else:
            route.continue_()

    page.route('**/api/debts', debts_route)
    seen = _plan_settings_responses(page)
    try:
        page.goto(BASE_URL, wait_until='networkidle', timeout=60000)
        page.wait_for_function('() => window.app && window.app._savedStrategy !== undefined', timeout=30000)
        wait_for_app_ready(page)
        # first boot attempt: probe 200; load 401s on debts -> re-probe (200) -> load again
        assert state['debts'] >= 2
        assert [s[0] for s in seen if s[1] == 'GET'].count(200) == 2, seen
    finally:
        context.close()
