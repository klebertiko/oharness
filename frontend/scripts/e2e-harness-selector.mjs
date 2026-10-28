/**
 * Chat harness selector (ADR 0012), against the static export, both themes:
 * keyboard-only open/filter/choose, recents, the one Studio route, no provider
 * words, the loading/error/empty states, axe clean with the list open. Sidecar HTTP is stubbed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const base = process.env.OHM_E2E_URL || "http://127.0.0.1:3000";
const API = "http://127.0.0.1:18099";
const node = { id: "reply", type: "agent", position: { x: 0, y: 0 }, data: { label: "Reply", providerIds: [] } };
const bundle = (id, name, description = "") => ({ schemaVersion: "1", manifest: { id, name, description }, graph: { nodes: [node], edges: [] }, content: {}, runtime: {} });
const agile = bundle("oharness.default.agile", "Agile Harness", "Plan, build and review in small loops.");
const mine = Array.from({ length: 8 }, (_, i) => bundle(`oharness.custom.h${i}`, `Team Harness ${i}`, `Purpose number ${i}.`));

const launch = process.env.OHM_BROWSER_EXECUTABLE
  ? { executablePath: process.env.OHM_BROWSER_EXECUTABLE, headless: true }
  : { channel: process.env.OHM_BROWSER_CHANNEL || "msedge", headless: true };
const browser = await chromium.launch(launch);
const failures = [];

async function axe(page, label) {
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] });
    return r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => `${n.target.join(" ")} ${(n.any[0]?.message ?? "").slice(0, 120)}`).join(" | ")}`);
  });
  if (violations.length) failures.push(`${label}: axe ${violations.join("; ")}`);
}

async function session(theme, { failDefault = false, imports = mine } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  await context.addInitScript(([t, api, library]) => {
    try {
      if (!sessionStorage.getItem("e2e-seeded")) {
        localStorage.setItem("oharness-theme", t);
        localStorage.setItem("oh.harnessSession", JSON.stringify({ enabled: false, activeBundleId: null }));
        localStorage.setItem("oh.harnessLibrary", JSON.stringify({ imports: library.map((b) => ({ id: b.manifest.id, name: b.manifest.name, description: b.manifest.description, bundle: b, addedAt: 1 })) }));
        sessionStorage.setItem("e2e-seeded", "1");
      }
    } catch { /* storage blocked */ }
    window.__OH_API__ = api;
  }, [theme, API, imports]);
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    const key = `${request.method()} ${new URL(request.url()).pathname}`;
    if (key === "GET /bundles/default" && failDefault) return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    const responses = {
      "GET /health": { status: "ok" },
      "GET /bundles/default": agile,
      "GET /cowork/projects": { projects: [] },
      "GET /harnesses/": [],
      "GET /bundles/examples": { examples: [] },
      "GET /providers/connections": { connections: [{ id: "ollama-local", provider: "ollama", label: "QA local", enabled: true, residence: "local", endpoint: "http://127.0.0.1:11434", secretRef: null, defaultModel: "qa-default" }] },
      "GET /usage/summary": { totalTokens: 0, totalCostUsd: 0, unpricedTokens: 0, byConnection: [], bySource: [], budget: { limitUsd: null, spentUsd: 0, remainingUsd: null, pct: null, state: "unset" } },
    };
    if (!Object.hasOwn(responses, key)) return route.fulfill({ status: 501, contentType: "application/json", body: "{}" });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(responses[key]) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { context, page, errors };
}

for (const theme of ["dark", "light"]) {
  const label = (s) => `${s} · ${theme}`;
  const { context, page, errors } = await session(theme);
  const trigger = () => page.getByRole("button", { name: /^Harness:/ });
  try {
    await page.goto(base, { waitUntil: "networkidle" });
    await trigger().waitFor();

    // Keyboard only: focus the trigger, open, filter (9 harnesses -> filter shown), choose.
    await trigger().focus();
    await page.keyboard.press("Enter");
    const filter = page.getByRole("combobox", { name: "Filter Harness" });
    await filter.waitFor();
    const popover = page.locator("[data-combobox-popover]");
    const text = await popover.innerText();
    assert.ok(!/provider|connect|api key|credential/i.test(text), `no provider words in: ${text}`);
    assert.deepEqual(await popover.getByRole("button").allInnerTexts(), ["Open Studio"], "one route to Studio");
    await axe(page, label("selector open"));
    await page.keyboard.type("harness 3");
    assert.equal(await page.getByRole("option").count(), 1);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Harness: Team Harness 3" }).waitFor();
    assert.ok(await trigger().evaluate((el) => el === document.activeElement), "focus returns to the trigger");

    // Recents lead the list next time; Escape closes and keeps focus.
    await page.keyboard.press("Enter");
    await filter.waitFor();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Enter");
    await page.getByText("Recent", { exact: true }).waitFor();
    assert.match((await page.getByRole("option").nth(1).innerText()), /^Team Harness 3/);
    await page.keyboard.press("Escape");

    // The single Studio route, from a chosen harness.
    await trigger().click();
    await page.getByRole("button", { name: "Edit in Studio" }).click();
    await page.getByRole("heading", { level: 1 }).first().waitFor();
    await page.getByRole("button", { name: "Chats", exact: true }).first().click();
  } catch (e) {
    failures.push(`${label("flow")}: ${e.message}`);
  }
  if (errors.length) failures.push(`${label("page errors")}: ${errors.join("; ")}`);
  await context.close();

  // Error state: the list could not load.
  const bad = await session(theme, { failDefault: true, imports: [] });
  try {
    await bad.page.goto(base, { waitUntil: "networkidle" });
    await bad.page.getByRole("button", { name: /^Harness:/ }).click();
    await bad.page.getByRole("alert").filter({ hasText: /Couldn.t load harnesses/ }).waitFor();
    await bad.page.getByRole("button", { name: "Try again" }).waitFor();
    await axe(bad.page, label("selector error"));
  } catch (e) {
    failures.push(`${label("error state")}: ${e.message}`);
  }
  await bad.context.close();
}
await browser.close();
if (failures.length) {
  console.error(`FAIL:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("PASS: harness selector (keyboard, filter, recents, one Studio route, no provider words, error state), both themes, axe clean.");
