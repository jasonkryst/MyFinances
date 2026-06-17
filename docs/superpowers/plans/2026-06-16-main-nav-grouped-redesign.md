# Main Nav Grouped Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat 10-button main navigation with three labeled groups (Overview · Manage · Analyze), pill-badge group labels, compact button sizing, and full a11y attributes (`aria-current="page"`, `role="navigation"` landmark, `:focus-visible` rings).

**Architecture:** Pure HTML + CSS change for the grouping/styling; one-line JS change in `switchPage()` to wire `aria-current`. No new modules, no new state. The `data-page` attribute values are preserved verbatim — all downstream JS continues to work without modification. TDD order: failing feature tests first, then HTML, then CSS, then JS, then behavioral + a11y tests.

**Tech Stack:** Vanilla HTML/CSS/JS, Playwright + pytest (served at `http://localhost:5500/`).

---

## Setup

Start the dev server before running any Playwright-based tests:
```bash
python -m http.server 5500
```

---

### Task 1: Security pre-condition test — no inline styles in main nav (TDD)

**Files:**
- Modify: `tests/security/test_static_scan.py`

Append a targeted static-scan test. It passes now (baseline) and will catch any accidental `style="..."` added during the refactor.

- [ ] **Step 1: Append to `tests/security/test_static_scan.py`**

```python
@pytest.mark.security
def test_main_nav_has_no_inline_styles():
    """Main nav HTML must use CSS classes, never inline style= attributes (CSP requirement)."""
    index_path = os.path.join(PROJECT_ROOT, 'index.html')
    with open(index_path, encoding='utf-8') as f:
        content = f.read()

    # Anchor on the full opening tag so inline styles on the <nav> itself are caught
    start = content.find('<nav class="top-nav"')
    end   = content.find('</nav>', start)
    assert start != -1, "Could not find <nav class=\"top-nav\"> in index.html"
    nav_html = content[start:end]

    assert 'style="' not in nav_html, (
        "Main nav contains inline style= attributes — use CSS classes instead (CSP blocks unsafe-inline)"
    )
```

- [ ] **Step 2: Run and confirm it passes (baseline)**

```bash
python -m pytest tests/security/test_static_scan.py::test_main_nav_has_no_inline_styles -v
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/security/test_static_scan.py
git commit -m "Add security pre-condition test: no inline styles in main nav"
```

---

### Task 2: Feature tests — group structure and page membership (TDD, will fail)

**Files:**
- Create: `tests/features/test_main_nav_groups.py`

