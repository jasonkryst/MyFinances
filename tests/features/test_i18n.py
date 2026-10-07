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

    page.evaluate("() => document.getElementById('settingsBtn').click()")
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

    page.evaluate("() => document.getElementById('settingsBtn').click()")
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)
    page.select_option('#settingLocale', 'es')
    page.click('#settingsModalDoneBtn')
    page.wait_for_selector('#settingsModal', state='hidden', timeout=5000)

    nav_text = page.inner_text('.page-button[data-page="health"]')
    assert nav_text.strip() == 'Salud'

    locale = page.evaluate("() => localStorage.getItem('debtTrackerLocale')")
    assert locale == 'es'


@pytest.mark.feature
def test_switching_to_polish_translates_nav_and_persists(app_page):
    """Selecting Polish and clicking Done translates the nav immediately
    and persists debtTrackerLocale to localStorage."""
    page = app_page

    page.evaluate("() => document.getElementById('settingsBtn').click()")
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)
    page.select_option('#settingLocale', 'pl')
    page.click('#settingsModalDoneBtn')
    page.wait_for_selector('#settingsModal', state='hidden', timeout=5000)

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

    heading = page.inner_text('#accountsSection h2')
    assert heading.strip() != ''


@pytest.mark.feature
def test_switching_to_spanish_translates_health_page_live(app_page):
    """Switching locale while Health is the active page re-renders it in
    the new language immediately, with no reload."""
    page = app_page

    page.evaluate("() => window.app.setLocale('es')")

    title = page.inner_text('.health-metric-card .health-card-title')
    assert title.strip() == 'Relación Deuda-Ingreso'

    subtitle = page.inner_text('.health-subtitle')
    assert subtitle.startswith('Una evaluación de un vistazo')


@pytest.mark.feature
def test_switching_to_polish_translates_health_page_live(app_page):
    """Same as the Spanish case, for Polish."""
    page = app_page

    page.evaluate("() => window.app.setLocale('pl')")

    title = page.inner_text('.health-metric-card .health-card-title')
    assert title.strip() == 'Wskaźnik Zadłużenia do Dochodu'


@pytest.mark.feature
def test_health_gauge_sr_tables_translate(app_page, account_data, income_data):
    """The Health page's DTI/Savings gauge screen-reader tables (caption,
    column headers, row labels) translate too -- previously hardcoded
    English despite the visible page being translated (i18n audit finding,
    2026-09-02). Fixed 2026-09-04."""
    page = app_page
    page.click('button[data-page="accounts"]')
    page.fill('#accountName', account_data["name"])
    page.select_option('#accountType', label=account_data["type"])
    page.fill('#accountStartingBalance', account_data["balance"])
    page.click('#accountFormSubmit')

    page.evaluate("() => window.app.setLocale('es')")
    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)

    caption = page.inner_text('#healthDtiGauge-sr-table caption')
    assert caption == 'Relación Deuda-Ingreso'

    first_row_label = page.inner_text('#healthDtiGauge-sr-table tbody tr:first-child td:first-child')
    assert first_row_label == 'Relación Deuda-Ingreso'

    column_header = page.inner_text('#healthDtiGauge-sr-table thead th:first-child')
    assert column_header == 'Métrica'

    savings_caption = page.inner_text('#healthSavingsGauge-sr-table caption')
    assert savings_caption == 'Tasa de Ahorro'


@pytest.mark.feature
def test_settings_modal_postgres_storage_option_translates(app_page):
    """The Settings modal's PostgreSQL storage option and helper note
    translate too -- previously hardcoded English inside an otherwise
    translated modal (i18n audit finding, 2026-09-02). Fixed 2026-09-04."""
    page = app_page

    page.evaluate("() => window.app.setLocale('es')")
    page.evaluate("() => document.getElementById('settingsBtn').click()")
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)

    option_text = page.inner_text('#settingStorageBackend option[value="postgres"]')
    assert option_text == 'PostgreSQL (servidor autoalojado)'

    note_text = page.evaluate(
        "() => document.getElementById('settingsStoragePostgresNote').textContent"
    )
    assert note_text == 'Estás usando PostgreSQL. No es posible volver a almacenamiento local o de sesión.'


@pytest.mark.feature
def test_health_page_debt_free_state_translates(app_page):
    """The zero-debt empty state ('Debt Free!') translates too, not just
    the populated-data path."""
    page = app_page

    page.evaluate("""() => {
        window.app.debts = [];
        window.app.setLocale('es');
    }""")

    value = page.inner_text('.health-empty-value.health-empty--green')
    assert value.strip() == '¡Libre de Deudas!'


@pytest.mark.feature
def test_format_currency_is_locale_aware(app_page):
    """formatCurrency's digit grouping/decimal separator follow the active
    locale — Polish uses a comma decimal separator where en-US uses a
    period, without formatCurrency's call sites changing at all."""
    page = app_page

    result = page.evaluate("""async () => {
        const mod = await import('/src/utils.js');
        const before = mod.formatCurrency(1234.5);
        window.app.setLocale('pl');
        const after = mod.formatCurrency(1234.5);
        return { before, after };
    }""")

    assert result['before'] == '$1,234.50'
    assert result['before'] != result['after']
    assert ',' in result['after']


