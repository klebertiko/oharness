import { NILO_GRID } from "./niloGrid";

export type Look = readonly [dx: -1 | 0 | 1, dy: -1 | 0 | 1];
export type Eyes = "open" | "closed" | "happy" | "squint" | "wink" | "none";
export type Wing = "down" | "mid" | "up";
export type Brow = "rest" | "up" | "down" | "worry";

/** Everything one animation frame can vary. Omitted fields mean "at rest".
    Studio-style acting: the brow, lids, head tilt and tufts carry emotion, not
    a big darting eyeball. `squash` (−1 tall … +1 tall) gives hops weight. */
export type Pose = {
  dy?: number;
  squash?: -1 | 0 | 1;
  eyes?: Eyes;
  look?: Look;
  brow?: Brow;
  /** Head leans; the tufts lag a step behind for secondary motion. */
  tilt?: -1 | 0 | 1;
  wingL?: Wing;
  wingR?: Wing;
  tufts?: "perk" | "droop";
  laptop?: 0 | 1;
  tick?: number;
  dots?: number;
  z?: number;
  beakOpen?: boolean;
  flip?: boolean;
};

/** Canvas around the owl, with room above for hops, dots and Zs, and a column
    each side for a wing to lift out of the silhouette. */
export const NILO_CANVAS = { w: 18, h: 17 } as const;
const OX = 1;
const OY = 3;
const W = 16;
const HEAD_ROWS = 9; // grid rows 0..8 tilt/lag with the head

type Cell = readonly [x: number, y: number];
/** Lens interiors, grid coordinates. 3 wide × 3 tall — room for a real gaze. */
const LENS_L = { cx: 3, cy: 6, x0: 2, x1: 4, y0: 5, y1: 7 };
const LENS_R = { cx: 12, cy: 6, x0: 11, x1: 13, y0: 5, y1: 7 };
const BROW_ROW = 4;
const CODE_LINES: readonly Cell[] = [[0, 5], [2, 6], [2, 3], [0, 7], [2, 5], [4, 4]];

