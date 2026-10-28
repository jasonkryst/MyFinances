#!/usr/bin/env python3
"""
$0 amount policy tests (issue #412).

zeroAmountPolicy ('allow' | 'warn' | 'block', default allow) gates $0 amounts
in the Ledger override modal and recurring templates. Blank and negative
amounts are always rejected; transfer-type recurring templates always need > 0.
"""

import pytest

from tests.conftest import assert_no_errors


# --- helpers ---------------------------------------------------------------

def _set_policy(page, value):
    page.evaluate(
        """(v) => {
            const app = window.app;
            app.settings = (app.settings || []).filter(s => s.key !== 'zeroAmountPolicy');
            app.settings.push({ key: 'zeroAmountPolicy', value: v });
        }""",
        value,
    )


def _seed_income_for_ledger(page, name="Zero Salary", amount=4000):
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)
    page.fill('#accountName', 'Zero Test Checking')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '1000')
    page.click('#accountFormSubmit')
    page.wait_for_selector('text=Zero Test Checking', timeout=10000)

    page.click('button[data-page="income"]')
    page.wait_for_selector('#incomeSection.active', timeout=5000)
    page.fill('#incomeName', name)
    page.fill('#incomeAmount', str(amount))
    page.fill('#incomeFirstDate', '2026-06-01')
    page.select_option('#incomeFrequency', 'monthly')
    page.select_option('#incomeAccount', index=1)
    page.click('#incomeFormSubmit')
    page.wait_for_selector(f'text={name}', timeout=10000)
    page.evaluate("() => { window.app._ledgerDateRange = 'all'; }")


def _open_override_modal(page):
    page.click('button[data-page="ledger"]')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)
    page.wait_for_selector('[data-ledger-override]', timeout=10000)
    btn = page.query_selector('[data-ledger-override]')
    tx_id = btn.get_attribute('data-ledger-override')
    btn.click()
    page.wait_for_selector('#ledgerOverrideModal.flex-visible', timeout=5000)
    # Amount input is auto-focused 30ms after open; wait so fill() isn't raced.
    page.wait_for_selector('#ledgerOverrideAmountInput:focus', timeout=5000)
    return tx_id


def _override_count(page):
    return page.evaluate("() => Object.keys(window.app.ledgerAmountOverrides || {}).length")


def _dismiss_alert(page):
    page.wait_for_selector('#alertModal.flex-visible', timeout=5000)
    text = page.inner_text('#alertModalMessage')
    page.click('#alertModalOkBtn')
    page.wait_for_selector('#alertModal', state='hidden', timeout=5000)
    return text


def _seed_recurring_account(page, account_id=7301):
    page.evaluate(f"""() => {{
        const app = window.app;
        app.accounts = [{{ id: {account_id}, name: 'Zero Rec Account', type: 'Checking', startingBalance: 1000 }}];
        app.recurringTemplates = [];
        app.incomes = []; app.bills = []; app.expenses = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('recurring');
    }}""")


def _submit_recurring(page, name, amount, rec_type="subscription", account_id=7301):
    page.click('button[data-page="recurring"]')
    page.wait_for_selector('#recurringSection.active', timeout=5000)
    if page.get_attribute('#recurringFormToggle', 'aria-expanded') != 'true':
        page.click('#recurringFormToggle')
    page.wait_for_selector('#recurringFormBody:not([hidden])', timeout=5000)
    page.fill('#recurringName', name)
    page.select_option('#recurringType', rec_type)
    page.fill('#recurringAmount', amount)
    page.select_option('#recurringFrequency', 'monthly')
    page.fill('#recurringStartDate', '2026-06-01')
    page.select_option('#recurringAccount', str(account_id))
    if rec_type == 'transfer':
        page.evaluate(
            "() => { const s = document.getElementById('recurringTargetAccount');"
            " if (s && s.options.length > 1) s.selectedIndex = 1; }"
        )
    page.click('#recurringFormSubmit')


def _template_names(page):
    return page.evaluate("() => (window.app.recurringTemplates || []).map(t => t.name)")


# --- override modal: allow (default) ---------------------------------------

@pytest.mark.feature
def test_default_policy_is_allow_and_zero_override_saves_silently(app_page):
    page = app_page
    _seed_income_for_ledger(page)
    assert page.evaluate("() => (window.app.settings || []).some(s => s.key === 'zeroAmountPolicy')") is False
    tx_id = _open_override_modal(page)
    page.fill('#ledgerOverrideAmountInput', '0')
    page.click('#ledgerOverrideConfirmBtn')
    page.wait_for_selector('#ledgerOverrideModal', state='hidden', timeout=5000)
    assert _override_count(page) == 1
    row_text = page.evaluate(
        """(id) => document.querySelector(`[data-ledger-override="${id}"]`)
            ?.closest('tr')?.querySelector('.ledger-amount-effective')?.textContent || ''""",
        tx_id,
    )
    assert '0.00' in row_text and '4,000' not in row_text, f"Ledger should show a $0 row, got {row_text!r}"


