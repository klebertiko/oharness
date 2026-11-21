import fs from "node:fs";
import { createRequire } from "node:module";
import { chromium, type Page } from "playwright";
import { describe, expect, it } from "vitest";
import { GROUNDS, LARGE, TEXT, readCss } from "./contrastPairs";

const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

type Row = { fg: string; bg: string; large: boolean };

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

function styleRules(css: string): string {
  return [
    block(css, ":root {"),
    block(css, '[data-theme="light"] {'),
    block(css, ':root[data-density="compact"] {'),
    block(css, "@media (prefers-color-scheme: light)"),
    "body{margin:0}",
  ].join("\n");
}

function rows(): Row[] {
  return [
    ...TEXT.flatMap((fg) => GROUNDS.map((bg) => ({ fg, bg, large: false }))),
    ...LARGE.flatMap((fg) => GROUNDS.map((bg) => ({ fg, bg, large: true }))),
  ];
}

/** Paint token pairs with DOM calls. The names are our tokens, and text is set as text, not markup. */
async function paint(page: Page, theme: string, density: string, rules: string, pairs: Row[]) {
  await page.setContent("<!doctype html><html><head></head><body></body></html>");
  await page.evaluate(
    ({ theme, density, rules, pairs }) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.density = density;
      const style = document.createElement("style");
      style.textContent = rules;
      document.head.appendChild(style);
      for (const pair of pairs) {
        const node = document.createElement("p");
        node.style.color = "var(--" + pair.fg + ")";
        node.style.background = "var(--" + pair.bg + ")";
        node.style.fontSize = pair.large ? "24px" : "16px";
        if (pair.large) node.style.fontWeight = "600";
        node.textContent = pair.fg + " on " + pair.bg;
        document.body.appendChild(node);
      }
    },
    { theme, density, rules, pairs },
  );
}

describe("axe contrast", () => {
  it("passes in both themes and both densities", async () => {
    const css = readCss();
    const rules = styleRules(css);
    const pairs = rows();
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const failures: string[] = [];
      for (const theme of ["dark", "light"]) {
        for (const density of ["comfortable", "compact"]) {
          const page = await browser.newPage({ colorScheme: theme === "light" ? "light" : "dark" });
          await paint(page, theme, density, rules, pairs);
          await page.addScriptTag({ content: axeSource });
          const violations = await page.evaluate(async () => {
            const axe = (window as unknown as { axe: { run: (node: Document, options: object) => Promise<{ violations: { id: string; nodes: { failureSummary?: string }[] }[] }> } }).axe;
            const result = await axe.run(document, { runOnly: { type: "rule", values: ["color-contrast"] } });
            return result.violations.flatMap((violation) => violation.nodes.map((node) => node.failureSummary ?? violation.id));
          });
          if (violations.length) failures.push(theme + "/" + density + ": " + violations.slice(0, 4).join(" | "));
          await page.close();
        }
      }
      expect(failures).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
