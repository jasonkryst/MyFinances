"""
Tests for issue #271: PNG chart export.

exportChartsAsPng(app) (src/dataExport.js) iterates every currently-visible
<canvas> on the page and triggers a sequential PNG download per canvas,
named from a kebab-cased version of the canvas id plus today's date. It
deliberately adds no markup to any chart view itself (that approach - a
per-chart overlay button - was tried and rolled back same-day in commit
5f57181 for cluttering the chart views); the only new UI is a single button
inside the Backup & Restore modal (see tests/ui/test_data_transfer_modal.py).

"Visible" means `offsetParent !== null` - not hidden by a `display: none`
ancestor (page-section, tab-panel, or a `.hidden`-classed card). These tests
don't assume anything about which real charts happen to be on the default
landing page; they inject/hide synthetic canvases instead so behavior is
exercised deterministically regardless of app data state.
"""

import re
import pytest


# ─────────────────────────── positive tests ───────────────────────────

@pytest.mark.feature
def test_exports_visible_canvases_with_kebab_cased_filenames(app_page):
    """A visible canvas is included; its filename is the kebab-cased id plus
    today's ISO date."""
    page = app_page

    result = page.evaluate("""async () => {
        const mod = await import('/src/dataExport.js');

        const visible = document.createElement('canvas');
        visible.id = 'testPngVisibleChart';
        visible.width = 10;
        visible.height = 10;
        document.body.appendChild(visible);

        const downloads = [];
        const origClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
            downloads.push({ download: this.download, hrefStart: this.href.slice(0, 21) });
        };

        try {
            const expectedVisible = Array.from(document.querySelectorAll('canvas'))
                .filter(c => c.id && c.offsetParent !== null).length;
            const count = mod.exportChartsAsPng(window.app);
            await new Promise(r => setTimeout(r, expectedVisible * 150 + 400));
            return { count, expectedVisible, downloads };
        } finally {
            HTMLAnchorElement.prototype.click = origClick;
            document.body.removeChild(visible);
        }
    }""")

    assert result['count'] == result['expectedVisible'], \
        "returned count should equal the number of canvases with a non-null offsetParent"
    assert len(result['downloads']) == result['count'], \
        "every visible canvas should have triggered exactly one download click"

    matching = [d for d in result['downloads'] if d['download'].startswith('test-png-visible-chart-')]
    assert len(matching) == 1, f"expected one download named test-png-visible-chart-<date>.png, got: {result['downloads']}"
    assert re.match(r'^test-png-visible-chart-\d{4}-\d{2}-\d{2}\.png$', matching[0]['download'])
    assert matching[0]['hrefStart'] == 'data:image/png;base64'


@pytest.mark.feature
def test_hidden_canvas_is_excluded_from_export(app_page):
    """A canvas inside a display:none ancestor is not exported, even though
    it has a valid chart id."""
    page = app_page

    result = page.evaluate("""async () => {
        const mod = await import('/src/dataExport.js');

        const wrap = document.createElement('div');
        wrap.style.display = 'none';
        const hidden = document.createElement('canvas');
        hidden.id = 'testPngHiddenChart';
        wrap.appendChild(hidden);
        document.body.appendChild(wrap);

        const downloads = [];
        const origClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };

        try {
            mod.exportChartsAsPng(window.app);
            await new Promise(r => setTimeout(r, 600));
            return { downloads };
        } finally {
            HTMLAnchorElement.prototype.click = origClick;
            document.body.removeChild(wrap);
        }
    }""")

    assert not any('test-png-hidden-chart' in d for d in result['downloads']), \
        "a canvas hidden by a display:none ancestor must not be exported"


# ─────────────────────────── negative tests ───────────────────────────

@pytest.mark.feature
def test_no_visible_canvases_exports_nothing(app_page):
    """With every canvas on the page hidden, exportChartsAsPng returns 0 and
    triggers no downloads."""
    page = app_page

    result = page.evaluate("""async () => {
        const mod = await import('/src/dataExport.js');
        const canvases = Array.from(document.querySelectorAll('canvas'));
        const prevDisplay = canvases.map(c => c.style.display);
        canvases.forEach(c => { c.style.display = 'none'; });

        let downloadFired = false;
        const origClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () { downloadFired = true; };

        try {
            const count = mod.exportChartsAsPng(window.app);
            await new Promise(r => setTimeout(r, 300));
            return { count, downloadFired };
        } finally {
            HTMLAnchorElement.prototype.click = origClick;
            canvases.forEach((c, i) => { c.style.display = prevDisplay[i]; });
        }
    }""")

    assert result['count'] == 0
    assert result['downloadFired'] is False


@pytest.mark.feature
def test_canvas_without_id_is_excluded(app_page):
    """A visible canvas with no id attribute is skipped (nothing to derive a
    filename from)."""
    page = app_page

    result = page.evaluate("""async () => {
        const mod = await import('/src/dataExport.js');
        const canvases = Array.from(document.querySelectorAll('canvas'));
        const prevDisplay = canvases.map(c => c.style.display);
        canvases.forEach(c => { c.style.display = 'none'; });

        const noId = document.createElement('canvas');
        noId.width = 5;
        noId.height = 5;
        document.body.appendChild(noId);

        let downloadFired = false;
        const origClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () { downloadFired = true; };

        try {
            const count = mod.exportChartsAsPng(window.app);
            await new Promise(r => setTimeout(r, 300));
            return { count, downloadFired };
        } finally {
            HTMLAnchorElement.prototype.click = origClick;
            document.body.removeChild(noId);
            canvases.forEach((c, i) => { c.style.display = prevDisplay[i]; });
        }
    }""")

    assert result['count'] == 0
    assert result['downloadFired'] is False