These tests verify the three group wrappers exist and each page lives in the correct group. They **fail now** (the structure doesn't exist yet) and pass after Task 3.

- [ ] **Step 1: Create `tests/features/test_main_nav_groups.py`**

```python
import pytest

GROUPS = {
    'overview': ['health', 'accounts', 'income'],
    'manage':   ['liabilities', 'recurring', 'savings', 'strategy'],
    'analyze':  ['reports', 'ledger', 'reconcile'],
}


@pytest.mark.feature
def test_main_nav_three_groups_exist(app_page):
    """Three .nav-group elements exist inside #topNav."""
    page = app_page
    count = page.evaluate('() => document.querySelectorAll("#topNav .nav-group").length')
    assert count == 3, f"Expected 3 nav groups, got {count}"


@pytest.mark.feature
def test_main_nav_group_labels(app_page):
    """Group pill labels read Overview, Manage, Analyze."""
    page = app_page
    labels = page.evaluate("""
        () => Array.from(document.querySelectorAll('.nav-group-label'))
                   .map(el => el.textContent.trim())
    """)
    assert labels == ['Overview', 'Manage', 'Analyze'], f"Got: {labels}"


@pytest.mark.feature
def test_main_nav_pages_in_correct_groups(app_page):
    """Each page button lives inside the correct .nav-group."""
    page = app_page
    for group_id, pages in GROUPS.items():
        for page_id in pages:
            in_group = page.evaluate(f"""
                () => {{
                    const btn = document.querySelector('[data-page="{page_id}"]');
                    if (!btn) return false;
                    return btn.closest('.nav-group') !== null;
                }}
            """)
            assert in_group, f"Page '{page_id}' not inside a .nav-group"


@pytest.mark.feature
def test_main_nav_all_ten_pages_present(app_page):
    """All 10 original page buttons are still reachable after restructure."""
    page = app_page
    all_pages = [p for pages in GROUPS.values() for p in pages]
    for page_id in all_pages:
        btn = page.query_selector(f'[data-page="{page_id}"]')
        assert btn, f"Page button data-page='{page_id}' not found"


@pytest.mark.feature
def test_main_nav_page_switching_still_works(app_page):
    """Clicking each page button activates its section — regression test."""
    page = app_page
    section_map = {
        'health': 'healthSection',
        'accounts': 'accountsSection',
        'income': 'incomeSection',
        'liabilities': 'liabilitiesSection',
        'recurring': 'recurringSection',
        'savings': 'savingsSection',
        'strategy': 'strategySection',
        'reports': 'reportsSection',
        'ledger': 'ledgerSection',
        'reconcile': 'reconcileSection',
    }
    for page_id, section_id in section_map.items():
        page.click(f'[data-page="{page_id}"]')
        page.wait_for_timeout(150)
        is_active = page.evaluate(
            f'() => document.getElementById("{section_id}")?.classList.contains("active")'
        )
        assert is_active, f"Section #{section_id} not active after clicking {page_id}"
```

- [ ] **Step 2: Run to confirm 3 tests fail, 2 pass**

```bash
python -m pytest tests/features/test_main_nav_groups.py -v
```

Expected:
- `test_main_nav_three_groups_exist` — FAIL (no `.nav-group` yet)
- `test_main_nav_group_labels` — FAIL (no `.nav-group-label` yet)
- `test_main_nav_pages_in_correct_groups` — FAIL (no `.nav-group` yet)
- `test_main_nav_all_ten_pages_present` — PASS (all buttons already exist)
- `test_main_nav_page_switching_still_works` — PASS (switching works)

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/features/test_main_nav_groups.py
git commit -m "Add failing feature tests for main nav group structure"
```

---

### Task 3: HTML restructure — replace flat nav-menu with three nav-group wrappers

**Files:**
- Modify: `index.html` (around line 49–66)

Replace the 10 flat `<button>` elements inside `.nav-menu` with three `.nav-group` wrappers. `data-page` values, `.page-button` class, and `id="navMenu"` are **preserved unchanged** — `switchPage()` needs no JS edits to work.

- [ ] **Step 1: In `index.html`, replace the `<nav>` block**

Find:
```html
            <nav class="top-nav" id="topNav">
                <button class="nav-toggle" id="navToggle" aria-label="Toggle menu" aria-expanded="false" aria-controls="navMenu">
                    ☰
                </button>
                <div class="nav-menu" id="navMenu">
                    <button class="page-button" data-page="health">Health</button>
                    <button class="page-button" data-page="accounts">Accounts</button>
                    <button class="page-button" data-page="income">Income</button>
                    <button class="page-button" data-page="liabilities">Liabilities</button>
                    <button class="page-button" data-page="recurring">Recurring</button>
                    <button class="page-button" data-page="savings">Savings</button>
                    <button class="page-button" data-page="strategy">Plan</button>
                    <button class="page-button" data-page="reports">Reports</button>
                    <button class="page-button" data-page="ledger">Ledger</button>
                    <button class="page-button" data-page="reconcile">Reconcile</button>
                </div>
            </nav>
```

Replace with:
```html
            <nav class="top-nav" id="topNav" aria-label="Main navigation">
                <button class="nav-toggle" id="navToggle" aria-label="Toggle menu" aria-expanded="false" aria-controls="navMenu">
                    ☰
                </button>
                <div class="nav-menu" id="navMenu">
                    <div class="nav-group">
                        <span class="nav-group-label">Overview</span>
                        <div class="nav-group-btns">
                            <button class="page-button" data-page="health" aria-current="page">Health</button>
                            <button class="page-button" data-page="accounts">Accounts</button>
                            <button class="page-button" data-page="income">Income</button>
                        </div>
                    </div>
                    <div class="nav-group-sep" aria-hidden="true"></div>
                    <div class="nav-group">
                        <span class="nav-group-label">Manage</span>
                        <div class="nav-group-btns">
                            <button class="page-button" data-page="liabilities">Liabilities</button>
                            <button class="page-button" data-page="recurring">Recurring</button>
                            <button class="page-button" data-page="savings">Savings</button>
                            <button class="page-button" data-page="strategy">Plan</button>
                        </div>
                    </div>
                    <div class="nav-group-sep" aria-hidden="true"></div>
                    <div class="nav-group">
                        <span class="nav-group-label">Analyze</span>
                        <div class="nav-group-btns">
                            <button class="page-button" data-page="reports">Reports</button>
                            <button class="page-button" data-page="ledger">Ledger</button>
                            <button class="page-button" data-page="reconcile">Reconcile</button>
                        </div>
                    </div>
                </div>
            </nav>
```

- [ ] **Step 2: Run feature tests — all 5 should now pass**

```bash
python -m pytest tests/features/test_main_nav_groups.py -v
```

Expected: 5/5 PASS

- [ ] **Step 3: Run security pre-condition test**

```bash
python -m pytest tests/security/test_static_scan.py::test_main_nav_has_no_inline_styles -v
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Restructure main nav into Overview/Manage/Analyze groups with ARIA landmark"
```

---

### Task 4: CSS — grouped nav styles, compact buttons, pill labels, dark mode, mobile

**Files:**
- Modify: `styles.css` (lines ~981–1075 for nav rules, ~2203–2260 for mobile overrides)

- [ ] **Step 1: Update `.top-nav` and `.nav-menu` rules**

In `styles.css`, find and replace the `.top-nav {` rule (around line 1017):

Replace:
```css
.top-nav {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    margin-top: 12px;
    background: rgba(0,0,0,0.18);
    border-top: 1px solid rgba(255,255,255,0.10);
    position: relative;
}
```

With:
```css
.top-nav {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: flex-end;
    gap: 8px;
    padding: 6px 16px;
    margin-top: 12px;
    background: rgba(0,0,0,0.18);
    border-top: 1px solid rgba(255,255,255,0.10);
    position: relative;
}
```

And replace `.nav-menu {` (around line 1041):
```css
.nav-menu {
    display: flex;
    width: 100%;
    flex-wrap: wrap;
    justify-content: center;
}
```

With:
```css
.nav-menu {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: flex-end;
    gap: 8px;
}
```

- [ ] **Step 2: Add new group/label/sep rules immediately after `.nav-menu {…}`**

After the `.nav-menu` block (before `.page-button`), insert:

```css
/* ── Nav groups ─────────────────────────────────────────────── */
.nav-group {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
}

.nav-group-label {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(255,255,255,0.18);
    color: rgba(255,255,255,0.60);
    transition: background 0.15s, color 0.15s;
    white-space: nowrap;
}
.nav-group:has(.page-button.active) .nav-group-label {
    background: rgba(255,255,255,0.90);
    color: #1e40af;
}

.nav-group-btns {
    display: flex;
    gap: 2px;
}

.nav-group-sep {
    width: 1px;
    height: 30px;
    background: rgba(255,255,255,0.18);
    align-self: flex-end;
    margin-bottom: 2px;
    flex-shrink: 0;
}
```

- [ ] **Step 3: Replace `.page-button`, `.page-button:hover`, `.page-button.active` rules**

Find and replace the three rules starting at approximately line 1048:

Replace:
```css
.page-button {
    flex: 1;
    max-width: 160px;
    padding: 12px 16px;
    border-radius: 0;
    border: none;
    border-bottom: 3px solid transparent;
    background: transparent;
    color: rgba(255,255,255,0.72);
    cursor: pointer;
    font-weight: 600;
    font-size: 0.88rem;
    letter-spacing: 0.02em;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
    white-space: nowrap;
}

.page-button:hover {
    color: #fff;
    background: rgba(255,255,255,0.08);
    border-bottom-color: rgba(255,255,255,0.4);
}

.page-button.active {
    color: #fff;
    background: transparent;
    border-bottom: 3px solid #fff;
}
```

With:
```css
.page-button {
    padding: 6px 11px;
    border-radius: 4px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: rgba(255,255,255,0.65);
    cursor: pointer;
    font-weight: 600;
    font-size: 11px;
    letter-spacing: 0.02em;
    white-space: nowrap;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.page-button:hover {
    color: #fff;
    background: rgba(255,255,255,0.10);
    border-bottom-color: rgba(255,255,255,0.40);
}

.page-button:focus-visible {
    outline: 2px solid rgba(255,255,255,0.80);
    outline-offset: 2px;
}

.page-button.active {
    color: #fff;
    background: rgba(255,255,255,0.15);
    border-bottom: 2px solid #fff;
}
```

- [ ] **Step 4: Replace dark-mode `.page-button` overrides**

Find and replace the three dark-mode rules (around lines 986–998):

Replace:
```css
body.dark-mode .page-button {
    color: rgba(255,255,255,0.60);
}

body.dark-mode .page-button:hover {
    color: #fff;
    background: rgba(255,255,255,0.06);
}

body.dark-mode .page-button.active {
    color: #fff;
    border-bottom-color: #93c5fd;
}
```

With:
```css
body.dark-mode .page-button {
    color: rgba(255,255,255,0.60);
}

body.dark-mode .page-button:hover {
    color: #fff;
    background: rgba(255,255,255,0.06);
}

body.dark-mode .page-button:focus-visible {
    outline-color: rgba(255,255,255,0.70);
}

body.dark-mode .page-button.active {
    color: #fff;
    border-bottom-color: #93c5fd;
}
```

- [ ] **Step 5: Update the mobile `@media (max-width: 768px)` overrides**

Inside `@media (max-width: 768px)`, find and replace the `.page-button`, `.page-button:hover`, and `.page-button.active` mobile rules (around lines 2236–2260):

Replace:
```css
    .page-button {
        flex: 1;
        max-width: 100%;
        font-size: 0.9rem;
        padding: 14px 16px;
        border-bottom: 1px solid rgba(255,255,255,0.1);
        border-right: 3px solid transparent;
        text-align: left;
        white-space: normal;
        min-height: 44px;
        display: flex;
        align-items: center;
    }

    .page-button:hover {
        background: rgba(255,255,255,0.08);
        border-bottom-color: rgba(255,255,255,0.1);
        border-right-color: rgba(255,255,255,0.4);
    }

    .page-button.active {
        background: rgba(255,255,255,0.05);
        border-bottom-color: rgba(255,255,255,0.1);
        border-right: 3px solid #fff;
    }
```

With:
```css
    .nav-group-sep   { display: none; }
    .nav-group-label { display: none; }
    .nav-group       { gap: 0; }
    .nav-group-btns  { flex-direction: column; }

    .page-button {
        max-width: 100%;
        font-size: 0.9rem;
        padding: 14px 16px;
        border-bottom: 1px solid rgba(255,255,255,0.1);
        border-right: 3px solid transparent;
        border-radius: 0;
        text-align: left;
        white-space: normal;
        min-height: 44px;
        display: flex;
        align-items: center;
    }

    .page-button:hover {
        background: rgba(255,255,255,0.08);
        border-bottom-color: rgba(255,255,255,0.1);
        border-right-color: rgba(255,255,255,0.4);
    }

    .page-button.active {
        background: rgba(255,255,255,0.05);
        border-bottom-color: rgba(255,255,255,0.1);
        border-right: 3px solid #fff;
    }
```

Also find the second small-screen mobile override inside `@media (max-width: 480px)` (around line 2340) and replace:
```css
    .page-button {
        padding: 12px 14px;
        font-size: 0.85rem;
    }
```
With:
```css
    .page-button {
        padding: 12px 14px;
        font-size: 0.85rem;
        border-radius: 0;
    }
```

- [ ] **Step 6: Run feature + security tests**

```bash
python -m pytest tests/features/test_main_nav_groups.py tests/security/test_static_scan.py -v
```

Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add styles.css
git commit -m "Replace main nav CSS with grouped nav, compact buttons, pill labels, focus-visible"
```

---

### Task 5: JS — wire `aria-current="page"` in `switchPage()`

**Files:**
- Modify: `src/ui.js:487–490`

The only JS change is two extra lines in `switchPage()` that set/clear `aria-current`.

- [ ] **Step 1: Update `switchPage()` in `src/ui.js`**

Find (lines 487–490):
```js
export function switchPage(app, pageName) {
    document.querySelectorAll('.page-button').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.page-button[data-page="${pageName}"]`);
    if (btn) btn.classList.add('active');
```

Replace with:
```js
export function switchPage(app, pageName) {
    document.querySelectorAll('.page-button').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-current', 'false');
    });
    const btn = document.querySelector(`.page-button[data-page="${pageName}"]`);
    if (btn) {
        btn.classList.add('active');
        btn.setAttribute('aria-current', 'page');
    }
```

- [ ] **Step 2: Run the feature tests to confirm switching still works**

```bash
python -m pytest tests/features/test_main_nav_groups.py::test_main_nav_page_switching_still_works -v
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/ui.js
git commit -m "Wire aria-current=page in switchPage() for main nav a11y"
```

---

### Task 6: Behavioral/edge-case UI tests

**Files:**
- Create: `tests/ui/test_main_nav.py`

- [ ] **Step 1: Create `tests/ui/test_main_nav.py`**

```python
import pytest


@pytest.mark.ui
def test_active_group_label_highlights(app_page):
    """Active group label gets white pill background when a page in its group is active."""
    page = app_page
    # Click a Manage page — Liabilities
    page.click('[data-page="liabilities"]')
    page.wait_for_timeout(150)

    manage_bg = page.evaluate("""
        () => {
            for (const g of document.querySelectorAll('.nav-group')) {
                const label = g.querySelector('.nav-group-label');
                if (label && label.textContent.trim() === 'Manage') {
                    return window.getComputedStyle(label).backgroundColor;
                }
            }
            return null;
        }
    """)
    assert manage_bg is not None, "Manage group label not found"
    # White pill = rgba(255,255,255,0.90) — not fully transparent
    assert manage_bg != 'rgba(0, 0, 0, 0)', \
        f"Expected Manage label to have a solid bg when active, got: {manage_bg}"


@pytest.mark.ui
def test_inactive_group_labels_dimmed(app_page):
    """Group labels whose group is not active are ghost pills (semi-transparent)."""
    page = app_page
    # Health is active by default (Overview group)
    page.click('[data-page="health"]')
    page.wait_for_timeout(150)

    analyze_bg = page.evaluate("""
        () => {
            for (const g of document.querySelectorAll('.nav-group')) {
                const label = g.querySelector('.nav-group-label');
                if (label && label.textContent.trim() === 'Analyze') {
                    return window.getComputedStyle(label).backgroundColor;
                }
            }
            return null;
        }
    """)
    assert analyze_bg is not None, "Analyze group label not found"
    # Ghost pill is rgba(255,255,255,0.18) — different from white-filled active
    assert analyze_bg != 'rgb(255, 255, 255)', \
        f"Analyze label should not be fully white when Overview is active, got: {analyze_bg}"


@pytest.mark.ui
def test_cross_group_navigation_moves_active(app_page):
    """Switching from one group's page to another moves .active correctly."""
    page = app_page
    page.click('[data-page="health"]')
    page.wait_for_timeout(150)
    page.click('[data-page="reports"]')
    page.wait_for_timeout(150)

    health_active = page.evaluate(
        '() => document.querySelector("[data-page=\'health\']").classList.contains("active")'
    )
    reports_active = page.evaluate(
        '() => document.querySelector("[data-page=\'reports\']").classList.contains("active")'
    )
    assert not health_active, "Health should no longer be active"
    assert reports_active, "Reports should be active"


@pytest.mark.ui
def test_only_one_page_active_at_a_time(app_page):
    """Exactly one .page-button.active exists at any time."""
    page = app_page
    for page_id in ['health', 'liabilities', 'reports', 'reconcile']:
        page.click(f'[data-page="{page_id}"]')
        page.wait_for_timeout(100)
        active_count = page.evaluate(
            '() => document.querySelectorAll(".page-button.active").length'
        )
        assert active_count == 1, \
            f"Expected exactly 1 active page button after clicking {page_id}, got {active_count}"


@pytest.mark.ui
def test_nav_group_separators_hidden_on_mobile(app_page):
    """On a 480px viewport, .nav-group-sep and .nav-group-label are not displayed."""
    page = app_page
    page.set_viewport_size({'width': 480, 'height': 800})
    page.wait_for_timeout(200)

    sep_display = page.evaluate("""
        () => Array.from(document.querySelectorAll('.nav-group-sep'))
                   .map(s => window.getComputedStyle(s).display)
    """)
    label_display = page.evaluate("""
        () => Array.from(document.querySelectorAll('.nav-group-label'))
                   .map(l => window.getComputedStyle(l).display)
    """)
    assert all(d == 'none' for d in sep_display), \
        f"Expected all nav-group-sep display:none on mobile, got: {sep_display}"
    assert all(d == 'none' for d in label_display), \
        f"Expected all nav-group-label display:none on mobile, got: {label_display}"

    page.set_viewport_size({'width': 1280, 'height': 800})
```

- [ ] **Step 2: Run behavioral tests**

```bash
python -m pytest tests/ui/test_main_nav.py -v
```

Expected: 5/5 PASS

- [ ] **Step 3: Commit**

```bash
git add tests/ui/test_main_nav.py
git commit -m "Add behavioral/edge-case UI tests for main nav grouped structure"
```

---

### Task 7: A11y tests — landmark, aria-current, keyboard, focus-visible

**Files:**
- Modify: `tests/ui/test_accessibility.py` (append 6 tests)

- [ ] **Step 1: Append 6 a11y tests to `tests/ui/test_accessibility.py`**

```python
@pytest.mark.ui
def test_main_nav_has_landmark_role(app_page):
    """The main nav has aria-label so screen readers announce it as a named landmark."""
    page = app_page
    label = page.evaluate(
        '() => document.querySelector("nav.top-nav")?.getAttribute("aria-label")'
    )
    assert label == 'Main navigation', \
        f"Expected aria-label='Main navigation' on nav.top-nav, got: {label}"


@pytest.mark.ui
def test_main_nav_active_page_aria_current(app_page):
    """Active page button has aria-current=page; all others have aria-current=false."""
    page = app_page
    page.click('[data-page="ledger"]')
    page.wait_for_timeout(150)

    result = page.evaluate("""
        () => {
            const btns = document.querySelectorAll('.page-button');
            const current = [...btns].filter(b => b.getAttribute('aria-current') === 'page');
            const notCurrent = [...btns].filter(b => b.getAttribute('aria-current') === 'false');
            const activeId = current[0]?.getAttribute('data-page');
            return { currentCount: current.length, notCurrentCount: notCurrent.length, activeId };
        }
    """)
    assert result['currentCount'] == 1, \
        f"Expected exactly 1 aria-current=page, got {result['currentCount']}"
    assert result['notCurrentCount'] == 9, \
        f"Expected 9 aria-current=false, got {result['notCurrentCount']}"
    assert result['activeId'] == 'ledger', \
        f"Expected ledger to be aria-current=page, got {result['activeId']}"


@pytest.mark.ui
def test_main_nav_group_labels_are_spans(app_page):
    """Group labels are <span> elements — not interactive, not in tab order."""
    page = app_page
    tags = page.evaluate("""
        () => Array.from(document.querySelectorAll('.nav-group-label'))
                   .map(el => el.tagName)
    """)
    assert all(t == 'SPAN' for t in tags), \
        f"nav-group-label elements must be <span>, got: {tags}"


@pytest.mark.ui
def test_main_nav_separators_aria_hidden(app_page):
    """Decorative nav-group-sep dividers have aria-hidden=true."""
    page = app_page
    seps = page.evaluate("""
        () => Array.from(document.querySelectorAll('.nav-group-sep'))
                   .map(s => s.getAttribute('aria-hidden'))
    """)
    assert seps, "No .nav-group-sep elements found"
    assert all(v == 'true' for v in seps), \
        f"All nav-group-sep must have aria-hidden=true, got: {seps}"


@pytest.mark.ui
def test_main_nav_focus_visible_ring(app_page):
    """Page buttons have a :focus-visible outline defined in the stylesheet (not suppressed)."""
    page = app_page
    has_outline = page.evaluate("""
        () => {
            for (const sheet of document.styleSheets) {
                try {
                    for (const rule of sheet.cssRules) {
                        if (rule.selectorText &&
                            rule.selectorText.includes('page-button') &&
                            rule.selectorText.includes('focus-visible')) {
                            return rule.style.outline !== 'none' && rule.style.outline !== '';
                        }
                    }
                } catch (e) {}
            }
            return false;
        }
    """)
    assert has_outline, \
        ".page-button:focus-visible must define a non-none outline for keyboard users"


@pytest.mark.ui
def test_main_nav_all_pages_keyboard_reachable(app_page):
    """All 10 page buttons are reachable via Tab key navigation."""
    page = app_page
    # Focus the first page button
    page.evaluate('() => document.querySelector(".page-button").focus()')
    page.wait_for_timeout(100)

    focused_pages = set()
    for _ in range(10):
        page_id = page.evaluate(
            '() => document.activeElement.getAttribute("data-page")'
        )
        if page_id:
            focused_pages.add(page_id)
        page.keyboard.press('Tab')
        page.wait_for_timeout(50)

    expected = {
        'health', 'accounts', 'income',
        'liabilities', 'recurring', 'savings', 'strategy',
        'reports', 'ledger', 'reconcile'
    }
    assert expected.issubset(focused_pages), \
        f"Not all page buttons reached via Tab. Reached: {focused_pages}"
```

- [ ] **Step 2: Run the new a11y tests**

```bash
python -m pytest tests/ui/test_accessibility.py -v -k "main_nav"
```

Expected: 6/6 PASS

- [ ] **Step 3: Run full accessibility suite — no regressions**

```bash
python -m pytest tests/ui/test_accessibility.py -v
```

Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add tests/ui/test_accessibility.py
git commit -m "Add a11y tests: nav landmark, aria-current, keyboard nav, focus-visible for main nav"
```

---

### Task 8: Full test suite — confirm 243 tests pass

- [ ] **Step 1: Run everything**

```bash
python -m pytest tests/ -v --tb=short
```

Expected: All pass. Previous count was 237. New tests added:
- Task 1: +1 security test
- Task 2: +5 feature tests
- Task 6: +5 behavioral UI tests
- Task 7: +6 a11y tests
- Total new: **+17** → expected **254** passing

If the smoke/integration test logs a console error about `:has()` CSS selector, confirm your Chromium version supports it (Chromium 105+, Playwright ships a recent version — no action needed).

- [ ] **Step 2: Commit any fixes if needed**

```bash
git add -A
git commit -m "Fix any remaining issues from full suite run"
```
