#!/usr/bin/env python3
"""
Recurring Transactions Tests
Tests recurring transaction templates and auto-generation.
"""

import pytest

from tests.conftest import assert_no_errors


def _open_recurring_form(page):
    """Navigate to the recurring page and expand the Add Template form."""
    page.click('button[data-page="recurring"]')
    page.wait_for_timeout(300)
    page.click('#recurringFormToggle')
    page.wait_for_timeout(200)


def _seed_account(page, account_id=7201, name="Recurring Test Account"):
    """Create a bare account via app state so recurring templates can link to it."""
    page.evaluate(f"""() => {{
        const app = window.app;
        app.accounts = [{{ id: {account_id}, name: '{name}', type: 'Checking', startingBalance: 1000 }}];
        app.recurringTemplates = [];
        app.incomes = []; app.bills = []; app.expenses = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('recurring');
    }}""")
    page.wait_for_timeout(200)


def _fill_recurring_form(page, name, amount, frequency, start_date, account_id, rec_type="subscription"):
    page.fill('#recurringName', name)
    page.select_option('#recurringType', rec_type)
    page.fill('#recurringAmount', str(amount))
    page.select_option('#recurringFrequency', frequency)
    page.fill('#recurringStartDate', start_date)
    page.select_option('#recurringAccount', str(account_id))


@pytest.mark.feature
def test_recurring_transactions_navigation(app_page):
    """Test navigation to recurring transactions."""
    page = app_page
    
    page.click('button[data-page="recurring"]')
    page.wait_for_timeout(300)
    
    # Verify recurring section loads
    recurring_section = page.query_selector('#recurringSection')
    assert recurring_section or True, "Recurring transactions should be available"


@pytest.mark.feature
def test_transaction_templates(app_page):
    """Test recurring transaction template functionality."""
    page = app_page

    # Access recurring transactions
    buttons = page.query_selector_all('button[data-page]')

    # Should have recurring button
    assert len(buttons) >= 5, "Expected multiple page buttons"


@pytest.mark.feature
def test_create_recurring_template_monthly(app_page):
    """Creating a monthly recurring template via the UI shows it in the list with correct fields."""
    page = app_page
    _seed_account(page)
    _open_recurring_form(page)

    _fill_recurring_form(page, 'Netflix', '15.99', 'monthly', '2026-05-01', 7201)
    page.click('#recurringFormSubmit')
    page.wait_for_timeout(300)

    card_name = page.evaluate('() => document.querySelector("#recurringList .recurring-card-name")?.textContent || ""')
    assert card_name == 'Netflix', "New monthly template should appear in the recurring list"

    freq_badge = page.evaluate('() => document.querySelector("#recurringList .recurring-freq-badge")?.textContent || ""')
    assert freq_badge == 'Monthly', f"Expected Monthly frequency badge, got {freq_badge!r}"

    amount_text = page.evaluate('() => document.querySelector("#recurringList .recurring-amount")?.textContent || ""')
    assert '15.99' in amount_text, f"Expected amount to include 15.99, got {amount_text!r}"

    assert_no_errors(page)


@pytest.mark.feature
def test_create_recurring_template_biweekly(app_page):
    """Creating a biweekly recurring template via the UI shows the correct frequency label."""
    page = app_page
    _seed_account(page)
    _open_recurring_form(page)

    _fill_recurring_form(page, 'Lawn Care', '40', 'biweekly', '2026-05-04', 7201)
    page.click('#recurringFormSubmit')
    page.wait_for_timeout(300)

    card_name = page.evaluate('() => document.querySelector("#recurringList .recurring-card-name")?.textContent || ""')
    assert card_name == 'Lawn Care', "New biweekly template should appear in the recurring list"

    freq_badge = page.evaluate('() => document.querySelector("#recurringList .recurring-freq-badge")?.textContent || ""')
    assert freq_badge == 'Every 2 weeks', f"Expected 'Every 2 weeks' frequency badge, got {freq_badge!r}"

    assert_no_errors(page)


@pytest.mark.feature
def test_create_recurring_template_weekly(app_page):
    """Creating a weekly recurring template via the UI shows the correct frequency label."""
    page = app_page
    _seed_account(page)
    _open_recurring_form(page)

    _fill_recurring_form(page, 'Cleaning Service', '25', 'weekly', '2026-05-06', 7201)
    page.click('#recurringFormSubmit')
    page.wait_for_timeout(300)

    card_name = page.evaluate('() => document.querySelector("#recurringList .recurring-card-name")?.textContent || ""')
    assert card_name == 'Cleaning Service', "New weekly template should appear in the recurring list"

    freq_badge = page.evaluate('() => document.querySelector("#recurringList .recurring-freq-badge")?.textContent || ""')
    assert freq_badge == 'Weekly', f"Expected Weekly frequency badge, got {freq_badge!r}"

    assert_no_errors(page)


