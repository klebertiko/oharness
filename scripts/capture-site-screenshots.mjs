// Captures the product screenshots published on the website from the REAL UI
// (the static export in frontend/out, the same files the Tauri window loads)
// talking to the REAL packaged sidecar, in a throw-away profile:
//   - the sidecar runs with an empty temporary data dir and OH_SECRETS=memory;
//   - no provider is connected, so no credential exists and no paid call can happen;
//   - the page is served from loopback and nothing leaves the machine.
//
//   cd frontend && npm ci && npm run build          # produces frontend/out
//   node scripts/capture-site-screenshots.mjs [outDir]
//
// The site serves WebP: convert the PNGs (e.g. Pillow: Image.open(f).convert('RGB').save(out, 'WEBP', quality=84, method=6)).
// Env: OH_SIDECAR (default: the installed sidecar exe, or backend/sidecar_entry.py), PLAYWRIGHT_MODULE, OH_BROWSER_CHANNEL (default msedge), OH_API_PORT.
// Port 1420 is allowed by the sidecar CORS list (tauri dev origin); 8765 is never used.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const frontendOut = join(root, "frontend", "out");
const outDir = resolve(process.argv[2] ?? join(root, "artifacts", "site-screenshots"));
if (!existsSync(join(frontendOut, "index.html"))) {
  throw new Error("frontend/out is missing: run `npm run build` in frontend/ first.");
}
mkdirSync(outDir, { recursive: true });

const require = createRequire(join(root, "frontend", "package.json"));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const apiPort = Number(process.env.OH_API_PORT ?? 18080);
if (!Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65535 || apiPort === 8765) {
  throw new Error("OH_API_PORT must be an unprivileged port other than 8765 (reserved for another local service).");
}
const webPort = 1420;
const token = randomBytes(24).toString("hex"); // per run; only this throw-away sidecar accepts it
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".txt": "text/plain", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".ico": "image/x-icon",
};
const web = createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { res.writeHead(400); res.end(); return; }
  const base = resolve(frontendOut, "." + pathname);
  const file = [base, base + ".html", join(base, "index.html")]
    .find((c) => (c === frontendOut || c.startsWith(frontendOut + sep)) && existsSync(c) && statSync(c).isFile());
  if (!file) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
// Listen first: if port 1420 is taken (tauri dev), fail before anything else is started.
await new Promise((ok, fail) => { web.once("error", fail); web.listen(webPort, "127.0.0.1", ok); });


const programs = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs") : "";
const installed = programs
  ? [join(programs, "OHarness", "oharness-sidecar.exe"), join(programs, "OpenHarness", "openharness-sidecar.exe")]
      .find((candidate) => existsSync(candidate)) ?? ""
  : "";
const sidecarPath = process.env.OH_SIDECAR ?? installed;
if (!existsSync(sidecarPath)) throw new Error(`Sidecar not found: ${sidecarPath} (set OH_SIDECAR).`);
// The packaged sidecar is a PyInstaller onefile: it re-spawns itself, so killing only
// the first PID would leak the listener. Never start on a port something else holds.
const portBusy = await fetch(`http://127.0.0.1:${apiPort}/health`).then(() => true, () => false);
if (portBusy) throw new Error(`Port ${apiPort} is already in use; set OH_API_PORT.`);
// Created last, right before the spawn: nothing between here and the try block can throw.
const dataDir = mkdtempSync(join(tmpdir(), "oh-capture-data-"));
const minimalEnv = Object.fromEntries(
  ["PATH", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE"]
    .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]),
);
// OH_SIDECAR may also be backend/sidecar_entry.py (run with OH_PYTHON, default "python"):
// use it to capture a source checkout that is newer than the installed app.
const fromSource = sidecarPath.endsWith(".py");
const sidecar = spawn(fromSource ? (process.env.OH_PYTHON ?? "python") : sidecarPath, fromSource ? [sidecarPath] : [], {
  cwd: fromSource ? dirname(sidecarPath) : undefined,
  env: { ...minimalEnv, OH_PORT: String(apiPort), OH_SIDECAR_TOKEN: token, OH_DATA_DIR: dataDir, OH_SECRETS: "memory" },
  stdio: "ignore",
});

