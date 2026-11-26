"""Phone polish from the phone-width audit (#732): #738 chart cards, #739 dialog close buttons,
#740 Health targets, #741 checkboxes, #742 header title vs toolbar, #743 safe areas.

Every check measures real boxes in the browser at phone widths. The numbers in the issues come
from the same measurements, so each test fails against the pre-fix build.
"""

import pytest
from playwright.sync_api import expect

from tests.conftest import BASE_URL, seed_state, wait_for_app_ready
from tests.ui.test_back_overlays import OVERLAY_SEED, OVERLAYS

BASE = BASE_URL if BASE_URL.endswith("/") else BASE_URL + "/"
PHONE_390 = {"width": 390, "height": 844}
PHONE_360 = {"width": 360, "height": 740}
PHONE_412 = {"width": 412, "height": 915}
TOUCH = 44


def _open(page, path, viewport=PHONE_390):
    """Seed the rich state once, then open `path` at a phone viewport and let it settle."""
    page.set_viewport_size(viewport)
    seed_state(page, OVERLAY_SEED)
    wait_for_app_ready(page)
    page.goto(BASE + path)
    wait_for_app_ready(page)
    page.wait_for_selector(".page-section.active", timeout=15000)
    page.wait_for_load_state("networkidle")


# ── #738: chart cards stay inside their panel ────────────────────────────────

@pytest.mark.ui
@pytest.mark.parametrize("viewport", [PHONE_390, PHONE_360], ids=["390", "360"])
@pytest.mark.parametrize("path", ["reports/networth", "reports/incomeexp", "retirement"])
def test_chart_cards_fit_their_panel(app_page, viewport, path):
    _open(app_page, path, viewport)
    app_page.wait_for_selector(".page-section.active .rpt-chart-card", state="visible", timeout=15000)
    result = app_page.evaluate("""() => [...document.querySelectorAll('.page-section.active .rpt-chart-card')]
        .filter(c => c.getClientRects().length)
        .map(c => {
            const r = c.getBoundingClientRect(), p = c.parentElement.getBoundingClientRect();
            const cv = c.querySelector('canvas');
            const cr = cv ? cv.getBoundingClientRect() : null;
            return {over: Math.round((r.right - p.right) * 10) / 10, under: Math.round((p.left - r.left) * 10) / 10,
                    canvasOver: cr ? Math.round((cr.right - r.right) * 10) / 10 : 0};
        })""")
    assert result, "no chart cards on the page"
    for card in result:
        assert card["over"] <= 0.5 and card["under"] <= 0.5, f"card sticks out of its panel: {card}"
        assert card["canvasOver"] <= 0.5, f"chart canvas wider than its card: {card}"


# ── #739: dialog close buttons ───────────────────────────────────────────────

CLOSE_SELECTOR = ".modal-close, .amortization-close-btn, .accelerate-modal-close"
DIALOGS_WITH_CLOSE = [
    "whatsNewModal", "keyboardShortcutsModal", "amortizationModal", "accelerateDebtModal",
    "balanceHistoryModal", "calendarDayModal", "ledgerOverrideModal", "manualTxModal", "transferModal",
    "reconcileModal", "retirementSnapshotModal", "updateBalanceModal", "calendarFeedModal",
    "ledgerExportModal",
]
_OPENERS = dict(OVERLAYS)


