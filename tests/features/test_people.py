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


def _create_account_then_nav_income(page):
    """Income requires an account — create one then navigate to Income."""
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)
    page.fill('#accountName', 'Test Account')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '1000')
    page.click('#accountFormSubmit')
    _nav_income(page)


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
    _create_account_then_nav_income(page)
    page.fill('#incomeName', 'Salary')
    page.fill('#incomeAmount', '5000')
    page.fill('#incomeFirstDate', '2026-01-01')
    page.select_option('#incomeFrequency', 'monthly')
    page.select_option('#incomeAccount', index=1)
    # link to person
    page.select_option('#incomePerson', label='Earner')
    page.click('#incomeFormSubmit')
    page.wait_for_selector('#incomeList >> text=Salary', timeout=10000)

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
    page.fill('#dueDate', '15')
    # select person
    page.select_option('#debtPersons', label='Debtor')
    page.click('#debtFormSubmit')
    page.wait_for_selector('#debtsList >> text=Car Loan', timeout=10000)

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
    page.fill('#dueDate', '15')
    page.select_option('#debtPersons', label='UtilPerson')
    page.click('#debtFormSubmit')
    page.wait_for_selector('#debtsList >> text=VISA', timeout=10000)

    _nav_health(page)
    page.wait_for_selector('#healthCreditUtilCard', timeout=5000)
    card_text = page.inner_text('#healthCreditUtilCard')
    assert 'UtilPerson' in card_text, "Person not shown in credit utilization card"
    assert '20%' in card_text, "Expected 20% utilization (2000/10000)"


@pytest.mark.feature
def test_person_zero_util_no_cc_debts(app_page):
    """Without CC debts, the per-person utilization section is not shown in the card.
    The per-person rows only render inside the hasUtilData branch (when at least one
    CC debt with a credit limit exists)."""
    page = app_page
    _add_person(page, 'NoCCPerson')
    _nav_health(page)
    page.wait_for_selector('#healthCreditUtilCard', timeout=5000)
    card_text = page.inner_text('#healthCreditUtilCard')
    # No CC debts → empty state shown, not per-person rows
    assert 'NoCCPerson' not in card_text, "Person should not appear in util card without CC debts"
    assert 'No credit limits' in card_text, "Should show empty state when no CC debts exist"


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
    # Check only the name element — KPI labels (e.g. "ANNUAL INCOME") also contain 'A',
    # so counting across the whole card text would exceed 80.
    name_text = page.inner_text('#peopleList .income-card-name')
    assert 'A' in name_text, "Truncated name not shown"
    assert len(name_text.strip()) <= 80, "Name not truncated to 80 chars"


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
    page.fill('#dueDate', '15')
    page.select_option('#debtPersons', label='DebtOwner')
    page.click('#debtFormSubmit')
    page.wait_for_selector('#debtsList >> text=Linked Debt', timeout=10000)

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


# ── Person association display tests ─────────────────────────────────────────

def _add_income_for_person(page, name, amount, person_label):
    _create_account_then_nav_income(page)
    page.fill('#incomeName', name)
    page.fill('#incomeAmount', str(amount))
    page.fill('#incomeFirstDate', '2026-01-01')
    page.select_option('#incomeFrequency', 'monthly')
    page.select_option('#incomeAccount', index=1)
    page.select_option('#incomePerson', label=person_label)
    page.click('#incomeFormSubmit')
    page.wait_for_selector(f'#incomeList >> text={name}', timeout=10000)


def _add_debt_for_person(page, name, balance, person_label):
    _nav_debts(page)
    _open_debt_form(page)
    page.fill('#debtName', name)
    page.fill('#accountBalance', str(balance))
    page.fill('#interestRate', '5')
    page.fill('#minimumPayment', '100')
    page.fill('#dueDate', '15')
    page.select_option('#debtPersons', label=person_label)
    page.click('#debtFormSubmit')
    page.wait_for_selector(f'#debtsList >> text={name}', timeout=10000)


@pytest.mark.feature
def test_debt_card_shows_person_pill(app_page):
    """A debt linked to a person shows a person pill on the read-only debt card."""
    page = app_page
    _add_person(page, 'PillPerson')
    _add_debt_for_person(page, 'Pill Debt', 5000, 'PillPerson')
    _nav_debts(page)
    card = page.query_selector('#debtsList .debt-card .person-pill')
    assert card, "person-pill not found on debt card"
    assert 'PillPerson' in card.inner_text(), "Person name not in pill"


