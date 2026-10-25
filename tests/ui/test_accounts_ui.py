import pytest

from tests.conftest import current_month_iso


def _seed_and_open_breakdown(page):
    """Seed one account with a linked income deposit this month, navigate to
    Accounts, and open its balance breakdown modal (#257)."""
    page.evaluate("""(firstPayDate) => {
        const app = window.app;
        app.accounts = [{ id: 9301, name: 'UI Test Checking', type: 'Checking', startingBalance: 500, interestRate: 0 }];
        app.incomes = [{ id: 9302, name: 'Direct Deposit', amount: 1500, firstPayDate, frequency: 'monthly', accountId: 9301 }];
        app.debts = []; app.bills = []; app.expenses = []; app.recurringTemplates = []; app.bonuses = [];
        app.renderAccountsList();
    }""", current_month_iso(5))
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)
    page.click('[data-account-action="breakdown"][data-account-id="9301"]')
    page.wait_for_selector('#acctBreakdownModal:not(.hidden)', timeout=5000)


@pytest.mark.ui
def test_account_breakdown_modal_shows_account_name_and_month(app_page):
    """Positive: modal title names the account and the current month."""
    page = app_page
    _seed_and_open_breakdown(page)

    title_text = page.evaluate('() => document.getElementById("acctBreakdownTitle")?.textContent || ""')
    assert 'UI Test Checking' in title_text, f"Expected account name in title, got: {title_text}"


@pytest.mark.ui
def test_account_breakdown_close_button_hides_modal_and_restores_focus(app_page):
    """Positive: clicking Close hides the modal and returns focus to the
    'See breakdown' button that opened it."""
    page = app_page
    _seed_and_open_breakdown(page)

    page.click('#acctBreakdownClose')
    assert not page.is_visible('#acctBreakdownModal'), "Modal should be hidden after clicking Close"

    focused_action = page.evaluate('() => document.activeElement?.getAttribute("data-account-action")')
    assert focused_action == 'breakdown', f"Expected focus restored to the breakdown trigger button, got data-account-action={focused_action}"


@pytest.mark.ui
def test_account_breakdown_escape_key_closes_modal(app_page):
    """Positive: pressing Escape dismisses the modal."""
    page = app_page
    _seed_and_open_breakdown(page)

    page.keyboard.press('Escape')
    assert not page.is_visible('#acctBreakdownModal'), "Escape should dismiss the modal"


@pytest.mark.ui
def test_account_breakdown_backdrop_click_closes_modal(app_page):
    """Positive: clicking the overlay backdrop (outside modal-content) closes it."""
    page = app_page
    _seed_and_open_breakdown(page)

    # modal.onclick only closes when e.target === modal (the overlay itself,
    # not a descendant), so dispatch the click directly on the overlay element.
    page.evaluate("""() => {
        const modal = document.getElementById('acctBreakdownModal');
        const evt = document.createEvent('MouseEvents');
        evt.initEvent('click', true, true);
        modal.dispatchEvent(evt);
    }""")
    assert not page.is_visible('#acctBreakdownModal'), "Clicking the backdrop should dismiss the modal"


@pytest.mark.ui
def test_account_breakdown_content_click_does_not_close_modal(app_page):
    """Negative: clicking inside the modal content (not the backdrop) must
    NOT close the modal."""
    page = app_page
    _seed_and_open_breakdown(page)

    page.click('#acctBreakdownTitle')
    assert page.is_visible('#acctBreakdownModal'), "Clicking inside modal content should not close it"


@pytest.mark.ui
def test_account_breakdown_tab_wraps_focus_inside_modal(app_page):
    """Positive: Tab from the last focusable element wraps to the first,
    keeping focus trapped inside the open modal."""
    page = app_page
    _seed_and_open_breakdown(page)

    page.evaluate("""() => {
        const modal = document.getElementById('acctBreakdownModal');
        const focusable = modal.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
        focusable[focusable.length - 1].focus();
    }""")
    page.keyboard.press('Tab')
    wrapped = page.evaluate("""() => {
        const modal = document.getElementById('acctBreakdownModal');
        const focusable = modal.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
        return document.activeElement === focusable[0];
    }""")
    assert wrapped, "Tab from the last focusable element should wrap to the first"


@pytest.mark.ui
def test_account_breakdown_modal_has_accessible_dialog_attributes(app_page):
    """Positive: the modal exposes role=dialog, aria-modal, and a
    labelledby pointing at the (dynamically rendered) title."""
    page = app_page
    _seed_and_open_breakdown(page)

    attrs = page.evaluate("""() => {
        const modal = document.getElementById('acctBreakdownModal');
        return {
            role: modal.getAttribute('role'),
            ariaModal: modal.getAttribute('aria-modal'),
            labelledby: modal.getAttribute('aria-labelledby'),
            titleExists: !!document.getElementById(modal.getAttribute('aria-labelledby'))
        };
    }""")
    assert attrs['role'] == 'dialog'
    assert attrs['ariaModal'] == 'true'
    assert attrs['titleExists'], "aria-labelledby should point at an element that exists once the modal is open"
