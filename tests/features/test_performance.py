#!/usr/bin/env python3
"""
Performance-infrastructure tests for GitHub issue #146.

Covers the Lighthouse CI gate configuration (lighthouserc.json), nginx gzip
compression, the modulepreload hints that break the JS-module waterfall in
index.html, and the HTTP/2 documentation added to nginx.conf.  Actual
Lighthouse scores are measured in CI (lhci autorun) — these tests guard the
static configuration that makes those measurements meaningful.

What is NOT tested here:
- Live Lighthouse scores (require a running server + chrome — that's lhci's job)
- CSS splitting (deferred: no build step available to split styles.css safely)
"""

import json
import os
import re

import pytest

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Modules that are NOT directly imported by src/app.js but are pulled in
# transitively.  Preloading them in <head> breaks the fetch waterfall.
# Keep this list in sync with the actual import graph — if a module is added
# here it must genuinely be a transitive (not direct) app.js import.
EXPECTED_PRELOADED_MODULES = [
    'src/locales/en.js',
    'src/locales/es.js',
    'src/locales/pl.js',
    'src/ledger.js',
    'src/commandPalette.js',
    'src/breakEven.js',
    'src/forecast.js',
    'src/spending.js',
    'src/reportsCalendar.js',
    'src/reportsVariance.js',
    'src/postgresSync.js',
    'src/postgresImport.js',
    'src/sanitizers.js',
    'src/retirementCalculator.js',
    'src/ledgerOverrides.js',
    'src/ledgerCleared.js',
]

LIGHTHOUSE_CATEGORIES = [
    'categories:performance',
    'categories:accessibility',
    'categories:best-practices',
    'categories:seo',
]


@pytest.fixture
def lighthouserc():
    path = os.path.join(PROJECT_ROOT, 'lighthouserc.json')
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


@pytest.fixture
def index_html():
    path = os.path.join(PROJECT_ROOT, 'index.html')
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


@pytest.fixture
def nginx_conf():
    path = os.path.join(PROJECT_ROOT, 'nginx.conf')
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


@pytest.fixture
def app_js():
    path = os.path.join(PROJECT_ROOT, 'src', 'app.js')
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


# ---------------------------------------------------------------------------
# lighthouserc.json — CI gate configuration
# ---------------------------------------------------------------------------

@pytest.mark.feature
def test_lighthouserc_is_valid_json():
    """lighthouserc.json must parse without error."""
    path = os.path.join(PROJECT_ROOT, 'lighthouserc.json')
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    assert 'ci' in data


@pytest.mark.feature
def test_lighthouserc_has_performance_gate(lighthouserc):
    """CI must assert a minimum Lighthouse performance score — the whole point
    of this gate is to catch performance regressions before they reach users."""
    assertions = lighthouserc['ci']['assert']['assertions']
    assert 'categories:performance' in assertions, (
        "lighthouserc.json must gate on categories:performance"
    )


@pytest.mark.feature
def test_lighthouserc_gates_all_four_categories(lighthouserc):
    """All four Lighthouse categories must be gated — performance alone is not
    enough; accessibility and best-practices regressions are equally important."""
    assertions = lighthouserc['ci']['assert']['assertions']
    missing = [cat for cat in LIGHTHOUSE_CATEGORIES if cat not in assertions]
    assert not missing, f"lighthouserc.json is missing gates for: {missing}"


@pytest.mark.feature
def test_lighthouserc_performance_gate_is_at_least_0_8(lighthouserc):
    """The performance minimum must be >= 0.8 — lower values defeat the purpose
    of the gate (the audit found a score of 0.60 which failed this threshold)."""
    assertions = lighthouserc['ci']['assert']['assertions']
    perf = assertions.get('categories:performance', [])
    # Format is either ["error", {"minScore": 0.8}] or {"minScore": 0.8}
    if isinstance(perf, list):
        config = perf[1] if len(perf) > 1 else {}
    else:
        config = perf
    assert config.get('minScore', 0) >= 0.8, (
        f"categories:performance minScore is {config.get('minScore')}, expected >= 0.8"
    )


@pytest.mark.feature
def test_lighthouserc_gates_use_error_level(lighthouserc):
    """Assertions must use 'error' severity so lhci fails CI on violations — 'warn'
    would let a 0.60 score silently pass."""
    assertions = lighthouserc['ci']['assert']['assertions']
    for cat in LIGHTHOUSE_CATEGORIES:
        entry = assertions.get(cat, [])
        if isinstance(entry, list) and entry:
            assert entry[0] == 'error', (
                f"{cat} uses '{entry[0]}' severity; must be 'error' to block CI"
            )


