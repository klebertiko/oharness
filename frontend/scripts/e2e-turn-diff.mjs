/**
 * #163: a turn that changed files lists them with their diff, and Revert restores one file at a time;
 * a refused revert says why. Both themes, axe on the open diff, keyboard path for the diff toggle.
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
const axe = async (page) => {
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
};
const files = [
  { path: "src/a.txt", status: "modified", added: 1, removed: 1, binary: false, revertible: true, diff: "--- before\n+++ after\n-two\n+TWO\n", diff_truncated: false },
  { path: "logo.png", status: "modified", added: 0, removed: 0, binary: true, revertible: false, diff: "", diff_truncated: false },
  { path: "new.txt", status: "added", added: 1, removed: 0, binary: false, revertible: true, diff: "--- before\n+++ after\n+fresh\n", diff_truncated: false },
];

for (const theme of ["dark", "light"]) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  await context.addInitScript(([t, api]) => {
    window.__OH_API__ = api;
    try { localStorage.setItem("oharness-theme", t); } catch { /* storage blocked */ }
    localStorage.setItem("oh.harnessSession", JSON.stringify({ enabled: false, activeBundleId: null }));
  }, [theme, sidecar]);
  const reverts = [], unexpected = [];
  await context.route("**/*", async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === new URL(base).origin) return route.continue();
    const key = `${req.method()} ${url.pathname}`;
    if (url.origin !== sidecar) { unexpected.push(key); return route.abort(); }
    if (key === "POST /execute/direct") {
      const frames = [
        ["run_start", { run_id: "diff-1", order: [{ node_id: "direct", type: "agent", label: "Reply" }] }],
        ["node_start", { node_id: "direct", adapter: "ollama", model: "qa-model" }],
        ["node_done", { node_id: "direct", output: "I edited two files.", tokens: 6 }],
        ["turn_diff", { node_id: "direct", files, omitted: 0, complete: true }],
        ["harness_done", { status: "complete", total_tokens: 6, nodes_run: 1 }],
      ];
      return route.fulfill({ contentType: "text/event-stream", body: frames.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("") });
    }
    if (key === "GET /execute/diff-1/turn-diff") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ files: [] }) });
    if (key === "POST /execute/diff-1/turn-diff/revert") {
      const path = req.postDataJSON().path;
      reverts.push(path);
      return path === "new.txt"
        ? route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "changed_since" }) })
        : route.fulfill({ contentType: "application/json", body: JSON.stringify({ path, status: "reverted" }) });
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
  try {
    await page.goto(base, { waitUntil: "networkidle" });
    await page.getByRole("textbox", { name: "Message OHarness" }).fill("Edit two files");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByText("I edited two files.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Show run detail" }).first().click();
    const panel = page.getByRole("region", { name: "Files this turn changed" });
    await panel.waitFor();
    note(await panel.getByText("src/a.txt").count() === 1 && await panel.getByText("binary — no diff, cannot be reverted").count() === 1, `${theme}: files listed, the binary one says it cannot be reverted`);
    const toggle = panel.getByRole("button", { name: "Show diff for src/a.txt" });
    await toggle.focus();
    await page.keyboard.press("Enter");
    note(await panel.getByRole("button", { name: "Hide diff for src/a.txt" }).getAttribute("aria-expanded") === "true" && await panel.getByText(/\+TWO/).count() === 1, `${theme}: the diff opens from the keyboard`);
    const found = await axe(page);
    note(found.length === 0, `${theme}: axe clean with a diff open`, found.join(" | "));
    await panel.getByRole("button", { name: "Revert src/a.txt" }).click();
    await panel.getByText("reverted", { exact: true }).waitFor();
    note(reverts.join() === "src/a.txt", `${theme}: Revert sends exactly one file`, reverts.join());
    await panel.getByRole("button", { name: "Revert new.txt" }).click();
    await panel.getByRole("alert").filter({ hasText: /changed after the turn/ }).waitFor();
    note(reverts.join() === "src/a.txt,new.txt" && await panel.getByRole("button", { name: "Revert new.txt" }).count() === 1, `${theme}: a refused revert says why and stays available`, reverts.join());
    note(unexpected.length === 0, `${theme}: no unexpected requests`, unexpected.join(", "));
  } catch (error) {
    note(false, `${theme}: journey`, error.message);
  }
  await context.close();
}
await browser.close();
if (failures.length) { console.error(`\n${failures.length} failed`); process.exit(1); }
console.log("\nPASS: turn diff and per-file revert, both themes.");
