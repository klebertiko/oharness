#!/usr/bin/env node
// Stamps Nilo (frontend/src/components/brand/niloGrid.ts) into every brand
// asset: brand/*.svg, brand/icon.png and the Tauri icon set. Each raster size
// is drawn directly at an integer cell size, so small icons stay pixel-crisp
// instead of being downsampled from one big PNG (which is what `tauri icon`
// does). Zero dependencies: run with plain Node from the repo root.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Exported files can't read CSS variables: fixed stand-ins for the --nilo-* tokens.
const FILL = { B: "#3AB3AD", W: "#F4EFE6", P: "#161412", K: "#D9A441", R: "#93E4DE" };

const src = readFileSync(join(ROOT, "frontend/src/components/brand/niloGrid.ts"), "utf8");
const block = src.match(/NILO_GRID = \[([\s\S]*?)\];/);
const faceRows = src.match(/NILO_FACE = NILO_GRID\.slice\(0, (\d+)\)/);
if (!block || !faceRows) throw new Error("NILO_GRID / NILO_FACE not found in niloGrid.ts");
const GRID = [...block[1].matchAll(/"([.A-Z]+)"/g)].map((m) => m[1]);
const FACE = GRID.slice(0, Number(faceRows[1]));

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// ── SVG ─────────────────────────────────────────────────────────────────────
const svgPaths = (rows) => {
  const paths = {};
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (c !== ".") (paths[c] ||= []).push(`M${x} ${y}h1v1h-1z`); }));
  // Grid symbols and palette values are closed constants, never external input.
  // nosemgrep: opengrep-rules.javascript.lang.security.html-in-template-string
  return Object.entries(paths).map(([c, d]) => `<path fill="${FILL[c]}" d="${d.join("")}"/>`).join("");
};

const svg = (rows, cell, title) => {
  const w = rows[0].length, h = rows.length;
  // Call sites below provide fixed repository-owned titles and grid data only.
  // nosemgrep: opengrep-rules.javascript.lang.security.html-in-template-string
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * cell}" height="${h * cell}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges"><title>${title}</title>${svgPaths(rows)}</svg>\n`;
};

// ── Raster: Nilo without a background plate ─────────────────────────────────
// Nilo is the product icon. The previous dark rounded plate became a thick,
// irregular border after Windows applied its own taskbar/shortcut treatment.
// Keep the canvas transparent and draw the original pixel grid directly at
// every target size: no resampling blur, no artificial outline, no second
// silhouette competing with the mascot.
function renderIcon(size) {
  const px = new Uint8Array(size * size * 4);
  // Small Windows surfaces need an adaptive mark, not a uniformly shrunken
  // desktop illustration. Use Nilo's face at 16/32 px so the eyes and beak
  // remain identifiable; keep the complete mascot at larger sizes.
  const sprite = size <= 32 ? FACE : GRID;
  // Trim fully transparent edge columns so the visible mark, not the sprite
  // box, is what fills the slot.
  const used = [...sprite[0]].map((_, x) => sprite.some((r) => r[x] !== "."));
  const x0 = used.indexOf(true), x1 = used.lastIndexOf(true) + 1;
  const rows = sprite.map((r) => r.slice(x0, x1));
  const w = rows[0].length, h = rows.length;
  // Fill the slot: full width up to 64 px (taskbar, Start, desktop), ~94%
  // above. Prefer an integer cell (crisp, even pixels); fall back to
  // nearest-neighbour only when an integer cell would leave the mark under
  // 90% of the target width.
  const target = size * (size <= 64 ? 1 : 0.94);
  const intCell = Math.floor(target / Math.max(w, h));
  const drawW = intCell * w >= 0.9 * target ? intCell * w : Math.round(target);
  const drawH = Math.round((drawW * h) / w);
  const ox = Math.floor((size - drawW) / 2);
  const oy = Math.floor((size - drawH) / 2);
  for (let y = 0; y < drawH; y++) {
    const gy = Math.min(h - 1, Math.floor((y * h) / drawH));
    for (let x = 0; x < drawW; x++) {
      // Map columns from the nearer edge so a non-integer scale stays
      // left/right symmetric (both eyes get the same pixel widths).
      const col = (i) => Math.min(w - 1, Math.floor((i * w) / drawW));
      const gx = x < drawW / 2 ? col(x) : w - 1 - col(drawW - 1 - x);
      const symbol = rows[gy][gx];
      if (symbol === ".") continue;
      px.set([...rgb(FILL[symbol]), 255], ((oy + y) * size + ox + x) * 4);
    }
  }
  return px;
}

// ── Encoders ────────────────────────────────────────────────────────────────
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function png(size) {
  const px = renderIcon(size);
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride); // filter byte 0 (None) per row
  for (let y = 0; y < size; y++) Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * stride + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// 32-bit BGRA DIB for ICO entries below 256 (widest compatibility). The AND
// mask stays zero; the alpha channel carries transparency.
function dib(size) {
  const px = renderIcon(size);
  const maskStride = Math.ceil(size / 32) * 4;
  const out = Buffer.alloc(40 + size * size * 4 + maskStride * size);
  out.writeUInt32LE(40, 0);
  out.writeInt32LE(size, 4);
  out.writeInt32LE(size * 2, 8); // XOR + AND heights
  out.writeUInt16LE(1, 12);
  out.writeUInt16LE(32, 14);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4, d = 40 + ((size - 1 - y) * size + x) * 4;
      out[d] = px[s + 2];
      out[d + 1] = px[s + 1];
      out[d + 2] = px[s];
      out[d + 3] = px[s + 3];
    }
  }
  return out;
}

function ico(sizes) {
  const images = sizes.map((s) => (s >= 256 ? png(s) : dib(s)));
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    head[e] = s >= 256 ? 0 : s; // 0 means 256
    head[e + 1] = s >= 256 ? 0 : s;
    head.writeUInt16LE(1, e + 4); // planes
    head.writeUInt16LE(32, e + 6); // bpp
    head.writeUInt32LE(images[i].length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  return Buffer.concat([head, ...images]);
}

function icns(entries) {
  const blocks = entries.map(([type, size]) => {
    const data = png(size);
    const h = Buffer.alloc(8);
    h.write(type, 0, "ascii");
    h.writeUInt32BE(8 + data.length, 4);
    return Buffer.concat([h, data]);
  });
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(8 + blocks.reduce((n, b) => n + b.length, 0), 4);
  return Buffer.concat([head, ...blocks]);
}

// ── Write ───────────────────────────────────────────────────────────────────
function out(rel, data) {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
  console.log(`wrote ${rel} (${data.length} bytes)`);
}

out("brand/nilo.svg", svg(GRID, 8, "Nilo, the OHarness owl"));
out("brand/mark.svg", svg(FACE, 2, "OHarness"));
out("brand/app-icon.svg", svg(GRID, 8, "Nilo, the OHarness app icon"));
out("brand/icon.png", png(1024));
out("src-tauri/icons/32x32.png", png(32));
out("src-tauri/icons/128x128.png", png(128));
out("src-tauri/icons/128x128@2x.png", png(256));
// Do not include a native 24 px frame: a 16-cell sprite can only occupy 16 px
// there without uneven pixels. Windows scales the crisp 32 px face instead.
out("src-tauri/icons/icon.ico", ico([16, 32, 48, 64, 256]));
out("src-tauri/icons/icon.icns", icns([["ic07", 128], ["ic08", 256], ["ic09", 512], ["ic10", 1024]]));
