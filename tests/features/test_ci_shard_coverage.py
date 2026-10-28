#!/usr/bin/env python3
"""
Guard (issue #415): the feature/UI CI shards in .github/workflows/ci.yml list
test files explicitly, so a new tests/features/ or tests/ui/ file that isn't
added to a shard silently never runs in CI. 16 files had drifted that way —
including test_whats_new.py, which let What's New go stale 6.41 → 6.48.
Pure file parsing; no browser needed.
"""

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
CI_YML = REPO_ROOT / '.github' / 'workflows' / 'ci.yml'
SHARDED_DIRS = ('features', 'ui')


def _ci_referenced_paths():
    text = CI_YML.read_text(encoding='utf-8')
    return set(re.findall(r'tests/[\w/]+\.py', text))


def _ci_referenced_dirs():
    # A whole-directory run (e.g. `pytest tests/integration -v`) covers every file in it.
    text = CI_YML.read_text(encoding='utf-8')
    return set(re.findall(r'pytest\s+(tests/[\w]+)\s', text))


@pytest.mark.feature
def test_every_feature_and_ui_test_file_runs_in_ci():
    referenced = _ci_referenced_paths()
    whole_dirs = _ci_referenced_dirs()
    missing = []
    for d in SHARDED_DIRS:
        if f'tests/{d}' in whole_dirs:
            continue
        for f in sorted((REPO_ROOT / 'tests' / d).glob('test_*.py')):
            rel = f'tests/{d}/{f.name}'
            if rel not in referenced:
                missing.append(rel)
    assert not missing, (
        'These test files are not listed in any ci.yml shard, so CI never runs them — '
        'add each to a test-features-*/test-ui-* job:\n  ' + '\n  '.join(missing)
    )


@pytest.mark.feature
def test_ci_shards_reference_only_existing_files():
    """Negative: a renamed/deleted test file left in a shard makes pytest error out
    ("file or directory not found") — catch it here with a clearer message."""
    stale = sorted(p for p in _ci_referenced_paths() if not (REPO_ROOT / p).is_file())
    assert not stale, 'ci.yml references test files that no longer exist:\n  ' + '\n  '.join(stale)


@pytest.mark.feature
def test_no_test_file_listed_in_two_shards():
    text = CI_YML.read_text(encoding='utf-8')
    paths = re.findall(r'^\s+(tests/(?:features|ui)/test_\w+\.py)\s*\\?\s*$', text, re.MULTILINE)
    dupes = sorted({p for p in paths if paths.count(p) > 1})
    assert not dupes, 'Test files listed in more than one shard (run twice):\n  ' + '\n  '.join(dupes)


@pytest.mark.feature
def test_guard_detects_an_unlisted_file(tmp_path):
    """Negative: prove the matcher actually flags a file absent from ci.yml text."""
    referenced = _ci_referenced_paths()
    assert 'tests/features/test_definitely_not_a_real_file.py' not in referenced
    assert 'tests/features/test_debts.py' in referenced