@pytest.mark.feature
def test_unknown_stored_policy_behaves_as_allow(app_page):
    page = app_page
    _seed_income_for_ledger(page)
    _set_policy(page, 'banana')
    _open_override_modal(page)
    page.fill('#ledgerOverrideAmountInput', '0')
    page.click('#ledgerOverrideConfirmBtn')
    page.wait_for_selector('#ledgerOverrideModal', state='hidden', timeout=5000)
    assert _override_count(page) == 1


# --- override modal: warn --------------------------------------------------

@pytest.mark.feature
def test_warn_policy_confirm_saves_zero_override(app_page):
    page = app_page
    _seed_income_for_ledger(page)
    _set_policy(page, 'warn')
    _open_override_modal(page)
    page.fill('#ledgerOverrideAmountInput', '0')
    page.click('#ledgerOverrideConfirmBtn')
    page.wait_for_selector('#deleteConfirmModal.flex-visible', timeout=5000)
    assert '$0' in page.inner_text('#deleteConfirmMessage')
    assert _override_count(page) == 0, "Nothing saved until confirmed"
    page.click('#deleteConfirmBtn')
    page.wait_for_selector('#ledgerOverrideModal', state='hidden', timeout=5000)
    assert _override_count(page) == 1


@pytest.mark.feature
def test_warn_policy_cancel_does_not_save(app_page):
    page = app_page
    _seed_income_for_ledger(page)
    _set_policy(page, 'warn')
    _open_override_modal(page)
    page.fill('#ledgerOverrideAmountInput', '0')
    page.click('#ledgerOverrideConfirmBtn')
    page.wait_for_selector('#deleteConfirmModal.flex-visible', timeout=5000)
    page.click('#deleteConfirmCancelBtn')
    page.wait_for_selector('#deleteConfirmModal', state='hidden', timeout=5000)
    assert _override_count(page) == 0
    assert page.is_visible('#ledgerOverrideModal.flex-visible'), "Override modal stays open after cancel"


@pytest.mark.feature
def test_warn_policy_nonzero_saves_without_prompt(app_page):
    page = app_page
    _seed_income_for_ledger(page)
    _set_policy(page, 'warn')
    _open_override_modal(page)
    page.fill('#ledgerOverrideAmountInput', '12.34')
    page.click('#ledgerOverrideConfirmBtn')
    page.wait_for_selector('#ledgerOverrideModal', state='hidden', timeout=5000)
    assert _override_count(page) == 1
    assert not page.is_visible('#deleteConfirmModal.flex-visible')


# --- override modal: block -------------------------------------------------

@pytest.mark.feature
def test_block_policy_rejects_zero_override(app_page):
    page = app_page
    _seed_income_for_ledger(page)
    _set_policy(page, 'block')
    _open_override_modal(page)
    page.fill('#ledgerOverrideAmountInput', '0')
    page.click('#ledgerOverrideConfirmBtn')
    msg = _dismiss_alert(page)
    assert 'Settings' in msg and 'Advanced' in msg
    assert _override_count(page) == 0


@pytest.mark.feature
def test_block_policy_still_saves_nonzero_override(app_page):
    page = app_page
    _seed_income_for_ledger(page)
    _set_policy(page, 'block')
    _open_override_modal(page)
    page.fill('#ledgerOverrideAmountInput', '55.5')
    page.click('#ledgerOverrideConfirmBtn')
    page.wait_for_selector('#ledgerOverrideModal', state='hidden', timeout=5000)
    assert _override_count(page) == 1


# --- override modal: blank is always invalid (negative) --------------------

@pytest.mark.feature
@pytest.mark.parametrize("policy", ["allow", "warn", "block"])
@pytest.mark.parametrize("kind", ["blank", "whitespace"])
def test_blank_override_amount_rejected_under_every_policy(app_page, policy, kind):
    page = app_page
    _seed_income_for_ledger(page)
    _set_policy(page, policy)
    _open_override_modal(page)
    if kind == "blank":
        page.fill('#ledgerOverrideAmountInput', '')
    else:
        page.evaluate("() => { document.getElementById('ledgerOverrideAmountInput').value = '   '; }")
    page.click('#ledgerOverrideConfirmBtn')
    msg = _dismiss_alert(page)
    assert 'valid number' in msg
    assert _override_count(page) == 0
    assert not page.is_visible('#deleteConfirmModal.flex-visible')


