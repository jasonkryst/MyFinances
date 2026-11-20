#!/usr/bin/env python3
"""
Static guards for the docker-compose `backup` service (issue #656).

The service crash-looped from #159 (2026-09-14) until #656 and never wrote a
scheduled backup:
- its entrypoint was a folded (`>`) YAML block whose continuation lines were
  indented further than the first, so YAML kept the line breaks and `sh -c`
  got a line starting with `&&` (syntax error);
- it ran `chmod +x` on a script bind-mounted read-only;
- a failed pg_dump left a 0-byte .dump that looked like a backup;
- a secret file saved with CRLF failed to authenticate.

CI's test-integration job also runs tools/check-backup-service.sh against the
live stack. These checks are pure file parsing (no Docker), written as small
functions so the negative tests can feed them the old broken text.
"""

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
COMPOSE_FILES = [
    REPO_ROOT / 'docker-compose.yml',
    REPO_ROOT / 'docker-compose.dev.yml',
    REPO_ROOT / 'server' / 'docker-compose.test.yml',
]
COMPOSE = REPO_ROOT / 'docker-compose.yml'
ENTRYPOINT_SH = REPO_ROOT / 'server' / 'scripts' / 'backup-entrypoint.sh'
BACKUP_SH = REPO_ROOT / 'server' / 'scripts' / 'docker-backup.sh'
CHECK_SH = REPO_ROOT / 'tools' / 'check-backup-service.sh'
SERVER_README = REPO_ROOT / 'server' / 'README.md'
CI_YML = REPO_ROOT / '.github' / 'workflows' / 'ci.yml'

# The old, broken entrypoint (main before #656), used by the negative tests.
OLD_BACKUP_SERVICE = """\
services:
  backup:
    image: postgres:16-alpine
    volumes:
      - backup-data:/backups
      - ./server/scripts/docker-backup.sh:/usr/local/bin/docker-backup.sh:ro
    entrypoint: >
      sh -c 'echo "$${BACKUP_SCHEDULE} /usr/local/bin/docker-backup.sh >> /var/log/backup.log 2>&1"
             > /etc/crontabs/root
             && chmod +x /usr/local/bin/docker-backup.sh
             && crond -f -l 2'
"""


def _read(path):
    return path.read_text(encoding='utf-8')


def block_scalar_commands(text):
    """`entrypoint:`/`command:` keys written as a YAML block scalar (`>`, `>-`,
    `|`, ...). Line folding in those depends on indentation, which is how the
    backup entrypoint broke; use a list or a one-line string instead."""
    return [m.group(1) for m in re.finditer(r'^\s*(entrypoint|command):\s*[>|][+-]?\s*$', text, re.M)]


def readonly_mount_targets(text):
    """Container paths bind-mounted with `:ro`."""
    return re.findall(r'^\s*-\s*[^:\s]+:([^:\s]+):ro\s*$', text, re.M)


def chmod_on_readonly_mounts(text):
    """`chmod` of a read-only mounted path fails, ending any `&&` chain."""
    return [t for t in readonly_mount_targets(text) if re.search(r'chmod\b[^\n]*' + re.escape(t), text)]


def service_block(text, name):
    m = re.search(rf'^  {re.escape(name)}:\n((?:    .*\n|\s*\n)+)', text, re.M)
    return m.group(1) if m else ''


# ---------------------------------------------------------------- compose ---

@pytest.mark.parametrize('path', COMPOSE_FILES, ids=lambda p: p.name)
def test_no_block_scalar_entrypoints_or_commands(path):
    assert block_scalar_commands(_read(path)) == [], (
        f'{path.name}: write entrypoint/command as a list (#656), not a folded YAML block')


@pytest.mark.parametrize('path', COMPOSE_FILES, ids=lambda p: p.name)
def test_no_chmod_on_readonly_mounts(path):
    assert chmod_on_readonly_mounts(_read(path)) == []


def test_backup_service_runs_entrypoint_script_from_readonly_mount():
    block = service_block(_read(COMPOSE), 'backup')
    assert block, 'docker-compose.yml has no backup service'
    assert 'entrypoint: ["sh", "/usr/local/bin/backup-entrypoint.sh"]' in block
    assert '/usr/local/bin/backup-entrypoint.sh' in readonly_mount_targets(block)
    assert '/usr/local/bin/docker-backup.sh' in readonly_mount_targets(block)
    assert 'healthcheck:' in block and 'crond' in block


def test_backup_schedule_follows_tz():
    """BACKUP_SCHEDULE is read in the stack's TZ, like the server's jobs; a .env
    TZ reaches a container only if the service references it."""
    compose = _read(COMPOSE)
    block = service_block(compose, 'backup')
    assert 'TZ: "${TZ:-UTC}"' in block
    assert 'TZ: "${TZ:-UTC}"' in service_block(compose, 'server'), 'one TZ for jobs and backups'
    assert '${TZ:-UTC}' in _read(ENTRYPOINT_SH), 'the startup log line names the time zone'


def test_negative_old_entrypoint_is_flagged():
    assert block_scalar_commands(OLD_BACKUP_SERVICE) == ['entrypoint']
    assert chmod_on_readonly_mounts(OLD_BACKUP_SERVICE) == ['/usr/local/bin/docker-backup.sh']


def test_negative_list_and_one_line_forms_pass():
    ok = 'services:\n  a:\n    entrypoint: ["sh", "/x.sh"]\n    command: sh -c "echo hi && exit 0"\n'
    assert block_scalar_commands(ok) == []
    assert chmod_on_readonly_mounts(ok) == []


# ---------------------------------------------------------------- scripts ---

@pytest.mark.parametrize('path', [ENTRYPOINT_SH, BACKUP_SH, CHECK_SH], ids=lambda p: p.name)
def test_scripts_are_lf_only(path):
    assert b'\r' not in path.read_bytes(), f'{path.name} has CRLF; sh in the container would choke'


def test_entrypoint_runs_args_or_cron_in_foreground():
    src = _read(ENTRYPOINT_SH)
    assert 'exec "$@"' in src, 'with arguments it must run them (docker compose run backup sh ...)'
    assert re.search(r'^exec crond -f\b', src, re.M), 'crond must be PID 1 in the foreground'
    assert 'sh /usr/local/bin/docker-backup.sh' in src, 'run the read-only script through sh'
    assert '/proc/1/fd/1' in src, 'cron output must reach docker logs'
    assert not re.search(r'^\s*[^#\n]*\bchmod\b', src, re.M), 'never chmod a read-only mount'


def test_backup_script_never_leaves_a_fake_backup():
    src = _read(BACKUP_SH)
    assert '-f "$PARTIAL"' in src and 'mv "$PARTIAL" "$FILE"' in src
    assert re.search(r"trap 'rm -f \"\$PARTIAL\"' EXIT", src)
    assert src.index('pg_dump') < src.index('mv "$PARTIAL" "$FILE"')


def test_backup_script_strips_crlf_from_secret():
    src = _read(BACKUP_SH)
    assert "tr -d '\\r\\n' < /run/secrets/postgres_password" in src
    assert '$(cat /run/secrets/postgres_password)' not in src


# ------------------------------------------------------------ docs and CI ---

def test_readme_manual_backup_command_goes_through_sh():
    readme = _read(SERVER_README)
    assert 'docker compose run --rm backup sh /usr/local/bin/docker-backup.sh' in readme
    assert 'docker compose run --rm backup /usr/local/bin/docker-backup.sh' not in readme


def test_ci_runs_the_live_backup_check():
    assert 'bash tools/check-backup-service.sh' in _read(CI_YML)