const report = { capturedAt: new Date().toISOString(), apiRequests: [], writes: [], pageErrors: [], files: [] };
let browser;
try {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${apiPort}/health`)).ok) break; } catch { /* still starting */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  browser = await chromium.launch({ channel: process.env.OH_BROWSER_CHANNEL || "msedge", headless: true });

  for (const theme of ["dark", "light"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme, deviceScaleFactor: 1 });
    await context.addInitScript(([api, tok]) => { window.__OH_API__ = api; window.__OH_TOKEN__ = tok; }, [`http://127.0.0.1:${apiPort}`, token]);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => report.pageErrors.push(e.message));
    page.on("request", (r) => {
      if (!r.url().startsWith(`http://127.0.0.1:${apiPort}`)) return;
      const entry = `${r.method()} ${new URL(r.url()).pathname}`;
      report.apiRequests.push(entry);
      if (r.method() !== "GET") report.writes.push(entry);
    });
    const shot = async (name) => {
      const file = join(outDir, `${name}-${theme}.png`);
      await page.screenshot({ path: file });
      report.files.push(file);
    };
    // Literal patterns only: the sidebar entries are the two this script visits.
    const navPattern = { Providers: /^Providers/, Studio: /^Studio/ };
    const nav = (name) => page.getByRole("button", { name: navPattern[name] }).first().click();
    const settle = (ms = 1200) => page.waitForTimeout(ms);
    // The sidebar panel toggle is labelled "Hide panel" / "Show panel" by the UI itself.
    const panel = async (visible) => {
      const hide = page.getByRole("button", { name: "Hide panel" });
      if (visible === (await hide.count() > 0)) return;
      await page.getByRole("button", { name: visible ? "Show panel" : "Hide panel" }).click();
      await page.waitForTimeout(400);
    };

    // Each theme starts from an empty profile: remove whatever the previous pass saved.
    const auth = { authorization: `Bearer ${token}` };
    const saved = await (await fetch(`http://127.0.0.1:${apiPort}/harnesses/`, { headers: auth })).json();
    for (const item of saved.harnesses ?? saved) {
      await fetch(`http://127.0.0.1:${apiPort}/harnesses/${item.id}`, { method: "DELETE", headers: auth });
    }

    await page.goto(`http://127.0.0.1:${webPort}/`);
    await settle(2000);
    // The theme follows the system preference on first load (colorScheme above).
    const toggle = page.getByRole("button", { name: /Use (light|dark) theme/ }).first();
    if ((theme === "light") !== /dark theme/.test(await toggle.innerText())) await toggle.click();
    await settle(500);

    // Chats: the real empty state with Nilo (no provider connected).
    await shot("chats");

    // Providers: the real list, nothing connected, no credential.
    await nav("Providers"); await settle(1800);
    await shot("providers");

    // Agent + review (a bundled harness) in a mock run: no provider is called, and the
    // run stops at the human approval gate, which is what the capture shows.
    await nav("Studio"); await settle(1800);
    await page.getByRole("button", { name: /Open harness/ }).nth(0).click(); await settle(2500);
    await panel(false);
    await page.getByRole("button", { name: /^Run/ }).first().click(); await settle(4500);
    await shot("run");
    await page.getByRole("button", { name: "Stop" }).click(); await settle(800);
    await page.getByRole("button", { name: "Back to Studio" }).click(); await settle(1500);

    // Agile Harness: opening makes an editable copy; Shift+L is auto-arrange.
    await page.setViewportSize({ width: 1760, height: 990 });
    await page.getByRole("button", { name: /Open harness/ }).nth(1).click(); await settle(2500);
    await panel(false);
    await page.keyboard.press("Shift+L"); await settle(1200);
    await page.getByRole("button", { name: "Fit graph to view" }).click(); await settle(1000);
    await shot("canvas");
    await page.setViewportSize({ width: 1440, height: 900 });
    await panel(true);
    await page.getByRole("button", { name: "Back to Studio" }).click(); await settle(1800);
    // Now "Your harnesses" lists the saved copy next to Starting points.
    await shot("studio");
    await context.close();
  }
  writeFileSync(join(outDir, "capture-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ outDir, files: report.files.length, writes: report.writes, pageErrors: report.pageErrors }, null, 2));
} finally {
  await browser?.close();
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(sidecar.pid), "/T", "/F"], { stdio: "ignore" });
  else sidecar.kill();
  web.close();
  rmSync(dataDir, { recursive: true, force: true });
}
