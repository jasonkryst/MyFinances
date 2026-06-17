# Reports Nav Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat 7-button Reports tab bar with a grouped chip/pill nav (Activity · Trends · Planning), sticky positioning, full A11y/ARIA support, and comprehensive tests.

**Architecture:** Pure HTML + CSS change — `index.html` tab bar restructured into three `.rpt-tab-group` wrappers; `styles.css` existing `.rpt-tab-bar`/`.rpt-tab-btn` rules replaced with new chip/pill rules; `src/ui.js` unchanged (it queries `[data-rptab]` and `.rpt-tab-btn`, both preserved). `--primary-hsl` CSS variable added to `:root` and `body.dark-mode` to support alpha-tinted group chip badges.

**Tech Stack:** Vanilla HTML/CSS, Playwright + pytest (served at `http://localhost:5500/`).

---

## Setup

Start the dev server and leave it running:
```bash
python -m http.server 5500
```

---

### Task 1: Security pre-condition test — no inline styles in Reports nav (TDD)

**Files:**
- Modify: `tests/security/test_static_scan.py`

The static-scan suite already asserts no `style="` attributes exist in `index.html`. Add a targeted test that will still pass now (current HTML is clean) and will catch any accidental inline style introduced during the refactor.

- [ ] **Step 1: Append the targeted static-scan test**

Append to `tests/security/test_static_scan.py`:

```python
@pytest.mark.security
def test_reports_nav_has_no_inline_styles():
    """Reports tab bar HTML must use CSS classes, never inline style= attributes (CSP requirement)."""
    index_path = os.path.join(PROJECT_ROOT, 'index.html')
    with open(index_path, encoding='utf-8') as f:
        content = f.read()

    # Isolate just the tab-bar section between the rpt-tab-bar div and the first panel
    start = content.find('class="rpt-tab-bar"')
    end   = content.find('class="rpt-tab-panel', start)
    assert start != -1, "Could not find .rpt-tab-bar in index.html"
    nav_html = content[start:end]

    assert 'style="' not in nav_html, (
        "Reports nav contains inline style= attributes — use CSS classes instead (CSP blocks unsafe-inline)"
    )
```

- [ ] **Step 2: Run and confirm it passes (baseline)**

```bash
python -m pytest tests/security/test_static_scan.py::test_reports_nav_has_no_inline_styles -v
```

Expected: PASS — current HTML has no inline styles.

- [ ] **Step 3: Commit**

```bash
git add tests/security/test_static_scan.py
git commit -m "Add security pre-condition test: no inline styles in Reports nav"
```

---

### Task 2: Feature tests — group structure and tab membership (TDD)

**Files:**
- Create: `tests/features/test_reports_nav_groups.py`

These are pure DOM-structure assertions — they verify the three group wrappers exist and each tab lives in the correct group. They will fail until Task 3 restructures the HTML.

- [ ] **Step 1: Create the feature test file**

Create `tests/features/test_reports_nav_groups.py`:

