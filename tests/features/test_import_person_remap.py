#!/usr/bin/env python3
"""
Import person-id remapping (issue #421).

Persons get fresh ids on JSON import, so every record that references a person
(income.personId, debt.personIds/ownershipSplit) must be remapped through the
same old->new map. A reference that does not resolve becomes null / is dropped
(never a dangling id).
"""

import json

import pytest

from tests.conftest import seed_state


def _import(page, payload, replace):
    return page.evaluate(
        """([json, replace]) => new Promise((resolve) => {
            const app = window.app;
            const orig = app.refreshCurrentPageData;
            app.refreshCurrentPageData = function (...args) {
                app.refreshCurrentPageData = orig;
                const r = orig.apply(app, args);
                resolve('imported');
                return r;
            };
            const file = new File([new Blob([json], { type: 'application/json' })], 'b.json', { type: 'application/json' });
            import('/src/dataExport.js').then(({ importAllJSON }) => {
                importAllJSON(app, file, {
                    requestImportMode: async () => replace,
                    onNoData: () => resolve('no-data'),
                    onInvalidJSON: () => resolve('invalid'),
                    onImportError: () => resolve('error')
                });
            });
        })""",
        [json.dumps(payload), replace])


def _income(name, person_id=None, **extra):
    inc = {"id": 900 + len(name), "name": name, "amount": 1000, "firstPayDate": "2026-01-02",
           "frequency": "monthly"}
    if person_id is not None:
        inc["personId"] = person_id
    inc.update(extra)
    return inc


def _income_person_names(page):
    return page.evaluate("""() => {
        const app = window.app;
        return Object.fromEntries(app.incomes.map(i => [i.name, i.personId == null ? null : (app.persons.find(p => p.id === i.personId)?.name ?? 'DANGLING')]));
    }""")


# File-side person ids. They are far above anything a test database's id
# sequence hands out, so "the record no longer carries the file id" can't pass
# or fail by coincidence (a fresh stack can assign server id 5 or 6).
ALEX_FILE_ID = 9005
SAM_FILE_ID = 9006
PERSONS = [{"id": ALEX_FILE_ID, "name": "Alex"}, {"id": SAM_FILE_ID, "name": "Sam"}]


def _server_income_person_ids(page):
    # What the server stored, keyed by income name, plus the server's person ids by name.
    return page.evaluate("""async () => {
        const [incomes, persons] = await Promise.all([
            fetch('/api/incomes').then(r => r.json()),
            fetch('/api/persons').then(r => r.json()),
        ]);
        return {
            incomes: Object.fromEntries(incomes.map(i => [i.name, i.personId ?? null])),
            persons: Object.fromEntries(persons.map(p => [p.name, p.id])),
        };
    }""")


@pytest.mark.feature
def test_replace_import_remaps_income_person(app_page):
    page = app_page
    payload = {"persons": PERSONS, "incomes": [_income("Paycheck", ALEX_FILE_ID), _income("Side", SAM_FILE_ID)]}
    assert _import(page, payload, True) == 'imported'
    assert _income_person_names(page) == {"Paycheck": "Alex", "Side": "Sam"}
    # Not the stale file id, in memory or on the server.
    assert page.evaluate(f"window.app.incomes.every(i => i.personId !== {ALEX_FILE_ID} && i.personId !== {SAM_FILE_ID})")
    server = _server_income_person_ids(page)
    assert server['incomes']['Paycheck'] == server['persons']['Alex']
    assert server['incomes']['Side'] == server['persons']['Sam']
    # Income card shows the right person pill.
    page.evaluate("window.app.switchPage('income')")
    page.wait_for_selector('#incomeList .income-card', timeout=5000)
    cards = page.eval_on_selector_all('#incomeList .income-card', "els => els.map(e => e.innerText)")
    assert any('Paycheck' in c and 'Alex' in c for c in cards), cards
    assert any('Side' in c and 'Sam' in c for c in cards), cards


@pytest.mark.feature
def test_merge_import_maps_income_to_existing_person_by_name(app_page):
    page = app_page
    seed_state(page, {"persons": [{"id": 777, "name": "Alex"}]})
    alex_id = page.evaluate("window.app.persons.find(p => p.name === 'Alex').id")
    payload = {"persons": PERSONS, "incomes": [_income("Paycheck", ALEX_FILE_ID)]}
    assert _import(page, payload, False) == 'imported'
    assert page.evaluate("window.app.incomes.find(i => i.name === 'Paycheck').personId") == alex_id


@pytest.mark.feature
def test_merge_import_maps_income_to_newly_created_person(app_page):
    page = app_page
    seed_state(page, {"persons": [{"id": 777, "name": "Alex"}]})
    payload = {"persons": PERSONS, "incomes": [_income("Side", SAM_FILE_ID)]}
    assert _import(page, payload, False) == 'imported'
    assert _income_person_names(page)["Side"] == "Sam"
    assert page.evaluate("window.app.incomes.find(i => i.name === 'Side').personId") != SAM_FILE_ID
    # The stored income points at the newly created Sam, not at the existing Alex.
    server = _server_income_person_ids(page)
    assert server['incomes']['Side'] == server['persons']['Sam'] != server['persons']['Alex']


