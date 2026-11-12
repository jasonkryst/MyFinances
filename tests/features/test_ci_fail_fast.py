#!/usr/bin/env python3
"""
Fail-fast guards for CI (issues #551, #469). Pure file parsing plus two tiny
pytest subprocesses; no browser and no Docker stack.

- A hung test or a broken boot must fail with a traceback quickly, not run to the
  job timeout: pytest-timeout (`timeout` in pytest.ini) and `--maxfail` on every
  pytest job, with a 15-minute job cap.
- .github/actions/start-stack prints diagnostics and retries once (#469).

The checks are small pure functions so the negative tests can feed them a
synthetic job that lacks the setting.
"""

import re
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
CI_YML = REPO_ROOT / '.github' / 'workflows' / 'ci.yml'
START_STACK = REPO_ROOT / '.github' / 'actions' / 'start-stack' / 'action.yml'
PYTEST_INI = REPO_ROOT / 'pytest.ini'
REQUIREMENTS = REPO_ROOT / 'tests' / 'requirements.txt'
MAX_JOB_MINUTES = 15


# ── pure checks ──────────────────────────────────────────────────────────────

def split_jobs(ci_text):
    """{job_id: block_text} for every top-level job under `jobs:`."""
    body = ci_text.replace('\r\n', '\n').split('\njobs:\n', 1)[1]
    parts = re.split(r'^  ([A-Za-z0-9_-]+):\s*$', body, flags=re.MULTILINE)
    return {parts[i]: parts[i + 1] for i in range(1, len(parts), 2)}


def runs_pytest(block):
    return bool(re.search(r'^\s*(?:-\s+)?(?:run:\s*)?pytest\s', block, re.MULTILINE))


def job_problems(block):
    """What a pytest job is missing, as a list of short strings."""
    problems = []
    if '--maxfail=' not in block:
        problems.append('no --maxfail=')
    m = re.search(r'^    timeout-minutes:\s*(\d+)\s*$', block, re.MULTILINE)
    if not m:
        problems.append('no timeout-minutes')
    elif int(m.group(1)) > MAX_JOB_MINUTES:
        problems.append(f'timeout-minutes {m.group(1)} > {MAX_JOB_MINUTES}')
    return problems


def ci_problems(ci_text):
    jobs = split_jobs(ci_text)
    out = {j: job_problems(b) for j, b in jobs.items() if runs_pytest(b)}
    return {j: p for j, p in out.items() if p}


def pytest_ini_has_timeout(ini_text):
    return bool(re.search(r'^timeout\s*=\s*\d+\s*$', ini_text, re.MULTILINE))


def requirements_pin_timeout(req_text):
    return bool(re.search(r'^pytest-timeout\b', req_text, re.MULTILINE | re.IGNORECASE))


def start_stack_problems(action_text):
    wanted = {
        'docker compose ps': 'container status on failure',
        'docker compose logs': 'service logs on failure',
        'docker compose down -v': 'teardown before the retry',
        'ss -ltn': 'port 32900 wait / owner diagnostics',
    }
    return [why for needle, why in wanted.items() if needle not in action_text]


# ── the real repo ────────────────────────────────────────────────────────────

@pytest.mark.feature
def test_every_pytest_job_has_maxfail_and_a_15_minute_cap():
    bad = ci_problems(CI_YML.read_text(encoding='utf-8'))
    assert not bad, 'ci.yml pytest jobs need --maxfail=N and timeout-minutes <= 15:\n  ' + '\n  '.join(
        f'{j}: {", ".join(p)}' for j, p in sorted(bad.items()))


@pytest.mark.feature
def test_ci_has_pytest_jobs_for_the_guard_to_check():
    """Sanity: the parser must see the Playwright jobs, or the guard above is vacuous."""
    jobs = {j for j, b in split_jobs(CI_YML.read_text(encoding='utf-8')).items() if runs_pytest(b)}
    assert {'test-features-a', 'test-features-l', 'test-ui-a', 'test-postgres', 'test-a11y',
            'test-security', 'test-integration'} <= jobs
    assert not ({'test-unit', 'test-server', 'mutation-testing', 'lighthouse'} & jobs)


@pytest.mark.feature
def test_pytest_ini_sets_a_per_test_timeout():
    assert pytest_ini_has_timeout(PYTEST_INI.read_text(encoding='utf-8')), 'pytest.ini needs `timeout = N`'


