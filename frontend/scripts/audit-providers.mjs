/**
 * Providers audit: walks the states of the Providers screen against the static
 * export (out/), in both themes and at 320, 375, 768 and 1280px, runs axe-core
 * (WCAG 2.2 AA + best practices) and records layout facts. Writes one PNG per
 * capture plus results.json. All sidecar HTTP is stubbed with synthetic data:
 * no backend, no key, no account.
 *
 *   npm run build
 *   OUT=<dir> OHM_BROWSER_EXECUTABLE=<chromium> node scripts/audit-providers.mjs
 *
 * OUT defaults to a private temp directory. SHOTS=full captures every state at
 * every width; the default captures every state at 1280 and 375, and the base
 * state at all four widths.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(frontend, "out");
if (!existsSync(join(out, "index.html"))) throw new Error("out/ has no index.html: run `npm run build` first.");
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), "oharness-providers-audit-"));
mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS === "full" ? "full" : "default";
const API = "http://127.0.0.1:18099";

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain" };
const resolveFile = (pathname) => {
  const target = resolve(out, "." + decodeURIComponent(pathname));
  if (target !== out && !target.startsWith(out + sep)) return null;
  for (const c of [target, target + ".html", join(target, "index.html")]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
};
const server = createServer((req, res) => {
  const file = resolveFile(new URL(req.url, "http://x").pathname) ?? join(out, "404.html");
  res.writeHead(file.endsWith("404.html") ? 404 : 200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;

const row = (id, provider, label, residence, endpoint, extra = {}) => ({ id, provider, label, residence, endpoint, enabled: false, secretRef: null, defaultModel: "", ...extra });
const ALL_OFF = [];
const CONNECTED = [
  row("anthropic", "anthropic", "Anthropic", "cloud", "https://api.anthropic.com", { enabled: true }),
  row("openrouter", "openrouter", "OpenRouter", "cloud", "https://openrouter.ai/api/v1", { enabled: true, secretRef: "oharness/openrouter", defaultModel: "openai/gpt-4o" }),
  row("ollama-local", "ollama", "Ollama local", "local", "http://127.0.0.1:11434", { enabled: true, defaultModel: "llama3.2" }),
];
const live = (detail, models, facts = []) => ({ ok: true, health: "live", detail, latencyMs: 142, facts, models });
const PROBES = {
  openrouter: live("Reachable. 5 models offered.", ["openai/gpt-4o", "anthropic/claude-sonnet", "meta-llama/llama-3.3-70b:free", "qwen/qwen3-max", "deepseek/deepseek-r1"], [{ k: "credits", v: "$18.40 of $25.00" }]),
  "openrouter-401": { ok: false, health: "fault", detail: "401 unauthorized — the key was rejected.", latencyMs: 90, facts: [] },
  "ollama-unreachable": { ok: false, health: "fault", detail: "Could not reach http://127.0.0.1:11434.", latencyMs: 0, facts: [] },
  "ollama-empty": live("Reachable. No models pulled.", []),
  "ollama-other": live("Reachable. 1 model.", ["qwen3:8b"]),
  anthropic: { ok: false, health: "setup", detail: "claude CLI is installed but not logged in. Run `claude login`.", latencyMs: 0, facts: [] },
};

/** state: rows served, which connection to open, what to do there, which probe it answers. */
const STATES = [
  { id: "empty", rows: ALL_OFF, open: "OpenRouter" },
  { id: "connected", rows: CONNECTED, open: "OpenRouter", test: "openrouter" },
  { id: "key-rejected", rows: CONNECTED, open: "OpenRouter", test: "openrouter-401" },
  { id: "unreachable", rows: CONNECTED, open: "Ollama local", test: "ollama-unreachable" },
  { id: "model-not-pulled", rows: CONNECTED, open: "Ollama local", test: "ollama-other" },
  { id: "no-models", rows: CONNECTED, open: "Ollama local", test: "ollama-empty" },
  { id: "cli-signin", rows: CONNECTED, open: "Anthropic", test: "anthropic" },
  { id: "testing", rows: CONNECTED, open: "OpenRouter", test: "openrouter", hang: true },
  { id: "sidecar-down", rows: null, open: "OpenRouter" },
];
const WIDTHS = [320, 375, 768, 1280];
const shotWidths = (s) => (SHOTS === "full" || s.id === "empty" ? WIDTHS : [1280, 375]);

const browser = await chromium.launch({ executablePath: process.env.OHM_BROWSER_EXECUTABLE || undefined, headless: true });
const results = [];

