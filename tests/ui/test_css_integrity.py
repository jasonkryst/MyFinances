"""
Stylesheet integrity guard.

Parallel branches append their CSS sections to the end of styles.css, so
merges keep conflicting at the same seam, and hand-resolving that seam has
twice dropped a single delimiter:

  * a lost ``}`` (light-mode table headers went white-on-white), and
  * a lost ``/*`` comment opener (#432): the banner text became part of the
    next selector, Chromium discarded the rule, and phone-only toggles showed
    on desktop.

CSS reports neither as an error. This file checks every first-party
stylesheet in two layers:

  1. A static scanner (pure Python) for structural damage: stray ``*/``,
     unclosed comments/blocks, unmatched ``}``, stray text between rules,
     style rules nested inside style rules (native CSS nesting is valid now,
     so a lost ``}`` silently re-parents the next rule; this codebase never
     uses nesting), and non-ASCII prose inside a selector.
  2. A Chromium cross-check: each top-level block is parsed on its own with
     ``CSSStyleSheet.replaceSync`` and must yield exactly the rules the scanner
     counted, so a rule the browser silently drops is reported by line.
"""

import os

import pytest

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STYLESHEETS = ['styles.css', 'styles-csp-classes.css', 'guide.css']

# At-rules whose block holds rules rather than declarations.
GROUPING_AT_RULES = {'media', 'supports', 'container', 'layer', 'document', 'scope', 'starting-style'}


def scan_css(text):
    """Return ``(problems, top_level_blocks)``.

    ``problems`` is a list of human-readable strings with line numbers.
    ``top_level_blocks`` is a list of ``(line, source, rule_count)`` tuples,
    one per top-level block, where ``rule_count`` counts the block itself plus
    every rule nested in it (the number the CSSOM should report).
    """
    problems = []
    blocks = []
    stack = []          # entries: [kind, line, prelude]
    prelude = []        # characters since the last ; { or }
    line = 1
    comment_start = None
    quote = None
    top_start = None    # index in text where the current top-level block's prelude began
    top_line = None
    top_count = 0
    i, n = 0, len(text)

    def prelude_text():
        return ' '.join(''.join(prelude).split())

    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ''

        if comment_start is not None:
            if ch == '*' and nxt == '/':
                comment_start = None
                i += 2
                continue
            if ch == '\n':
                line += 1
            i += 1
            continue

        if quote:
            prelude.append(ch)
            if ch == '\\' and nxt:
                prelude.append(nxt)
                i += 2
                continue
            if ch == quote:
                quote = None
            elif ch == '\n':
                line += 1
            i += 1
            continue

        if ch == '/' and nxt == '*':
            comment_start = line
            i += 2
            continue
        if ch == '*' and nxt == '/':
            problems.append(f"line {line}: stray '*/' outside a comment (lost '/*' opener?)")
            i += 2
            continue
        if ch in ('"', "'"):
            quote = ch
            prelude.append(ch)
            i += 1
            continue
        if ch == '\n':
            line += 1

        if not stack and top_start is None and not ch.isspace():
            top_start, top_line = i, line

        if ch == '{':
            sel = prelude_text()
            parent = stack[-1][0] if stack else None
            if parent == 'keyframes':
                kind = 'keyframe'
            elif sel.startswith('@'):
                name = sel[1:].split(None, 1)[0].split('(', 1)[0].lower() if len(sel) > 1 else ''
                if name in GROUPING_AT_RULES:
                    kind = 'group'
                elif name.endswith('keyframes'):
                    kind = 'keyframes'
                else:
                    kind = 'rule'   # @font-face, @page, ... hold declarations
            else:
                kind = 'rule'
                if not sel:
                    problems.append(f"line {line}: block with an empty selector")
                elif any(ord(c) > 127 for c in sel):
                    problems.append(
                        f"line {line}: selector contains non-ASCII text (comment text leaked "
                        f"into a selector?): {sel[:80]!r}")
            if parent in ('rule', 'keyframe'):
                problems.append(
                    f"line {line}: '{sel[:60]}' is nested inside '{stack[-1][2][:60]}' "
                    f"(opened line {stack[-1][1]}) - lost closing brace?")
            stack.append([kind, line, sel])
            top_count += 1
            prelude = []
            i += 1
            continue

        if ch == '}':
            if not stack:
                problems.append(f"line {line}: unmatched '}}'")
            else:
                kind = stack[-1][0]
                leftover = prelude_text()
                if kind in ('group', 'keyframes') and leftover:
                    problems.append(f"line {line}: stray text before '}}': {leftover[:80]!r}")
                stack.pop()
                if not stack:
                    blocks.append((top_line, text[top_start:i + 1], top_count))
                    top_start, top_count = None, 0
            prelude = []
            i += 1
            continue

        if ch == ';':
            if not stack or stack[-1][0] in ('group', 'keyframes'):
                statement = prelude_text()
                if not statement.startswith('@'):
                    problems.append(f"line {line}: stray text outside any rule: {statement[:80]!r}")
                elif not stack:
                    # Top-level statement at-rule (@charset/@import): not a block.
                    top_start = None
            prelude = []
            i += 1
            continue

        prelude.append(ch)
        i += 1

    if comment_start is not None:
        problems.append(f"line {comment_start}: comment is never closed")
    for kind, open_line, sel in stack:
        problems.append(f"line {open_line}: block '{sel[:60]}' is never closed")
    trailing = prelude_text()
    if trailing and not stack:
        problems.append(f"end of file: stray text outside any rule: {trailing[:80]!r}")
    return problems, blocks


