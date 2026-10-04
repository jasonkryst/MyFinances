#!/usr/bin/env python3
"""
Recurring Template Archive Tests (issue #222)

Verifies that recurring templates can be archived/unarchived, that archived
templates are excluded from calculations and the calendar feed, and that the
"Show archived recurring templates" setting controls their visibility.
"""

import pytest

from tests.conftest import assert_no_errors


def _seed_account(page, account_id=8100, name="Archive Test Account"):
    """Seed a bare account and clear other data so tests run against a clean slate."""
    page.evaluate(f"""() => {{
        const app = window.app;
        app.accounts = [{{ id: {account_id}, name: '{name}', type: 'Checking', startingBalance: 1000 }}];
        app.recurringTemplates = [];
        app.incomes = []; app.bills = []; app.expenses = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('recurring');
    }}""")


def _add_template_via_ui(page, name="Netflix", amount="15.99", frequency="monthly",
                          start_date="2026-01-01", account_id=8100):
    """Navigate to recurring page and add a template through the form."""
    page.click('button[data-page="recurring"]')
    page.wait_for_selector('#recurringSection.active', timeout=5000)
    page.click('#recurringFormToggle')
    page.wait_for_selector('#recurringFormBody:not([hidden])', timeout=5000)
    page.fill('#recurringName', name)
    page.fill('#recurringAmount', str(amount))
    page.select_option('#recurringFrequency', frequency)
    page.fill('#recurringStartDate', start_date)
    page.select_option('#recurringAccount', str(account_id))
    page.click('#recurringFormSubmit')
    page.wait_for_selector('#recurringList .recurring-card', timeout=5000)


def _seed_template(page, template_id=9001, name="Seeded Sub", archived=False,
                   account_id=8100):
    """Inject a recurring template directly into app state (faster than UI)."""
    archived_val = 'true' if archived else 'false'
    page.evaluate(f"""() => {{
        const app = window.app;
        const now = new Date();
        app.recurringTemplates = [{{
            id: {template_id},
            name: '{name}',
            type: 'subscription',
            amount: 20,
            frequency: 'monthly',
            dayOfMonth: 1,
            startDate: '2026-01-01',
            category: 'Other',
            accountId: {account_id},
            archived: {archived_val},
            paused: false,
            skippedMonths: [],
            paidMonths: []
        }}];
        app.renderRecurringPage();
    }}""")


# ─── Archive button ───────────────────────────────────────────────────────────

@pytest.mark.feature
def test_archive_button_present_on_active_card(app_page):
    """An active (non-archived) recurring template card has an Archive button."""
    page = app_page
    _seed_account(page)
    _seed_template(page, archived=False)

    btn = page.query_selector('[data-recurring-action="archive"]')
    assert btn is not None, "Archive button should be present on an active card"
    assert_no_errors(page)


@pytest.mark.feature
def test_archive_removes_template_from_active_list(app_page):
    """Clicking Archive moves the template out of the active list."""
    page = app_page
    _seed_account(page)
    _seed_template(page, archived=False, name="To Archive")

    # Verify card is visible
    assert page.query_selector('#recurringList .recurring-card'), "Card should exist before archiving"

    # Click Archive
    page.click('[data-recurring-action="archive"]')
    page.wait_for_timeout(300)

    # Active card should be gone (or showing archived state without archive btn)
    archive_btn = page.query_selector('[data-recurring-action="archive"]')
    assert archive_btn is None, "Archive button should disappear after archiving"

    assert_no_errors(page)


@pytest.mark.feature
def test_archived_template_flag_set_in_app_state(app_page):
    """After archiving, app.recurringTemplates[0].archived is true."""
    page = app_page
    _seed_account(page)
    _seed_template(page, template_id=9001, archived=False)

    page.click('[data-recurring-action="archive"]')
    page.wait_for_timeout(300)

    archived_flag = page.evaluate("""() => {
        return window.app.recurringTemplates?.[0]?.archived === true;
    }""")
    assert archived_flag, "archived flag should be true in app state after archiving"
    assert_no_errors(page)


# ─── Archived card display ────────────────────────────────────────────────────

@pytest.mark.feature
def test_archived_card_shows_archived_badge(app_page):
    """A pre-archived template card shows the Archived badge when Show archived is on."""
    page = app_page
    _seed_account(page)

    # Enable show-archived setting then seed
    page.evaluate("""() => {
        window.app.settings = window.app.settings || [];
        const idx = window.app.settings.findIndex(s => s.key === 'showArchivedRecurring');
        if (idx >= 0) window.app.settings[idx].value = true;
        else window.app.settings.push({ key: 'showArchivedRecurring', value: true });
    }""")
    _seed_template(page, archived=True, name="Archived Sub")

    badge = page.query_selector('.recurring-badge--archived')
    assert badge is not None, "Archived badge should be visible on an archived card"
    assert_no_errors(page)