@pytest.mark.feature
def test_debt_card_no_pill_without_person(app_page):
    """A debt not linked to any person shows no person pill."""
    page = app_page
    _nav_debts(page)
    _open_debt_form(page)
    page.fill('#debtName', 'No Person Debt')
    page.fill('#accountBalance', '1000')
    page.fill('#interestRate', '5')
    page.fill('#minimumPayment', '50')
    page.fill('#dueDate', '15')
    page.click('#debtFormSubmit')
    page.wait_for_selector('#debtsList >> text=No Person Debt', timeout=10000)
    card = page.query_selector('#debtsList .debt-card .person-pill')
    assert not card, "person-pill should not appear when no person is linked"


@pytest.mark.feature
def test_income_card_shows_person_pill(app_page):
    """An income linked to a person shows a person pill on the read-only income card."""
    page = app_page
    _add_person(page, 'IncomePillPerson')
    _add_income_for_person(page, 'Salary Pill', 3000, 'IncomePillPerson')
    _nav_income(page)
    pill = page.query_selector('#incomeList .income-card .person-pill')
    assert pill, "person-pill not found on income card"
    assert 'IncomePillPerson' in pill.inner_text(), "Person name not in income pill"


@pytest.mark.feature
def test_income_card_no_pill_without_person(app_page):
    """An income not linked to any person shows no person pill."""
    page = app_page
    _create_account_then_nav_income(page)
    page.fill('#incomeName', 'No Person Income')
    page.fill('#incomeAmount', '2000')
    page.fill('#incomeFirstDate', '2026-01-01')
    page.select_option('#incomeFrequency', 'monthly')
    page.select_option('#incomeAccount', index=1)
    page.click('#incomeFormSubmit')
    page.wait_for_selector('#incomeList >> text=No Person Income', timeout=10000)
    pill = page.query_selector('#incomeList .income-card .person-pill')
    assert not pill, "person-pill should not appear when no person is linked to income"


@pytest.mark.feature
def test_people_page_collapsible_details_shows_linked_items(app_page):
    """The People page person card has a collapsible <details> listing linked incomes and debts."""
    page = app_page
    _add_person(page, 'LinkedPerson')
    _add_income_for_person(page, 'Linked Salary', 4000, 'LinkedPerson')
    _add_debt_for_person(page, 'Linked Mortgage', 200000, 'LinkedPerson')

    _nav_people(page)
    details = page.query_selector('#peopleList .person-linked-details')
    assert details, "person-linked-details <details> element not found"
    summary_text = page.inner_text('#peopleList .person-linked-details summary')
    assert '1 income' in summary_text or '1 debt' in summary_text, \
        f"Summary does not mention linked counts: {summary_text!r}"


@pytest.mark.feature
def test_people_page_linked_items_expand(app_page):
    """Expanding a person's details section shows the linked item buttons."""
    page = app_page
    _add_person(page, 'ExpandPerson')
    _add_debt_for_person(page, 'Expand Debt', 8000, 'ExpandPerson')

    _nav_people(page)
    details = page.query_selector('#peopleList .person-linked-details')
    assert details, "person-linked-details not found"
    details.evaluate('el => el.setAttribute("open", "")')  # open the details
    page.wait_for_timeout(200)
    btns = page.query_selector_all('#peopleList .person-link-btn')
    assert btns, "No .person-link-btn found inside expanded details"
    btn_text = ' '.join(b.inner_text() for b in btns)
    assert 'Expand Debt' in btn_text, "Linked debt name not in expanded details"


@pytest.mark.feature
def test_people_page_linked_debt_navigates_to_liabilities(app_page):
    """Clicking a linked debt button on the People page navigates to the Liabilities page."""
    page = app_page
    _add_person(page, 'NavPerson')
    _add_debt_for_person(page, 'Nav Debt', 3000, 'NavPerson')

    _nav_people(page)
    details = page.query_selector('#peopleList .person-linked-details')
    assert details
    details.evaluate('el => el.setAttribute("open", "")')
    page.wait_for_timeout(200)
    debt_btn = page.query_selector('#peopleList .person-link-btn[data-person-nav="liabilities"]')
    assert debt_btn, "Liabilities nav button not found in person details"
    debt_btn.click()
    page.wait_for_selector('#liabilitiesSection.active', timeout=5000)
    assert page.query_selector('#liabilitiesSection.active'), "Did not navigate to Liabilities page"


@pytest.mark.feature
def test_people_page_linked_income_navigates_to_income_page(app_page):
    """Clicking a linked income button on the People page navigates to the Income page."""
    page = app_page
    _add_person(page, 'IncNavPerson')
    _add_income_for_person(page, 'IncNav Salary', 5000, 'IncNavPerson')

    _nav_people(page)
    details = page.query_selector('#peopleList .person-linked-details')
    assert details
    details.evaluate('el => el.setAttribute("open", "")')
    page.wait_for_timeout(200)
    inc_btn = page.query_selector('#peopleList .person-link-btn[data-person-nav="income"]')
    assert inc_btn, "Income nav button not found in person details"
    inc_btn.click()
    page.wait_for_selector('#incomeSection.active', timeout=5000)
    assert page.query_selector('#incomeSection.active'), "Did not navigate to Income page"


