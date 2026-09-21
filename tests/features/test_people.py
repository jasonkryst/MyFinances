#!/usr/bin/env python3
"""
Person / Family Member Tests (issue #203)
Tests CRUD operations, debt/income linking, per-person utilization on Health page,
and data persistence across page reloads.
"""

import pytest


# ── Helpers ──────────────────────────────────────────────────────────────────

def _nav_people(page):
    page.click('button[data-page="people"]')
    page.wait_for_selector('#peopleSection.active', timeout=5000)


def _add_person(page, name):
    _nav_people(page)
    page.fill('#personName', name)
    page.click('#personFormSubmit')
    page.wait_for_selector(f'#peopleList >> text={name}', timeout=5000)


def _nav_income(page):
    page.click('button[data-page="income"]')
    page.wait_for_selector('#incomeSection.active', timeout=5000)


def _nav_debts(page):
    page.click('button[data-page="liabilities"]')
    page.wait_for_selector('#liabilitiesSection.active', timeout=5000)


def _nav_health(page):
    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)


def _open_debt_form(page):
    toggle = page.query_selector('#debtFormToggle')
    if toggle:
        expanded = toggle.get_attribute('aria-expanded')
        if expanded == 'false':
            toggle.click()
            page.wait_for_selector('#debtFormBody:not([hidden])', timeout=3000)


# ── Positive tests ────────────────────────────────────────────────────────────

@pytest.mark.feature
def test_add_person(app_page):
    """A new person appears in the People list after submission."""
    page = app_page
    _add_person(page, 'Alice')
    assert page.query_selector('#peopleList >> text=Alice'), "Person not shown after add"


@pytest.mark.feature
def test_add_multiple_persons(app_page):
    """Multiple persons can be added and all appear in the list."""
    page = app_page
    for name in ('Alice', 'Bob', 'Charlie'):
        _add_person(page, name)
    list_text = page.inner_text('#peopleList')
    for name in ('Alice', 'Bob', 'Charlie'):
        assert name in list_text, f"{name} missing from people list"


@pytest.mark.feature
def test_edit_person(app_page):
    """Editing a person's name updates the list."""
    page = app_page
    _add_person(page, 'OriginalName')

    edit_btn = page.query_selector('#peopleList .btn-edit')
    assert edit_btn, "Edit button not found"
    edit_btn.click()

    page.fill('[id^="pe-name-"]', 'UpdatedName')
    page.click('[data-person-action="save"]')
    page.wait_for_selector('#peopleList >> text=UpdatedName', timeout=5000)
    assert page.query_selector('#peopleList >> text=UpdatedName'), "Updated name not shown"
    assert not page.query_selector('#peopleList >> text=OriginalName'), "Old name still visible"


@pytest.mark.feature
def test_delete_person_no_debts(app_page):
    """Deleting a person with no linked debts removes them from the list."""
    page = app_page
    _add_person(page, 'ToDelete')
    delete_btn = page.query_selector('#peopleList [data-person-action="delete"]')
    assert delete_btn, "Delete button not found"
    delete_btn.click()
    # confirm via delete-confirm modal
    page.wait_for_selector('#deleteConfirmModal:not(.hidden)', timeout=3000)
    page.click('#deleteConfirmBtn')
    page.wait_for_timeout(500)
    assert not page.query_selector('#peopleList >> text=ToDelete'), "Person still visible after delete"


@pytest.mark.feature
def test_person_persists_after_reload(app_page):
    """A person added survives a page reload (localStorage persistence)."""
    page = app_page
    _add_person(page, 'PersistMe')
    page.reload()
    page.wait_for_selector('#healthSection.active', timeout=5000)
    _nav_people(page)
    assert page.query_selector('#peopleList >> text=PersistMe'), "Person lost after reload"


@pytest.mark.feature
def test_income_links_to_person(app_page):
    """An income source can be linked to a person and appears in the person's annual income."""
    page = app_page
    _add_person(page, 'Earner')
    _nav_income(page)
    page.fill('#incomeName', 'Salary')
    page.fill('#incomeAmount', '5000')
    page.fill('#incomeFirstDate', '2026-01-01')
    page.select_option('#incomeFrequency', 'monthly')
    # link to person
    page.select_option('#incomePerson', label='Earner')
    page.click('#incomeFormSubmit')
    page.wait_for_selector('#incomeList >> text=Salary', timeout=5000)

    # Navigate to People to verify the annual income shows
    _nav_people(page)
    card_text = page.inner_text('#peopleList')
    # $5,000/month × 12 = $60,000/year
    assert 'Earner' in card_text
    assert '60,000' in card_text or '$60' in card_text, "Annual income not reflected in person card"


@pytest.mark.feature
def test_debt_links_to_person(app_page):
    """A debt can be associated with a person, and the debt count shows in the person card."""
    page = app_page
    _add_person(page, 'Debtor')
    _nav_debts(page)
    _open_debt_form(page)
    page.fill('#debtName', 'Car Loan')
    page.fill('#accountBalance', '10000')
    page.fill('#interestRate', '5')
    page.fill('#minimumPayment', '200')
    # select person
    page.select_option('#debtPersons', label='Debtor')
    page.click('#debtFormSubmit')
    page.wait_for_selector('#debtList >> text=Car Loan', timeout=5000)

    _nav_people(page)
    card_text = page.inner_text('#peopleList')
    assert 'Debtor' in card_text
    assert '1 debt' in card_text, "Debt count not reflected in person card"


