#!/usr/bin/env python3
"""
i18n leftovers from the November 2026 audit:
- #498 the account menu and its trigger are translated (the render guard's
  'header-account-menu' page covers the rest of the toolbar);
- #517 document.title follows the locale, the Health surplus sparkline's
  screen-reader table headers and canvas label are translated, and the es/pl
  Help tooltip says the guide is English-only;
- #514 es uses one name for sinking funds and 'copia de seguridad' for backups.
"""

import re
from pathlib import Path

import pytest

from tests.conftest import seed_state

ROOT = Path(__file__).resolve().parents[2]
ES = (ROOT / 'src' / 'locales' / 'es.js').read_text(encoding='utf-8')

MENU_JS = """() => ({
    btnAria: document.getElementById('accountMenuBtn').getAttribute('aria-label'),
    btnTitle: document.getElementById('accountMenuBtn').getAttribute('title'),
    items: [...document.querySelectorAll('#accountMenuDropdown .account-menu-item')]
        .map(b => b.textContent.trim().replace(/\\s+/g, ' ')),
    email: document.getElementById('accountMenuEmail').getAttribute('translate'),
})"""


def _es_value(key):
    m = re.search(r"""['"]%s['"]\s*:\s*(['"])(.*?)\1,""" % re.escape(key), ES)
    assert m, f'{key} missing from es.js'
    return m.group(2)


# ── #498: account menu ─────────────────────────────────────────────────────

@pytest.mark.feature
@pytest.mark.parametrize('locale,aria,title,items', [
    ('es', 'Menú de la cuenta', 'Cuenta',
     ['Novedades', 'Suscripción de calendario', 'Copia de seguridad y restauración',
      'Configuración', 'Atajos de teclado', 'Cerrar sesión']),
    ('pl', 'Menu konta', 'Konto',
     ['Co nowego', 'Subskrypcja kalendarza', 'Kopia zapasowa i przywracanie',
      'Ustawienia', 'Skróty klawiszowe', 'Wyloguj']),
])
def test_account_menu_is_translated(app_page, locale, aria, title, items):
    page = app_page
    page.evaluate(f"() => window.app.setLocale('{locale}')")
    page.wait_for_function(
        "(a) => document.getElementById('accountMenuBtn').getAttribute('aria-label') === a", arg=aria)
    got = page.evaluate(MENU_JS)
    assert got['btnAria'] == aria
    assert got['btnTitle'] == title
    assert got['items'] == items
    # The signed-in email is data, never translated.
    assert got['email'] == 'no'


@pytest.mark.feature
def test_account_menu_switches_back_to_english(app_page):
    """Negative: after es, switching back leaves no Spanish behind."""
    page = app_page
    page.evaluate("() => window.app.setLocale('es')")
    page.wait_for_function("() => document.getElementById('accountMenuBtn').getAttribute('aria-label') === 'Menú de la cuenta'")
    page.evaluate("() => window.app.setLocale('en')")
    got = page.evaluate(MENU_JS)
    assert got['btnAria'] == 'Account menu'
    assert got['items'] == ["What's New", 'Calendar Feed', 'Backup & Restore',
                            'Settings', 'Keyboard Shortcuts', 'Sign Out']


@pytest.mark.feature
def test_account_menu_items_still_open_their_targets_in_spanish(app_page):
    """Wrapping the labels in spans must not break the click targets."""
    page = app_page
    page.evaluate("() => window.app.setLocale('es')")
    page.click('#accountMenuBtn')
    page.click('#accountMenuSettingsBtn span')
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)


# ── #517: document title, sparkline table, Help tooltip ────────────────────

@pytest.mark.feature
def test_document_title_follows_locale(app_page):
    page = app_page
    assert page.title() == 'MyFinances - Track Your Money'
    page.evaluate("() => window.app.setLocale('es')")
    page.wait_for_function("() => document.title === 'MyFinances - Controla tu dinero'")
    page.evaluate("() => window.app.setLocale('pl')")
    page.wait_for_function("() => document.title === 'MyFinances - Kontroluj swoje pieniądze'")
    page.evaluate("() => window.app.setLocale('en')")
    assert page.title() == 'MyFinances - Track Your Money'


@pytest.mark.feature
def test_subtree_translation_pass_leaves_title_alone(app_page):
    """Negative: applyStaticTranslations(root) on a subtree (as modals do)
    must not touch document.title; only the whole-document pass does."""
    page = app_page
    title = page.evaluate("""async () => {
        const i18n = await import('/src/i18n.js');
        document.title = 'sentinel';
        i18n.applyStaticTranslations(document.getElementById('accountMenuWrap'));
        const afterSubtree = document.title;
        i18n.applyStaticTranslations();
        return [afterSubtree, document.title];
    }""")
    assert title == ['sentinel', 'MyFinances - Track Your Money']


SPARK_STATE = {
    'accounts': [{'id': 1, 'name': 'Checking', 'type': 'Checking', 'startingBalance': 5000}],
    'incomes': [{'id': 1, 'name': 'Pay', 'amount': 2000, 'frequency': 'biweekly',
                 'firstPayDate': '2026-01-02', 'accountId': 1}],
}


def _render_sparkline(page, locale=None):
    """Seeds an account with paydays so the surplus card has 2+ projected
    points, selects it and returns the SR-table headers and canvas label."""
    seed_state(page, SPARK_STATE)
    if locale:
        page.evaluate(f"() => window.app.setLocale('{locale}')")
    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)
    page.evaluate("""() => {
        const sel = document.getElementById('healthSurplusAcct');
        sel.value = [...sel.options].find(o => o.value)?.value;
        sel.dispatchEvent(new Event('change'));
    }""")
    page.wait_for_selector('#healthSurplusSparkline-sr-table th', state='attached', timeout=5000)
    return page.evaluate("""() => ({
        cols: [...document.querySelectorAll('#healthSurplusSparkline-sr-table th')].map(th => th.textContent),
        canvas: document.getElementById('healthSurplusSparkline').getAttribute('aria-label'),
        caption: document.querySelector('#healthSurplusSparkline-sr-table caption').textContent,
    })""")


