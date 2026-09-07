#!/usr/bin/env python3
"""
Optional self-hosted Google Analytics support for GitHub issue #131.

Off by default everywhere -- src/analytics.js only injects gtag.js when
window.__ENV__.GA_MEASUREMENT_ID is present. In a real Docker deployment
that value is written into env-config.js by a docker-entrypoint.d script
from the GA_MEASUREMENT_ID env var (see tests/security/test_static_scan.py
for the Dockerfile/nginx/docker-compose wiring). Local dev / the Playwright
test server (python -m http.server) never runs that entrypoint, so
env-config.js 404s and window.__ENV__ stays undefined -- the negative case
below is what every existing test already exercises implicitly.
"""

import os

import pytest

from tests.conftest import BASE_URL, SKIP_FIRST_RUN_WIZARD_SCRIPT, assert_no_errors

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

GTAG_SRC_PREFIX = "https://www.googletagmanager.com/gtag/js"


def _block_ga_network(page):
    """Prevent an actual outbound call to Google during tests -- the DOM-level
    script injection is what's under test, not whether Google's CDN responds."""
    page.route(f"{GTAG_SRC_PREFIX}**", lambda route: route.abort())


@pytest.mark.feature
def test_no_ga_script_injected_when_measurement_id_unset(app_page):
    """The default (no env-config.js, no window.__ENV__) case: no gtag script,
    no dataLayer -- the app must not phone home unless explicitly configured."""
    page = app_page
    gtag_script = page.query_selector(f'script[src^="{GTAG_SRC_PREFIX}"]')
    assert gtag_script is None, "gtag.js should not be injected when GA_MEASUREMENT_ID is unset"

    has_data_layer = page.evaluate("() => Array.isArray(window.dataLayer)")
    assert not has_data_layer, "window.dataLayer should not exist when GA is not configured"
    assert_no_errors(page)


@pytest.mark.feature
def test_ga_script_injected_when_measurement_id_present(page):
    """When window.__ENV__.GA_MEASUREMENT_ID is set (the real deployment
    generates this from the GA_MEASUREMENT_ID env var), the app must inject
    gtag.js with that id and initialize dataLayer/gtag."""
    _block_ga_network(page)
    page.add_init_script("""
        window.__ENV__ = { GA_MEASUREMENT_ID: 'G-TESTID1234' };
    """)
    page.add_init_script(SKIP_FIRST_RUN_WIZARD_SCRIPT)
    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)

    gtag_script = page.query_selector(f'script[src^="{GTAG_SRC_PREFIX}"]')
    assert gtag_script is not None, "Expected gtag.js to be injected when GA_MEASUREMENT_ID is set"

    src = gtag_script.get_attribute('src')
    assert 'G-TESTID1234' in src, f"gtag.js src should carry the configured measurement id, got: {src}"

    state = page.evaluate("""
        () => ({
            hasDataLayer: Array.isArray(window.dataLayer),
            gtagIsFunction: typeof window.gtag === 'function',
        })
    """)
    assert state['hasDataLayer'], "window.dataLayer should be initialized"
    assert state['gtagIsFunction'], "window.gtag should be defined as a function"


@pytest.mark.feature
def test_guide_page_also_respects_missing_measurement_id():
    """guide.html loads outside the main app's module graph (plain classic
    scripts) -- confirm it wires up the same analytics module rather than
    silently skipping analytics on that page."""
    guide_path = os.path.join(PROJECT_ROOT, 'guide.html')
    with open(guide_path, 'r', encoding='utf-8') as f:
        content = f.read()

    assert 'env-config.js' in content, "guide.html must load env-config.js so GA can be configured there too"
    assert 'src/analytics.js' in content, "guide.html must load src/analytics.js"


@pytest.mark.feature
def test_index_html_loads_env_config_before_analytics_and_app():
    """env-config.js must load (and, being a deferred classic script, execute)
    before src/analytics.js reads window.__ENV__, or the measurement id will
    never be seen."""
    index_path = os.path.join(PROJECT_ROOT, 'index.html')
    with open(index_path, 'r', encoding='utf-8') as f:
        content = f.read()

    assert 'env-config.js' in content, "index.html must load env-config.js"
    assert 'src/analytics.js' in content, "index.html must load src/analytics.js"

    env_config_pos = content.find('env-config.js')
    analytics_pos = content.find('src/analytics.js')
    assert 0 < env_config_pos < analytics_pos, (
        "env-config.js must appear before src/analytics.js in index.html so "
        "window.__ENV__ is populated before analytics.js reads it"
    )
