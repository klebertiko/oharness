/**
 * Creator mode in the chat, end to end with the sidecar stubbed: the composer's draft survives a visit to Cordis Plugins, "Let Nilo create a
 * plugin" turns the mode on for the chat's own thread without sending anything, the composer shows a "Modo criador" chip with a one-click off,
 * the next message goes to /execute/direct with creator_thread_id, and the approval card of the cordis_plugins tool says what Nilo wants to do
 * (never "Run command") and that it never installs. axe at each step, both themes. OH_E2E_CAPTURES_DIR sends the 8- PNGs to the story's evidence.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { settleForAxe } from "./axe-settle.mjs";
import { evidenceDir } from "./e2e-evidence.mjs";
import { API, launchOptions, sidecar } from "./plugins-stub.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const fixture = JSON.parse(readFileSync("src/lib/fixtures/ohm-roundtrip.json", "utf8"));
const base = process.env.OHM_E2E_URL || "http://127.0.0.1:3000";
const out = process.env.OH_E2E_CAPTURES_DIR || evidenceDir("plugins");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(launchOptions(require));
let checked = 0;
try {
  for (const theme of ["dark", "light"]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block", reducedMotion: "reduce" });
    await context.addInitScript(([t, api]) => {
      window.__OH_API__ = api;
      window.__OH_HUMAN__ = "e2e-human";
      try {
        localStorage.setItem("oharness-theme", t);
        localStorage.setItem("oharness-locale", "pt-BR");
        if (!localStorage.getItem("oh.e2e.seeded")) {
          localStorage.setItem("oh.e2e.seeded", "1");
          localStorage.setItem("oh.harnessSession", JSON.stringify({ enabled: false, activeBundleId: null }));
        }
      } catch { /* storage blocked */ }
    }, [theme, API]);

    const plugins = sidecar();
    const directBodies = [];
    const sse = (frames) => frames.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
    await context.route("**/*", async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.origin === new URL(base).origin) return route.continue();
      if (url.origin !== API) return route.abort();
      const key = `${req.method()} ${url.pathname}`;
      const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (url.pathname.startsWith("/cordis/")) return route.fulfill(plugins.handle(req.method(), url.pathname, req.postData() ? JSON.parse(req.postData()) : undefined, url.searchParams));
      if (key === "POST /execute/direct") {
        const body = req.postDataJSON();
        directBodies.push(body);
        const args = { action: "write_file", name: "hello-tool", path: "index.js" };
        return route.fulfill({
          contentType: "text/event-stream",
          body: sse([
            ["run_start", { run_id: "creator-1", order: [{ node_id: "direct", type: "agent", label: "Reply" }] }],
            ["node_start", { node_id: "direct", adapter: "ollama", model: "qa-model" }],
            ["tool_call", { node_id: "direct", call_id: "c1", name: "cordis_plugins", args, origin: "model" }],
            ["tool_approval_required", { node_id: "direct", call_id: "c1", name: "cordis_plugins", args, reason: "cordis_plugins", risk: "normal", risk_hints: [] }],
          ]),
        });
      }
      if (key === "GET /chat/tools/permission") return json({ thread_id: url.searchParams.get("thread_id"), mode: "ask" });
      if (key === "PUT /chat/tools/permission") return json(req.postDataJSON());
      if (key === "GET /chat/tools/plan") return json({ thread_id: url.searchParams.get("thread_id"), plan: null });
      const responses = {
        "GET /health": { status: "ok" }, "GET /bundles/default": fixture, "GET /cowork/projects": { projects: [] }, "GET /harnesses/": [],
        "GET /bundles/examples": { examples: [] }, "GET /providers/clis": { clis: [] },
        "GET /providers/connections": { connections: [{ id: "ollama-local", provider: "ollama", label: "QA local", enabled: true, residence: "local", endpoint: "http://127.0.0.1:11434", secretRef: null, defaultModel: "qa-default" }] },
        "GET /flow/config": { enabled: false },
        "GET /usage/summary": { totalTokens: 0, totalCostUsd: 0, unpricedTokens: 0, byConnection: [], bySource: [], budget: { limitUsd: null, spentUsd: 0, remainingUsd: null, pct: null, state: "unset" } },
      };
      if (!(key in responses)) return route.fulfill({ status: 501, body: "{}" });
      return json(responses[key]);
    });

    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const check = async (label) => {
      await settleForAxe(page);
      await page.addScriptTag({ content: axeSource });
      const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] })).violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(" ")).join(", ")}`));
      assert.deepEqual(v, [], `${theme} ${label}: axe`);
      checked += 1;
    };
    const composer = () => page.locator("textarea").first();

    await page.goto(base, { waitUntil: "networkidle" });
    await composer().fill("quero um plugin que lista notas");
    assert.equal(await page.getByText("Modo criador", { exact: true }).count(), 0, "no chip while the mode is off");

    // Leave for Cordis Plugins (client navigation) and turn the mode on: the draft must come back with the chat.
    await page.goto(`${base}/plugins`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Deixar o Nilo criar um plugin" }).click();
    await page.getByText("Modo criador ligado nesta conversa").waitFor();
    const turnOn = plugins.calls.find((c) => c.method === "POST" && c.path === "/cordis/creator");
    assert.equal(turnOn.body.enabled, true);
    assert.equal(directBodies.length, 0, "turning it on sends nothing");
    await page.goto(base, { waitUntil: "networkidle" });
    assert.equal(await composer().inputValue(), "quero um plugin que lista notas", "the draft survived the visit and followed the new thread");
    await page.getByText("Modo criador", { exact: true }).waitFor();
    await check("composer with the chip");
    await page.screenshot({ path: join(out, `8-modo-criador-composer-${theme}.png`) });

    // The next message names the thread; the approval card describes the plugin action, not a command.
    await composer().press("Control+Enter");
    await page.getByText("Escrever arquivo do plugin hello-tool").waitFor();
    assert.equal(directBodies.length, 1);
    assert.equal(directBodies[0].creator_thread_id, turnOn.body.thread_id, "creator_thread_id is the thread of the chat");
    assert.equal(await page.getByText("Run command").count(), 0, "no Run command on the card");
    await page.getByText("O Nilo nunca instala. A instalação espera o seu clique em Cordis Plugins.").waitFor();
    await check("approval card");
    await page.screenshot({ path: join(out, `8-cartao-aprovacao-${theme}.png`) });

    // One click turns the mode off.
    await page.getByRole("button", { name: "Desligar o modo criador nesta conversa" }).click();
    await page.getByText("Modo criador", { exact: true }).waitFor({ state: "detached" });
    const turnOff = plugins.calls.filter((c) => c.method === "POST" && c.path === "/cordis/creator").at(-1);
    assert.deepEqual(turnOff.body, { thread_id: turnOn.body.thread_id, enabled: false });
    assert.deepEqual(errors, [], `${theme}: page errors`);
    await context.close();
  }
  console.log(`Plugins creator: ${checked} axe checks passed; captures in ${out}.`);
} finally {
  await browser.close();
}
