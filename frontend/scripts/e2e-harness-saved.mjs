/**
 * Harnesses saved in Studio reach the chat selector, against the static export,
 * both themes: save in Studio -> listed in the chat picker beside the imported
 * one -> choose it -> the run carries its graph; a "Save as" copy shows up
 * without a reload; a failing list shows an error with a retry, never a silent
 * empty list; axe clean with the list open. Sidecar HTTP is stubbed (in-memory
 * database for /harnesses/).
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
const agile = bundle("oharness.default.agile", "Agile Harness", "Delivery loop.");
const imported = bundle("oharness.custom.imported", "Imported Harness", "Came in as a file.");
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

async function session(theme, { listFails = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  const db = [];
  const state = { listFails, executions: [], gets: [] };
  await context.addInitScript(([t, api, imp]) => {
    try {
      if (!sessionStorage.getItem("e2e-seeded")) {
        localStorage.setItem("oharness-theme", t);
        localStorage.setItem("oh.harnessSession", JSON.stringify({ enabled: false, activeBundleId: null }));
        localStorage.setItem("oh.harnessLibrary", JSON.stringify({ imports: [{ id: imp.manifest.id, name: imp.manifest.name, description: imp.manifest.description, bundle: imp, addedAt: 1 }] }));
        sessionStorage.setItem("e2e-seeded", "1");
      }
    } catch { /* storage blocked */ }
    window.__OH_API__ = api;
  }, [theme, API, imported]);
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const key = `${request.method()} ${path}`;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const meta = ({ graph_json, ...m }) => m;
    if (key === "GET /harnesses/") return state.listFails ? json({ detail: "down" }, 503) : json(db.map(meta));
    if (key === "POST /harnesses/") {
      const body = request.postDataJSON();
      const row = { id: `saved-${db.length + 1}`, name: body.name, description: body.description ?? "", graph_json: body.graph_json, created_at: "2026-01-01T00:00:00", updated_at: "2026-01-01T00:00:00" };
      db.push(row);
      return json({ id: row.id, name: row.name }, 201);
    }
    const one = path.match(/^\/harnesses\/([^/]+)$/);
    if (one && request.method() === "GET") {
      state.gets.push(one[1]);
      const row = db.find((r) => r.id === one[1]);
      return row ? json(row) : json({ detail: "gone" }, 404);
    }
    if (one && request.method() === "PUT") {
      Object.assign(db.find((r) => r.id === one[1]) ?? {}, request.postDataJSON(), { updated_at: "2026-01-02T00:00:00" });
      return json({ id: one[1] });
    }
    if (key === "POST /execute/") {
      state.executions.push(request.postDataJSON());
      return route.fulfill({ contentType: "text/event-stream", body: stream(`run-${state.executions.length}`) });
    }
    const responses = {
      "GET /health": { status: "ok" },
      "GET /bundles/default": agile,
      "GET /cowork/projects": { projects: [] },
      "GET /bundles/examples": { examples: [] },
      "GET /providers/connections": { connections: [{ id: "ollama-local", provider: "ollama", label: "QA local", enabled: true, residence: "local", endpoint: "http://127.0.0.1:11434", secretRef: null, defaultModel: "qa-default" }] },
      "GET /usage/summary": { totalTokens: 0, totalCostUsd: 0, unpricedTokens: 0, byConnection: [], bySource: [], budget: { limitUsd: null, spentUsd: 0, remainingUsd: null, pct: null, state: "unset" } },
    };
    if (!Object.hasOwn(responses, key)) return json({ detail: `Unstubbed E2E request: ${key}` }, 501);
    return json(responses[key]);
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { context, page, errors, state };
}

for (const theme of ["dark", "light"]) {
  const label = (s) => `${s} · ${theme}`;
  const { context, page, errors, state } = await session(theme);
  const trigger = () => page.getByRole("button", { name: /^Harness:/ });
  try {
    await page.goto(base, { waitUntil: "networkidle" });
    await trigger().waitFor();

    // Create and save in Studio.
    await page.getByRole("button", { name: "Studio", exact: true }).click();
    await page.getByRole("button", { name: "Open harness: Agent + review", exact: true }).click();
    await page.locator('.react-flow__node[data-id="impl"]').waitFor();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Save as…" }).click();
    await page.getByRole("textbox", { name: "Name of the copy" }).fill("Review copy");
    await page.getByRole("button", { name: "Save copy" }).click();
    await page.getByRole("button", { name: "Chats", exact: true }).first().click();

    // Both saved harnesses and the imported one are in the picker, no reload.
    await trigger().click();
    const list = page.getByRole("listbox", { name: "Harness" });
    await list.waitFor();
    const names = (await list.getByRole("option").allInnerTexts()).map((t) => t.split("\n")[0]);
    assert.ok(names.includes("Review copy"), `saved copy listed: ${names}`);
    assert.ok(names.some((n) => /^Agent \+ review/.test(n)), `saved original listed: ${names}`);
    assert.ok(names.includes("Imported Harness"), `imported still listed: ${names}`);
    assert.equal(await list.getByText("Your harnesses", { exact: true }).count(), 1);
    await axe(page, label("picker with saved harnesses"));

    // Choose a saved one that is not the open one: its graph is fetched, and the run carries it.
    await page.getByRole("option", { name: /^Agent \+ review/ }).click();
    await page.getByRole("button", { name: "Harness: Agent + review" }).waitFor();
    assert.ok(state.gets.length >= 1, "the saved graph was fetched");
    await page.getByRole("textbox", { name: "Message OHarness" }).fill("Run the saved one");
    await page.getByRole("button", { name: "Send message" }).click();
    await page.getByText("Answer run-1").waitFor();
    assert.equal(state.executions.length, 1);
    assert.ok(state.executions[0].graph_json.nodes.length >= 1, "the run used the saved graph");

    // The imported one still runs.
    await trigger().click();
    await page.getByRole("option", { name: /^Imported Harness/ }).click();
    await page.getByRole("button", { name: "Harness: Imported Harness" }).waitFor();
  } catch (e) {
    failures.push(`${label("flow")}: ${e.message}`);
  }
  if (errors.length) failures.push(`${label("page errors")}: ${errors.join("; ")}`);
  await context.close();

  // The saved list cannot be read: an error with a retry, and the rest still listed.
  const bad = await session(theme, { listFails: true });
  try {
    await bad.page.goto(base, { waitUntil: "networkidle" });
    await bad.page.getByRole("button", { name: /^Harness:/ }).click();
    await bad.page.getByRole("alert").filter({ hasText: /Couldn.t load your saved harnesses/ }).waitFor();
    assert.ok((await bad.page.getByRole("option").allInnerTexts()).some((t) => /Imported Harness/.test(t)), "imported still listed");
    await axe(bad.page, label("saved list error"));
    bad.state.listFails = false;
    await bad.page.getByRole("button", { name: "Try again" }).click();
    await bad.page.getByRole("alert").filter({ hasText: /Couldn.t load your saved harnesses/ }).waitFor({ state: "hidden" });
  } catch (e) {
    failures.push(`${label("saved list error")}: ${e.message}`);
  }
  await bad.context.close();
}
await browser.close();
if (failures.length) {
  console.error(`FAIL:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("PASS: saved harnesses in the chat picker (save, list, choose, run, imported, error + retry), both themes, axe clean.");
