/**
 * #165: a person registers a pre-tool hook, edits it, and a run whose hook blocks the tool shows the hook id on the tool card.
 * Both themes, axe on the open sheet and on the run detail, keyboard path for opening the sheet.
 * Sidecar HTTP is stubbed here.
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
const axe = async (page) => {
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  await settleForAxe(page);
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
};

for (const theme of ["dark", "light"]) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  await context.addInitScript(([t, api]) => {
    window.__OH_API__ = api;
    try { localStorage.setItem("oharness-theme", t); } catch { /* storage blocked */ }
    localStorage.setItem("oh.harnessSession", JSON.stringify({ enabled: false, activeBundleId: null }));
  }, [theme, sidecar]);
  const hooks = new Map(), puts = [], unexpected = [];
  await context.route("**/*", async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === new URL(base).origin) return route.continue();
    const key = `${req.method()} ${url.pathname}`;
    if (url.origin !== sidecar) { unexpected.push(key); return route.abort(); }
    if (key === "GET /chat/tools/hooks") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ hooks: [...hooks.values()], rules: {} }) });
    if (req.method() === "PUT" && url.pathname.startsWith("/chat/tools/hooks/")) {
      const id = url.pathname.split("/").pop(), body = req.postDataJSON();
      puts.push([id, body]);
      hooks.set(id, { id, invalid: false, ...body });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id, ...body, invalid: false }) });
    }
    if (key === "POST /execute/direct") {
      const frames = [
        ["run_start", { run_id: "hooks-1", order: [{ node_id: "direct", type: "agent", label: "Reply" }] }],
        ["node_start", { node_id: "direct", adapter: "ollama", model: "qa-model" }],
        ["tool_call", { node_id: "direct", call_id: "c1", name: "exec", args: JSON.stringify({ argv: ["git", "status"], cwd: "." }) }],
        ["tool_hook_decision", { node_id: "direct", call_id: "c1", hook_id: "audit", decision: "block", reason: "timeout", duration_ms: 500 }],
        ["tool_denied", { node_id: "direct", call_id: "c1", reason: "hook", note: "blocked by hook audit" }],
        ["node_done", { node_id: "direct", output: "I could not run that command.", tokens: 6 }],
        ["harness_done", { status: "complete", total_tokens: 6, nodes_run: 1 }],
      ];
      return route.fulfill({ contentType: "text/event-stream", body: frames.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("") });
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
    const opener = page.getByRole("button", { name: "Tool hooks", exact: true });
    await opener.focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: "Tool hooks" });
    await sheet.waitFor();
    await sheet.getByRole("button", { name: "Save hook" }).click();
    note(await sheet.getByRole("alert").count() === 1 && puts.length === 0, `${theme}: an incomplete hook is refused with a reason and nothing is sent`);
    await sheet.getByLabel("Hook id").fill("audit");
    await sheet.getByLabel("Program (full path)").fill("/usr/bin/audit");
    await sheet.getByRole("button", { name: "Save hook" }).click();
    await sheet.getByText("audit", { exact: true }).waitFor();
    note(puts.length === 1 && puts[0][0] === "audit" && puts[0][1].argv[0] === "/usr/bin/audit", `${theme}: the hook is saved`, JSON.stringify(puts));
    await sheet.getByRole("button", { name: "Edit hook audit" }).click();
    // Edit moves focus to the program field on a timer: wait for it, so a slow runner cannot steal focus mid-fill.
    await sheet.getByText("Editing audit. Saving replaces it.").waitFor();
    await page.waitForFunction(() => document.activeElement?.id?.endsWith("-prog"));
    await sheet.getByLabel("Timeout (seconds)").fill("2");
    await sheet.getByRole("button", { name: "Save hook" }).click();
    await sheet.getByText(/2s/).waitFor();
    note(puts.length === 2 && puts[1][1].timeout_s === 2, `${theme}: the hook is edited in place`, JSON.stringify(puts));
    const sheetFound = await axe(page);
    note(sheetFound.length === 0, `${theme}: axe clean with the sheet open`, sheetFound.join(" | "));
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "hidden" });
    note(await opener.evaluate((el) => el === document.activeElement), `${theme}: focus returns to the opener`);
    await page.getByRole("textbox", { name: "Message OHarness" }).fill("Run git status");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByText("I could not run that command.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Show run detail" }).first().click();
    await page.getByText(/hook audit: blocked \(timeout\)/).waitFor();
    note(await page.getByText("blocked by hook", { exact: true }).count() >= 1, `${theme}: the tool card names the hook that blocked it`);
    const runFound = await axe(page);
    note(runFound.length === 0, `${theme}: axe clean on the run detail`, runFound.join(" | "));
    note(unexpected.length === 0, `${theme}: no unexpected requests`, unexpected.join(", "));
  } catch (error) {
    note(false, `${theme}: journey`, error.message);
  }
  await context.close();
}
await browser.close();
if (failures.length) { console.error(`\n${failures.length} failed`); process.exit(1); }
console.log("\nPASS: pre-tool hooks (register, edit, block shown on the tool card), both themes.");
