#!/usr/bin/env python3
"""
docker-entrypoint.d/40-ga-env-config.sh writes env-config.js from the
container's env vars: GA_MEASUREMENT_ID (#131) and REFRESH_ON_FOCUS_SECONDS
(#575). Both are embedded into a JS file, so anything that isn't the expected
shape must be dropped, never written. Runs the real script with `sh`, writing
to a temp file through ENV_CONFIG_OUT.
"""

import os
import shutil
import subprocess

import pytest

SCRIPT = os.path.join(os.path.dirname(__file__), '..', '..', 'docker-entrypoint.d', '40-ga-env-config.sh')
EMPTY = 'window.__ENV__ = window.__ENV__ || {};\n'

pytestmark = pytest.mark.skipif(shutil.which('sh') is None, reason='needs a POSIX sh')  # skip-ok: environment-dependent


def _run(tmp_path, **env):
    out = tmp_path / 'env-config.js'
    full_env = {k: v for k, v in os.environ.items() if k not in ('GA_MEASUREMENT_ID', 'REFRESH_ON_FOCUS_SECONDS')}
    full_env.update(env, ENV_CONFIG_OUT=str(out))
    result = subprocess.run(['sh', SCRIPT], env=full_env, capture_output=True, text=True, check=True)
    return out.read_text(), result.stderr


@pytest.mark.feature
def test_nothing_set_writes_an_empty_env(tmp_path):
    assert _run(tmp_path)[0] == EMPTY


@pytest.mark.feature
@pytest.mark.parametrize('raw,expected', [('60', '60'), ('0', '0'), ('900', '900'), ('007', '7'), ('000', '0')])
def test_refresh_seconds_written_as_a_bare_number(tmp_path, raw, expected):
    text, _ = _run(tmp_path, REFRESH_ON_FOCUS_SECONDS=raw)
    assert text == f'window.__ENV__ = Object.assign({{ REFRESH_ON_FOCUS_SECONDS: {expected} }}, window.__ENV__);\n'


@pytest.mark.feature
def test_both_values_together(tmp_path):
    text, _ = _run(tmp_path, GA_MEASUREMENT_ID='G-ABC123', REFRESH_ON_FOCUS_SECONDS='120')
    assert text == ('window.__ENV__ = Object.assign({ GA_MEASUREMENT_ID: "G-ABC123", '
                    'REFRESH_ON_FOCUS_SECONDS: 120 }, window.__ENV__);\n')


@pytest.mark.feature
@pytest.mark.parametrize('raw', ['-5', '1.5', '60s', 'abc', '1 2', '1;alert(1)', '0x10', '"60"'])
def test_invalid_refresh_seconds_is_dropped_with_a_warning(tmp_path, raw):
    text, stderr = _run(tmp_path, REFRESH_ON_FOCUS_SECONDS=raw)
    assert text == EMPTY
    assert 'REFRESH_ON_FOCUS_SECONDS' in stderr


@pytest.mark.feature
def test_invalid_refresh_keeps_a_valid_ga_id(tmp_path):
    text, _ = _run(tmp_path, GA_MEASUREMENT_ID='G-XYZ', REFRESH_ON_FOCUS_SECONDS='bad')
    assert text == 'window.__ENV__ = Object.assign({ GA_MEASUREMENT_ID: "G-XYZ" }, window.__ENV__);\n'


@pytest.mark.feature
def test_invalid_ga_id_is_still_rejected(tmp_path):
    text, stderr = _run(tmp_path, GA_MEASUREMENT_ID='G-1"};alert(1);//', REFRESH_ON_FOCUS_SECONDS='30')
    assert 'alert' not in text
    assert text == 'window.__ENV__ = Object.assign({ REFRESH_ON_FOCUS_SECONDS: 30 }, window.__ENV__);\n'
    assert 'GA_MEASUREMENT_ID' in stderr
