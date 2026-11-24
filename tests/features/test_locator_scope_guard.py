#!/usr/bin/env python3
"""
Bare `text=` locator guard (issue #555).

An unscoped `text=<name>` can match a hidden element on another page (Health's
per-card credit-utilization breakdown keeps every credit-card debt's name in the
DOM, class-hidden), so the test waits on or asserts the wrong node. In the four
CRUD test files, every `text=` selector must be prefixed with its page
container (`#debtsList >> text=...`) or use a role/filter locator.

Detects a string literal (including f-strings) whose content starts with
`text=`. A genuine exception carries `# text-scope-ok: <reason>`.
"""

import re
from pathlib import Path

import pytest

TESTS_ROOT = Path(__file__).resolve().parents[1]

GUARDED_FILES = [
    'features/test_debts.py',
    'features/test_income.py',
    'features/test_accounts.py',
    'postgres/test_postgres_mutations.py',
]

_BARE_TEXT = re.compile(r"""(?<![\w])(?:[rRfF]{0,2})(['"])text=""")
_MARKER = re.compile(r"#\s*text-scope-ok:\s*\S")


def find_bare_text_locators(source):
    """Return 1-based line numbers holding a string literal that starts with `text=`."""
    bad = []
    for i, line in enumerate(source.splitlines(), start=1):
        if line.lstrip().startswith('#') or _MARKER.search(line):
            continue
        if _BARE_TEXT.search(line):
            bad.append(i)
    return bad


# -- Detector cases -----------------------------------------------------------

@pytest.mark.parametrize('line', [
    "page.wait_for_selector('text=Foo', timeout=5000)",
    'page.query_selector("text=Foo")',
    "page.query_selector(f'text={name}')",
    "await pg_page.locator('text=Foo').count()",
])
def test_scanner_detects_bare_text_locator(line):
    assert find_bare_text_locators(line + "\n") == [1]


@pytest.mark.parametrize('line', [
    "page.wait_for_selector('#debtsList >> text=Foo', timeout=5000)",
    "page.query_selector(f'#accountList >> text={name}')",
    "page.locator('#incomeList').get_by_text('Foo')",
    "page.query_selector('text=Foo')  # text-scope-ok: dialog is global",
    "# page.query_selector('text=Foo')",
    "assert name == 'context=Foo'",
])
def test_scanner_ignores_scoped_or_exempt(line):
    assert find_bare_text_locators(line + "\n") == []


# -- The guard ----------------------------------------------------------------

@pytest.mark.parametrize('rel', GUARDED_FILES)
def test_no_bare_text_locators(rel):
    source = (TESTS_ROOT / rel).read_text(encoding='utf-8')
    bad = find_bare_text_locators(source)
    assert not bad, (
        f"{rel}: bare text= locator(s) on line(s) {bad}. Scope each one to its page "
        "container (e.g. '#debtsList >> text=...'); see docs/architecture/features.md, "
        "Health per-card credit utilization breakdown (#555)."
    )
