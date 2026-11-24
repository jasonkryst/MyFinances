#!/usr/bin/env python3
"""
The SMTP password is an environment variable (8.0.0).

Before 8.0.0 it was the Docker secret file secrets/smtp_password.txt, which
compose required to exist even when email was unused. Now:
- compose passes SMTP_PASSWORD to the server and no longer lists an
  smtp_password secret (so no file is needed);
- docker-entrypoint.sh never reads /run/secrets/smtp_password, and warns at
  startup when a mail-server user is set without a password.
Pure static and shell checks; no stack needed.
"""

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = (ROOT / 'docker-compose.yml').read_text(encoding='utf-8')
ENTRYPOINT = ROOT / 'server' / 'docker-entrypoint.sh'


def _server_block(compose):
    """The `server:` service block of docker-compose.yml."""
    m = re.search(r'^  server:\n(.*?)(?=^  \S|^\S)', compose, re.M | re.S)
    assert m, 'server service not found in docker-compose.yml'
    return m.group(1)


def test_compose_passes_smtp_password_env_to_server():
    assert re.search(r'^\s+SMTP_PASSWORD: \$\{SMTP_PASSWORD:-\}\s*$', _server_block(COMPOSE), re.M)


def _smtp_secret_wiring(compose):
    """Lines that list or define an smtp_password secret (comments ignored)."""
    return re.findall(r'^\s*(?:- smtp_password\s*$|smtp_password:)', compose, re.M)


def test_compose_has_no_smtp_password_secret():
    assert _smtp_secret_wiring(COMPOSE) == [], (
        'docker-compose.yml must not list or define an smtp_password secret: since '
        '8.0.0 the password is the SMTP_PASSWORD environment variable')


def test_checks_catch_the_old_wiring():
    """Negative case: the 7.x compose shape fails both checks."""
    old = ('services:\n  server:\n    environment:\n      SMTP_USER: x\n'
           '    secrets:\n      - smtp_password\nsecrets:\n  smtp_password:\n    file: x\n')
    assert len(_smtp_secret_wiring(old)) == 2
    assert not re.search(r'^\s+SMTP_PASSWORD: ', _server_block(old), re.M)


def test_entrypoint_never_reads_the_old_secret_into_the_env():
    src = ENTRYPOINT.read_text(encoding='utf-8')
    assert not re.search(r'export\s+SMTP_PASSWORD', src), (
        'docker-entrypoint.sh must not set SMTP_PASSWORD from a file (8.0.0)')


def _run_entrypoint(extra_env):
    env = {'PATH': os.environ.get('PATH', ''), 'DATABASE_URL': 'postgres://x'}
    env.update(extra_env)
    result = subprocess.run(
        [shutil.which('sh'), str(ENTRYPOINT), 'true'],
        env=env, capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stderr
    return result.stderr


needs_sh = pytest.mark.skipif(shutil.which('sh') is None, reason='needs a POSIX sh')  # skip-ok: environment, not a missing element


@needs_sh
def test_entrypoint_warns_when_user_set_without_password():
    err = _run_entrypoint({'SMTP_HOST': 'mail.example.com', 'SMTP_USER': 'me'})
    assert 'SMTP_PASSWORD is empty' in err


@needs_sh
@pytest.mark.parametrize('extra', [
    {'SMTP_HOST': 'mail.example.com', 'SMTP_USER': 'me', 'SMTP_PASSWORD': 'secret'},
    {'SMTP_HOST': 'mail.example.com'},  # a relay with no sign-in needs no password
    {},                                  # email off
])
def test_entrypoint_is_quiet_otherwise(extra):
    assert 'WARNING' not in _run_entrypoint(extra)