@pytest.mark.feature
def test_sparkline_table_headers_translated_in_spanish(app_page):
    got = _render_sparkline(app_page, 'es')
    assert got['cols'] == ['Fecha', 'Saldo']
    assert got['canvas'].startswith('Saldo proyectado durante'), got['canvas']
    assert got['caption'] == got['canvas']


@pytest.mark.feature
def test_sparkline_table_headers_english_default(app_page):
    got = _render_sparkline(app_page)
    assert got['cols'] == ['Date', 'Balance']
    assert got['canvas'].startswith('Projected balance over'), got['canvas']
    assert got['caption'] == got['canvas']


@pytest.mark.feature
@pytest.mark.parametrize('locale,needle', [('es', 'inglés'), ('pl', 'angielsku')])
def test_help_tooltip_says_guide_is_english_only(app_page, locale, needle):
    page = app_page
    page.evaluate(f"() => window.app.setLocale('{locale}')")
    page.wait_for_function(
        "(n) => (document.getElementById('helpBtn').getAttribute('title') || '').includes(n)", arg=needle)
    assert needle in page.get_attribute('#helpBtn', 'aria-label')


@pytest.mark.feature
def test_help_tooltip_in_english_has_no_language_note(app_page):
    """Negative: the guide is in English, so English needs no note."""
    assert app_page.get_attribute('#helpBtn', 'title') == 'Open usage guide'
    assert app_page.get_attribute('#helpBtn', 'aria-label') == 'Help'


# ── #514: es terminology (static, no stack needed) ─────────────────────────

def test_es_sinking_fund_wording_matches_savings_tab():
    tab = _es_value('savings.tabSinking')
    assert tab == 'Fondos de previsión'
    assert _es_value('import.skippedType.sinkingFunds') == tab
    assert _es_value('pgMigration.sinkingFund.one') == '{count} fondo de previsión'
    assert _es_value('pgMigration.sinkingFund.other') == '{count} fondos de previsión'


def test_es_has_no_second_name_for_sinking_funds():
    """Negative: the old 'ahorro programado' wording is gone everywhere."""
    assert 'ahorro programado' not in ES


def test_es_download_label_says_backup():
    assert 'copia de seguridad' in _es_value('pgMigration.download')
    assert 'copia JSON' not in ES


# ── #720: the Calendar Feed dialog ─────────────────────────────────────────

CAL_JS = """() => ({
    title: document.getElementById('calendarFeedModalTitle').textContent,
    desc: document.getElementById('calendarFeedModalDesc').textContent,
    close: document.getElementById('calendarFeedModalCloseBtn').getAttribute('aria-label'),
    download: document.getElementById('calendarDownloadBtn').textContent,
    generate: document.getElementById('calendarGenerateTokenBtn').textContent,
    live: document.querySelector('#calendarSubscriptionSection h4').textContent,
    copy: document.getElementById('calendarCopyUrlBtn').textContent,
    regenerate: document.getElementById('calendarRegenerateTokenBtn').textContent,
    warning: document.querySelector('.cal-token-warning').textContent,
})"""


def _open_calendar(page):
    page.evaluate("() => document.getElementById('calendarFeedBtn').click()")
    page.wait_for_selector('#calendarFeedModal:not(.hidden)', timeout=5000)


@pytest.mark.feature
@pytest.mark.parametrize('locale,title,download,generate,close,desc_start', [
    ('es', 'Suscripción de calendario', 'Descargar archivo .ics', 'Generar enlace de suscripción',
     'Cerrar', 'Exporta tus facturas'),
    ('pl', 'Subskrypcja kalendarza', 'Pobierz plik .ics', 'Wygeneruj link subskrypcji',
     'Zamknij', 'Eksportuj rachunki'),
])
def test_calendar_feed_modal_is_translated(app_page, locale, title, download, generate, close, desc_start):
    page = app_page
    page.evaluate(f"() => window.app.setLocale('{locale}')")
    page.wait_for_function(
        "(a) => document.getElementById('calendarDownloadBtn').textContent === a", arg=download)
    _open_calendar(page)
    got = page.evaluate(CAL_JS)
    assert got['title'] == title
    assert got['desc'].startswith(desc_start)
    assert got['download'] == download
    assert got['close'] == close
    assert got['generate'] == generate
    # No English leftovers anywhere in the dialog.
    for key, english in (('desc', 'Export your bills'), ('live', 'Live Subscription'),
                         ('warning', 'Treat this URL'), ('copy', 'Copy'), ('regenerate', 'Regenerate')):
        assert english not in got[key] and got[key].strip(), (key, got[key])


@pytest.mark.feature
def test_calendar_feed_modal_stays_english_in_en(app_page):
    """Negative: the default locale keeps the English copy, and the Generate
    button's runtime label follows the locale after a switch."""
    page = app_page
    _open_calendar(page)
    got = page.evaluate(CAL_JS)
    assert got['title'] == 'Calendar Feed'
    assert got['download'] == 'Download .ics file'
    assert got['close'] == 'Close'
    page.evaluate("() => window.app.setLocale('es')")
    assert page.evaluate(CAL_JS)['title'] == 'Suscripción de calendario'
    page.evaluate("() => window.app.setLocale('en')")
    assert page.evaluate(CAL_JS)['title'] == 'Calendar Feed'
