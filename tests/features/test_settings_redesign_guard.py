#!/usr/bin/env python3
"""
Settings redesign guard (7.20.0).

The Settings modal lost its Done button and its tab bar, and the Backup &
Restore modal became a Settings page. A test or source file that still names
one of the removed hooks would fail (or silently test nothing), so this static
scan fails on any reference to them. It also checks that every Settings page
has a render-guard entry (`settings-<page>`) in TRANSLATED_PAGES.

`test_settings_redesign.py` and this file are exempt: they assert the hooks are
gone, so they have to name them.
"""

import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
EXEMPT = {
    Path(__file__).resolve(),
    (REPO / 'tests' / 'ui' / 'test_settings_redesign.py').resolve(),
}

REMOVED = re.compile(
    r"settingsModalDoneBtn|data-settings-tab|data-dt-tab|settings-tab-btn|dt-tab-btn"
    r"|[#'\"]dataTransferModal\b"
)


def _scan_targets():
    for pattern in ('tests/**/*.py', 'src/**/*.js'):
        yield from REPO.glob(pattern)
    yield REPO / 'index.html'


@pytest.mark.feature
def test_no_references_to_removed_settings_hooks():
    hits = []
    for path in _scan_targets():
        if path.resolve() in EXEMPT or '__pycache__' in path.parts:
            continue
        text = path.read_text(encoding='utf-8')
        for number, line in enumerate(text.splitlines(), 1):
            if REMOVED.search(line):
                hits.append(f"{path.relative_to(REPO).as_posix()}:{number}: {line.strip()[:120]}")
    assert not hits, "References to removed Settings hooks:\n" + "\n".join(hits)


@pytest.mark.feature
def test_every_settings_page_has_a_render_guard_entry():
    from tests.features.i18n_render_support import TRANSLATED_PAGES

    source = (REPO / 'src' / 'settingsNav.js').read_text(encoding='utf-8')
    match = re.search(r"SETTINGS_PAGES\s*=\s*\[([^\]]+)\]", source)
    assert match, "SETTINGS_PAGES not found in src/settingsNav.js"
    pages = re.findall(r"'([a-z]+)'", match.group(1))
    assert len(pages) == 8, pages
    missing = [p for p in pages if f"settings-{p}" not in TRANSLATED_PAGES]
    assert not missing, f"TRANSLATED_PAGES is missing settings-<page> entries for: {missing}"
