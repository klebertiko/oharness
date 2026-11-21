/**
 * Plugins screen against the static export and a stubbed sidecar.
 * Add from npm inspects before installing, a rejected install script is not installed,
 * and export returns a static index. Light and dark are both checked.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
import { settleForAxe } from "./axe-settle.mjs";

const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const base = process.env.OHM_E2E_URL || "http://127.0.0.1:3000";
const API = "http://127.0.0.1:18099";
const shots = process.env.OHM_E2E_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const checks = [];
const ok = (name) => checks.push(name);

const FETCH = { widget: "f".repeat(16), alpha: "a".repeat(16), beta: "b".repeat(16) };

function preview(name, version, scripts = [], capabilities = []) {
  return {
    fetchId: FETCH[name] ?? "e".repeat(16),
    source: { kind: "npm", spec: name, version },
    preview: {
      name,
      version,
      runtime: "isolated",
      capabilities,
      scripts,
      digest: `digest-${name}`,
      unmetDependencies: [],
      isolation: { enforced: ["files", "processes", "credentials"], notEnforced: ["network"] },
      warning: { en: "Confirm.", "pt-BR": "Confirme." },
    },
  };
}

function row(name, version, capabilities = []) {
  return {
    id: name === "widget" ? "c".repeat(16) : "d".repeat(16),
    name,
    version,
    source: { kind: "npm", spec: name, version },
    enabled: true,
    state: "active",
    scripts: [],
    runtime: "isolated",
    capabilities,
  };
}

function sidecar() {
  const sc = { plugins: [], installs: [], shares: [], fetches: [], known: {}, hold: false, release: () => {} };
  sc.handle = async (method, path, body) => {
    const key = `${method} ${path}`;
    if (key === "GET /cordis/status") return { body: { state: "running", plugins: sc.plugins.length } };
    if (key === "GET /cordis/plugins") return { body: { plugins: sc.plugins } };
    if (key === "GET /cordis/marketplace") return { body: { version: 1, plugins: [], trust: "unreviewed" } };
    if (key === "GET /cordis/creator/apis") {
      return { body: { apis: [{ id: "tools", access: "read" }, { id: "commands", access: "read" }, { id: "events", access: "read" }, { id: "services", access: "read" }] } };
    }
    if (key === "POST /cordis/plugins/fetch") {
      sc.fetches.push(body);
      if (sc.hold) await new Promise((resolve) => { sc.release = resolve; });
      const name = body.spec;
      const scripts = name === "alpha" || name === "beta" ? ["install"] : [];
      const seen = preview(name, body.version || "1.2.3", scripts, name === "widget" ? ["files"] : []);
      sc.known[seen.fetchId] = { name, version: body.version || "1.2.3", capabilities: seen.preview.capabilities };
      return { body: seen };
    }
    if (key === "POST /cordis/plugins/install") {
      sc.installs.push(body);
      const known = sc.known[body.fetch_id] ?? { name: "widget", version: "1.2.3", capabilities: [] };
      const saved = row(known.name, known.version, known.capabilities);
      saved.id = body.fetch_id;
      sc.plugins = [saved, ...sc.plugins.filter((item) => item.name !== known.name)];
      return { body: saved, delay: 500 };
    }
    const log = /^GET \/cordis\/plugins\/fetch\/([^/]+)\/log$/.exec(key);
    if (log) return { body: { lines: ["loading"] } };
    const share = /^POST \/cordis\/plugins\/([^/]+)\/share$/.exec(key);
    if (share) {
      sc.shares.push({ id: share[1], target: body.target });
      const plugin = sc.plugins.find((item) => item.id === share[1]) ?? row("widget", "1.2.3");
      return {
        body: {
          target: body.target,
          filename: `${plugin.name}-${plugin.version}.tgz`,
          scriptsExecuted: false,
          index: {
            version: 1,
            trust: "unreviewed",
            plugins: [{ name: plugin.name, version: plugin.version, description: "Lists files", source: plugin.source }],
          },
        },
      };
    }
    if (method === "DELETE") return { status: 204, body: {} };
    return { status: 404, body: { detail: { code: "missing", message: path } } };
  };
  return sc;
}

async function session(sc, { theme = "dark", locale = "en", viewport = { width: 1280, height: 800 } } = {}) {
  const context = await browser.newContext({ viewport, serviceWorkers: "block", reducedMotion: "reduce" });
  await context.addInitScript(([t, l, api]) => {
    try {
      localStorage.setItem("oharness-theme", t);
      localStorage.setItem("oharness-locale", l);
    } catch { /* storage blocked */ }
    window.__OH_API__ = api;
    window.__OH_HUMAN__ = "human-secret";
  }, [theme, locale, API]);
  const unexpected = [];
  await context.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === new URL(base).origin) return route.continue();
    if (url.origin !== API) {
      unexpected.push(url.origin);
      return route.abort();
    }
    let res;
    try {
      res = await sc.handle(req.method(), url.pathname, req.postDataJSON?.() ?? {});
    } catch (error) {
      if (!/aborted|Target closed/i.test(String(error))) unexpected.push(String(error).slice(0, 120));
      return;
    }
    if (res.delay) await new Promise((resolve) => setTimeout(resolve, res.delay));
    const status = res.status ?? 200;
    const fulfill = status === 204
      ? route.fulfill({ status: 204, body: "" })
      : route.fulfill({ status, contentType: "application/json", body: JSON.stringify(res.body ?? {}) });
    await fulfill.catch((error) => {
      if (!/already handled|aborted|Target closed/i.test(String(error))) unexpected.push(String(error).slice(0, 120));
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/status of 404|ERR_ABORTED|AbortError/.test(m.text())) errors.push(m.text().slice(0, 180));
  });
  await page.goto(`${base}/plugins`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { level: 1, name: "Plugins" }).waitFor();
  return { context, page, errors, unexpected };
}

