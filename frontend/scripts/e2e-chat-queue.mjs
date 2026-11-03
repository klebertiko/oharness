/**
 * #160: a message sent while a run is active waits in a visible queue and only runs after the current turn.
 * Both themes, axe on the queue, keyboard path (Mod+Enter) and pointer path (Queue button).
 * Sidecar HTTP is stubbed here; the first turn is held open until the test releases it, so "a run is active" is real.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
import { settleForAxe } from "./axe-settle.mjs";
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

  const turns = [];
  let releaseFirst;
  const firstHeld = new Promise((ok) => { releaseFirst = ok; });
  const unexpected = [];
  await context.route("**/*", async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === new URL(base).origin) return route.continue();
    const key = `${req.method()} ${url.pathname}`;
    if (url.origin !== sidecar) { unexpected.push(key); return route.abort(); }
    if (key === "POST /execute/direct") {
      const n = turns.push(req.postDataJSON().instruction);
      if (n === 1) await firstHeld; // the first turn stays active until released
      const frames = [
        ["run_start", { run_id: `queue-${n}`, order: [{ node_id: "direct", type: "agent", label: "Reply" }] }],
        ["node_start", { node_id: "direct", adapter: "ollama", model: "qa-model" }],
        ["node_done", { node_id: "direct", output: `Synthetic answer ${n}`, tokens: 4 }],
        ["harness_done", { tokens: 4 }],
      ];
      return route.fulfill({ contentType: "text/event-stream", body: frames.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("") });
    }
    const responses = {
      "GET /health": { status: "ok" }, "GET /bundles/default": fixture, "GET /cowork/projects": { projects: [] }, "GET /harnesses/": [],
      "GET /bundles/examples": { examples: [] },
      "GET /providers/connections": { connections: [{ id: "ollama-local", provider: "ollama", label: "QA local", enabled: true, residence: "local", endpoint: "http://127.0.0.1:11434", secretRef: null, defaultModel: "qa-default" }] },
      "GET /flow/config": { enabled: false },
      "GET /usage/summary": { totalTokens: 0, totalCostUsd: 0, unpricedTokens: 0, byConnection: [], bySource: [], budget: { limitUsd: null, spentUsd: 0, remainingUsd: null, pct: null, state: "unset" } },
    };
    if (!(key in responses)) { unexpected.push(key); return route.fulfill({ status: 501, body: "{}" }); }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(responses[key]) });
  });

  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const composer = () => page.getByRole("textbox", { name: "Message OHarness" });
  const queue = () => page.getByRole("region", { name: "Queued messages" });
  const label = (what) => `${theme}: ${what}`;
  const mod = process.platform === "darwin" ? "Meta" : "Control";

  try {
    await page.goto(base, { waitUntil: "networkidle" });
    await composer().fill("First message");
    await composer().press(`${mod}+Enter`);
    await page.getByRole("button", { name: "Stop run" }).waitFor();
    note(turns.length === 1 && turns[0] === "First message", label("the first turn is running"), JSON.stringify(turns));

    // Keyboard path: the composer stays usable and Mod+Enter queues.
    note(await composer().isEnabled(), label("the composer stays enabled during a run"));
    await composer().fill("Second message");
    await composer().press(`${mod}+Enter`);
    await queue().waitFor();
    note((await queue().textContent()).includes("Second message"), label("the queue shows the message"));
    note((await queue().textContent()).includes("runs after the current turn"), label("the queue says when it runs"));
    // Pointer path.
    await composer().fill("Third message");
    await page.getByRole("button", { name: "Queue message" }).click();
    await page.getByText("Third message", { exact: true }).waitFor();
    await page.waitForTimeout(300);
    note(turns.length === 1, label("queued messages do not start while the turn is active"), JSON.stringify(turns));

    await settleForAxe(page);

    await page.addScriptTag({ content: axeSource });
    const violations = await page.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] });
      return r.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
    });
    note(violations.length === 0, label("axe with a queue showing"), violations.join("; "));

    // A queued message can be removed by keyboard-reachable button.
    await page.getByRole("button", { name: "Remove queued message: Third message" }).click();
    note(!(await queue().textContent()).includes("Third message"), label("a queued message can be removed"));

    // Release the first turn: the second runs only now, then the queue is gone.
    releaseFirst();
    await page.getByText("Synthetic answer 2", { exact: true }).waitFor();
    note(JSON.stringify(turns) === JSON.stringify(["First message", "Second message"]), label("the queued message ran after the first turn, in order"), JSON.stringify(turns));
    note((await queue().count()) === 0, label("the queue is empty after it ran"));
    const order = await page.getByRole("log", { name: "Conversation" }).innerText();
    const at = (t) => order.indexOf(t);
    note(at("First message") < at("Synthetic answer 1") && at("Synthetic answer 1") < at("Second message") && at("Second message") < at("Synthetic answer 2"),
      label("the transcript reads first, answer, second, answer"), order.replace(/\n+/g, " | "));
    note(errors.length === 0, label("no page errors"), errors.join("; "));
    note(unexpected.length === 0, label("no unexpected network"), unexpected.join("; "));
  } catch (error) {
    note(false, label("flow"), String(error?.stack || error));
  } finally {
    releaseFirst();
    await context.close();
  }
}
await browser.close();
if (failures.length) { console.error(`\n${failures.length} failed`); process.exit(1); }
console.log("\nchat queue e2e: all checks passed");
