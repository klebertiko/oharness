/**
 * Runs every scripts/e2e-*.mjs against the static export in out/ — the same
 * files the Tauri webview loads (ADR 0001). Build first (`npm run build`).
 *
 * The server binds an OS-assigned port on loopback, so it never collides with
 * a dev server already on 3000. Each script stubs all sidecar HTTP itself, so
 * no backend, provider or secret is needed. Exits non-zero if any script fails.
 *
 * Browser: Microsoft Edge by default (OHM_BROWSER_CHANNEL picks another channel);
 * OHM_BROWSER_EXECUTABLE=<path> runs a Chromium binary you already have.
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(frontend, "out");
if (!existsSync(join(out, "index.html"))) {
  console.error("out/ has no index.html: run `npm run build` first.");
  process.exit(1);
}

const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".txt": "text/plain", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json",
};

function resolveFile(pathname) {
  const target = resolve(out, "." + decodeURIComponent(pathname));
  if (target !== out && !target.startsWith(out + sep)) return null;
  for (const candidate of [target, target + ".html", join(target, "index.html")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const server = createServer((req, res) => {
  const file = resolveFile(new URL(req.url, "http://localhost").pathname);
  if (!file) {
    res.writeHead(404, { "content-type": types[".html"] });
    res.end(readFileSync(join(out, "404.html")));
    return;
  }
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const url = `http://127.0.0.1:${server.address().port}`;
console.log(`Serving out/ at ${url}`);

const only = process.argv.slice(2);
const scripts = readdirSync(join(frontend, "scripts"))
  .filter((name) => /^e2e-.+\.mjs$/.test(name))
  .filter((name) => only.length === 0 || only.some((pick) => name.includes(pick)))
  .sort();

const failed = [];
for (const name of scripts) {
  console.log(`\n▶ ${name}`);
  // Async spawn, not spawnSync: the server in this process must keep answering.
  const code = await new Promise((done) => {
    const child = spawn(process.execPath, [join("scripts", name)], {
      cwd: frontend,
      stdio: "inherit",
      env: { ...process.env, OHM_E2E_URL: url },
    });
    child.on("exit", (status) => done(status ?? 1));
  });
  console.log(`${code === 0 ? "✔" : "✘"} ${name}`);
  if (code !== 0) failed.push(name);
}

server.close();
if (failed.length) {
  console.error(`\nFailed: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`\nAll ${scripts.length} e2e scripts passed.`);
