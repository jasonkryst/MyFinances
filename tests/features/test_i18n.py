#!/usr/bin/env python3
"""
i18n Tests
src/i18n.js provides locale storage (debtTrackerLocale in localStorage,
mirroring the debtTrackerTheme/debtTrackerStorageBackend pattern), t()
lookup with English fallback, and applyStaticTranslations() for [data-i18n]
markup. The pilot translates nav/toolbar/Settings modal/Health page into
Spanish (es) and Polish (pl); other pages remain English.
"""

import pytest

from tests.conftest import BASE_URL


@pytest.mark.feature
def test_default_locale_is_english(app_page):
    """With no debtTrackerLocale preference set, the app renders in English."""
    page = app_page

    nav_text = page.inner_text('.page-button[data-page="health"]')
    assert nav_text.strip() == 'Health'

    locale = page.evaluate("() => localStorage.getItem('debtTrackerLocale')")
    assert locale is None


@pytest.mark.feature
def test_settings_modal_has_language_selector_with_three_options(app_page):
    """The Settings modal exposes a language <select> with en/es/pl options."""
    page = app_page

    page.click('#settingsBtn')
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)

    values = page.eval_on_selector_all(
        '#settingLocale option', 'opts => opts.map(o => o.value)'
    )
    assert values == ['en', 'es', 'pl']

    current = page.evaluate("() => document.getElementById('settingLocale').value")
    assert current == 'en'


@pytest.mark.feature
def test_switching_to_spanish_translates_nav_and_persists(app_page):
    """Selecting Spanish and clicking Done translates the nav immediately
    and persists debtTrackerLocale to localStorage."""
    page = app_page

    page.click('#settingsBtn')
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)
    page.select_option('#settingLocale', 'es')
    page.click('#settingsModalDoneBtn')
    page.wait_for_timeout(200)

    nav_text = page.inner_text('.page-button[data-page="health"]')
    assert nav_text.strip() == 'Salud'

    locale = page.evaluate("() => localStorage.getItem('debtTrackerLocale')")
    assert locale == 'es'


@pytest.mark.feature
def test_switching_to_polish_translates_nav_and_persists(app_page):
    """Selecting Polish and clicking Done translates the nav immediately
    and persists debtTrackerLocale to localStorage."""
    page = app_page

    page.click('#settingsBtn')
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)
    page.select_option('#settingLocale', 'pl')
    page.click('#settingsModalDoneBtn')
    page.wait_for_timeout(200)

    nav_text = page.inner_text('.page-button[data-page="health"]')
    assert nav_text.strip() == 'Kondycja'

    locale = page.evaluate("() => localStorage.getItem('debtTrackerLocale')")
    assert locale == 'pl'


@pytest.mark.feature
def test_locale_preference_persists_across_reload(page):
    """A previously-chosen locale is re-applied on the next page load."""
    page.add_init_script("""
        try { localStorage.setItem('debtTrackerLocale', 'es'); } catch (e) {}
    """)
    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)

    nav_text = page.inner_text('.page-button[data-page="health"]')
    assert nav_text.strip() == 'Salud'


@pytest.mark.feature
def test_invalid_stored_locale_falls_back_to_english(page):
    """A tampered/invalid debtTrackerLocale value doesn't crash the app or
    leave it in a broken state — it silently falls back to English."""
    page.add_init_script("""
        try { localStorage.setItem('debtTrackerLocale', 'xx-BOGUS'); } catch (e) {}
    """)
    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)

    nav_text = page.inner_text('.page-button[data-page="health"]')
    assert nav_text.strip() == 'Health'


@pytest.mark.feature
def test_untranslated_page_stays_readable_in_english_when_locale_is_spanish(app_page):
    """Accounts has no data-i18n markup yet (out of pilot scope) — switching
    to Spanish must not leave it blank or broken, just still in English."""
    page = app_page

    page.evaluate("() => window.app.setLocale('es')")
    page.click('.page-button[data-page="accounts"]')
    page.wait_for_timeout(200)

    heading = page.inner_text('#accountsSection h2')
    assert heading.strip() != ''


@pytest.mark.feature
def test_switching_to_spanish_translates_health_page_live(app_page):
    """Switching locale while Health is the active page re-renders it in
    the new language immediately, with no reload."""
    page = app_page

    page.evaluate("() => window.app.setLocale('es')")
    page.wait_for_timeout(200)

    title = page.inner_text('.health-metric-card .health-card-title')
    assert title.strip() == 'Relación Deuda-Ingreso'

    subtitle = page.inner_text('.health-subtitle')
    assert subtitle.startswith('Una evaluación de un vistazo')


@pytest.mark.feature
def test_switching_to_polish_translates_health_page_live(app_page):
    """Same as the Spanish case, for Polish."""
    page = app_page

    page.evaluate("() => window.app.setLocale('pl')")
    page.wait_for_timeout(200)

    title = page.inner_text('.health-metric-card .health-card-title')
    assert title.strip() == 'Wskaźnik Zadłużenia do Dochodu'


@pytest.mark.feature
def test_health_page_debt_free_state_translates(app_page):
    """The zero-debt empty state ('Debt Free!') translates too, not just
    the populated-data path."""
    page = app_page

    page.evaluate("""() => {
        window.app.debts = [];
        window.app.setLocale('es');
    }""")
    page.wait_for_timeout(200)

    value = page.inner_text('.health-empty-value.health-empty--green')
    assert value.strip() == '¡Libre de Deudas!'
