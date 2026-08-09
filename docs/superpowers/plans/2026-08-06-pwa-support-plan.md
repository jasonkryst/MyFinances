# PWA Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MyFinances installable (Add to Home Screen / desktop install) and able to load with zero network connectivity after a first visit, via a web app manifest, a generated icon set, and a service worker — no framework, no build step, no new runtime dependencies.

**Architecture:** Four new static pieces sit alongside the existing no-build vanilla-JS app: `manifest.json` (installability metadata), `icons/*.png` (generated once by a zero-dependency Node script), `sw.js` (a classic, root-scoped service worker that precaches the app shell and runtime-caches the Chart.js CDN script), and `src/serviceWorker.js` (registration + update-prompt wiring, following the existing `app.js`/feature-module delegation pattern).

**Tech Stack:** Vanilla JS (ES modules + one classic script), Node's built-in `zlib` (icon generation only, dev-time), Playwright/pytest (tests), nginx (deploy).

## Global Constraints

- No new runtime dependencies — the shipped app stays framework-free, build-step-free (per `CLAUDE.md`).
- `sw.js` must live at the repo root (not `src/`) so its default scope covers `/`.
- Cache versioning: `sw.js`'s `CACHE_NAME` must contain the current `APP_VERSION` (`src/utils.js`) — every version bump invalidates old caches.
- New service worker versions must wait for explicit user reload (no `skipWaiting()`/`clients.claim()` on `activate`) — per the approved design's "prompt to reload" decision.
- CSP is unchanged — `sw.js` is same-origin (`script-src 'self'` already covers it); its one cross-origin fetch (`cdn.jsdelivr.net`) is already covered by `connect-src`.
- Every feature module function takes `app` as its first argument; every new `DebtTrackerApp` method is a one-line delegating wrapper — follow this exactly (see `CLAUDE.md`).
- All new persisted/rendered strings must not use `innerHTML` with unescaped data (N/A here — no user data flows through this feature at all).
- Full design reference: `docs/superpowers/specs/2026-08-06-pwa-support-design.md`.

---

### Task 1: Generate PWA icon assets

**Files:**
- Create: `tools/generate-icons.js`
- Create (generated output, committed): `icons/icon-192.png`, `icons/icon-512.png`, `icons/icon-maskable-512.png`, `icons/favicon-32.png`
- Test: `tests/features/test_pwa_icons.py`

**Interfaces:**
- Produces: four PNG files under `icons/`, at fixed pixel dimensions (192×192, 512×512, 512×512, 32×32). Task 2 (`manifest.json`, `index.html`) and Task 3 (`sw.js` precache list) reference these exact paths.

- [ ] **Step 1: Write the failing test**

Create `tests/features/test_pwa_icons.py`:

```python
#!/usr/bin/env python3
"""
PWA icon asset checks (GitHub issue #75).

tools/generate-icons.js is a zero-dependency Node script that rasterizes the
existing header goal-logo into the PNG icon set referenced by manifest.json.
These tests parse the PNG files' IHDR chunk directly (no Pillow/image-library
dependency, consistent with the app's own zero-new-deps constraint) to catch
a wrong size or a missing/corrupt file, rather than trusting the script ran
correctly.
"""

import os
import struct

import pytest

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ICONS_DIR = os.path.join(PROJECT_ROOT, 'icons')

PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'


def _read_png_dimensions(path):
    """Parse a PNG file's IHDR chunk for (width, height). Returns None if not a valid PNG."""
    with open(path, 'rb') as f:
        header = f.read(33)
    if header[:8] != PNG_SIGNATURE:
        return None
    if header[12:16] != b'IHDR':
        return None
    width, height = struct.unpack('>II', header[16:24])
    return (width, height)


EXPECTED_ICONS = [
    ('icon-192.png', 192, 192),
    ('icon-512.png', 512, 512),
    ('icon-maskable-512.png', 512, 512),
    ('favicon-32.png', 32, 32),
]


# --- Positive cases: the real generated icon files must be correct ---

@pytest.mark.feature
@pytest.mark.parametrize('filename,expected_w,expected_h', EXPECTED_ICONS)
def test_icon_file_exists_with_correct_dimensions(filename, expected_w, expected_h):
    path = os.path.join(ICONS_DIR, filename)
    assert os.path.isfile(path), f"Missing icon file: icons/{filename} (run `node tools/generate-icons.js`)"

    dims = _read_png_dimensions(path)
    assert dims is not None, f"icons/{filename} is not a valid PNG file"
    assert dims == (expected_w, expected_h), (
        f"icons/{filename} is {dims[0]}x{dims[1]}, expected {expected_w}x{expected_h}"
    )


@pytest.mark.feature
def test_icon_files_are_non_trivial_size():
    """A 0-byte or near-empty file would still pass a naive existence check; make sure there's real pixel data."""
    for filename, _, _ in EXPECTED_ICONS:
        path = os.path.join(ICONS_DIR, filename)
        size = os.path.getsize(path)
        assert size > 200, f"icons/{filename} is suspiciously small ({size} bytes) -- likely not real image data"


# --- Negative cases: the parsing helper itself must reject bad input, not silently pass ---

@pytest.mark.feature
def test_dimension_parser_rejects_wrong_signature(tmp_path):
    """A file that isn't a PNG at all (wrong magic bytes) must be reported as invalid, not crash or misparse."""
    fake = tmp_path / "not-a-png.png"
    fake.write_bytes(b'GIF89a' + b'\x00' * 40)
    assert _read_png_dimensions(str(fake)) is None


@pytest.mark.feature
def test_dimension_parser_rejects_truncated_file(tmp_path):
    """A truncated/corrupt PNG (valid signature, no IHDR chunk) must be reported as invalid."""
    fake = tmp_path / "truncated.png"
    fake.write_bytes(PNG_SIGNATURE)
    assert _read_png_dimensions(str(fake)) is None


@pytest.mark.feature
def test_dimension_parser_reads_known_dimensions_correctly(tmp_path):
    """Hand-construct a minimal valid IHDR chunk for a 10x20 image and confirm the parser reads it
    back exactly -- guards against a future refactor silently reading width/height out of order or
    with the wrong endianness."""
    fake = tmp_path / "ten-by-twenty.png"
    ihdr_data = struct.pack('>IIBBBBB', 10, 20, 8, 6, 0, 0, 0)
    fake.write_bytes(PNG_SIGNATURE + struct.pack('>I', len(ihdr_data)) + b'IHDR' + ihdr_data)
    assert _read_png_dimensions(str(fake)) == (10, 20)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/features/test_pwa_icons.py -v`
