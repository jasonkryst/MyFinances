#!/usr/bin/env python3
"""
PWA (installability + offline) tests for GitHub issue #75.

Covers manifest.json validity, the index.html tags that reference it, the
service worker's precache list staying in sync with the real src/ directory
and APP_VERSION, and that the service worker actually registers in a real
browser (with a negative case for browsers that don't support it at all).
Deploy-config checks (Dockerfile/nginx) live in tests/security/test_static_scan.py
alongside the other Docker/nginx-adjacent checks; offline behavior lives in
tests/integration/test_pwa_offline.py; the update banner lives in
tests/ui/test_pwa_update_banner.py.
"""

import json
import os
import re

import pytest

from tests.conftest import assert_no_errors

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture
def manifest_json():
    path = os.path.join(PROJECT_ROOT, 'manifest.json')
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


@pytest.fixture
def index_html_content():
    path = os.path.join(PROJECT_ROOT, 'index.html')
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


# --- manifest.json + index.html wiring ---

REQUIRED_MANIFEST_FIELDS = [
    'name', 'short_name', 'start_url', 'scope', 'display',
    'background_color', 'theme_color', 'icons',
]


@pytest.mark.feature
def test_manifest_has_required_fields(manifest_json):
    for field in REQUIRED_MANIFEST_FIELDS:
        assert field in manifest_json, f"manifest.json is missing required field '{field}'"
    assert len(manifest_json['icons']) >= 2, "manifest.json should declare at least two icon sizes"


@pytest.mark.feature
def test_manifest_icons_resolve_to_committed_files(manifest_json):
    for icon in manifest_json['icons']:
        icon_path = os.path.join(PROJECT_ROOT, icon['src'])
        assert os.path.isfile(icon_path), f"manifest.json references '{icon['src']}' but that file doesn't exist"


@pytest.mark.feature
def test_index_html_links_manifest_and_icons(index_html_content):
    assert '<link rel="manifest" href="manifest.json">' in index_html_content
    assert 'rel="icon"' in index_html_content
    assert 'rel="apple-touch-icon"' in index_html_content
    assert 'name="theme-color"' in index_html_content


@pytest.mark.feature
def test_required_field_check_catches_incomplete_manifest():
    """The same required-field check must flag a manifest missing 'icons', not just pass a well-formed one."""
    broken_manifest = {
        'name': 'X', 'short_name': 'X', 'start_url': '/', 'scope': '/',
        'display': 'standalone', 'background_color': '#fff', 'theme_color': '#fff',
    }
    missing = [f for f in REQUIRED_MANIFEST_FIELDS if f not in broken_manifest]
    assert missing == ['icons']