# --- recurring templates ---------------------------------------------------

@pytest.mark.feature
@pytest.mark.parametrize("rec_type", ["subscription", "reimbursement"])
def test_default_allow_zero_recurring_template_saves(app_page, rec_type):
    page = app_page
    _seed_recurring_account(page)
    _submit_recurring(page, f"Zero {rec_type}", "0", rec_type=rec_type)
    page.wait_for_function("() => window.app.recurringTemplates.length === 1", timeout=5000)
    tmpl = page.evaluate("() => window.app.recurringTemplates[0]")
    assert tmpl['amount'] == 0
    page.wait_for_selector(f'text=Zero {rec_type}', timeout=5000)


@pytest.mark.feature
def test_zero_recurring_appears_in_ledger_as_zero_row(app_page):
    page = app_page
    _seed_recurring_account(page)
    _submit_recurring(page, "Zero Ledger Sub", "0", rec_type="subscription")
    page.wait_for_function("() => window.app.recurringTemplates.length === 1", timeout=5000)
    page.evaluate("() => { window.app._ledgerDateRange = 'all'; }")
    page.click('button[data-page="ledger"]')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)
    page.wait_for_selector('#ledgerSection >> text=Zero Ledger Sub', timeout=10000)
    assert_no_errors(page)


@pytest.mark.feature
def test_warn_recurring_confirm_and_cancel(app_page):
    page = app_page
    _seed_recurring_account(page)
    _set_policy(page, 'warn')
    _submit_recurring(page, "Warn Cancel", "0")
    page.wait_for_selector('#deleteConfirmModal.flex-visible', timeout=5000)
    assert 'Warn Cancel' in page.inner_text('#deleteConfirmMessage')
    page.click('#deleteConfirmCancelBtn')
    page.wait_for_selector('#deleteConfirmModal', state='hidden', timeout=5000)
    assert _template_names(page) == []

    page.click('#recurringFormSubmit')
    page.wait_for_selector('#deleteConfirmModal.flex-visible', timeout=5000)
    page.click('#deleteConfirmBtn')
    page.wait_for_function("() => window.app.recurringTemplates.length === 1", timeout=5000)
    assert _template_names(page) == ["Warn Cancel"]


@pytest.mark.feature
def test_block_recurring_zero_rejected_but_nonzero_saves(app_page):
    page = app_page
    _seed_recurring_account(page)
    _set_policy(page, 'block')
    _submit_recurring(page, "Block Zero", "0")
    msg = _dismiss_alert(page)
    assert 'Advanced' in msg
    assert _template_names(page) == []

    page.fill('#recurringAmount', '9.99')
    page.click('#recurringFormSubmit')
    page.wait_for_function("() => window.app.recurringTemplates.length === 1", timeout=5000)


@pytest.mark.feature
@pytest.mark.parametrize("policy", ["allow", "warn", "block"])
def test_blank_recurring_amount_rejected(app_page, policy):
    page = app_page
    _seed_recurring_account(page)
    _set_policy(page, policy)
    _submit_recurring(page, "Blank Amt", "")
    _dismiss_alert(page)
    assert _template_names(page) == []


@pytest.mark.feature
def test_negative_recurring_amount_rejected_under_allow(app_page):
    page = app_page
    _seed_recurring_account(page)
    _set_policy(page, 'allow')
    _submit_recurring(page, "Negative Amt", "-5")
    _dismiss_alert(page)
    assert _template_names(page) == []


