/**
 * The title bar on narrow screens (320 and 375px, both themes, three destinations). Proves, in a real
 * browser against the static export with a stubbed sidecar:
 *
 *   - the brand column is exactly as wide as the rail under it (and the rail is the narrow one);
 *   - what the bar shows for the destination (its name, or the harness name field in the Studio editor)
 *     clears the search button;
 *   - nothing scrolls the page sideways and axe finds nothing.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
import { settleForAxe } from "./axe-settle.mjs";
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const fixture = JSON.parse(readFileSync("src/lib/fixtures/ohm-roundtrip.json", "utf8"));
const base = process.env.OHM_E2E_URL || "http://127.0.0.1:3000";
const API = "http://127.0.0.1:18099";
const stubs = {
  "GET /health": { status: "ok" }, "GET /bundles/default": fixture, "GET /cowork/projects": { projects: [] },
  "GET /harnesses/": [], "GET /bundles/examples": { examples: [] }, "GET /providers/connections": { connections: [] },
  "GET /flow/config": { enabled: false },
  "GET /usage/summary": { totalTokens: 0, totalCostUsd: 0, unpricedTokens: 0, budget: { limitUsd: null, spentUsd: 0, remainingUsd: null, pct: null, state: "unset" }, byConnection: [], bySource: [] },
};
const launch = process.env.OHM_BROWSER_EXECUTABLE
  ? { executablePath: process.env.OHM_BROWSER_EXECUTABLE, headless: true }
  : { channel: process.env.OHM_BROWSER_CHANNEL || "msedge", headless: true };
const browser = await chromium.launch(launch);
let checked = 0;
try {
  for (const theme of ["dark", "light"]) {
    for (const width of [320, 375]) {
      const context = await browser.newContext({ viewport: { width, height: 780 }, serviceWorkers: "block" });
      await context.addInitScript(([t, api]) => {
        try { localStorage.setItem("oharness-theme", t); } catch { /* storage blocked */ }
        window.__OH_API__ = api;
      }, [theme, API]);
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.origin === new URL(base).origin) return route.continue();
        const key = `${route.request().method()} ${url.pathname}`;
        if (url.origin !== API || !(key in stubs)) return route.fulfill({ status: 404, body: "{}" });
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(stubs[key]) });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      await page.goto(base, { waitUntil: "networkidle" });
      for (const dest of ["Chats", "Studio", "Providers"]) {
        await page.getByRole("button", { name: dest, exact: true }).first().click();
        await page.waitForTimeout(250);
        if (dest === "Studio" && !(await page.locator(".oh-header-name").count())) {
          // The editor shows the harness name field in the bar: the widest thing that can crowd the search button.
          await page.getByRole("button", { name: /new harness/i }).first().click();
          await page.locator(".oh-header-name").waitFor();
        }
        const m = await page.evaluate(() => {
          const rect = (s) => document.querySelector(s)?.getBoundingClientRect();
          const rail = document.querySelector("nav")?.getBoundingClientRect();
          const brand = rect(".oh-header-brand");
          const name = rect(".oh-header-name");
          const mode = rect(".oh-header-mode");
          const shown = name && name.width > 0 ? name : mode;
          const search = rect('button[aria-label="Search and commands"]');
          return { brand: brand?.width, rail: rail?.width, shownRight: shown?.right, shownWidth: shown?.width, usesName: Boolean(name), searchLeft: search?.left, side: document.documentElement.scrollWidth > innerWidth + 1 };
        });
        const label = `${dest} ${theme} ${width}`;
        assert.equal(m.brand, m.rail, `${label}: brand column (${m.brand}) is as wide as the rail (${m.rail})`);
        assert.equal(m.rail, 52, `${label}: the rail is the icon-only one`);
        assert.ok(m.shownWidth > 0, `${label}: the destination is shown`);
        assert.ok(m.shownRight + 8 <= m.searchLeft, `${label}: destination (${m.shownRight}) clears the search button (${m.searchLeft}) by 8px`);
        assert.equal(m.side, false, `${label}: sideways scroll`);
        await settleForAxe(page);
        await page.addScriptTag({ content: axeSource });
        const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] })).violations.map((x) => x.id));
        assert.deepEqual(v, [], `${label}: axe`);
        checked += 1;
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`PASS title bar: ${checked} destination states at 320 and 375px in both themes`);
