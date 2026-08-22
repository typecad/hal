// ---------------------------------------------------------------------------
// render-typecad-ui-icon.mjs — regenerates the typecad-ui extension icons
//
// Renders, with a hand-rolled SDF rasterizer (no image dependencies):
//   icon.png            256x256 extension icon (Extensions view / marketplace)
//   file-icon-dark.png  32x32 explorer file icon, dark-theme variant
//   file-icon-light.png 32x32 explorer file icon, light-theme variant
//
// The language-contribution file icon is a fallback: VS Code shows it when the
// active file icon theme has no mapping for the language (the default Seti
// theme has no .ui entry, so it shows for default setups).
//
// Usage: node scripts/render-typecad-ui-icon.mjs
// ---------------------------------------------------------------------------

import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'packages', 'cuttlefish', 'assets', 'editor-extensions', 'typecad-ui',
);

// -- signed distance primitives ------------------------------------------------

const length = (x, y) => Math.hypot(x, y);

/** Distance to a line segment (capsule with round caps). */
function sdSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  return length(px - (ax + t * abx), py - (ay + t * aby));
}

/** Distance to a rounded axis-aligned box centered at (cx, cy). */
function sdRoundedBox(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return Math.min(Math.max(qx, qy), 0) + length(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

/** 1px-smoothed coverage for an SDF (anti-aliased shape edge). */
const cover = (d) => Math.max(0, Math.min(1, 0.5 - d));

const mix = (a, b, t) => a + (b - a) * t;

// -- palette -------------------------------------------------------------------

const BG_TOP = [11, 18, 32];    // #0b1220
const BG_BOTTOM = [30, 41, 59]; // #1e293b
const CYAN = [56, 189, 248];    // #38bdf8
const WHITE = [250, 250, 250];  // #fafafa
const CHIP_DARK = [14, 116, 144];  // #0e7490 — file icon chip, dark editor bg
const CHIP_LIGHT = [8, 145, 178];  // #0891b2 — file icon chip, light editor bg

// -- render + encode ------------------------------------------------------------

/** Renders SIZE x SIZE RGBA pixels via `shade(x, y) -> [r, g, b, a]`. */
function render(size, shade) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(size * 4);
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = shade(x + 0.5, y + 0.5);
      row.writeUInt8(Math.round(r), x * 4);
      row.writeUInt8(Math.round(g), x * 4 + 1);
      row.writeUInt8(Math.round(b), x * 4 + 2);
      row.writeUInt8(Math.round(a * 255), x * 4 + 3);
    }
    rows.push(row);
  }
  return rows;
}

const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(size, rows) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8);  // bit depth
  ihdr.writeUInt8(6, 9);  // color type: RGBA
  const raw = Buffer.concat(rows.map((row) => Buffer.concat([Buffer.from([0]), row])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// -- 256x256 extension icon: brackets framing UI bars on a dark rounded square --

function extensionIcon() {
  return render(256, (x, y) => {
    // Background: vertical gradient inside a rounded square, transparent corners.
    let [r, g, b] = [0, 0, 0];
    let a = 0;
    const bgA = cover(sdRoundedBox(x, y, 128, 128, 128, 128, 52));
    if (bgA > 0) {
      const t = (y - 0.5) / 255;
      r = mix(BG_TOP[0], BG_BOTTOM[0], t);
      g = mix(BG_TOP[1], BG_BOTTOM[1], t);
      b = mix(BG_TOP[2], BG_BOTTOM[2], t);
      a = bgA;
    }

    // Cyan angle brackets: < at x≈70, > mirrored.
    const stroke = 15;
    const leftChevron = Math.min(
      sdSegment(x, y, 92, 84, 62, 128),
      sdSegment(x, y, 62, 128, 92, 172),
    );
    const rightChevron = Math.min(
      sdSegment(x, y, 164, 84, 194, 128),
      sdSegment(x, y, 194, 128, 164, 172),
    );
    const bracketA = Math.max(cover(leftChevron - stroke / 2), cover(rightChevron - stroke / 2));
    if (bracketA > 0) {
      r = mix(r, CYAN[0], bracketA); g = mix(g, CYAN[1], bracketA); b = mix(b, CYAN[2], bracketA);
    }

    // UI bars between the brackets: two full-width white, one short cyan.
    const bars = [
      { cx: 128, cy: 100, hw: 26, hh: 7, color: WHITE },
      { cx: 128, cy: 128, hw: 26, hh: 7, color: WHITE },
      { cx: 115, cy: 156, hw: 17, hh: 7, color: CYAN },
    ];
    for (const bar of bars) {
      const barA = cover(sdRoundedBox(x, y, bar.cx, bar.cy, bar.hw, bar.hh, bar.hh));
      if (barA > 0) {
        r = mix(r, bar.color[0], barA); g = mix(g, bar.color[1], barA); b = mix(b, bar.color[2], barA);
      }
    }
    return [r, g, b, a];
  });
}

// -- 32x32 file icon: cyan chip with white UI bars (reads at 16px) --------------

function fileIcon(chip) {
  return render(32, (x, y) => {
    let [r, g, b] = [0, 0, 0];
    let a = 0;
    const chipA = cover(sdRoundedBox(x, y, 16, 16, 14, 14, 7));
    if (chipA > 0) {
      r = chip[0]; g = chip[1]; b = chip[2]; a = chipA;
    }
    const bars = [
      { cy: 11.5, hw: 8 },
      { cy: 16, hw: 8 },
      { cy: 20.5, hw: 5 },
    ];
    for (const bar of bars) {
      const barA = cover(sdRoundedBox(x, y, 16, bar.cy, bar.hw, 1.8, 1.8));
      if (barA > 0) {
        r = mix(r, WHITE[0], barA); g = mix(g, WHITE[1], barA); b = mix(b, WHITE[2], barA);
      }
    }
    return [r, g, b, a];
  });
}

// -- write ------------------------------------------------------------------------

fs.mkdirSync(ASSETS, { recursive: true });
const outputs = [
  ['icon.png', encodePng(256, extensionIcon())],
  ['file-icon-dark.png', encodePng(32, fileIcon(CHIP_DARK))],
  ['file-icon-light.png', encodePng(32, fileIcon(CHIP_LIGHT))],
];
for (const [name, png] of outputs) {
  fs.writeFileSync(path.join(ASSETS, name), png);
  console.log(`wrote ${path.join(ASSETS, name)} (${png.length} bytes)`);
}