```python
import pytest

GROUPS = {
    'activity': ['calendar', 'spending', 'incomeexp'],
    'trends':   ['moneyflow', 'variance', 'networth'],
    'planning': ['forecast'],
}

@pytest.mark.feature
def test_reports_nav_three_groups_exist(app_page):
    """Three .rpt-tab-group elements exist inside .rpt-tab-bar."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    count = page.evaluate('() => document.querySelectorAll(".rpt-tab-group").length')
    assert count == 3, f"Expected 3 tab groups, got {count}"


@pytest.mark.feature
def test_reports_nav_group_labels(app_page):
    """Group chip labels read Activity, Trends, Planning."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    labels = page.evaluate("""
        () => Array.from(document.querySelectorAll('.rpt-tab-group-label'))
                   .map(el => el.textContent.trim())
    """)
    assert labels == ['Activity', 'Trends', 'Planning'], f"Got: {labels}"


@pytest.mark.feature
def test_reports_nav_tabs_in_correct_groups(app_page):
    """Each tab button lives inside the correct .rpt-tab-group."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    for group_id, expected_tabs in GROUPS.items():
        for tab_id in expected_tabs:
            in_group = page.evaluate(f"""
                () => {{
                    const btn = document.querySelector('[data-rptab="{tab_id}"]');
                    if (!btn) return false;
                    return btn.closest('.rpt-tab-group') !== null;
                }}
            """)
            assert in_group, f"Tab '{tab_id}' not inside a .rpt-tab-group"


@pytest.mark.feature
def test_reports_nav_all_seven_tabs_present(app_page):
    """All 7 original tabs are still reachable after restructure."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    all_tabs = [tab for tabs in GROUPS.values() for tab in tabs]
    for tab_id in all_tabs:
        btn = page.query_selector(f'[data-rptab="{tab_id}"]')
        assert btn, f"Tab button data-rptab='{tab_id}' not found"


@pytest.mark.feature
def test_reports_nav_tab_switching_still_works(app_page):
    """Clicking each tab activates its panel — regression test for switchTab()."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    all_tabs = [tab for tabs in GROUPS.values() for tab in tabs]
    for tab_id in all_tabs:
        page.click(f'[data-rptab="{tab_id}"]')
        page.wait_for_timeout(150)

        is_active = page.evaluate(f"""
            () => document.getElementById('rptPanel-{tab_id}')
                          ?.classList.contains('rpt-tab-panel--active')
        """)
        assert is_active, f"Panel rptPanel-{tab_id} not active after clicking its tab"
```

- [ ] **Step 2: Run to confirm they fail**

```bash
python -m pytest tests/features/test_reports_nav_groups.py -v
```

Expected: `test_reports_nav_three_groups_exist`, `test_reports_nav_group_labels`, `test_reports_nav_tabs_in_correct_groups` FAIL — `.rpt-tab-group` elements don't exist yet. `test_reports_nav_all_seven_tabs_present` and `test_reports_nav_tab_switching_still_works` PASS (tabs already present).

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/features/test_reports_nav_groups.py
git commit -m "Add failing feature tests for Reports nav group structure"
```

---

### Task 3: HTML restructure — replace flat tab bar with grouped structure

**Files:**
- Modify: `index.html:631-640`

Replace the 7 flat `<button>` elements inside `.rpt-tab-bar` with three `.rpt-tab-group` wrappers. `data-rptab` values, `aria-selected`, and `rpt-tab-btn` class are **preserved unchanged** so `switchTab()` in `ui.js` continues to work without modification. Add `role="tablist"` on the bar and `role="tab"` on each button for proper ARIA semantics.

- [ ] **Step 1: Replace the tab bar in `index.html`**

In `index.html`, replace:
```html
                <!-- Tab bar -->
                <div class="rpt-tab-bar">
                    <button class="rpt-tab-btn rpt-tab-btn--active" data-rptab="calendar" aria-selected="true">📅 Calendar</button>
                    <button class="rpt-tab-btn" data-rptab="incomeexp" aria-selected="false">📊 Income vs Expenses</button>
                    <button class="rpt-tab-btn" data-rptab="moneyflow" aria-selected="false">💰 Money Flow</button>
                    <button class="rpt-tab-btn" data-rptab="variance" aria-selected="false">📈 What Changed</button>
                    <button class="rpt-tab-btn" data-rptab="networth" aria-selected="false">📉 Net Worth</button>
                    <button class="rpt-tab-btn" data-rptab="forecast" aria-selected="false">🔮 Forecast</button>
                    <button class="rpt-tab-btn" data-rptab="spending" aria-selected="false">🏷️ Spending</button>
                </div>
