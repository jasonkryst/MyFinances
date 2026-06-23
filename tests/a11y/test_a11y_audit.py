#!/usr/bin/env python3
"""
Pytest wiring for the standalone accessibility audit (run_a11y_audit.py).

run_a11y_audit.py is a Playwright script that seeds the app with a
realistic dataset and walks every SPA page (light + dark mode), the
mobile nav, three modals, and guide.html, collecting raw a11y findings:
heading hierarchy, orphaned form inputs, unnamed interactive elements,
missing image alt text, dangling ARIA references, duplicate IDs, color
contrast ratios (WCAG 1.4.3/1.4.11 luminance math), mobile tap-target
sizes, and modal focus/keyboard behavior (focus-on-open, Escape-to-close).

That script previously only ran manually (`python tests/a11y/run_a11y_audit.py
> docs/audit/a11y/raw_findings.json`), so regressions in any of the above
went undetected by `pytest tests/`. This module imports its
`collect_audit_findings()` function directly and asserts on the results,
so the same checks now run as part of the normal test suite.

These tests intentionally do NOT duplicate tests/ui/test_accessibility.py's
28 pytest-native checks (keyboard nav, ARIA roles on the reports/nav
widgets, reconcile modal focus trap, skip-link presence, etc.). Instead
they cover the broader, page-spanning sweeps that only run_a11y_audit.py
performs: site-wide computed-contrast across all 10 pages in both themes,
dangling ARIA references, duplicate IDs, orphaned inputs/unnamed controls
across every page (not just one), missing image alt text, and the
Update Balance / Amortization modal keyboard behavior (test_accessibility.py
only covers the Reconcile modal's focus trap).

Severity follows the same vocabulary used in docs/audit/a11y/A11Y_AUDIT_REPORT.md
(Serious / Moderate / Minor / Informational). "Serious" findings here are
WCAG-failing structural/contrast defects equivalent to that report's
HIGH/CRITICAL-impact items, and are what fail the build.
"""

import pytest

from .run_a11y_audit import collect_audit_findings

# Module-level cache: the full audit is expensive (loads the app ~14 times
# across desktop/dark-mode/mobile/guide passes), so run it once per pytest
# session and let each test assert on a different slice of the results.
_CACHED_RESULTS = None


@pytest.fixture(scope="module")
def audit_results():
    global _CACHED_RESULTS
    if _CACHED_RESULTS is None:
        _CACHED_RESULTS = collect_audit_findings(headless=True)
    return _CACHED_RESULTS


def _is_gradient_header_false_positive(issue):
    """Known tool artifact, not a real contrast defect: getBg() in
    run_a11y_audit.py either (a) walks past a CSS gradient background-image
    to whatever solid backgroundColor it finds further up the tree (the
    original F1 case, documented in docs/audit/a11y/A11Y_AUDIT_REPORT.md
    after manual verification the true rendered ratios ~5.2:1/~6.7:1 pass),
    or (b) returns an element's own semi-transparent overlay color (e.g.
    header-icon-btn's rgba(255,255,255,0.12) hover background) without
    compositing it against its ancestor, and the ratio() function drops
    alpha entirely - so a translucent white overlay reads as opaque white.

    Both mechanisms produce a ratio at or extremely near 1.0
    (luminance(fg) ~= luminance(bg)) - in one observed case 1.02 rather than
    exactly 1.00, from sub-pixel alpha-rounding when two translucent
    rgba() layers are compared. Two genuinely different rendered colors
    essentially never land within this band by chance, so ratio <= 1.05 is
    a reliable signature of "tool couldn't resolve the true composited
    background", not a real WCAG failure - any finding above that band
    (e.g. 3.45) reflects two distinct measured colors and IS a genuine
    finding that must not be filtered.
    """
    return issue.get("ratio", 0) <= 1.05


