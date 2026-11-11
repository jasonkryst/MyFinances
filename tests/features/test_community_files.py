#!/usr/bin/env python3
"""
Community health files (GitHub's Community Standards checklist).

CODE_OF_CONDUCT.md, CONTRIBUTING.md, ACCESSIBILITY.md, the issue forms and the
pull request template describe the repository: its test files, docs and
reporting channels. These checks fail when one of them drifts, e.g. a test file
it names is renamed, a relative link breaks, or blank issues are switched back on.

Static only: no stack or browser needed. PyYAML isn't a test dependency, so
the issue forms are checked with line-level patterns.
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
TEMPLATES = ROOT / '.github' / 'ISSUE_TEMPLATE'
CONTACT_EMAIL = 'jasonkryst+github@gmail.com'

COMMUNITY_DOCS = [
    'CODE_OF_CONDUCT.md',
    'CONTRIBUTING.md',
    'ACCESSIBILITY.md',
    'SECURITY.md',
    'README.md',
    '.github/pull_request_template.md',
]
ISSUE_FORMS = ['bug_report.yml', 'feature_request.yml', 'accessibility.yml']

_LINK = re.compile(r'\]\(([^)\s]+)\)')
_CODE_PATH = re.compile(r'`((?:tests|src|server|tools|docs|\.github)/[\w./{},-]+)`')


def _slug(heading):
    """GitHub's anchor for a markdown heading."""
    text = re.sub(r'[^\w\s-]', '', heading.strip().lower())
    return re.sub(r'\s', '-', text)


def broken_links(md_path):
    """Relative links in md_path whose file, or #anchor, doesn't exist."""
    bad = []
    for target in _LINK.findall(md_path.read_text(encoding='utf-8')):
        if re.match(r'^[a-z]+:', target) or target.startswith('#'):
            continue
        path, _, anchor = target.partition('#')
        dest = (md_path.parent / path).resolve()
        if not dest.exists():
            bad.append(target)
        elif anchor and dest.is_file():
            headings = re.findall(r'^#+\s+(.+)$', dest.read_text(encoding='utf-8'), re.M)
            if anchor not in {_slug(h) for h in headings}:
                bad.append(target)
    return bad


def missing_code_paths(md_path):
    """Backticked repo paths (`tests/ui/x.py`) that don't exist."""
    missing = []
    for ref in _CODE_PATH.findall(md_path.read_text(encoding='utf-8')):
        if any(c in ref for c in '{},*'):
            continue  # a pattern such as src/locales/{en,es,pl}.js
        if not (ROOT / ref.rstrip('/.')).exists():
            missing.append(ref)
    return missing


# ── Files exist ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize('rel', COMMUNITY_DOCS + [f'.github/ISSUE_TEMPLATE/{f}' for f in ISSUE_FORMS]
                         + ['.github/ISSUE_TEMPLATE/config.yml'])
def test_community_file_exists_and_is_not_empty(rel):
    path = ROOT / rel
    assert path.is_file(), f'{rel} is missing'
    assert path.read_text(encoding='utf-8').strip(), f'{rel} is empty'


# ── Links and paths resolve ───────────────────────────────────────────────────

@pytest.mark.parametrize('rel', COMMUNITY_DOCS)
def test_relative_links_resolve(rel):
    assert broken_links(ROOT / rel) == []


@pytest.mark.parametrize('rel', ['CONTRIBUTING.md', 'ACCESSIBILITY.md', '.github/pull_request_template.md'])
def test_named_repo_paths_exist(rel):
    assert missing_code_paths(ROOT / rel) == [], \
        f'{rel} names files that no longer exist; update it'


def test_link_checker_flags_broken_targets(tmp_path):
    """Negative: the checker itself catches a missing file and a missing anchor."""
    (tmp_path / 'other.md').write_text('# Real Heading\n', encoding='utf-8')
    doc = tmp_path / 'doc.md'
    doc.write_text('[a](other.md#real-heading) [b](nope.md) [c](other.md#gone) '
                   '[d](https://example.com/x) [e](#local)', encoding='utf-8')
    assert broken_links(doc) == ['nope.md', 'other.md#gone']


def test_path_checker_flags_missing_files(tmp_path):
    doc = tmp_path / 'doc.md'
    doc.write_text('`tests/conftest.py` `tests/ui/does_not_exist.py` `src/locales/{en,es,pl}.js`',
                   encoding='utf-8')
    assert missing_code_paths(doc) == ['tests/ui/does_not_exist.py']


# ── Reporting channels ────────────────────────────────────────────────────────

@pytest.mark.parametrize('rel', ['CODE_OF_CONDUCT.md', 'ACCESSIBILITY.md',
                                 '.github/ISSUE_TEMPLATE/accessibility.yml'])
def test_private_contact_is_named(rel):
    assert CONTACT_EMAIL in (ROOT / rel).read_text(encoding='utf-8')


def test_code_of_conduct_has_no_template_placeholder():
    text = (ROOT / 'CODE_OF_CONDUCT.md').read_text(encoding='utf-8')
    assert '[INSERT CONTACT METHOD]' not in text
    assert 'version 2.1' in text


def test_security_reports_are_routed_away_from_public_issues():
    config = (TEMPLATES / 'config.yml').read_text(encoding='utf-8')
    assert re.search(r'^blank_issues_enabled:\s*false\s*$', config, re.M), \
        'blank issues should stay off so reports use a form'
    assert '/security/advisories/new' in config
    assert '/discussions' in config


# ── Issue forms ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize('name', ISSUE_FORMS)
def test_issue_form_shape(name):
    text = (TEMPLATES / name).read_text(encoding='utf-8')
    assert '\t' not in text, 'YAML must be indented with spaces'
    for key in ('name', 'description', 'labels', 'body'):
        assert re.search(rf'^{key}:', text, re.M), f'{name} has no top-level {key}:'
    assert re.search(r'^\s+required: true$', text, re.M), f'{name} has no required field'
    ids = re.findall(r'^\s+id:\s*(\S+)$', text, re.M)
    assert ids and len(ids) == len(set(ids)), f'{name} has missing or duplicate field ids: {ids}'


def test_accessibility_form_is_labelled_for_triage():
    text = (TEMPLATES / 'accessibility.yml').read_text(encoding='utf-8')
    assert re.search(r'^labels:.*"accessibility"', text, re.M)


def test_accessibility_statement_links_the_form_by_filename():
    text = (ROOT / 'ACCESSIBILITY.md').read_text(encoding='utf-8')
    for template in re.findall(r'template=([\w.-]+)', text):
        assert (TEMPLATES / template).is_file(), f'ACCESSIBILITY.md links a missing form: {template}'