@pytest.mark.feature
def test_transfer_recurring_zero_rejected_even_under_allow(app_page):
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [
            { id: 7301, name: 'Zero Rec Account', type: 'Checking', startingBalance: 1000 },
            { id: 7302, name: 'Zero Rec Savings', type: 'Savings', startingBalance: 500 }
        ];
        app.recurringTemplates = [];
        app.switchPage('recurring');
    }""")
    _set_policy(page, 'allow')
    _submit_recurring(page, "Zero Transfer", "0", rec_type="transfer")
    msg = _dismiss_alert(page)
    assert 'Transfer' in msg
    assert _template_names(page) == []


@pytest.mark.feature
def test_inline_edit_zero_policy_and_blank(app_page):
    page = app_page
    _seed_recurring_account(page)
    page.evaluate("""() => {
        window.app.recurringTemplates = [{
            id: 8801, name: 'Edit Me', type: 'subscription', amount: 25, frequency: 'monthly',
            dayOfMonth: 1, category: 'Other', accountId: 7301, targetAccountId: null,
            startDate: '2026-06-01', endDate: null, paused: false,
            skippedMonths: [], paidMonths: [], paidAmounts: {}
        }];
        window.app.renderRecurringPage();
        window.app.startEditRecurring(8801);
    }""")
    page.wait_for_selector('#re-amount-8801', timeout=5000)

    def amount():
        return page.evaluate("() => window.app.recurringTemplates[0].amount")

    # blank rejected
    page.fill('#re-amount-8801', '')
    page.evaluate("() => { window.app.saveEditRecurring(8801); }")
    _dismiss_alert(page)
    assert amount() == 25

    # negative rejected
    page.fill('#re-amount-8801', '-3')
    page.evaluate("() => { window.app.saveEditRecurring(8801); }")
    _dismiss_alert(page)
    assert amount() == 25

    # block: zero rejected
    _set_policy(page, 'block')
    page.fill('#re-amount-8801', '0')
    page.evaluate("() => { window.app.saveEditRecurring(8801); }")
    _dismiss_alert(page)
    assert amount() == 25

    # warn: confirm saves
    _set_policy(page, 'warn')
    page.evaluate("() => { window.app.saveEditRecurring(8801); }")
    page.wait_for_selector('#deleteConfirmModal.flex-visible', timeout=5000)
    page.click('#deleteConfirmBtn')
    page.wait_for_function("() => window.app.recurringTemplates[0].amount === 0", timeout=5000)


# --- persistence -----------------------------------------------------------

@pytest.mark.feature
def test_policy_persists_across_reload_and_is_in_export(app_page):
    page = app_page
    _set_policy(page, 'warn')
    page.evaluate("() => { window.app.saveToStorage(); window.flushStorageSave && window.flushStorageSave(); }")
    stored = page.evaluate(
        """() => JSON.parse(localStorage.getItem(window.app.storageKey || 'debtTrackerData')).settings"""
    )
    assert {'key': 'zeroAmountPolicy', 'value': 'warn'} in stored
    # exportAllJSON serializes app.settings verbatim
    exported = page.evaluate("() => window.app.settings")
    assert {'key': 'zeroAmountPolicy', 'value': 'warn'} in exported
    page.reload(wait_until="networkidle")
    assert page.evaluate(
        "() => (window.app.settings.find(s => s.key === 'zeroAmountPolicy') || {}).value"
    ) == 'warn'


# --- downstream pages with a $0 recurring template -------------------------

@pytest.mark.feature
@pytest.mark.parametrize("nav", ["reports", "strategy", "health", "accounts", "savings", "recurring"])
def test_pages_render_with_zero_recurring_template(app_page, nav):
    page = app_page
    _seed_recurring_account(page)
    page.evaluate("""() => {
        window.app.recurringTemplates = [{
            id: 8802, name: 'Zero Downstream', type: 'subscription', amount: 0, frequency: 'monthly',
            dayOfMonth: 1, category: 'Other', accountId: 7301, targetAccountId: null,
            startDate: '2026-01-01', endDate: null, paused: false,
            skippedMonths: [], paidMonths: [], paidAmounts: {}
        }];
    }""")
    page.click(f'button[data-page="{nav}"]')
    page.wait_for_selector(f'#{nav}Section.active', timeout=8000)
    page.wait_for_timeout(500)
    assert_no_errors(page)
    body = page.inner_text('body')
    assert 'NaN' not in body and 'Infinity' not in body


# --- settings modal --------------------------------------------------------

@pytest.mark.feature
def test_settings_modal_has_zero_policy_select_in_advanced_tab(app_page):
    page = app_page
    page.evaluate("() => document.getElementById('settingsBtn').click()")
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)
    page.click('[data-settings-tab="advanced"]')
    sel = page.locator('#settingZeroAmountPolicy')
    sel.wait_for(state='visible', timeout=5000)
    assert page.locator('#settingsPanel-advanced #settingZeroAmountPolicy').count() == 1
    values = page.eval_on_selector_all('#settingZeroAmountPolicy option', 'els => els.map(e => e.value)')
    assert values == ['allow', 'warn', 'block']
    assert sel.input_value() == 'allow'
    assert '$0' in page.inner_text('label[for="settingZeroAmountPolicy"]')

    sel.select_option('block')
    page.click('#settingsModalDoneBtn')
    assert page.evaluate(
        "() => (window.app.settings.find(s => s.key === 'zeroAmountPolicy') || {}).value"
    ) == 'block'