```
with:
```html
                <!-- Tab bar -->
                <div class="rpt-tab-bar" role="tablist" aria-label="Report sections">
                    <div class="rpt-tab-group">
                        <span class="rpt-tab-group-label">Activity</span>
                        <div class="rpt-tab-group-tabs">
                            <button class="rpt-tab-btn rpt-tab-btn--active" data-rptab="calendar" role="tab" aria-selected="true" aria-controls="rptPanel-calendar">📅 Calendar</button>
                            <button class="rpt-tab-btn" data-rptab="spending" role="tab" aria-selected="false" aria-controls="rptPanel-spending">🏷️ Spending</button>
                            <button class="rpt-tab-btn" data-rptab="incomeexp" role="tab" aria-selected="false" aria-controls="rptPanel-incomeexp">📊 Income vs Expenses</button>
                        </div>
                    </div>
                    <div class="rpt-tab-group-sep" aria-hidden="true"></div>
                    <div class="rpt-tab-group">
                        <span class="rpt-tab-group-label">Trends</span>
                        <div class="rpt-tab-group-tabs">
                            <button class="rpt-tab-btn" data-rptab="moneyflow" role="tab" aria-selected="false" aria-controls="rptPanel-moneyflow">💰 Money Flow</button>
                            <button class="rpt-tab-btn" data-rptab="variance" role="tab" aria-selected="false" aria-controls="rptPanel-variance">📈 What Changed</button>
                            <button class="rpt-tab-btn" data-rptab="networth" role="tab" aria-selected="false" aria-controls="rptPanel-networth">📉 Net Worth</button>
                        </div>
                    </div>
                    <div class="rpt-tab-group-sep" aria-hidden="true"></div>
                    <div class="rpt-tab-group">
                        <span class="rpt-tab-group-label">Planning</span>
                        <div class="rpt-tab-group-tabs">
                            <button class="rpt-tab-btn" data-rptab="forecast" role="tab" aria-selected="false" aria-controls="rptPanel-forecast">🔮 Forecast</button>
                        </div>
                    </div>
                </div>
```

- [ ] **Step 2: Run feature tests — should all pass now**

```bash
python -m pytest tests/features/test_reports_nav_groups.py -v
```

Expected: All 5 PASS.

- [ ] **Step 3: Run the static scan security test**

```bash
python -m pytest tests/security/test_static_scan.py::test_reports_nav_has_no_inline_styles -v
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Restructure Reports tab bar into Activity/Trends/Planning groups with ARIA roles"
```

---

### Task 4: CSS — replace old tab rules with chip/pill grouped nav styles

**Files:**
- Modify: `styles.css:875-892` (`:root` block — add `--primary-hsl`)
- Modify: `styles.css:661-677` (`body.dark-mode` block — add `--primary-hsl`)
- Modify: `styles.css:3822-3855` (replace existing `.rpt-tab-bar` / `.rpt-tab-btn` rules)
- Modify: `styles.css:4234` (replace mobile `.rpt-tab-btn` override)

- [ ] **Step 1: Add `--primary-hsl` to `:root`**

In `styles.css`, inside the `:root { }` block (after `--primary-color: #2563eb;` on line 876), add:

```css
    --primary-hsl: 217 89% 61%;
```

- [ ] **Step 2: Add `--primary-hsl` to `body.dark-mode`**

In `styles.css`, inside the `body.dark-mode { }` block (after `--bg-color: #0f172a;` on line 673), add:

```css
    --primary-hsl: 213 93% 68%;
```

- [ ] **Step 3: Replace old tab-bar and tab-btn CSS**

In `styles.css`, replace the block from `.rpt-tab-bar {` through `.rpt-tab-panel--active { display: block; }` (lines 3822–3855) with:

