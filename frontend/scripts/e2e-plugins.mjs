/**
 * The Cordis Plugins destination (ADR 0071), in a real browser against the static export with a stubbed sidecar: the list with state and
 * capabilities, the logs of a plugin, and the add flow (check, preview with the host warning, confirmation, install, Activate now), in both
 * themes at phone and desktop widths. Proves nothing scrolls sideways, Install stays off until the warning is confirmed, the install call carries
 * the digest and `do-not-run`, and axe finds nothing at every step. Screenshots go to .e2e-out/plugins (see e2e-evidence.mjs).
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { settleForAxe } from "./axe-settle.mjs";
import { evidenceDir } from "./e2e-evidence.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const base = process.env.OHM_E2E_URL || "http://127.0.0.1:3000";
const API = "http://127.0.0.1:18099";
const out = evidenceDir("plugins");
mkdirSync(out, { recursive: true });

const ID = "0123456789abcdef";
const DIGEST = "d".repeat(64);
const view = (over = {}) => ({
  id: ID, name: "notes-tool", version: "1.2.0", source: { kind: "npm", spec: "notes-tool", version: "1.2.0" }, enabled: true, scripts: [], runtime: "isolated",
  capabilities: ["files"], state: "active", message: null, ...over,
});
const fetched = {
  fetchId: "fedcba9876543210", source: { kind: "npm", spec: "echo-tool", version: "0.3.1" },
  preview: {
    name: "echo-tool", version: "0.3.1", runtime: "isolated", runtimeDefaulted: false, capabilities: ["files", "network"], capabilitiesDeclared: true,
    isolation: { enforced: ["processes", "credentials"], notEnforced: ["network"] }, scripts: ["postinstall"], bundlePatchIgnored: false, digest: DIGEST,
    warning: { en: "A third-party Cordis plugin runs in its own process. Install a plugin only after you have reviewed it.", "pt-BR": "Um Cordis plugin de terceiros roda num processo proprio. Instale so depois de revisar." },
    unmetDependencies: [], warnings: [],
  },
};

function sidecar() {
  const calls = [];
  let plugins = [view(), view({ id: "aaaaaaaaaaaaaaaa", name: "broken-one", version: "0.1.0", state: "failed", message: "Cannot find module 'left-pad'", capabilities: [] })];
  const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
  const handle = (method, path, body) => {
    calls.push({ method, path, body });
    if (method === "GET" && path === "/cordis/status") return json({ state: "running", reason: null, restarts: 0, node: "22.20.0", hostLog: [], plugins: plugins.length });
    if (method === "GET" && path === "/cordis/plugins") return json({ plugins });
    if (method === "GET" && path.endsWith("/logs")) return json({ lines: [`[plugin notes-tool] started`, `[plugin notes-tool] error: left-pad missing`] });
    if (method === "POST" && path === "/cordis/plugins/fetch") return json(fetched);
    if (method === "POST" && path === "/cordis/plugins/install") {
      plugins = [...plugins, view({ id: "bbbbbbbbbbbbbbbb", name: "echo-tool", version: "0.3.1", enabled: false, state: "disabled", scripts: ["postinstall"], capabilities: ["files", "network"] })];
      return json(plugins.at(-1));
    }
    if (method === "POST" && path.endsWith("/enable")) {
      plugins = plugins.map((p) => (p.id === path.split("/")[3] ? { ...p, enabled: true, state: "active" } : p));
      return json(plugins.find((p) => p.id === path.split("/")[3]));
    }
    return json({}, 404);
  };
  return { calls, handle };
}

const launch = process.env.OHM_BROWSER_EXECUTABLE
  ? { executablePath: process.env.OHM_BROWSER_EXECUTABLE, headless: true }
  : { channel: process.env.OHM_BROWSER_CHANNEL || "msedge", headless: true };
const browser = await chromium.launch(launch);
let checked = 0;
try {
  for (const theme of ["dark", "light"]) {
    for (const width of [375, 1280]) {
      const where = `${theme}-${width}`;
      const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block", reducedMotion: "reduce" });
      await context.addInitScript(([t, api]) => {
        try { localStorage.setItem("oharness-theme", t); } catch { /* storage blocked */ }
        window.__OH_API__ = api;
        window.__OH_HUMAN__ = "e2e-human";
      }, [theme, API]);
      const stub = sidecar();
      await context.route("**/*", (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === new URL(base).origin) return route.continue();
        if (url.origin !== API) return route.fulfill({ status: 404, body: "{}" });
        return route.fulfill(stub.handle(request.method(), url.pathname, request.postData() ? JSON.parse(request.postData()) : undefined));
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      await page.goto(`${base}/plugins`, { waitUntil: "networkidle" });
      const check = async (label) => {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${label}: sideways scroll`);
        await settleForAxe(page);
        await page.addScriptTag({ content: axeSource });
        const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] })).violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(" ")).join(", ")}`));
        assert.deepEqual(v, [], `${label}: axe`);
        checked += 1;
      };
      const shot = (name) => page.screenshot({ path: join(out, `${name}-${where}.png`), fullPage: false });

      // The list: host state, isolation, safety notice, plugins with state and capabilities.
      await page.getByRole("list", { name: "Plugins" }).waitFor();
      await page.getByText("Running").first().waitFor();
      await page.getByText("Install only what you trust").first().waitFor();
      await page.getByText("Failed").first().waitFor();
      await check(`list ${where}`);
      await shot("1-list");

      // The logs of one plugin.
      await page.getByRole("button", { name: "Details of notes-tool" }).click();
      await page.getByText("[plugin notes-tool] error: left-pad missing").waitFor();
      await check(`detail ${where}`);
      await shot("2-detail");

      // Add: check, preview, confirmation gates Install, then done and Activate now.
      await page.getByRole("button", { name: "Add plugin" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Add a plugin" });
      await dialog.getByRole("button", { name: "Check package" }).click();
      await dialog.getByText("Enter the package name.").waitFor();
      await dialog.getByLabel("Package name").fill("echo-tool");
      await dialog.getByLabel("Exact version").fill("0.3.1");
      await check(`add form ${where}`);
      await shot("3-add");
      await dialog.getByRole("button", { name: "Check package" }).click();
      await dialog.getByText("Review before installing").waitFor();
      await dialog.getByText(/These scripts will not run: postinstall/).waitFor();
      await dialog.getByText(/Install a plugin only after you have reviewed it/).waitFor();
      assert.equal(await dialog.getByRole("button", { name: "Install", exact: true }).isDisabled(), true, `${where}: Install is off before the confirmation`);
      await check(`preview ${where}`);
      await shot("4-preview");
      await dialog.getByRole("checkbox", { name: "I read the warning and trust this plugin" }).check();
      await dialog.getByRole("button", { name: "Install", exact: true }).click();
      await dialog.getByText("echo-tool 0.3.1 installed").waitFor();
      const install = stub.calls.find((c) => c.path === "/cordis/plugins/install");
      assert.deepEqual(install.body, { fetch_id: "fedcba9876543210", accept: true, digest: DIGEST, scripts: "do-not-run" }, `${where}: install body`);
      await check(`done ${where}`);
      await shot("5-done");
      await dialog.getByRole("button", { name: "Activate now" }).click();
      await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="echo-tool active"]')?.getAttribute("aria-checked") === "true");
      await dialog.getByRole("button", { name: "Done" }).click();
      await page.getByRole("dialog").waitFor({ state: "detached" });
      await check(`after add ${where}`);
      await context.close();
    }
  }

  // Portuguese: the warning from the host arrives in the language of the screen.
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  await context.addInitScript((api) => {
    try { localStorage.setItem("oharness-locale", "pt-BR"); } catch { /* storage blocked */ }
    window.__OH_API__ = api;
    window.__OH_HUMAN__ = "e2e-human";
  }, API);
  const stub = sidecar();
  await context.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === new URL(base).origin) return route.continue();
    if (url.origin !== API) return route.fulfill({ status: 404, body: "{}" });
    return route.fulfill(stub.handle(request.method(), url.pathname, request.postData() ? JSON.parse(request.postData()) : undefined));
  });
  const page = await context.newPage();
  await page.goto(`${base}/plugins`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Adicionar plugin" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome do pacote").fill("echo-tool");
  await dialog.getByLabel("Versão exata").fill("0.3.1");
  await dialog.getByRole("button", { name: "Verificar pacote" }).click();
  await dialog.getByText(/Instale so depois de revisar/).waitFor();
  await page.screenshot({ path: join(out, "6-preview-pt-BR-dark-1280.png") });
  await context.close();
  console.log(`Plugins: ${checked} axe checks passed; screenshots in ${out}.`);
} finally {
  await browser.close();
}
