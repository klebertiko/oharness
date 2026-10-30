/**
 * Narrow windows and motion (ADR 0048): at 390 and 768 px the Nilo review card
 * is reachable in the side sheet, Apply works, nothing scrolls sideways, the
 * harness list stays inside the viewport; under reduced motion the ghost
 * arrival is not animated. Both themes, axe clean. Sidecar HTTP is stubbed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const base = process.env.OHM_E2E_URL || "http://127.0.0.1:3000";
const API = "http://127.0.0.1:18099";
const plan = {
  summary: "A researcher feeding a brief check.",
  source: "offline",
  tokens: 0,
  ops: [
    { op: "addNode", ref: "n1", type: "agent", label: "Researcher" },
    { op: "addNode", ref: "n2", type: "gate", label: "Brief check" },
    { op: "connect", from: "n1", to: "n2" },
  ],
};
const node = { id: "reply", type: "agent", position: { x: 0, y: 0 }, data: { label: "Reply", providerIds: [] } };
const agile = { schemaVersion: "1", manifest: { id: "oharness.default.agile", name: "Agile Harness", description: "Delivery loop." }, graph: { nodes: [node], edges: [] }, content: {}, runtime: {} };
const stubs = {
  "GET /health": { status: "ok" },
  "GET /cowork/projects": { projects: [] },
  "GET /providers/connections": { connections: [] },
  "GET /bundles/examples": { examples: [] },
  "GET /bundles/default": agile,
  "GET /harnesses/": [],
  "GET /flow/config": { enabled: false },
  "GET /usage/summary": { totalTokens: 0, totalCostUsd: 0, unpricedTokens: 0, budget: { limitUsd: null, spentUsd: 0, remainingUsd: null, pct: null, state: "unset" }, byConnection: [], bySource: [] },
  "POST /studio/copilot/plan": plan,
};

const launch = process.env.OHM_BROWSER_EXECUTABLE
  ? { executablePath: process.env.OHM_BROWSER_EXECUTABLE, headless: true }
  : { channel: process.env.OHM_BROWSER_CHANNEL || "msedge", headless: true };
const browser = await chromium.launch(launch);
const failures = [];
async function stubbedContext(options, init) {
  const context = await browser.newContext({ serviceWorkers: "block", ...options });
  await context.addInitScript(init.fn, init.arg);
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    const key = `${request.method()} ${new URL(request.url()).pathname}`;
    if (!Object.hasOwn(stubs, key)) return route.fulfill({ status: 501, contentType: "application/json", body: "{}" });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stubs[key]) });
  });
  return context;
}


async function axe(page, label) {
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] });
    return r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
  });
  if (violations.length) failures.push(`${label}: axe ${violations.join("; ")}`);
}

for (const theme of ["dark", "light"]) {
  for (const width of [390, 768]) {
    const label = (s) => `${s} · ${theme} · ${width}`;
    const context = await stubbedContext({ viewport: { width, height: 844 }, reducedMotion: "reduce" }, {
      fn: ([t, api]) => {
        try { localStorage.setItem("oharness-theme", t); } catch { /* storage blocked */ }
        window.__OH_API__ = api;
      },
      arg: [theme, API],
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(base, { waitUntil: "networkidle" });

      // Harness list inside the viewport.
      await page.getByRole("button", { name: /^Harness:/ }).click();
      const box = await page.locator("[data-combobox-popover]").boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, `harness list inside ${width}px: ${JSON.stringify(box)}`);
      await page.keyboard.press("Escape");

      // Describe -> proposal in the sheet.
      await page.getByRole("button", { name: "Studio", exact: true }).first().click();
      await page.getByRole("textbox", { name: /Describe the harness/ }).fill("Research a topic then check the brief");
      await page.getByRole("button", { name: "Draft with Nilo" }).click();
      const card = page.getByRole("region", { name: "Proposed changes" });
      await card.waitFor();
      const cardBox = await card.boundingBox();
      assert.ok(cardBox && cardBox.x >= 0 && cardBox.x + cardBox.width <= width + 1, `review card inside ${width}px`);
      assert.ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "no sideways scroll");
      // Reduced motion: the ghosts arrive without an animation.
      assert.ok((await page.locator(".react-flow__node").count()) >= 2, "ghosts are on the canvas");
      const animated = await page.evaluate(() => [...document.querySelectorAll(".react-flow__node")].some((n) => getComputedStyle(n).animationName !== "none"));
      assert.equal(animated, false, "no animation under reduced motion");
      await axe(page, label("review"));
      await card.getByRole("button", { name: "Apply 3 changes" }).click();
      await page.getByRole("region", { name: "Applied changes" }).waitFor();
      await axe(page, label("applied"));
    } catch (e) {
      failures.push(`${label("flow")}: ${e.message}`);
    }
    if (errors.length) failures.push(`${label("page errors")}: ${errors.join("; ")}`);
    await context.close();
  }
}
// With motion allowed, the proposal fades in (opacity only).
{
  const context = await stubbedContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" }, {
    fn: (api) => { window.__OH_API__ = api; },
    arg: API,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  try {
    await page.goto(base, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Studio", exact: true }).first().click();
    await page.getByRole("textbox", { name: /Describe the harness/ }).fill("Research a topic then check the brief");
    await page.getByRole("button", { name: "Draft with Nilo" }).click();
    await page.getByLabel("Proposed: Agent Researcher").waitFor({ state: "attached" });
    const name = await page.getByLabel("Proposed: Agent Researcher").evaluate((n) => getComputedStyle(n).animationName);
    assert.equal(name, "oh-ghost-in", "ghost fades in when motion is allowed");
  } catch (e) {
    failures.push(`motion: ${e.message}`);
  }
  await context.close();
}
await browser.close();
if (failures.length) {
  console.error(`FAIL:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("PASS: narrow windows (390/768) and reduced motion: review card in the sheet, harness list in the viewport, axe clean, both themes.");