async function finish({ context, errors, unexpected }) {
  assert.deepEqual(errors, [], "page or console errors");
  assert.deepEqual(unexpected, [], "requests outside the stubbed sidecar");
  await context.close();
}

const axe = async (page) => {
  await settleForAxe(page);
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] });
    return r.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
  });
};

async function addNpm(page, name, version) {
  await page.getByLabel("Package name").fill(name);
  await page.getByLabel("Version").fill(version);
  await page.getByRole("button", { name: "Add", exact: true }).click();
}

const browser = await chromium.launch({ headless: true });
try {
  {
    const sc = sidecar();
    const S = await session(sc);
    const { page } = S;
    await addNpm(page, "widget", "1.2.3");
    await page.getByRole("heading", { level: 2, name: "Inspect before install" }).waitFor();
    await page.getByText("widget", { exact: true }).waitFor();
    await page.getByText("1.2.3", { exact: true }).waitFor();
    await page.getByText(/npm · widget@1\.2\.3/).waitFor();
    assert.equal(sc.installs.length, 0, "install waits until the person confirms the inspection");
    await page.getByRole("button", { name: "Install", exact: true }).click();
    await page.getByText("Loading the plugin…").waitFor();
    await page.getByRole("button", { name: /widget/ }).waitFor();
    assert.equal(sc.installs.length, 1);
    assert.equal(sc.installs[0].accept, true);
    assert.equal(sc.installs[0].digest, "digest-widget");
    assert.equal(sc.installs[0].enable, true);
    assert.equal(sc.installs[0].scripts, undefined);
    await page.getByRole("button", { name: "Export / Share", exact: true }).click();
    await page.getByRole("button", { name: "Publish to npm", exact: true }).click();
    await page.getByRole("heading", { name: "Export / Share" }).waitFor();
    await page.getByRole("heading", { name: "Static index" }).waitFor();
    await page.getByText("No package code ran").waitFor();
    const index = (await page.locator("pre").last().textContent()) ?? "";
    assert.match(index, /"name": "widget"/);
    assert.match(index, /"trust": "unreviewed"/);
    assert.equal(sc.shares[0].target, "npm");
    assert.equal(JSON.stringify(sc.shares).includes("scriptsExecuted"), false);
    const banned = (await page.locator("main").textContent()) ?? "";
    assert.doesNotMatch(banned, /copilot|framework|sample|template|preset|microsoft/i);
    ok("add from npm inspects first, then installs, then exports a static index");
    await finish(S);
  }

  {
    const sc = sidecar();
    const S = await session(sc);
    const { page } = S;
    await addNpm(page, "alpha", "1.2.3");
    await page.getByText("alpha", { exact: true }).waitFor();
    await addNpm(page, "beta", "2.0.0");
    await page.getByText("beta", { exact: true }).waitFor();
    const cards = page.getByRole("heading", { level: 2, name: "Inspect before install" });
    assert.equal(await cards.count(), 2);
    await page.getByRole("button", { name: "Accept without running" }).first().click();
    await page.getByText("Choose for this package before installing.").waitFor();
    assert.equal(sc.installs.length, 0, "accepting one package does not install the other");
    await page.getByRole("button", { name: "Do not install" }).nth(1).click();
    await page.getByRole("button", { name: "Install", exact: true }).click();
    await page.getByRole("button", { name: /alpha/ }).waitFor();
    assert.equal(sc.installs.length, 1);
    assert.equal(sc.installs[0].fetch_id, "a".repeat(16));
    assert.equal(sc.installs[0].scripts, "do-not-run");
    assert.equal(sc.installs.some((body) => body.fetch_id === "b".repeat(16)), false);
    ok("rejecting one package's install scripts does not install that package");
    await finish(S);
  }

  {
    const sc = sidecar();
    sc.hold = true;
    const S = await session(sc);
    const { page } = S;
    await addNpm(page, "widget", "1.2.3");
    await page.getByRole("button", { name: "Cancel download", exact: true }).click();
    sc.hold = false;
    sc.release();
    await page.waitForTimeout(200);
    assert.equal(await page.getByRole("heading", { name: "Inspect before install" }).count(), 0);
    assert.equal(sc.installs.length, 0);
    ok("cancel stops the download before install");
    await finish(S);
  }

  {
    const sc = sidecar();
    const S = await session(sc);
    const { page } = S;
    await page.getByRole("radio", { name: "Create" }).click();
    await page.getByLabel("Draft").fill("list the files in the folder");
    await page.getByRole("button", { name: "Let Nilo create a plugin" }).click();
    assert.equal(await page.getByLabel("Draft").inputValue(), "list the files in the folder");
    await page.getByText("Creator mode is on").waitFor();
    await page.getByText("Nothing was sent").waitFor();
    assert.equal(sc.fetches.length, 0);
    assert.equal(sc.installs.length, 0);
    ok("creator mode keeps the draft and sends nothing");
    await finish(S);
  }

  for (const theme of ["dark", "light"]) {
    const sc = sidecar();
    sc.plugins = [row("widget", "1.2.3", ["files"])];
    const S = await session(sc, { theme, locale: "en" });
    const { page } = S;
    await page.getByText("Files").waitFor();
    await page.getByText("On", { exact: true }).waitFor();
    const installed = await axe(page);
    assert.deepEqual(installed, [], `axe ${theme} installed`);
    await page.getByRole("radio", { name: "Discover" }).click();
    await page.getByText("This list is not reviewed").waitFor();
    const discover = await axe(page);
    assert.deepEqual(discover, [], `axe ${theme} discover`);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
    await finish(S);
  }
  ok("axe is clean in light and dark");
} finally {
  await browser.close();
}
console.log(`PASS Plugins screen: ${checks.length} checks\n - ${checks.join("\n - ")}`);