```css
/* ── Reports tab bar — grouped chip/pill nav ─────────────────────────────── */
.rpt-tab-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 10px 0;
    border-bottom: 1px solid var(--border-color);
    position: sticky;
    top: 0;
    z-index: 20;
    background: white;
}
body.dark-mode .rpt-tab-bar {
    background: var(--bg-color);
}

.rpt-tab-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.rpt-tab-group-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: 999px;
    background: hsla(var(--primary-hsl), 0.10);
    border: 1px solid hsla(var(--primary-hsl), 0.25);
    color: var(--primary-color);
    align-self: flex-start;
    opacity: 0.55;
    transition: opacity 0.15s;
}
.rpt-tab-group:has(.rpt-tab-btn--active) .rpt-tab-group-label {
    opacity: 1;
}

.rpt-tab-group-tabs {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
}

.rpt-tab-btn {
    padding: 8px 14px;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.rpt-tab-btn:hover {
    background: var(--light-bg);
    color: var(--text-primary);
    border-color: var(--primary-color);
}
.rpt-tab-btn:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 2px;
}
.rpt-tab-btn--active {
    background: var(--primary-color);
    color: #fff;
    border-color: var(--primary-color);
}
body.dark-mode .rpt-tab-btn--active {
    background: #60a5fa;
    border-color: #60a5fa;
    color: #0f172a;
}
body.dark-mode .rpt-tab-btn:hover {
    background: #1e293b;
    color: #e2e8f0;
}

.rpt-tab-group-sep {
    width: 1px;
    height: 28px;
    background: var(--border-color);
    align-self: flex-end;
    margin-bottom: 2px;
    flex-shrink: 0;
}

/* ── Tab panels ────────────────────────────────────────────────────────── */
.rpt-tab-panel { display: none; padding: 24px 0 0; }
.rpt-tab-panel--active { display: block; }
```

- [ ] **Step 4: Replace the mobile media-query override**

In `styles.css`, inside the `@media (max-width: 640px)` block (around line 4234), replace:

```css
    .rpt-tab-btn      { min-width: 100px; font-size: 0.82rem; padding: 10px 10px; }
```

with:

```css
    .rpt-tab-bar      { flex-wrap: nowrap; overflow-x: auto; gap: 8px; }
    .rpt-tab-group-sep { display: none; }
    .rpt-tab-btn      { font-size: 11px; padding: 7px 10px; }
```

- [ ] **Step 5: Run full feature + security tests**

```bash
python -m pytest tests/features/test_reports_nav_groups.py tests/security/test_static_scan.py -v
```

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add styles.css
git commit -m "Replace Reports tab bar CSS with grouped chip/pill nav, sticky, dark mode"
```

---

### Task 5: Behavioral/edge-case UI tests (bed)

**Files:**
- Create: `tests/ui/test_reports_nav.py`

These tests exercise runtime behavior: active group label highlight, cross-group switching, dark-mode class presence, and sticky computed style.

- [ ] **Step 1: Create the behavioral UI test file**

Create `tests/ui/test_reports_nav.py`:

```python
import pytest


def _go_to_reports(page):
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)


@pytest.mark.ui
def test_active_group_label_highlights_when_tab_in_group_is_active(app_page):
    """When a tab is active, its parent group label chip reaches full opacity (opacity=1)."""
    page = app_page
    _go_to_reports(page)

    # Click a Trends tab — Money Flow
    page.click('[data-rptab="moneyflow"]')
    page.wait_for_timeout(150)

    # The Trends group label should be full opacity (has active child)
    trends_opacity = page.evaluate("""
        () => {
            const groups = document.querySelectorAll('.rpt-tab-group');
            for (const g of groups) {
                const label = g.querySelector('.rpt-tab-group-label');
                if (label && label.textContent.trim() === 'Trends') {
                    return parseFloat(window.getComputedStyle(g.querySelector('.rpt-tab-group-label')).opacity);
                }
            }
            return null;
        }
    """)
    assert trends_opacity is not None, "Trends group label not found"
    assert trends_opacity == pytest.approx(1.0, abs=0.05), \
        f"Expected Trends label opacity=1.0 when active, got {trends_opacity}"


