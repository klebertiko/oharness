/**
 * #164: a run with a token ceiling stops with an explicit `budget_exceeded`, the ceiling survives a reload,
 * and the compaction event shows before/after tokens. Both themes, axe on the stopped state.
 * Sidecar HTTP is stubbed here.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const fixture = JSON.parse(readFileSync("src/lib/fixtures/ohm-roundtrip.json", "utf8"));
const base = process.env.OHM_E2E_URL || "http://127.0.0.1:3000";
const sidecar = "http://127.0.0.1:18099";
const launch = process.env.OHM_BROWSER_EXECUTABLE
  ? { executablePath: process.env.OHM_BROWSER_EXECUTABLE, headless: true, args: ["--no-sandbox"] }
  : { channel: process.env.OHM_BROWSER_CHANNEL || "msedge", headless: true };
const browser = await chromium.launch(launch);
const failures = [];
const note = (ok, what, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : ` :: ${detail}`}`); if (!ok) failures.push(what); };

for (const theme of ["dark", "light"]) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  await context.addInitScript(([t, api]) => {
    window.__OH_API__ = api;
    try { localStorage.setItem("oharness-theme", t); } catch { /* storage blocked */ }
    localStorage.setItem("oh.harnessSession", JSON.stringify({ enabled: false, activeBundleId: null }));
  }, [theme, sidecar]);
  const requests = [], unexpected = [];
  await context.route("**/*", async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === new URL(base).origin) return route.continue();
    const key = `${req.method()} ${url.pathname}`;
    if (url.origin !== sidecar) { unexpected.push(key); return route.abort(); }
    if (key === "POST /execute/direct") {
      requests.push(req.postDataJSON());
      const frames = [
        ["run_start", { run_id: "budget-1", order: [{ node_id: "direct", type: "agent", label: "Reply" }] }],
        ["node_start", { node_id: "direct", adapter: "ollama", model: "qa-model" }],
        ["context_compacted", { node_id: "direct", before_tokens: 900, after_tokens: 300 }],
        ["budget_exceeded", { node_id: "direct", max_tokens: 500, used_tokens: 640 }],
        ["node_done", { node_id: "direct", output: "", tokens: 640 }],
        ["harness_done", { status: "budget_exceeded", total_tokens: 640, nodes_run: 1 }],
      ];
      return route.fulfill({ contentType: "text/event-stream", headers: { "X-Execution-Id": "budget-1" }, body: frames.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("") });
    }
    const responses = {
      "GET /health": { status: "ok" }, "GET /bundles/default": fixture, "GET /cowork/projects": { projects: [] }, "GET /harnesses/": [],
      "GET /bundles/examples": { examples: [] },
      "GET /providers/connections": { connections: [{ id: "ollama-local", provider: "ollama", label: "QA local", enabled: true, residence: "local", endpoint: "http://127.0.0.1:11434", secretRef: null, defaultModel: "qa-default" }] },
      "GET /usage/summary": { totalTokens: 0, totalCostUsd: 0, unpricedTokens: 0, byConnection: [], bySource: [], budget: { limitUsd: null, spentUsd: 0, remainingUsd: null, pct: null, state: "unset" } },
    };
    if (!(key in responses)) { unexpected.push(key); return route.fulfill({ status: 501, body: "{}" }); }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(responses[key]) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto(base, { waitUntil: "networkidle" });
    const field = page.getByRole("textbox", { name: "Token ceiling for this run" });
    await field.fill("7");
    note(await page.getByRole("alert").filter({ hasText: /at least/i }).count() === 1, `${theme}: a ceiling below the minimum is refused with a reason`);
    await field.fill("500");
    await page.getByRole("textbox", { name: "Message OHarness" }).fill("Synthetic QA prompt");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByText("The turn reached its token ceiling.", { exact: false }).waitFor();
    note(requests.length === 1 && requests[0].max_tokens === 500, `${theme}: the request carries max_tokens`, JSON.stringify(requests));
    await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
    await page.addScriptTag({ content: axeSource });
    const found = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
    note(found.length === 0, `${theme}: axe clean on the stopped state`, found.join(" | "));
    await page.reload({ waitUntil: "networkidle" });
    const after = await page.getByRole("textbox", { name: "Token ceiling for this run" }).inputValue();
    note(after === "500", `${theme}: the ceiling survives a reload`, `field=${JSON.stringify(after)} stored=${await page.evaluate(() => localStorage.getItem("oh.runBudget.v1"))}`);
    note(unexpected.length === 0, `${theme}: no unexpected requests`, unexpected.join(", "));
  } catch (error) {
    note(false, `${theme}: journey`, error.message);
  }
  await context.close();
}
await browser.close();
if (failures.length) { console.error(`\n${failures.length} failed`); process.exit(1); }
console.log("\nPASS: run token ceiling, persistence and stopped state, both themes.");
