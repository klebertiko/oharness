import fs from "node:fs";
import path from "node:path";

/** WCAG contrast for the semantic pairs, in both themes. Colour maths matches scripts/check-contrast.mjs for opaque oklch, and composites a transparent mix in sRGB the way a browser paints it. */

export const cssPath = path.resolve(__dirname, "../../app/globals.css");

export function readCss(): string {
  return fs.readFileSync(cssPath, "utf8");
}

function sliceBlock(css: string, marker: string): string {
  const at = css.indexOf(marker);
  if (at < 0) throw new Error(`missing ${marker}`);
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unclosed ${marker}`);
}

export function declarations(block: string): Record<string, string> {
  const decls: Record<string, string> = {};
  for (const match of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decls[match[1]] = match[2].trim();
  return decls;
}

export function themeVars(css: string, theme: "dark" | "light"): Record<string, string> {
  const root = declarations(sliceBlock(css, ":root {"));
  if (theme === "dark") return root;
  return { ...root, ...declarations(sliceBlock(css, '[data-theme="light"] {')) };
}

function linear(css: string): [number, number, number] {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(css);
  if (!match) throw new Error(`unsupported colour ${css}`);
  const [L, C, hue] = [+match[1], +match[2], (+match[3] * Math.PI) / 180];
  const a = C * Math.cos(hue);
  const b = C * Math.sin(hue);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const clip = (x: number) => Math.min(1, Math.max(0, x));
  return [clip(r), clip(g), clip(bl)];
}

const encode = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
const decode = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const luminance = (rgb: [number, number, number]) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

function ratioOf(fg: [number, number, number], bg: [number, number, number]): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

/** Resolve a token to an opaque linear RGB over `ground`, following var() and color-mix. */
export function resolve(name: string, vars: Record<string, string>, ground?: [number, number, number]): [number, number, number] {
  const seen = new Set<string>();
  const value = (token: string): [number, number, number] => {
    if (seen.has(token)) throw new Error(`cycle ${token}`);
    seen.add(token);
    const raw = vars[token];
    if (!raw) throw new Error(`missing ${token}`);
    const alias = /^var\(--([\w-]+)\)$/.exec(raw);
    if (alias) return value(`--${alias[1]}`);
    if (raw.startsWith("oklch(")) return linear(raw);
    const mix = /^color-mix\(in oklch,\s*var\(--([\w-]+)\)\s+([\d.]+)%\s*,\s*transparent\)$/.exec(raw);
    if (mix) {
      if (!ground) throw new Error(`${token} is translucent and needs a ground`);
      const ink = value(`--${mix[1]}`).map(encode) as [number, number, number];
      const back = ground.map(encode) as [number, number, number];
      const alpha = +mix[2] / 100;
      const painted = ink.map((channel, index) => channel * alpha + back[index] * (1 - alpha)) as [number, number, number];
      return painted.map(decode) as [number, number, number];
    }
    const over = /^color-mix\(in oklch,\s*var\(--([\w-]+)\)\s+([\d.]+)%\s*,\s*var\(--([\w-]+)\)\)$/.exec(raw);
    if (over) {
      const left = value(`--${over[1]}`);
      const right = value(`--${over[3]}`);
      const weight = +over[2] / 100;
      return left.map((channel, index) => channel * weight + right[index] * (1 - weight)) as [number, number, number];
    }
    throw new Error(`cannot resolve ${token}: ${raw}`);
  };
  return value(name.startsWith("--") ? name : `--${name}`);
}

export function pairRatio(fg: string, bg: string, vars: Record<string, string>): number {
  const ground = resolve(bg, vars);
  const ink = resolve(fg, vars, ground);
  return ratioOf(ink, ground);
}

export const TEXT = ["fg-1", "fg-2", "fg-3", "signal-fg", "warn-fg", "fault-fg", "ok-fg"];
export const LARGE = ["fg-4"];
export const MARKS = ["ok", "diff-added", "diff-removed", "diff-modified", "diff-conflict", "role-input", "role-llm", "role-evaluator", "role-router", "role-memory", "role-aggregator", "role-output", "signal"];
export const GROUNDS = ["bg-app", "bg-pane", "bg-hover", "bg-active"];
export const MARK_GROUNDS = ["bg-app", "bg-pane"];
