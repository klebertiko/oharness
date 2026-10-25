/* Nilo's pixel sprite: the single source of truth for the mascot, the
   title-bar mark and the generated app icons (scripts/brand-icons.mjs parses
   this array, so keep one quoted row per line). Flat blocks, no outline, no
   shading. Her own identity — a scholar owl, not a mascot blob:
     R  round spectacle frames + a focus brow row → intelligence
     K  amber beak, sharp upright ear tufts        → charisma
     R  a tidy chest chevron, square posture       → organization
   The lenses hold a 3-wide white with a 1px pupil that can look in any
   direction — expression comes from the brow, lids and tufts, framed by the
   glasses so it never reads as a wide-eyed mascot.
   B body · W eye-white · P pupil · K beak · R rim/accent. */
export const NILO_GRID = [
  ".B.B........B.B.",
  ".BBB........BBB.",
  ".BBBBBBBBBBBBBB.",
  ".RRRRRBBBBRRRRR.",
  ".RRRRRBBBBRRRRR.",
  ".RWWWRBBBBRWWWR.",
  ".RWPWRBKKBRWPWR.",
  ".RWWWRBKKBRWWWR.",
  ".RRRRRBBBBRRRRR.",
  "BBBBBRRRRBBBBBBB",
  ".BBBBRRRRBBBBBB.",
  "..BBBBRRBBBBBB..",
  "....BB....BB....",
];

/** Head only (tufts, brow, spectacles, beak): the crop used where space is tight. */
export const NILO_FACE = NILO_GRID.slice(0, 9);

/** Fill per cell letter, as CSS tokens. Nilo carries her own colour — teal
    body, off-white eyes, a lighter-teal rim for the glasses and chest chevron,
    amber beak. Only the body follows the theme (`--nilo-body` is `--signal`).
    L/M/G/Z are animation-only props (laptop screen, desk, code, sleep glyph). */
const FILL: Record<string, string> = {
  B: "var(--nilo-body)",
  W: "var(--nilo-eye)",
  P: "var(--nilo-pupil)",
  K: "var(--nilo-beak)",
  R: "var(--nilo-rim)",
  L: "var(--nilo-screen)",
  M: "var(--nilo-desk)",
  G: "var(--nilo-code)",
  Z: "var(--nilo-eye)",
};

/** One SVG path per colour, as [fill, d] pairs. */
export function cellPaths(rows: readonly (string | readonly string[])[]): [string, string][] {
  const paths: Record<string, string[]> = {};
  rows.forEach((row, y) => {
    Array.from(row).forEach((c, x) => {
      if (c === ".") return;
      const fill = FILL[c] ?? "currentColor";
      if (!paths[fill]) paths[fill] = [];
      paths[fill].push(`M${x} ${y}h1v1h-1z`);
    });
  });
  return Object.entries(paths).map(([fill, d]) => [fill, d.join("")]);
}
