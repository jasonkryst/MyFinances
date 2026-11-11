#!/usr/bin/env python3
"""
<html lang> follows the UI language (issue #497, WCAG 3.1.1 Language of Page).

index.html ships lang="en"; i18n.js sets document.documentElement.lang when the
module loads and on every setLocale(), so screen readers use Spanish or Polish
pronunciation rules when the UI is in those languages.
"""

import pytest

from tests.conftest import BASE_URL, open_settings, wait_for_app_ready


def _lang(page):
    return page.evaluate("() => document.documentElement.lang")


def _set_locale_via_settings(page, code):
    open_settings(page)
    page.select_option('#settingLocale', code)
    page.click('#settingsModalDoneBtn')
    page.wait_for_selector('#settingsModal.flex-visible', state='hidden', timeout=5000)


@pytest.fixture
def restore_english(app_page):
    yield app_page
    app_page.evaluate("() => localStorage.setItem('debtTrackerLocale', 'en')")


@pytest.mark.feature
def test_default_lang_is_english(restore_english):
    assert _lang(restore_english) == 'en'


@pytest.mark.feature
@pytest.mark.parametrize('code', ['es', 'pl'])
def test_lang_follows_settings_locale_and_survives_reload(restore_english, code):
    page = restore_english
    _set_locale_via_settings(page, code)
    assert _lang(page) == code
    page.reload()
    assert _lang(page) == code


@pytest.mark.feature
def test_lang_returns_to_english(restore_english):
    page = restore_english
    _set_locale_via_settings(page, 'es')
    _set_locale_via_settings(page, 'en')
    assert _lang(page) == 'en'


@pytest.mark.feature
def test_unknown_locale_falls_back_to_english_lang(restore_english):
    """Negative: an unsupported code never leaves lang empty or unsupported."""
    page = restore_english
    page.evaluate("() => window.app.setLocale('es')")
    assert _lang(page) == 'es'
    page.evaluate("() => window.app.setLocale('xx-not-a-locale')")
    assert _lang(page) == 'en'


@pytest.mark.feature
def test_corrupt_stored_locale_falls_back_to_english_lang(restore_english):
    """Negative: a tampered stored preference boots in English, with lang to match."""
    page = restore_english
    page.evaluate("() => localStorage.setItem('debtTrackerLocale', '<script>')")
    page.reload()
    assert _lang(page) == 'en'


@pytest.mark.feature
def test_login_gate_has_lang_before_sign_in(page, stack_user):
    """The gate renders before the app; lang must already match there."""
    context = page.context.browser.new_context()
    try:
        gate = context.new_page()
        gate.goto(BASE_URL)
        gate.evaluate("() => localStorage.setItem('debtTrackerLocale', 'pl')")
        gate.reload()
        wait_for_app_ready(gate)
        gate.wait_for_selector('#loginGate:not(.hidden)', timeout=15000)
        assert _lang(gate) == 'pl'
    finally:
        context.close()
