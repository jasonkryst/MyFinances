#!/usr/bin/env python3
"""
Static guard: no financial data in browser storage (server-only storage, v7.0.0).

Walks every src/**/*.js and requires that EVERY mention of localStorage or
sessionStorage is a direct `.getItem(` / `.setItem(` / `.removeItem(` call whose
first argument resolves to a key on the spec section 3 allowlist
(docs/superpowers/specs/2026-11-03-server-only-storage-design.md).

Anything else fails: aliases (`const s = localStorage`, `window.localStorage`
passed around), bracket/property access (`localStorage[k] = v`,
`localStorage.foo = v`), `localStorage.clear()`, `.key()`/`.length`, destructuring,
and any sessionStorage use at all. `window.`/`globalThis.`/`self.` prefixed
direct calls are treated like bare ones.

Constant identifiers are resolved through their `const NAME = '...'` declaration
in the same file, or through an imported `export const NAME = '...'` elsewhere in
src/, and the RESOLVED value must be allowlisted, so renaming a constant to a
financial key still fails. (The collapsible helpers in utils.js hold their
open-state in memory and never touch storage.)
"""

import os
import re

import pytest

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(PROJECT_ROOT, 'src')

# key -> (allowed operations, allowed file basenames or None for any src file)
ALLOWED_KEYS = {
    # Device preferences / transient UI state (spec section 3)
    'debtTrackerTheme': ({'getItem', 'setItem', 'removeItem'}, None),
    'debtTrackerLocale': ({'getItem', 'setItem'}, None),
    'debtTrackerCurrency': ({'getItem', 'setItem'}, None),
    'debtTrackerLastSeenVersion': ({'getItem', 'setItem'}, None),
    'debtTrackerLedgerFilters': ({'getItem', 'setItem', 'removeItem'}, None),
    'ledgerHiddenColumns': ({'getItem', 'setItem', 'removeItem'}, None),
    'debtTrackerReconInProgress': ({'getItem', 'setItem', 'removeItem'}, None),
    # Migration only: read + remove, never write
    'debtTrackerData': ({'getItem', 'removeItem'}, {'app.js', 'pgMigrationModal.js'}),
    # Stale-preference cleanup at boot: remove only
    'debtTrackerStorageBackend': ({'removeItem'}, {'app.js'}),
}

TOKEN_RE = re.compile(r'\b(localStorage|sessionStorage)\b')
CALL_RE = re.compile(
    r'(?:(?:window|globalThis|self)\s*\.\s*)?(localStorage|sessionStorage)\s*\.\s*'
    r'(getItem|setItem|removeItem)\s*\(\s*'
)
STR_ARG_RE = re.compile(r"""(['"`])([^'"`$\\]*)\1\s*[,)]""")
IDENT_ARG_RE = re.compile(r'([A-Za-z_$][\w$]*)\s*[,)]')


def _strip_comments(src):
    """Blank out // and /* */ comments, leaving string/template contents alone."""
    out, i, n = [], 0, len(src)
    while i < n:
        c, nxt = src[i], src[i + 1] if i + 1 < n else ''
        if c in '\'"`':
            j = i + 1
            while j < n and src[j] != c:
                j += 2 if src[j] == '\\' else 1
            out.append(src[i:j + 1])
            i = j + 1
        elif c == '/' and nxt == '/':
            j = src.find('\n', i)
            i = n if j == -1 else j
        elif c == '/' and nxt == '*':
            j = src.find('*/', i + 2)
            j = n if j == -1 else j + 2
            out.append(re.sub(r'[^\n]', ' ', src[i:j]))
            i = j
        else:
            out.append(c)
            i += 1
    return ''.join(out)


def _src_files():
    for root, _dirs, files in os.walk(SRC):
        for f in files:
            if f.endswith('.js'):
                yield os.path.join(root, f)


def _read(path):
    with open(path, encoding='utf-8') as fh:
        return _strip_comments(fh.read())


_CODE = {p: _read(p) for p in _src_files()}


def _resolve_const(name, own_path):
    decl = r'const\s+' + re.escape(name) + r"""\s*=\s*(['"])([^'"]*)\1"""
    m = re.search(r'\b' + decl, _CODE[own_path])
    if m:
        return m.group(2)
    found = set()
    for code in _CODE.values():
        em = re.search(r'\bexport\s+' + decl, code)
        if em:
            found.add(em.group(2))
    return found.pop() if len(found) == 1 else None


def _scan():
    """Yield (relpath, line, store, op, key, error)."""
    for path, code in _CODE.items():
        rel = os.path.relpath(path, SRC).replace('\\', '/')
        call_spans = []
        for m in CALL_RE.finditer(code):
            call_spans.append((m.start(1), m.end(1)))
            line = code.count('\n', 0, m.start()) + 1
            store, op = m.group(1), m.group(2)
            rest = code[m.end():]
            sm = STR_ARG_RE.match(rest)
            if sm:
                key = sm.group(2)
            else:
                im = IDENT_ARG_RE.match(rest)
                key = _resolve_const(im.group(1), path) if im else None
                if key is None:
                    yield rel, line, store, op, None, 'key is not a string literal or a resolvable const'
                    continue
            yield rel, line, store, op, key, None
        for m in TOKEN_RE.finditer(code):
            if any(s <= m.start() < e for s, e in call_spans):
                continue
            line = code.count('\n', 0, m.start()) + 1
            yield (rel, line, m.group(1), None, None,
                   'indirect or unsupported storage access (alias, bracket/property access, clear(), ...)')


@pytest.mark.security
def test_scan_sees_the_known_call_sites():
    """Guard the guard: the scanner must actually find the allowlisted calls."""
    hits = [r for r in _scan() if r[5] is None]
    keys = {r[4] for r in hits}
    assert len(hits) >= 25, hits
    assert {'debtTrackerTheme', 'debtTrackerData', 'debtTrackerStorageBackend',
            'debtTrackerReconInProgress', 'ledgerHiddenColumns'} <= keys, keys


@pytest.mark.security
def test_no_session_storage_in_src():
    offenders = [f'{r[0]}:{r[1]}' for r in _scan() if r[2] == 'sessionStorage']
    assert not offenders, f'sessionStorage must not be used in src/: {offenders}'


@pytest.mark.security
def test_no_browser_storage_access_outside_allowlist():
    problems = []
    for rel, line, store, op, key, err in _scan():
        where = f'{rel}:{line}'
        if store == 'sessionStorage':
            continue  # reported by test_no_session_storage_in_src
        if err:
            problems.append(f'{where}: {err}')
            continue
        if key not in ALLOWED_KEYS:
            problems.append(f'{where}: {op}({key!r}) is not an allowlisted browser-storage key')
            continue
        ops, files = ALLOWED_KEYS[key]
        if op not in ops:
            problems.append(f'{where}: {op} of {key!r} is forbidden (allowed: {sorted(ops)})')
        if files is not None and os.path.basename(rel) not in files:
            problems.append(f'{where}: {key!r} may only be used in {sorted(files)}')
    assert not problems, 'Financial/unknown data must not touch browser storage:\n  ' + '\n  '.join(problems)
