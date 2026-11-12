#!/usr/bin/env python3
"""
i18n dictionary-parity guards (issue #317): es.js/pl.js carry exactly en.js's key
set, every translation keeps the same {placeholder} tokens as its English source,
and no value is an untranslated English stub.

The pseudo-locale render guard (TRANSLATED_PAGES, NON_TRANSLATABLE) lives in
test_i18n_render_guard.py (issue #527).
"""

import pytest

from tests.conftest import BASE_URL

LOCALES_URL = BASE_URL.rstrip('/') + '/src/locales/'


def _load_dicts(page):
    return page.evaluate(f"""async () => {{
        const load = async (c) => (await import('{LOCALES_URL}' + c + '.js?parity')).default;
        return {{ en: await load('en'), es: await load('es'), pl: await load('pl') }};
    }}""")


# ---------------------------------------------------------------- parity

@pytest.mark.feature
@pytest.mark.parametrize('locale', ['es', 'pl'])
def test_locale_has_every_english_key(app_page, locale):
    dicts = _load_dicts(app_page)
    missing = sorted(set(dicts['en']) - set(dicts[locale]))
    assert not missing, f'{locale}.js is missing {len(missing)} key(s): {missing[:20]}'


@pytest.mark.feature
@pytest.mark.parametrize('locale', ['es', 'pl'])
def test_locale_has_no_orphan_keys(app_page, locale):
    dicts = _load_dicts(app_page)
    extra = sorted(set(dicts[locale]) - set(dicts['en']))
    assert not extra, f'{locale}.js has keys not in en.js: {extra[:20]}'


@pytest.mark.feature
@pytest.mark.parametrize('locale', ['es', 'pl'])
def test_locale_placeholders_match_english(app_page, locale):
    import re
    dicts = _load_dicts(app_page)
    tok = re.compile(r'\{(\w+)\}')
    bad = [k for k, v in dicts['en'].items()
           if k in dicts[locale] and set(tok.findall(v)) != set(tok.findall(dicts[locale][k]))]
    assert not bad, f'{locale}.js placeholder mismatch: {bad[:20]}'


@pytest.mark.feature
@pytest.mark.parametrize('locale', ['es', 'pl'])
def test_locale_values_are_nonempty_strings(app_page, locale):
    dicts = _load_dicts(app_page)
    bad = [k for k, v in dicts[locale].items() if not isinstance(v, str) or not v.strip()]
    assert not bad, f'{locale}.js has empty/non-string values: {bad[:20]}'


# Keys whose translation legitimately equals the English text (acronyms,
# proper nouns, words spelled the same). Anything else identical to en.js is
# an untranslated stub — #317 found 54 Retirement "stubs" hiding behind parity.
SAME_AS_ENGLISH = {
    'es': {'nav.strategy', 'health.personDti', 'retirement.coastTitle', 'accounts.sortApyAsc',
           'accounts.sortApyDesc', 'homePurchase.pmiBelowValue', 'income.estBadge', 'savings.autoTag',
           'debts.updateOriginal', 'recurring.total', 'ownership.totalLabel', 'reports.spendDrillTitle', 'reports.no', 'reports.spendTotal',
           'ledger.originalAmount', 'people.dtiBadge', 'settings.backup.skippedItem', 'import.mergeSkippedItem'},
    'pl': {'nav.strategy', 'health.personDti', 'retirement.coastTitle', 'accounts.apyBadge',
           'accounts.sortApyAsc', 'accounts.sortApyDesc', 'savings.autoTag',
           'modals.ok', 'breakEven.start', 'category.transport', 'reports.spendDrillTitle',
           'ledger.statusLabel', 'people.dtiBadge', 'settings.backup.skippedItem', 'import.mergeSkippedItem'},
}


@pytest.mark.feature
@pytest.mark.parametrize('locale', ['es', 'pl'])
def test_locale_values_are_not_english_stubs(app_page, locale):
    dicts = _load_dicts(app_page)
    same = sorted(k for k, v in dicts['en'].items()
                  if dicts[locale].get(k) == v and k not in SAME_AS_ENGLISH[locale])
    assert not same, (f'{locale}.js has {len(same)} value(s) identical to English — translate them '
                      f'or add to SAME_AS_ENGLISH: {same[:20]}')


@pytest.mark.feature
@pytest.mark.parametrize('locale', ['es', 'pl'])
def test_same_as_english_allowlist_has_no_stale_entries(app_page, locale):
    dicts = _load_dicts(app_page)
    stale = sorted(k for k in SAME_AS_ENGLISH[locale] if dicts[locale].get(k) != dicts['en'].get(k))
    assert not stale, f'remove from SAME_AS_ENGLISH[{locale!r}]: {stale}'


@pytest.mark.feature
def test_set_locale_rerenders_current_non_health_page(app_page):
    """setLocale re-renders whichever page is open, not just Health."""
    page = app_page
    page.evaluate("""async () => {
        window.app.switchPage('retirement');
        await window.app.renderRetirementPage();
    }""")
    page.wait_for_selector('#retirementSection h2')
    before = page.inner_text('#retirementSection h2').strip()
    page.evaluate("() => window.app.setLocale('es')")
    page.wait_for_function(
        "(b) => document.querySelector('#retirementSection h2')?.textContent.trim() !== b", arg=before)
    assert 'Jubilación' in page.inner_text('#retirementSection h2')
