"""Static scanner for browser-storage access (see test_no_browser_financial_storage.py).

`blank_js` is a small JavaScript lexer: it understands strings, template literals (with
nested `${}`), line and block comments and regex literals (regex vs division is decided
from the previous significant token), and returns two same-length views of the source:

  code      comments blanked, everything else intact (string values stay readable)
  skeleton  comments AND the insides of strings, templates and regexes blanked, so a
            token search on it never matches text that is only data

Pure functions, no I/O except `load_files`.
"""

import os
import re

from tests.browser_storage_allowlist import ALLOWED_KEYS, BROWSER_ROOT_JS

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(PROJECT_ROOT, 'src')

_REGEX_AFTER_PUNCT = set('(,=:[!&|?{};+-*%<>~^')
_REGEX_AFTER_WORDS = {
    'return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw',
    'instanceof', 'yield', 'await',
}


def _blank(buf, a, b):
    for k in range(a, b):
        if buf[k] != '\n':
            buf[k] = ' '


def blank_js(src):
    """Return (code, skeleton) for JavaScript source `src` (same length as `src`)."""
    n = len(src)
    code, skel = list(src), list(src)
    stack = []  # '{' for a block/object, 'tpl' for a template substitution
    i = 0
    prev = ''  # previous significant token: a punctuator char, a word, '0', '"', '/re/' or 'id'

    def template(start):
        """Consume template text from `start`; return (next index, entered a ${ substitution)."""
        j = start
        while j < n:
            c = src[j]
            if c == '\\':
                j += 2
            elif c == '`':
                _blank(skel, start, j)
                return j + 1, False
            elif c == '$' and src[j + 1:j + 2] == '{':
                _blank(skel, start, j)
                stack.append('tpl')
                return j + 2, True
            else:
                j += 1
        _blank(skel, start, n)
        return n, False

    while i < n:
        c = src[i]
        d = src[i + 1] if i + 1 < n else ''
        if c in ' \t\r\n':
            i += 1
        elif c == '/' and d == '/':
            j = src.find('\n', i)
            j = n if j == -1 else j
            _blank(code, i, j)
            _blank(skel, i, j)
            i = j
        elif c == '/' and d == '*':
            j = src.find('*/', i + 2)
            j = n if j == -1 else j + 2
            _blank(code, i, j)
            _blank(skel, i, j)
            i = j
        elif c in '\'"':
            j = i + 1
            while j < n and src[j] != c and src[j] != '\n':
                j += 2 if src[j] == '\\' else 1
            _blank(skel, i + 1, min(j, n))
            i = j + 1
            prev = '"'
        elif c == '`':
            i, entered = template(i + 1)
            prev = '{' if entered else '"'
        elif c == '/':
            if prev == '' or prev in _REGEX_AFTER_PUNCT or prev in _REGEX_AFTER_WORDS:
                j, in_class = i + 1, False
                while j < n and src[j] != '\n':
                    ch = src[j]
                    if ch == '\\':
                        j += 2
                        continue
                    if ch == '[':
                        in_class = True
                    elif ch == ']':
                        in_class = False
                    elif ch == '/' and not in_class:
                        break
                    j += 1
                if j < n and src[j] == '/':
                    _blank(skel, i + 1, j)
                    j += 1
                    while j < n and src[j].isalpha():
                        j += 1
                    i, prev = j, '/re/'
                    continue
            i += 1
            prev = '/'
        elif c == '{':
            stack.append('{')
            prev = '{'
            i += 1
        elif c == '}':
            if stack and stack[-1] == 'tpl':
                stack.pop()
                i, entered = template(i + 1)
                prev = '{' if entered else '"'
            else:
                if stack:
                    stack.pop()
                prev = '}'
                i += 1
        elif c in '+-' and d == c:
            prev = c + c  # ++ / -- : treat what follows as after an operand
            i += 2
        elif c.isalnum() or c in '_$' or ord(c) > 127:
            after_dot = prev == '.'
            j = i + 1
            while j < n and (src[j].isalnum() or src[j] in '_$' or ord(src[j]) > 127):
                j += 1
            word = src[i:j]
            prev = '0' if word[0].isdigit() else ('id' if after_dot else word)
            i = j
        else:
            prev = c
            i += 1
    return ''.join(code), ''.join(skel)


TOKEN_RE = re.compile(r'\b(localStorage|sessionStorage)\b')
METHOD_RE = re.compile(r'\b(getItem|setItem|removeItem)\b')
PROTOTYPE_RE = re.compile(r'\bStorage\s*\.\s*prototype\b')
CALL_RE = re.compile(
    r'(?:(?:window|globalThis|self)\s*\.\s*)?(localStorage|sessionStorage)\s*\.\s*'
    r'(getItem|setItem|removeItem)\s*\(\s*'
)
STR_ARG_RE = re.compile(r"""(['"`])([^'"`$\\]*)\1\s*[,)]""")
IDENT_ARG_RE = re.compile(r'([A-Za-z_$][\w$]*)\s*[,)]')
DECL_RE = re.compile(r'\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*')
LITERAL_RE = re.compile(r"""(['"])([^'"\\\n]*)\1""")
EXPORT_DECL_RE = re.compile(r'\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*')