Expected: the four `test_icon_file_exists_with_correct_dimensions` cases and `test_icon_files_are_non_trivial_size` FAIL with "Missing icon file" (the `icons/` directory doesn't exist yet); the three parser-only negative tests PASS already (they don't depend on the generated files).

- [ ] **Step 3: Write the icon generator**

Create `tools/generate-icons.js`:

```js
#!/usr/bin/env node
'use strict';

/**
 * Generates the PWA icon set (icons/*.png) by rasterizing the header
 * goal-logo (see index.html's inline <svg class="logo-svg">, viewBox
 * "0 0 32 32") using only Node's built-in `zlib` -- no image library, no
 * new dependency. Not run in CI; regenerate manually if the logo changes
 * and commit the output, same as a designer re-exporting PNGs.
 *
 * Usage: node tools/generate-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// --- Minimal PNG encoder (8-bit RGBA, no interlacing) ---

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgbaPixels) {
    const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData[8] = 8;  // bit depth
    ihdrData[9] = 6;  // color type: RGBA
    ihdrData[10] = 0; // compression method
    ihdrData[11] = 0; // filter method
    ihdrData[12] = 0; // interlace method
    const ihdr = pngChunk('IHDR', ihdrData);

    // Every scanline is prefixed with a filter-type byte (0 = None).
    const raw = Buffer.alloc(height * (1 + width * 4));
    for (let y = 0; y < height; y++) {
        const rowStart = y * (1 + width * 4);
        raw[rowStart] = 0;
        rgbaPixels.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
    }
    const idat = pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 }));
    const iend = pngChunk('IEND', Buffer.alloc(0));

    return Buffer.concat([signature, ihdr, idat, iend]);
}

// --- Pixel canvas helpers ---

function createCanvas(size) {
    return Buffer.alloc(size * size * 4, 0); // fully transparent RGBA
}

function setPixel(canvas, size, x, y, [r, g, b, a]) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    canvas[i] = r; canvas[i + 1] = g; canvas[i + 2] = b; canvas[i + 3] = a;
}

function fillBackground(canvas, size, [r, g, b]) {
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) setPixel(canvas, size, x, y, [r, g, b, 255]);
    }
}

function drawCircle(canvas, size, cx, cy, r, fill, stroke, strokeWidth) {
    const rOuter = r + strokeWidth / 2;
    const rInner = r - strokeWidth / 2;
    for (let y = Math.floor(cy - rOuter - 1); y <= Math.ceil(cy + rOuter + 1); y++) {
        for (let x = Math.floor(cx - rOuter - 1); x <= Math.ceil(cx + rOuter + 1); x++) {
            const d = Math.hypot(x - cx, y - cy);
            if (fill && d <= r - strokeWidth / 2) {
                setPixel(canvas, size, x, y, fill);
            } else if (stroke && d >= rInner && d <= rOuter) {
                setPixel(canvas, size, x, y, stroke);
            }
        }
    }
}

function drawLine(canvas, size, x1, y1, x2, y2, width, color) {
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2));
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const cx = x1 + (x2 - x1) * t;
        const cy = y1 + (y2 - y1) * t;
        for (let dx = -width / 2; dx <= width / 2; dx += 0.5) {
            for (let dy = -width / 2; dy <= width / 2; dy += 0.5) {
                if (Math.hypot(dx, dy) <= width / 2) {
                    setPixel(canvas, size, cx + dx, cy + dy, color);
                }
            }
        }
    }
}

const BLUE = [37, 99, 235, 255];        // #2563eb
const LIGHT_BLUE = [224, 231, 255, 255]; // #e0e7ff
const WHITE = [255, 255, 255, 255];

// Draws the header goal-logo (matches index.html's inline <svg class="logo-svg">,
// viewBox 0 0 32 32) into a size x size canvas, scaled by size/32. When
// maskableSafeZone is set, the logo is shrunk to 70% and centered, with the
// rest of the canvas filled opaque white, per Android's maskable-icon spec.
function drawLogo(canvas, size, { maskableSafeZone = false } = {}) {
    const s = (maskableSafeZone ? size * 0.7 : size) / 32;
    const offset = maskableSafeZone ? (size - 32 * s) / 2 : 0;
    const cx = offset + 16 * s;
    const cy = offset + 16 * s;

    drawCircle(canvas, size, cx, cy, 15 * s, LIGHT_BLUE, BLUE, 2 * s);
    drawCircle(canvas, size, cx, cy, 8 * s, null, BLUE, 2 * s);
    drawCircle(canvas, size, cx, cy, 3 * s, BLUE, null, 0);
    drawLine(canvas, size, cx, offset + 3 * s, cx, offset + 8 * s, 2 * s, BLUE);
    drawLine(canvas, size, cx, offset + 24 * s, cx, offset + 29 * s, 2 * s, BLUE);
    drawLine(canvas, size, offset + 3 * s, cy, offset + 8 * s, cy, 2 * s, BLUE);
    drawLine(canvas, size, offset + 24 * s, cy, offset + 29 * s, cy, 2 * s, BLUE);
}

function generateIcon(size, outPath, { maskable = false } = {}) {
    const canvas = createCanvas(size);
    if (maskable) fillBackground(canvas, size, WHITE);
    drawLogo(canvas, size, { maskableSafeZone: maskable });
    fs.writeFileSync(outPath, encodePNG(size, size, canvas));
    console.log(`Wrote ${outPath}`);
}

const iconsDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

generateIcon(192, path.join(iconsDir, 'icon-192.png'));
generateIcon(512, path.join(iconsDir, 'icon-512.png'));
generateIcon(512, path.join(iconsDir, 'icon-maskable-512.png'), { maskable: true });
generateIcon(32, path.join(iconsDir, 'favicon-32.png'));
```

