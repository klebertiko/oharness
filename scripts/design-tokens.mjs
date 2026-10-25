#!/usr/bin/env node
// OHarness design tokens: load docs/design-system/tokens.json (DTCG), emit CSS, and prove it matches globals.css.
//   node scripts/design-tokens.mjs --check          parity: tokens.json <-> frontend/src/app/globals.css (exit 1 on drift)
//   node scripts/design-tokens.mjs --css [out.css]  emit CSS custom properties for every token (stdout if no file)
// No dependencies. The app's globals.css stays the runtime source until the Tailwind 4 @theme migration lands.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TOKENS_FILE = path.join(root, "docs/design-system/tokens.json");
export const GLOBALS_FILE = path.join(root, "frontend/src/app/globals.css");
export const TAILWIND_FILE = path.join(root, "frontend/src/app/globals.css"); // Tailwind 4: the scale lives in the @theme block
/** Variables globals.css keeps for backwards compatibility; they alias a token and carry no value of their own. */
const LEGACY_VARS = new Set(["--ink", "--ink-secondary", "--ink-tertiary"]);

/** Flatten the DTCG tree to [{ name, path, type, value, light, css, status, raw }]. A group's $type is inherited. */
export function loadTokens(file = TOKENS_FILE) {
  const tree = JSON.parse(fs.readFileSync(file, "utf8"));
  const out = [];
  const walk = (node, trail, inheritedType) => {
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$") || typeof child !== "object" || child === null) continue;
      const type = child.$type ?? inheritedType;
      if ("$value" in child) {
        const oh = child.$extensions?.oh ?? {};
        out.push({ name: key, path: [...trail, key].join("."), type, value: child.$value, light: oh.themes?.light, css: oh.css ?? null, status: oh.status, cssValue: oh.cssValue });
      } else walk(child, [...trail, key], type);
    }
  };
  walk(tree, [], undefined);
  const names = new Set();
  for (const tok of out) {
    if (names.has(tok.name)) throw new Error(`duplicate token name ${tok.name}`);
    names.add(tok.name);
  }
  return out;
}

const norm = (s) => String(s).replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim().toLowerCase();

/** The CSS string a token value stands for. Aliases become var(--name). */
export function cssValue(tok, theme = "dark", all) {
  const v = theme === "light" && tok.light !== undefined ? tok.light : tok.value;
  if (typeof v === "string") {
    const m = /^\{(.+)\}$/.exec(v);
    if (m) {
      const target = all.find((x) => x.path === m[1] || x.name === m[1].split(".").pop());
      if (!target) throw new Error(`${tok.name}: alias ${v} has no target`);
      return `var(--${target.name})`;
    }
    return v;
  }
  if (Array.isArray(v)) return tok.cssValue ?? `cubic-bezier(${v.join(", ")})`;
  throw new Error(`${tok.name}: composite value has no CSS form`);
}

/** Declarations of the first :root block and the first [data-theme="light"] block, comments stripped. */
export function parseGlobals(text) {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const block = (selector) => {
    const i = css.indexOf(selector);
    if (i < 0) return {};
    const open = css.indexOf("{", i);
    let depth = 0, j = open;
    for (; j < css.length; j++) {
      if (css[j] === "{") depth++;
      if (css[j] === "}" && --depth === 0) break;
    }
    const decls = {};
    for (const m of css.slice(open + 1, j).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decls[m[1]] = m[2].trim();
    return decls;
  };
  return { dark: block(":root {"), light: block('[data-theme="light"] {') };
}

/** Parity problems between tokens.json and globals.css. An empty list means zero drift. */
export function checkParity(tokens = loadTokens(), globalsText = fs.readFileSync(GLOBALS_FILE, "utf8")) {
  const g = parseGlobals(globalsText);
  const problems = [];
  const mapped = new Set();
  for (const tok of tokens) {
    if (!tok.css) continue;
    mapped.add(tok.css);
    for (const theme of ["dark", "light"]) {
      const actual = theme === "light" ? (g.light[tok.css] ?? g.dark[tok.css]) : g.dark[tok.css];
      if (actual === undefined) { problems.push(`${tok.name}: ${tok.css} is not declared in globals.css`); break; }
      const expected = cssValue(tok, theme, tokens);
      if (norm(actual) !== norm(expected)) problems.push(`${tok.name} (${theme}): globals.css has "${actual}", tokens.json has "${expected}"`);
    }
  }
  for (const v of Object.keys(g.dark)) if (!mapped.has(v) && !LEGACY_VARS.has(v)) problems.push(`${v} is declared in globals.css but no token maps to it`);
  for (const v of Object.keys(g.light)) if (!mapped.has(v) && !LEGACY_VARS.has(v)) problems.push(`${v} is overridden in the light theme but no token maps to it`);
  return problems;
}

/** Declarations of one `.selector { ... }` rule in a stylesheet, comments stripped. Plain string search: the selector is data, never a pattern. */
function rule(css, selector) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let at = -1;
  for (let from = 0; ; ) {
    const i = text.indexOf(selector, from);
    if (i < 0) return null;
    const lineStart = i === 0 || text[i - 1] === "\n";
    if (lineStart && /^\s*\{/.test(text.slice(i + selector.length, i + selector.length + 3))) { at = i; break; }
    from = i + selector.length;
  }
  const open = text.indexOf("{", at);
  const body = text.slice(open + 1, text.indexOf("}", open));
  return Object.fromEntries([...body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]));
}

