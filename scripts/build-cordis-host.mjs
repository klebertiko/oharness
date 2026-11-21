// Stages the Cordis plugin host for the installer (ADR 0071): the pinned Node runtime plus cordis-host's
// sources and production dependencies, in src-tauri/resources/cordis-host/ (gitignored).
//
// The Node archive comes from nodejs.org over https and is accepted only if its SHA256 equals the value pinned below,
// taken from the official SHASUMS256.txt of that release. Dependencies are installed from the lockfile with
// `npm ci --omit=dev --ignore-scripts`: no package script runs.
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { arch, platform, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const NODE_VERSION = "22.20.0";

// SHA256 values from https://nodejs.org/dist/v22.20.0/SHASUMS256.txt. Update them with the version, never alone.
export const NODE_TARGETS = {
  "win32-x64": {
    file: `node-v${NODE_VERSION}-win-x64.zip`,
    sha256: "bb819d6eb8f5bfda294bbc83a7e4ec6539da67c4233d54b0d655b9248b15e29d",
    member: `node-v${NODE_VERSION}-win-x64/node.exe`,
    out: "node.exe",
  },
  "linux-x64": {
    file: `node-v${NODE_VERSION}-linux-x64.tar.gz`,
    sha256: "eeaccb0378b79406f2208e8b37a62479c70595e20be6b659125eb77dd1ab2a29",
    member: `node-v${NODE_VERSION}-linux-x64/bin/node`,
    out: "node",
  },
  "darwin-x64": {
    file: `node-v${NODE_VERSION}-darwin-x64.tar.gz`,
    sha256: "00df9c5df3e4ec6848c26b70fb47bf96492f342f4bed6b17f12d99b3a45eeecc",
    member: `node-v${NODE_VERSION}-darwin-x64/bin/node`,
    out: "node",
  },
  "darwin-arm64": {
    file: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
    sha256: "cc04a76a09f79290194c0646f48fec40354d88969bec467789a5d55dd097f949",
    member: `node-v${NODE_VERSION}-darwin-arm64/bin/node`,
    out: "node",
  },
};

export function targetFor(os, cpu) {
  const target = NODE_TARGETS[`${os}-${cpu}`];
  if (!target) throw new Error(`Unsupported desktop target for the plugin host: ${os}-${cpu}`);
  return target;
}

export function archiveUrl(target) {
  return `https://nodejs.org/dist/v${NODE_VERSION}/${target.file}`;
}

export function verifySha256(bytes, expected) {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new Error(`sha256 mismatch for the Node archive: expected ${expected}, got ${actual}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`${command} ${args[0] ?? ""} failed`);
}

// npm is run through its own script with this node: `npm.cmd` cannot be spawned without a shell on Windows.
function npmCli() {
  if (process.env.npm_execpath?.endsWith("npm-cli.js")) return process.env.npm_execpath;
  const base = dirname(process.execPath);
  const candidates = [
    join(base, "node_modules", "npm", "bin", "npm-cli.js"),
    join(base, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("npm-cli.js was not found next to this Node");
  return found;
}

async function main() {
  const nvmrc = readFileSync(join(root, ".nvmrc"), "utf8").trim();
  if (nvmrc !== NODE_VERSION) throw new Error(`.nvmrc (${nvmrc}) and the pinned plugin host Node (${NODE_VERSION}) differ`);
  const target = targetFor(platform(), arch());
  const out = join(root, "src-tauri", "resources", "cordis-host");
  const work = mkdtempSync(join(tmpdir(), "oharness-cordis-node-"));
  try {
    const response = await fetch(archiveUrl(target));
    if (!response.ok) throw new Error(`download failed: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    verifySha256(bytes, target.sha256);
    writeFileSync(join(work, target.file), bytes);
    // Relative names with cwd=work: GNU tar reads "C:\..." as host:path. On Windows use the system bsdtar, which also reads .zip.
    const tar = platform() === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
    run(tar, ["-xf", target.file, target.member], { cwd: work });

    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    cpSync(join(work, ...target.member.split("/")), join(out, target.out));
    if (platform() !== "win32") chmodSync(join(out, target.out), 0o755);

    const host = join(root, "cordis-host");
    for (const entry of ["src", "vendor", "package.json", "package-lock.json"]) {
      cpSync(join(host, entry), join(out, entry), { recursive: true });
    }
    run(process.execPath, [npmCli(), "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: out });
    rmSync(join(out, "node_modules", ".bin"), { recursive: true, force: true });
    console.log(`plugin host staged in src-tauri/resources/cordis-host (Node ${NODE_VERSION}, ${platform()}-${arch()})`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