@pytest.mark.ui
@pytest.mark.parametrize("overlay", DIALOGS_WITH_CLOSE)
def test_dialog_close_buttons_are_touch_sized(app_page, overlay):
    page = app_page
    page.set_viewport_size(PHONE_390)
    seed_state(page, OVERLAY_SEED)
    wait_for_app_ready(page)
    # The desktop nav is hidden at phone width, so navigate by address rather than by nav button.
    if overlay == "ledgerExportModal":
        page.goto(BASE + "ledger")
        wait_for_app_ready(page)
    if overlay == "amortizationModal":
        page.goto(BASE + "plan")
        wait_for_app_ready(page)
    if overlay == "calendarFeedModal":
        page.click("#accountMenuBtn")
        page.wait_for_selector("#accountMenuDropdown:not(.hidden)", timeout=3000)
    page.evaluate("() => { const app = window.app; (async () => { " + _OPENERS[overlay] + "; })(); }")
    expect(page.locator(f"#{overlay}")).to_be_visible(timeout=5000)
    # Focus moving into the dialog means it has finished opening, so the boxes below are settled.
    page.wait_for_function(
        "(id) => document.getElementById(id).contains(document.activeElement)", arg=overlay, timeout=5000)
    box = page.evaluate("""(args) => {
        const m = document.getElementById(args.id);
        const b = m.querySelector(args.sel);
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return {w: Math.round(r.width), h: Math.round(r.height), right: Math.round(innerWidth - r.right),
                top: Math.round(r.top), inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0};
    }""", {"id": overlay, "sel": CLOSE_SELECTOR})
    assert box is not None, f"{overlay} has no close control matching {CLOSE_SELECTOR}"
    assert box["w"] >= TOUCH and box["h"] >= TOUCH, f"{overlay} close button is {box['w']}x{box['h']}"
    assert box["inView"], f"{overlay} close button leaves the viewport: {box}"


# ── #740: Health links and the budget gear ───────────────────────────────────

@pytest.mark.ui
def test_health_links_and_gear_are_touch_sized(app_page):
    _open(app_page, "", PHONE_390)
    app_page.wait_for_selector("#healthSection.active .health-link", state="attached", timeout=15000)
    small = app_page.evaluate("""() => {
        const out = [];
        for (const el of document.querySelectorAll('#healthSection a[href], #healthSection .health-link, #healthBudgetThresholdsBtn')) {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            const gear = el.id === 'healthBudgetThresholdsBtn';
            if (r.height < 44 || (gear && r.width < 44)) {
                out.push((el.id || el.className || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)
                         + ' ' + (el.textContent || '').trim().slice(0, 24));
            }
        }
        return [...new Set(out)];
    }""")
    assert not small, f"Health controls under 44px: {small}"


@pytest.mark.ui
def test_health_links_stay_left_aligned(app_page):
    """Growing the links to 44px tall must not centre them (they are flex children of the card)."""
    _open(app_page, "", PHONE_390)
    app_page.wait_for_selector("#healthSection.active .health-link", state="attached", timeout=15000)
    offsets = app_page.evaluate("""() => [...document.querySelectorAll('#healthSection .health-link')]
        .filter(a => a.getClientRects().length && a.closest('.health-metric-card'))
        .map(a => {
            const r = document.createRange(); r.selectNodeContents(a);
            const card = a.closest('.health-metric-card').getBoundingClientRect();
            return Math.round(r.getBoundingClientRect().left - card.left);
        })""")
    assert offsets, "no Health links found in metric cards"
    # Left aligned means the text starts at the card's left padding (about 20px), not mid-card.
    assert max(offsets) <= 40, f"Health links are no longer left-aligned: {offsets}"


# ── #741: checkboxes ─────────────────────────────────────────────────────────

CHECKBOXES = [
    ("income", "#incomeTrendYoYToggle", False),
    ("liabilities/debts", ".debt-row-select", True),
    ("retirement", ".retire-limit-toggle input[type='checkbox']", False),
]


@pytest.mark.ui
@pytest.mark.parametrize("path,selector,square", CHECKBOXES, ids=["income-yoy", "debt-select", "retire-catchup"])
def test_checkboxes_have_touch_sized_targets(app_page, path, selector, square):
    _open(app_page, path, PHONE_390)
    app_page.wait_for_selector(selector, state="visible", timeout=15000)
    m = app_page.evaluate("""(sel) => {
        const el = document.querySelector(sel);
        const lab = el.closest('label') || el;
        const r = el.getBoundingClientRect(), l = lab.getBoundingClientRect();
        return {iw: r.width, ih: r.height, lw: l.width, lh: l.height};
    }""", selector)
    assert m["iw"] >= 22 and m["ih"] >= 22, f"checkbox itself is {m['iw']}x{m['ih']}"
    assert m["lh"] >= TOUCH, f"tap area is {m['lw']}x{m['lh']} tall"
    if square:
        assert m["lw"] >= TOUCH, f"tap area is {m['lw']}x{m['lh']}"


