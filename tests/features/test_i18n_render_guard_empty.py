#!/usr/bin/env python3
"""
i18n pseudo-locale render guard (issue #317), empty state. Shard
test-features-m; the seeded state and the controls are in
test_i18n_render_guard.py (issue #527 split). Pages, scanner and fixture:
tests/features/i18n_render_support.py.
"""

import pytest

from tests.features.i18n_render_support import (  # noqa: F401  (pseudo_page is a fixture)
    TRANSLATED_PAGES, check_translated_page, pseudo_page,
)


@pytest.mark.feature
@pytest.mark.parametrize('state_name', ['empty'])
@pytest.mark.parametrize('page_name', sorted(TRANSLATED_PAGES))
def test_translated_page_has_no_untranslated_text(pseudo_page, page_name, state_name):
    check_translated_page(pseudo_page, page_name, state_name)
