#!/usr/bin/env python3
"""
App versioning consistency checks (GitHub issue #59).

APP_VERSION lives in src/utils.js as a hand-maintained constant (this is a
no-build-step, no-backend static app, so there's no package.json/build
pipeline to derive it from). The failure mode that prompted issue #59 is
drift: APP_VERSION gets bumped without a matching CHANGELOG.md entry (or
vice versa). These tests parse both files with plain regexes -- no browser
required -- and fail loudly on drift instead of letting it go unnoticed.
"""

import os
import re

import pytest

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

APP_VERSION_RE = re.compile(r"""export const APP_VERSION = ['"](\d+\.\d+\.\d+)['"]""")
CHANGELOG_HEADING_RE = re.compile(r"^## \[(\d+\.\d+\.\d+)\] — \d{4}-\d{2}-\d{2}", re.MULTILINE)


def _read_app_version(utils_js_content):
    """Extract the APP_VERSION string from utils.js source. Returns None if absent."""
    match = APP_VERSION_RE.search(utils_js_content)
    return match.group(1) if match else None


def _read_changelog_latest_version(changelog_content):
    """Extract the version from the first '## [x.y.z] — YYYY-MM-DD' heading. Returns None if absent."""
    match = CHANGELOG_HEADING_RE.search(changelog_content)
    return match.group(1) if match else None


@pytest.fixture
def utils_js_content():
    path = os.path.join(PROJECT_ROOT, 'src', 'utils.js')
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


@pytest.fixture
def changelog_content():
    path = os.path.join(PROJECT_ROOT, 'CHANGELOG.md')
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


# --- Positive cases: real repo files must be internally consistent ---

@pytest.mark.feature
def test_app_version_is_declared(utils_js_content):
    """src/utils.js must export a semver-shaped APP_VERSION constant."""
    assert _read_app_version(utils_js_content) is not None, (
        "Could not find `export const APP_VERSION = 'x.y.z';` in src/utils.js"
    )


@pytest.mark.feature
def test_changelog_has_a_latest_entry(changelog_content):
    """CHANGELOG.md must have at least one '## [x.y.z] — YYYY-MM-DD' heading."""
    assert _read_changelog_latest_version(changelog_content) is not None, (
        "Could not find a '## [x.y.z] — YYYY-MM-DD' heading in CHANGELOG.md"
    )


@pytest.mark.feature
def test_app_version_matches_changelog_latest_entry(utils_js_content, changelog_content):
    """APP_VERSION (src/utils.js) must match CHANGELOG.md's most recent heading.

    This is the actual drift issue #59 points at: nothing previously enforced
    that a version bump comes with a changelog entry, or that a changelog
    entry's version matches what's shipped. If this test fails, either
    APP_VERSION needs bumping to match a new changelog entry, or a changelog
    entry is missing for the current APP_VERSION.
    """
    app_version = _read_app_version(utils_js_content)
    changelog_version = _read_changelog_latest_version(changelog_content)

    assert app_version == changelog_version, (
        f"APP_VERSION ('{app_version}' in src/utils.js) does not match "
        f"CHANGELOG.md's latest entry ('{changelog_version}'). "
        f"Add/update a CHANGELOG.md entry, or fix the APP_VERSION bump."
    )


@pytest.mark.feature
def test_changelog_versions_are_strictly_descending(changelog_content):
    """CHANGELOG.md headings must be ordered newest-first with no duplicates."""
    versions = CHANGELOG_HEADING_RE.findall(changelog_content)
    assert len(versions) >= 2, "Expected at least two changelog entries to compare order"

    def parts(v):
        return tuple(int(n) for n in v.split('.'))

    for earlier, later in zip(versions, versions[1:]):
        assert parts(earlier) > parts(later), (
            f"CHANGELOG.md entries out of order: '{earlier}' appears before '{later}', "
            f"but {earlier} is not newer than {later}"
        )


# --- Negative cases: the parsing/comparison logic must actually catch drift ---
# These exercise the same regexes/comparison used above against fabricated
# (not real-repo) content, so a future refactor of the check itself can't
# silently stop catching the failure mode it exists for.

@pytest.mark.feature
def test_detects_version_missing_from_utils_js():
    """A utils.js without an APP_VERSION export must be reported as missing, not silently pass."""
    broken_content = "export const SOMETHING_ELSE = '1.2.3';\n"
    assert _read_app_version(broken_content) is None


@pytest.mark.feature
def test_detects_missing_changelog_heading():
    """A CHANGELOG.md without a proper '## [x.y.z] — date' heading must be reported as missing."""
    broken_content = "# Changelog\n\nSome notes, but no version heading.\n"
    assert _read_changelog_latest_version(broken_content) is None


@pytest.mark.feature
def test_detects_mismatched_version_and_changelog():
    """Fabricated mismatched APP_VERSION/CHANGELOG content must NOT compare equal.

    Mirrors the real drift found on this branch before it was fixed: utils.js
    said 4.7.2 while CHANGELOG.md's latest heading still said 4.7.0.
    """
    fake_utils_js = "export const APP_VERSION = '4.7.2';\n"
    fake_changelog = "# Changelog\n\n## [4.7.0] — 2026-07-17\n\n### Changed\n- something\n"

    app_version = _read_app_version(fake_utils_js)
    changelog_version = _read_changelog_latest_version(fake_changelog)

    assert app_version == '4.7.2'
    assert changelog_version == '4.7.0'
    assert app_version != changelog_version


@pytest.mark.feature
def test_detects_out_of_order_changelog_entries():
    """Fabricated out-of-order changelog headings must fail the ordering check's logic."""
    fake_changelog = (
        "# Changelog\n\n"
        "## [4.6.0] — 2026-07-14\n\n### Changed\n- something\n\n"
        "## [4.7.0] — 2026-07-17\n\n### Changed\n- something newer, listed second by mistake\n"
    )
    versions = CHANGELOG_HEADING_RE.findall(fake_changelog)
    assert versions == ['4.6.0', '4.7.0']

    def parts(v):
        return tuple(int(n) for n in v.split('.'))

    # The real ordering test asserts parts(earlier) > parts(later) for each
    # adjacent pair; confirm that assertion would actually fire here.
    earlier, later = versions[0], versions[1]
    assert not (parts(earlier) > parts(later)), (
        "Expected the fabricated out-of-order changelog to fail the descending-order check"
    )
