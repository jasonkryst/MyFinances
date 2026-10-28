#!/usr/bin/env python3
"""
Focused regressions for issue #426 (UX A): comparison header contrast, Retirement
snapshot Delete target, Reports month-nav/Print, Savings sub-tabs, Settings tabs,
Net Worth stat cards. The broad sweep lives in test_mobile_no_card_clipping.py.
"""

import pytest
from tests.ui.test_mobile_no_card_clipping import SEED, PHONE

DESKTOP = {"width": 1440, "height": 900}

CONTRAST_JS = """() => {
    const th = document.querySelector('.comparison-table th');
    const parse = (c) => c.match(/[\\d.]+/g).map(Number);
    const lum = ([r, g, b]) => {
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const cs = getComputedStyle(th);
    // effective background: walk up until a non-transparent colour
    let el = th, bg = null;
    while (el) {
        const c = parse(getComputedStyle(el).backgroundColor);
        if (c.length < 4 || c[3] > 0.9) { bg = c; break; }
        el = el.parentElement;
    }
    const a = lum(parse(cs.color)), b = lum(bg || [255, 255, 255]);
    return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), color: cs.color };
}"""


@pytest.fixture
def seeded(app_page):
    page = app_page
    page.evaluate(SEED)
    page.reload()
    return page


def _calculate(page):
    page.evaluate("() => window.app.switchPage('strategy')")
    page.fill("#monthlyPayment", "2200")
    page.click("#calculateBtn")
    page.wait_for_selector(".comparison-table th", state="attached", timeout=15000)


@pytest.mark.ui
@pytest.mark.parametrize("dark", [False, True], ids=["light", "dark"])
def test_comparison_header_text_is_readable(seeded, dark):
    page = seeded
    if dark:
        page.evaluate("() => { document.body.classList.add('dark-mode'); document.documentElement.setAttribute('data-theme','dark'); }")
    _calculate(page)
    res = page.evaluate(CONTRAST_JS)
    assert res["ratio"] >= 4.5, f"comparison th contrast {res['ratio']:.2f} (color {res['color']})"


@pytest.mark.ui
def test_comparison_table_scrolls_on_phone(seeded):
    page = seeded
    page.set_viewport_size(PHONE)
    _calculate(page)
    res = page.evaluate("""() => {
        const w = document.querySelector('.comparison-table').closest('.table-wrapper');
        return { ox: getComputedStyle(w).overflowX, right: w.getBoundingClientRect().right, iw: innerWidth };
    }""")
    assert res["ox"] in ("auto", "scroll") and res["right"] <= res["iw"] + 1


@pytest.mark.ui
def test_retirement_delete_button_is_full_size_and_named(seeded):
    page = seeded
    page.set_viewport_size(PHONE)
    page.evaluate("() => window.app.switchPage('retirement')")
    page.wait_for_selector("[data-retire-action='delete-snapshot']", timeout=10000)
    res = page.evaluate("""() => [...document.querySelectorAll("[data-retire-action='delete-snapshot']")].map(b => {
        const r = b.getBoundingClientRect();
        return { w: r.width, h: r.height, label: b.getAttribute('aria-label'), text: b.textContent.trim(),
                 clipped: b.scrollWidth > b.clientWidth + 1 };
    })""")
    assert len(res) == 4
    for b in res:
        assert b["h"] >= 40 and b["w"] >= 40, b
        assert b["text"] == "Delete" and not b["clipped"], b
        assert "2026-" in b["label"], b  # accessible name carries the snapshot date
    assert len({b["label"] for b in res}) == 4  # each name is unique (negative: not a generic label)


@pytest.mark.ui
@pytest.mark.parametrize("viewport", [PHONE, DESKTOP], ids=["phone", "desktop"])
def test_reports_month_nav_and_print_stay_inside_nav(seeded, viewport):
    page = seeded
    page.set_viewport_size(viewport)
    page.evaluate("() => window.app.switchPage('reports')")
    page.wait_for_selector("#rptPrintBtn", state="visible", timeout=10000)
    res = page.evaluate("""() => {
        const nav = document.querySelector('.rpt-month-nav').getBoundingClientRect();
        const t = document.getElementById('rptPrintBtn');
        const p = t.getBoundingClientRect();
        return { navL: nav.left, navR: nav.right, pL: p.left, pR: p.right, iw: innerWidth,
                 clipped: t.scrollWidth > t.clientWidth + 1 };
    }""")
    assert res["pR"] <= res["navR"] + 1 and res["pL"] >= res["navL"] - 1, res
    assert res["navR"] <= res["iw"] + 1 and res["navL"] >= -1, res
    assert not res["clipped"], res


@pytest.mark.ui
def test_savings_subtabs_fit_row_on_phone(seeded):
    page = seeded
    page.set_viewport_size(PHONE)
    page.evaluate("() => window.app.switchPage('savings')")
    page.wait_for_selector(".savings-subtab-btn", timeout=10000)
    res = page.evaluate("""() => {
        const row = document.querySelector('.savings-subtabs').getBoundingClientRect();
        return [...document.querySelectorAll('.savings-subtab-btn')].map(b => {
            const r = b.getBoundingClientRect();
            return { l: r.left, r: r.right, w: r.width, clipped: b.scrollWidth > b.clientWidth + 1, rowR: row.right };
        });
    }""")
    assert len(res) == 3
    for b in res:
        assert b["r"] <= b["rowR"] + 1 and not b["clipped"], b
    assert max(b["w"] for b in res) - min(b["w"] for b in res) < 2  # equal widths


@pytest.mark.ui
def test_settings_tabs_equal_2x2_on_phone(seeded):
    page = seeded
    page.set_viewport_size(PHONE)
    page.evaluate("() => document.getElementById('accountMenuBtn').click()")
    page.evaluate("() => document.getElementById('accountMenuSettingsBtn').click()")
    page.wait_for_selector("[data-settings-tab='advanced']", state="visible", timeout=5000)
    res = page.evaluate("""() => [...document.querySelectorAll('.settings-tab-btn')].map(b => {
        const r = b.getBoundingClientRect(); return { top: Math.round(r.top), w: Math.round(r.width), h: r.height };
    })""")
    assert len(res) == 4
    assert len({b["top"] for b in res}) == 2, res          # exactly two rows
    assert len({b["w"] for b in res}) == 1, res            # all equal width
    assert all(b["h"] >= 40 for b in res), res


@pytest.mark.ui
@pytest.mark.parametrize("viewport,per_row", [(PHONE, 2), (DESKTOP, 4)], ids=["phone", "desktop"])
def test_networth_stat_cards_per_row(seeded, viewport, per_row):
    page = seeded
    page.set_viewport_size(viewport)
    page.evaluate("() => window.app.switchPage('reports')")
    page.wait_for_selector("[data-rptab='networth']", timeout=10000)
    page.evaluate("() => document.querySelector(\"[data-rptab='networth']\").click()")
    page.wait_for_selector(".nw-report-stat", state="visible", timeout=10000)
    tops = page.evaluate("() => [...document.querySelectorAll('.nw-report-stat')].filter(e => e.offsetParent).map(e => Math.round(e.getBoundingClientRect().top))")
    first_row = [t for t in tops if t == tops[0]]
    assert len(tops) >= 4
    assert len(first_row) == per_row, tops
