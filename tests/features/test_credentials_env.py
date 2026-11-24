#!/usr/bin/env python3
"""
Credentials are environment variables (8.0.0).

Before 8.0.0 the database and SMTP passwords were Docker secret files
(secrets/postgres_password.txt, secrets/smtp_password.txt) that compose
required to exist. Now:
- compose passes POSTGRES_PASSWORD (required) to postgres, server and backup,
  and SMTP_PASSWORD to the server, and defines no secrets at all;
- server/docker-entrypoint.sh builds DATABASE_URL from POSTGRES_PASSWORD
  (percent-encoded, trailing CR/LF dropped; an explicit DATABASE_URL wins),
  fails clearly without it, never reads /run/secrets, and warns when a
  mail-server user is set without SMTP_PASSWORD.
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
REQUIRED_PG = re.compile(r'^\s+POSTGRES_PASSWORD: \$\{POSTGRES_PASSWORD:\?[^}]+\}\s*$', re.M)


def _service_block(compose, name):
    m = re.search(rf'^  {name}:\n(.*?)(?=^  \S|^\S)', compose, re.M | re.S)
    assert m, f'{name} service not found'
    return m.group(1)


def _secret_wiring(compose):
    """Lines that declare or list Docker secrets (comments ignored)."""
    return re.findall(r'^\s*(?:secrets:|- (?:postgres|smtp)_password\s*$|(?:postgres|smtp)_password:)',
                      compose, re.M)


# ---------------------------------------------------------------- compose ---

@pytest.mark.parametrize('service', ['postgres', 'server', 'backup'])
def test_compose_requires_postgres_password_for(service):
    assert REQUIRED_PG.search(_service_block(COMPOSE, service)), (
        f'{service} must take POSTGRES_PASSWORD as a required variable (${{POSTGRES_PASSWORD:?...}})')


def test_compose_passes_smtp_password_env_to_server():
    assert re.search(r'^\s+SMTP_PASSWORD: \$\{SMTP_PASSWORD:-\}\s*$', _service_block(COMPOSE, 'server'), re.M)


def test_compose_defines_no_secrets():
    assert _secret_wiring(COMPOSE) == [], (
        'docker-compose.yml must not declare Docker secrets: since 8.0.0 the passwords '
        'are the POSTGRES_PASSWORD and SMTP_PASSWORD environment variables')


def test_checks_catch_the_old_wiring():
    """Negative case: the 7.x compose shape fails the checks."""
    old = ('services:\n  postgres:\n    environment:\n      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password\n'
           '    secrets:\n      - postgres_password\n  server:\n    secrets:\n      - postgres_password\n'
           '      - smtp_password\nsecrets:\n  postgres_password:\n    file: a\n  smtp_password:\n    file: b\n')
    assert len(_secret_wiring(old)) == 8
    assert not REQUIRED_PG.search(_service_block(old, 'postgres'))


# ------------------------------------------------------------- entrypoint ---

def test_entrypoint_never_reads_secret_files():
    src = ENTRYPOINT.read_text(encoding='utf-8')
    assert '/run/secrets' not in src
    assert not re.search(r'export\s+SMTP_PASSWORD', src)


needs_shell = pytest.mark.skipif(  # skip-ok: environment, not a missing element
    shutil.which('sh') is None or shutil.which('node') is None, reason='needs a POSIX sh and node')


def _run_entrypoint(extra_env, command=('true',)):
    env = {'PATH': os.environ.get('PATH', '')}
    env.update(extra_env)
    return subprocess.run([shutil.which('sh'), str(ENTRYPOINT), *command],
                          env=env, capture_output=True, text=True, timeout=30)


@needs_shell
@pytest.mark.parametrize('password, encoded', [
    ('abc123', 'abc123'),
    ('p@ss:w/rd #1', 'p%40ss%3Aw%2Frd%20%231'),
    ('crlf-end\r\n', 'crlf-end'),
])
def test_entrypoint_builds_an_encoded_database_url(password, encoded):
    result = _run_entrypoint({'POSTGRES_PASSWORD': password}, ('sh', '-c', 'printf %s "$DATABASE_URL"'))
    assert result.returncode == 0, result.stderr
    assert result.stdout == f'postgres://myfinances:{encoded}@postgres:5432/myfinances'


@needs_shell
def test_entrypoint_keeps_an_explicit_database_url():
    url = 'postgres://u:p@db:5432/x'
    result = _run_entrypoint({'POSTGRES_PASSWORD': 'ignored', 'DATABASE_URL': url},
                             ('sh', '-c', 'printf %s "$DATABASE_URL"'))
    assert result.returncode == 0 and result.stdout == url


@needs_shell
def test_entrypoint_fails_clearly_without_a_password():
    result = _run_entrypoint({})
    assert result.returncode != 0
    assert 'POSTGRES_PASSWORD is not set' in result.stderr


@needs_shell
def test_entrypoint_warns_when_smtp_user_set_without_password():
    result = _run_entrypoint({'DATABASE_URL': 'postgres://x', 'SMTP_HOST': 'mail.example.com', 'SMTP_USER': 'me'})
    assert result.returncode == 0
    assert 'SMTP_PASSWORD is empty' in result.stderr


@needs_shell
@pytest.mark.parametrize('extra', [
    {'SMTP_HOST': 'mail.example.com', 'SMTP_USER': 'me', 'SMTP_PASSWORD': 'secret'},
    {'SMTP_HOST': 'mail.example.com'},  # a relay with no sign-in needs no password
    {},                                  # email off
])
def test_entrypoint_is_quiet_otherwise(extra):
    result = _run_entrypoint({'DATABASE_URL': 'postgres://x', **extra})
    assert result.returncode == 0 and 'WARNING' not in result.stderr
