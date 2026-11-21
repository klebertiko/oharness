import fs from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { GROUNDS, LARGE, TEXT, readCss } from "./contrastPairs";

const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

function block(css: string, marker: string): string {
  const at = css.indexOf(marker);
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(at, i + 1);
  }
  throw new Error(marker);
}

function pageHtml(css: string, theme: string, density: string): string {
  const rules = [
    block(css, ":root {"),
    block(css, '[data-theme="light"] {'),
    block(css, ':root[data-density="compact"] {'),
    block(css, "@media (prefers-color-scheme: light)"),
  ].join("\n");
  const rows = [
    ...TEXT.flatMap((fg) => GROUNDS.map((bg) => `<p style="color:var(--${fg});background:var(--${bg});font-size:16px">${fg} on ${bg}</p>`)),
    ...LARGE.flatMap((fg) => GROUNDS.map((bg) => `<p style="color:var(--${fg});background:var(--${bg});font-size:24px;font-weight:600">${fg} on ${bg}</p>`)),
  ].join("");
  return `<!doctype html><html data-theme="${theme}" data-density="${density}"><head><style>${rules} body{margin:0}</style></head><body>${rows}</body></html>`;
}

describe("axe contrast", () => {
  it("passes in both themes and both densities", async () => {
    const css = readCss();
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const failures: string[] = [];
      for (const theme of ["dark", "light"]) {
        for (const density of ["comfortable", "compact"]) {
          const page = await browser.newPage({ colorScheme: theme === "light" ? "light" : "dark" });
          await page.setContent(pageHtml(css, theme, density));
          await page.addScriptTag({ content: axeSource });
          const violations = await page.evaluate(async () => {
            const axe = (window as unknown as { axe: { run: (node: Document, options: object) => Promise<{ violations: { id: string; nodes: { failureSummary?: string }[] }[] }> } }).axe;
            const result = await axe.run(document, { runOnly: { type: "rule", values: ["color-contrast"] } });
            return result.violations.flatMap((violation) => violation.nodes.map((node) => node.failureSummary ?? violation.id));
          });
          if (violations.length) failures.push(`${theme}/${density}: ${violations.slice(0, 4).join(" | ")}`);
          await page.close();
        }
      }
      expect(failures).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
