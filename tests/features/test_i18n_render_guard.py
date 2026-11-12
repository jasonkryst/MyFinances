#!/usr/bin/env python3
"""
i18n pseudo-locale render guard (issue #317), seeded state, plus the negative
and sanity controls. Shard test-features-l. The empty state is in
test_i18n_render_guard_empty.py (shard test-features-m); the split keeps each
shard under the 8-minute CI target as TRANSLATED_PAGES grows (issue #527).
Pages, scanner and fixture: tests/features/i18n_render_support.py.
"""

import pytest

from tests.features.i18n_render_support import (  # noqa: F401  (pseudo_page is a fixture)
    EMPTY_STATE, SCAN_JS, TRANSLATED_PAGES, _load_pseudo, check_translated_page, pseudo_page,
)


@pytest.mark.feature
@pytest.mark.parametrize('state_name', ['seeded'])
@pytest.mark.parametrize('page_name', sorted(TRANSLATED_PAGES))
def test_translated_page_has_no_untranslated_text(pseudo_page, page_name, state_name):
    check_translated_page(pseudo_page, page_name, state_name)


@pytest.mark.feature
def test_scan_detects_hardcoded_english(pseudo_page):
    """Negative control: an injected unkeyed string must be reported, so a
    passing render guard actually means something."""
    _load_pseudo(pseudo_page, EMPTY_STATE)
    pseudo_page.evaluate("""() => {
        const p = document.createElement('p');
        p.textContent = 'Hardcoded English';
        p.setAttribute('aria-label', '⟦ok⟧');
        document.getElementById('retirementSection').appendChild(p);
    }""")
    bad = pseudo_page.evaluate(SCAN_JS, {'roots': ['#retirementSection'], 'allow': []})
    assert any('Hardcoded English' in b for b in bad)


@pytest.mark.feature
def test_pseudo_locale_route_is_active(pseudo_page):
    """Sanity check: the nav is wrapped in brackets, proving the pseudo 'es'
    dictionary is the one actually loaded."""
    _load_pseudo(pseudo_page, EMPTY_STATE)
    text = pseudo_page.inner_text('.page-button[data-page="health"]').strip()
    assert text.startswith('⟦') and text.endswith('⟧'), text