@pytest.mark.feature
def test_merge_import_leaves_existing_income_untouched(app_page):
    page = app_page
    seed_state(page, {
        "persons": [{"id": 777, "name": "Alex"}],
        "incomes": [{"id": 1, "name": "Paycheck", "amount": 5, "firstPayDate": "2026-01-02",
                     "frequency": "monthly", "personId": 777}],
    })
    alex_id = page.evaluate("window.app.persons.find(p => p.name === 'Alex').id")
    payload = {"persons": PERSONS, "incomes": [_income("Paycheck", SAM_FILE_ID)]}
    assert _import(page, payload, False) == 'imported'
    assert page.evaluate("window.app.incomes.filter(i => i.name === 'Paycheck').map(i => i.personId)") == [alex_id]


@pytest.mark.feature
@pytest.mark.parametrize("replace", [True, False])
def test_income_with_unknown_person_becomes_null(app_page, replace):
    page = app_page
    payload = {"persons": PERSONS, "incomes": [_income("Ghost", 99)]}
    assert _import(page, payload, replace) == 'imported'
    assert _income_person_names(page)["Ghost"] is None


@pytest.mark.feature
@pytest.mark.parametrize("replace", [True, False])
def test_income_without_person_stays_null(app_page, replace):
    page = app_page
    payload = {"persons": PERSONS, "incomes": [_income("Plain")]}
    assert _import(page, payload, replace) == 'imported'
    assert _income_person_names(page)["Plain"] is None


@pytest.mark.feature
def test_income_person_without_persons_in_file_becomes_null(app_page):
    page = app_page
    payload = {"incomes": [_income("Orphan", ALEX_FILE_ID)]}
    assert _import(page, payload, True) == 'imported'
    assert _income_person_names(page)["Orphan"] is None


@pytest.mark.feature
def test_debts_still_remap_and_drop_unknown_person_ids(app_page):
    page = app_page
    debt = {"id": 100, "name": "Mortgage", "debtType": "creditCard", "accountBalance": 800,
            "minimumPayment": 30, "interestRate": 5, "dueDate": 5,
            "personIds": [ALEX_FILE_ID, SAM_FILE_ID, 99],
            "ownershipSplit": {str(ALEX_FILE_ID): 0.6, str(SAM_FILE_ID): 0.4, "99": 0.5}}
    assert _import(page, {"persons": PERSONS, "debts": [debt]}, True) == 'imported'
    out = page.evaluate("""() => {
        const app = window.app;
        const name = id => app.persons.find(p => p.id === id)?.name;
        const d = app.debts.find(x => x.name === 'Mortgage');
        return { people: d.personIds.map(name),
                 split: Object.fromEntries(Object.entries(d.ownershipSplit || {}).map(([k, v]) => [name(Number(k)), v])) };
    }""")
    assert out['people'] == ['Alex', 'Sam']
    assert out['split'] == {'Alex': 0.6, 'Sam': 0.4}


@pytest.mark.feature
def test_malicious_person_id_values_sanitize_to_null(app_page):
    page = app_page
    bad = ["<img src=x onerror=alert(1)>", str(ALEX_FILE_ID), -3, {"a": 1}, [ALEX_FILE_ID], True, "__proto__"]
    incomes = [_income(f"Bad{i}", v) for i, v in enumerate(bad)]
    payload = {"persons": PERSONS, "incomes": incomes}
    assert _import(page, payload, True) == 'imported'
    names = _income_person_names(page)
    for i, v in enumerate(bad):
        # No value may survive as a dangling id; a numeric string may only resolve to a real person.
        assert names[f"Bad{i}"] in (None, "Alex", "Sam"), (v, names[f"Bad{i}"])
    # (The numeric string and the one-element array coerce to ALEX_FILE_ID, a real person in the file.)
    for i in (0, 2, 3, 5, 6):
        assert names[f"Bad{i}"] is None, (bad[i], names[f"Bad{i}"])


@pytest.mark.feature
def test_remap_helpers_direct(app_page):
    page = app_page
    out = page.evaluate("""async () => {
        const { remapIncomePersonRef, remapDebtPersonRefs } = await import('/src/sanitizers.js');
        return {
            hit: remapIncomePersonRef({ name: 'a', personId: 5 }, { 5: 50 }).personId,
            miss: remapIncomePersonRef({ name: 'a', personId: 6 }, { 5: 50 }).personId,
            none: remapIncomePersonRef({ name: 'a' }, { 5: 50 }).personId,
            noMap: remapIncomePersonRef({ name: 'a', personId: 5 }).personId,
            proto: remapIncomePersonRef({ name: 'a', personId: 'constructor' }, {}).personId,
            debt: remapDebtPersonRefs({ personIds: [5, 6], ownershipSplit: { 5: 0.5, 6: 0.5 } }, { 5: 50 })
        };
    }""")
    assert out['hit'] == 50
    assert out['miss'] is None and out['none'] is None and out['noMap'] is None and out['proto'] is None
    assert out['debt']['personIds'] == [50]
    assert out['debt']['ownershipSplit'] is None