# ── #742: header title never runs under the toolbar ──────────────────────────

@pytest.mark.ui
@pytest.mark.parametrize("viewport", [PHONE_412, PHONE_390, PHONE_360], ids=["412", "390", "360"])
def test_header_title_clear_of_toolbar(app_page, viewport):
    page = app_page
    page.set_viewport_size(viewport)
    wait_for_app_ready(page)
    m = page.evaluate("""() => {
        const h1 = document.querySelector('header h1'), top = document.querySelector('.header-top');
        const a = h1.getBoundingClientRect(), b = top.getBoundingClientRect();
        // The painted text: the h1 box is wide, so measure the text range as well.
        const range = document.createRange(); range.selectNodeContents(h1);
        const t = range.getBoundingClientRect();
        return {h1Right: a.right, textRight: Math.min(t.right, a.right), toolbarLeft: b.left,
                clipped: h1.scrollWidth > h1.clientWidth + 1, toolbarRight: b.right, vw: innerWidth};
    }""")
    assert m["h1Right"] <= m["toolbarLeft"] + 0.5, f"title box runs under the toolbar: {m}"
    assert m["textRight"] <= m["toolbarLeft"] + 0.5, f"title text runs under the toolbar: {m}"
    assert m["toolbarRight"] <= m["vw"] + 0.5, f"toolbar leaves the screen: {m}"


PHONE_460 = {"width": 460, "height": 900}


@pytest.mark.ui
@pytest.mark.parametrize("saving", [False, True], ids=["idle", "saving"])
@pytest.mark.parametrize("viewport", [PHONE_460, PHONE_412, PHONE_390], ids=["460", "412", "390"])
def test_header_title_is_not_truncated_on_common_phones(app_page, viewport, saving):
    """The wordmark is the app's name; it should read in full at ordinary phone widths, also while
    the Saving dot is showing in the toolbar (it appears during every save)."""
    page = app_page
    page.set_viewport_size(viewport)
    wait_for_app_ready(page)
    if saving:
        page.evaluate("() => document.getElementById('saveStatusChip').classList.remove('hidden')")
    clipped = page.evaluate("() => { const h = document.querySelector('header h1'); return h.scrollWidth > h.clientWidth + 1; }")
    assert not clipped, "the MyFinances title is cut off"


@pytest.mark.ui
def test_page_sections_inside_the_header_still_span_the_row(app_page):
    """The Ledger section lives inside <header>; the two-column header grid must not squeeze it."""
    _open(app_page, "ledger", PHONE_390)
    m = app_page.evaluate("""() => {
        const h = document.querySelector('header').getBoundingClientRect();
        const s = document.getElementById('ledgerSection').getBoundingClientRect();
        return {header: Math.round(h.width), section: Math.round(s.width), left: Math.round(s.left - h.left)};
    }""")
    assert m["section"] >= m["header"] - 2 and abs(m["left"]) <= 1, f"Ledger section is squeezed: {m}"


# ── #743: safe areas ─────────────────────────────────────────────────────────

def _insets(page, top=0, bottom=0, left=0, right=0):
    cdp = page.context.new_cdp_session(page)
    cdp.send("Emulation.setSafeAreaInsetsOverride",
             {"insets": {"top": top, "bottom": bottom, "left": left, "right": right}})
    return cdp


@pytest.mark.ui
def test_viewport_extends_under_system_bars(app_page):
    content = app_page.evaluate("() => document.querySelector('meta[name=viewport]').content")
    assert "viewport-fit=cover" in content, content


