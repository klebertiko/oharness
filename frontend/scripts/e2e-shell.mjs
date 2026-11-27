/**
 * App frame: deep links, history, sidebar cycle, drawer, dock, regions,
 * shortcuts, dev routes and the document language.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.OHM_E2E_URL || "http://127.0.0.1:3000";
const API = "http://127.0.0.1:18099";
const stubs = {
  "GET /health": { status: "ok" },
  "GET /cowork/projects": { projects: [] },
  "GET /providers/clis": { clis: [] },
  "GET /providers/connections": { connections: [] },
  "GET /bundles/examples": { examples: [] },
  "GET /harnesses/": [],
  "GET /flow/config": { enabled: false },
  "GET /usage/summary": { totalTokens: 0, totalCostUsd: 0, unpricedTokens: 0, budget: { limitUsd: null, spentUsd: 0, remainingUsd: null, pct: null, state: "unset" }, byConnection: [], bySource: [] },
};
const id = "sess-deep";
const threads = JSON.stringify({
  state: {
    threads: [{ id, title: "Deep link", createdAt: 1, updatedAt: 2, archived: false }],
    activeThreadId: null,
    messagesByThread: { [id]: [{ id: "m1", role: "user", content: "Hello from the session", createdAt: 1 }] },
  },
  version: 3,
});

const launch = process.env.OHM_BROWSER_EXECUTABLE
  ? { executablePath: process.env.OHM_BROWSER_EXECUTABLE, headless: true }
  : { channel: process.env.OHM_BROWSER_CHANNEL || "msedge", headless: true };
const browser = await chromium.launch(launch);

async function stub(context) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(base).origin) return route.continue();
    if (url.origin !== API) return route.abort();
    const key = `${route.request().method()} ${url.pathname}`;
    if (key in stubs) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stubs[key]) });
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
}

const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
await context.addInitScript((payload) => {
  try { localStorage.setItem("oh.threads.v1", payload); } catch { /* storage blocked */ }
  window.__OH_API__ = "http://127.0.0.1:18099";
}, threads);
await stub(context);
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${base}/s/${id}`, { waitUntil: "networkidle" });
await page.getByText("Hello from the session").waitFor();
assert.match(page.url(), new RegExp(`/s/${id}$`));

await page.getByRole("button", { name: "Studio", exact: true }).first().click();
await page.waitForURL(/\/studio$/);
await page.goBack();
await page.waitForURL(new RegExp(`/s/${id}$`));
await page.getByText("Hello from the session").waitFor();
await page.goForward();
await page.waitForURL(/\/studio$/);
await page.goBack();

const width = () => page.evaluate(() => document.getElementById("oh-main").getBoundingClientRect().width);
const side = () => page.evaluate(() => Math.round(document.getElementById("oh-sidebar")?.getBoundingClientRect().width ?? 0));
const open = await width();
await page.keyboard.press("Control+b");
await page.waitForFunction(() => Math.round(document.getElementById("oh-sidebar")?.getBoundingClientRect().width ?? 0) === 56);
const rail = await width();
assert.ok(rail > open + 40, `main grew from ${open} to ${rail}`);
assert.equal(await side(), 56);
await page.keyboard.press("Control+b");
await page.waitForFunction(() => Math.round(document.getElementById("oh-sidebar")?.getBoundingClientRect().width ?? 0) === 0);
const hidden = await width();
assert.ok(hidden > rail + 20, `main grew again from ${rail} to ${hidden}`);
assert.equal(await side(), 0);
await page.keyboard.press("Alt+3");
await page.keyboard.press("Alt+1");
assert.equal(await side(), 0, "sidebar stays hidden across destinations");
await page.keyboard.press("Control+k");
await page.getByRole("combobox", { name: "Search commands" }).fill("Providers");
await page.keyboard.press("Enter");
await page.getByRole("heading", { level: 1, name: "Providers" }).waitFor();
assert.equal(await side(), 0, "Providers did not reopen the sidebar");
await page.keyboard.press("Control+b");
await page.waitForFunction(() => Math.round(document.getElementById("oh-sidebar")?.getBoundingClientRect().width ?? 0) === 280);
assert.equal(await side(), 280);

await page.keyboard.press("Control+b");
await page.waitForFunction(() => Math.round(document.getElementById("oh-sidebar")?.getBoundingClientRect().width ?? 0) === 56);
await page.keyboard.press("Control+b");
await page.waitForFunction(() => Math.round(document.getElementById("oh-sidebar")?.getBoundingClientRect().width ?? 0) === 0);
await page.keyboard.press("Control+n");
await page.waitForURL(/\/s\/.+/);
assert.equal(await side(), 0, "new session does not depend on the sidebar");

await page.keyboard.press("Control+\\");
await page.locator("#oh-dock").waitFor();
await page.keyboard.press("Control+\\");
await page.locator("#oh-dock").waitFor({ state: "detached" });

const seen = new Set();
for (let i = 0; i < 4; i++) {
  await page.keyboard.press("F6");
  seen.add(await page.evaluate(() => document.activeElement?.id || ""));
}
assert.ok(seen.has("oh-main"), `F6 visited ${[...seen].join(",")}`);
assert.ok(seen.has("oh-titlebar") || seen.has("oh-sidebar"), `F6 visited ${[...seen].join(",")}`);

await page.keyboard.press("Control+/");
await page.getByRole("dialog", { name: "Keyboard shortcuts" }).waitFor();
await page.keyboard.press("Control+b");
await page.getByText("Toggle left panel").waitFor();
assert.equal(await page.getByText("Go to Studio").count(), 0);
await page.keyboard.press("Escape");

await page.setViewportSize({ width: 700, height: 800 });
await page.keyboard.press("Control+b");
await page.getByRole("dialog", { name: "Sidebar" }).waitFor();
await page.keyboard.press("Escape");
await page.getByRole("dialog", { name: "Sidebar" }).waitFor({ state: "hidden" });

assert.deepEqual(errors, []);
await context.close();

const narrow = await browser.newContext({ viewport: { width: 900, height: 800 }, serviceWorkers: "block", locale: "pt-BR" });
await stub(narrow);
const langPage = await narrow.newPage();
langPage.setDefaultTimeout(15000);
await langPage.goto(base, { waitUntil: "networkidle" });
await langPage.waitForFunction(() => document.documentElement.lang === "pt-BR");
const dev = await langPage.request.get(`${base}/dev/canvas`);
const devDesign = await langPage.request.get(`${base}/dev/design-system`);
assert.equal(dev.status(), 404);
assert.equal(devDesign.status(), 404);
await narrow.close();

await browser.close();
console.log("PASS: deep link, history, sidebar cycle, drawer, dock, regions, shortcuts, dev 404, lang.");
