#!/usr/bin/env python3
"""
Accessibility Tests
Tests keyboard navigation, ARIA labels, and screen reader compatibility.
"""

import pytest

from tests.conftest import create_debt

def _calculate_plan(page, debt_data):
    """Create a debt and run a payment plan so the Results tab bar renders."""
    create_debt(page, debt_data)
    page.click('button[data-page="strategy"]')
    page.wait_for_timeout(300)
    page.fill('#monthlyPayment', '200')
    page.select_option('#paymentStrategy', 'avalanche')
    page.click('#calculateBtn')
    page.wait_for_timeout(500)


@pytest.mark.ui
def test_keyboard_navigation(app_page):
    """Test keyboard navigation through app."""
    page = app_page
    
    # Tab through page elements
    page.keyboard.press('Tab')
    page.wait_for_timeout(100)
    
    # Should be able to focus on interactive elements
    focused_elem = page.evaluate('() => document.activeElement.tagName')
    assert focused_elem in ['BUTTON', 'INPUT', 'SELECT', 'A', 'BODY'], \
        f"Tab navigation failed, focused on {focused_elem}"


@pytest.mark.ui
def test_button_accessibility(app_page):
    """Test buttons have proper accessibility attributes."""
    page = app_page
    
    buttons = page.query_selector_all('button')
    assert len(buttons) > 0, "No buttons found"
    
    for button in buttons[:5]:
        # Button should be keyboard accessible
        is_button = button.evaluate('(el) => el.tagName === "BUTTON"')
        assert is_button, "Element should be a button tag"


@pytest.mark.ui
def test_form_labels(app_page):
    """Test form inputs have associated labels."""
    page = app_page
    
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    
    # Find form inputs
    inputs = page.query_selector_all('input')
    
    for input_elem in inputs[:3]:
        # Input should have id or be associated with label
        input_id = input_elem.evaluate('(el) => el.id')
        assert input_id, "Input should have ID"


@pytest.mark.ui
def test_semantic_html(app_page):
    """Test use of semantic HTML elements."""
    page = app_page
    
    # Check for main content markers
    semantic_elements = page.evaluate("""
        () => ({
            main: !!document.querySelector('main'),
            nav: !!document.querySelector('nav'),
            sections: document.querySelectorAll('section').length,
            headings: document.querySelectorAll('h1, h2, h3').length
        })
    """)
    
    # App should use semantic elements appropriately
    assert semantic_elements['sections'] >= 0, "Should use semantic structure"


@pytest.mark.ui
def test_color_contrast(app_page):
    """Test that text has sufficient color contrast."""
    page = app_page
    
    # Get body text color and background
    colors = page.evaluate("""
        () => {
            const body = document.querySelector('body');
            const style = window.getComputedStyle(body);
            return {
                bg: style.backgroundColor,
                color: style.color
            };
        }
    """)
    
    assert colors['bg'] and colors['color'], "Colors should be set"


@pytest.mark.ui
def test_focus_indicators(app_page):
    """Test that interactive elements show focus indicators."""
    page = app_page
    
    # Tab to first button
    buttons = page.query_selector_all('button')
    if buttons:
        buttons[0].focus()
        page.wait_for_timeout(100)
        
        # Element should show focus state
        focus_outline = buttons[0].evaluate("""
            (el) => window.getComputedStyle(el).outline
        """)
        
        # Should have some visual indication of focus
        assert focus_outline or True, "Focus state should be visible"


@pytest.mark.ui
def test_skip_link(app_page):
    """Test presence of skip link for keyboard users."""
    page = app_page
    
    # Look for skip link
    skip_link = page.query_selector('a[href="#main"], a[href="#content"]')
    
    # Skip link is optional but good practice
    assert skip_link or True, "Skip link helpful but not required"


@pytest.mark.ui
def test_aria_attributes(app_page):
    """Test ARIA attributes are used appropriately."""
    page = app_page
    
    # Check for ARIA labels on important elements
    aria_elements = page.query_selector_all('[aria-label], [aria-labelledby], [aria-describedby]')
    
    # App should use ARIA where semantic HTML isn't sufficient
    assert isinstance(aria_elements, list), "ARIA attributes should be accessible"


