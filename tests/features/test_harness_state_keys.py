"""Harness hygiene (#475, #558, shard K).

* `_APP_STATE_KEYS` (what `seed_state_from_app` snapshots) must cover every collection
  `sanitizeParsedState` persists, so a new persisted collection can't silently be skipped
  by seeded tests.
* The registration opt-in, the stack lock and the session cache write behave as documented.
"""

import json
import os
import subprocess
import sys

import pytest

from tests import harness_support
from tests.conftest import _APP_STATE_KEYS

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Keys sanitizeParsedState returns that are deliberately NOT app arrays/objects seeded from
# window.app[key]; each one is carried another way.
EXEMPT_STATE_KEYS = {
    'monthlyPayment': 'plan setting; seed_state passes state.monthlyPayment to replaceForPostgres directly',
    'strategy': 'plan setting; seed_state passes state.strategy to replaceForPostgres directly',
    'ledgerSettings': 'view state kept in app._ledger* fields, not an app collection',
    'forecastSettings': 'view state kept in app._forecast* fields, not an app collection',
    'settings': 'key/value store written through /api/settings, not an app array',
}


def missing_state_keys(sanitized_keys, app_state_keys, exempt=EXEMPT_STATE_KEYS):
    """(persisted keys the list misses, listed keys the sanitizer no longer has)."""
    persisted = set(sanitized_keys) - set(exempt)
    listed = set(app_state_keys)
    return sorted(persisted - listed), sorted(listed - set(sanitized_keys))


@pytest.mark.feature
def test_app_state_keys_cover_every_persisted_collection(app_page):
    keys = app_page.evaluate("""async () => {
        const { sanitizeParsedState } = await import('/src/sanitizers.js');
        return Object.keys(sanitizeParsedState({}));
    }""")
    assert keys, 'sanitizeParsedState({}) returned no keys'
    missing, stale = missing_state_keys(keys, _APP_STATE_KEYS)
    assert not missing, (
        f'tests/conftest.py _APP_STATE_KEYS misses persisted collection(s) {missing}: add them, or '
        'add an exemption with a reason to EXEMPT_STATE_KEYS in this file')
    assert not stale, f'_APP_STATE_KEYS lists key(s) sanitizeParsedState no longer returns: {stale}'


@pytest.mark.feature
def test_state_key_comparison_flags_a_removed_key():
    """Negative control: dropping a key from the list (or a new sanitizer key) is reported."""
    sanitized = list(_APP_STATE_KEYS) + list(EXEMPT_STATE_KEYS)
    assert missing_state_keys(sanitized, _APP_STATE_KEYS) == ([], [])
    assert missing_state_keys(sanitized, [k for k in _APP_STATE_KEYS if k != 'transfers'])[0] == ['transfers']
    assert missing_state_keys(sanitized + ['newCollection'], _APP_STATE_KEYS)[0] == ['newCollection']
    assert missing_state_keys(sanitized, list(_APP_STATE_KEYS) + ['gone'])[1] == ['gone']


# ── registration opt-in (#558) ───────────────────────────────────────────────

@pytest.mark.feature
def test_registration_requires_the_explicit_opt_in():
    assert harness_support.registration_allowed({}) is False
    assert harness_support.registration_allowed({'TEST_ALLOW_REGISTER': '0'}) is False
    assert harness_support.registration_allowed({'TEST_ALLOW_REGISTER': 'true'}) is False
    assert harness_support.registration_allowed({'TEST_ALLOW_REGISTER': '1'}) is True
    msg = harness_support.needs_setup_message('http://x', 'a@b.c')
    assert 'create-user.js' in msg and 'TEST_ALLOW_REGISTER=1' in msg


# ── stack lock (#558) ────────────────────────────────────────────────────────

_PROBE = """
import sys
from tests import harness_support as h
try:
    print('LOCKED', h.acquire_stack_lock(sys.argv[1], env={}), flush=True)
except h.StackLockedError as e:
    print('BLOCKED', e, flush=True)
    sys.exit(3)
if len(sys.argv) > 2:
    import time
    time.sleep(60)
"""


def _probe(*args, **popen_kwargs):
    env = {**os.environ, 'PYTHONPATH': ROOT}
    return subprocess.Popen([sys.executable, '-c', _PROBE, *args], cwd=ROOT, env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, **popen_kwargs)


def _run_probe(*args):
    proc = _probe(*args)
    out, _ = proc.communicate(timeout=60)
    return proc.returncode, out


@pytest.mark.feature
def test_second_process_cannot_take_the_stack_lock():
    url = f'http://lock-test.invalid/{os.getpid()}'
    holder = _probe(url, 'hold')
    try:
        assert holder.stdout.readline().startswith('LOCKED')
        code, out = _run_probe(url)
        assert code == 3, out
        assert 'Another pytest process' in out
        assert harness_support.lock_path_for(url) in out
        assert 'TEST_SKIP_STACK_LOCK=1' in out
        # A different API root is a different stack: not blocked.
        other_code, other_out = _run_probe(url + '-other')
        assert other_code == 0, other_out
    finally:
        holder.kill()
        holder.wait()
        holder.stdout.close()
    # The OS released the lock when the holder died.
    code, out = _run_probe(url)
    assert code == 0, out


@pytest.mark.feature
def test_stack_lock_can_be_overridden_and_is_idempotent():
    url = f'http://lock-test.invalid/override-{os.getpid()}'
    assert harness_support.acquire_stack_lock(url, env={'TEST_SKIP_STACK_LOCK': '1'}) is None
    first = harness_support.acquire_stack_lock(url, env={})
    assert harness_support.acquire_stack_lock(url, env={}) == first  # the holding process re-enters


# ── session cache file (#475) ────────────────────────────────────────────────

@pytest.mark.feature
def test_session_cache_write_is_atomic_and_private(tmp_path):
    target = tmp_path / 'cache.json'
    target.write_text('{"old": 1}', encoding='utf-8')
    harness_support.write_json_atomic(str(target), {'session': 's', 'csrf': 'c'})
    assert json.loads(target.read_text(encoding='utf-8')) == {'session': 's', 'csrf': 'c'}
    assert [p.name for p in tmp_path.iterdir()] == ['cache.json'], 'temp file must not be left behind'
    if os.name != 'nt':
        assert (target.stat().st_mode & 0o777) == 0o600


@pytest.mark.feature
def test_failed_cache_write_keeps_the_old_file(tmp_path):
    target = tmp_path / 'cache.json'
    target.write_text('{"old": 1}', encoding='utf-8')
    with pytest.raises(TypeError):
        harness_support.write_json_atomic(str(target), {'bad': object()})
    assert json.loads(target.read_text(encoding='utf-8')) == {'old': 1}
    assert [p.name for p in tmp_path.iterdir()] == ['cache.json']
