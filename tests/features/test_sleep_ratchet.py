#!/usr/bin/env python3
"""
Fixed-sleep ratchet (issue #554).

A fixed `wait_for_timeout(ms)` either wastes time (the state was ready sooner)
or flakes (the state needed longer). Replace each one with a real wait on the
expected state: `wait_for_function`, `wait_for_selector`, `expect(...)` or
`wait_for_api`.

This is a ratchet: the total number of sleeps under tests/ may not grow past
MAX_SLEEPS, and tests/features/test_filter_sort.py must stay at zero. When you
remove sleeps, lower MAX_SLEEPS to the new count so they can't creep back.
It is a pure static scan (no stack needed).
"""

import re
from pathlib import Path

TESTS_ROOT = Path(__file__).resolve().parents[1]
THIS_FILE = Path(__file__).resolve()

# Lower this whenever you remove sleeps. Never raise it.
MAX_SLEEPS = 182

ZERO_SLEEP_FILES = ["features/test_filter_sort.py"]

_SLEEP = re.compile(r"\bwait_for_timeout\(")

ADVICE = (
    "Use a real wait instead of a fixed sleep (page.wait_for_function, "
    "page.wait_for_selector, expect(...), or wait_for_api on the state you "
    "expect). When you remove sleeps, lower MAX_SLEEPS in "
    "tests/features/test_sleep_ratchet.py to the new count."
)


def count_sleeps(source):
    """Number of wait_for_timeout( calls in `source`, ignoring comment lines."""
    return sum(
        len(_SLEEP.findall(line))
        for line in source.splitlines()
        if not line.lstrip().startswith('#')
    )


def _scan():
    per_file = {}
    for path in sorted(TESTS_ROOT.rglob('*.py')):
        if path.resolve() == THIS_FILE:
            continue
        n = count_sleeps(path.read_text(encoding='utf-8'))
        if n:
            per_file[path.relative_to(TESTS_ROOT).as_posix()] = n
    return per_file


# ── Counter cases (prove the scan can see a sleep) ───────────────────────────

def test_counter_counts_calls():
    src = "page.wait_for_timeout(200)\npage.click('x'); page.wait_for_timeout(5)\n"
    assert count_sleeps(src) == 2


def test_counter_ignores_comments_and_other_waits():
    src = (
        "# page.wait_for_timeout(200) was removed\n"
        "page.wait_for_selector('#a')\n"
        "page.wait_for_function('() => true')\n"
    )
    assert count_sleeps(src) == 0


# ── The ratchet ──────────────────────────────────────────────────────────────

def test_sleep_total_does_not_exceed_max():
    per_file = _scan()
    total = sum(per_file.values())
    worst = ", ".join(f"{f}: {n}" for f, n in sorted(per_file.items(), key=lambda kv: -kv[1])[:5])
    assert total <= MAX_SLEEPS, (
        f"{total} fixed sleeps in tests/ (max {MAX_SLEEPS}). {ADVICE} Most sleeps: {worst}"
    )


def test_ratchet_is_tight():
    """MAX_SLEEPS must equal the real count, so a removal can't leave slack
    that lets new sleeps in unnoticed."""
    total = sum(_scan().values())
    assert total == MAX_SLEEPS, (
        f"{total} fixed sleeps but MAX_SLEEPS is {MAX_SLEEPS}. Lower MAX_SLEEPS to {total}."
    )


def test_zero_sleep_files_stay_at_zero():
    per_file = _scan()
    offenders = {f: per_file[f] for f in ZERO_SLEEP_FILES if f in per_file}
    assert not offenders, f"Sleeps in files that must have none: {offenders}. {ADVICE}"