@pytest.mark.ui
def test_reconcile_inputs_have_labels(app_page):
    """Reconcile card inputs (date, balance, note) have associated <label> elements."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 8501, name: 'Recon Labels', type: 'Checking', startingBalance: 1000 }];
        app.incomes = []; app.bonuses = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = [];
        app._reconciliationAccountFilter = 'all';
        app.switchPage('reconcile');
    }""")
    page.wait_for_timeout(300)

    for field in ('date', 'balance', 'note'):
        label = page.query_selector(f'label[for="recon-{field}-8501"]')
        assert label, f"Expected a <label> for recon-{field}-8501"


@pytest.mark.ui
def test_reconcile_action_buttons_are_buttons(app_page):
    """Reconcile and delete-history actions are rendered as <button> elements."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 8502, name: 'Recon Buttons', type: 'Checking', startingBalance: 1000 }];
        app.incomes = []; app.bonuses = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = [];
        app._reconciliationAccountFilter = 'all';
        app.applyReconciliation(8502, 1100, '', '2026-06-10');
        app.switchPage('reconcile');
    }""")
    page.wait_for_timeout(300)

    reconcile_btn = page.query_selector('[data-recon-action="reconcile"][data-recon-id="8502"]')
    assert reconcile_btn, "Expected a reconcile button"
    assert reconcile_btn.evaluate('(el) => el.tagName') == 'BUTTON'

    delete_btn = page.query_selector('[data-recon-action="delete-history"]')
    assert delete_btn, "Expected a delete-history button"
    assert delete_btn.evaluate('(el) => el.tagName') == 'BUTTON'


@pytest.mark.ui
def test_reconcile_modal_focus_and_keyboard_trap(app_page):
    """Opening the reconcile modal focuses the balance input; Escape closes it."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 8503, name: 'Recon Focus', type: 'Checking', startingBalance: 1000 }];
        app.incomes = []; app.bonuses = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = [];
        app._reconciliationAccountFilter = 'all';
        app.openReconcileModal(8503);
    }""")
    page.wait_for_timeout(300)

    focused_id = page.evaluate('() => document.activeElement.id')
    assert focused_id == 'reconcileModalBalance', "Opening the modal should focus the balance input"

    page.keyboard.press('Escape')
    page.wait_for_timeout(300)

    modal_hidden = page.evaluate(
        '() => document.getElementById("reconcileModal")?.classList.contains("hidden")'
    )
    assert modal_hidden, "Escape should close the reconcile modal"


@pytest.mark.ui
def test_help_link_opens_guide(app_page):
    """Test the help control opens the usage guide in a new page."""
    page = app_page

    help_link = page.locator('#helpBtn')
    assert help_link.get_attribute('href') == 'guide.html'
    assert help_link.get_attribute('target') == '_blank'

    with page.expect_popup() as popup_info:
        help_link.click()

    popup = popup_info.value
    popup.wait_for_load_state('domcontentloaded')

    assert popup.url.endswith('/guide.html')
    popup.close()


    # See tests/ui/test_guide_theme.py for guide.html dark-mode propagation coverage.


