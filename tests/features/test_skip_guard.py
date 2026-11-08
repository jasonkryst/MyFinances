#!/usr/bin/env python3
"""
Element-missing skip guard (issue #544).

`if not el: pytest.skip(...)` turns a removed or renamed control into a skip
instead of a failure, and CI stays green. Two Ledger Clear-filters tests
looked for the wrong id and skipped on every run, so that behaviour had no
running test (and a page-size reset bug went unnoticed).

This static scan fails on a `pytest.skip(` whose controlling `if` tests for a
missing element: `if not <name>:`, `if <name> is None:`, or a condition that
queries the page (`query_selector`, `locator`, `is_visible`, `is_hidden`,
`.count()`). Use an assert instead. Skips that depend on the date or the
environment (e.g. `if today.day <= 1:`) are not affected. A genuine case is
exempt when the skip line carries `# skip-ok: <reason>`; the reason is
required.
"""

import re
from pathlib import Path

import pytest

TESTS_ROOT = Path(__file__).resolve().parents[1]

_SKIP = re.compile(r"\bpytest\.skip\(")
_IF = re.compile(r"^\s*(?:el)?if\s+(?P<cond>.+?)\s*:\s*(?:#.*)?$")
_ELEMENT_COND = re.compile(
    r"^not\s+[A-Za-z_][\w.]*$"                     # if not el
    r"|^[A-Za-z_][\w.]*\s+is\s+None$"             # if el is None
    r"|query_selector|locator\(|is_visible\(|is_hidden\(|\.count\(\)"
)
_MARKER = re.compile(r"#\s*skip-ok:\s*\S")


def find_element_skips(source):
    """Return 1-based line numbers of element-missing pytest.skip calls."""
    lines = source.splitlines()
    bad = []
    for i, line in enumerate(lines):
        if not _SKIP.search(line) or line.lstrip().startswith('#') or _MARKER.search(line):
            continue
        # One-line form: `if not el: pytest.skip(...)`
        inline = re.match(r"^\s*(?:el)?if\s+(?P<cond>.+?)\s*:\s*pytest\.skip\(", line)
        if inline:
            cond = inline.group('cond')
        else:
            j = i - 1
            while j >= 0 and (not lines[j].strip() or lines[j].lstrip().startswith('#')):
                j -= 1
            m = _IF.match(lines[j]) if j >= 0 else None
            if not m:
                continue
            cond = m.group('cond')
        if _ELEMENT_COND.search(cond.strip()):
            bad.append(i + 1)
    return bad


# ── Detector cases ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("snippet", [
    "btn = page.query_selector('#x')\nif not btn:\n    pytest.skip('no button')\n",
    "if not clear_btn:\n\n    # missing\n    pytest.skip('No #clearFiltersBtn element found')\n",
    "el = page.query_selector('#x')\nif el is None:\n    pytest.skip('gone')\n",
    "if not page.query_selector('#x'):\n    pytest.skip('gone')\n",
    "if page.locator('#x').count() == 0:\n    pytest.skip('gone')\n",
    "if not page.is_visible('#x'):\n    pytest.skip('hidden')\n",
    "if not self.btn:\n    pytest.skip('gone')\n",
    "if not btn: pytest.skip('one-liner')\n",
    "elif not btn:\n    pytest.skip('gone')\n",
])
def test_detector_flags_element_missing_skips(snippet):
    assert find_element_skips(snippet), snippet


@pytest.mark.parametrize("snippet", [
    # Date- and environment-dependent skips are #552's business, not this guard's.
    "if date.today().day <= 1:\n    pytest.skip('Cannot test on the 1st')\n",
    "if target_day > last_day:\n    pytest.skip('no room this month')\n",
    "if os.environ.get('ALLOW_SETUP') == 'true':\n    pytest.skip('gate open')\n",
    # An assert is the fix, not a skip.
    "btn = page.query_selector('#x')\nassert btn, 'missing'\n",
    # Exempt with a reason.
    "if not btn:\n    pytest.skip('flaky upstream')  # skip-ok: tracked in #999\n",
    # Commented-out code.
    "if not btn:\n    # pytest.skip('old')\n    pass\n",
    # Unconditional skip.
    "def test_x():\n    pytest.skip('not implemented')\n",
])
def test_detector_ignores_other_skips(snippet):
    assert find_element_skips(snippet) == [], snippet


def test_marker_requires_a_reason():
    assert find_element_skips("if not btn:\n    pytest.skip('x')  # skip-ok:\n")


# ── Repository scan ───────────────────────────────────────────────────────────

def test_no_element_missing_skips_in_tests():
    offenders = []
    for path in sorted(TESTS_ROOT.rglob('*.py')):
        if '__pycache__' in path.parts or path.name == Path(__file__).name:
            continue
        for lineno in find_element_skips(path.read_text(encoding='utf-8')):
            offenders.append(f"{path.relative_to(TESTS_ROOT.parent)}:{lineno}")
    assert not offenders, (
        "These tests skip when an element is missing, which hides a removed or "
        "renamed control. Assert instead, or add `# skip-ok: <reason>`:\n  "
        + "\n  ".join(offenders)
    )