# ── Person summary card KPI tile tests (issue #284) ───────────────────────────

@pytest.mark.feature
def test_person_card_has_summary_card(app_page):
    """A person card on the People page renders the .person-summary-card KPI tile container."""
    page = app_page
    _add_person(page, 'KPIPerson')
    assert page.query_selector('#peopleList .person-summary-card'), \
        ".person-summary-card not found on person card"


@pytest.mark.feature
def test_person_card_kpi_tiles_present(app_page):
    """Each person card has 4 KPI tiles for Annual Income, Total Debt, Monthly Net, Credit Util."""
    page = app_page
    _add_person(page, 'TilePerson')

    tiles = page.query_selector_all('#peopleList .person-kpi-tile')
    assert len(tiles) == 4, f"Expected 4 KPI tiles, got {len(tiles)}"

    labels = [t.inner_text() for t in tiles]
    joined = ' '.join(labels).lower()  # CSS text-transform:uppercase affects inner_text
    assert 'annual income' in joined, "Annual Income tile not found"
    assert 'total debt' in joined, "Total Debt tile not found"
    assert 'monthly net' in joined, "Monthly Net tile not found"
    assert 'credit util' in joined, "Credit Util tile not found"


@pytest.mark.feature
def test_person_card_annual_income_reflects_linked_income(app_page):
    """The Annual Income KPI tile shows the correct annual figure for a linked income."""
    page = app_page
    _add_person(page, 'AnnualPerson')
    _add_income_for_person(page, 'Monthly Pay', 6000, 'AnnualPerson')

    _nav_people(page)
    # $6,000/month × 12 = $72,000
    card_html = page.inner_html('#peopleList')
    assert '72,000' in card_html or '72000' in card_html, \
        "Annual income tile should reflect $72,000 for $6k/month income"


@pytest.mark.feature
def test_person_card_monthly_net_positive_color(app_page):
    """Monthly Net tile uses the positive color class when income > debt minimums."""
    page = app_page
    _add_person(page, 'NetPosPerson')
    _add_income_for_person(page, 'High Salary', 10000, 'NetPosPerson')
    # No debts — net is positive
    _nav_people(page)

    positive_el = page.query_selector('#peopleList .person-kpi--positive')
    assert positive_el, "Monthly Net should have positive color class when income > debt minimums"


@pytest.mark.feature
def test_person_card_monthly_net_negative_color(app_page):
    """Monthly Net tile uses the negative color class when debt minimums > income."""
    page = app_page
    _add_person(page, 'NetNegPerson')
    # No income linked, but add a large-minimum debt
    _add_debt_for_person(page, 'Big Debt', 50000, 'NetNegPerson')

    _nav_people(page)
    negative_el = page.query_selector('#peopleList .person-kpi--negative')
    assert negative_el, "Monthly Net should have negative color class when debt minimums > income"


@pytest.mark.feature
def test_person_card_credit_util_tile_na_without_cc_debts(app_page):
    """Credit Util tile shows N/A when the person has no CC debts with limits set."""
    page = app_page
    _add_person(page, 'NoUtilPerson')
    _nav_people(page)

    card_text = page.inner_text('#peopleList')
    assert 'N/A' in card_text, "Credit Util tile should show N/A when no CC debts exist"


@pytest.mark.feature
def test_person_card_credit_util_tile_shows_pct_with_cc_debt(app_page):
    """Credit Util tile shows a utilization percentage when a CC debt exists."""
    page = app_page
    _add_person(page, 'UtilTilePerson')
    _nav_debts(page)
    _open_debt_form(page)
    page.fill('#debtName', 'CC Test')
    page.select_option('#debtType', value='creditCard')
    page.fill('#accountBalance', '5000')
    page.fill('#creditLimit', '10000')
    page.fill('#interestRate', '20')
    page.fill('#minimumPayment', '100')
    page.fill('#dueDate', '15')
    page.select_option('#debtPersons', label='UtilTilePerson')
    page.click('#debtFormSubmit')
    page.wait_for_selector('#debtsList >> text=CC Test', timeout=10000)

    _nav_people(page)
    card_text = page.inner_text('#peopleList')
    # 5000/10000 = 50%
    assert '50%' in card_text, "Credit Util tile should show 50% utilization"
    # Should NOT show N/A when CC debts exist
    assert 'N/A' not in card_text, "Credit Util tile should not show N/A when CC debts exist"