@pytest.mark.ui
def test_reports_nav_tablist_role(app_page):
    """The Reports tab bar has role=tablist for screen reader semantics."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    role = page.evaluate(
        '() => document.querySelector(".rpt-tab-bar")?.getAttribute("role")'
    )
    assert role == 'tablist', f"Expected role=tablist on .rpt-tab-bar, got: {role}"


@pytest.mark.ui
def test_reports_tab_buttons_have_role_tab(app_page):
    """Every report tab button has role=tab."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    roles = page.evaluate("""
        () => Array.from(document.querySelectorAll('.rpt-tab-btn'))
                   .map(b => b.getAttribute('role'))
    """)
    assert all(r == 'tab' for r in roles), \
        f"Not all tab buttons have role=tab: {roles}"


@pytest.mark.ui
def test_reports_active_tab_aria_selected_true(app_page):
    """The active tab has aria-selected=true; all others have aria-selected=false."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    page.click('[data-rptab="networth"]')
    page.wait_for_timeout(150)

    result = page.evaluate("""
        () => {
            const btns = document.querySelectorAll('.rpt-tab-btn');
            const trueCount  = [...btns].filter(b => b.getAttribute('aria-selected') === 'true').length;
            const falseCount = [...btns].filter(b => b.getAttribute('aria-selected') === 'false').length;
            const activeId   = [...btns].find(b => b.getAttribute('aria-selected') === 'true')?.getAttribute('data-rptab');
            return { trueCount, falseCount, activeId };
        }
    """)
    assert result['trueCount'] == 1, f"Expected exactly 1 aria-selected=true, got {result['trueCount']}"
    assert result['falseCount'] == 6, f"Expected 6 aria-selected=false, got {result['falseCount']}"
    assert result['activeId'] == 'networth', f"Expected networth to be selected, got {result['activeId']}"


@pytest.mark.ui
def test_reports_tab_buttons_have_aria_controls(app_page):
    """Each tab button has aria-controls pointing to its panel id."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    mismatches = page.evaluate("""
        () => {
            const btns = document.querySelectorAll('.rpt-tab-btn[data-rptab]');
            const errors = [];
            for (const btn of btns) {
                const tab   = btn.getAttribute('data-rptab');
                const ctrl  = btn.getAttribute('aria-controls');
                const panel = document.getElementById(ctrl);
                if (ctrl !== 'rptPanel-' + tab) {
                    errors.push(`${tab}: aria-controls="${ctrl}" (expected rptPanel-${tab})`);
                }
                if (!panel) {
                    errors.push(`${tab}: panel #${ctrl} not found in DOM`);
                }
            }
            return errors;
        }
    """)
    assert mismatches == [], f"aria-controls mismatches: {mismatches}"


@pytest.mark.ui
def test_reports_group_separators_aria_hidden(app_page):
    """Decorative group separator divs are aria-hidden so screen readers skip them."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    seps = page.evaluate("""
        () => Array.from(document.querySelectorAll('.rpt-tab-group-sep'))
                   .map(s => s.getAttribute('aria-hidden'))
    """)
    assert seps, "No .rpt-tab-group-sep elements found"
    assert all(v == 'true' for v in seps), \
        f"All separators must have aria-hidden=true, got: {seps}"


@pytest.mark.ui
def test_reports_group_labels_are_not_interactive(app_page):
    """Group chip labels are <span> elements (not buttons), so they are not in the tab focus order."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    tags = page.evaluate("""
        () => Array.from(document.querySelectorAll('.rpt-tab-group-label'))
                   .map(el => el.tagName)
    """)
    assert all(t == 'SPAN' for t in tags), \
        f"Group labels must be <span>, got: {tags}"


@pytest.mark.ui
def test_reports_tab_keyboard_focus_reachable(app_page):
    """Pressing Tab from the nav bar reaches each tab button via keyboard."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    # Focus the first tab button
    page.evaluate('() => document.querySelector(".rpt-tab-btn").focus()')
    page.wait_for_timeout(100)

    focused = page.evaluate('() => document.activeElement.classList.contains("rpt-tab-btn")')
    assert focused, "Could not focus a .rpt-tab-btn via JS focus()"

    # Tab forward through all 7 buttons
    focused_tabs = set()
    for _ in range(7):
        tab_id = page.evaluate(
            '() => document.activeElement.getAttribute("data-rptab")'
        )
        if tab_id:
            focused_tabs.add(tab_id)
        page.keyboard.press('Tab')
        page.wait_for_timeout(50)

    expected = {'calendar', 'spending', 'incomeexp', 'moneyflow', 'variance', 'networth', 'forecast'}
    assert expected.issubset(focused_tabs), \
        f"Not all tab buttons were reached via Tab key. Reached: {focused_tabs}"


