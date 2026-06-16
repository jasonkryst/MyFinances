#!/usr/bin/env python3
"""
Recurring Template Action Tests
Tests pause/resume, skip/unskip, and inline edit flows for recurring templates.
"""

import pytest


def _seed_recurring_template(page):
    """Create an account and a single recurring subscription template."""
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 6101, name: 'Recurring Actions', type: 'Checking', startingBalance: 1000 }];
        app.recurringTemplates = [{
            id: 90, name: 'Streaming', type: 'subscription', amount: 15,
            frequency: 'monthly', dayOfMonth: 1, category: 'Subscription',
            accountId: 6101, targetAccountId: null,
            startDate: '2026-01-01', endDate: null,
            paused: false, skippedMonths: []
        }];
        app.incomes = []; app.bills = []; app.expenses = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.refreshRecurringAccountSelectors();
        app.switchPage('recurring');
    }""")
    page.wait_for_timeout(300)


@pytest.mark.ui
def test_recurring_pause_and_resume(app_page):
    """Test pausing and resuming a recurring template."""
    page = app_page
    _seed_recurring_template(page)

    pause_btn = page.query_selector('[data-recurring-action="pause"][data-recurring-id="90"]')
    assert pause_btn, "Expected a Pause button on an active template"
    pause_btn.click()
    page.wait_for_timeout(300)

    badge_text = page.evaluate('() => document.querySelector("#recurringList .recurring-badge")?.textContent || ""')
    assert 'Paused' in badge_text, "Template should show a Paused badge after pausing"

    resume_btn = page.query_selector('[data-recurring-action="unpause"][data-recurring-id="90"]')
    assert resume_btn, "Expected a Resume button after pausing"
    resume_btn.click()
    page.wait_for_timeout(300)

    badge_text = page.evaluate('() => document.querySelector("#recurringList .recurring-badge")?.textContent || ""')
    assert 'Paused' not in badge_text, "Template should no longer show a Paused badge after resuming"
    assert page.query_selector('[data-recurring-action="pause"][data-recurring-id="90"]'), \
        "Expected a Pause button again after resuming"


@pytest.mark.ui
def test_recurring_skip_and_unskip_month(app_page):
    """Test skipping and unskipping the current month for a recurring template."""
    page = app_page
    _seed_recurring_template(page)

    skip_btn = page.query_selector('[data-recurring-action="skip"][data-recurring-id="90"]')
    assert skip_btn, "Expected a Skip month button"
    skip_btn.click()
    page.wait_for_timeout(300)

    badge_text = page.evaluate('() => document.querySelector("#recurringList .recurring-badge")?.textContent || ""')
    assert 'Skipped' in badge_text, "Template should show a Skipped badge after skipping this month"

    unskip_btn = page.query_selector('[data-recurring-action="unskip"][data-recurring-id="90"]')
    assert unskip_btn, "Expected an Unskip button after skipping"
    unskip_btn.click()
    page.wait_for_timeout(300)

    badge_text = page.evaluate('() => document.querySelector("#recurringList .recurring-badge")?.textContent || ""')
    assert 'Skipped' not in badge_text, "Template should no longer show a Skipped badge after unskipping"
    assert page.query_selector('[data-recurring-action="skip"][data-recurring-id="90"]'), \
        "Expected a Skip month button again after unskipping"


@pytest.mark.ui
def test_recurring_inline_edit_and_save(app_page):
    """Test editing a recurring template's name and amount inline."""
    page = app_page
    _seed_recurring_template(page)

    edit_btn = page.query_selector('[data-recurring-action="edit"][data-recurring-id="90"]')
    assert edit_btn, "Expected an Edit button"
    edit_btn.click()
    page.wait_for_timeout(300)

    name_input = page.query_selector('#re-name-90')
    amount_input = page.query_selector('#re-amount-90')
    assert name_input and amount_input, "Inline edit fields should be present"

    page.fill('#re-name-90', 'Streaming Plus')
    page.fill('#re-amount-90', '20')

    save_btn = page.query_selector('[data-recurring-action="save"][data-recurring-id="90"]')
    assert save_btn, "Expected a Save button while editing"
    save_btn.click()
    page.wait_for_timeout(300)

    card_text = page.evaluate('() => document.querySelector("#recurringList .recurring-card-name")?.textContent || ""')
    assert card_text == 'Streaming Plus', "Edited name should be reflected in the card"

    amount_text = page.evaluate('() => document.querySelector("#recurringList .recurring-amount")?.textContent || ""')
    assert '20.00' in amount_text, "Edited amount should be reflected in the card"


@pytest.mark.ui
def test_recurring_mark_and_unmark_paid(app_page):
    """Test marking and unmarking the current month as paid for a recurring template."""
    page = app_page
    _seed_recurring_template(page)

    mark_btn = page.query_selector('[data-recurring-action="mark-paid"][data-recurring-id="90"]')
    assert mark_btn, "Expected a Mark as paid button"
    mark_btn.click()
    page.wait_for_timeout(300)

    badge_text = page.evaluate('() => document.querySelector("#recurringList .recurring-badge")?.textContent || ""')
    assert 'Paid this month' in badge_text, "Template should show a Paid this month badge after marking as paid"

    unmark_btn = page.query_selector('[data-recurring-action="unmark-paid"][data-recurring-id="90"]')
    assert unmark_btn, "Expected an Unmark paid button after marking as paid"
    unmark_btn.click()
    page.wait_for_timeout(300)

    badge_text = page.evaluate('() => document.querySelector("#recurringList .recurring-badge")?.textContent || ""')
    assert 'Paid this month' not in badge_text, "Template should no longer show a Paid this month badge after unmarking"
    assert page.query_selector('[data-recurring-action="mark-paid"][data-recurring-id="90"]'), \
        "Expected a Mark as paid button again after unmarking"