@pytest.mark.feature
def test_person_card_credit_util_health_badge(app_page):
    """Credit Util tile value is wrapped in a health-badge with a status class."""
    page = app_page
    _add_person(page, 'BadgePerson')
    _nav_debts(page)
    _open_debt_form(page)
    page.fill('#debtName', 'Badge CC')
    page.select_option('#debtType', value='creditCard')
    page.fill('#accountBalance', '500')
    page.fill('#creditLimit', '10000')
    page.fill('#interestRate', '18')
    page.fill('#minimumPayment', '25')
    page.fill('#dueDate', '15')
    page.select_option('#debtPersons', label='BadgePerson')
    page.click('#debtFormSubmit')
    page.wait_for_selector('#debtsList >> text=Badge CC', timeout=10000)

    _nav_people(page)
    # 5% utilization → health-status--green
    badge = page.query_selector('#peopleList .person-kpi-tile .health-badge')
    assert badge, "No health-badge found in Credit Util tile"
    badge_classes = badge.get_attribute('class') or ''
    assert 'health-status--' in badge_classes, \
        f"health-badge should have a health-status class, got: {badge_classes!r}"


@pytest.mark.feature
def test_person_card_dti_badge_shown_when_income_linked(app_page):
    """A DTI badge appears in the person card header when income is linked."""
    page = app_page
    _add_person(page, 'DTIBadgePerson')
    _add_income_for_person(page, 'DTI Income', 5000, 'DTIBadgePerson')
    _nav_people(page)

    dti_badge = page.query_selector('#peopleList .person-card-header .health-badge')
    assert dti_badge, "DTI badge not found in person card header"
    badge_text = dti_badge.inner_text()
    assert 'DTI' in badge_text, f"Expected 'DTI' in badge text, got: {badge_text!r}"


@pytest.mark.feature
def test_person_card_no_dti_badge_without_income(app_page):
    """No DTI badge appears when the person has no linked income (dtiPct is null)."""
    page = app_page
    _add_person(page, 'NoDTIPerson')
    _nav_people(page)

    dti_badge = page.query_selector('#peopleList .person-card-header .health-badge')
    assert not dti_badge, "DTI badge should not appear when no income is linked"


@pytest.mark.feature
def test_person_card_aria_labels(app_page):
    """KPI tiles have aria-label attributes for screen-reader accessibility."""
    page = app_page
    _add_person(page, 'AriaLabelPerson')
    _nav_people(page)

    tiles = page.query_selector_all('#peopleList .person-kpi-tile')
    for tile in tiles:
        aria = tile.get_attribute('aria-label')
        assert aria, f"KPI tile is missing aria-label: {tile.inner_text()!r}"
        assert 'AriaLabelPerson' in aria, \
            f"aria-label should include the person name, got: {aria!r}"


@pytest.mark.feature
def test_person_card_kpi_tiles_persist_after_reload(app_page):
    """KPI tiles are still present after a page reload (data persisted)."""
    page = app_page
    _add_person(page, 'ReloadKPIPerson')
    page.reload()
    page.wait_for_selector('#healthSection.active', timeout=5000)
    _nav_people(page)
    tiles = page.query_selector_all('#peopleList .person-kpi-tile')
    assert len(tiles) == 4, f"KPI tiles should reappear after reload, got {len(tiles)}"


# ── Negative tests for summary card ──────────────────────────────────────────

@pytest.mark.feature
def test_person_card_no_summary_in_edit_mode(app_page):
    """When a person card is in edit mode, the KPI summary card is NOT shown."""
    page = app_page
    _add_person(page, 'EditModePerson')
    edit_btn = page.query_selector('#peopleList .btn-edit')
    edit_btn.click()
    page.wait_for_selector('[data-person-action="save"]', timeout=3000)

    # In edit mode, the card is replaced with an edit form — no summary card
    summary = page.query_selector('#peopleList .person-summary-card')
    assert not summary, "Summary card should not render while the card is in edit mode"


@pytest.mark.feature
def test_person_card_summary_xss_safe(app_page):
    """Person names with special characters are escaped in KPI tile aria-labels."""
    page = app_page
    xss_name = 'A"B<script>alert(1)</script>'
    _nav_people(page)
    page.fill('#personName', xss_name)
    page.click('#personFormSubmit')
    page.wait_for_timeout(500)

    # If XSS executed, the page title would change or an alert would fire.
    # Verify no raw <script> appears in the people list HTML.
    html = page.inner_html('#peopleList')
    assert '<script>' not in html, "XSS payload should be escaped in the people list HTML"
