/**
 * Chat harness semantics (ADR 0011), against the static export, both themes:
 * the choice belongs to the chat and applies from the next turn; changing it
 * after messages leaves a marker; a deleted harness blocks sending without a
 * silent swap; axe clean. All sidecar HTTP is stubbed.
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
const agile = { schemaVersion: "1", manifest: { id: "oharness.default.agile", name: "Agile Harness", description: "Delivery loop." }, graph: { nodes: [node], edges: [] }, content: {}, runtime: {} };
const demo = { schemaVersion: "1", manifest: { id: "oharness.custom.demo", name: "Demo Harness", description: "A small demo." }, graph: { nodes: [node], edges: [] }, content: {}, runtime: {} };
const stream = (id) => [
  ["run_start", { run_id: id, order: [{ node_id: "reply", type: "agent", label: "Reply" }] }],
  ["node_start", { node_id: "reply", adapter: "ollama", model: "qa-default" }],
  ["node_done", { node_id: "reply", output: `Answer ${id}`, tokens: 2 }],
  ["harness_done", { tokens: 2 }],
].map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");

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

for (const theme of ["dark", "light"]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  const requests = [];
  await context.addInitScript(([t, api, demoBundle]) => {
    try {
      if (!sessionStorage.getItem("e2e-seeded")) {
        localStorage.setItem("oharness-theme", t);
        localStorage.setItem("oh.harnessSession", JSON.stringify({ enabled: true, activeBundleId: "oharness.default.agile" }));
        localStorage.setItem("oh.harnessLibrary", JSON.stringify({ imports: [{ id: demoBundle.manifest.id, name: demoBundle.manifest.name, bundle: demoBundle, addedAt: 1 }] }));
        sessionStorage.setItem("e2e-seeded", "1");
      }
    } catch { /* storage blocked */ }
    window.__OH_API__ = api;
  }, [theme, API, demo]);
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    const key = `${request.method()} ${new URL(request.url()).pathname}`;
    if (key === "POST /execute/" || key === "POST /execute/direct") {
      requests.push(key);
      return route.fulfill({ contentType: "text/event-stream", body: stream(`run-${requests.length}`) });
    }
    const responses = {
      "GET /health": { status: "ok" },
      "GET /bundles/default": agile,
      "GET /cowork/projects": { projects: [] },
      "GET /harnesses/": [],
      "GET /bundles/examples": { examples: [] },
      "GET /providers/connections": { connections: [{ id: "ollama-local", provider: "ollama", label: "QA local", enabled: true, residence: "local", endpoint: "http://127.0.0.1:11434", secretRef: null, defaultModel: "qa-default" }] },
      "GET /flow/config": { enabled: false },
      "GET /usage/summary": { totalTokens: 0, totalCostUsd: 0, unpricedTokens: 0, byConnection: [], bySource: [], budget: { limitUsd: null, spentUsd: 0, remainingUsd: null, pct: null, state: "unset" } },
    };
    if (!Object.hasOwn(responses, key)) return route.fulfill({ status: 501, contentType: "application/json", body: JSON.stringify({ detail: `Unstubbed E2E request: ${key}` }) });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(responses[key]) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const label = (s) => `${s} · ${theme}`;
  const composer = () => page.getByRole("textbox", { name: "Message OHarness" });
  const trigger = () => page.getByRole("button", { name: /^Harness:/ });
  const send = async (text) => {
    await composer().fill(text);
    await page.getByRole("button", { name: "Send message" }).click();
  };
  try {
    await page.goto(base, { waitUntil: "networkidle" });
    await trigger().waitFor();

    // 1. No harness: a direct turn, and the chat remembers it.
    await trigger().click();
    await page.getByRole("option", { name: /^No harness/ }).click();
    await send("Hello, no harness");
    await page.getByText("Answer run-1").waitFor();
    assert.deepEqual(requests, ["POST /execute/direct"]);

    // 2. Switching after messages: a marker, applied from the next message.
    await trigger().click();
    await page.getByRole("option", { name: /^Demo Harness/ }).click();
    await page.getByText(/Harness changed to Demo Harness/).waitFor();
    assert.equal(await page.getByText("Answer run-1").count(), 1, "earlier reply untouched");
    // Continuity: the change can be moved to a new chat that carries the conversation; the old one is put back.
    await page.getByRole("button", { name: "Move to a new chat" }).click();
    await page.getByRole("button", { name: "Harness: Demo Harness" }).waitFor();
    assert.equal(await page.getByTestId("harness-change").count(), 0, "no marker in the new chat");
    assert.equal(await page.getByText("Answer run-1").count(), 1, "the new chat carries the earlier reply");
    await send("Now with the demo harness");
    await page.getByText("Answer run-2").waitFor();
    assert.deepEqual(requests, ["POST /execute/direct", "POST /execute/"]);
    await axe(page, label("after switch"));

    // 3. The harness is deleted: sending is blocked, nothing is swapped silently.
    await page.evaluate(() => localStorage.setItem("oh.harnessLibrary", JSON.stringify({ imports: [] })));
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("alert").filter({ hasText: /isn.t available/ }).waitFor();
    await composer().fill("Will this send?");
    assert.ok(await page.getByRole("button", { name: "Send message" }).isDisabled(), "send blocked");
    await axe(page, label("harness gone"));
    await page.getByRole("button", { name: "Continue without a harness" }).click();
    await page.getByRole("button", { name: "Send message" }).waitFor();
    assert.ok(await page.getByRole("button", { name: "Send message" }).isEnabled(), "send allowed after choosing");
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
console.log("PASS: chat harness semantics (per-chat setting, switch marker, deleted harness), both themes, axe clean.");