- [ ] **Step 4: Run the generator**

Run (Node is via nvm, not on PATH by default in this environment):
```bash
PATH="/c/nvm/v26.5.1:$PATH" node tools/generate-icons.js
```
Expected output: four `Wrote ...` lines, one per icon file, and `icons/icon-192.png`, `icons/icon-512.png`, `icons/icon-maskable-512.png`, `icons/favicon-32.png` exist on disk.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/features/test_pwa_icons.py -v`
Expected: PASS (all 7 tests).

- [ ] **Step 6: Commit**

```bash
git add tools/generate-icons.js icons/ tests/features/test_pwa_icons.py
git commit -m "Add generated PWA icon set (#75)"
```

---

### Task 2: Add web app manifest and wire it into `index.html`

**Files:**
- Create: `manifest.json`
- Modify: `index.html:13-14` (insert new `<link>`/`<meta>` tags inside `<head>`)
- Test: `tests/features/test_pwa.py` (new file)

**Interfaces:**
- Consumes: `icons/icon-192.png`, `icons/icon-512.png`, `icons/icon-maskable-512.png`, `icons/favicon-32.png` (Task 1).
- Produces: `manifest.json` at repo root, referenced by `index.html`. Task 3 (`sw.js`) precaches `manifest.json` and the icon files as part of the app shell.

- [ ] **Step 1: Write the failing test**

Create `tests/features/test_pwa.py`:

```python
#!/usr/bin/env python3
"""
PWA (installability + offline) tests for GitHub issue #75.

Covers manifest.json validity, the index.html tags that reference it, the
service worker's precache list staying in sync with the real src/ directory
and APP_VERSION, and that the service worker actually registers in a real
browser (with a negative case for browsers that don't support it at all).
Deploy-config checks (Dockerfile/nginx) live in tests/security/test_static_scan.py
alongside the other Docker/nginx-adjacent checks; offline behavior lives in
tests/integration/test_pwa_offline.py; the update banner lives in
tests/ui/test_pwa_update_banner.py.
"""

import json
import os
import re

import pytest

from tests.conftest import assert_no_errors

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture
def manifest_json():
    path = os.path.join(PROJECT_ROOT, 'manifest.json')
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


@pytest.fixture
def index_html_content():
    path = os.path.join(PROJECT_ROOT, 'index.html')
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


# --- manifest.json + index.html wiring ---

REQUIRED_MANIFEST_FIELDS = [
    'name', 'short_name', 'start_url', 'scope', 'display',
    'background_color', 'theme_color', 'icons',
]


@pytest.mark.feature
def test_manifest_has_required_fields(manifest_json):
    for field in REQUIRED_MANIFEST_FIELDS:
        assert field in manifest_json, f"manifest.json is missing required field '{field}'"
    assert len(manifest_json['icons']) >= 2, "manifest.json should declare at least two icon sizes"


@pytest.mark.feature
def test_manifest_icons_resolve_to_committed_files(manifest_json):
    for icon in manifest_json['icons']:
        icon_path = os.path.join(PROJECT_ROOT, icon['src'])
        assert os.path.isfile(icon_path), f"manifest.json references '{icon['src']}' but that file doesn't exist"


@pytest.mark.feature
def test_index_html_links_manifest_and_icons(index_html_content):
    assert '<link rel="manifest" href="manifest.json">' in index_html_content
    assert 'rel="icon"' in index_html_content
    assert 'rel="apple-touch-icon"' in index_html_content
    assert 'name="theme-color"' in index_html_content