/** The size and options of `--text-<key>` in the `@theme` block of globals.css, as `[slice, size, "{ lineHeight: \"..\", letterSpacing: \"..\" }"]` (the shape the checks below read). */
function tailwindSize(text, key) {
  const theme = text.slice(text.indexOf("@theme"), text.indexOf("}", text.indexOf("@theme")));
  const vars = new Map([...theme.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]));
  const read = (suffix) => vars.get(`--text-${key}${suffix}`);
  const size = read("");
  if (!size) return null;
  const lh = read("--line-height"), ls = read("--letter-spacing");
  const opts = `{ ${lh ? `lineHeight: "${lh}"` : ""}${ls ? `${lh ? ", " : ""}letterSpacing: "${ls}"` : ""} }`;
  return [theme, size, opts];
}

/** Typography tokens have no CSS variable, so they are checked against the `.t-*` rules in globals.css (weight, line height, tracking, family, size where declared) and the `--text-*` scale in the @theme block of globals.css. */
export function checkTypography(tokens = loadTokens(), globalsText = fs.readFileSync(GLOBALS_FILE, "utf8"), tailwindText = fs.readFileSync(TAILWIND_FILE, "utf8")) {
  const problems = [];
  const fontVar = { ui: "var(--font-ui)", mono: "var(--font-mono)" };
  const none = (v) => v === undefined || v === "0" || v === "normal";
  for (const tok of tokens.filter((t) => t.type === "typography")) {
    const key = tok.name.replace(/^t-/, "");
    const v = tok.value;
    const family = String(v.fontFamily).includes("mono") ? "mono" : "ui";
    const css = rule(globalsText, `.t-${key}`);
    if (css) {
      const fam = css["font-family"]?.split(",")[0].trim();
      if (fam !== fontVar[family]) problems.push(`${tok.name}: .t-${key} uses ${fam}, tokens.json says ${family}`);
      if (css["font-size"] !== undefined && css["font-size"] !== v.fontSize) problems.push(`${tok.name}: .t-${key} font-size ${css["font-size"]}, tokens.json ${v.fontSize}`);
      if (css["font-weight"] !== undefined && Number(css["font-weight"]) !== v.fontWeight) problems.push(`${tok.name}: .t-${key} font-weight ${css["font-weight"]}, tokens.json ${v.fontWeight}`);
      if (css["line-height"] !== undefined && css["line-height"] !== v.lineHeight) problems.push(`${tok.name}: .t-${key} line-height ${css["line-height"]}, tokens.json ${v.lineHeight}`);
      if (!(none(css["letter-spacing"]) && none(v.letterSpacing)) && css["letter-spacing"] !== v.letterSpacing) problems.push(`${tok.name}: .t-${key} letter-spacing ${css["letter-spacing"]}, tokens.json ${v.letterSpacing}`);
    }
    const tw = tailwindSize(tailwindText, key);
    if (!tw) { problems.push(`${tok.name}: no --text-${key} in the @theme block of globals.css`); continue; }
    const lh = /lineHeight:\s*"([^"]+)"/.exec(tw[2])?.[1];
    const ls = /letterSpacing:\s*"([^"]+)"/.exec(tw[2])?.[1];
    if (tw[1] !== v.fontSize) problems.push(`${tok.name}: tailwind fontSize.${key} is ${tw[1]}, tokens.json ${v.fontSize}`);
    if (lh !== v.lineHeight) problems.push(`${tok.name}: tailwind lineHeight ${lh}, tokens.json ${v.lineHeight}`);
    if (!(none(ls) && none(v.letterSpacing)) && ls !== v.letterSpacing) problems.push(`${tok.name}: tailwind letterSpacing ${ls}, tokens.json ${v.letterSpacing}`);
  }
  return problems;
}

/** CSS custom properties for every token: Graphite on :root, Ivory overrides on [data-theme="light"]. */
export function toCss(tokens = loadTokens()) {
  const decl = (theme) => tokens
    .filter((t) => t.type !== "typography" && (theme === "dark" || t.light !== undefined))
    .map((t) => `  --${t.type === "fontFamily" ? `font-${t.name}` : t.name}: ${cssValue(t, theme, tokens)};`).join("\n");
  return `/* Generated by scripts/design-tokens.mjs from docs/design-system/tokens.json. Do not edit. */\n:root {\n${decl("dark")}\n}\n[data-theme="light"] {\n${decl("light")}\n}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes("--check")) {
    const problems = [...checkParity(), ...checkTypography()];
    if (problems.length) { console.error(`Token drift (${problems.length}):\n- ${problems.join("\n- ")}`); process.exit(1); }
    console.log(`Tokens match globals.css (${loadTokens().filter((t) => t.css).length} variables checked) and the type roles match .t-* and the @theme text scale (${loadTokens().filter((t) => t.type === "typography").length} tokens checked).`);
  } else if (args.includes("--css")) {
    const out = args[args.indexOf("--css") + 1];
    const css = toCss();
    if (out && !out.startsWith("--")) fs.writeFileSync(out, css); else process.stdout.write(css);
  } else { console.error("usage: design-tokens.mjs --check | --css [out.css]"); process.exit(2); }
}
