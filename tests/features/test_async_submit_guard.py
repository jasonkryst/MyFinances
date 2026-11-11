#!/usr/bin/env python3
"""
Async add-form submit guard (issue #592).

Since v7, addAccount/addDebt await the server POST before they swap in the
real id, re-render and reset/close the form. A test that clicks
#accountFormSubmit or #debtFormSubmit and then acts straight away races that
POST: it can pick the account's temporary id in a dropdown (the server then
rejects the linked income with a 400), or click #debtFormToggle while the
form is still open and close it. Both failed CI intermittently.

This static scan fails when a Submit click on either form is not immediately
followed by a wait. Use `submit_account_form` / `submit_debt_form` from
tests/conftest.py (or their `_async` twins). A click whose save is meant not to
finish (validation rejects it and the alert opens synchronously, or the test
deliberately fails or holds the POST) is exempt when its line carries
`# submit-no-wait: <reason>`. The reason is required.
"""

import re
from pathlib import Path

import pytest

TESTS_ROOT = Path(__file__).resolve().parents[1]

_SUBMIT_CLICK = re.compile(r"""\.click\(\s*['"]#(?:account|debt)FormSubmit['"]""")
_LOCATOR_SUBMIT_CLICK = re.compile(r"""locator\(\s*['"]#(?:account|debt)FormSubmit['"]\s*\)\.click\(""")
# A real wait on app state. wait_for_timeout is a sleep, not a sync point.
_WAIT = re.compile(r"\b(wait_for_function|wait_for_selector|wait_for_api|wait_for_url|expect)\s*\(|\.wait_for\(")
_MARKER = re.compile(r"#\s*submit-no-wait:\s*\S")


def find_unawaited_submits(source):
    """Return 1-based line numbers of Submit clicks with no wait on the next code line."""
    lines = source.splitlines()
    bad = []
    for i, line in enumerate(lines):
        if not (_SUBMIT_CLICK.search(line) or _LOCATOR_SUBMIT_CLICK.search(line)):
            continue
        if line.lstrip().startswith('#'):
            continue
        if _MARKER.search(line):
            continue
        j = i + 1
        while j < len(lines) and (not lines[j].strip() or lines[j].lstrip().startswith('#')):
            j += 1
        nxt = lines[j] if j < len(lines) else ''
        if not _WAIT.search(nxt):
            bad.append(i + 1)
    return bad


# ── Detector cases ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("snippet", [
    # Acting on the page right after Submit: the POST may still be in flight.
    "page.click('#accountFormSubmit')\npage.click('button[data-page=\"income\"]')\n",
    "page.click('#debtFormSubmit')\npage.click('#debtFormToggle')\n",
    # Submit as the last statement of a loop body or helper.
    "for d in debts:\n    page.click('#debtFormSubmit')\n\n\ndef next_test():\n    pass\n",
    # A sleep is not a sync point.
    "page.click('#accountFormSubmit')\npage.wait_for_timeout(500)\n",
    # Async and locator forms.
    "await page.click('#accountFormSubmit')\nawait page.click('button[data-page=\"savings\"]')\n",
    "page.locator('#debtFormSubmit').click()\nx = page.evaluate('() => 1')\n",
    # The exemption marker needs a reason.
    "page.click('#debtFormSubmit')  # submit-no-wait:\nmodal = page.query_selector('#alertModal')\n",
    # Double quotes.
    'page.click("#debtFormSubmit")\nassert page.query_selector("#debtsList")\n',
], ids=["account-then-nav", "debt-then-toggle", "end-of-loop", "sleep",
        "async", "locator", "marker-without-reason", "double-quotes"])
def test_detector_flags_unawaited_submit(snippet):
    assert find_unawaited_submits(snippet) == [snippet.splitlines().index(
        next(l for l in snippet.splitlines() if 'FormSubmit' in l)) + 1]


@pytest.mark.parametrize("snippet", [
    "page.click('#accountFormSubmit')\npage.wait_for_function(\"() => true\")\n",
    "page.click('#debtFormSubmit')\n\n# comment line is skipped\npage.wait_for_selector('#debtsList >> text=X')\n",
    "await page.click('#accountFormSubmit')\nawait page.wait_for_function(\"() => true\")\n",
    "page.click('#debtFormSubmit')\nwait_for_api(page, '/api/debts', lambda r: r)\n",
    "page.click('#debtFormSubmit')\nexpect(page.locator('#alertModal')).to_be_visible()\n",
    "page.click('#debtFormSubmit')  # submit-no-wait: validation rejects a blank name\nmodal = page.query_selector('#alertModal')\n",
    "submit_debt_form(page)\npage.click('#debtFormToggle')\n",
    "# page.click('#debtFormSubmit')\npage.click('#x')\n",
    "page.click('#incomeFormSubmit')\npage.click('#x')\n",
], ids=["wait-function", "wait-selector-after-comment", "async-wait", "wait-for-api",
        "expect", "no-wait-marker", "helper", "commented-out", "other-form"])
def test_detector_accepts_awaited_or_exempt_submit(snippet):
    assert find_unawaited_submits(snippet) == []


# ── The scan ─────────────────────────────────────────────────────────────────

def test_no_unawaited_account_or_debt_submits_in_tests():
    """Every #accountFormSubmit / #debtFormSubmit click in tests/ is followed by a wait."""
    offenders = []
    for path in sorted(TESTS_ROOT.rglob('*.py')):
        if path.name == Path(__file__).name:
            continue
        for lineno in find_unawaited_submits(path.read_text(encoding='utf-8')):
            offenders.append(f"{path.relative_to(TESTS_ROOT.parent).as_posix()}:{lineno}")
    assert not offenders, (
        "Submit clicked without waiting for the async save (issue #592). Use "
        "submit_account_form/submit_debt_form from tests/conftest.py, follow the click "
        "with a wait, or, if the save is meant not to finish, mark the click with '# submit-no-wait: <reason>':\n  "
        + "\n  ".join(offenders)
    )