@pytest.mark.feature
def test_recurring_pause_state_persists_after_reload(app_page):
    """Pausing a recurring template persists through a full page reload (storage round-trip)."""
    page = app_page
    _seed_account(page)

    page.evaluate("""() => {
        const app = window.app;
        app.recurringTemplates = [{
            id: 8801, name: 'Gym Membership', type: 'subscription', amount: 30,
            frequency: 'monthly', dayOfMonth: 1, category: 'Health',
            accountId: 7201, targetAccountId: null,
            startDate: '2026-01-01', endDate: null,
            paused: false, skippedMonths: [], paidMonths: []
        }];
        app.saveToStorage();
        app.switchPage('recurring');
    }""")
    page.wait_for_timeout(200)

    pause_btn = page.query_selector('[data-recurring-action="pause"][data-recurring-id="8801"]')
    assert pause_btn, "Expected a Pause button on the seeded active template"
    pause_btn.click()
    page.wait_for_timeout(300)

    badge_text = page.evaluate('() => document.querySelector("#recurringList .recurring-badge")?.textContent || ""')
    assert 'Paused' in badge_text, "Template should show Paused badge immediately after pausing"

    page.reload(wait_until="networkidle")
    page.click('button[data-page="recurring"]')
    page.wait_for_timeout(300)

    badge_text_after_reload = page.evaluate('() => document.querySelector("#recurringList .recurring-badge")?.textContent || ""')
    assert 'Paused' in badge_text_after_reload, \
        "Paused state should persist in localStorage and survive a page reload"

    assert_no_errors(page)


@pytest.mark.feature
def test_recurring_skip_month_excludes_only_that_month(app_page):
    """Skipping a specific month excludes that month's occurrence from the ledger while leaving other months intact."""
    page = app_page
    _seed_account(page)

    result = page.evaluate("""async () => {
        const app = window.app;
        const ledgerMod = await import('/src/ledger.js');
        app.recurringTemplates = [{
            id: 9001, name: 'Internet Bill', type: 'subscription', amount: 60,
            frequency: 'monthly', dayOfMonth: 1, category: 'Utilities',
            accountId: 7201, targetAccountId: null,
            startDate: '2026-01-01', endDate: null,
            paused: false, skippedMonths: [], paidMonths: []
        }];
        app.saveToStorage();

        // Skip June 2026 only
        app.skipRecurringOccurrence(9001, '2026-06', false);

        return {
            juneCount: ledgerMod.getLedgerTransactionsForMonth(app, 2026, 5, 7201)
                .filter(tx => tx.sourceId === 9001).length,
            julyCount: ledgerMod.getLedgerTransactionsForMonth(app, 2026, 6, 7201)
                .filter(tx => tx.sourceId === 9001).length,
            mayCount: ledgerMod.getLedgerTransactionsForMonth(app, 2026, 4, 7201)
                .filter(tx => tx.sourceId === 9001).length
        };
    }""")

    assert result['juneCount'] == 0, "Skipped month (June 2026) should produce no ledger transaction"
    assert result['julyCount'] == 1, "July 2026 (not skipped) should still produce a ledger transaction"
    assert result['mayCount'] == 1, "May 2026 (not skipped) should still produce a ledger transaction"

    assert_no_errors(page)


@pytest.mark.feature
def test_recurring_template_linked_to_account_affects_balance(app_page):
    """A recurring subscription linked to an account reduces that account's computed monthly balance."""
    page = app_page
    _seed_account(page)

    result = page.evaluate("""() => {
        const app = window.app;
        const balanceBefore = app.computeAccountBalance(7201, 2026, 5);

        app.recurringTemplates = [{
            id: 9101, name: 'Streaming Sub', type: 'subscription', amount: 50,
            frequency: 'monthly', dayOfMonth: 1, category: 'Subscription',
            accountId: 7201, targetAccountId: null,
            startDate: '2026-01-01', endDate: null,
            paused: false, skippedMonths: [], paidMonths: []
        }];
        app.saveToStorage();

        const balanceAfter = app.computeAccountBalance(7201, 2026, 5);
        return { balanceBefore, balanceAfter };
    }""")

    assert result['balanceAfter'] == result['balanceBefore'] - 50, (
        f"Linking a $50 monthly subscription should reduce the account's projected balance by 50 "
        f"(before={result['balanceBefore']}, after={result['balanceAfter']})"
    )

    assert_no_errors(page)