@pytest.mark.ui
def test_inactive_group_label_is_dimmed(app_page):
    """Group labels whose group does not contain the active tab are dimmed (opacity < 1)."""
    page = app_page
    _go_to_reports(page)

    # Calendar is active by default — Activity group is full opacity, others are dimmed
    planning_opacity = page.evaluate("""
        () => {
            const groups = document.querySelectorAll('.rpt-tab-group');
            for (const g of groups) {
                const label = g.querySelector('.rpt-tab-group-label');
                if (label && label.textContent.trim() === 'Planning') {
                    return parseFloat(window.getComputedStyle(label).opacity);
                }
            }
            return null;
        }
    """)
    assert planning_opacity is not None, "Planning group label not found"
    assert planning_opacity < 0.9, \
        f"Expected Planning label to be dimmed when Calendar is active, got opacity={planning_opacity}"


@pytest.mark.ui
def test_cross_group_tab_switching_updates_active_class(app_page):
    """Switching from a tab in one group to a tab in another group moves rpt-tab-btn--active."""
    page = app_page
    _go_to_reports(page)

    # Start on calendar (Activity group)
    page.click('[data-rptab="calendar"]')
    page.wait_for_timeout(150)

    # Switch to Net Worth (Trends group)
    page.click('[data-rptab="networth"]')
    page.wait_for_timeout(150)

    calendar_active = page.evaluate(
        '() => document.querySelector("[data-rptab=\'calendar\']").classList.contains("rpt-tab-btn--active")'
    )
    networth_active = page.evaluate(
        '() => document.querySelector("[data-rptab=\'networth\']").classList.contains("rpt-tab-btn--active")'
    )
    assert not calendar_active, "Calendar tab should no longer be active"
    assert networth_active, "Net Worth tab should be active"


@pytest.mark.ui
def test_only_one_tab_active_at_a_time(app_page):
    """Exactly one .rpt-tab-btn--active exists at any time."""
    page = app_page
    _go_to_reports(page)

    for tab_id in ['calendar', 'spending', 'moneyflow', 'forecast']:
        page.click(f'[data-rptab="{tab_id}"]')
        page.wait_for_timeout(100)
        active_count = page.evaluate(
            '() => document.querySelectorAll(".rpt-tab-btn--active").length'
        )
        assert active_count == 1, \
            f"Expected exactly 1 active tab after clicking {tab_id}, got {active_count}"


@pytest.mark.ui
def test_tab_bar_is_sticky_positioned(app_page):
    """The .rpt-tab-bar has position:sticky in its computed style."""
    page = app_page
    _go_to_reports(page)

    position = page.evaluate(
        '() => window.getComputedStyle(document.querySelector(".rpt-tab-bar")).position'
    )
    assert position == 'sticky', f"Expected position:sticky, got {position}"


@pytest.mark.ui
def test_tab_bar_dark_mode_background(app_page):
    """In dark mode, .rpt-tab-bar gets a dark background so content scrolls cleanly under it."""
    page = app_page
    _go_to_reports(page)

    page.evaluate('() => document.body.classList.add("dark-mode")')
    page.wait_for_timeout(100)

    bg = page.evaluate(
        '() => window.getComputedStyle(document.querySelector(".rpt-tab-bar")).backgroundColor'
    )
    # bg-color in dark mode is #0f172a = rgb(15, 23, 42)
    assert bg != 'rgba(0, 0, 0, 0)', f"Dark mode tab bar should have a solid background, got: {bg}"

    # Restore
    page.evaluate('() => document.body.classList.remove("dark-mode")')


@pytest.mark.ui
def test_group_separators_are_hidden_on_mobile(app_page):
    """On a 480px viewport, .rpt-tab-group-sep elements are not displayed."""
    page = app_page
    page.set_viewport_size({'width': 480, 'height': 800})
    _go_to_reports(page)
    page.wait_for_timeout(200)

    sep_display = page.evaluate("""
        () => {
            const seps = document.querySelectorAll('.rpt-tab-group-sep');
            return Array.from(seps).map(s => window.getComputedStyle(s).display);
        }
    """)
    assert all(d == 'none' for d in sep_display), \
        f"Expected all separators display:none on mobile, got: {sep_display}"

    page.set_viewport_size({'width': 1280, 'height': 800})