for (const theme of ["dark", "light"]) {
  for (const width of WIDTHS) {
    for (const s of STATES) {
      if (!shotWidths(s).includes(width)) continue;
      const context = await browser.newContext({ viewport: { width, height: width >= 768 ? 860 : 780 }, serviceWorkers: "block" });
      await context.addInitScript(([t, api]) => {
        try { localStorage.setItem("oharness-theme", t); } catch { /* storage blocked */ }
        window.__OH_API__ = api;
      }, [theme, API]);
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === base) return route.continue();
        if (url.origin !== API) return route.abort();
        if (s.rows === null) return route.fulfill({ status: 503, body: "{}" });
        const key = `${route.request().method()} ${url.pathname}`;
        const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
        if (key === "GET /providers/connections") return json({ connections: s.rows });
        if (key === "GET /usage/summary") return json({ totalTokens: 0, totalCostUsd: 0, unpricedTokens: 0, budget: { limitUsd: null, spentUsd: 0, remainingUsd: null, pct: null, state: "unset" }, byConnection: [], bySource: [] });
        if (key === "GET /health") return json({ status: "ok" });
        if (key === "GET /harnesses/") return json([]);
        if (key === "GET /cowork/projects") return json({ projects: [] });
        if (key === "GET /bundles/examples") return json({ examples: [] });
        if (/^POST \/providers\/[^/]+\/probe$/.test(key)) {
          if (s.hang) return; // never answers: the screen stays in "Testing"
          return json(PROBES[s.test]);
        }
        if (key === "POST /providers/connections" || key.startsWith("PUT /providers/connections/")) return json({});
        return route.fulfill({ status: 404, body: "{}" });
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      page.on("console", (m) => { if (m.type() === "error" && !/status of (404|503)|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 160)); });
      await page.goto(base, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Providers", exact: true }).first().click();
      await page.waitForTimeout(300);
      const opener = page.getByRole("button", { name: new RegExp(`^${s.open}`) }).first();
      if (await opener.count()) await opener.click({ timeout: 3000 }).catch(() => {});
      if (s.test) {
        await page.getByRole("button", { name: /^(Test|Test again|Turn on|Copy|Test again later)/ }).first().click({ timeout: 3000 }).catch(() => errors.push("act: no test button"));
        await page.waitForTimeout(500);
      }
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      await page.addScriptTag({ content: axeSource });
      const axe = await page.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] });
        return r.violations.map((v) => ({ id: v.id, nodes: v.nodes.length, sample: v.nodes.slice(0, 2).map((n) => n.target.join(" ")) }));
      });
      const layout = await page.evaluate(() => {
        const main = document.querySelector("main") ?? document.body;
        const interactive = [...main.querySelectorAll("button,a[href],input,select,textarea,[role=button],[role=combobox]")].filter((e) => e.getBoundingClientRect().width > 0);
        const sizes = interactive.map((e) => ({ h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width), name: (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 40) }));
        const fontSizes = {};
        for (const e of main.querySelectorAll("*")) {
          if (!e.childNodes.length || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
          const px = getComputedStyle(e).fontSize;
          fontSizes[px] = (fontSizes[px] || 0) + 1;
        }
        return {
          overflowX: document.documentElement.scrollWidth > innerWidth + 1,
          under24: sizes.filter((x) => x.h < 24).map((x) => `${x.name} ${x.w}x${x.h}`),
          under36: sizes.filter((x) => x.h < 36).length,
          under44: sizes.filter((x) => x.h < 44).length,
          controls: sizes.length,
          fontSizes,
          primaryButtons: [...main.querySelectorAll("button")].filter((b) => /signal/.test(b.className) && /bg-signal(\s|$)/.test(b.className)).length,
        };
      });
      const file = `providers-${s.id}.${theme}.${width}.png`;
      await page.screenshot({ path: join(OUT, file) });
      results.push({ state: s.id, theme, width, file, axe, layout, errors });
      await context.close();
    }
  }
}
await browser.close();
server.close();
writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
const bad = results.filter((r) => r.axe.length || r.errors.length || r.layout.overflowX);
console.log(`${results.length} captures in ${OUT}; ${bad.length} with axe violations, console errors or horizontal overflow.`);
for (const r of bad) console.log(` - ${r.state} ${r.theme} ${r.width}: axe=${r.axe.map((a) => `${a.id}(${a.nodes})`).join(",") || "-"} overflowX=${r.layout.overflowX} errors=${r.errors.length}`);