@pytest.mark.feature
def test_required_field_check_catches_incomplete_manifest():
    """The same required-field check must flag a manifest missing 'icons', not just pass a well-formed one."""
    broken_manifest = {
        'name': 'X', 'short_name': 'X', 'start_url': '/', 'scope': '/',
        'display': 'standalone', 'background_color': '#fff', 'theme_color': '#fff',
    }
    missing = [f for f in REQUIRED_MANIFEST_FIELDS if f not in broken_manifest]
    assert missing == ['icons']
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/features/test_pwa.py -v`
Expected: `test_manifest_has_required_fields`, `test_manifest_icons_resolve_to_committed_files` FAIL with a file-not-found error (`manifest.json` doesn't exist yet); `test_index_html_links_manifest_and_icons` FAILS (tags not present); `test_required_field_check_catches_incomplete_manifest` PASSES already (pure logic, no file dependency).

- [ ] **Step 3: Create `manifest.json`**

```json
{
  "name": "MyFinances",
  "short_name": "MyFinances",
  "description": "Privacy-first personal finance tracker — debt payoff, budgets, net worth, all data stays in your browser.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#2563eb",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 4: Wire the manifest and icons into `index.html`**

In `index.html`, immediately before the closing `</head>` tag (currently `index.html:14`), insert:

```html
    <link rel="manifest" href="manifest.json">
    <link rel="icon" href="icons/favicon-32.png">
    <link rel="apple-touch-icon" href="icons/icon-192.png">
    <meta name="theme-color" content="#2563eb">
 </head>
```

(i.e. the four new lines go right after the existing `<link rel="stylesheet" href="styles-csp-classes.css">` line and before ` </head>`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/features/test_pwa.py -v`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add manifest.json index.html tests/features/test_pwa.py
git commit -m "Add web app manifest and wire it into index.html (#75)"
```

---

### Task 3: Add the service worker (`sw.js`)

**Files:**
- Create: `sw.js`
- Test: `tests/features/test_pwa.py` (append)

**Interfaces:**
- Consumes: `manifest.json`, `icons/*.png` (Task 2), the full list of `src/**/*.js` files, `APP_VERSION` from `src/utils.js`.
- Produces: `sw.js` at repo root, listening for `install`/`activate`/`fetch`/`message` events; exports nothing (classic script, loaded via `navigator.serviceWorker.register('/sw.js')` in Task 4). Its `CACHE_NAME` constant and `PRECACHE_URLS` array are consumed by the tests below and must be kept in sync by every future change to `src/` or `APP_VERSION`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/features/test_pwa.py`:

```python
# --- sw.js precache list + versioning ---

@pytest.fixture
def sw_js_content():
    path = os.path.join(PROJECT_ROOT, 'sw.js')
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


@pytest.fixture
def app_version():
    utils_path = os.path.join(PROJECT_ROOT, 'src', 'utils.js')
    with open(utils_path, 'r', encoding='utf-8') as f:
        content = f.read()
    match = re.search(r"""export const APP_VERSION = ['"](\d+\.\d+\.\d+)['"]""", content)
    return match.group(1) if match else None


def _list_src_js_files():
    src_dir = os.path.join(PROJECT_ROOT, 'src')
    files = []
    for root, _dirs, filenames in os.walk(src_dir):
        for name in filenames:
            if name.endswith('.js'):
                rel = os.path.relpath(os.path.join(root, name), PROJECT_ROOT).replace(os.sep, '/')
                files.append('/' + rel)
    return sorted(files)


@pytest.mark.feature
def test_sw_precache_list_includes_every_src_js_file(sw_js_content):
    """Every real src/*.js file (including src/locales/*.js) must be in sw.js's PRECACHE_URLS, or that
    module 404s when the app is loaded fully offline after a first visit."""
    missing = [f for f in _list_src_js_files() if f not in sw_js_content]
    assert missing == [], f"sw.js PRECACHE_URLS is missing: {missing}"


@pytest.mark.feature
def test_sw_cache_name_matches_app_version(sw_js_content, app_version):
    assert app_version is not None, "Could not read APP_VERSION from src/utils.js"
    assert f"myfinances-v{app_version}" in sw_js_content, (
        f"sw.js's CACHE_NAME does not contain the current APP_VERSION ('{app_version}'). "
        f"Bump CACHE_NAME in sw.js alongside every APP_VERSION change, or stale assets will never be evicted."
    )


@pytest.mark.feature
def test_precache_completeness_check_catches_missing_file():
    """The same completeness check must flag a real-looking gap, not just pass anything."""
    fake_sw_content = "const PRECACHE_URLS = ['/index.html', '/src/app.js'];"
    real_files = ['/src/app.js', '/src/utils.js']
    missing = [f for f in real_files if f not in fake_sw_content]
    assert missing == ['/src/utils.js']
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/features/test_pwa.py -v -k "sw_"`
Expected: `test_sw_precache_list_includes_every_src_js_file` and `test_sw_cache_name_matches_app_version` FAIL (`sw.js` doesn't exist yet); `test_precache_completeness_check_catches_missing_file` PASSES already.

- [ ] **Step 3: Create `sw.js`**

```js
'use strict';

// Kept in sync with APP_VERSION (src/utils.js) by hand -- every version bump
// must touch this string too, or old cached assets never get evicted.
// Checked by tests/features/test_pwa.py::test_sw_cache_name_matches_app_version.
const CACHE_NAME = 'myfinances-v4.13.0';

const CDN_URL = 'https://cdn.jsdelivr.net/npm/chart.js';

// The whole app shell -- enumerated explicitly since there's no build step
// to glob these. tests/features/test_pwa.py::test_sw_precache_list_includes_every_src_js_file
// fails CI if a new src/*.js file is added here without updating this list.
const PRECACHE_URLS = [
    '/', '/index.html', '/styles.css', '/styles-csp-classes.css',
    '/guide.html', '/guide.css', '/manifest.json',
    '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/icons/favicon-32.png',
    '/src/accounts.js', '/src/app.js', '/src/bills.js', '/src/bonusAdvisor.js',
    '/src/breakEven.js', '/src/charts.js', '/src/commandPalette.js', '/src/dataExport.js',
    '/src/dataTransferModal.js', '/src/debtBreakEven.js', '/src/debtCalculator.js', '/src/debts.js',
    '/src/forecast.js', '/src/guideNav.js', '/src/guideTheme.js', '/src/health.js',
    '/src/i18n.js', '/src/income.js', '/src/ledger.js', '/src/ledgerOverrides.js',
    '/src/ledgerTransactions.js', '/src/reconciliation.js', '/src/recurring.js', '/src/reports.js',
    '/src/reportsCalendar.js', '/src/reportsCashFlow.js', '/src/reportsNetWorth.js', '/src/reportsSummary.js',
    '/src/reportsVariance.js', '/src/sanitizers.js', '/src/savings.js', '/src/serviceWorker.js',
    '/src/settings.js', '/src/setupWizard.js', '/src/spending.js', '/src/storage.js',
    '/src/storageAdapters.js', '/src/strategy.js', '/src/strategyCalendar.js', '/src/strategyComparison.js',
    '/src/strategyPlanCalculation.js', '/src/strategyScheduleTable.js', '/src/strategySummaryTable.js', '/src/ui.js',
    '/src/utils.js',
    '/src/locales/en.js', '/src/locales/es.js', '/src/locales/pl.js',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE_URLS))
            .catch((err) => console.error('[sw] precache failed', err))
    );
});

self.addEventListener('activate', (event) => {
    // Deliberately no skipWaiting()/clients.claim() here -- a new version
    // installs and waits; src/serviceWorker.js prompts the user to reload
    // instead of silently swapping assets under an open session.
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key.startsWith('myfinances-v') && key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            )
        )
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    try {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
    } catch (err) {
        // Cache write can fail (e.g. private browsing storage restrictions);
        // the app never depends on the cache being writable.
    }
    return response;
}

