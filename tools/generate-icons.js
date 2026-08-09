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
