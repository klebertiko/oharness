/**
 * #166: with Subagents on, a turn shows the parent and its children with live state, and cancelling one child
 * leaves the parent turn and the sibling running. Both themes, axe with the tree live, keyboard cancel.
 * The sidecar here is a small real HTTP server (not a canned body), so the stream is open while the cancel happens.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const fixture = JSON.parse(readFileSync("src/lib/fixtures/ohm-roundtrip.json", "utf8"));
const base = process.env.OHM_E2E_URL || "http://127.0.0.1:3000";
const failures = [];
const note = (ok, what, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : ` :: ${detail}`}`); if (!ok) failures.push(what); };

const json = {
  "GET /health": { status: "ok" }, "GET /bundles/default": fixture, "GET /cowork/projects": { projects: [] }, "GET /harnesses/": [],
  "GET /bundles/examples": { examples: [] },
  "GET /providers/connections": { connections: [{ id: "ollama-local", provider: "ollama", label: "QA local", enabled: true, residence: "local", endpoint: "http://127.0.0.1:11434", secretRef: null, defaultModel: "qa-default" }] },
  "GET /flow/config": { enabled: false },
  "GET /usage/summary": { totalTokens: 0, totalCostUsd: 0, unpricedTokens: 0, byConnection: [], bySource: [], budget: { limitUsd: null, spentUsd: 0, remainingUsd: null, pct: null, state: "unset" } },
};
let turn;
const resetTurn = () => { turn = { bodies: [], cancels: [], unexpected: [], release: null, res: null }; };
resetTurn();
const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const server = createServer((req, res) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const key = `${req.method} ${new URL(req.url, "http://x").pathname}`;
  if (key === "POST /execute/direct") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      turn.bodies.push(JSON.parse(body || "{}"));
      res.writeHead(200, { ...cors, "content-type": "text/event-stream", "cache-control": "no-cache" });
      turn.res = res;
      res.write(frame("run_start", { run_id: "sub-1", order: [{ node_id: "direct", type: "agent", label: "Reply" }] }));
      res.write(frame("node_start", { node_id: "direct", adapter: "ollama", model: "qa-model" }));
      res.write(frame("subagent_start", { node_id: "direct", child_id: "c1", parent_call_id: "k0", task: "survey the docs", state: "running" }));
      res.write(frame("subagent_start", { node_id: "direct", child_id: "c2", parent_call_id: "k1", task: "list the tests", state: "running" }));
      res.write(frame("subagent_progress", { node_id: "direct", child_id: "c1", chars: 420 }));
    });
    return;
  }
  const cancel = key.match(/^POST \/execute\/sub-1\/subagents\/(c\d)\/cancel$/);
  if (cancel) {
    turn.cancels.push(cancel[1]);
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    res.end(JSON.stringify({ child_id: cancel[1], state: "cancelled" }));
    // Only that child ends; the turn stays open until the sibling finishes.
    turn.res.write(frame("subagent_done", { node_id: "direct", child_id: cancel[1], parent_call_id: "k0", state: "cancelled", chars: 420, tokens: 105 }));
    return;
  }
  if (key === "POST /__finish") {
    res.writeHead(200, cors); res.end();
    turn.res.write(frame("subagent_done", { node_id: "direct", child_id: "c2", parent_call_id: "k1", state: "done", chars: 90, tokens: 22 }));
    turn.res.write(frame("node_done", { node_id: "direct", output: "Summary of the surviving subagent.", tokens: 30 }));
    turn.res.write(frame("harness_done", { status: "complete", total_tokens: 30, nodes_run: 1 }));
    turn.res.end();
    return;
  }
  if (key in json) { res.writeHead(200, { ...cors, "content-type": "application/json" }); return res.end(JSON.stringify(json[key])); }
  turn.unexpected.push(key);
  res.writeHead(501, { ...cors, "content-type": "application/json" });
  res.end("{}");
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const sidecar = `http://127.0.0.1:${server.address().port}`;

const launch = process.env.OHM_BROWSER_EXECUTABLE
  ? { executablePath: process.env.OHM_BROWSER_EXECUTABLE, headless: true, args: ["--no-sandbox"] }
  : { channel: process.env.OHM_BROWSER_CHANNEL || "msedge", headless: true };
const browser = await chromium.launch(launch);

for (const theme of ["dark", "light"]) {
  resetTurn();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block", locale: "en-US" });
  await context.addInitScript(([t, api]) => {
    window.__OH_API__ = api;
    try { localStorage.setItem("oharness-theme", t); } catch { /* storage blocked */ }
    localStorage.setItem("oh.harnessSession", JSON.stringify({ enabled: false, activeBundleId: null }));
  }, [theme, sidecar]);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto(base, { waitUntil: "networkidle" });
    const toggle = page.getByRole("switch", { name: "Subagents off" });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("switch", { name: "Subagents on" }).waitFor();
    await page.reload({ waitUntil: "networkidle" });
    note(await page.getByRole("switch", { name: "Subagents on" }).count() === 1, `${theme}: the choice is remembered after a reload`);
    await page.getByRole("textbox", { name: "Message OHarness" }).fill("Split this up");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    // The tree lives in the run detail; open it while the turn is still running.
    await page.getByRole("button", { name: "Show run detail" }).first().click();
    const tree = page.getByRole("region", { name: "Subagents" });
    await tree.waitFor();
    note(turn.bodies[0]?.tools?.subagents === true, `${theme}: the request asks for subagents`, JSON.stringify(turn.bodies[0]?.tools));
    note(await tree.getByText("running", { exact: true }).count() === 3, `${theme}: the parent and both children show as running`);
    await tree.getByText("420 chars").waitFor();
    await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
    await page.addScriptTag({ content: axeSource });
    const found = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
    note(found.length === 0, `${theme}: axe clean with the tree live`, found.join(" | "));
    const cancel = tree.getByRole("button", { name: "Cancel subagent survey the docs" });
    await cancel.focus();
    await page.keyboard.press("Enter");
    await tree.getByText("cancelled", { exact: true }).waitFor();
    note(turn.cancels.join() === "c1", `${theme}: Cancel reaches exactly one child`, turn.cancels.join());
    note(await tree.getByRole("button", { name: "Cancel subagent list the tests" }).count() === 1 && await tree.getByText("running", { exact: true }).count() === 2,
      `${theme}: the sibling and the parent turn keep running`);
    await page.evaluate((url) => fetch(`${url}/__finish`, { method: "POST" }), sidecar);
    await page.getByText("Summary of the surviving subagent.", { exact: true }).waitFor();
    note(await tree.getByText("done", { exact: true }).count() === 1, `${theme}: the sibling finishes and the turn completes`);
    note(turn.unexpected.length === 0, `${theme}: no unexpected requests`, turn.unexpected.join(", "));
  } catch (error) {
    note(false, `${theme}: journey`, error.message);
  }
  await context.close();
}
await browser.close();
server.close();
if (failures.length) { console.error(`\n${failures.length} failed`); process.exit(1); }
console.log("\nPASS: subagent tree and per-child cancel, both themes.");