// Sleep trail: a legible Z closest to the head, shrinking to a single dot as
// it drifts up and away — "Z z z", not one glyph teleporting in place. A
// single middle row can't show a real diagonal at any offset — centred reads
// as a serif "I", offset either way reads as "C" — so the big Z spans two
// diagonal-stepping rows; the smaller marks trail beside it, not above it,
// since headroom above the head is only 4-5 rows deep.
const Z_TRAIL: readonly { dx: number; dy: number; rows: readonly string[] }[] = [
  { dx: 9, dy: -4, rows: ["ZZZZ", "..Z.", ".Z..", "ZZZZ"] },
  { dx: 13, dy: -3, rows: ["ZZ", ".Z"] },
  { dx: 15, dy: -2, rows: ["Z"] },
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Builds one frame as a grid of cell letters ("." is empty). */
export function niloFrame(p: Pose = {}): string[][] {
  const g = Array.from({ length: NILO_CANVAS.h }, () => Array<string>(NILO_CANVAS.w).fill("."));
  const put = (x: number, y: number, c: string) => {
    if (y >= 0 && y < NILO_CANVAS.h && x >= 0 && x < NILO_CANVAS.w) g[y][x] = c;
  };
  const oy = OY + (p.dy ?? 0);
  const tilt = p.tilt ?? 0;
  const squash = p.squash ?? 0;

  // Body. The head (rows 0..8) leans by `tilt`; a positive `squash` stretches
  // it up a row, a negative one presses it down — weight for the hop.
  NILO_GRID.forEach((row, y) => {
    const isHead = y < HEAD_ROWS;
    const shift = isHead ? tilt : 0;
    const sy = squash > 0 && isHead ? -1 : squash < 0 && y >= HEAD_ROWS ? 0 : 0;
    Array.from(row).forEach((c, x) => {
      if (c === "." || c === "P" || (y === 9 && (x === 0 || x === W - 1))) return;
      put(OX + x + shift, oy + y + sy, c);
    });
  });
  if (squash < 0) {
    // press: pull the crown down one row so the silhouette looks compressed
    for (let x = 1; x <= 14; x++) if (g[oy]?.[OX + x] === "B") { g[oy][OX + x] = "."; }
  }

  // ── Ear tufts — lag the head lean by half for secondary motion ────────────
  const tuftShift = tilt === 0 ? 0 : tilt > 0 ? 1 : -1; // trails, but never zero-jumps
  const tuftCols = [1, 3, 12, 14].map((x) => x + Math.round(tuftShift / 2));
  if (p.tufts === "perk") for (const x of tuftCols) put(OX + x, oy - 1, "B");
  else if (p.tufts === "droop") {
    for (const x of [1, 3, 12, 14]) put(OX + x + tilt, oy, ".");
    put(OX + tilt, oy + 1, "B");
    put(OX + W - 1 + tilt, oy + 1, "B");
  }

  // ── Wings — folded at rest, lifting clear of the body when raised ─────────
  const wing = (side: "L" | "R", state: Wing) => {
    const col = side === "L" ? 0 : NILO_CANVAS.w - 1;
    const rows = state === "up" ? [5, 6] : state === "mid" ? [7, 8] : [];
    for (const r of rows) put(col, oy + r, "B");
    put(side === "L" ? OX : OX + W - 1, oy + 9, "B"); // keep the shoulder corner
  };
  wing("L", p.wingL ?? "down");
  wing("R", p.wingR ?? "down");

  // ── Brow acting on the dedicated rim row ─────────────────────────────────
  brow(put, oy, tilt, p.brow ?? "rest", p.eyes ?? "open");

  // ── Eyes behind the spectacles ──────────────────────────────────────────
  const kind = p.eyes ?? "open";
  drawEye(put, oy, tilt, LENS_L, "L", kind === "wink" ? "happy" : kind, p.look ?? [0, 0]);
  drawEye(put, oy, tilt, LENS_R, "R", kind === "wink" ? "closed" : kind, p.look ?? [0, 0]);
  if (kind === "none") {
    for (let y = 3; y <= 8; y++)
      for (let x = 1; x <= 14; x++) {
        const cy = oy + y;
        const cx = OX + x + tilt;
        if (g[cy]?.[cx] && g[cy][cx] !== ".") g[cy][cx] = "B";
      }
  }

  // ── Beak ────────────────────────────────────────────────────────────────
  if (p.beakOpen) {
    put(OX + 7 + tilt, oy + 8, "K");
    put(OX + 8 + tilt, oy + 8, "K");
  }

  // ── Laptop — a grey device bezel, not a colour patch. The owl's body and
  //    the screen fill are both light, cool tones — without a hard frame the
  //    "screen" reads as a smudge on the chest, not an object. The bezel
  //    frames a glowing interior; the deck and front lip flare wider below
  //    it in two steps, the wedge silhouette that reads as "laptop" even in
  //    silhouette alone. ─────────────────────────────────────────────────
  if (p.laptop !== undefined) {
    const sx = OX + 2;
    const sy = oy + 8;
    const tick = Math.max(0, Math.floor(p.tick ?? 0));

    for (let x = 1; x <= 10; x++) {
      put(sx + x, sy, "M");
      put(sx + x, sy + 3, "M");
    }
    put(sx + 1, sy + 1, "M");
    put(sx + 10, sy + 1, "M");
    put(sx + 1, sy + 2, "M");
    put(sx + 10, sy + 2, "M");
    for (let y = 1; y <= 2; y++) for (let x = 2; x <= 9; x++) put(sx + x, sy + y, "L");

    for (let i = 0; i < 2; i++) {
      const [indent, len] = CODE_LINES[(i + tick) % CODE_LINES.length];
      const cap = Math.max(0, Math.min(len, 6 - indent));
      for (let x = 0; x < cap; x++) put(sx + 3 + indent + x, sy + 1 + i, "G");
      if (i === 1 && p.laptop) put(sx + 3 + indent + cap, sy + 2, "W");
    }

    for (let x = -1; x <= 12; x++) put(sx + x, sy + 4, "M");
    for (let x = -2; x <= 13; x++) put(sx + x, sy + 5, "M");
  }

  // ── Thought dots · sleep Zs ─────────────────────────────────────────────
  for (let i = 0; i < (p.dots ?? 0); i++) put(OX + 12 + i * 2, oy - 2, "W");
  if (p.z !== undefined) {
    const count = clamp(Math.floor(p.z) + 1, 1, Z_TRAIL.length);
    for (let i = 0; i < count; i++) {
      const g = Z_TRAIL[i];
      g.rows.forEach((row, y) => {
        Array.from(row).forEach((c, x) => {
          if (c !== ".") put(OX + g.dx + x, oy + g.dy + y, "Z");
        });
      });
    }
  }

  if (p.flip) g.forEach((r) => { r.reverse(); });
  return g;
}

/** Where the pupil sits for a gaze, inside the 3×3 lens. */
function gazeCell(lens: typeof LENS_L, [dx, dy]: Look): Cell {
  return [clamp(lens.cx + dx, lens.x0, lens.x1), clamp(lens.cy + dy, lens.y0, lens.y1)];
}

function drawEye(
  put: (x: number, y: number, c: string) => void,
  oy: number,
  tilt: number,
  lens: typeof LENS_L,
  side: "L" | "R",
  kind: Eyes,
  look: Look,
) {
  const set = (x: number, y: number, c: string) => put(OX + x + tilt, oy + y, c);
  if (kind === "none") return;
  if (kind === "open") {
    for (let y = lens.y0; y <= lens.y1; y++) for (let x = lens.x0; x <= lens.x1; x++) set(x, y, "W");
    const [px, py] = gazeCell(lens, look);
    set(px, py, "P");
    return;
  }
  // Lids: the interior goes body-coloured, a dark mark draws the closed shape.
  for (let y = lens.y0; y <= lens.y1; y++) for (let x = lens.x0; x <= lens.x1; x++) set(x, y, "B");
  const inner = side === "L" ? lens.x1 : lens.x0;
  const outer = side === "L" ? lens.x0 : lens.x1;
  if (kind === "closed") {
    for (let x = lens.x0; x <= lens.x1; x++) set(x, lens.cy, "P"); // flat lash line
  } else if (kind === "happy") {
    set(outer, lens.cy, "P");
    set(lens.cx, lens.y0, "P");
    set(inner, lens.cy, "P"); // ^_^
  } else if (kind === "squint") {
    // > for the left eye, < for the right
    set(outer, lens.y0, "P");
    set(lens.cx, lens.cy, "P");
    set(outer, lens.y1, "P");
  }
}

function brow(
  put: (x: number, y: number, c: string) => void,
  oy: number,
  tilt: number,
  b: Brow,
  eyes: Eyes,
) {
  const set = (x: number, y: number, c: string) => put(OX + x + tilt, oy + y, c);
  const clearInner = () => {
    for (const x of [2, 3, 12, 13]) set(x, BROW_ROW, "B");
  };
  if (b === "up") {
    clearInner();
    set(3, BROW_ROW - 2, "R");
    set(12, BROW_ROW - 2, "R");
  } else if (b === "down") {
    for (const x of [1, 5, 10, 14]) set(x, BROW_ROW + 1, "R"); // frame juts toward the eye
    for (const x of [2, 3, 12, 13]) set(x, BROW_ROW - 1, "B");
  } else if (b === "worry") {
    // inner ends lift, outer ends drop — a soft, concerned tilt
    set(4, BROW_ROW - 1, "R");
    set(11, BROW_ROW - 1, "R");
    set(1, BROW_ROW + 1, "R");
    set(14, BROW_ROW + 1, "R");
  }
  void eyes;
}