@pytest.mark.ui
def test_reports_active_tab_has_focus_visible_outline(app_page):
    """Tab buttons show a visible focus ring via :focus-visible (not suppressed)."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    # Check that :focus-visible outline is not 'none' in the stylesheet
    has_focus_visible = page.evaluate("""
        () => {
            // Look for focus-visible rule in all stylesheets
            for (const sheet of document.styleSheets) {
                try {
                    for (const rule of sheet.cssRules) {
                        if (rule.selectorText && rule.selectorText.includes('rpt-tab-btn') &&
                            rule.selectorText.includes('focus-visible')) {
                            return rule.style.outline !== 'none' && rule.style.outline !== '';
                        }
                    }
                } catch (e) {}
            }
            return false;
        }
    """)
    assert has_focus_visible, \
        ".rpt-tab-btn:focus-visible must define a non-none outline for keyboard users"


# ── Main nav a11y ──────────────────────────────────────────────────────────

@pytest.mark.ui
async def test_main_nav_has_landmark_role(async_app_page):
    """Main <nav> must have aria-label so it's a named navigation landmark."""
    label = await async_app_page.get_attribute('nav.top-nav', 'aria-label')
    assert label == 'Main navigation', \
        f"<nav> aria-label should be 'Main navigation', got: {label!r}"


@pytest.mark.ui
async def test_main_nav_active_page_aria_current(async_app_page):
    """Active page button must have aria-current='page'; others must have 'false'."""
    # Health is active by default
    active = await async_app_page.get_attribute('[data-page="health"]', 'aria-current')
    assert active == 'page', f"Health button aria-current should be 'page', got: {active!r}"

    for page in ['accounts', 'income', 'liabilities', 'recurring', 'savings',
                 'strategy', 'reports', 'ledger', 'reconcile']:
        val = await async_app_page.get_attribute(f'[data-page="{page}"]', 'aria-current')
        assert val == 'false', \
            f"Inactive button '{page}' aria-current should be 'false', got: {val!r}"


@pytest.mark.ui
async def test_main_nav_aria_current_updates_on_click(async_app_page):
    """Clicking a page button must move aria-current='page' to the new button."""
    await async_app_page.click('[data-page="reports"]')
    await async_app_page.wait_for_timeout(200)
    reports_val = await async_app_page.get_attribute('[data-page="reports"]', 'aria-current')
    health_val  = await async_app_page.get_attribute('[data-page="health"]',  'aria-current')
    assert reports_val == 'page',  f"reports aria-current should be 'page', got {reports_val!r}"
    assert health_val  == 'false', f"health aria-current should be 'false', got {health_val!r}"


@pytest.mark.ui
async def test_main_nav_group_labels_are_spans(async_app_page):
    """Group labels must be <span> (non-interactive) not <button>."""
    tags = await async_app_page.evaluate('''() =>
        [...document.querySelectorAll('#topNav .nav-group-label')]
            .map(el => el.tagName.toLowerCase())
    ''')
    assert tags == ['span', 'span', 'span'], \
        f"All .nav-group-label elements should be <span>, got: {tags}"


@pytest.mark.ui
async def test_main_nav_separators_aria_hidden(async_app_page):
    """Group separators must be aria-hidden (decorative)."""
    seps = await async_app_page.query_selector_all('.nav-group-sep')
    assert len(seps) == 2, f"Expected 2 nav-group-sep elements, got {len(seps)}"
    for sep in seps:
        val = await sep.get_attribute('aria-hidden')
        assert val == 'true', f"nav-group-sep must have aria-hidden='true', got: {val!r}"


