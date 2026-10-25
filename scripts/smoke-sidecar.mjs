// Release smoke: start a packaged PyInstaller sidecar the way the desktop
// shell does (loopback port + token + data dir) and require GET /health == ok.
// Usage: node scripts/smoke-sidecar.mjs <path-to-oharness-sidecar-binary>
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const binary = process.argv[2] && resolve(process.argv[2]);
if (!binary || !existsSync(binary)) {
  console.error(`sidecar binary not found: ${process.argv[2] ?? "(missing argument)"}`);
  process.exit(2);
}

const freePort = () =>
  new Promise((ok, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => ok(port));
    });
  });

const port = await freePort();
const dataDir = mkdtempSync(join(tmpdir(), "oh-sidecar-smoke-"));
const child = spawn(binary, [], {
  env: {
    ...process.env,
    OH_PORT: String(port),
    OH_SIDECAR_TOKEN: randomBytes(32).toString("hex"),
    OH_DATA_DIR: dataDir,
  },
  stdio: ["ignore", "inherit", "inherit"],
});

let exited = null;
child.on("exit", (code, signal) => {
  exited = { code, signal };
});

// PyInstaller --onefile unpacks itself on first start; macOS runners are slow.
const deadline = Date.now() + 120_000;
let health = null;
while (Date.now() < deadline && exited === null) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2_000) });
    if (response.ok) {
      health = await response.json();
      break;
    }
  } catch {
    // not listening yet
  }
  await new Promise((r) => setTimeout(r, 500));
}

// A --onefile bootloader runs the app in a child process. POSIX bootloaders
// forward SIGTERM; on Windows the whole tree must be terminated explicitly.
if (process.platform === "win32") {
  spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
} else {
  child.kill("SIGTERM");
}
await new Promise((r) => setTimeout(r, 2_000));
if (exited === null) child.kill("SIGKILL");

const wroteData = readdirSync(dataDir).length > 0;
rmSync(dataDir, { recursive: true, force: true });

if (health?.status !== "ok") {
  console.error(
    exited
      ? `sidecar exited before becoming healthy: ${JSON.stringify(exited)}`
      : `sidecar did not report /health == ok within 120s: ${JSON.stringify(health)}`,
  );
  process.exit(1);
}
console.log(JSON.stringify({ binary, port, health: health.status, data_dir_used: wroteData }));
