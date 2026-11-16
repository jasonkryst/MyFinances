"""Savings Contribute (issue #546): the in-app amount dialog that replaced the
native prompt(), tested end to end for both fund types, including the invalid
amount, cancel and the cap at the target."""
import pytest

from tests.conftest import seed_state, wait_for_api, wait_for_app_ready

pytestmark = pytest.mark.feature

STATE = {
    'accounts': [{'id': 10, 'name': 'Savings', 'type': 'Savings', 'startingBalance': 5000}],
    'emergencyFunds': [{'id': 1, 'accountId': 10, 'targetAmount': 1000, 'currentAmount': 100,
                        'monthlyContribution': 50, 'autoContribute': False, 'autoSyncBalance': False}],
    'sinkingFunds': [{'id': 1, 'name': 'Vacation', 'allocationMethod': 'fixed', 'monthlyAllocation': 100,
                      'targetAmount': 500, 'currentAmount': 50, 'accountId': 10, 'autoContribute': False}],
}


@pytest.fixture
def savings_page(app_page):
    page = app_page
    seed_state(page, STATE)
    wait_for_app_ready(page)
    page.click('button[data-page="savings"]')
    page.wait_for_selector('#savingsSection.active')
    return page


def _open(page, selector):
    page.click(selector)
    page.wait_for_selector('#contributeModal:not(.hidden)')
    page.wait_for_function("() => document.activeElement && document.activeElement.id === 'contributeAmountInput'")


def test_emergency_fund_contribution_is_saved(savings_page):
    page = savings_page
    _open(page, '[data-emergency-action="contribute"]')
    assert 'emergency fund' in page.text_content('#contributeModalDesc')
    page.fill('#contributeAmountInput', '75.50')
    page.click('#contributeConfirmBtn')
    page.wait_for_selector('#contributeModal', state='hidden')
    wait_for_api(page, '/api/emergency-funds', lambda rows: rows[0]['currentAmount'] == 175.5)
    assert page.evaluate("window.app.emergencyFunds[0].currentAmount") == 175.5


def test_sinking_fund_contribution_is_saved_with_enter(savings_page):
    page = savings_page
    page.click('[data-savings-subtab="sinking"]')
    _open(page, '[data-sinking-action="contribute"]')
    assert 'Vacation' in page.text_content('#contributeModalDesc')
    page.fill('#contributeAmountInput', '25')
    page.press('#contributeAmountInput', 'Enter')
    page.wait_for_selector('#contributeModal', state='hidden')
    wait_for_api(page, '/api/sinking-funds', lambda rows: rows[0]['currentAmount'] == 75)


def test_contribution_is_capped_at_the_target(savings_page):
    page = savings_page
    page.click('[data-savings-subtab="sinking"]')
    _open(page, '[data-sinking-action="contribute"]')
    page.fill('#contributeAmountInput', '10000')
    page.click('#contributeConfirmBtn')
    wait_for_api(page, '/api/sinking-funds', lambda rows: rows[0]['currentAmount'] == 500)


@pytest.mark.parametrize('bad', ['', '0', '-5', '0.001'])
def test_invalid_amount_shows_an_error_and_saves_nothing(savings_page, bad):
    page = savings_page
    _open(page, '[data-emergency-action="contribute"]')
    page.fill('#contributeAmountInput', bad)
    page.click('#contributeConfirmBtn')
    page.wait_for_selector('#contributeAmountError:not(.hidden)')
    assert page.is_visible('#contributeModal')
    assert page.get_attribute('#contributeAmountInput', 'aria-invalid') == 'true'
    assert 'valid amount' in page.text_content('#contributeAmountError')
    # Fixing the amount saves it.
    page.fill('#contributeAmountInput', '10')
    page.click('#contributeConfirmBtn')
    wait_for_api(page, '/api/emergency-funds', lambda rows: rows[0]['currentAmount'] == 110)


@pytest.mark.parametrize('how', ['cancel', 'escape'])
def test_cancel_saves_nothing_and_restores_focus(savings_page, how):
    page = savings_page
    _open(page, '[data-emergency-action="contribute"]')
    page.fill('#contributeAmountInput', '40')
    if how == 'cancel':
        page.click('#contributeCancelBtn')
    else:
        page.keyboard.press('Escape')
    page.wait_for_selector('#contributeModal', state='hidden')
    assert page.evaluate("document.activeElement.getAttribute('data-emergency-action')") == 'contribute'
    page.wait_for_timeout(300)
    assert page.evaluate("window.app.emergencyFunds[0].currentAmount") == 100


def test_dialog_traps_tab_and_never_uses_a_native_prompt(savings_page):
    page = savings_page
    dialogs = []
    page.on('dialog', lambda d: dialogs.append(d.type))
    _open(page, '[data-emergency-action="contribute"]')
    seen = set()
    for _ in range(4):
        page.keyboard.press('Tab')
        seen.add(page.evaluate("document.activeElement.id"))
    assert seen <= {'contributeAmountInput', 'contributeCancelBtn', 'contributeConfirmBtn'}
    page.keyboard.press('Escape')
    assert dialogs == []