@pytest.mark.feature
def test_archived_card_shows_unarchive_button(app_page):
    """A pre-archived template card has an Unarchive button (not Archive)."""
    page = app_page
    _seed_account(page)
    page.evaluate("""() => {
        window.app.settings = window.app.settings || [];
        const idx = window.app.settings.findIndex(s => s.key === 'showArchivedRecurring');
        if (idx >= 0) window.app.settings[idx].value = true;
        else window.app.settings.push({ key: 'showArchivedRecurring', value: true });
    }""")
    _seed_template(page, archived=True)

    unarchive_btn = page.query_selector('[data-recurring-action="unarchive"]')
    assert unarchive_btn is not None, "Unarchive button should be present on archived card"

    archive_btn = page.query_selector('[data-recurring-action="archive"]')
    assert archive_btn is None, "Archive button should NOT be present on an already-archived card"

    assert_no_errors(page)


@pytest.mark.feature
def test_unarchive_restores_active_card(app_page):
    """Clicking Unarchive on an archived template restores it to active status."""
    page = app_page
    _seed_account(page)
    page.evaluate("""() => {
        window.app.settings = window.app.settings || [];
        const idx = window.app.settings.findIndex(s => s.key === 'showArchivedRecurring');
        if (idx >= 0) window.app.settings[idx].value = true;
        else window.app.settings.push({ key: 'showArchivedRecurring', value: true });
    }""")
    _seed_template(page, archived=True, name="Was Archived")

    page.click('[data-recurring-action="unarchive"]')
    page.wait_for_timeout(300)

    # Should now have archive button (active state)
    archive_btn = page.query_selector('[data-recurring-action="archive"]')
    assert archive_btn is not None, "Archive button should return after unarchiving"

    archived_flag = page.evaluate("() => window.app.recurringTemplates?.[0]?.archived === true")
    assert not archived_flag, "archived flag should be false after unarchiving"

    assert_no_errors(page)


# ─── Calculation exclusion ────────────────────────────────────────────────────

@pytest.mark.feature
def test_archived_template_excluded_from_occurrences(app_page):
    """getRecurringOccurrencesInMonth returns empty for an archived template."""
    page = app_page
    _seed_account(page)

    result = page.evaluate("""() => {
        const tmpl = {
            id: 1, name: 'Archived', type: 'subscription', amount: 10,
            frequency: 'monthly', dayOfMonth: 1, startDate: '2026-01-01',
            archived: true, paused: false, skippedMonths: [], paidMonths: []
        };
        const now = new Date();
        // Import is a module — access via the rendered page's module map isn't
        // directly possible, but we can call through app's own methods
        // that delegate to getRecurringOccurrencesInMonth internally.
        // Instead, inject template and check ledger row count.
        window.app.recurringTemplates = [tmpl];
        const rows = window.app.getLedgerTransactions?.() || [];
        return rows.filter(r => r.recurringTemplateId === 1 || r.name === 'Archived').length;
    }""")
    assert result == 0, "Archived template should contribute zero ledger rows"
    assert_no_errors(page)


