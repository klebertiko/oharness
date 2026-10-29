import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The design system's own rules, enforced on the source: no colour, radius or
 * font size outside the tokens, state colours only as text through their text
 * forms, one focus ring, and an English interface. These replace the "lint
 * (later)" item in docs/design-system/adoption.md. Dev fixtures under
 * src/app/dev are exempt.
 */
const SRC = path.resolve(__dirname, "..");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const files = walk(SRC)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .filter((f) => !/\.test\.(tsx?)$/.test(f) && !f.includes(`${path.sep}app${path.sep}dev${path.sep}`) && !f.includes(`${path.sep}test${path.sep}`));

const lines = files.flatMap((f) =>
  fs
    .readFileSync(f, "utf8")
    .split("\n")
    .map((text, i) => ({ file: path.relative(SRC, f), n: i + 1, text }))
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l.text)),
);

const offenders = (re: RegExp, only?: RegExp) =>
  lines.filter((l) => re.test(l.text) && (!only || only.test(l.file))).map((l) => `${l.file}:${l.n}  ${l.text.trim().slice(0, 100)}`);

describe("design-system guardrails", () => {
  it("has no arbitrary font sizes (use t-meta, t-body, t-title, t-reading, t-display)", () => {
    expect(offenders(/\btext-\[\d/)).toEqual([]);
  });

  it("has no arbitrary radii (use radius-control, panel, float, composer, hero)", () => {
    expect(offenders(/\brounded-\[/)).toEqual([]);
  });

  it("has no raw colours in classes or inline styles", () => {
    expect(offenders(/\b(?:bg|text|border|ring|fill|stroke|from|to|via)-\[(?:#|rgb|hsl|oklch)/, /\.tsx$/)).toEqual([]);
    expect(offenders(/["'`]#[0-9a-fA-F]{3,8}["'`]/, /\.tsx?$/)).toEqual([]);
  });

  it("marks a selected row with shadow-selected, not an ad hoc inset shadow", () => {
    expect(offenders(/shadow-\[inset_2px_0_0/, /\.tsx$/)).toEqual([]);
  });

  it("takes transition times from the duration tokens (the 620ms march and the reduced-motion reset are the only literals)", () => {
    expect(offenders(/transition[^;]*\b\d+ms\b/, /\.css$/).filter((o) => !o.includes("0.01ms"))).toEqual([]);
  });

  it("uses state colours as text only through warn-text, fault-text and signal-text", () => {
    expect(offenders(/(?<![-\w])(?:hover:|focus:)?text-(?:warn|fault|signal)(?![-\w])/, /\.tsx$/)).toEqual([]);
  });

  it("only sets a control edge with line-strong (no border-line-soft on inputs)", () => {
    const inputs = offenders(/<(?:input|textarea|select)\b[^>]*border-line-soft/, /\.tsx$/);
    expect(inputs).toEqual([]);
  });

  it("never removes the focus ring without a stated replacement", () => {
    // Allowed: a wrapper draws the ring (composer, palette tick) or the element is a programmatic focus target.
    const allowed = ["agent/ChatComposer.tsx", "studio/StudioOverview.tsx", "shell/CommandPalette.tsx", "shell/AppShell.tsx", "ui/Combobox.tsx"].map((f) => f.replace(/\//g, path.sep));
    const bad = offenders(/\boutline-(?:none|hidden)\b/, /\.tsx$/).filter((o) => !allowed.some((a) => o.startsWith(`components${path.sep}${a}`)));
    expect(bad).toEqual([]);
  });

  it("keeps the interface in English (no accented Portuguese strings)", () => {
    expect(offenders(/[À-ÖØ-öø-ÿ]/, /\.tsx?$/)).toEqual([]);
  });
});