@pytest.mark.feature
def test_requirements_include_pytest_timeout():
    assert requirements_pin_timeout(REQUIREMENTS.read_text(encoding='utf-8')), \
        'tests/requirements.txt must list pytest-timeout'


@pytest.mark.feature
def test_start_stack_prints_diagnostics_and_retries_once():
    text = START_STACK.read_text(encoding='utf-8')
    assert not start_stack_problems(text), start_stack_problems(text)
    assert len(re.findall(r'start_once', text)) >= 3, 'start-stack must call its start function twice (one retry)'


# ── negative controls ────────────────────────────────────────────────────────

SYNTHETIC_CI = textwrap.dedent('''\
    name: CI
    jobs:
      good:
        runs-on: ubuntu-latest
        timeout-minutes: 15
        steps:
          - run: pytest tests/a --maxfail=15 -v
      no-maxfail:
        runs-on: ubuntu-latest
        timeout-minutes: 15
        steps:
          - run: |
              pytest \\
                tests/a.py \\
                -v
      slow:
        runs-on: ubuntu-latest
        timeout-minutes: 20
        steps:
          - run: pytest tests/a --maxfail=15 -v
      no-timeout:
        runs-on: ubuntu-latest
        steps:
          - run: pytest tests/a --maxfail=15 -v
      node-job:
        runs-on: ubuntu-latest
        timeout-minutes: 45
        steps:
          - run: npm test
''')


@pytest.mark.feature
def test_guard_flags_missing_maxfail_long_timeout_and_missing_timeout():
    bad = ci_problems(SYNTHETIC_CI)
    assert set(bad) == {'no-maxfail', 'slow', 'no-timeout'}
    assert bad['no-maxfail'] == ['no --maxfail=']
    assert bad['slow'] == ['timeout-minutes 20 > 15']
    assert bad['no-timeout'] == ['no timeout-minutes']


@pytest.mark.feature
def test_guard_ignores_non_pytest_jobs():
    assert 'node-job' not in ci_problems(SYNTHETIC_CI)


@pytest.mark.feature
def test_ini_and_requirements_checks_reject_missing_entries():
    assert not pytest_ini_has_timeout('[pytest]\nasyncio_mode = auto\n')
    assert not pytest_ini_has_timeout('[pytest]\n# timeout = 120\n')
    assert pytest_ini_has_timeout('[pytest]\ntimeout = 120\n')
    assert not requirements_pin_timeout('playwright\npytest\n')
    assert requirements_pin_timeout('pytest\npytest-timeout==2.3.1\n')


@pytest.mark.feature
def test_start_stack_check_reports_a_bare_action():
    assert len(start_stack_problems('docker compose up -d\n')) == 4
    assert start_stack_problems('docker compose ps -a docker compose logs docker compose down -v ss -ltn') == []


# ── functional: the plugins are installed and actually fire ──────────────────

def _run_pytest(tmp_path, source, *args):
    """Run pytest on a throwaway file outside the repo (own rootdir, no conftest/ini)."""
    test_file = tmp_path / 'test_tmp_probe.py'
    test_file.write_text(textwrap.dedent(source), encoding='utf-8')
    return subprocess.run(
        [sys.executable, '-m', 'pytest', str(test_file), '-q', '-p', 'no:cacheprovider', *args],
        cwd=tmp_path, capture_output=True, text=True, timeout=120)


@pytest.mark.feature
def test_pytest_timeout_plugin_fails_a_hung_test(tmp_path):
    proc = _run_pytest(tmp_path, '''
        import time
        def test_hangs():
            time.sleep(5)
    ''', '-p', 'timeout', '--timeout=1')
    out = proc.stdout + proc.stderr
    assert proc.returncode != 0, out
    assert 'Timeout' in out, out


@pytest.mark.feature
def test_pytest_timeout_does_not_fail_a_fast_test(tmp_path):
    """Negative control: a quick test passes under the same flags."""
    proc = _run_pytest(tmp_path, '''
        def test_fast():
            assert True
    ''', '-p', 'timeout', '--timeout=1')
    assert proc.returncode == 0, proc.stdout + proc.stderr


@pytest.mark.feature
def test_maxfail_stops_after_the_first_failure(tmp_path):
    proc = _run_pytest(tmp_path, '''
        def test_one():
            assert False
        def test_two():
            assert False
    ''', '--maxfail=1')
    out = proc.stdout + proc.stderr
    assert proc.returncode != 0, out
    assert 'stopping after 1 failures' in out, out
    assert '1 failed' in out and '2 failed' not in out, out
