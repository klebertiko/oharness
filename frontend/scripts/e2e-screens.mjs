/**
 * Every destination, both themes, desktop and mobile, against the static export
 * (run-e2e.mjs serves out/ and sets OHM_E2E_URL). Proves, in a real browser:
 *
 *   - no page error and no console error on any screen;
 *   - axe-core finds nothing (WCAG 2.2 AA + best practices, colour contrast included);
 *   - the saved theme is on <html> at first contentful paint (no flash);
 *   - Sora and IBM Plex Mono are the faces actually loaded, from this origin;
 *   - the keyboard works: skip link, command palette (focus returns to its opener),
 *     visible focus ring on the first control;
 *   - nothing scrolls the page sideways at 390px.
 *
 * All sidecar HTTP is stubbed, so no backend is needed. Set OHM_E2E_SHOTS=<dir>
 * to keep a screenshot of every state.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const base = process.env.OHM_E2E_URL || "http://127.0.0.1:3000";
const API = "http://127.0.0.1:18099";
const shots = process.env.OHM_E2E_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const connections = [
  { id: "anthropic", provider: "anthropic", label: "Anthropic", residence: "cloud", endpoint: "", enabled: true, secretRef: null },
  { id: "ollama-local", provider: "ollama", label: "Ollama local", residence: "local", endpoint: "http://127.0.0.1:11434", enabled: false, secretRef: null },
];
const usage = { totalTokens: 0, totalCostUsd: 0, unpricedTokens: 0, budget: { limitUsd: null, spentUsd: 0, remainingUsd: null, pct: null, state: "unset" }, byConnection: [], bySource: [] };
const stubs = {
  "GET /health": { status: "ok" },
  "GET /cowork/projects": { projects: [] },
  "GET /providers/connections": { connections },
  "GET /bundles/examples": { examples: [] },
  "GET /harnesses/": [],
  "GET /flow/config": { enabled: false },
  "GET /usage/summary": usage,
};

const launch = process.env.OHM_BROWSER_EXECUTABLE
  ? { executablePath: process.env.OHM_BROWSER_EXECUTABLE, headless: true }
  : { channel: process.env.OHM_BROWSER_CHANNEL || "msedge", headless: true };
const browser = await chromium.launch(launch);

const failures = [];
const note = (ok, label, detail = "") => {
  if (!ok) failures.push(`${label}${detail ? `: ${detail}` : ""}`);
};

const screens = [
  { id: "chats", nav: "Chats" },
  { id: "studio-overview", nav: "Studio" },
  {
    id: "studio-editor",
    nav: "Studio",
    act: async (page) => {
      await page.getByRole("button", { name: /new harness/i }).first().click();
      await page.getByRole("heading", { level: 1 }).first().waitFor();
    },
  },
  { id: "providers", nav: "Providers" },
];
const viewports = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

for (const theme of ["dark", "light"]) {
  for (const [vname, viewport] of Object.entries(viewports)) {
    const context = await browser.newContext({ viewport, serviceWorkers: "block" });
    await context.addInitScript(
      ([t, api]) => {
        try { localStorage.setItem("oharness-theme", t); } catch { /* storage blocked */ }
        window.__OH_API__ = api;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (e.name === "first-contentful-paint") window.__fcpTheme = document.documentElement.dataset.theme;
        }).observe({ type: "paint", buffered: true });
      },
      [theme, API],
    );
    const external = [];
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(base).origin) return route.continue();
      if (url.origin !== API) { external.push(url.origin + url.pathname); return route.abort(); }
      const key = `${route.request().method()} ${url.pathname}`;
      if (key in stubs) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stubs[key]) });
      return route.fulfill({ status: 404, contentType: "application/json", body: '{"detail":"not stubbed"}' });
    });

    for (const s of screens) {
      const label = `${s.id} · ${theme} · ${vname}`;
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      page.on("console", (m) => { if (m.type() === "error" && !/not stubbed|status of 404/.test(m.text())) errors.push(m.text().slice(0, 160)); });
      await page.goto(base, { waitUntil: "networkidle" });

      // The theme was applied before the first paint, not after hydration.
      const fcp = await page.evaluate(() => window.__fcpTheme);
      note(fcp === theme, `${label}: theme at first paint`, `${fcp} instead of ${theme}`);
      note((await page.evaluate(() => document.documentElement.style.colorScheme)) === theme, `${label}: color-scheme`);
      note((await page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? "")).startsWith("oklch("), `${label}: theme-color meta`);

      await page.getByRole("button", { name: s.nav, exact: true }).first().click();
      if (s.act) await s.act(page);
      await page.waitForTimeout(400);

      // Self-hosted faces, same origin, actually loaded.
      const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.toLowerCase()));
      note(fonts.some((f) => f.includes("sora")), `${label}: Sora loaded`, fonts.join(","));
      // Faces load when text first uses them; Chats at 390px shows no machine data yet.
      if (s.id !== "chats") note(fonts.some((f) => f.includes("plex")), `${label}: IBM Plex Mono loaded`, fonts.join(","));

      await page.addScriptTag({ content: axeSource });
      const violations = await page.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] });
        return r.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
      });
      note(violations.length === 0, `${label}: axe`, violations.join("; "));

      if (vname === "mobile") {
        const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        note(!wide, `${label}: horizontal scroll`);
      }
      note(errors.length === 0, `${label}: console`, errors.join("; "));
      if (shots) await page.screenshot({ path: join(shots, `${s.id}.${theme}.${vname}.png`) });
      await page.close();
    }

    // Keyboard contract, once per context on the first screen.
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(base, { waitUntil: "networkidle" });
    // The composer takes focus on a blank chat, so check the skip link directly: it is the
    // first focusable element, it appears on focus, and Enter lands on the main region.
    const skip = await page.evaluate(() => {
      const first = document.querySelector("a[href], button, input, textarea, select, [tabindex]:not([tabindex='-1'])");
      first.focus();
      const r = first.getBoundingClientRect();
      return { text: first.textContent.trim(), visible: r.top >= 0 && r.bottom <= innerHeight && r.width > 0 };
    });
    note(skip.text === "Skip to main content", `keyboard · ${theme} · ${vname}: first focusable element`, skip.text);
    note(skip.visible, `keyboard · ${theme} · ${vname}: skip link is shown on focus`);
    await page.keyboard.press("Enter");
    note(await page.evaluate(() => document.activeElement?.id === "oh-main"), `keyboard · ${theme} · ${vname}: skip link lands on main`);

    const opener = page.getByRole("button", { name: "Search and commands" });
    await opener.focus();
    await opener.click();
    await page.getByRole("dialog", { name: "Command palette" }).waitFor();
    note(await page.evaluate(() => document.activeElement?.getAttribute("role") === "combobox"), `keyboard · ${theme} · ${vname}: palette focuses its field`);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    // Radix hands focus back on the next task after unmount, so wait for it.
    const returned = await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Search and commands", null, { timeout: 2000 }).then(() => true, () => false);
    note(returned, `keyboard · ${theme} · ${vname}: focus returns to the opener`);

    const ring = await page.evaluate(() => {
      const el = document.querySelector('nav[aria-label="Destinations"] button');
      el.focus({ focusVisible: true });
      const cs = getComputedStyle(el);
      return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
    });
    note(ring.style !== "none" && ring.width >= 2, `keyboard · ${theme} · ${vname}: visible focus ring`, JSON.stringify(ring));
    note(external.length === 0, `${theme} · ${vname}: external requests`, external.join(", "));
    await context.close();
  }
}

await browser.close();
assert.deepEqual(failures, [], `Screen contract broken:\n- ${failures.join("\n- ")}`);
console.log("PASS: 4 screens × 2 themes × 2 widths: axe clean, theme before paint, fonts self-hosted, keyboard contract, no console errors.");
