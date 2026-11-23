"""Pure, stdlib-only helpers for tests/conftest.py (#475, #558): importable without Playwright.

* `acquire_stack_lock` holds an exclusive cross-process file lock for the whole pytest
  session, so two pytest processes can't share one stack (they share one user and wipe
  each other's data).
* `registration_allowed` is the opt-in gate for registering the test user.
* `write_json_atomic` writes the session cookie cache atomically with 0600 permissions.
"""

import hashlib
import json
import os
import tempfile

LOCK_OVERRIDE_ENV = 'TEST_SKIP_STACK_LOCK'
REGISTER_OPT_IN_ENV = 'TEST_ALLOW_REGISTER'

_held = {}  # lock path -> open file handle, kept for the life of the process


def lock_path_for(api_root):
    key = hashlib.sha256(api_root.rstrip('/').encode()).hexdigest()[:16]
    return os.path.join(tempfile.gettempdir(), f'myfinances-test-stack-{key}.lock')


def _try_lock(fh):
    """Take a non-blocking exclusive lock on byte 0 of `fh`. Returns True on success."""
    if os.name == 'nt':
        import msvcrt
        try:
            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
            return True
        except OSError:
            return False
    import fcntl
    try:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError:
        return False


def acquire_stack_lock(api_root, env=None):
    """Hold the session lock for `api_root`. Idempotent within a process.

    Returns the lock file path, or None when skipped via TEST_SKIP_STACK_LOCK=1.
    Raises StackLockedError when another process holds it. The OS releases the lock
    when this process dies, so a crashed run never leaves a stale lock.
    """
    env = os.environ if env is None else env
    if env.get(LOCK_OVERRIDE_ENV) == '1':
        return None
    path = lock_path_for(api_root)
    if path in _held:
        return path
    fh = open(path, 'a+b')
    if not _try_lock(fh):
        fh.close()
        raise StackLockedError(
            f'Another pytest process is already using the stack at {api_root} (lock file: {path}).\n'
            'Two runs would share one test user and wipe each other\'s data. Wait for the other run, '
            'or point this run at its own stack. To bypass the lock (not recommended), '
            f'set {LOCK_OVERRIDE_ENV}=1.'
        )
    _held[path] = fh
    return path


class StackLockedError(RuntimeError):
    pass


def registration_allowed(env=None):
    """True only when the operator explicitly opted in to registering the test user."""
    env = os.environ if env is None else env
    return env.get(REGISTER_OPT_IN_ENV) == '1'


def needs_setup_message(api_root, email):
    return (
        f'Test harness: {api_root} reports needsSetup (no user exists yet), and the harness will not '
        f'claim a fresh stack on its own. Create the test user "{email}" with the server script (see CLAUDE.md):\n'
        f"  printf '%s\\n%s\\n' {email} '<password>' | docker compose run --rm -T server node scripts/create-user.js\n"
        f'or, on a disposable stack with ALLOW_SETUP=true, set {REGISTER_OPT_IN_ENV}=1 to let the harness register it.'
    )


def write_json_atomic(path, data):
    """Write `data` as JSON to `path` via a temp file in the same directory and os.replace,
    chmod 0600 (best effort on Windows). Raises OSError on failure."""
    directory = os.path.dirname(path) or '.'
    fd, tmp = tempfile.mkstemp(prefix='.myfinances-tmp-', dir=directory)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f)
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