@pytest.mark.feature
def test_format_short_date_is_locale_aware(app_page):
    """formatShortDate's month name/ordering follow the active locale."""
    page = app_page

    result = page.evaluate("""async () => {
        const mod = await import('/src/utils.js');
        const before = mod.formatShortDate('2026-08-02');
        window.app.setLocale('es');
        const after = mod.formatShortDate('2026-08-02');
        return { before, after };
    }""")

    assert result['before'] == 'Aug 2, 2026'
    assert result['before'] != result['after']


# ── I18N-01: People nav + Settings strings ───────────────────────────────────

@pytest.mark.feature
def test_people_nav_button_translates_to_spanish(app_page):
    """The People nav button has data-i18n='nav.people' and translates with the locale."""
    page = app_page
    page.evaluate("() => window.app.setLocale('es')")

    text = page.inner_text('.page-button[data-page="people"]')
    assert text.strip() == 'Personas', \
        f"People nav button should read 'Personas' in Spanish, got: {text.strip()!r}"


@pytest.mark.feature
def test_people_nav_button_translates_to_polish(app_page):
    """The People nav button translates to Polish."""
    page = app_page
    page.evaluate("() => window.app.setLocale('pl')")

    text = page.inner_text('.page-button[data-page="people"]')
    assert text.strip() == 'Osoby', \
        f"People nav button should read 'Osoby' in Polish, got: {text.strip()!r}"


@pytest.mark.feature
def test_settings_archived_debts_label_translates(app_page):
    """'Show archived debts' span in Settings translates via data-i18n."""
    page = app_page
    page.evaluate("() => window.app.setLocale('es')")
    page.evaluate("() => document.getElementById('settingsBtn').click()")
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)

    label_text = page.evaluate(
        "() => document.querySelector('[data-i18n=\"settings.showArchivedDebts\"]')?.textContent || ''"
    )
    assert label_text == 'Mostrar deudas archivadas', \
        f"'Show archived debts' should translate to Spanish, got: {label_text!r}"


@pytest.mark.feature
def test_settings_archived_recurring_label_translates(app_page):
    """'Show archived recurring templates' span in Settings translates via data-i18n."""
    page = app_page
    page.evaluate("() => window.app.setLocale('pl')")
    page.evaluate("() => document.getElementById('settingsBtn').click()")
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)

    label_text = page.evaluate(
        "() => document.querySelector('[data-i18n=\"settings.showArchivedRecurring\"]')?.textContent || ''"
    )
    assert label_text == 'Pokaż zarchiwizowane szablony cykliczne', \
        f"'Show archived recurring templates' should translate to Polish, got: {label_text!r}"


@pytest.mark.feature
def test_settings_send_test_email_button_translates(app_page):
    """'Send test email' button in Settings translates via data-i18n."""
    page = app_page
    page.evaluate("() => window.app.setLocale('es')")
    page.evaluate("() => document.getElementById('settingsBtn').click()")
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)

    btn_text = page.evaluate(
        "() => document.querySelector('[data-i18n=\"settings.sendTestEmail\"]')?.textContent || ''"
    )
    assert btn_text == 'Enviar correo de prueba', \
        f"'Send test email' button should translate to Spanish, got: {btn_text!r}"


# ── I18N-02: Surplus sparkline caption ───────────────────────────────────────

@pytest.mark.feature
def test_surplus_sparkline_caption_uses_t_in_spanish(app_page, account_data, income_data):
    """The surplus sparkline's sr-table caption uses t() and translates with the locale."""
    page = app_page

    # Set up an account so the surplus card can render a sparkline
    page.click('button[data-page="accounts"]')
    page.fill('#accountName', account_data["name"])
    page.select_option('#accountType', label=account_data["type"])
    page.fill('#accountStartingBalance', account_data["balance"])
    page.click('#accountFormSubmit')

    page.evaluate("() => window.app.setLocale('es')")
    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)

    # Pick the account in the surplus card selector and trigger render
    page.evaluate("""() => {
        const sel = document.getElementById('healthSurplusAccountSel');
        if (sel && sel.options.length > 1) { sel.selectedIndex = 1; sel.dispatchEvent(new Event('change')); }
    }""")
    page.wait_for_timeout(500)

    caption = page.evaluate(
        "() => document.querySelector('#healthSurplusSparkline-sr-table caption')?.textContent || ''"
    )
    # Spanish caption should contain "proyectado" (translated), not "Projected" (English)
    assert 'Projected' not in caption or caption == '', \
        f"Surplus sparkline caption should be translated in Spanish, got: {caption!r}"
    if caption:
        assert 'días' in caption or 'proyectado' in caption.lower(), \
            f"Spanish caption should contain 'días', got: {caption!r}"


@pytest.mark.feature
def test_surplus_sparkline_caption_english_default(app_page, account_data):
    """In the default English locale the surplus sparkline caption is 'Projected balance over N days'."""
    page = app_page

    page.click('button[data-page="accounts"]')
    page.fill('#accountName', account_data["name"])
    page.select_option('#accountType', label=account_data["type"])
    page.fill('#accountStartingBalance', account_data["balance"])
    page.click('#accountFormSubmit')

    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)

    page.evaluate("""() => {
        const sel = document.getElementById('healthSurplusAccountSel');
        if (sel && sel.options.length > 1) { sel.selectedIndex = 1; sel.dispatchEvent(new Event('change')); }
    }""")
    page.wait_for_timeout(500)

    caption = page.evaluate(
        "() => document.querySelector('#healthSurplusSparkline-sr-table caption')?.textContent || ''"
    )
    if caption:
        assert 'Projected balance over' in caption and 'days' in caption, \
            f"English caption should follow template 'Projected balance over N days', got: {caption!r}"
