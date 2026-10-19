#!/usr/bin/env python3
"""
Tests for category datalist autocomplete on Recurring Templates and Expenses forms (issue #298).
Covers datalist presence, default option population, and free-text entry.
"""

import pytest

from tests.conftest import assert_no_errors


# ── Recurring templates form ────────────────────────────────────────────────────

@pytest.mark.feature
def test_recurring_category_input_is_text_with_datalist(app_page):
    """Recurring form #recurringCategory is an <input type=text> with list='categoryOptions'."""
    page = app_page
    page.click('button[data-page="recurring"]')
    page.wait_for_selector('#recurringSection.active', timeout=5000)

    cat_input = page.query_selector('#recurringCategory')
    assert cat_input, "#recurringCategory not found"

    tag = cat_input.evaluate('el => el.tagName.toLowerCase()')
    assert tag == 'input', f"Expected <input>, got <{tag}>"

    list_attr = cat_input.get_attribute('list')
    assert list_attr == 'categoryOptions', f"Expected list='categoryOptions', got '{list_attr}'"


@pytest.mark.feature
def test_category_datalist_exists_and_has_options(app_page):
    """#categoryOptions datalist exists and contains at least one <option>."""
    page = app_page
    page.click('button[data-page="recurring"]')
    page.wait_for_selector('#recurringSection.active', timeout=5000)
    page.wait_for_timeout(300)

    count = page.evaluate("() => document.getElementById('categoryOptions')?.options?.length ?? 0")
    assert count > 0, f"Expected options in #categoryOptions datalist, got {count}"


@pytest.mark.feature
def test_category_datalist_contains_common_categories(app_page):
    """Datalist contains common categories like 'Housing' and 'Food'."""
    page = app_page
    page.click('button[data-page="recurring"]')
    page.wait_for_selector('#recurringSection.active', timeout=5000)
    page.wait_for_timeout(300)

    values = page.evaluate("""
        () => Array.from(
            document.getElementById('categoryOptions')?.options ?? []
        ).map(o => o.value)
    """)
    assert 'Housing' in values, f"Expected 'Housing' in datalist, got: {values[:10]}"
    assert 'Food' in values or 'Food & Dining' in values, (
        f"Expected food category in datalist, got: {values[:10]}"
    )


@pytest.mark.feature
def test_recurring_category_accepts_free_text(app_page):
    """Free-text category value is saved and reflected after adding a recurring template."""
    page = app_page
    page.click('button[data-page="recurring"]')
    page.wait_for_selector('#recurringSection.active', timeout=5000)

    page.fill('#recurringName', 'Custom Cat Item')
    page.fill('#recurringAmount', '50')
    page.fill('#recurringCategory', 'MyCustomCategory')
    page.select_option('#recurringFrequency', 'monthly')
    page.click('#recurringFormSubmit')
    page.wait_for_timeout(500)

    saved_cat = page.evaluate("""
        () => (window.app.recurringTemplates || [])
            .find(t => t.name === 'Custom Cat Item')?.category
    """)
    assert saved_cat == 'MyCustomCategory', (
        f"Expected 'MyCustomCategory' saved, got '{saved_cat}'"
    )


@pytest.mark.feature
def test_recurring_category_free_text_appears_in_datalist(app_page):
    """After adding a template with a custom category, that category appears in the datalist."""
    page = app_page
    page.click('button[data-page="recurring"]')
    page.wait_for_selector('#recurringSection.active', timeout=5000)

    page.fill('#recurringName', 'UniqueCatItem')
    page.fill('#recurringAmount', '25')
    page.fill('#recurringCategory', 'UniqueCategoryXYZ')
    page.select_option('#recurringFrequency', 'monthly')
    page.click('#recurringFormSubmit')
    page.wait_for_timeout(500)

    values = page.evaluate("""
        () => Array.from(
            document.getElementById('categoryOptions')?.options ?? []
        ).map(o => o.value)
    """)
    assert 'UniqueCategoryXYZ' in values, (
        f"Expected newly added category in datalist, got: {values}"
    )


# ── Expenses form ──────────────────────────────────────────────────────────────

@pytest.mark.feature
def test_expense_category_input_is_text_with_datalist(app_page):
    """Expense form #expenseCategory is an <input type=text> with list='categoryOptions'."""
    page = app_page
    page.click('button[data-page="income"]')
    page.wait_for_selector('#incomeSection.active', timeout=5000)

    cat_input = page.query_selector('#expenseCategory')
    assert cat_input, "#expenseCategory not found"

    tag = cat_input.evaluate('el => el.tagName.toLowerCase()')
    assert tag == 'input', f"Expected <input>, got <{tag}>"

    list_attr = cat_input.get_attribute('list')
    assert list_attr == 'categoryOptions', f"Expected list='categoryOptions', got '{list_attr}'"


@pytest.mark.feature
def test_no_console_errors_with_category_datalist(app_page):
    """No JS errors when the category datalist is populated on the Recurring page."""
    page = app_page
    page.click('button[data-page="recurring"]')
    page.wait_for_selector('#recurringSection.active', timeout=5000)
    page.wait_for_timeout(300)
    assert_no_errors(page)
