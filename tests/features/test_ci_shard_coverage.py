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


# ── Single required check (issue #380) ───────────────────────────────────────
# The main-branch ruleset requires the `ci-complete` job instead of every job
# name. That only works if `ci-complete` waits on every other job here --
# otherwise a new job runs but can fail without blocking a merge (the required
# list had drifted by 9 jobs before #380). Jobs that can never gate a PR are
# exempt and must be listed here explicitly.
AGGREGATOR = 'ci-complete'
NOT_GATING = {'mutation-testing'}  # post-merge only: `if: github.event_name == 'push'`


def _ci_jobs():
    """Top-level job ids under `jobs:` (two-space indented `name:` keys)."""
    text = CI_YML.read_text(encoding='utf-8')
    body = text.split('\njobs:\n', 1)[1]
    return re.findall(r'^  ([A-Za-z0-9_-]+):\s*$', body, re.MULTILINE)


def _aggregator_needs():
    text = CI_YML.read_text(encoding='utf-8')
    block = re.search(rf'^  {AGGREGATOR}:\s*\n(.*?)(?=^  \S|\Z)', text, re.MULTILINE | re.DOTALL)
    assert block, f'ci.yml has no `{AGGREGATOR}` job'
    needs = re.search(r'^    needs:\s*\n((?:      - [\w-]+\s*\n)+)', block.group(1), re.MULTILINE)
    assert needs, f'`{AGGREGATOR}` must list its dependencies as a `needs:` block list'
    return re.findall(r'- ([\w-]+)', needs.group(1))


@pytest.mark.feature
def test_ci_complete_needs_every_gating_job():
    jobs = set(_ci_jobs())
    needs = set(_aggregator_needs())
    missing = sorted(jobs - needs - NOT_GATING - {AGGREGATOR})
    assert not missing, (
        f'These ci.yml jobs are not in `{AGGREGATOR}.needs`, so a failure in them would not '
        'block merging (the ruleset only requires ci-complete):\n  ' + '\n  '.join(missing)
    )


@pytest.mark.feature
def test_ci_complete_needs_only_real_jobs():
    """Negative: a renamed/removed job left in `needs` makes the whole workflow invalid."""
    stale = sorted(set(_aggregator_needs()) - set(_ci_jobs()))
    assert not stale, f'`{AGGREGATOR}.needs` references jobs that do not exist:\n  ' + '\n  '.join(stale)


@pytest.mark.feature
def test_ci_complete_runs_even_when_a_dependency_fails():
    """Without `if: always()` the aggregator is *skipped* when a dependency
    fails -- and GitHub treats a skipped required check as passing."""
    text = CI_YML.read_text(encoding='utf-8')
    block = re.search(rf'^  {AGGREGATOR}:\s*\n(.*?)(?=^  \S|\Z)', text, re.MULTILINE | re.DOTALL).group(1)
    assert re.search(r'^    if: always\(\)\s*$', block, re.MULTILINE), f'`{AGGREGATOR}` needs `if: always()`'
    assert 'failure|cancelled' in block, f'`{AGGREGATOR}` must fail when a dependency failed or was cancelled'


@pytest.mark.feature
def test_not_gating_exemptions_are_still_post_merge_only():
    """Negative: an exempt job that starts running on PRs must be gated again."""
    text = CI_YML.read_text(encoding='utf-8')
    for job in NOT_GATING:
        block = re.search(rf'^  {job}:\s*\n(.*?)(?=^  \S|\Z)', text, re.MULTILINE | re.DOTALL)
        assert block, f'exempt job {job} no longer exists -- drop it from NOT_GATING'
        assert "github.event_name == 'push'" in block.group(1), (
            f'{job} now runs on PRs, so it must be added to `{AGGREGATOR}.needs`')


# ── Playwright install without a hard apt dependency ─────────────────────────
# `playwright install --with-deps` runs apt on every job, so an Ubuntu mirror
# outage failed all 19 Playwright jobs before a test ran (2026-11-11).
# .github/actions/install-playwright installs the browser and runs apt only
# when Chromium can't launch with the runner's own libraries.
INSTALL_ACTION = './.github/actions/install-playwright'


def _job_block(job):
    text = CI_YML.read_text(encoding='utf-8')
    return re.search(rf'^  {job}:\s*\n(.*?)(?=^  \S|\Z)', text, re.MULTILINE | re.DOTALL).group(1)


@pytest.mark.feature
def test_no_job_installs_playwright_with_apt_directly():
    text = CI_YML.read_text(encoding='utf-8')
    assert 'playwright install --with-deps' not in text, (
        f'Use `uses: {INSTALL_ACTION}` instead of `playwright install --with-deps`, '
        'so an Ubuntu mirror outage does not fail the job.')


@pytest.mark.feature
def test_every_pytest_job_installs_playwright_through_the_action():
    missing = []
    for job in _ci_jobs():
        block = _job_block(job)
        runs_pytest = re.search(r'^\s+(?:- run:\s*)?\|?\s*pytest\b', block, re.MULTILINE) or 'run: pytest' in block
        if runs_pytest and f'uses: {INSTALL_ACTION}' not in block:
            missing.append(job)
    assert not missing, f'These jobs run pytest without `uses: {INSTALL_ACTION}`:\n  ' + '\n  '.join(missing)


@pytest.mark.feature
def test_install_action_checks_the_launch_before_apt():
    """Negative: the action must try a real Chromium launch first and only then fall
    back to apt, or it is just --with-deps again."""
    action = (REPO_ROOT / '.github' / 'actions' / 'install-playwright' / 'action.yml').read_text(encoding='utf-8')
    assert 'playwright install chromium' in action
    assert '--with-deps' not in action
    launch = action.index('p.chromium.launch()')
    apt = action.index('playwright install-deps chromium')
    assert launch < apt, 'the launch check must come before the apt fallback'
    assert 'timeout ' in action, 'the apt fallback needs a timeout so a dead mirror cannot hang the job'


@pytest.mark.feature
def test_job_parser_sees_known_jobs():
    """Negative/sanity: prove the parser isn't silently returning nothing."""
    jobs = _ci_jobs()
    assert {'test-features-a', 'test-unit', 'lighthouse', AGGREGATOR} <= set(jobs)
    assert len(jobs) == len(set(jobs))
