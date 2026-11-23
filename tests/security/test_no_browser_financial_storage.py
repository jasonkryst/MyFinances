#!/usr/bin/env python3
"""
Static guard: no financial data in browser storage (server-only storage, v7.0.0).

Scans every src/**/*.js plus the browser-shipped root files (sw.js, env-config.js) and
requires that EVERY mention of localStorage or sessionStorage is a direct
`.getItem(` / `.setItem(` / `.removeItem(` call whose first argument resolves to a key on
the spec section 3 allowlist (tests/browser_storage_allowlist.py, shared with the runtime
check in tests/features/test_server_only_storage.py;
docs/superpowers/specs/2026-11-03-server-only-storage-design.md).

Anything else fails: aliases (`const s = localStorage`), bracket/property access,
`localStorage.clear()`, `.key()`/`.length`, destructuring, any sessionStorage use,
`Storage.prototype`, and getItem/setItem/removeItem used any other way (`.call`,
`.apply`, `Reflect.apply`, a detached method). `window.`/`globalThis.`/`self.` prefixed
direct calls are treated like bare ones.

Constant identifiers are resolved through a `const NAME = '...'` declaration in the same
file (a name declared more than once with different values, or with a non-literal value,
is rejected rather than guessed), or through an imported `export const NAME = '...'`
elsewhere, and the RESOLVED value must be allowlisted.

The lexer that tells code from comments, strings, templates and regex literals lives in
tests/security/storage_scanner.py and is exercised by test_storage_scanner_unit.py.
"""

import os

import pytest

from tests.browser_storage_allowlist import BROWSER_ROOT_JS, NODE_ROOT_JS
from tests.security.storage_scanner import PROJECT_ROOT, problems_for, scan_all, scanned_paths


@pytest.fixture(scope='module')
def findings():
    return list(scan_all())


@pytest.mark.security
def test_scan_sees_the_known_call_sites(findings):
    """Guard the guard: the scanner must actually find the allowlisted calls."""
    hits = [r for r in findings if r[5] is None]
    keys = {r[4] for r in hits}
    assert len(hits) >= 25, hits
    assert {'debtTrackerTheme', 'debtTrackerData', 'debtTrackerStorageBackend',
            'debtTrackerReconInProgress', 'ledgerHiddenColumns'} <= keys, keys


@pytest.mark.security
def test_scan_covers_the_service_worker_and_root_scripts():
    names = {os.path.relpath(p, PROJECT_ROOT).replace('\\', '/') for p in scanned_paths()}
    assert set(BROWSER_ROOT_JS) <= names, names


@pytest.mark.security
def test_every_root_script_is_classified():
    """A new root-level .js/.mjs/.cjs must be declared browser-shipped (scanned) or Node tooling."""
    root_js = {f for f in os.listdir(PROJECT_ROOT) if f.endswith(('.js', '.mjs', '.cjs'))}
    unclassified = root_js - set(BROWSER_ROOT_JS) - set(NODE_ROOT_JS)
    assert not unclassified, (
        f'classify {sorted(unclassified)} in tests/browser_storage_allowlist.py '
        '(BROWSER_ROOT_JS if it ships to the browser, else NODE_ROOT_JS)')


@pytest.mark.security
def test_no_session_storage_in_src(findings):
    offenders = [f'{r[0]}:{r[1]}' for r in findings if r[2] == 'sessionStorage']
    assert not offenders, f'sessionStorage must not be used in the browser code: {offenders}'


@pytest.mark.security
def test_no_browser_storage_access_outside_allowlist(findings):
    problems = problems_for(findings)
    assert not problems, 'Financial/unknown data must not touch browser storage:\n  ' + '\n  '.join(problems)