async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    const fetchPromise = fetch(request).then((response) => {
        cache.put(request, response.clone()).catch(() => {});
        return response;
    }).catch(() => cached);
    return cached || fetchPromise;
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    if (request.url.startsWith(CDN_URL)) {
        event.respondWith(staleWhileRevalidate(request));
    } else if (new URL(request.url).origin === self.location.origin) {
        event.respondWith(cacheFirst(request));
    }
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/features/test_pwa.py -v`
Expected: PASS (8 tests total so far).

- [ ] **Step 5: Commit**

```bash
git add sw.js tests/features/test_pwa.py
git commit -m "Add service worker with app-shell precache and CDN runtime cache (#75)"
```

---

### Task 4: Register the service worker and add the update-available banner

**Files:**
- Create: `src/serviceWorker.js`
- Modify: `src/ui.js` (add `showUpdateAvailableBanner`, after `showStorageQuotaWarning`)
- Modify: `src/app.js:85` (import), `src/app.js:515` area (delegating method), `src/app.js:856-859` (DOMContentLoaded)
- Modify: `styles-csp-classes.css` (after the `.storage-quota-banner-close` rule, ~line 480)
- Test: `tests/features/test_pwa.py` (append), `tests/ui/test_pwa_update_banner.py` (new)

**Interfaces:**
- Consumes: `sw.js` (Task 3), the `app.showStorageQuotaWarning`/`showStorageQuotaWarningFeature` wrapper pattern already in `src/app.js`/`src/ui.js`.
- Produces: `registerServiceWorker(app)` exported from `src/serviceWorker.js`; `showUpdateAvailableBanner(waitingWorker)` exported from `src/ui.js`; `app.showUpdateAvailableBanner(waitingWorker)` method on `DebtTrackerApp`. No other task depends on these.

- [ ] **Step 1: Write the failing tests**

Append to `tests/features/test_pwa.py`:

```python
# --- service worker registration ---

@pytest.mark.feature
def test_service_worker_registers_successfully(app_page):
    page = app_page
    page.wait_for_function(
        "() => navigator.serviceWorker.getRegistration().then((r) => !!r)",
        timeout=10000
    )
    assert_no_errors(page)


@pytest.mark.feature
def test_app_loads_without_error_when_service_worker_unsupported(page):
    """Simulates an old/unsupported browser (no navigator.serviceWorker at all) and confirms the
    app still loads and functions -- PWA support must be a progressive enhancement, not a hard
    dependency."""
    from tests.conftest import BASE_URL
    page.add_init_script("""
        Object.defineProperty(window.navigator, 'serviceWorker', { value: undefined, configurable: true });
        try {
            if (!localStorage.getItem('debtTrackerData')) {
                localStorage.setItem('debtTrackerData', JSON.stringify({ accounts: [], debts: [], settings: [] }));
            }
        } catch (e) {}
    """)
    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
    assert page.is_visible('h1')
    assert_no_errors(page)
```

Create `tests/ui/test_pwa_update_banner.py`:

```python
#!/usr/bin/env python3
"""
Service-worker update-available banner tests (GitHub issue #75).

The banner is triggered from src/serviceWorker.js's updatefound/statechange
listener, which is awkward to force deterministically in Playwright (it
depends on real SW lifecycle timing). Since app.showUpdateAvailableBanner(waitingWorker)
is a plain, directly-callable method (same pattern as app.showStorageQuotaWarning
in tests/features/test_storage_quota.py), these tests call it directly with a
stub waitingWorker object rather than forcing a real SW update cycle.
"""

import pytest

from tests.conftest import assert_no_errors


def _show_banner(page):
    page.evaluate("""() => {
        window.__swPostMessageCalls = window.__swPostMessageCalls || [];
        const fakeWorker = { postMessage: (msg) => window.__swPostMessageCalls.push(msg) };
        window.app.showUpdateAvailableBanner(fakeWorker);
    }""")


@pytest.mark.ui
def test_update_banner_absent_by_default(app_page):
    assert not app_page.is_visible('#swUpdateBanner')


@pytest.mark.ui
def test_update_banner_appears(app_page):
    page = app_page
    _show_banner(page)
    page.wait_for_timeout(100)

    assert page.is_visible('#swUpdateBanner'), "Expected the update-available banner to appear"
    assert_no_errors(page)


@pytest.mark.ui
def test_update_banner_is_dismissible(app_page):
    page = app_page
    _show_banner(page)
    page.wait_for_timeout(100)
    assert page.is_visible('#swUpdateBanner')

    page.click('.sw-update-banner-close')
    page.wait_for_timeout(100)
    assert not page.is_visible('#swUpdateBanner')


@pytest.mark.ui
def test_update_banner_does_not_duplicate(app_page):
    page = app_page
    _show_banner(page)
    _show_banner(page)
    page.wait_for_timeout(100)

    banners = page.query_selector_all('#swUpdateBanner')
    assert len(banners) == 1, f"Expected exactly one banner element, got {len(banners)}"


