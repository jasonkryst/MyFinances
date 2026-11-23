"""Mutation checks for the browser-storage scanner (#473): synthetic sources, no browser, no stack.

Each "flagged" case is a write the old regex stripper could miss (or never looked at); each
"clean" case must not be flagged, so the lexer is not just rejecting everything.
"""

import pytest

from tests.security.storage_scanner import blank_js, problems_for_source

pytestmark = pytest.mark.security


FLAGGED = {
    'write hidden after a regex containing //': (
        "const r = /https?:\\/\\//; localStorage.setItem('debtTrackerData', x);", 'src/a.js'),
    'regex after return': (
        "function f(){ return /\\/\\//.test(s) }\nlocalStorage.setItem('debtTrackerData', x);", 'src/a.js'),
    'Storage.prototype.setItem.call': (
        "Storage.prototype.setItem.call(localStorage, 'x', y);", 'src/a.js'),
    'setItem.apply': (
        "localStorage.setItem.apply(localStorage, ['debtTrackerData', y]);", 'src/a.js'),
    'Reflect.apply setItem': (
        "Reflect.apply(Storage.prototype.setItem, localStorage, ['k', 'v']);", 'src/a.js'),
    'write in a synthetic sw.js': (
        "self.addEventListener('install', () => { localStorage.setItem('balance', '1'); });", 'sw.js'),
    'write in a synthetic env-config.js': (
        "window.__ENV__ = {}; window.localStorage.setItem('token', 'x');", 'env-config.js'),
    'non-allowlisted key': ("localStorage.setItem('accounts', '[]');", 'src/a.js'),
    'allowlisted key, forbidden op': ("localStorage.setItem('debtTrackerData', '{}');", 'src/app.js'),
    'allowlisted key, wrong file': ("localStorage.getItem('debtTrackerData');", 'src/other.js'),
    'alias': ("const s = localStorage; s.setItem('debtTrackerTheme', 'x');", 'src/a.js'),
    'bracket access': ("localStorage['debtTrackerTheme'] = 'x';", 'src/a.js'),
    'sessionStorage': ("sessionStorage.setItem('debtTrackerTheme', 'x');", 'src/a.js'),
    'same const name declared with two values (different functions)': (
        "function a(){ const KEY = 'debtTrackerTheme'; localStorage.getItem(KEY); }\n"
        "function b(){ const KEY = 'accounts'; localStorage.setItem(KEY, '1'); }", 'src/a.js'),
    'const shadowed by a non-literal': (
        "const KEY = 'debtTrackerTheme';\nfunction b(){ let KEY = compute(); localStorage.setItem(KEY, '1'); }",
        'src/a.js'),
    'write after a template literal with nested ${}': (
        "const m = `a ${ `b ${ x }` } c`; localStorage.setItem('accounts', m);", 'src/a.js'),
}

CLEAN = {
    'allowlisted key': ("localStorage.setItem('debtTrackerTheme', 'dark');", 'src/a.js'),
    'allowlisted key via const': (
        "const K = 'debtTrackerLocale'; localStorage.getItem(K);", 'src/a.js'),
    'same const redeclared with the same value': (
        "function a(){ const K = 'debtTrackerTheme'; localStorage.getItem(K); }\n"
        "function b(){ const K = 'debtTrackerTheme'; localStorage.setItem(K, 'x'); }", 'src/a.js'),
    'migration key in the permitted file': ("localStorage.getItem('debtTrackerData');", 'src/app.js'),
    'setItem in a line comment': ("// localStorage.setItem('accounts', x)\nconst a = 1;", 'src/a.js'),
    'setItem in a block comment': ("/* localStorage.setItem('accounts', x) */ const a = 1;", 'src/a.js'),
    'setItem in a string': ("const s = \"localStorage.setItem('accounts', x)\";", 'src/a.js'),
    'setItem in a template': ("const s = `localStorage.setItem('accounts', ${x})`;", 'src/a.js'),
    'setItem in a regex': ("const r = /localStorage\\.setItem\\('a'\\)/;", 'src/a.js'),
    'division is not a regex': ("const q = a / b / c; localStorage.setItem('debtTrackerTheme', 'x');", 'src/a.js'),
    'division after a call': ("const q = f(a) / 2; const w = g(b) / 3; localStorage.getItem('debtTrackerTheme');",
                              'src/a.js'),
    'url in a string': ("const u = 'https://example.com'; localStorage.getItem('debtTrackerTheme');", 'src/a.js'),
    'object with a method named setItem': ("const o = {}; // no storage here\n", 'src/a.js'),
}


@pytest.mark.parametrize('name', sorted(FLAGGED))
def test_violation_is_flagged(name):
    src, rel = FLAGGED[name]
    assert problems_for_source(src, rel), f'{name}: expected a violation, scanner found none'


@pytest.mark.parametrize('name', sorted(CLEAN))
def test_clean_source_is_not_flagged(name):
    src, rel = CLEAN[name]
    assert problems_for_source(src, rel) == [], f'{name}: unexpected violation'


def test_lexer_keeps_length_and_lines():
    src = "const a = /x\\/y/; // c\n/* b\n c */ `t ${ 1 / 2 } u`;\n"
    code, skel = blank_js(src)
    assert len(code) == len(skel) == len(src)
    assert code.count('\n') == skel.count('\n') == src.count('\n')


def test_lexer_blanks_comments_but_keeps_strings_in_code_view():
    code, skel = blank_js("a('k'); // note 'z'\n")
    assert "'k'" in code and 'note' not in code
    assert 'k' not in skel and 'note' not in skel  # string interiors are blanked in the token view


def test_regex_vs_division_decision():
    # After `)` a slash divides; after `=` or `return` it starts a regex that may contain `//`.
    _, skel = blank_js("x = (a) / 2 / 3; y = /a\\/\\/b/g; z = 4;")
    assert 'z = 4' in skel and 'x = (a) / 2 / 3' in skel
    _, skel = blank_js("function f(){ return /'/.test(s) } const t = 1;")
    assert 'const t = 1' in skel