def _read(name):
    with open(os.path.join(PROJECT_ROOT, name), encoding='utf-8') as f:
        return f.read()


def _rules_dropped_by_browser(page, blocks):
    """Parse each top-level block alone in Chromium; describe any whose CSSOM
    rule count differs from the scanner's."""
    counts = page.evaluate("""(sources) => {
        const count = (rules) => {
            let total = 0;
            for (const r of rules) total += 1 + (r.cssRules ? count(r.cssRules) : 0);
            return total;
        };
        return sources.map((src) => {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(src);
            return count(sheet.cssRules);
        });
    }""", [b[1] for b in blocks])
    return [
        f"line {line}: expected {want} rule(s), browser kept {got}: {src.splitlines()[0][:80]!r}"
        for (line, src, want), got in zip(blocks, counts) if got != want
    ]


# ─────────────────────────── scanner self-tests ───────────────────────────
# Each reproduces a real or likely merge-seam breakage, so the scanner can't
# silently regress into accepting it.

@pytest.mark.ui
def test_scanner_accepts_well_formed_css():
    css = """
/* banner
   ════ */
.a, .b > .c::before { content: "\\25BE }"; color: red; }
@media (max-width: 768px) {
    .a { display: none; }
    @supports (display: grid) { .b { display: grid; } }
}
@keyframes spin { from { transform: rotate(0); } 50% { opacity: .5; } to { transform: rotate(1turn); } }
@font-face { font-family: X; src: url("x;y.woff2"); }
"""
    problems, blocks = scan_css(css)
    assert problems == []
    assert [b[2] for b in blocks] == [1, 4, 4, 1]


@pytest.mark.ui
def test_scanner_flags_lost_comment_opener():
    css = """
#deleteConfirmModal { z-index: 10010; }

   UX C (#428) — mobile density: filter disclosures,
   ═══════════════ */

.toggle { display: none; }
"""
    problems, _ = scan_css(css)
    assert any("stray '*/'" in p for p in problems), problems
    assert any('non-ASCII' in p for p in problems), problems


@pytest.mark.ui
def test_scanner_flags_lost_closing_brace():
    css = """
.ledger-table th {
    color: #fff;

.ledger-table td { color: #000; }
"""
    problems, _ = scan_css(css)
    assert any('nested inside' in p for p in problems), problems
    assert any('never closed' in p for p in problems), problems


@pytest.mark.ui
def test_scanner_flags_lost_media_closing_brace_and_extra_brace():
    problems, _ = scan_css("@media (max-width: 768px) {\n  .a { color: red; }\n")
    assert any('never closed' in p for p in problems), problems
    problems, _ = scan_css(".a { color: red; }\n}\n")
    assert any("unmatched '}'" in p for p in problems), problems


@pytest.mark.ui
def test_scanner_flags_unclosed_comment():
    problems, _ = scan_css(".a { color: red; }\n/* half a banner\n.b { color: blue; }\n")
    assert any('comment is never closed' in p for p in problems), problems


# ─────────────────────────── real stylesheets ───────────────────────────

@pytest.mark.ui
@pytest.mark.parametrize('name', STYLESHEETS)
def test_stylesheet_is_structurally_sound(name):
    problems, _ = scan_css(_read(name))
    assert not problems, f"{name} has structural damage:\n  " + "\n  ".join(problems)


@pytest.mark.ui
@pytest.mark.parametrize('name', STYLESHEETS)
def test_browser_keeps_every_rule(page, name):
    """Chromium must keep every rule the scanner sees; a dropped rule means an
    invalid selector or at-rule that the browser silently discarded."""
    _, blocks = scan_css(_read(name))
    assert blocks, f"scanner found no rules in {name}"
    dropped = _rules_dropped_by_browser(page, blocks)
    assert not dropped, f"Chromium discarded rules in {name}:\n  " + "\n  ".join(dropped)


@pytest.mark.ui
def test_browser_check_detects_a_dropped_rule(page):
    """Self-test: an invalid selector the scanner can't see is still caught."""
    _, blocks = scan_css(".ok { color: red; }\n.a:not-a-real-pseudo { display: none; }\n")
    dropped = _rules_dropped_by_browser(page, blocks)
    assert len(dropped) == 1 and dropped[0].startswith('line 2:'), dropped
