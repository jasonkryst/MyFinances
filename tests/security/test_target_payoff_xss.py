#!/usr/bin/env python3
"""
Target-payoff-date result panel never renders raw <input> text (issue #380,
CodeQL alert #172 js/xss-through-dom in src/strategyPlanCalculation.js).

When the final summary can't be generated, the panel used to fall back to the
raw `#targetPayoffDate` value inside innerHTML. It now formats the *parsed*
target date and escapes it.
"""

import re
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parents[2] / 'src' / 'strategyPlanCalculation.js'

SEED = """() => {
    const app = window.app;
    app.debts = [{ id: 1, name: 'XSS Card', debtType: 'creditCard', accountBalance: 2000,
                   originalBalance: 2000, interestRate: 15, minimumPayment: 50,
                   originalMinimumPayment: 50, dueDate: 15, archived: false, personIds: [] }];
    app.switchPage('strategy');
    document.getElementById('monthlyPayment').value = '200';
}"""


def _run(page, date_value, input_type='date', null_summary=False):
    page.wait_for_function("() => window.app && window.app.switchPage")
    page.evaluate(SEED)
    return page.evaluate("""([dateValue, inputType, nullSummary]) => {
        const input = document.getElementById('targetPayoffDate');
        input.type = inputType;
        input.value = dateValue;
        const original = DebtCalculator.generateSummary;
        if (nullSummary) DebtCalculator.generateSummary = () => null;
        try {
            window.app.calculateRequiredPayment();
        } finally {
            DebtCalculator.generateSummary = original;
        }
        const el = document.getElementById('targetPayoffResult');
        return { html: el.innerHTML, text: el.textContent,
                 injected: el.querySelectorAll('img, script, iframe, [onerror]').length,
                 fired: window.__xssFired === true };
    }""", [date_value, input_type, null_summary])


@pytest.mark.security
def test_fallback_shows_formatted_target_date_not_raw_input(app_page):
    """Positive: with no summary, the panel shows the parsed target date
    formatted like the normal path ("January 1, 2030"), not the raw ISO text."""
    r = _run(app_page, '2030-01-01', null_summary=True)
    assert 'January 1, 2030' in r['text'], r['text']
    assert '2030-01-01' not in r['text']


@pytest.mark.security
def test_normal_path_still_shows_payoff_date(app_page):
    r = _run(app_page, '2030-01-01')
    assert 'Payoff by' in r['text']
    assert re.search(r'[A-Z][a-z]+ \d{1,2}, \d{4}', r['text']), r['text']


@pytest.mark.security
@pytest.mark.parametrize('payload', [
    '<img src=x onerror="window.__xssFired=true">',
    '2030-01-01<img src=x onerror="window.__xssFired=true">',
    '"><script>window.__xssFired=true</script>',
])
def test_html_in_target_date_is_never_rendered(app_page, payload):
    """Negative: even if the date input is tampered into a text field holding
    HTML, nothing from it is injected into the result panel."""
    r = _run(app_page, payload, input_type='text', null_summary=True)
    assert r['injected'] == 0, r['html']
    assert not r['fired']
    assert 'onerror' not in r['html']


@pytest.mark.security
def test_source_has_no_raw_date_fallback():
    """Static guard: the fallback must not interpolate the raw input value again."""
    src = SRC.read_text(encoding='utf-8')
    line = next(l for l in src.splitlines() if 'const payoffDateStr = escapeHtml(' in l)
    assert 'dateVal' not in line