@pytest.mark.ui
def test_reload_button_posts_skip_waiting_to_waiting_worker(app_page):
    page = app_page
    _show_banner(page)
    page.wait_for_timeout(100)

    page.click('.sw-update-banner-reload')
    page.wait_for_timeout(100)

    calls = page.evaluate("() => window.__swPostMessageCalls")
    assert calls == [{'type': 'SKIP_WAITING'}], f"Expected a single SKIP_WAITING postMessage call, got {calls}"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/features/test_pwa.py tests/ui/test_pwa_update_banner.py -v`
Expected: `test_service_worker_registers_successfully` times out/fails (nothing calls `register()` yet); `test_update_banner_*` tests fail with "showUpdateAvailableBanner is not a function"; `test_app_loads_without_error_when_service_worker_unsupported` and `test_update_banner_absent_by_default` already PASS (nothing to break yet).

- [ ] **Step 3: Create `src/serviceWorker.js`**

```js
// Service worker registration + update-prompt wiring. Feature-detected so
// unsupported browsers (or serviceWorker stubbed as undefined in tests) are
// a silent no-op -- the app never depends on this being present.
export function registerServiceWorker(app) {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').then((registration) => {
        registration.addEventListener('updatefound', () => {
            const installingWorker = registration.installing;
            if (!installingWorker) return;
            installingWorker.addEventListener('statechange', () => {
                if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    app.showUpdateAvailableBanner(registration.waiting || installingWorker);
                }
            });
        });
    }).catch((err) => {
        console.error('[sw] registration failed', err);
    });

    let hasReloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hasReloaded) return;
        hasReloaded = true;
        window.location.reload();
    });
}
```

- [ ] **Step 4: Add `showUpdateAvailableBanner` to `src/ui.js`**

Immediately after the existing `showStorageQuotaWarning` function in `src/ui.js` (right after its closing `}`), add:

```js
export function showUpdateAvailableBanner(waitingWorker) {
    if (document.getElementById('swUpdateBanner')) return;

    const banner = document.createElement('div');
    banner.id = 'swUpdateBanner';
    banner.className = 'sw-update-banner';
    banner.setAttribute('role', 'alert');

    const text = document.createElement('span');
    text.textContent = 'A new version of MyFinances is available.';

    const reloadBtn = document.createElement('button');
    reloadBtn.className = 'sw-update-banner-reload';
    reloadBtn.textContent = 'Reload';
    reloadBtn.addEventListener('click', () => waitingWorker.postMessage({ type: 'SKIP_WAITING' }));

    const closeBtn = document.createElement('button');
    closeBtn.className = 'sw-update-banner-close';
    closeBtn.setAttribute('aria-label', 'Dismiss update notice');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => banner.remove());

    banner.appendChild(text);
    banner.appendChild(reloadBtn);
    banner.appendChild(closeBtn);
    document.body.appendChild(banner);
}
```

- [ ] **Step 5: Wire it into `src/app.js`**

In `src/app.js:85`, extend the existing `ui.js` import to also pull in `showUpdateAvailableBanner`:

```js
import { initializeEventListeners as initializeUIEventListeners, switchTab as switchTabFeature, updateFormVisibility as updateFormVisibilityFeature, switchPage as switchPageFeature, switchLiabilitiesSubTab as switchLiabilitiesSubTabFeature, updateUI as updateUIFeature, showMilestone as showMilestoneFeature, showNetWorthMilestone as showNetWorthMilestoneFeature, showStorageQuotaWarning as showStorageQuotaWarningFeature, showUpdateAvailableBanner as showUpdateAvailableBannerFeature } from './ui.js';
```

Add a new import for the registration function, near the other top-of-file imports:

```js
import { registerServiceWorker } from './serviceWorker.js';
```

Immediately after the existing `showStorageQuotaWarning(usage) { ... }` method on `DebtTrackerApp` (`src/app.js`, ~line 515), add:

```js
    showUpdateAvailableBanner(waitingWorker) {
        return showUpdateAvailableBannerFeature(waitingWorker);
    }
```

Update the `DOMContentLoaded` handler at the bottom of `src/app.js` (currently lines 857-859):

```js
document.addEventListener('DOMContentLoaded', () => {
    window.app = new DebtTrackerApp();
    registerServiceWorker(window.app);
});
```

- [ ] **Step 6: Add banner CSS to `styles-csp-classes.css`**

Immediately after the existing `.storage-quota-banner-close { ... }` rule (~line 480), add:

```css
.sw-update-banner {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 9998;
    display: flex;
    align-items: center;
    gap: 14px;
    max-width: min(560px, 92vw);
    padding: 12px 14px 12px 16px;
    border-radius: 10px;
    background: #2563eb;
    color: #fff;
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.28);
    font-size: 0.88rem;
    line-height: 1.4;
}

.sw-update-banner-reload {
    background: #fff;
    color: #2563eb;
    border: none;
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
}

