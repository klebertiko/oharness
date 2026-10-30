/**
 * Screen audit: walks every destination and overlay of the running app in both
 * themes and at desktop and mobile widths, runs axe-core (WCAG 2.2 AA plus
 * best practices), and records console errors, hit-target sizes, loaded fonts
 * and horizontal overflow. Writes one PNG per state and a results.json.
 *
 *   npm run dev                      # terminal A (frontend, :3000)
 *   python -m uvicorn main:app ...   # terminal B (sidecar, :8000), optional
 *   node scripts/audit-screens.mjs   # OUT=<dir> BASE=<url> CHROME=<binary>
 *
 * Needs the playwright and axe-core dev dependencies; does not install a browser.
 */
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
import { settleForAxe } from "./axe-settle.mjs";
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const BASE = process.env.BASE || "http://localhost:3000";
const API = process.env.OH_API || "http://127.0.0.1:8000";
// OUT is a directory you choose; without one, a private (0700) temp directory is created.
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), "oharness-audit-"));
mkdirSync(OUT, { recursive: true });
console.log(`Writing to ${OUT}`);

const click = async (page, name) => {
  await page.getByRole("button", { name, exact: true }).first().click({ timeout: 3000 });
  await page.waitForTimeout(400);
};

export const screens = [
  { id: "chats", nav: "Chats" },
  { id: "chats-palette", nav: "Chats", act: async (p) => { await p.keyboard.press("Control+k"); await p.waitForTimeout(400); } },
  { id: "chats-keymap", nav: "Chats", act: (p) => click(p, "Keyboard map") },
  { id: "studio-overview", nav: "Studio" },
  { id: "studio-editor", nav: "Studio", act: async (p) => {
    await p.getByRole("button", { name: /new harness/i }).first().click({ timeout: 3000 });
    await p.waitForTimeout(800);
  } },
  { id: "providers", nav: "Providers" },
];
const viewports = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const results = [];
for (const theme of ["dark", "light"]) {
  for (const [vname, viewport] of Object.entries(viewports)) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(([t, api]) => {
      try { localStorage.setItem("oharness-theme", t); } catch { /* storage blocked */ }
      window.__OH_API__ = api;
    }, [theme, API]);
    for (const s of screens) {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
      await page.goto(BASE, { waitUntil: "networkidle" }).catch(() => {});
      await page.waitForTimeout(500);
      try {
        if (s.nav) await click(page, s.nav);
        if (s.act) await s.act(page);
      } catch (e) { errors.push(`act: ${e.message.slice(0, 150)}`); }
      // The Next.js dev indicator is not part of the product; keep it out of the audit and the captures.
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      await settleForAxe(page);
      await page.addScriptTag({ content: axeSource });
      const axe = await page.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] });
        return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, sample: v.nodes.slice(0, 2).map((n) => n.target.join(" ")) }));
      });
      const layout = await page.evaluate(() => {
        const overflow = [...document.querySelectorAll("body *")].filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.right > innerWidth + 1 && getComputedStyle(e).position !== "fixed";
        }).length;
        const small = [...document.querySelectorAll("button,a,[role=button],input,select,textarea")].filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && (r.height < 24 || r.width < 24);
        }).length;
        return {
          horizontalScroll: document.documentElement.scrollWidth > innerWidth,
          overflowElements: overflow,
          smallTargets: small,
          loadedFonts: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family),
        };
      });
      const key = `${s.id}.${theme}.${vname}`;
      await page.screenshot({ path: join(OUT, `${key}.png`) });
      results.push({ key, errors: [...new Set(errors)], axe, layout });
      await page.close();
    }
    await context.close();
  }
}
await browser.close();
writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
for (const r of results) {
  console.log(r.key.padEnd(34), "axe:", r.axe.map((a) => `${a.id}(${a.nodes})`).join(",") || "clean", "| console errors:", r.errors.length, "| small targets:", r.layout.smallTargets, r.layout.horizontalScroll ? "| HSCROLL" : "");
}