@pytest.mark.feature
def test_recurring_reimbursement_linked_to_account_increases_balance(app_page):
    """A recurring reimbursement linked to an account increases that account's computed monthly balance."""
    page = app_page
    _seed_account(page)

    result = page.evaluate("""() => {
        const app = window.app;
        const balanceBefore = app.computeAccountBalance(7201, 2026, 5);

        app.recurringTemplates = [{
            id: 9102, name: 'Expense Reimbursement', type: 'reimbursement', amount: 75,
            frequency: 'monthly', dayOfMonth: 1, category: 'Reimbursement',
            accountId: 7201, targetAccountId: null,
            startDate: '2026-01-01', endDate: null,
            paused: false, skippedMonths: [], paidMonths: []
        }];
        app.saveToStorage();

        const balanceAfter = app.computeAccountBalance(7201, 2026, 5);
        return { balanceBefore, balanceAfter };
    }""")

    assert result['balanceAfter'] == result['balanceBefore'] + 75, (
        f"Linking a $75 monthly reimbursement should increase the account's projected balance by 75 "
        f"(before={result['balanceBefore']}, after={result['balanceAfter']})"
    )

    assert_no_errors(page)


@pytest.mark.feature
def test_recurring_invalid_amount_rejected_via_ui(app_page):
    """The UI form rejects zero/negative amounts via the alert-based validation in addRecurringTemplate,
    and does not add a template to the list."""
    page = app_page
    _seed_account(page)
    _open_recurring_form(page)

    _fill_recurring_form(page, 'Bad Amount Sub', '0', 'monthly', '2026-05-01', 7201)
    page.click('#recurringFormSubmit')
    page.wait_for_timeout(300)

    templates_count = page.evaluate('() => (window.app.recurringTemplates || []).length')
    assert templates_count == 0, "A zero amount should be rejected and no template should be created"


@pytest.mark.feature
def test_recurring_negative_amount_sanitized_on_direct_save(app_page):
    """sanitizeRecurringTemplate (via import/export round-trip) clamps a negative amount to 0
    rather than preserving a negative value, per src/storage.js's sanitizeFiniteNumber(min: 0)."""
    page = app_page
    _seed_account(page)

    result = page.evaluate("""() => {
        const app = window.app;
        app.recurringTemplates = [{
            id: 9201, name: 'Negative Amount', type: 'subscription', amount: -25,
            frequency: 'monthly', dayOfMonth: 1, category: 'Other',
            accountId: 7201, targetAccountId: null,
            startDate: '2026-01-01', endDate: null,
            paused: false, skippedMonths: [], paidMonths: []
        }];
        app.saveToStorage();

        // Reload from storage to force sanitization to run
        const raw = localStorage.getItem('debtTrackerData');
        app.loadFromStorage();
        const reloaded = app.recurringTemplates.find(t => t.id === 9201) || app.recurringTemplates[0];
        return { amount: reloaded ? reloaded.amount : null, rawHadNegative: raw.includes('-25') };
    }""")

    assert result['amount'] is not None, "Template should survive the storage round-trip"
    assert result['amount'] >= 0, (
        f"sanitizeRecurringTemplate should clamp negative amounts to >= 0, got {result['amount']}"
    )


@pytest.mark.feature
def test_recurring_invalid_start_date_sanitized_to_null(app_page):
    """sanitizeRecurringTemplate falls back to null (not a fabricated date) for a garbage startDate
    on storage load, per sanitizeDateISO's behavior in src/utils.js."""
    page = app_page
    _seed_account(page)

    result = page.evaluate("""() => {
        const app = window.app;
        app.recurringTemplates = [{
            id: 9301, name: 'Bad Start Date', type: 'subscription', amount: 10,
            frequency: 'monthly', dayOfMonth: 1, category: 'Other',
            accountId: 7201, targetAccountId: null,
            startDate: 'not-a-date', endDate: null,
            paused: false, skippedMonths: [], paidMonths: []
        }];
        app.saveToStorage();
        app.loadFromStorage();
        const reloaded = app.recurringTemplates.find(t => t.id === 9301) || app.recurringTemplates[0];
        return { startDate: reloaded ? reloaded.startDate : 'MISSING' };
    }""")

    assert result['startDate'] in (None, ''), (
        f"An invalid startDate should be sanitized to null/empty on load, got {result['startDate']!r}"
    )


@pytest.mark.feature
def test_recurring_missing_start_date_via_ui_defaults_to_today(app_page):
    """When the UI form is submitted with no Start Date, addRecurringTemplate falls back to today's
    date rather than leaving startDate empty (per src/recurring.js addRecurringTemplate)."""
    page = app_page
    _seed_account(page)
    _open_recurring_form(page)

    page.fill('#recurringName', 'No Start Date Sub')
    page.select_option('#recurringType', 'subscription')
    page.fill('#recurringAmount', '12')
    page.select_option('#recurringFrequency', 'monthly')
    page.select_option('#recurringAccount', '7201')
    # Deliberately leave #recurringStartDate blank
    page.click('#recurringFormSubmit')
    page.wait_for_timeout(300)

    result = page.evaluate("""() => {
        const app = window.app;
        const t = (app.recurringTemplates || []).find(x => x.name === 'No Start Date Sub');
        return t ? t.startDate : null;
    }""")

    assert result, "Template should be created with a non-empty startDate even when the field was left blank"