.sw-update-banner-close {
    background: transparent;
    border: none;
    color: #fff;
    font-size: 1.2rem;
    line-height: 1;
    cursor: pointer;
    padding: 0 2px;
    flex-shrink: 0;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pytest tests/features/test_pwa.py tests/ui/test_pwa_update_banner.py -v`
Expected: PASS (10 + 6 = 16 tests total across both files so far).

- [ ] **Step 8: Commit**

```bash
git add src/serviceWorker.js src/ui.js src/app.js styles-csp-classes.css tests/features/test_pwa.py tests/ui/test_pwa_update_banner.py
git commit -m "Register service worker and add update-available banner (#75)"
```

---

### Task 5: Wire manifest/service-worker/icons into Docker and nginx

**Files:**
- Modify: `Dockerfile` (COPY lines)
- Modify: `nginx.conf` (new `location = /sw.js` block)
- Test: `tests/security/test_static_scan.py` (append)

**Interfaces:**
- Consumes: `manifest.json`, `sw.js` (Tasks 2-3), `icons/` (Task 1).
- Produces: nothing consumed by later tasks — this is deploy-config only.

- [ ] **Step 1: Write the failing tests**

Append to `tests/security/test_static_scan.py` (this file already imports `os`, `re`, `json`, `subprocess` and defines `PROJECT_ROOT`):

```python
@pytest.mark.security
def test_dockerfile_copies_pwa_assets():
    """The production Docker image must ship manifest.json, sw.js, and icons/ or the deployed app
    404s on them (nginx's 'root' serves exactly what's COPYed into the image)."""
    dockerfile_path = os.path.join(PROJECT_ROOT, 'Dockerfile')
    with open(dockerfile_path, 'r', encoding='utf-8') as f:
        content = f.read()

    copy_lines = [line for line in content.splitlines() if line.strip().startswith('COPY')]
    assert any('manifest.json' in line and 'sw.js' in line for line in copy_lines), (
        "Dockerfile must COPY manifest.json and sw.js into the image"
    )
    assert any('icons/' in line for line in copy_lines), (
        "Dockerfile must COPY the icons/ directory into the image"
    )


@pytest.mark.security
def test_copy_line_detection_catches_missing_pwa_assets():
    """The same COPY-line check must correctly flag a Dockerfile that forgot the PWA assets, not
    just pass everything it's handed."""
    fake_dockerfile = (
        "FROM nginx:1.29-alpine\n"
        "COPY index.html styles.css /usr/share/nginx/html/\n"
        "COPY src/ /usr/share/nginx/html/src/\n"
    )
    copy_lines = [line for line in fake_dockerfile.splitlines() if line.strip().startswith('COPY')]
    assert not any('manifest.json' in line and 'sw.js' in line for line in copy_lines)
    assert not any('icons/' in line for line in copy_lines)


@pytest.mark.security
def test_nginx_serves_service_worker_with_no_cache():
    """sw.js must not be served with the same 1-year-immutable rule as other static assets, or
    browsers won't pick up new app versions and the update-prompt flow can never fire."""
    nginx_path = os.path.join(PROJECT_ROOT, 'nginx.conf')
    with open(nginx_path, 'r', encoding='utf-8') as f:
        content = f.read()

    sw_block_match = re.search(r'location\s*=\s*/sw\.js\s*\{([^}]*)\}', content)
    assert sw_block_match, "nginx.conf must define a dedicated 'location = /sw.js' block"
    assert 'no-cache' in sw_block_match.group(1), "sw.js location block must set Cache-Control: no-cache"


@pytest.mark.security
def test_sw_no_cache_detection_catches_missing_block():
    """The same no-cache detection must correctly flag an nginx.conf with no dedicated sw.js block."""
    fake_nginx = "server {\n    location ~* \\.(css|js)$ {\n        expires 1y;\n    }\n}\n"
    match = re.search(r'location\s*=\s*/sw\.js\s*\{([^}]*)\}', fake_nginx)
    assert match is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/security/test_static_scan.py -v -k "dockerfile_copies_pwa or nginx_serves_service_worker"`
Expected: `test_dockerfile_copies_pwa_assets` and `test_nginx_serves_service_worker_with_no_cache` FAIL; the two detection-logic negative tests already PASS.

- [ ] **Step 3: Update `Dockerfile`**

Change the two `COPY` lines (currently):
```dockerfile
COPY index.html styles.css styles-csp-classes.css guide.html guide.css /usr/share/nginx/html/
COPY src/ /usr/share/nginx/html/src/
```
to:
```dockerfile
COPY index.html styles.css styles-csp-classes.css guide.html guide.css manifest.json sw.js /usr/share/nginx/html/
COPY src/ /usr/share/nginx/html/src/
COPY icons/ /usr/share/nginx/html/icons/
```

- [ ] **Step 4: Update `nginx.conf`**

Add a new location block right after the existing `location / { ... }` block (before the `location ~* \.(css|js|svg|png|ico|woff2?)$ { ... }` cache block):

```nginx
    location = /sw.js {
        add_header Cache-Control "no-cache" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/security/test_static_scan.py -v`
Expected: PASS (all tests in the file, including the 4 new ones).

- [ ] **Step 6: Commit**

```bash
git add Dockerfile nginx.conf tests/security/test_static_scan.py
git commit -m "Ship manifest.json, sw.js, and icons/ in the Docker image; no-cache sw.js in nginx (#75)"
```

---

### Task 6: Offline app-shell integration test

**Files:**
- Create: `tests/integration/test_pwa_offline.py`

**Interfaces:**
- Consumes: the fully working `sw.js` (Task 3) served by the local dev server. No production code changes in this task — it's a pure verification task confirming Tasks 1-4 actually deliver working offline behavior end-to-end.

- [ ] **Step 1: Write the test**

Create `tests/integration/test_pwa_offline.py`:

```python
#!/usr/bin/env python3
"""
Offline app-shell test (GitHub issue #75).

sw.js precaches the app shell on first visit so the app can load with zero
network connectivity afterward -- this is the core "offline" promise of a
PWA. Playwright's BrowserContext.set_offline() simulates a fully disconnected
network at the browser level (distinct from just a slow/flaky connection).
"""

import pytest

from tests.conftest import BASE_URL


@pytest.mark.integration
@pytest.mark.slow
def test_app_shell_loads_offline_after_first_visit(browser):
    context = browser.new_context()
    page = context.new_page()

    # First visit online: lets sw.js install and precache the app shell.
    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
    page.wait_for_function(
        "() => navigator.serviceWorker.getRegistration().then((r) => !!r && !!r.active)",
        timeout=15000
    )

    context.set_offline(True)
    page.reload(wait_until="load", timeout=15000)

    assert page.is_visible('h1'), "Expected the app shell to render from cache while offline"
    assert page.title() != "", "Expected a real page title, not a browser offline-error page"

    context.set_offline(False)
    context.close()


@pytest.mark.integration
@pytest.mark.slow
def test_first_ever_visit_offline_does_not_load(browser):
    """Documents a known/expected limitation: a browser context that has *never* visited the app
    online has nothing precached yet, so going offline before the very first successful load
    correctly fails to render the app -- this isn't a bug, it's the inherent boundary of
    cache-based offline support."""
    context = browser.new_context()
    page = context.new_page()
    context.set_offline(True)

    navigation_failed = False
    try:
        page.goto(BASE_URL, wait_until="load", timeout=10000)
    except Exception:
        navigation_failed = True

    if not navigation_failed:
        # Some browsers render a local offline-error page instead of raising; either signal is acceptable.
        assert 'MyFinances' not in (page.title() or '')

    context.close()
```

- [ ] **Step 2: Run the test**

Run: `pytest tests/integration/test_pwa_offline.py -v`
Expected: PASS for both tests. (This confirms Tasks 1-4's actual runtime behavior, not just unit-level checks — if it fails, revisit `sw.js`'s `PRECACHE_URLS`/`cacheFirst` logic from Task 3 before touching this test.)

- [ ] **Step 3: Commit**

```bash
git add tests/integration/test_pwa_offline.py
git commit -m "Add offline app-shell integration test (#75)"
```

---

### Task 7: Version bump and documentation

**Files:**
- Modify: `src/utils.js:4` (`APP_VERSION`)
- Modify: `CHANGELOG.md` (new entry at top)
- Modify: `README.md` (new "Installable & Offline (PWA)" section + File Structure entries)
- Modify: `CLAUDE.md` (new cross-cutting-features bullet)
- Modify: `DEPLOYMENT.md` (nginx/Docker notes)

**Interfaces:**
- Consumes: `sw.js`'s `CACHE_NAME` (Task 3) must already say `myfinances-v4.13.0` — this task's version bump is what that string was anticipating.
- Produces: nothing consumed by other tasks — this is the final task.

- [ ] **Step 1: Confirm the existing versioning test currently fails**

Run: `pytest tests/features/test_versioning.py -v -k test_app_version_matches_changelog_latest_entry`
Expected: at this point `APP_VERSION` is still `4.12.1` and matches the existing top `CHANGELOG.md` entry, so this PASSES — it's Step 3 below (adding the new changelog entry without yet bumping `APP_VERSION`, or vice versa) that would make it fail, which is exactly what it's for. Bump both together in Step 2 to avoid ever landing in a mismatched state.

- [ ] **Step 2: Bump `APP_VERSION`**

In `src/utils.js:4`, change:
```js
export const APP_VERSION = '4.12.1';
```
to:
```js
export const APP_VERSION = '4.13.0';
```

- [ ] **Step 3: Add the `CHANGELOG.md` entry**

Insert immediately after the `---` separator near the top of `CHANGELOG.md` (before the existing `## [4.12.1] — 2026-08-05` entry):

```markdown
## [4.13.0] — 2026-08-06

### Added
- **PWA support (installable + offline)** — added `manifest.json`, a root-scoped `sw.js` service worker (app-shell precaching + stale-while-revalidate runtime cache for the Chart.js CDN script), and a generated icon set (`icons/`, via `tools/generate-icons.js`), so the app can be installed to a home screen/desktop and loads with no network connectivity after a first visit. New service worker versions install and wait rather than silently taking over — a dismissible "Reload" banner prompts the user instead. See `docs/superpowers/specs/2026-08-06-pwa-support-design.md` (#75).

---
```

- [ ] **Step 4: Run the versioning test to verify it still passes**

Run: `pytest tests/features/test_versioning.py -v`
Expected: PASS (`APP_VERSION` and the new top `CHANGELOG.md` heading both say `4.13.0`).

- [ ] **Step 5: Update `README.md`**

Insert a new subsection immediately after the existing `### Data Management` section (right before its trailing `---` / the `## How to Use` heading):

```markdown
### Installable & Offline (PWA)
- **Add to Home Screen / Install** — `manifest.json` plus a generated icon set (`icons/`) make the app installable as a standalone app on desktop and mobile
- **Offline app shell** — a service worker (`sw.js`) precaches the app shell on first visit, so the app loads with zero network connectivity afterward (your saved data already lives in `localStorage`, so nothing about it depends on the network either way)
- **Update prompt** — when a new version is deployed, a dismissible banner offers to reload rather than silently swapping assets mid-session
```

In the `### File Structure` code block, add `manifest.json` and `sw.js` right after the existing `guide.css` line:
```
guide.css                   — Styles for guide.html (externalized for CSP compliance)
manifest.json                — Web app manifest (installability metadata + icon references)
sw.js                         — Service worker: app-shell precache + Chart.js CDN runtime cache
```
and change the `tools/` block from:
```
tools/
  └─ debug/                   — Ad-hoc manual debugging scripts (not part of pytest suite)
```
to:
```
tools/
  ├─ debug/                   — Ad-hoc manual debugging scripts (not part of pytest suite)
  └─ generate-icons.js        — One-time PWA icon generator (Node zlib only, not run in CI)
icons/                        — Generated PWA icon set (icons/generate-icons.js output)
```

- [ ] **Step 6: Update `CLAUDE.md`**

In the "Cross-cutting features" section, add a new bullet after the existing "Internationalization" bullet:

```markdown
- **PWA (installability + offline)** — `manifest.json` (icons generated by `tools/generate-icons.js`) plus a root-level `sw.js` service worker (classic script, not a module, so its scope covers `/`) precache the app shell and runtime-cache the Chart.js CDN script; registration lives in `src/serviceWorker.js`, called once from `app.js`'s `DOMContentLoaded` handler. `sw.js`'s `CACHE_NAME` is manually kept in sync with `APP_VERSION` — bump both together, or stale assets never get evicted (enforced by `tests/features/test_pwa.py`). New service worker versions wait rather than auto-activating; `ui.js`'s `showUpdateAvailableBanner()` prompts the user to reload.
```

- [ ] **Step 7: Update `DEPLOYMENT.md`**

In the `### Nginx Configuration` section, add a short note (after the existing config example) explaining the dedicated `sw.js` block:

```markdown
> **Service worker caching:** `sw.js` gets a dedicated `location = /sw.js` block with `Cache-Control: no-cache` — unlike other static assets, the service worker script itself must never be long-cached, or browsers won't discover new app versions and the in-app update-reload prompt never fires.
```

In the `### Docker Deployment` section, add a one-line note after the existing build/run commands:

```markdown
> The image now also ships `manifest.json`, `sw.js`, and `icons/` (PWA support, #75) alongside the existing static files.
```

- [ ] **Step 8: Run the full test suite**

Run: `pytest tests/ -v -m "not slow"` (fast pass) and then `pytest tests/ -v` (full pass, including the offline test's real timing)
Expected: PASS across the board — no regressions from any prior task.

- [ ] **Step 9: Commit**

```bash
git add src/utils.js CHANGELOG.md README.md CLAUDE.md DEPLOYMENT.md
git commit -m "Bump version to 4.13.0 for PWA support; update docs (#75)"
```

---

## Self-Review Notes

- **Spec coverage:** every design-doc section (manifest, icons, `sw.js`, registration, update banner, deploy wiring, versioning, testing, docs) maps to a task above (Tasks 1-7). `guide.html` precaching is covered by `sw.js`'s `PRECACHE_URLS` (Task 3), matching the design's "Out of scope" note that it's precached but otherwise unchanged.
- **Type/name consistency checked:** `registerServiceWorker(app)` (Task 4) matches its call site in `app.js`; `showUpdateAvailableBanner`/`showUpdateAvailableBannerFeature` naming matches the existing `showStorageQuotaWarning`/`showStorageQuotaWarningFeature` pair exactly; `CACHE_NAME`/`PRECACHE_URLS` names in `sw.js` (Task 3) match what Task 3's own tests parse for; banner id `swUpdateBanner` and classes `sw-update-banner`/`sw-update-banner-reload`/`sw-update-banner-close` are used identically across `ui.js`, the CSS, and both new test files.
- **No placeholders:** every step has real, complete code — no "add appropriate handling" or "similar to Task N" shorthand.