def _declarations(code, skel):
    """name -> list of literal values (None where the initialiser is not a plain string)."""
    out = {}
    for m in DECL_RE.finditer(skel):
        lit = LITERAL_RE.match(code, m.end())
        out.setdefault(m.group(1), []).append(lit.group(2) if lit else None)
    return out


def exported_consts(code, skel):
    out = {}
    for m in EXPORT_DECL_RE.finditer(skel):
        lit = LITERAL_RE.match(code, m.end())
        if lit:
            out.setdefault(m.group(1), set()).add(lit.group(2))
    return out


def scan_views(code, skel, rel, exports=None):
    """Yield (rel, line, store, op, key, error) for one file's (code, skeleton)."""
    exports = exports or {}
    decls = _declarations(code, skel)
    spans = []
    for m in CALL_RE.finditer(skel):
        spans.append((m.start(), m.end()))
        line = skel.count('\n', 0, m.start()) + 1
        store, op = m.group(1), m.group(2)
        rest = code[m.end():]
        sm = STR_ARG_RE.match(rest)
        if sm:
            yield rel, line, store, op, sm.group(2), None
            continue
        im = IDENT_ARG_RE.match(rest)
        key, why = None, 'key is not a string literal or a resolvable const'
        if im:
            name = im.group(1)
            values = decls.get(name)
            if values is not None:
                if len(set(values)) == 1 and values[0] is not None:
                    key = values[0]
                else:
                    why = f'const {name!r} is declared more than once with different or non-literal values'
            else:
                imported = exports.get(name, set())
                if len(imported) == 1:
                    key = next(iter(imported))
        if key is None:
            yield rel, line, store, op, None, why
        else:
            yield rel, line, store, op, key, None

    def in_call(pos):
        return any(s <= pos < e for s, e in spans)

    for m in TOKEN_RE.finditer(skel):
        if not in_call(m.start()):
            yield (rel, skel.count('\n', 0, m.start()) + 1, m.group(1), None, None,
                   'indirect or unsupported storage access (alias, bracket/property access, clear(), ...)')
    for m in METHOD_RE.finditer(skel):
        if not in_call(m.start()):
            yield (rel, skel.count('\n', 0, m.start()) + 1, 'Storage', m.group(1), None,
                   'getItem/setItem/removeItem used outside a direct localStorage call '
                   '(.call/.apply/.bind, Reflect, a detached method, ...)')
    for m in PROTOTYPE_RE.finditer(skel):
        yield (rel, skel.count('\n', 0, m.start()) + 1, 'Storage', None, None,
               'Storage.prototype access')


def problems_for(findings):
    """Turn scan findings into violation messages (allowlist and per-file rules applied)."""
    problems = []
    for rel, line, store, op, key, err in findings:
        where = f'{rel}:{line}'
        if err:
            problems.append(f'{where}: {err}')
        elif store == 'sessionStorage':
            problems.append(f'{where}: sessionStorage must not be used')
        elif key not in ALLOWED_KEYS:
            problems.append(f'{where}: {op}({key!r}) is not an allowlisted browser-storage key')
        else:
            ops, files = ALLOWED_KEYS[key]
            if op not in ops:
                problems.append(f'{where}: {op} of {key!r} is forbidden (allowed: {sorted(ops)})')
            if files is not None and os.path.basename(rel) not in files:
                problems.append(f'{where}: {key!r} may only be used in {sorted(files)}')
    return problems


def problems_for_source(src, rel='synthetic.js'):
    """Scan one synthetic source string end to end (used by the scanner's own tests)."""
    code, skel = blank_js(src)
    return problems_for(scan_views(code, skel, rel, exported_consts(code, skel)))


def scanned_paths():
    """Absolute paths of every browser-shipped JS file: src/**/*.js plus root sw.js/env-config.js."""
    paths = []
    for root, _dirs, files in os.walk(SRC):
        paths += [os.path.join(root, f) for f in files if f.endswith('.js')]
    paths += [os.path.join(PROJECT_ROOT, f) for f in BROWSER_ROOT_JS]
    return paths


def load_files():
    """{rel: (code, skeleton)} for every scanned file."""
    out = {}
    for path in scanned_paths():
        with open(path, encoding='utf-8') as fh:
            text = fh.read()
        rel = os.path.relpath(path, SRC if path.startswith(SRC) else PROJECT_ROOT).replace('\\', '/')
        out[rel] = blank_js(text)
    return out


def scan_all(files=None):
    files = files if files is not None else load_files()
    exports = {}
    for code, skel in files.values():
        for name, values in exported_consts(code, skel).items():
            exports.setdefault(name, set()).update(values)
    for rel, (code, skel) in files.items():
        yield from scan_views(code, skel, rel, exports)