```

- [ ] **Step 2: Run behavioral tests**

```bash
python -m pytest tests/ui/test_reports_nav.py -v
```

Expected: All 7 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/ui/test_reports_nav.py
git commit -m "Add behavioral/edge-case UI tests for Reports grouped nav"
```

---

### Task 6: Accessibility tests — ARIA and keyboard navigation (A11y)

**Files:**
- Modify: `tests/ui/test_accessibility.py`

Append tests that verify the ARIA tablist pattern is correctly implemented and the nav is keyboard-navigable.

- [ ] **Step 1: Append A11y tests to `test_accessibility.py`**

Append to `tests/ui/test_accessibility.py`:

```python
@pytest.mark.ui
def test_reports_nav_tablist_role(app_page):
    """The Reports tab bar has role=tablist for screen reader semantics."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    role = page.evaluate(
        '() => document.querySelector(".rpt-tab-bar")?.getAttribute("role")'
    )
    assert role == 'tablist', f"Expected role=tablist on .rpt-tab-bar, got: {role}"


@pytest.mark.ui
def test_reports_tab_buttons_have_role_tab(app_page):
    """Every report tab button has role=tab."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    roles = page.evaluate("""
        () => Array.from(document.querySelectorAll('.rpt-tab-btn'))
                   .map(b => b.getAttribute('role'))
    """)
    assert all(r == 'tab' for r in roles), \
        f"Not all tab buttons have role=tab: {roles}"


@pytest.mark.ui
def test_reports_active_tab_aria_selected_true(app_page):
    """The active tab has aria-selected=true; all others have aria-selected=false."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    page.click('[data-rptab="networth"]')
    page.wait_for_timeout(150)

    result = page.evaluate("""
        () => {
            const btns = document.querySelectorAll('.rpt-tab-btn');
            const trueCount  = [...btns].filter(b => b.getAttribute('aria-selected') === 'true').length;
            const falseCount = [...btns].filter(b => b.getAttribute('aria-selected') === 'false').length;
            const activeId   = [...btns].find(b => b.getAttribute('aria-selected') === 'true')?.getAttribute('data-rptab');
            return { trueCount, falseCount, activeId };
        }
    """)
    assert result['trueCount'] == 1, f"Expected exactly 1 aria-selected=true, got {result['trueCount']}"
    assert result['falseCount'] == 6, f"Expected 6 aria-selected=false, got {result['falseCount']}"
    assert result['activeId'] == 'networth', f"Expected networth to be selected, got {result['activeId']}"


@pytest.mark.ui
def test_reports_tab_buttons_have_aria_controls(app_page):
    """Each tab button has aria-controls pointing to its panel id."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    mismatches = page.evaluate("""
        () => {
            const btns = document.querySelectorAll('.rpt-tab-btn[data-rptab]');
            const errors = [];
            for (const btn of btns) {
                const tab   = btn.getAttribute('data-rptab');
                const ctrl  = btn.getAttribute('aria-controls');
                const panel = document.getElementById(ctrl);
                if (ctrl !== 'rptPanel-' + tab) {
                    errors.push(`${tab}: aria-controls="${ctrl}" (expected rptPanel-${tab})`);
                }
                if (!panel) {
                    errors.push(`${tab}: panel #${ctrl} not found in DOM`);
                }
            }
            return errors;
        }
    """)
    assert mismatches == [], f"aria-controls mismatches: {mismatches}"


@pytest.mark.ui
def test_reports_group_separators_aria_hidden(app_page):
    """Decorative group separator divs are aria-hidden so screen readers skip them."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    seps = page.evaluate("""
        () => Array.from(document.querySelectorAll('.rpt-tab-group-sep'))
                   .map(s => s.getAttribute('aria-hidden'))
    """)
    assert seps, "No .rpt-tab-group-sep elements found"
    assert all(v == 'true' for v in seps), \
        f"All separators must have aria-hidden=true, got: {seps}"


@pytest.mark.ui
def test_reports_group_labels_are_not_interactive(app_page):
    """Group chip labels are <span> elements (not buttons), so they are not in the tab focus order."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    tags = page.evaluate("""
        () => Array.from(document.querySelectorAll('.rpt-tab-group-label'))
                   .map(el => el.tagName)
    """)
    assert all(t == 'SPAN' for t in tags), \
        f"Group labels must be <span>, got: {tags}"


@pytest.mark.ui
def test_reports_tab_keyboard_focus_reachable(app_page):
    """Pressing Tab from the nav bar reaches each tab button via keyboard."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    # Focus the first tab button
    page.evaluate('() => document.querySelector(".rpt-tab-btn").focus()')
    page.wait_for_timeout(100)

    focused = page.evaluate('() => document.activeElement.classList.contains("rpt-tab-btn")')
    assert focused, "Could not focus a .rpt-tab-btn via JS focus()"

    # Tab forward through all 7 buttons
    focused_tabs = set()
    for _ in range(7):
        tab_id = page.evaluate(
            '() => document.activeElement.getAttribute("data-rptab")'
        )
        if tab_id:
            focused_tabs.add(tab_id)
        page.keyboard.press('Tab')
        page.wait_for_timeout(50)

    expected = {'calendar', 'spending', 'incomeexp', 'moneyflow', 'variance', 'networth', 'forecast'}
    assert expected.issubset(focused_tabs), \
        f"Not all tab buttons were reached via Tab key. Reached: {focused_tabs}"