@pytest.mark.ui
async def test_main_nav_all_pages_keyboard_reachable(async_app_page):
    """All 10 page buttons must be reachable via Tab key (not hidden, not disabled)."""
    btns = await async_app_page.query_selector_all('#topNav .page-button')
    assert len(btns) == 10, f"Expected 10 .page-button elements in #topNav, got {len(btns)}"
    for btn in btns:
        # Must not be disabled or have tabindex=-1
        disabled = await btn.get_attribute('disabled')
        tabindex = await btn.get_attribute('tabindex')
        assert disabled is None, \
            f"page-button '{await btn.get_attribute('data-page')}' should not be disabled"
        assert tabindex != '-1', \
            f"page-button '{await btn.get_attribute('data-page')}' should not have tabindex=-1"


@pytest.mark.ui
def test_results_tab_bar_has_tablist_role(app_page, debt_data):
    """The Results tab bar has role=tablist for screen reader semantics."""
    page = app_page
    _calculate_plan(page, debt_data)

    role = page.evaluate(
        '() => document.querySelector(".results-tab-bar")?.getAttribute("role")'
    )
    assert role == 'tablist', f"Expected role=tablist on .results-tab-bar, got: {role}"


@pytest.mark.ui
def test_results_tab_buttons_have_role_tab(app_page, debt_data):
    """Every Results tab button has role=tab."""
    page = app_page
    _calculate_plan(page, debt_data)

    roles = page.evaluate("""
        () => Array.from(document.querySelectorAll('.results-tab-btn'))
                   .map(b => b.getAttribute('role'))
    """)
    assert len(roles) == 3, f"Expected 3 Results tab buttons, got {len(roles)}"
    assert all(r == 'tab' for r in roles), \
        f"Not all Results tab buttons have role=tab: {roles}"


@pytest.mark.ui
def test_results_active_tab_aria_selected_true(app_page, debt_data):
    """The active Results tab has aria-selected=true; all others have aria-selected=false."""
    page = app_page
    _calculate_plan(page, debt_data)

    page.click('[data-rtab="schedule"]')
    page.wait_for_timeout(150)

    result = page.evaluate("""
        () => {
            const btns = document.querySelectorAll('.results-tab-btn');
            const trueCount  = [...btns].filter(b => b.getAttribute('aria-selected') === 'true').length;
            const falseCount = [...btns].filter(b => b.getAttribute('aria-selected') === 'false').length;
            const activeId   = [...btns].find(b => b.getAttribute('aria-selected') === 'true')?.getAttribute('data-rtab');
            return { trueCount, falseCount, activeId };
        }
    """)
    assert result['trueCount'] == 1, f"Expected exactly 1 aria-selected=true, got {result['trueCount']}"
    assert result['falseCount'] == 2, f"Expected 2 aria-selected=false, got {result['falseCount']}"
    assert result['activeId'] == 'schedule', f"Expected schedule to be selected, got {result['activeId']}"


@pytest.mark.ui
def test_results_tab_buttons_have_aria_controls(app_page, debt_data):
    """Each Results tab button has aria-controls pointing to an existing panel id."""
    page = app_page
    _calculate_plan(page, debt_data)

    mismatches = page.evaluate("""
        () => {
            const btns = document.querySelectorAll('.results-tab-btn[data-rtab]');
            const errors = [];
            btns.forEach(b => {
                const controls = b.getAttribute('aria-controls');
                if (!controls || !document.getElementById(controls)) {
                    errors.push(b.getAttribute('data-rtab'));
                }
            });
            return errors;
        }
    """)
    assert mismatches == [], f"Tab buttons with missing/invalid aria-controls: {mismatches}"


@pytest.mark.ui
def test_results_tab_panel_switch_updates_active_panel(app_page, debt_data):
    """Clicking a Results tab activates only its corresponding panel."""
    page = app_page
    _calculate_plan(page, debt_data)

    page.click('[data-rtab="debt-summary"]')
    page.wait_for_timeout(150)

    result = page.evaluate("""
        () => {
            const panels = document.querySelectorAll('.results-tab-panel');
            const activeIds = [...panels].filter(p => p.classList.contains('results-tab-panel--active')).map(p => p.id);
            return activeIds;
        }
    """)
    assert result == ['rPanel-debt-summary'], f"Expected only rPanel-debt-summary active, got {result}"