@pytest.mark.feature
def test_health_credit_util_per_person(app_page):
    """The Health page credit utilization card shows per-person rows when persons exist."""
    page = app_page
    _add_person(page, 'UtilPerson')
    _nav_debts(page)
    _open_debt_form(page)
    page.fill('#debtName', 'VISA')
    page.select_option('#debtType', value='creditCard')
    page.fill('#accountBalance', '2000')
    page.fill('#creditLimit', '10000')
    page.fill('#interestRate', '19')
    page.fill('#minimumPayment', '50')
    page.select_option('#debtPersons', label='UtilPerson')
    page.click('#debtFormSubmit')
    page.wait_for_selector('#debtList >> text=VISA', timeout=5000)

    _nav_health(page)
    page.wait_for_selector('#healthCreditUtilCard', timeout=5000)
    card_text = page.inner_text('#healthCreditUtilCard')
    assert 'UtilPerson' in card_text, "Person not shown in credit utilization card"
    assert '20%' in card_text, "Expected 20% utilization (2000/10000)"


@pytest.mark.feature
def test_person_zero_util_no_cc_debts(app_page):
    """A person with no credit card debts shows 0% utilization."""
    page = app_page
    _add_person(page, 'NoCCPerson')
    _nav_health(page)
    page.wait_for_selector('#healthCreditUtilCard', timeout=5000)
    card_text = page.inner_text('#healthCreditUtilCard')
    assert 'NoCCPerson' in card_text
    assert '0%' in card_text, "Expected 0% for person with no CC debts"


# ── Negative / validation tests ───────────────────────────────────────────────

@pytest.mark.feature
def test_add_person_empty_name(app_page):
    """Submitting a person form with an empty name shows an alert, not a blank card."""
    page = app_page
    _nav_people(page)
    # do NOT fill the name field
    page.click('#personFormSubmit')
    page.wait_for_selector('#alertModal:not(.hidden)', timeout=3000)
    assert page.query_selector('#alertModal:not(.hidden)'), "Alert not shown for empty name"
    page.click('#alertModalOkBtn')


@pytest.mark.feature
def test_add_person_name_too_long(app_page):
    """A name exceeding 80 chars is silently truncated (sanitizer clamps it)."""
    page = app_page
    long_name = 'A' * 100
    _nav_people(page)
    page.fill('#personName', long_name)
    page.click('#personFormSubmit')
    page.wait_for_selector('#peopleList .income-card', timeout=5000)
    # Should be stored as truncated (80 chars)
    card_text = page.inner_text('#peopleList')
    # The stored name is max 80 'A's — the card renders something starting with 'A'
    assert 'A' in card_text, "Truncated name not shown"
    assert len([c for c in card_text if c == 'A']) <= 80, "Name not truncated to 80 chars"


@pytest.mark.feature
def test_cancel_edit_person(app_page):
    """Cancelling an edit restores the original name."""
    page = app_page
    _add_person(page, 'OrigName')
    edit_btn = page.query_selector('#peopleList .btn-edit')
    edit_btn.click()
    page.fill('[id^="pe-name-"]', 'ChangedName')
    page.click('[data-person-action="cancel"]')
    page.wait_for_timeout(300)
    assert page.query_selector('#peopleList >> text=OrigName'), "Original name not restored after cancel"
    assert not page.query_selector('#peopleList >> text=ChangedName'), "Changed name persisted after cancel"


@pytest.mark.feature
def test_delete_person_with_linked_debts_shows_reassignment_modal(app_page):
    """Deleting a person linked to a debt shows the person replacement modal."""
    page = app_page
    _add_person(page, 'DebtOwner')
    _nav_debts(page)
    _open_debt_form(page)
    page.fill('#debtName', 'Linked Debt')
    page.fill('#accountBalance', '5000')
    page.fill('#interestRate', '7')
    page.fill('#minimumPayment', '100')
    page.select_option('#debtPersons', label='DebtOwner')
    page.click('#debtFormSubmit')
    page.wait_for_selector('#debtList >> text=Linked Debt', timeout=5000)

    _nav_people(page)
    delete_btn = page.query_selector('#peopleList [data-person-action="delete"]')
    delete_btn.click()
    page.wait_for_selector('#personReplacementModal:not(.hidden)', timeout=3000)
    assert page.query_selector('#personReplacementModal:not(.hidden)'), "Person replacement modal not shown"
    # Cancel to avoid deleting
    page.click('#personReplacementCancelBtn')


@pytest.mark.feature
def test_people_page_nav(app_page):
    """The People page is reachable via the nav button."""
    page = app_page
    _nav_people(page)
    assert page.query_selector('#peopleSection.active'), "People section not active after nav"