@pytest.mark.ui
def test_reports_active_tab_has_focus_visible_outline(app_page):
    """Tab buttons show a visible focus ring via :focus-visible (not suppressed)."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    # Check that :focus-visible outline is not 'none' in the stylesheet
    has_focus_visible = page.evaluate("""
        () => {
            // Look for focus-visible rule in all stylesheets
            for (const sheet of document.styleSheets) {
                try {
                    for (const rule of sheet.cssRules) {
                        if (rule.selectorText && rule.selectorText.includes('rpt-tab-btn') &&
                            rule.selectorText.includes('focus-visible')) {
                            return rule.style.outline !== 'none' && rule.style.outline !== '';
                        }
                    }
                } catch (e) {}
            }
            return false;
        }
    """)
    assert has_focus_visible, \
        ".rpt-tab-btn:focus-visible must define a non-none outline for keyboard users"
```

- [ ] **Step 2: Run A11y tests**

```bash
python -m pytest tests/ui/test_accessibility.py -v -k "reports"
```

Expected: All 8 new tests PASS.

- [ ] **Step 3: Run full accessibility suite to check for regressions**

```bash
python -m pytest tests/ui/test_accessibility.py -v
```

Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/ui/test_accessibility.py
git commit -m "Add A11y tests: tablist role, aria-controls, keyboard nav, focus-visible for Reports nav"
```

---

### Task 7: Version bump to 3.6.1

**Files:**
- Modify: `src/utils.js:3`

- [ ] **Step 1: Bump APP_VERSION**

In `src/utils.js`, change:
```js
export const APP_VERSION = '3.6.0';
```
to:
```js
export const APP_VERSION = '3.6.1';
```

- [ ] **Step 2: Commit**

```bash
git add src/utils.js
git commit -m "Bump APP_VERSION to 3.6.1"
```

---

### Task 8: Final check — full test suite

- [ ] **Step 1: Run the complete test suite**

```bash
python -m pytest tests/ -v --tb=short
```

Expected: All tests PASS (216 existing + 20 new = 236 total, no regressions).

If the smoke/integration test fails due to a console error, check that `--primary-hsl` is correctly placed inside the `:root {}` block (not outside it) and that `hsla(var(--primary-hsl), 0.10)` is not used by any browser that doesn't support `--primary-hsl` (it will fall back to transparent, which is acceptable).

- [ ] **Step 2: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "Fix any remaining issues from full suite run"
```
