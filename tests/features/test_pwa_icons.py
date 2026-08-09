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