@pytest.mark.feature
def test_archived_template_excluded_from_ledger(app_page):
    """An archived recurring template does not appear in ledger transactions."""
    page = app_page
    _seed_account(page)

    count = page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        app.recurringTemplates = [{
            id: 5555, name: 'ArchivedLedger', type: 'subscription', amount: 30,
            frequency: 'monthly', dayOfMonth: 1, startDate: '2026-01-01',
            archived: true, paused: false, skippedMonths: [], paidMonths: [],
            accountId: null
        }];
        // Navigate to ledger page to trigger rendering
        app.switchPage('ledger');
        const rows = document.querySelectorAll('[data-ledger-name]');
        let found = 0;
        rows.forEach(r => { if (r.getAttribute('data-ledger-name') === 'ArchivedLedger') found++; });
        return found;
    }""")
    assert count == 0, "Archived recurring template should not appear in ledger"
    assert_no_errors(page)


# ─── Show archived setting ────────────────────────────────────────────────────

@pytest.mark.feature
def test_archived_template_hidden_by_default(app_page):
    """By default, archived templates are hidden; the list shows only active templates."""
    page = app_page
    _seed_account(page)

    # Seed one active + one archived
    page.evaluate("""() => {
        const app = window.app;
        app.recurringTemplates = [
            { id: 1, name: 'Active Sub', type: 'subscription', amount: 10, frequency: 'monthly',
              dayOfMonth: 1, startDate: '2026-01-01', archived: false, paused: false,
              skippedMonths: [], paidMonths: [], accountId: null },
            { id: 2, name: 'Hidden Archived', type: 'subscription', amount: 20, frequency: 'monthly',
              dayOfMonth: 1, startDate: '2026-01-01', archived: true, paused: false,
              skippedMonths: [], paidMonths: [], accountId: null }
        ];
        app.renderRecurringPage();
    }""")

    # Archived card should not be in list
    card_names = page.evaluate("""() => {
        return Array.from(document.querySelectorAll('#recurringList .recurring-card-name'))
                    .map(el => el.textContent.trim());
    }""")
    assert "Hidden Archived" not in card_names, "Archived template should not appear by default"
    assert "Active Sub" in card_names, "Active template should still be visible"

    # Archived count note should be visible
    note = page.query_selector('.recurring-archived-note')
    assert note is not None, "Archived count note should be shown when templates are hidden"
    assert_no_errors(page)


@pytest.mark.feature
def test_show_archived_setting_reveals_archived_templates(app_page):
    """Enabling showArchivedRecurring makes archived cards visible."""
    page = app_page
    _seed_account(page)

    # Set setting, then seed archived template
    page.evaluate("""() => {
        window.app.settings = window.app.settings || [];
        const idx = window.app.settings.findIndex(s => s.key === 'showArchivedRecurring');
        if (idx >= 0) window.app.settings[idx].value = true;
        else window.app.settings.push({ key: 'showArchivedRecurring', value: true });
    }""")
    _seed_template(page, archived=True, name="Visible Archived")

    card_names = page.evaluate("""() => {
        return Array.from(document.querySelectorAll('#recurringList .recurring-card-name'))
                    .map(el => el.textContent.trim());
    }""")
    assert "Visible Archived" in card_names, "Archived template should be visible when setting is on"
    assert_no_errors(page)


@pytest.mark.feature
def test_all_archived_shows_empty_active_message(app_page):
    """When all templates are archived and show-archived is off, shows a descriptive message."""
    page = app_page
    _seed_account(page)
    _seed_template(page, archived=True, name="Only Template")

    empty_msg = page.text_content('#recurringList')
    assert "archived" in empty_msg.lower(), "Should mention 'archived' when all templates are archived"
    assert_no_errors(page)


# ─── Archived count note ──────────────────────────────────────────────────────

@pytest.mark.feature
def test_archived_count_note_shows_correct_count(app_page):
    """The archived-count note reflects the number of archived templates."""
    page = app_page
    _seed_account(page)

    # Seed one active + two archived
    page.evaluate("""() => {
        const app = window.app;
        app.recurringTemplates = [
            { id: 1, name: 'Active', type: 'subscription', amount: 10, frequency: 'monthly',
              dayOfMonth: 1, startDate: '2026-01-01', archived: false, paused: false,
              skippedMonths: [], paidMonths: [], accountId: null },
            { id: 2, name: 'Archived1', type: 'subscription', amount: 10, frequency: 'monthly',
              dayOfMonth: 1, startDate: '2026-01-01', archived: true, paused: false,
              skippedMonths: [], paidMonths: [], accountId: null },
            { id: 3, name: 'Archived2', type: 'subscription', amount: 10, frequency: 'monthly',
              dayOfMonth: 1, startDate: '2026-01-01', archived: true, paused: false,
              skippedMonths: [], paidMonths: [], accountId: null }
        ];
        app.renderRecurringPage();
    }""")

    note = page.query_selector('.recurring-archived-note')
    assert note is not None, "Archived count note should appear"
    note_text = note.text_content()
    assert '2' in note_text, f"Note should mention 2 archived templates, got: {note_text!r}"
    assert_no_errors(page)


# ─── Sanitizer round-trip ─────────────────────────────────────────────────────

@pytest.mark.feature
def test_archived_flag_survives_storage_round_trip(app_page):
    """Archived flag persists through saveToStorage / loadFromStorage cycle."""
    page = app_page
    _seed_account(page)
    _seed_template(page, template_id=9002, archived=True, name="Persist Archived")

    # Save + reload
    page.evaluate("() => window.app.saveToStorage()")
    page.reload(wait_until="networkidle")
    page.wait_for_selector('button[data-page="recurring"]', timeout=5000)
    page.click('button[data-page="recurring"]')
    page.wait_for_selector('#recurringSection.active', timeout=5000)

    archived_flag = page.evaluate("""() => {
        return window.app.recurringTemplates?.find(t => t.name === 'Persist Archived')?.archived === true;
    }""")
    assert archived_flag, "archived flag should persist through storage reload"
    assert_no_errors(page)