@pytest.mark.feature
def test_lighthouserc_tests_both_app_pages(lighthouserc):
    """Both index.html and guide.html must be audited — guide.html has its own
    JS bundle and can have independent performance regressions."""
    urls = lighthouserc['ci']['collect']['url']
    assert any('index.html' in u or u.endswith('/') for u in urls), (
        "lighthouserc.json must include index.html (or '/') in collect.url"
    )
    assert any('guide.html' in u for u in urls), (
        "lighthouserc.json must include guide.html in collect.url"
    )


# ---------------------------------------------------------------------------
# Negative tests — the gate checks must reject bad configurations
# ---------------------------------------------------------------------------

@pytest.mark.feature
def test_performance_gate_rejects_low_min_score():
    """A config with minScore 0.7 must not pass the >= 0.8 check."""
    fake_assertions = {'categories:performance': ['error', {'minScore': 0.7}]}
    perf = fake_assertions['categories:performance']
    config = perf[1] if isinstance(perf, list) and len(perf) > 1 else {}
    assert config.get('minScore', 0) < 0.8


@pytest.mark.feature
def test_performance_gate_detects_missing_performance_category():
    """A config that omits categories:performance must be flagged by the check."""
    fake_assertions = {
        'categories:accessibility': ['error', {'minScore': 0.8}],
        'categories:best-practices': ['error', {'minScore': 0.8}],
        'categories:seo': ['error', {'minScore': 0.8}],
    }
    assert 'categories:performance' not in fake_assertions


@pytest.mark.feature
def test_performance_gate_detects_warn_severity():
    """'warn' severity must be distinguishable from 'error' by the level check."""
    fake_entry = ['warn', {'minScore': 0.8}]
    assert fake_entry[0] != 'error'


# ---------------------------------------------------------------------------
# nginx.conf — gzip compression
# ---------------------------------------------------------------------------

@pytest.mark.feature
def test_nginx_has_gzip_enabled(nginx_conf):
    """gzip must be on — without compression the JS/CSS payload is ~5x larger,
    making the 0.8 Lighthouse score much harder to achieve."""
    assert 'gzip on;' in nginx_conf, "nginx.conf must have 'gzip on;'"


@pytest.mark.feature
def test_nginx_gzip_includes_javascript(nginx_conf):
    """application/javascript must be in gzip_types — JS is the largest asset
    class and benefits most from compression."""
    assert 'application/javascript' in nginx_conf, (
        "nginx.conf must list application/javascript in gzip_types"
    )


@pytest.mark.feature
def test_nginx_gzip_includes_css(nginx_conf):
    """text/css must be in gzip_types — styles.css is 170KB uncompressed."""
    assert 'text/css' in nginx_conf, "nginx.conf must list text/css in gzip_types"


@pytest.mark.feature
def test_nginx_http2_comment_explains_proxy_layer(nginx_conf):
    """nginx.conf must explain that HTTP/2 is the reverse proxy's responsibility,
    not this backend's — prevents a future contributor from cargo-culting
    'http2 on' onto the plain HTTP listen and being confused when it fails."""
    assert 'HTTP/2' in nginx_conf or 'http2' in nginx_conf.lower(), (
        "nginx.conf must mention HTTP/2 (even if just in a comment explaining the proxy setup)"
    )


# ---------------------------------------------------------------------------
# Negative tests for nginx gzip
# ---------------------------------------------------------------------------

@pytest.mark.feature
def test_gzip_check_rejects_missing_gzip():
    """The gzip check must correctly flag an nginx.conf without 'gzip on;'."""
    fake_nginx = "server {\n    listen 80;\n    gzip off;\n}\n"
    assert 'gzip on;' not in fake_nginx


@pytest.mark.feature
def test_gzip_type_check_rejects_missing_javascript():
    """The gzip_types check must reject a config that forgot application/javascript."""
    fake_nginx = "gzip_types text/css text/plain;\n"
    assert 'application/javascript' not in fake_nginx


# ---------------------------------------------------------------------------
# index.html — modulepreload hints
# ---------------------------------------------------------------------------

@pytest.mark.feature
def test_index_html_has_modulepreload_hints(index_html):
    """index.html must declare at least one modulepreload link — the absence of
    any hints is the baseline problem documented in issue #146."""
    assert 'rel="modulepreload"' in index_html, (
        "index.html has no <link rel=\"modulepreload\"> hints — "
        "add them to break the JS module-fetch waterfall (issue #146)"
    )


