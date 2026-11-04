/**
 * #276: the chat's permission modes and message queue, end to end.
 * Six modes by keyboard, the Full confirmation (Escape from anywhere, focus back on the option), a plan approved and a plan
 * discarded, a queue that comes back paused after a reload, axe in both themes, desktop and 390px.
 * Sidecar HTTP is stubbed here; the held turn stays active until the test releases it, so "a run is active" is real.
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

const VIEWPORTS = [{ name: "desktop", width: 1280, height: 900 }, { name: "390px", width: 390, height: 844 }];

for (const theme of ["dark", "light"]) {
  for (const viewport of VIEWPORTS) {
    const label = (what) => `${theme} ${viewport.name}: ${what}`;
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, serviceWorkers: "block" });
    await context.addInitScript(([t, api]) => {
      window.__OH_API__ = api;
      try { localStorage.setItem("oharness-theme", t); } catch { /* storage blocked */ }
      // Written once: a reload keeps what the page itself stored (threads, queue); this script must not reset it.
      if (!localStorage.getItem("oh.e2e.seeded")) {
        localStorage.setItem("oh.e2e.seeded", "1");
        localStorage.setItem("oh.harnessSession", JSON.stringify({ enabled: false, activeBundleId: null }));
      }
    }, [theme, sidecar]);

    // The sidecar's state, as far as the chat can see it.
    const turns = [];
    const modes = {};
    let waitingPlan = null;
    let holdNextPlain = null; // a promise keeps the next plain turn open until it resolves
    const unexpected = [];
    const sse = (frames) => frames.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
    await context.route("**/*", async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin === new URL(base).origin) return route.continue();
      const key = `${req.method()} ${url.pathname}`;
      if (url.origin !== sidecar) { unexpected.push(key); return route.abort(); }
      const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (key === "POST /execute/direct") {
        const body = req.postDataJSON();
        const n = turns.push(body.instruction);
        const thread = body.tools?.thread_id;
        const inPlan = body.tools?.permission_mode === "plan";
        const hold = !inPlan && holdNextPlain;
        if (hold) { holdNextPlain = null; await hold; }
        const frames = [
          ["run_start", { run_id: `control-${n}`, order: [{ node_id: "direct", type: "agent", label: "Reply" }] }],
          ["node_start", { node_id: "direct", adapter: "ollama", model: "qa-model" }],
          ["node_done", { node_id: "direct", output: inPlan ? "1. Add the page" : `Synthetic answer ${n}`, tokens: 4 }],
        ];
        if (inPlan) {
          waitingPlan = { plan_id: `plan-${n}`, text: "1. Add the page", status: "proposed" };
          frames.push(["plan_proposed", { node_id: "direct", plan_id: waitingPlan.plan_id, thread_id: thread, text: waitingPlan.text, status: "proposed" }]);
        }
        frames.push(["harness_done", { tokens: 4 }]);
        try { return await route.fulfill({ contentType: "text/event-stream", body: sse(frames) }); } catch { return undefined; } // the page may have reloaded under a held turn
      }
      if (key === "GET /chat/tools/permission") { const id = url.searchParams.get("thread_id"); return json({ thread_id: id, mode: modes[id] ?? "ask" }); }
      if (key === "PUT /chat/tools/permission") {
        const { thread_id, mode } = req.postDataJSON();
        if (waitingPlan && modes[thread_id] === "plan" && mode !== "plan") return json({ code: "plan_not_approved", detail: "A plan is waiting" }, 409);
        modes[thread_id] = mode;
        return json({ thread_id, mode });
      }
      if (key === "GET /chat/tools/plan") return json({ thread_id: url.searchParams.get("thread_id"), plan: waitingPlan });
      if (key === "POST /chat/tools/plan/approve") {
        const { thread_id, plan_id } = req.postDataJSON();
        waitingPlan = null; modes[thread_id] = "ask";
        return json({ thread_id, plan_id, status: "approved", mode: "ask" });
      }
      if (key === "POST /chat/tools/plan/discard") { const { thread_id, plan_id } = req.postDataJSON(); waitingPlan = null; return json({ thread_id, plan_id, status: "discarded" }); }
      const responses = {
        "GET /health": { status: "ok" }, "GET /bundles/default": fixture, "GET /cowork/projects": { projects: [] }, "GET /harnesses/": [],
        "GET /bundles/examples": { examples: [] },
        "GET /providers/connections": { connections: [{ id: "ollama-local", provider: "ollama", label: "QA local", enabled: true, residence: "local", endpoint: "http://127.0.0.1:11434", secretRef: null, defaultModel: "qa-default" }] },
        "GET /flow/config": { enabled: false },
        "GET /usage/summary": { totalTokens: 0, totalCostUsd: 0, unpricedTokens: 0, byConnection: [], bySource: [], budget: { limitUsd: null, spentUsd: 0, remainingUsd: null, pct: null, state: "unset" } },
      };
      if (!(key in responses)) { unexpected.push(key); return route.fulfill({ status: 501, body: "{}" }); }
      return json(responses[key]);
    });

    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const composer = () => page.getByRole("textbox", { name: "Message OHarness" });
    const queue = () => page.getByRole("region", { name: "Queued messages" });
    const radio = (name) => page.getByRole("radio", { name, exact: true });
    const checked = async () => (await page.getByRole("radio").evaluateAll((els) => els.find((el) => el.getAttribute("aria-checked") === "true")?.textContent)) ?? null;
    const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
    // The sidecar stub records a turn when its request arrives; wait for that, never for a particular answer text.
    const turnsReach = async (count) => { for (let i = 0; i < 100 && turns.length < count; i++) await page.waitForTimeout(100); return turns.length >= count; };
    const mod = process.platform === "darwin" ? "Meta" : "Control";
    const axe = async (what) => {
      await settleForAxe(page);
      if (!(await page.evaluate(() => Boolean(window.axe)))) await page.addScriptTag({ content: axeSource });
      const violations = await page.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] });
        return r.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
      });
      note(violations.length === 0, label(`axe: ${what}`), violations.join("; "));
    };

    try {
      await page.goto(base, { waitUntil: "networkidle" });

      // 1. The six modes by keyboard.
      const labels = await page.getByRole("radio").allTextContents();
      note(JSON.stringify(labels) === JSON.stringify(["Plan", "Read-only", "Ask", "Auto", "Workspace write", "Full"]), label("all six modes are offered"), labels.join(","));
      if (viewport.width <= 400) {
        const geometry = await page.evaluate(() => {
          const radios = [...document.querySelectorAll('[role="radiogroup"] [role="radio"]')];
          const group = document.querySelector('[role="radiogroup"]');
          return { rows: new Set(radios.map((r) => Math.round(r.getBoundingClientRect().top))).size, right: Math.max(...radios.map((r) => r.getBoundingClientRect().right)), groupRight: group.getBoundingClientRect().right, scroll: document.documentElement.scrollWidth, inner: window.innerWidth };
        });
        note(geometry.rows >= 2, label("the six modes wrap onto more than one line"), JSON.stringify(geometry));
        note(geometry.right <= geometry.inner && geometry.groupRight <= geometry.inner && geometry.scroll <= geometry.inner, label("nothing runs off the screen"), JSON.stringify(geometry));
      }
      await radio("Ask").focus();
      await page.keyboard.press("ArrowRight");
      note((await checked()) === "Auto", label("ArrowRight moves to Auto"), String(await checked()));
      await page.keyboard.press("ArrowRight");
      note((await checked()) === "Workspace write", label("ArrowRight moves to Workspace write"), String(await checked()));
      await page.keyboard.press("ArrowRight");
      await page.getByRole("alertdialog", { name: "Switch to Full" }).waitFor();
      note((await checked()) === "Workspace write", label("reaching Full asks first: the mode has not changed"), String(await checked()));
      note((await focused()) === "Cancel", label("the confirmation focuses Cancel"), await focused());
      await axe("the Full confirmation is open");
      await composer().focus(); // focus away from the dialog: Escape still dismisses it
      await page.keyboard.press("Escape");
      note((await page.getByRole("alertdialog").count()) === 0, label("Escape closes the Full confirmation from anywhere"));
      note((await focused()) === "Full", label("focus is back on the Full option"), await focused());
      note((await checked()) === "Workspace write", label("the mode is unchanged after Escape"), String(await checked()));
      await page.keyboard.press("Enter"); // the focused Full option asks again, then confirm it
      await page.getByRole("alertdialog", { name: "Switch to Full" }).waitFor();
      await page.getByRole("button", { name: "Use Full" }).click();
      note((await checked()) === "Full", label("Use Full applies Full"), String(await checked()));
      await radio("Full").focus();
      for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
      note((await checked()) === "Plan", label("ArrowLeft walks back to Plan"), String(await checked()));

      // 2. A plan, approved.
      await composer().fill("Plan the settings page");
      await composer().press(`${mod}+Enter`);
      const card = page.getByRole("region", { name: "Plan awaiting your approval" });
      await card.waitFor();
      note(turns.length === 1 && Object.values(modes).includes("plan"), label("the Plan turn was sent in Plan mode"), JSON.stringify({ turns, modes }));
      await axe("a plan is waiting for approval");
      await page.getByRole("button", { name: "Approve plan" }).click();
      note(await turnsReach(2), label("approving sends a second turn"), JSON.stringify(turns));
      await card.waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Stop run" }).waitFor({ state: "detached" });
      note(turns[1]?.includes("Carry out this approved plan"), label("approving sends the plan as the next turn"), String(turns[1]));
      note((await card.count()) === 0 && (await checked()) === "Ask", label("the card is gone and the chat is on Ask"), String(await checked()));

      // 3. A plan, discarded: the chat stays in Plan mode and nothing else runs.
      await radio("Ask").focus();
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowLeft");
      note((await checked()) === "Plan", label("back in Plan by keyboard"), String(await checked()));
      await composer().fill("Plan another page");
      await composer().press(`${mod}+Enter`);
      await card.waitFor();
      const before = turns.length;
      await page.getByRole("button", { name: "Discard plan" }).click();
      await card.waitFor({ state: "detached" });
      note(turns.length === before && (await checked()) === "Plan", label("discarding runs nothing and stays in Plan"), JSON.stringify({ turns: turns.length, mode: await checked() }));

      // 4. A queue that survives a reload, paused.
      await radio("Plan").focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      note((await checked()) === "Ask", label("back on Ask by keyboard"), String(await checked()));
      let release;
      holdNextPlain = new Promise((ok) => { release = ok; });
      await composer().fill("Held message");
      await composer().press(`${mod}+Enter`);
      await page.getByRole("button", { name: "Stop run" }).waitFor();
      await composer().fill("Queued across a reload");
      await composer().press(`${mod}+Enter`);
      await queue().waitFor();
      const stored = await page.evaluate(() => localStorage.getItem("oh.messageQueue.v1"));
      note(Boolean(stored) && stored.includes("Queued across a reload"), label("the queue is written to oh.messageQueue.v1"), String(stored));
      const sentBeforeReload = turns.length;
      await page.reload({ waitUntil: "networkidle" });
      release();
      await queue().waitFor();
      const text = await queue().textContent();
      note(text.includes("Queued across a reload") && /paused/i.test(text), label("after a reload the queue is back and paused"), text);
      await page.waitForTimeout(400);
      note(turns.length === sentBeforeReload, label("a restored queue does not run on its own"), JSON.stringify(turns));
      await axe("a restored queue is showing");
      await page.getByRole("button", { name: "Send next" }).click();
      await queue().waitFor({ state: "detached" });
      note(await turnsReach(sentBeforeReload + 1), label("the restored message reached the sidecar"), JSON.stringify(turns));
      note(turns.at(-1) === "Queued across a reload", label("Send next runs the restored message"), JSON.stringify(turns));
      note((await page.evaluate(() => localStorage.getItem("oh.messageQueue.v1")))?.includes("Queued across") === false, label("the queue storage is emptied once it ran"));

      note(errors.length === 0, label("no page errors"), errors.join("; "));
      note(unexpected.length === 0, label("no unexpected network"), unexpected.join("; "));
    } catch (error) {
      note(false, label("flow"), String(error?.stack || error));
    } finally {
      await context.close();
    }
  }
}
await browser.close();
if (failures.length) { console.error(`\n${failures.length} failed`); process.exit(1); }
console.log("\nchat control e2e: all checks passed");