@pytest.mark.ui
def test_tab_bar_reaches_the_bottom_edge_and_clears_the_gesture_area(app_page):
    page = app_page
    page.set_viewport_size(PHONE_390)
    wait_for_app_ready(page)
    _insets(page, bottom=34)
    page.wait_for_function(
        "() => parseFloat(getComputedStyle(document.getElementById('phoneTabBar')).paddingBottom) >= 34", timeout=5000)
    m = page.evaluate("""() => {
        const bar = document.getElementById('phoneTabBar').getBoundingClientRect();
        const tabs = [...document.querySelectorAll('#phoneTabBar .phone-tab')].map(b => b.getBoundingClientRect());
        return {barBottom: bar.bottom, vh: innerHeight, lowestTab: Math.max(...tabs.map(t => t.bottom))};
    }""")
    assert abs(m["barBottom"] - m["vh"]) <= 0.5, f"the bar stops short of the bottom edge: {m}"
    assert m["lowestTab"] <= m["vh"] - 34 + 0.5, f"tab buttons reach into the gesture area: {m}"


@pytest.mark.ui
def test_header_clears_the_status_bar(app_page):
    page = app_page
    page.set_viewport_size(PHONE_390)
    wait_for_app_ready(page)
    _insets(page, top=47)
    page.wait_for_function(
        "() => parseFloat(getComputedStyle(document.querySelector('header')).paddingTop) >= 47", timeout=5000)
    m = page.evaluate("""() => {
        const hero = document.querySelector('.header-hero').getBoundingClientRect();
        const top = document.querySelector('.header-top').getBoundingClientRect();
        return {hero: hero.top, toolbar: top.top, headerTop: document.querySelector('header').getBoundingClientRect().top};
    }""")
    assert m["hero"] >= m["headerTop"] + 47 - 0.5, f"the title sits under the status bar: {m}"
    assert m["toolbar"] >= m["headerTop"] + 47 - 0.5, f"the toolbar sits under the status bar: {m}"


@pytest.mark.ui
def test_settings_panel_and_close_clear_the_system_bars(app_page):
    page = app_page
    page.set_viewport_size(PHONE_390)
    wait_for_app_ready(page)
    page.click("#accountMenuBtn")
    page.click("#accountMenuSettingsBtn")
    page.wait_for_selector("#settingsModal.flex-visible", timeout=5000)
    _insets(page, top=47, bottom=34)
    page.wait_for_function(
        "() => parseFloat(getComputedStyle(document.querySelector('#settingsModal .settings-modal-content')).paddingTop) >= 47",
        timeout=5000)
    m = page.evaluate("""() => {
        const c = getComputedStyle(document.querySelector('#settingsModal .settings-modal-content'));
        const close = document.querySelector('#settingsModal .modal-close').getBoundingClientRect();
        return {top: parseFloat(c.paddingTop), bottom: parseFloat(c.paddingBottom), closeTop: close.top};
    }""")
    assert m["top"] >= 47 and m["bottom"] >= 34, m
    assert m["closeTop"] >= 47, f"the Settings close button sits under the status bar: {m}"


@pytest.mark.ui
def test_footer_has_room_above_the_tab_bar(app_page):
    _open(app_page, "", PHONE_390)
    app_page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
    gap = app_page.evaluate("""() => {
        const f = document.querySelector('.app-footer').getBoundingClientRect();
        const bar = document.getElementById('phoneTabBar').getBoundingClientRect();
        return bar.top - f.bottom;
    }""")
    assert gap >= 8, f"the footer sits {gap}px above the tab bar"


@pytest.mark.ui
def test_landscape_notch_gets_side_padding(app_page):
    page = app_page
    page.set_viewport_size({"width": 844, "height": 390})
    wait_for_app_ready(page)
    _insets(page, left=47, right=47)
    page.wait_for_function(
        "() => parseFloat(getComputedStyle(document.body).paddingLeft) >= 47", timeout=5000)
    left, right = page.evaluate(
        "() => [parseFloat(getComputedStyle(document.body).paddingLeft), parseFloat(getComputedStyle(document.body).paddingRight)]")
    assert left >= 47 and right >= 47, (left, right)