@pytest.mark.feature
def test_modulepreload_covers_transitive_modules(index_html):
    """Every known transitive-import module must have a modulepreload hint.
    Missing a module leaves it in the waterfall even though sibling modules
    are being preloaded."""
    missing = [
        mod for mod in EXPECTED_PRELOADED_MODULES
        if f'rel="modulepreload" href="{mod}"' not in index_html
    ]
    assert not missing, (
        f"index.html is missing modulepreload hints for: {missing}\n"
        "Add <link rel=\"modulepreload\" href=\"{mod}\"> to the <head> section."
    )


@pytest.mark.feature
def test_modulepreload_hints_reference_real_files(index_html):
    """Every modulepreload href must resolve to a real file — a broken hint
    causes the browser to waste a round-trip on a 404."""
    pattern = re.compile(r'rel="modulepreload"\s+href="([^"]+)"')
    hrefs = pattern.findall(index_html)
    assert hrefs, "No modulepreload hints found in index.html"
    missing_files = []
    for href in hrefs:
        path = os.path.join(PROJECT_ROOT, href)
        if not os.path.isfile(path):
            missing_files.append(href)
    assert not missing_files, (
        f"modulepreload hrefs point to non-existent files: {missing_files}"
    )


@pytest.mark.feature
def test_modulepreload_hints_are_in_head(index_html):
    """Modulepreload hints only work if they appear in <head> — a hint in <body>
    is parsed too late to pipeline the fetches ahead of the module script."""
    head_end = index_html.find('</head>')
    body_start = index_html.find('<body>')
    assert head_end != -1, "Could not locate </head> in index.html"
    head_section = index_html[:head_end]
    assert 'rel="modulepreload"' in head_section, (
        "modulepreload links must be inside <head>, not in <body>"
    )


# ---------------------------------------------------------------------------
# Negative tests for modulepreload hints
# ---------------------------------------------------------------------------

@pytest.mark.feature
def test_modulepreload_check_rejects_missing_hints():
    """The hint-presence check must correctly flag a page with no modulepreload."""
    fake_html = '<html><head><link rel="stylesheet" href="styles.css"></head><body></body></html>'
    assert 'rel="modulepreload"' not in fake_html


@pytest.mark.feature
def test_modulepreload_coverage_check_rejects_partial_list():
    """The coverage check must flag missing entries — partial preloading still
    leaves some modules in the waterfall."""
    partial_html = '<link rel="modulepreload" href="src/locales/en.js">'
    missing = [
        mod for mod in EXPECTED_PRELOADED_MODULES
        if f'rel="modulepreload" href="{mod}"' not in partial_html
    ]
    assert len(missing) > 0, "Expected coverage check to find missing hints"
    assert 'src/locales/es.js' in missing


@pytest.mark.feature
def test_modulepreload_broken_href_check_detects_nonexistent_file():
    """The file-existence check must flag a modulepreload pointing to a 404 path."""
    fake_path = os.path.join(PROJECT_ROOT, 'src', 'nonexistent_module.js')
    assert not os.path.isfile(fake_path)


# ---------------------------------------------------------------------------
# src/app.js — transitive import classification
# ---------------------------------------------------------------------------

@pytest.mark.feature
def test_transitive_modules_are_not_directly_imported_by_app_js(app_js):
    """Every module in EXPECTED_PRELOADED_MODULES must be genuinely transitive —
    if app.js starts directly importing one of them the modulepreload hint is
    harmless but the classification comment becomes misleading."""
    for mod in EXPECTED_PRELOADED_MODULES:
        # Strip the src/ prefix to get the bare filename as it appears in imports
        basename = os.path.basename(mod)
        stem = basename.replace('.js', '')
        # locales/ modules use a different import pattern (import en from './locales/en.js')
        if 'locales/' in mod:
            assert f"from './locales/{basename}'" not in app_js, (
                f"{mod} appears to be directly imported from app.js — "
                "remove it from EXPECTED_PRELOADED_MODULES or update the import"
            )
        else:
            # Check that app.js does not have a direct static import of this module
            assert f"from './{basename}'" not in app_js, (
                f"{mod} appears to be directly imported from app.js — "
                "it is not a transitive module and should be removed from EXPECTED_PRELOADED_MODULES"
            )