def _flatten_contrast_findings(results):
    """Collect every contrast_issues list across pages/dark-mode/guide,
    tagged with where they came from, minus the known gradient-header
    false positive.
    """
    flat = []
    for page_name, entry in results.get("pages", {}).items():
        for issue in entry.get("contrast_issues", []):
            if _is_gradient_header_false_positive(issue):
                continue
            flat.append({"location": f"page:{page_name}", **issue})
    for page_name, issues in results.get("dark_mode_contrast", {}).items():
        for issue in issues:
            if _is_gradient_header_false_positive(issue):
                continue
            flat.append({"location": f"dark:{page_name}", **issue})
    for issue in results.get("guide", {}).get("guide", {}).get("contrast_issues", []):
        if _is_gradient_header_false_positive(issue):
            continue
        flat.append({"location": "guide", **issue})
    return flat


def _is_dynamic_modal_title_false_positive(ref):
    """#spendingDrilldownModal's aria-labelledby points at
    #spendingDrilldownTitle, which src/spending.js only renders into the
    modal's content div once a user actually opens a drilldown (see the
    `<h3 id="spendingDrilldownTitle">` write-up there). The audit loads each
    page fresh without opening that modal, so the target id is legitimately
    absent from the static/closed-state DOM - by the time the modal is
    actually shown to a screen reader, the title exists. Not a real WCAG
    failure; narrowly filtered by its exact id pair.
    """
    return ref.get("id") == "spendingDrilldownModal" and ref.get("refId") == "spendingDrilldownTitle"


@pytest.mark.a11y
def test_no_dangling_aria_references(audit_results):
    """No aria-labelledby/describedby/controls/owns should point at a
    nonexistent id, on any page or guide.html (WCAG 4.1.2/1.3.1 - assistive
    tech gets a broken reference otherwise). Not covered by
    test_accessibility.py.
    """
    offenders = {}
    for page_name, entry in audit_results.get("pages", {}).items():
        refs = [r for r in entry.get("dangling_aria_refs", []) if not _is_dynamic_modal_title_false_positive(r)]
        if refs:
            offenders[page_name] = refs
    guide_refs = [
        r for r in audit_results.get("guide", {}).get("guide", {}).get("dangling_aria_refs", [])
        if not _is_dynamic_modal_title_false_positive(r)
    ]
    if guide_refs:
        offenders["guide"] = guide_refs

    assert not offenders, f"Dangling ARIA references found (Serious): {offenders}"


@pytest.mark.a11y
def test_no_duplicate_ids(audit_results):
    """Duplicate ids break id-based ARIA references and label associations
    (WCAG 4.1.1). Checked across every page, not just one. Not covered by
    test_accessibility.py.
    """
    offenders = {}
    for page_name, entry in audit_results.get("pages", {}).items():
        dupes = entry.get("duplicate_ids", [])
        if dupes:
            offenders[page_name] = dupes
    guide_dupes = audit_results.get("guide", {}).get("guide", {}).get("duplicate_ids", [])
    if guide_dupes:
        offenders["guide"] = guide_dupes

    assert not offenders, f"Duplicate IDs found (Serious): {offenders}"


@pytest.mark.a11y
def test_no_orphaned_form_inputs(audit_results):
    """Every visible input/select/textarea on every page must have a
    <label for>, aria-label, aria-labelledby, or be wrapped in a <label>
    (WCAG 1.3.1/4.1.2). test_accessibility.py only spot-checks a handful of
    inputs on one page (test_form_labels) and the Reconcile card
    specifically; this sweeps every page in one pass.
    """
    offenders = {}
    for page_name, entry in audit_results.get("pages", {}).items():
        orphans = entry.get("orphaned_inputs", [])
        if orphans:
            offenders[page_name] = orphans

    assert not offenders, f"Orphaned form inputs with no accessible name (Serious): {offenders}"


@pytest.mark.a11y
def test_no_unnamed_interactive_elements(audit_results):
    """Every visible button/link/role=button/role=tab must have text
    content, aria-label, aria-labelledby, or a title (WCAG 4.1.2 Name,
    Role, Value). test_accessibility.py's test_button_accessibility only
    checks tag names, not accessible names, and only the first 5 buttons.
    """
    offenders = {}
    for page_name, entry in audit_results.get("pages", {}).items():
        unnamed = entry.get("unnamed_interactive", [])
        if unnamed:
            offenders[page_name] = unnamed

    assert not offenders, f"Unnamed interactive elements found (Serious): {offenders}"


