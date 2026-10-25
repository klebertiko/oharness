#!/usr/bin/env node
// Reproducible WCAG 2 contrast audit for docs/design-system/tokens.json. No dependencies.
//   node scripts/check-contrast.mjs          list every pair, exit 1 if a REQUIRED pair fails
//   node scripts/check-contrast.mjs --md     markdown table (pasted into docs/design-system/README.md)
import { loadTokens, cssValue } from "./design-tokens.mjs";

const md = process.argv.includes("--md");
const tokens = loadTokens();
const themes = ["dark", "light"];
const byName = Object.fromEntries(tokens.map((x) => [x.name, x]));
const val = (name, theme) => {
  let v = cssValue(byName[name], theme, tokens);
  for (let m; (m = /^var\(--(.+)\)$/.exec(v)); ) v = cssValue(byName[m[1]], theme, tokens);
  return v;
};

// oklch -> linear sRGB -> relative luminance (Ottosson matrices, achromatic-safe, gamut-clipped).
function luminance(css) {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(css);
  if (!m) throw new Error(`unsupported colour ${css}`);
  const [L, C, h] = [+m[1], +m[2], (+m[3] * Math.PI) / 180];
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s;
  const c = (x) => Math.min(1, Math.max(0, x));
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(bl);
}
const ratio = (fg, bg, theme) => {
  const [a, b] = [luminance(val(fg, theme)), luminance(val(bg, theme))].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
};

const SUB = ["sub-000", "sub-100", "sub-200", "sub-300"];
// [label, foreground, grounds, minimum, required]. required=false marks a documented limit; every pair the app relies on is required.
const PAIRS = [
  ["Body and title ink", "ink-primary", SUB, 4.5, true],
  ["Body and title ink", "ink-dim", SUB, 4.5, true],
  ["Secondary ink", "ink-mute", SUB, 4.5, true],
  ["Quietest ink", "ink-faint", SUB, 4.5, true],
  ["Signal as text", "signal", ["sub-000", "sub-100"], 4.5, true],
  ["Text on signal fill", "signal-ink", ["signal"], 4.5, true],
  ["Warn as a marker (text uses warn-text)", "warn", ["sub-000", "sub-100"], 3, true],
  ["Warn text", "warn-text", SUB, 4.5, true],
  ["Fault text", "fault-text", SUB, 4.5, true],
  ["Signal text", "signal-text", SUB, 4.5, true],
  ["Control edge", "line-strong", ["sub-000", "sub-100", "sub-200"], 3, true],
  // sub-300 is the pressed ground, not a field ground; recorded so the limit is visible.
  ["Control edge on the pressed ground (limit)", "line-strong", ["sub-300"], 3, false],
  ["Focus ring", "signal", SUB, 3, true],
  ["Fault border and marker", "fault", ["sub-000", "sub-100"], 3, true],
  ...["agent", "gate", "hitl", "skill", "mcp", "tool", "decision"].map((r) => [`Role marker ${r}`, `role-${r}`, ["sub-000", "sub-100"], 3, true]),
];
// A pair naming a token that no longer exists must fail loudly: silently dropping it hides a rename.
const missing = PAIRS.flatMap(([, fg, grounds]) => [fg, ...grounds].filter((n) => !byName[n]));
if (missing.length) { console.error(`check-contrast: unknown token(s) ${[...new Set(missing)].join(", ")}; update PAIRS or tokens.json`); process.exit(2); }

let fails = 0;
const rows = PAIRS.map(([label, fg, grounds, min, required]) => {
  const cells = themes.map((th) => grounds.map((g) => ratio(fg, g, th)));
  const worst = Math.min(...cells.flat());
  const ok = worst >= min;
  if (!ok && required) fails++;
  return { label, fg, grounds, min, required, cells, ok };
});

if (md) {
  console.log(`| Pair (\`foreground\` on grounds) | Min | Graphite | Ivory | Verdict |\n| --- | --- | ${themes.map(() => "---").join(" | ")} | --- |`);
  for (const r of rows) {
    const cols = r.cells.map((c) => c.map((x) => x.toFixed(1)).join(" / "));
    const verdict = r.ok ? "Pass" : r.required ? "FAIL" : "Limit";
    console.log(`| \`${r.fg}\` on ${r.grounds.map((g) => `\`${g}\``).join(", ")} | ${r.min}:1 | ${cols.join(" | ")} | ${verdict} |`);
  }
} else {
  for (const r of rows) console.log(`${r.ok ? "ok  " : r.required ? "FAIL" : "warn"} ${r.fg} on ${r.grounds.join(",")} min ${r.min}: ${r.cells.map((c) => c.map((x) => x.toFixed(2)).join(" ")).join(" | ")}`);
}
if (fails) { console.error(`${fails} required pair(s) failed`); process.exit(1); }
