/**
 * Nilo proposal lifecycle (ADR 0010), against the static export, both themes:
 * describe -> ghosts only (canvas untouched) -> drop one change -> Apply as one
 * step -> Undo; Discard with Escape; axe clean at each stop. All sidecar HTTP is stubbed.
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
const stubs = {
  "GET /health": { status: "ok" },
  "GET /cowork/projects": { projects: [] },
  "GET /providers/connections": { connections: [] },
  "GET /bundles/examples": { examples: [] },
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

async function axe(page, label) {
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] });
    return r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => `${n.target.join(" ")} ${(n.any[0]?.message ?? "").slice(0, 160)} <${n.html.slice(0, 120)}>`).join(" | ")}`);
  });
  if (violations.length) failures.push(`${label}: axe ${violations.join("; ")}`);
}

for (const theme of ["dark", "light"]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  await context.addInitScript(([t, api]) => {
    try { localStorage.setItem("oharness-theme", t); } catch { /* storage blocked */ }
    window.__OH_API__ = api;
  }, [theme, API]);
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    const key = `${request.method()} ${new URL(request.url()).pathname}`;
    if (!Object.hasOwn(stubs, key)) return route.fulfill({ status: 501, contentType: "application/json", body: JSON.stringify({ detail: `Unstubbed E2E request: ${key}` }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stubs[key]) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const label = (s) => `${s} · ${theme}`;
  try {
    await page.goto(base, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Studio", exact: true }).first().click();
    await page.getByRole("textbox", { name: /Describe the harness/ }).fill("Research a topic then check the brief");
    await page.getByRole("button", { name: "Draft with Nilo" }).click();

    // 1. Pending: ghosts on the canvas, history untouched, focus on Apply.
    const card = page.getByRole("region", { name: "Proposed changes" });
    await card.waitFor();
    const apply = card.getByRole("button", { name: "Apply 3 changes" });
    await apply.waitFor();
    assert.equal(await page.locator(".react-flow__node").count(), 2, "ghost nodes drawn");
    await page.getByLabel("Proposed: Agent Researcher").waitFor();
    assert.ok(await apply.evaluate((el) => el === document.activeElement), "focus on Apply");
    await axe(page, label("pending"));

    // 2. Drop the gate: its wire goes with it.
    await card.getByRole("checkbox", { name: /Gate "Brief check"/ }).uncheck();
    await card.getByRole("button", { name: "Apply 1 change" }).waitFor();
    assert.equal(await page.locator(".react-flow__node").count(), 1);

    // 3. Escape discards: nothing is left on the canvas.
    await card.press("Escape");
    await page.getByText("Discarded").waitFor();
    assert.equal(await page.locator(".react-flow__node").count(), 0);

    // 4. Refine: ask again (offline draft), apply everything, then undo.
    await page.getByRole("textbox", { name: "Ask Nilo" }).fill("Same again");
    await page.getByRole("button", { name: /offline draft/i }).click();
    const second = page.getByRole("region", { name: "Proposed changes" }).last();
    await second.getByRole("button", { name: "Apply 3 changes" }).click();
    await page.getByRole("region", { name: "Applied changes" }).waitFor();
    assert.equal(await page.locator(".react-flow__node").count(), 2);
    assert.equal(await page.getByLabel(/^Proposed:/).count(), 0, "no ghosts once applied");
    await axe(page, label("applied"));
    await page.getByRole("region", { name: "Applied changes" }).getByRole("button", { name: "Undo" }).click();
    await page.getByText("Undone").waitFor();
    assert.equal(await page.locator(".react-flow__node").count(), 0);
  } catch (e) {
    failures.push(`${label("flow")}: ${e.message}`);
  }
  if (errors.length) failures.push(`${label("page errors")}: ${errors.join("; ")}`);
  await context.close();
}
await browser.close();
if (failures.length) {
  console.error(`FAIL:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("PASS: Nilo proposal lifecycle (preview, partial apply, discard, undo), both themes, axe clean.");