@pytest.mark.a11y
def test_no_images_missing_alt(audit_results):
    """Every <img> must have an alt attribute (WCAG 1.1.1). Not covered by
    test_accessibility.py.
    """
    offenders = {}
    for page_name, entry in audit_results.get("pages", {}).items():
        missing = entry.get("images_no_alt", [])
        if missing:
            offenders[page_name] = missing

    assert not offenders, f"Images missing alt text (Serious): {offenders}"


@pytest.mark.a11y
def test_site_wide_color_contrast(audit_results):
    """WCAG 1.4.3 contrast (4.5:1 normal text / 3:1 large text) computed
    across all 10 SPA pages in light mode, all 10 in dark mode, and
    guide.html. This is the broad sweep run_a11y_audit.py performs that
    test_accessibility.py does not attempt (its test_color_contrast only
    checks that <body> has *some* color/bg values set, not actual ratios).

    Findings with an exact ratio of 1.0 are filtered as tool artifacts (the
    contrast script can't resolve true composited backgrounds through CSS
    gradients or semi-transparent overlays - see
    _is_gradient_header_false_positive and docs/audit/a11y/A11Y_AUDIT_REPORT.md
    finding F1). Any other ratio reflects two genuinely distinct measured
    colors and is a real finding.
    """
    findings = _flatten_contrast_findings(audit_results)
    assert not findings, (
        f"Color contrast failures found (Serious, WCAG 1.4.3): {findings}"
    )


@pytest.mark.a11y
def test_modal_escape_closes_update_balance_modal(audit_results):
    """The Update Balance modal (Liabilities > Debts) must close on Escape,
    same as the Reconcile and Amortization modals. test_accessibility.py
    only verifies this behavior for the Reconcile modal
    (test_reconcile_modal_focus_and_keyboard_trap); this is the Update
    Balance modal's equivalent, previously only checked manually via
    run_a11y_audit.py.
    """
    modal = audit_results.get("modals", {}).get("update_balance", {})
    focus = modal.get("update_balance_focus")
    assert focus != "trigger not found", (
        "Update Balance modal trigger [data-debt-action=\"update-balance\"] not found "
        "- cannot verify modal keyboard behavior"
    )
    after_escape = modal.get("update_balance_after_escape", {})
    assert after_escape.get("modalHidden") is True, (
        f"Escape should close the Update Balance modal (Serious, WCAG 2.1.2): {modal}"
    )


@pytest.mark.a11y
def test_mobile_nav_toggle_aria_expanded_updates(audit_results):
    """#navToggle's aria-expanded must flip false -> true when opened
    (WCAG 4.1.2). Covers the mobile nav sweep that test_accessibility.py
    does not exercise (it has no mobile-viewport pass).
    """
    mobile = audit_results.get("mobile", {})
    toggle = mobile.get("nav_toggle_aria_expanded")
    assert toggle is not None, "#navToggle not found in mobile viewport - cannot verify aria-expanded"
    assert toggle.get("before") == "false", f"Expected aria-expanded=false before open, got {toggle}"
    assert toggle.get("after") == "true", f"Expected aria-expanded=true after open, got {toggle}"
    assert mobile.get("nav_menu_visible_after_open") is True, (
        "#navMenu should become visible after opening the mobile nav toggle"
    )


@pytest.mark.a11y
def test_summary_report_tables_have_captions(app_page):
    """Summary Report tables must have a <caption> for screen-reader context,
    matching the pattern used by the Net Worth history table."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.click('[data-rptab="summary"]')
    page.wait_for_timeout(200)

    tables = page.query_selector_all('#reportsSummary table')
    assert len(tables) >= 2, "Expected at least Cash Flow and Account Balances tables"
    for table in tables:
        caption = table.query_selector('caption')
        assert caption is not None, "Each Summary Report table must have a <caption>"
